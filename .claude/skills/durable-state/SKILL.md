---
name: durable-state
description: Keep a run's state in a per-worktree JSON file (`.durable-state/state.json`) that survives compaction, a resumed session, job-dir cleanup and handoff, re-surfaced by a SessionStart hook. Use for long or multi-step runs, anything with background agents/workflows/gates in flight, when the user says "track this", "keep state", "remember where we are", "hand off", or before a `/compact`. Other skills mix it in (sdd-loop) and add their own fields; it also works standalone.
---

# Durable state

A **mixin**, not a workflow. It gives any run one file that says where the run is, what is still
running, and what the user told you, so that after a compaction or a resume you re-orient from
disk instead of from a lossy summary.

Why it exists: after a `/compact` + "carry on", conductors that kept their state only in context
hand-implemented tasks, dispatched agents without templates or `model`, stopped committing, and
ended turns with nothing running (stalls of 6h, 9h, ~44h). A file plus a hook that points back at
it fixed that; prose reminders did not.

## When to use

- A run long enough that it may compact, or that may be resumed in a new session.
- Anything with work **in flight**: background agents, workflows, monitors, open human gates.
- The user asks you to track something across the session, or asks for a handoff.
- A skill you are running says to load this one.

Not for facts git already records (commits, diffs) or scratch that only matters this turn.

## The file

`<worktree>/.durable-state/state.json`, at the **worktree root** (the session's cwd, which is
what the hook receives). It is gitignored: it survives the job dir being cleaned, and never
enters a PR. Companion files an owner skill needs (briefs, say) live in the same directory.

**It is the single source.** No HANDOFF.md / PROGRESS.md / STATE.md beside it. The file records
*where* the run is; git records *what* it did.

**One owner per file.** `skill` names the skill whose §Resuming governs the run. Standalone use
sets `"skill": "durable-state"`. Before writing, check for an existing file: if another skill
owns it and its `phase` is not `done`, don't take it over — put your extra state under a
top-level key you name and leave `skill` alone.

## Generic fields

Every field is optional except `skill`. The hooks ignore keys they don't know, and list them on
resume so you know to read them.

