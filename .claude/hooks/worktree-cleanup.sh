#!/usr/bin/env bash
# SubagentStop (and SessionStart): removes finished subagents' worktrees that hold no work.
#
# Why: with a WorktreeCreate hook (worktree-create.sh), Claude Code keeps every subagent's
# worktree and never runs WorktreeRemove for it, and its own cleanup (remove an unchanged one
# when the agent stops, sweep kept ones later) only covers worktrees it made with git. So
# nothing would ever remove `.claude/worktrees/agent-*`, each with its own node_modules.
#
# Which worktrees: `<repo>/.claude/worktrees/agent-*`, the names Claude Code gives subagent
# worktrees. A worktree is a candidate when its agent is the one stopping now (SubagentStop's
# `agent_transcript_path`), or when that agent's `<transcript>.meta.json` says `finished: true`.
# The meta file (undocumented, written by Claude Code beside each subagent transcript) carries
# `worktreePath`; it is how a stopping agent is matched to its worktree.
#
# A candidate is removed only when it holds nothing:
#   - `git status --porcelain` is empty: no modified or untracked files (ignored files such as
#     node_modules, dist and test-results don't count, as for `git worktree remove`);
#   - every commit on HEAD is also reachable from some other branch or remote ref, so the branch
#     adds nothing (an agent's commits that were merged into main count as safe);
#   - it is not locked, unless it is the stopping agent's own worktree.
# A background node_modules install (worktree-setup.sh) still running for a candidate is
# stopped first: its agent is done, so the install is wasted.
# Then: `git worktree remove` (no --force) and `git branch -D` of its `worktree-agent-*` branch,
# which the reachability check has just shown holds nothing unique.
#
# Usage: hook JSON on stdin (may be empty or absent for a plain sweep); `--dry-run` reports
# only. Never fails the hook: exits 0. Log lines carry the greppable tag [worktree-setup].
set -uo pipefail

log() { printf '[worktree-setup] cleanup: %s\n' "$*" >&2; }

dry_run=0
[[ "${1:-}" == --dry-run ]] && dry_run=1

input=""
[[ -t 0 ]] || input=$(cat)
[[ -n "$input" ]] || input='{}'
stop_transcript=$(jq -r '.agent_transcript_path // empty' <<<"$input" 2>/dev/null || true)
cwd=$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null || true)
[[ -n "$cwd" && -d "$cwd" ]] || cwd=${CLAUDE_PROJECT_DIR:-$PWD}

# The worktree of the agent stopping now, from its meta file.
stop_dir=""
if [[ -n "$stop_transcript" ]]; then
  stop_transcript=${stop_transcript/#\~/$HOME}
  meta="${stop_transcript%.jsonl}.meta.json"
  if [[ -f "$meta" ]]; then
    stop_dir=$(jq -r 'select(.spawnedWithWorktree == true) | .worktreePath // empty' "$meta" 2>/dev/null || true)
  fi
  # A subagent without a worktree: nothing of its own to clean; still sweep below.
  [[ -n "$stop_dir" && -d "$stop_dir" ]] && cwd=$stop_dir
fi

common_dir=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
root=$(cd "$common_dir/.." && pwd -P)
wt_root="$root/.claude/worktrees"
[[ -d "$wt_root" ]] || exit 0
[[ -n "$stop_dir" ]] && stop_dir=$(cd "$stop_dir" 2>/dev/null && pwd -P || echo "$stop_dir")

# One sweep at a time per repo; a second waits briefly, then gives up (the next sweep catches up).
exec 9>"$common_dir/worktree-cleanup.lock"
flock -w 30 9 || { log "another cleanup is running; skipping"; exit 0; }

git -C "$root" worktree prune >/dev/null 2>&1 || true

finished_by_meta() { # name -> 0 if a meta file for this worktree says finished
  local name=$1 dir=$2 f
  local -a metas
  shopt -s nullglob
  metas=("$HOME"/.claude/projects/*/*/subagents/"$name".meta.json)
  shopt -u nullglob
  for f in "${metas[@]}"; do
    [[ "$(jq -r --arg d "$dir" 'select(.worktreePath == $d) | .finished // false' "$f" 2>/dev/null)" == true ]] && return 0
  done
  return 1
}

holds_nothing() { # dir branch -> 0 if clean and no unique commits; prints the reason otherwise
  local dir=$1 branch=$2
  if [[ -n "$(git -C "$dir" status --porcelain 2>/dev/null)" ]]; then
    echo "has uncommitted or untracked files"; return 1
  fi
  local -a others
  mapfile -t others < <(git -C "$root" for-each-ref --format='%(refname)' refs/heads refs/remotes \
    | grep -vxF "refs/heads/$branch")
  local unique
  unique=$(git -C "$dir" rev-list --count HEAD --not "${others[@]}" 2>/dev/null) || { echo "cannot read its history"; return 1; }
  if ((unique > 0)); then
    echo "has $unique commit(s) on no other branch"; return 1
  fi
  return 0
}

# Lock state per worktree path, from git's porcelain listing.
declare -A locked
current=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*) current=${line#worktree } ;;
    locked*) locked[$current]=1 ;;
  esac
