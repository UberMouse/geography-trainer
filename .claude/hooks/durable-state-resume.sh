#!/usr/bin/env bash
# SessionStart (matcher `compact|resume`): re-orient any session that keeps durable state
# (`.claude/skills/durable-state/SKILL.md`) after compaction or a resumed session.
#
# Why this exists: the harness re-attaches an invoked skill only on SOME compaction boundaries,
# truncates it at ~22KB when it does, and never re-attaches the reference files a skill body
# tells the model to Read (sdd-loop keeps its dispatch templates there). The
# 2026-09 forensics sessions show what follows: after a `/compact` + "carry on" the conductor
# implemented tasks itself, dispatched agents without templates or `model`, and stopped
# committing per task. Prose reminders did not fix it; a pointer back to SKILL.md did. So on
# every compact/resume we print that pointer plus the durable state the session keeps in
# `<worktree>/.durable-state/state.json`.
#
# The payload's `cwd` is the worktree; CLAUDE_PROJECT_DIR is the MAIN checkout, so it cannot be
# used to find state. No state file (or no/garbled payload) -> print nothing, exit 0: a
# SessionStart hook must never get in the way of a session that keeps no state.

source "$(dirname "${BASH_SOURCE[0]}")/lib/hook-common.sh" 2>/dev/null || exit 0

hook_input=$(cat)
cwd=$(jq -r '.cwd // ""' <<<"$hook_input" 2>/dev/null) || exit 0
[[ -n "$cwd" ]] || exit 0

# SessionStart also fires when a subagent compacts, with the parent's session_id (75d3690e t99;
# 3ffada97 agent-a8b15cdf100cdd606 got autonomous-mode-resume.sh's output on 2026-09-30), and
# this text is the conductor's, not the subagent's. The engine documents `agent_id` for this
# payload ("present only when the hook fires from within a subagent") but still leaves it out
# (2.1.310), so this guard is forward-compatible only: until it does, a compacting subagent may
# see this text too.
agent_id=$(jq -r '.agent_id // ""' <<<"$hook_input" 2>/dev/null)
[[ -z "$agent_id" ]] || exit 0

state=$(durable_state_file "$cwd") || exit 0

# Point at the owner skill only if it exists in the worktree (a skill new on this branch) or the
# main checkout this hook runs from; anything else (missing, garbled, a path) gets the generic
# skill, whose §Resuming works for any owner.
hook_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
skill=$(jq -r '.skill // ""' "$state" 2>/dev/null)
if ! [[ "$skill" =~ ^[a-z0-9][a-z0-9-]*$ ]] ||
  ! [[ -f "$cwd/.claude/skills/$skill/SKILL.md" || -f "$hook_dir/../skills/$skill/SKILL.md" ]]; then
  skill=durable-state
fi

# The pointer names only §Resuming, never a loop section or reference file: each skill's
# §Resuming says which files to Read for the recorded phase, so this text stays right however a
# skill lays out its sections — and for worktrees still on an older layout of the skill.

# A `resume` is a new process: every background task, gate included, died with the old one. A
# `compact` keeps the process, so a gate launched in the background may still be up — re-launching
# it blindly would open a second plannotator on the same doc.
source=$(jq -r '.source // ""' <<<"$hook_input" 2>/dev/null)
if [[ "$source" == "compact" ]]; then
  gate_advice='check the matching inFlight gate entry / its background task first; re-launch it only if that task is gone.'
else
  gate_advice='the gate process did not survive the resume; re-launch it.'
fi

session_id=$(jq -r '.session_id // ""' <<<"$hook_input" 2>/dev/null)

# The run's owning session (durable-state SKILL.md, `sessionId`). state.json is per worktree, and
# other sessions (a reviewer, a second terminal) may share the worktree: one that compacts or resumes
# there must not be pointed at the owner's run, or it resumes work that is not its own. A
# non-string or empty `sessionId` reads as none recorded; `?` means state.json did not parse, which
# the summary below reports. A compact keeps the session id, so there another id settles it; a
# resume may continue under a new id, so it may still be this session's own run, handed over.
owner=$(jq -r "$HOOK_JQ_OWNER"' if type == "object" then owner else error("not an object") end' \
  "$state" 2>/dev/null) || owner="?"
