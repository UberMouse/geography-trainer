# idle-compact

A Claude Code mod that compacts the main conversation while it sits idle, so a long
durable-state run (an `/sdd-loop` conductor waiting on its subagents) does not re-read a huge
context on every wake-up. It loads as `idle-compact@skills-dir` when this repo is the session's
primary working directory.

It is the autocompact feature of a larger ops mod, cut down to stand alone: no task registry,
no PR watch.

## Rules

1. **Conductor:** idle, over 25 % context, with a live `.durable-state/state.json` (phase not
   `done`) that names this session and lists something in `inFlight`. The compaction keeps the
   in-flight ids and the run's `standingInstructions` verbatim and says to re-read state.json.
2. **Failsafe** (mode `on` only): any idle session at 75 % or more gets a toast and a 60 s window
   to cancel by typing.
3. **Idle hours** (opt in per session): idle 6 h at 20 % or more.

After an attempt it waits 20 minutes and for 10 points of context growth before the next one.

## Controls

- `/idle-compact` shows what every rule reads right now and why it would or would not act.
- `/idle-compact on|off` switches it for this session; `stale on|off` switches rule 3.
- The global mode (`on`, `conductor-only`, `off`) is the plugin's `autocompact` userConfig:
  `claude plugin configure idle-compact@skills-dir`.

Decisions are logged to the debug log and to `~/.claude/state/idle-compact/trail/<session>.jsonl`.

## Checking it

Copy this build's `claude-code.d.ts` (from the `plugin-authoring` skill's `types/` folder) into
`.claude-plugin/types/` (gitignored), then:

```bash
claude plugin validate .claude/skills/idle-compact
claude plugin test .claude/skills/idle-compact
npx -p typescript@5.9.3 tsc -p .claude/skills/idle-compact
```
