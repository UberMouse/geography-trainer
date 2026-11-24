# shellcheck shell=bash
# Sourced as the first line of every `.claude/bin` wrapper: hands the call to the copy of that
# wrapper in the checkout the caller is standing in, so a bare name acts on the caller's checkout
# whichever `.claude/bin` PATH found first. PATH cannot be relied on for that: a direnv
# `export PATH=…` written by a CwdChanged hook is sourced after claude-bin-path.sh's line and is
# not refreshed by EnterWorktree, so a session that moved into a worktree, and an
# `isolation: "worktree"` subagent that inherited its parent's env files, keep finding the
# checkout they came from.
#
# The walk looks for this wrapper by name, not for any `.claude/bin`: a worktree whose branch
# predates the wrapper falls through to the one that was found. Outside every checkout that is
# also the one that runs.
#

_cb_self=${BASH_SOURCE[1]}
_cb_root=$PWD
while [[ -n "$_cb_root" && ! -x "$_cb_root/.claude/bin/${_cb_self##*/}" ]]; do _cb_root=${_cb_root%/*}; done
if [[ -n "$_cb_root" && ! "$_cb_root/.claude/bin/${_cb_self##*/}" -ef "$_cb_self" ]]; then
  exec "$_cb_root/.claude/bin/${_cb_self##*/}" "$@"
fi
unset _cb_self _cb_root
