#!/usr/bin/env bash
# slot.sh NAME COMMAND [ARGS...] -- run a heavy job (typecheck, lint, tests, build) inside a slot
# of the machine-wide build semaphore, so parallel agent worktrees queue instead of piling onto
# the box at once.
#
# The semaphore client is `kx-build-slot` from the dotfiles. It fails open by itself (no
# controller running, a slot already held by an ancestor, or a wait past its timeout), so this
# wrapper only adds the one case it can't cover: a machine without it at all, such as the CI
# runner, where the command simply runs.
#
# A job inside a slot exports KX_BUILD_SLOT_HELD, so anything it starts that is gated too (the
# Playwright browsers, a nested npm script) passes straight through instead of waiting on the
# slot its own parent holds.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: scripts/slot.sh NAME COMMAND [ARGS...]" >&2
  exit 2
fi

name="$1"
shift

# A new worktree may still be installing node_modules in the background; wait for it first.
"$(dirname "$0")/await-setup.sh"

if command -v kx-build-slot >/dev/null 2>&1; then
  exec kx-build-slot --label "geography-trainer:$name" -- "$@"
fi
exec "$@"
