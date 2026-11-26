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
# 2. Set up: `npm ci` when there's a package-lock.json and no node_modules yet, then check the
#    Playwright browsers this lockfile wants are under PLAYWRIGHT_BROWSERS_PATH (on this machine
#    a Nix store path, so nothing is downloaded). Setup failures only warn: the worktree is still
#    handed back, since a missing node_modules is easy to fix and a failed create blocks the agent.
#
# Contract: stdin is the hook JSON (`name`, `cwd`, ...). The worktree's absolute path is the LAST
# line of stdout; everything else goes to stderr. Non-zero exit = creation fails.
# Progress lines carry the greppable tag [worktree-setup].
set -euo pipefail

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

setup() {
  cd "$dir"
  if [[ -f package-lock.json ]]; then
    if [[ -d node_modules ]]; then
      log "node_modules present; skipping npm ci"
    elif ! command -v npm >/dev/null 2>&1; then
      log "warning: npm not on PATH; run npm ci in $dir yourself"
    else
      log "npm ci ..."
      if npm ci --prefer-offline --no-audit --no-fund --loglevel=error >&2; then
        log "npm ci done"
      else
        log "warning: npm ci failed; run it in $dir before building or testing"
      fi
    fi
  fi

  local browsers=node_modules/playwright-core/browsers.json
  if [[ -f "$browsers" && -n "${PLAYWRIGHT_BROWSERS_PATH:-}" && "$PLAYWRIGHT_BROWSERS_PATH" != 0 ]]; then
    local rev
    rev=$(jq -r '.browsers[] | select(.name == "chromium") | .revision' "$browsers")
    if [[ -n "$rev" && ! -d "$PLAYWRIGHT_BROWSERS_PATH/chromium-$rev" ]]; then
      log "warning: Playwright wants chromium-$rev, which is not in $PLAYWRIGHT_BROWSERS_PATH; e2e tests will fail until the browsers match"
    fi
  fi
}
# Setup never fails the create.
(setup) || log "warning: setup stopped early; the worktree is usable but may need npm ci"

log "ready: $dir"
printf '%s\n' "$dir"