| Field | Meaning |
|---|---|
| `skill` | owner skill name (a directory under `.claude/skills/`) |
| `sessionId` | the session that owns the run, `$CLAUDE_CODE_SESSION_ID`: written on the first write, and rewritten with your own id on every resume or handoff (the owner is whoever resumed). Other sessions share the worktree; the `claude-ops` mod's autocompact treats only this one as the conductor, whatever `skill` says: any run not at `done` with work in flight is compacted when idle over 25 % |
| `phase` | owner-defined string. **`done` is reserved**: the run is finished |
| `goal` | one line: what the run is for. Mostly for standalone use; an owner skill's name usually says it |
| `standingInstructions` | the user's instructions that outlive one turn, **verbatim**, never paraphrased |
| `invariants` | rules of the owner skill that drift after compaction; the hook prints them on every resume |
| `loop` | ≤4 lines: the repeating procedure you are executing |
| `tasks` | `[{id, title, status, …owner fields}]`, `status` ∈ `pending` / `in-progress` / `done` / `blocked-needs-human` / `skipped` |
| `inFlight` | `[{kind: "agent"\|"workflow"\|"gate"\|"monitor", id, what}]`: everything running that will notify you |
| `openGate` | `null` or `{kind, doc, taskId?}`: a human-input surface (plannotator, a review) left open |
| `decisionsLog` | **absolute** path to a decisions log (e.g. autonomous mode's), or `null` |
| `notes` | `[string]`: facts worth surviving a compaction that fit nowhere else ("PR #123 opened", "main was red on X before we started") |
| `briefs` | `{<role>: <absolute path>}`: the standing brief file for each role you dispatch more than once (rule 9). The hook prints them after the next task and before the invariants, which the owner skill's §Resuming restates |

Owner skills add their own fields (branch, base commit, model tiers, …) as further top-level
keys, and say what they mean.

## Write discipline

1. **Write it before the first thing that can outlive the turn** (a background dispatch, a gate,
   the first task), not at the end.
2. **Rewrite it on every transition**: a task dispatched / reviewed / fixed / done; an agent,
   workflow, monitor or gate started or finished; a gate opened or answered; a standing
   instruction from the user; a phase change. Stale state is worse than none: the resume trusts
   it.
3. **Write atomically**, so a crash never leaves half a file. For the common transitions, run
   `state` with arguments only (no stdin, no `$(…)`, nothing chained in front), so the worktree
   guard can read every call; it does the rename, creates the file on first use, and refuses
   another session's run. The `state.py` docstring lists the subcommands:
   ```bash
   state --skill <owner> set phase implement
   state task T03 status=done
   state inflight add agent <id> T04 implementer
   ```
   Anything it doesn't cover goes through jq, still atomically:
   `S=.durable-state/state.json; jq '<filter>' "$S" > "$S.tmp" && mv "$S.tmp" "$S"`. Reads stay
   `jq -r`.
4. **Set-once fields are read back, never re-derived.** A value captured at the start of the run
   (a base commit) is written once; a resume reads it (`jq -r '.base // empty'`). Re-deriving it
   after work has landed silently changes what "the run" covers.
5. **Absolute paths** for anything a hook prints (`decisionsLog`, gate docs): the hook's reader
   cannot assume a cwd.
6. **`inFlight` is a claim.** Add an entry when you dispatch, remove it when its notification
   arrives. `[]` asserts "nothing is running", and autocompact acts on that (it compacts an idle
   conductor only while something is in flight). A missing or non-array `inFlight` means
   "unknown" — omit it if you aren't tracking background work. A subagent that reported "waiting
   on its own background work" has completed, not paused: never hand-add it back; SendMessage it
   to finish that work in the foreground.
7. **`pending` means runnable.** A task blocked on the user is `blocked-needs-human`, and so is
   every task that depends on it, transitively.
8. **Write `phase: "done"` when the run finishes.** A finished run left at another phase makes
   the resume hook re-orient a session that has nothing left to do, and keeps autocompact
   treating the session as a conductor.
9. **A brief you dispatch more than once lives on disk.** For an implementer per task or a
   reviewer, write the brief to a file and name it in `briefs`. It holds the standing
   run-specific context and the lessons accumulated so far; each dispatch still carries its own
   task text (sdd-loop's `references/dispatch-templates.md`, opening rule) and tells the agent to
   read the standing brief first. When you learn something every later agent needs (a
   workaround, a tool path), append it to the brief in the same turn, never only to the next
   prompt: a lesson that lives only in one dispatch prompt is gone after the next compaction, and
   later agents rediscover it the slow way. A brief line that overrides CLAUDE.md, a skill or a
   dispatch template also goes in the run's final report, so the user can fix the source: a brief
   dies with the run. While the override stands, dispatch text cites the brief line and never
   restates the default it overrides.

## Resuming — after compaction, a resume, or a handoff

The SessionStart hook `durable-state-resume.sh` (matcher `compact|resume`) prints, when the file
exists: a pointer to the owner skill's §Resuming, a line naming `state` for writes (*Write
discipline* rule 3), then a summary: what to act on first (open gate, standing instructions, next
task, briefs, invariants, in-flight entries), then phase, goal, branch, models, decisions log,
loop, notes and other keys. It is kept under the harness's 2 KB preview: free text is cut to one
line, long lists end in `(N more; Read …)` (standing instructions, briefs and invariants each
also have a byte share, so one long list cannot push the next out), a non-string `decisionsLog`
prints as `<N entries; Read state.json>`, and past 1900 bytes the rest is cut with a closing line
saying so. Step 2's full Read is what fills those gaps.

1. **Read the owner skill's §Resuming first**, and every file it names for the recorded phase.
   The harness re-attaches an invoked skill only sometimes, truncated, and never its reference
   files. Whatever you remember about the procedure, re-read it.
2. `Read` the state file in full: the hook's summary omits owner fields. `standingInstructions`
   are the user's words and still bind. Then re-claim it, since you are now the owner:
   `state claim` (rule 3), which writes your `$CLAUDE_CODE_SESSION_ID` as `sessionId`.
   Except after a `compact`, which keeps your session id: there a `sessionId` naming another
   session means the run is that session's, not yours: leave the file alone and do not resume it.
3. **Check every `inFlight` entry is still alive.** After a `compact` the process survived and
   background tasks may still be running; after a `resume` (a new process) every one of them,
   gates included, is gone. Drop dead entries; re-dispatch or resume what they were doing.
4. **Re-launch `openGate`** if it is set and its background task is gone. Re-launching a live
   one opens a second copy on the same doc.
5. Continue from the first `in-progress` task, then the first `pending` one.

For standalone use, this section *is* the §Resuming the hook points at.

**Handoff.** When the user asks for one, or says they will `/compact`: rewrite the file now and
give them its absolute path and the owner skill's path. That is the whole handoff.

## Hooks and readers

- `durable-state-resume.sh` (SessionStart, `compact|resume`, registered in
  `.claude/settings.json`): the pointer + summary above. Silent when there is no file. When
  `sessionId` names another session, one line saying so instead; when it is absent, the summary
  adds that no owner is recorded.
- `claude-bin-path.sh` (SessionStart): puts `.claude/bin` on PATH, so `state` runs by bare name.
- The `claude-ops` mod (`.claude/skills/claude-ops/`) reads `phase`, `sessionId`, `inFlight` and
  `standingInstructions` to decide when to auto-compact an idle conductor, and quotes the
  standing instructions verbatim in its compaction instructions. It never writes the file.

Selftests: `python3 -I .claude/skills/durable-state/scripts/state_selftest.py` and
`bash .claude/hooks/durable-state-resume.selftest.sh`.

## Mixing it into a skill

A skill that keeps durable state:

1. Tells the reader to load this skill (`Read .claude/skills/durable-state/SKILL.md`) before
   its first write, and doesn't restate the generic contract.
2. Names its `skill` value, its `phase` values, and its owner fields with their meaning and
   when they are written.
3. Sets `invariants` for the rules its conductors drift on after compaction.
4. Has a **§Resuming** section (the hook points there) saying which files to Read for each
   phase, plus any owner-specific resume steps (a preflight, how to find where a tail stopped).

See `sdd-loop` for a worked example.
