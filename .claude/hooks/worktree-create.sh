#!/usr/bin/env bash
# WorktreeCreate: makes the worktree Claude Code would have made, then sets it up to run.
#
# A WorktreeCreate hook REPLACES Claude Code's own `git worktree add` (there is no post-create
# event), so this does both halves. It fires for EnterWorktree, `claude --worktree`, background
# sessions and `isolation: "worktree"` subagents alike.
#
# 1. Create, matching the default: `<repo>/.claude/worktrees/<name>` on a new branch
#    `worktree-<name>`, based per `worktree.baseRef` (read from the user, project and local
#    settings, later wins; default "fresh"): "fresh" = origin/<default branch> after a bounded
#    fetch, falling back to HEAD with no remote; "head" = HEAD of the directory the hook ran in.
#    A name whose worktree already exists is reused (setup still runs, skipping what's done).
# 2. Set up, in the background: when there's a package-lock.json and no finished install yet,
#    start worktree-setup.sh detached (node_modules from a matching checkout, else npm ci; then a
#    Playwright browsers check) and return. The hook must stay fast: a full npm ci on a loaded
#    machine ran past the 600s hook timeout, and a cancelled WorktreeCreate fails the agent.
#    npm scripts wait for the install through scripts/await-setup.sh.
#
# Contract: stdin is the hook JSON (`name`, `cwd`, ...). The worktree's absolute path is the LAST
# line of stdout; everything else goes to stderr. Non-zero exit = creation fails.
# Progress lines carry the greppable tag [worktree-setup].
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
log() { printf '[worktree-setup] %s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

input=$(cat)
name=$(jq -r '.name // empty' <<<"$input")
cwd=$(jq -r '.cwd // empty' <<<"$input")
[[ -n "$cwd" && -d "$cwd" ]] || cwd=$PWD

[[ -n "$name" ]] || die "no worktree name on stdin"
# Same rule as EnterWorktree: "/"-separated segments of letters, digits, '.', '_', '-'.
[[ "$name" =~ ^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$ ]] || die "invalid worktree name: $name"
[[ "/$name/" != *"/../"* && "/$name/" != *"/./"* ]] || die "invalid worktree name: $name"

# The main checkout's root, from wherever the hook ran (the main checkout or another worktree).
common_dir=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir) \
  || die "not inside a git repository: $cwd"
root=$(cd "$common_dir/.." && pwd -P)
dir="$root/.claude/worktrees/$name"
branch="worktree-$name"

is_worktree_of_repo() {
  [[ -d "$1" ]] || return 1
  local top
  top=$(git -C "$1" rev-parse --show-toplevel 2>/dev/null) || return 1
  [[ "$(cd "$top" && pwd -P)" == "$(cd "$1" && pwd -P)" ]] || return 1
  [[ "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)" == "$common_dir" ]]
}

base_ref_setting() {
  local files=() f
  for f in "$HOME/.claude/settings.json" "$root/.claude/settings.json" "$root/.claude/settings.local.json"; do
    [[ -f "$f" ]] && files+=("$f")
  done
  if ((${#files[@]})); then
    jq -rs 'map(.worktree.baseRef? // empty) | last // "fresh"' "${files[@]}" 2>/dev/null || echo fresh
  else
    echo fresh
  fi
}

if is_worktree_of_repo "$dir"; then
  log "reusing existing worktree $dir"
else
  [[ ! -e "$dir" ]] || die "$dir exists but is not a worktree of $root"
  git -C "$root" show-ref --verify --quiet "refs/heads/$branch" \
    && die "branch $branch already exists; pick another name or remove the branch"

  mode=$(base_ref_setting)
  base=HEAD
  base_dir=$cwd
  if [[ "$mode" != head ]]; then
    base_dir=$root
    default_ref=$(git -C "$root" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)
    if [[ -n "$default_ref" ]]; then
      default_branch=${default_ref#refs/remotes/origin/}
      # Bounded so an unreachable remote can't stall the create; a stale origin ref is still used.
      GIT_TERMINAL_PROMPT=0 timeout 15 git -C "$root" fetch --quiet origin "$default_branch" >&2 \
        || log "fetch of origin/$default_branch failed or timed out; using the cached ref"
      if git -C "$root" rev-parse --verify --quiet "$default_ref^{commit}" >/dev/null; then
        base=$default_ref
      fi
    fi
  fi
  base_sha=$(git -C "$base_dir" rev-parse --verify "$base^{commit}") || die "cannot resolve base $base"
  log "creating $dir on $branch from ${base#refs/remotes/} ($mode, ${base_sha:0:7})"
  mkdir -p "$(dirname "$dir")"
  git -C "$root" worktree add --quiet -b "$branch" "$dir" "$base_sha" >&2 \
    || die "git worktree add failed"
fi

# Setup runs detached (worktree-setup.sh) so the hook returns in seconds whatever the load.
# The marker is written here, before the hook returns, so scripts/await-setup.sh can never miss
# it; the setup process replaces it with its pid. Setup never fails the create.
start_setup() {
  [[ -f "$dir/package-lock.json" && ! -f "$dir/node_modules/.package-lock.json" ]] || return 0
  local state pid
  state="$(git -C "$dir" rev-parse --absolute-git-dir)/worktree-setup"
  mkdir -p "$state"
  pid=$(cat "$state/pending" 2>/dev/null || true)
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    log "setup already running (pid $pid)"
    return 0
  fi
  printf 'starting %s\n' "$(date +%s)" >"$state/pending"
  setsid -f bash "$here/worktree-setup.sh" "$dir" </dev/null >>"$state/log" 2>&1
  log "node_modules setup started in the background (log: $state/log)"
}
start_setup || log "warning: could not start setup; run npm ci in $dir"

log "ready: $dir"
printf '%s\n' "$dir"
