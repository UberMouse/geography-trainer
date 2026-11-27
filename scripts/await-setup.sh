#!/usr/bin/env bash
# await-setup.sh [COMMAND [ARGS...]] -- wait for this worktree's background node_modules setup,
# then run COMMAND (exec), or just return with no COMMAND.
#
# A new Claude worktree gets its node_modules from a detached job (.claude/hooks/worktree-setup.sh)
# that leaves `<gitdir>/worktree-setup/pending` while it runs. Every npm script that needs
# node_modules comes through here (scripts/slot.sh calls it; `dev` and `spec:check` wrap their
# command in it), so a command started before the install finishes waits instead of failing
# with a missing module. With no marker (CI, the main checkout, a finished worktree) it costs
# one `git rev-parse` and runs the command at once.
#
# It stops waiting when the marker goes away, when the pid in it is no longer alive, or when a
# setup that never started (marker still "starting ...") is two minutes old. A failed setup is
# reported and the command still runs, so its own error shows. Log tag: [worktree-setup].
set -euo pipefail

log() { printf '[worktree-setup] %s\n' "$*" >&2; }

wait_for_setup() {
  local gitdir state content announced=0 started
  gitdir=$(git rev-parse --absolute-git-dir 2>/dev/null) || return 0
  state="$gitdir/worktree-setup"
  while [[ -f "$state/pending" ]]; do
    content=$(cat "$state/pending" 2>/dev/null || true)
    if [[ "$content" =~ ^[0-9]+$ ]]; then
      if ! kill -0 "$content" 2>/dev/null; then
        log "setup process $content is gone without finishing; not waiting (log: $state/log)"
        break
      fi
    elif [[ "$content" =~ ^starting\ ([0-9]+)$ ]]; then
      started=${BASH_REMATCH[1]}
      if (($(date +%s) - started > 120)); then
        log "setup never started; not waiting (log: $state/log)"
        break
      fi
    elif [[ -z "$content" ]]; then
      : # being rewritten; look again
    else
      break
    fi
    if ((!announced)); then
      log "waiting for this worktree's node_modules install to finish (log: $state/log)"
      announced=1
    fi
    sleep 2
  done
  if [[ -f "$state/failed" ]]; then
    log "warning: this worktree's node_modules setup failed: $(cat "$state/failed"); run npm ci (log: $state/log)"
  elif ((announced)); then
    log "node_modules install finished"
  fi
}

wait_for_setup
if (($#)); then
  exec "$@"
fi