done < <(git -C "$root" worktree list --porcelain)

removed=0
shopt -s nullglob
for dir in "$wt_root"/agent-*/; do
  dir=${dir%/}
  name=${dir##*/}
  [[ -e "$dir/.git" ]] || continue
  real=$(cd "$dir" && pwd -P)

  is_stopping=0
  [[ -n "$stop_dir" && "$real" == "$stop_dir" ]] && is_stopping=1
  if ((!is_stopping)) && ! finished_by_meta "$name" "$real"; then
    continue # its agent may still be running, or left no record: leave it
  fi
  if [[ -n "${locked[$real]:-}" ]] && ((!is_stopping)); then
    log "keeping $name: locked"
    continue
  fi

  # The agent is done, so a node_modules install still running for it is wasted work: stop it
  # (worktree-setup.sh runs under setsid, so its pid is its process group) before checking.
  setup_state="$(git -C "$real" rev-parse --absolute-git-dir 2>/dev/null)/worktree-setup"
  setup_pid=$(cat "$setup_state/pending" 2>/dev/null || true)
  if [[ "$setup_pid" =~ ^[0-9]+$ ]] && kill -0 "$setup_pid" 2>/dev/null; then
    if ((dry_run)); then
      log "would stop $name's node_modules setup (pid $setup_pid)"
    else
      log "stopping $name's node_modules setup (pid $setup_pid): its agent has finished"
      kill -TERM -- "-$setup_pid" 2>/dev/null || kill -TERM "$setup_pid" 2>/dev/null
      for ((i = 0; i < 50; i++)); do kill -0 "$setup_pid" 2>/dev/null || break; sleep 0.2; done
      if kill -0 "$setup_pid" 2>/dev/null; then
        log "keeping $name for now: its setup did not stop"
        continue
      fi
    fi
  fi

  branch=$(git -C "$real" symbolic-ref --quiet --short HEAD 2>/dev/null || true)
  if ! reason=$(holds_nothing "$real" "$branch"); then
    log "keeping $name: $reason"
    continue
  fi

  if ((dry_run)); then
    log "would remove $name${branch:+ and branch $branch}"
    continue
  fi
  [[ -n "${locked[$real]:-}" ]] && git -C "$root" worktree unlock "$real" >/dev/null 2>&1
  if git -C "$root" worktree remove "$real" >/dev/null 2>&1; then
    removed=$((removed + 1))
    if [[ "$branch" == worktree-agent-* ]]; then
      git -C "$root" branch -D "$branch" >/dev/null 2>&1 && log "removed $name and branch $branch" \
        || log "removed $name; could not delete branch $branch"
    else
      log "removed $name"
    fi
  else
    log "git refused to remove $name; left on disk"
  fi
done
((removed)) && log "removed $removed worktree(s)"
exit 0