if [[ -n "$owner" && "$owner" != "?" && -n "$session_id" && "$owner" != "$session_id" ]]; then
  if [[ "$source" == "compact" ]]; then
    printf 'Durable-state note: another session owns the %s run in this worktree (%s names it in sessionId); it is not yours to resume.\n' \
      "$skill" "$state"
  else
    printf 'Durable-state note: another session owns the %s run in this worktree (%s names it in sessionId); resume it only if it is your own run under a new session id (a handoff), per .claude/skills/durable-state/SKILL.md §Resuming.\n' \
      "$skill" "$state"
  fi
  exit 0
fi

# Each list below is capped, but a run that is heavy on every one at once can still sum past the
# 2 KB preview. Since what the resume acts on is printed first, the last resort is to cut the
# descriptive tail at a line boundary: 1900 bytes plus the closing line stays under 2000. Bytes,
# not characters (LC_ALL=C), because the preview is measured in bytes.
resume_budget() {
  LC_ALL=C awk -v max=1900 '
    cut { next }
    { used += length($0) + 1 }
    used > max { print "  (output cut at the 2 KB preview; Read state.json for the rest)"; cut = 1; next }
    { print }'
}

{
printf 'You are running the %s skill. Before any other tool call: Read .claude/skills/%s/SKILL.md §Resuming and every file it names for your phase, then %s\n' \
  "$skill" "$skill" "$state"
# How to write state goes right under the pointer: the rule is in durable-state's *Write
# discipline*, which an owner skill's §Resuming never sends the session to, and without it a
# resumed conductor hand-writes jq for every transition. The path is relative to the worktree
# root, which the line above names, to leave the 2 KB preview to the state itself.
printf 'Write it with .claude/bin/state (state.py): set, task, inflight, note, claim.\n\n'
if [[ -z "$owner" ]]; then
  printf 'This run has no owning session recorded (no sessionId), and other sessions may share this worktree: claim it per .claude/skills/durable-state/SKILL.md §Resuming step 2 only if it is yours.\n\n'
fi

# The summary is a convenience; the pointer above is the load-bearing part. If state.json does
# not parse, say so and let the session read it directly rather than printing half a summary.
# Only fields that are present are printed, so a standalone tracker does not get a conductor's
# "implModel: unset" lines. An in-progress task outranks the first pending one: it is the one a
# resume must pick up.
#
# Order and size are load-bearing: past ~2 KB the harness persists the output to a file and shows
# only the first 2 KB, which nobody opens. In 185fbc45 all six compact outputs were 15–37 KB
# (mostly `decisionsLog` inlined as a JSON array, though it is meant to be a path). So what the
# resume acts on comes first (open gate, standing instructions, next task, briefs, invariants,
# in-flight entries), the
# descriptive fields after, every free-text
# field is cut to one bounded line, every list to a few entries, and a non-string `decisionsLog`
# prints as a count. `cap` flattens control characters (newlines, ESC, C1, U+2028/9; the class
# uses Oniguruma's `\x{HHHH}`, as jq 1.8.2's `\uHHHH` does not match the code point): a newline
# in a value would otherwise print a line that reads like one of these.
if ! summary=$(jq -r --arg gate_advice "$gate_advice" '
  def known: ["skill","sessionId","phase","goal","branch","base","implModel","reviewModel","decisionsLog",
              "tasks","openGate","inFlight","standingInstructions","invariants","loop","notes","briefs"];
  def cap($n): (if type == "string" then . else tojson end)
    | gsub("[\\x00-\\x1f\\x7f\\x{80}-\\x{9f}\\x{2028}\\x{2029}]+"; " ") | sub("^ +"; "") | sub(" +$"; "")
    | if length > $n then .[0:$n] + "… (cut; Read state.json)" else . end;
  # At most $n entries of a list, each through `f`, while their lines fit in $bytes (the first one
  # always prints), then one line naming how many were left out. A count cap alone let long
  # entries fill the 2 KB preview and push later blocks (the briefs) past the cut, so the lists
  # that can hold long free text also get a byte share. The shares (640 + 400 + 480) plus the
  # fixed lines must stay well under the 1900 bytes resume_budget keeps, or that cut returns.
  def budget($n; $bytes; $prefix; f): [.[] | "\($prefix)\(f)"] as $lines |
    (reduce $lines[0:$n][] as $l ({used: 0, k: 0, full: false};
      if .full then .
      elif .k > 0 and .used + ($l | utf8bytelength) + 1 > $bytes then .full = true
      else .used += ($l | utf8bytelength) + 1 | .k += 1 end)) as $fit |
    $lines[0:$fit.k][],
    (if ($lines | length) > $fit.k then "\($prefix)(\(($lines | length) - $fit.k) more; Read state.json)" else empty end);
  def some($n; $prefix; f): budget($n; infinite; $prefix; f);
  def arr: if type == "array" then . else [] end;
  ([(.tasks | arr)[] | select(.status == "in-progress")] + [(.tasks | arr)[] | select(.status == "pending")] | first) as $next |
  # State written before `invariants` existed: keep printing the rule those two conductors relied on.
  (.invariants // (if .skill == "sdd-loop"
    then ["Every Agent call passes `model` explicitly; the conductor never edits src/ itself."]
    else [] end)) as $invariants |
  "Durable state (from state.json):",
  (if .openGate then "  OPEN GATE: \(.openGate.kind | cap(60)) on \(.openGate.doc // "?" | cap(160))" + (if .openGate.taskId then " (task \(.openGate.taskId | cap(40)))" else "" end) + " — \($gate_advice)"
   else empty end),
  # The share shows about two full-length standing instructions where the count cap showed six;
  # the rest end in the "(N more)" line, and resume step 2 reads state.json in full anyway.
  (if (.standingInstructions | arr | length) > 0 then "  standing user instructions (verbatim):",
     (.standingInstructions | arr | budget(6; 640; "    > "; cap(240))) else empty end),
  (if (.tasks | arr | length) == 0 then empty
   elif $next then "  next task: \($next.id | cap(40)) \($next.title // "" | cap(120)) [\($next.status)]" + (if $next.agentInFlight then " — agent in flight: \($next.agentInFlight | cap(60))" else "" end)
   else "  next task: none pending" end),
  # Before the invariants: after a compaction the briefs on disk are the only copy of the lessons
  # earlier agents needed, while the §Resuming of the owner skill, which the pointer sends the
  # session to, restates its invariants. The byte share of each block keeps long paths from
  # pushing the invariants past the cut, and long invariants from doing it to the briefs.
  (if (.briefs | type) == "object" and (.briefs | length) > 0 then
     "  briefs (Read each before dispatching that role; append new lessons to it):",
     (.briefs | to_entries | budget(4; 400; "    - "; "\(.key | cap(40)): \(.value | cap(160))"))
   elif .briefs != null and (.briefs | type) != "object" then "  briefs: <a \(.briefs | type); Read state.json>"
   else empty end),
  (if ($invariants | arr | length) > 0 then "  invariants of the \(.skill // "owner" | cap(40)) skill:",
     ($invariants | arr | budget(8; 480; "    - "; cap(300))) else empty end),
  (if (.inFlight | arr | length) > 0 then "  in flight before the boundary (check each is still alive):",
     (.inFlight | arr | some(6; "    - "; "\(.kind | cap(20)) \(.id | cap(60)): \(.what // "" | cap(150))")) else empty end),
  "  phase: \(.phase // "unknown" | cap(60))",
  (if .goal then "  goal: \(.goal | cap(200))" else empty end),
  (if .branch or .base then "  branch: \(.branch // "unknown" | cap(100))  base: \(.base // "unknown" | cap(60))" else empty end),
  (if .implModel or .reviewModel then "  implModel: \(.implModel // "unset" | cap(40))  reviewModel: \(.reviewModel // "unset" | cap(40))" else empty end),
  (if .decisionsLog == null or .decisionsLog == false then empty
   elif (.decisionsLog | type) == "string" then "  decisions log: \(.decisionsLog | cap(200))"
   elif (.decisionsLog | type) == "array" or (.decisionsLog | type) == "object" then "  decisions log: <\(.decisionsLog | length) entries; Read state.json>"
   else "  decisions log: <a \(.decisionsLog | type); Read state.json>" end),
  (if .loop then "  loop: \(.loop | cap(200))" else empty end),
  (if (.notes | arr | length) > 0 then "  notes:", (.notes | arr | some(3; "    - "; cap(160))) else empty end),
  ([keys[] | select(. as $k | known | index($k) | not)] as $other |
   if ($other | length) > 0 then "  other keys (Read state.json for them): \($other | join(", ") | cap(300))" else empty end)
' "$state" 2>/dev/null); then
  printf 'state.json did not parse — Read it directly before continuing.\n'
  exit 0
fi
printf '%s\n' "$summary"
} | resume_budget
exit 0
