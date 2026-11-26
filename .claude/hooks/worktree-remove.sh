#!/usr/bin/env bash
# WorktreeRemove: the other half of worktree-create.sh. Once a WorktreeCreate hook exists, Claude
# Code no longer falls back to git when removing a worktree it made, so this does the removal.
# (Claude Code runs it when a session leaves its worktree choosing "remove"; subagent and
# workflow worktrees are kept and never reach it.)
#
# Removal is conservative: plain `git worktree remove`, which refuses a worktree with modified
# tracked files or untracked, non-ignored files (node_modules, dist and the like are ignored, so
# they don't block it). A refusal exits non-zero and leaves the worktree on disk. Then the
# worktree's `worktree-*` branch is deleted only if it is merged (`git branch -d`); an unmerged
# branch is kept and named, so no commit is lost.
#
# Stdin is the hook JSON (`worktree_path`, ...). Progress lines carry the tag [worktree-setup].
set -euo pipefail

log() { printf '[worktree-setup] %s\n' "$*" >&2; }
die() { log "error: $*"; exit 1; }

path=$(jq -r '.worktree_path // empty')
[[ -n "$path" ]] || die "no worktree_path on stdin"
[[ -d "$path" ]] || { log "$path is already gone"; exit 0; }

common_dir=$(git -C "$path" rev-parse --path-format=absolute --git-common-dir) \
  || die "$path is not a git worktree"
root=$(cd "$common_dir/.." && pwd -P)
real=$(cd "$path" && pwd -P)
[[ "$real" == "$root/.claude/worktrees/"* ]] || die "refusing to remove $real: not under $root/.claude/worktrees/"

branch=$(git -C "$real" symbolic-ref --quiet --short HEAD 2>/dev/null || true)

git -C "$root" worktree remove "$real" >&2 \
  || die "git refused to remove $real (uncommitted or untracked files?); it is left on disk"
log "removed $real"

if [[ "$branch" == worktree-* ]]; then
  if git -C "$root" branch -d "$branch" >/dev/null 2>&1; then
    log "deleted merged branch $branch"
  else
    log "kept branch $branch: it has commits not merged into HEAD (git branch -D $branch to drop it)"
  fi
fi
