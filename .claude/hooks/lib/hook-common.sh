# Sourced, never run: the rules the classic hooks must agree on about where per-worktree state
# lives and who owns it. One copy, so a fix to one hook cannot miss the others.
# Hooks source it relative to their own path (settings.json runs the main checkout's copy, and a
# worktree's selftests run the worktree's), with `|| exit 0`: a missing or broken lib must fail
# open like any other unreadable input, never block a Stop or a tool call.

# The run's state file in a worktree, or fail when there is none. The writer
# `.claude/skills/durable-state/scripts/state.py` (find_state) looks the file up too (walking up
# from cwd): a change to the location rule belongs in both.
durable_state_file() {
  local f="$1/.durable-state/state.json"
  [[ -f "$f" ]] || return 1
  printf '%s' "$f"
}

# A jq `def` to prefix onto a program reading state.json: `owner` is the run's sessionId, or ""
# when none is recorded; a non-string one reads as none.
HOOK_JQ_OWNER='def owner: .sessionId | if type == "string" then . else "" end;'
