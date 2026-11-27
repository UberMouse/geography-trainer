#!/usr/bin/env bash
# worktree-setup.sh DIR -- installs a new worktree's node_modules, detached from the hook.
#
# worktree-create.sh starts this with `setsid -f` and returns at once: under a loaded machine a
# full `npm ci` (509 packages and a native addon build) outlasts any sane hook timeout, and a
# cancelled WorktreeCreate fails the agent outright. Meanwhile `scripts/await-setup.sh` (run by
# every npm script that needs node_modules: scripts/slot.sh, dev, spec:check) waits on the
# marker this leaves, so an agent that starts at once gets a wait, not a missing-module error.
#
# State lives in the worktree's own git dir, so `git status` stays clean and it goes away with
# the worktree: <gitdir>/worktree-setup/{pending (this pid), failed (why), log}.
#
# Install, fastest first:
#   1. Donor: another checkout of this repo (a worktree or the main one) whose package-lock.json
#      is byte-identical and whose install finished (node_modules/.package-lock.json). Its
#      node_modules is hardlink-copied (`cp -al`, no re-extraction, no native rebuild), minus
#      the top-level dot entries other than .bin and .package-lock.json (.vite, .tmp, .cache:
#      per-checkout caches written in place, which must not share inodes).
#   2. Otherwise `npm ci --prefer-offline`.
# Both run inside a build-semaphore slot (kx-build-slot, when installed) so a batch of new
# worktrees queues instead of piling onto the disk. Then a check that the Playwright browsers
# this lockfile wants exist under PLAYWRIGHT_BROWSERS_PATH (warn only).
#
# Hardlinks mean donor and copy share file contents: editing a file inside node_modules in place
# (patch-package, debugging) changes it in both. npm itself replaces files, so `npm ci` or
# `npm install` in either checkout is safe.
#
# Env: WORKTREE_SETUP_SLOT=0 skips the semaphore (the selftest). Log tag: [worktree-setup].
set -uo pipefail

dir=${1:?usage: worktree-setup.sh DIR}
log() { printf '[worktree-setup] %s %s\n' "$(date +%T)" "$*" >&2; }

gitdir=$(git -C "$dir" rev-parse --absolute-git-dir 2>/dev/null) || { log "error: $dir is not a worktree"; exit 1; }
state="$gitdir/worktree-setup"
mkdir -p "$state"
printf '%s\n' "$$" >"$state/pending"
rm -f "$state/failed"

finish() { rm -f "$state/pending"; }
fail() {
  log "error: $*"
  printf '%s\n' "$*" >"$state/failed"
  rm -rf "$state/node_modules"
  finish
  exit 1
}
trap 'fail "setup was interrupted"' INT TERM HUP

cd "$dir" || fail "cannot enter $dir"

slot=()
if [[ "${WORKTREE_SETUP_SLOT:-1}" != 0 ]] && command -v kx-build-slot >/dev/null 2>&1; then
  slot=(kx-build-slot --label "geography-trainer:worktree-setup" --)
fi

find_donor() {
  local w wgit
  while IFS= read -r line; do
    [[ "$line" == "worktree "* ]] || continue
    w=${line#worktree }
    [[ "$w" -ef "$dir" ]] && continue
    [[ -f "$w/node_modules/.package-lock.json" && -f "$w/package-lock.json" ]] || continue
    cmp -s "$w/package-lock.json" package-lock.json || continue
    wgit=$(git -C "$w" rev-parse --absolute-git-dir 2>/dev/null) || continue
    [[ -f "$wgit/worktree-setup/pending" ]] && continue # its own install is still running
    printf '%s\n' "$w"
    return 0
  done < <(git worktree list --porcelain)
  return 1
}

install_from_donor() {
  local donor=$1 stage="$state/node_modules"
  rm -rf "$stage"
  log "hardlink-copying node_modules from $donor"
  "${slot[@]}" cp -al "$donor/node_modules" "$stage" || return 1
  find "$stage" -mindepth 1 -maxdepth 1 -name '.*' ! -name .bin ! -name .package-lock.json \
    -exec rm -rf {} + || return 1
  [[ -f "$stage/.package-lock.json" ]] || return 1
  rm -rf node_modules
  mv "$stage" node_modules
}

if [[ -f package-lock.json && ! -f node_modules/.package-lock.json ]]; then
  installed=0
  if donor=$(find_donor); then
    if install_from_donor "$donor"; then
      installed=1
      log "node_modules copied from $donor"
    else
      rm -rf "$state/node_modules"
      log "copy from $donor failed; falling back to npm ci"
    fi
  fi
  if ((!installed)); then
    command -v npm >/dev/null 2>&1 || fail "npm is not on PATH"
    log "npm ci (no checkout with an identical package-lock.json and a finished install)"
    "${slot[@]}" npm ci --prefer-offline --no-audit --no-fund --loglevel=error >&2 || fail "npm ci failed"
    [[ -f node_modules/.package-lock.json ]] || fail "npm ci left no node_modules/.package-lock.json"
    log "npm ci done"
  fi
else
  log "node_modules already installed; nothing to do"
fi

browsers=node_modules/playwright-core/browsers.json
if [[ -f "$browsers" && -n "${PLAYWRIGHT_BROWSERS_PATH:-}" && "$PLAYWRIGHT_BROWSERS_PATH" != 0 ]]; then
  rev=$(jq -r '.browsers[] | select(.name == "chromium") | .revision' "$browsers" 2>/dev/null)
  if [[ -n "$rev" && ! -d "$PLAYWRIGHT_BROWSERS_PATH/chromium-$rev" ]]; then
    log "warning: Playwright wants chromium-$rev, which is not in $PLAYWRIGHT_BROWSERS_PATH; e2e tests will fail until the browsers match"
  fi
fi

finish
log "setup done"
