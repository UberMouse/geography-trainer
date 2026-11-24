#!/usr/bin/env bash
# SessionStart (every source): puts the nearest `.claude/bin` above the Bash tool's cwd first on
# PATH, so the wrappers there (`state`, …) run by bare name. Claude Code runs
# CLAUDE_ENV_FILE in the same shell right before each command's `eval`, subagents' calls included,
# so the lookup happens per call from that call's cwd: a session in a worktree, and an
# `isolation: "worktree"` subagent that inherited its parent's env file, each get their own
# checkout's wrappers and through them their own checkout's scripts.
#
# The line walks up with parameter expansion only (no subprocess per Bash call) and ends in a
# plain `unset`, so it exits 0 and no `&&` after it in the harness's chain is cut.
#

set -u
[[ -n "${CLAUDE_ENV_FILE:-}" ]] || exit 0

line='_cb_bin=$PWD; while [ -n "$_cb_bin" ] && [ ! -d "$_cb_bin/.claude/bin" ]; do _cb_bin=${_cb_bin%/*}; done; if [ -n "$_cb_bin" ]; then PATH="$_cb_bin/.claude/bin:$PATH"; fi; unset _cb_bin'
# SessionStart fires again on resume, clear and compact; write the line once per file.
if ! grep -qxF -- "$line" "$CLAUDE_ENV_FILE" 2>/dev/null; then
  printf '%s\n' "$line" >>"$CLAUDE_ENV_FILE"
fi
exit 0
