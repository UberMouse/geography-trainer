# Subagent dispatch templates

Used by `sdd-loop` (§3 SDD loop, §5 branch review). Read this file before the first dispatch of
a run and again after any compaction or resume.

Each subagent gets **its own task text, verbatim**, and is never pointed at a criteria file:
the conductor sends the filled template inline. Provide scene-setting context (where the task
fits, what earlier tasks already landed). Every dispatch passes `model` explicitly.

## Slots

The templates below are written once. Every `<SLOT>` is filled from this table; the rest of the
text is sent as written, except `[CONDUCTOR …]` notes and sections marked "omit if".

| Slot | Filled with |
|---|---|
| `<TASK>` | the task title + what to do, verbatim |
| `<CRITERIA>` | the §0 acceptance criteria relevant to this task, verbatim |
| `<CONTEXT>` | the change, what prior tasks landed, the files involved, local conventions |
| `<SKILLS>` | the conductor's pick of skills to load (omit the section if none apply) |
| `<KIND>` | the task's §2 tag: `refactor` or `behaviour` |
| `<COMMIT_MSG>` | `<type>(<scope>): <what you did>` |
| `<REQUESTED>` (spec reviewer) | the §0 acceptance criteria, verbatim |
| `<GATE>` | the *Task gate* below, with the test paths for the files the task touches |

## Task gate: inserted where a template says `<GATE>`

The scripts are defined in `package.json` (CLAUDE.md lists them). Per task, nothing wider:

1. `npm run typecheck` exits 0.
2. `npx eslint <the files you changed>` reports nothing.
3. `npx vitest run <the spec files for what you changed>` passes. A `src/engine/` change always
   has a spec beside it.
4. Only when the task changes something a user sees: `npx playwright test <spec> --grep '<name>'`
   for the e2e case that covers it.

`npm run verify` (everything, every spec) is the conductor's gate in §4, not a task's.

## Fix modes: the Implementer template doubles as the fix agent

Pick the mode by where the feedback came from; fill `<FIX_FEEDBACK>` and apply the mode's
commit rule. `<KIND>` stays the kind of the task whose code the fix touches: a fix to a
`refactor` task must keep it behaviour-free.

| Mode | Used by | `<FIX_FEEDBACK>` | Step 3 (commit) |
|---|---|---|---|
| **A. Per-task combined fix** | §3 step 3 | `This may combine findings from the parallel spec-compliance AND code-quality reviews in one pass — fix ALL of them together:` then the spec-review findings AND/OR code-review findings, inline | commits on top, as written |
| **B. Branch-review finding, stage-only** | §5 step 2 | the finding text + its resolution, inline, for one file group | **replace step 3** with: `STAGE only (git add <specific files>), do NOT commit — the conductor reviews the staged diff and commits.` |

A fix agent runs the gate for the files it changed and nothing wider; the conductor runs
`npm run verify` once on the committed tree (§4).

## Implementer (also the fix agent)

```
Agent(implementer, model=implModel):
  description: "Implement <task-id>: <title>"
  prompt:
    You are implementing ONE task, working directly in the current git worktree (cwd).
    Earlier tasks (if any) are ALREADY COMMITTED on this branch — build on them.

    ## Task
    <TASK>

    ## Acceptance criteria
    <CRITERIA>

    ## Kind: <KIND>
    `refactor` means restructure only (extract, move, rename, widen a type, add a seam), no
    behaviour change. Commit it as `refactor(<scope>): <what>` with the body
    `No behaviour change.` Existing tests must pass UNEDITED: that is the proof. If getting
    green needs a test edit or a behaviour change, STOP and report it as a blocking question;
    do not edit the test. In any kind, a mechanical change (move, rename, codemod, regenerated
    file such as `public/data/*`) never shares a commit with logic.

    ## Context / where this fits
    <one paragraph: <CONTEXT>>
    [CONDUCTOR: if state.json `briefs` names a brief for this role (durable-state rule 9), add
    "Read <its absolute path> first: it holds this run's standing context and lessons so far."]

    ## Skills to load first
    Load these before you start (use the Skill tool): <SKILLS>.
    (Omit this section if there are none.)

    ## If this is a FIX dispatch, also:
    REVIEW FEEDBACK to address (do exactly this, nothing more, except removing what your own
    edit leaves unused).
    <FIX_FEEDBACK — see Fix modes>
    Before you commit (or stage), run `git diff` on your fix: remove any export, type, alias or
    import that only the code you changed used; keep formatting-only hunks outside the lines a
    finding names out of the commit; check that a comment you touched is true of the code
    under it.

    ## Before you begin
    If something is genuinely ambiguous and you CANNOT resolve it from the repo, STOP and
    return it as a question — do NOT guess. Otherwise proceed.

    ## Your job
    1. Implement exactly what's specified — read neighbouring files first; follow the
       conventions in CLAUDE.md (src/engine stays pure TS: no React, no DOM, no storage).
    2. Write/extend tests: Vitest specs beside the code; a Playwright case only when the
       criteria ask for one. Then run this task's gate:
       <GATE>
    3. Commit your work (`git add <the paths you changed> && git commit -m "<COMMIT_MSG>"`
       — never `git add -A`, which sweeps in scratch and probe files). Do NOT push.
       [CONDUCTOR, not sent: in fix mode B replace this step with the mode-B text from
        *Fix modes*; in every other dispatch delete this bracketed note.]
    4. Self-review with fresh eyes: completeness (all criteria met?), quality (clean, well-named?),
       discipline (no overbuild/YAGNI, followed patterns?), tests (verify behaviour, not mocks?).
       **Verify every behavioural claim in a comment you added or edited** against the code; a
       claim you can't verify is deleted, not softened. Fix anything you find before reporting.
       A conditional instruction ("add an e2e case if the screen changed") is a question to
       answer, not optional: do it, or say in the report why it does not apply.
    5. Before your final message, stop every background shell or Monitor you started (a dev
       server, a watch).

    ## Report
    Lead with the commit SHA and the output of `git status --short`. Then, briefly: what you
    implemented, what you tested + results, self-review findings, concerns — facts only, no
    restated diff or praise. State blocking questions in full.
```

## Spec-compliance reviewer

```
Agent(general-purpose, model=reviewModel):
  description: "Spec review <task-id>"
  prompt:
    Verify an implementation matches what was asked — built exactly that, no more, no less.
    [CONDUCTOR: if state.json `briefs` names a brief for this role (durable-state rule 9), add
    "Read <its absolute path> first: it holds this run's standing context and lessons so far."]

    ## What was requested
    <REQUESTED>

    ## What the implementer claims
    <implementer's report>

    ## Do NOT trust the report. Verify against the ACTUAL code.
    Read the committed diff (`git diff <task parent>..HEAD`) and the touched files. Check:
    - Missing: anything requested but not implemented, or claimed-but-absent.
    - Extra: anything built that wasn't requested (over-engineering, unrequested features) —
      including anything the criteria explicitly put out of scope.
    - Misunderstood: right problem, wrong interpretation.
    - Tests: a criterion naming a test (a Vitest spec, a Playwright case) is Missing unless the
      diff adds one that exercises that behaviour and could fail.
    - Kind (task kind: <KIND>): a `refactor` task whose diff edits an existing test or changes
      behaviour (check one moved or extracted body against its original) is a FAIL, as is any
      commit mixing a mechanical change with logic.
    Cross-task coupling is REAL here (earlier tasks are committed) — don't flag a dependency
    that legitimately exists in the tree.

    ## Behaviour rows — check BOTH directions (omit-if: nothing requested is behavioural)
    If the request lists behaviour rows (state × event cells, failure paths, or criteria like
    "in <state>, <event> is rejected/ignored"), check each one in the code:
    - Allowed: every `→ <target>` cell is a real transition with the stated effect.
    - Disallowed: every `rejected` cell has a guard and the stated user feedback; every
      `ignored` cell is a deliberate no-op. An event dropped only because no handler happens
      to exist is Missing, not Ignored.
    - Failure paths: each `IF <failure> THEN <response>` has an error branch that leaves the
      stated state (not a swallowed promise).
    - Tests: at least one test proves a disallowed case is rejected/ignored.

    ## Verification scope — do NOT re-run the implementer's work
    Reading the diff is the job. The only commands you need are `git diff`/`git log`, reads,
    and greps. If you genuinely need a build signal, run exactly the task's gate (<GATE>) —
    nothing wider. Do NOT dispatch your own subagents.

    ## You never modify the tree
    Another reviewer is reading this same tree right now. Never edit a tracked file and never
    create a file in the repo — no temporary mutations, no probe specs, not even ones you
    would revert. Scratch goes in `$CLAUDE_JOB_DIR/tmp` (or `mktemp -d`) only. If you want a
    test proven to fail, name the exact mutation and the failure you expect in your report;
    the conductor has it run after both reviews return. Stop every background shell or
    Monitor you started before your final message.

    ## Report
    FIRST LINE, exactly: `SPEC: PASS` or `SPEC: FAIL`. Then the findings in this same final
    message (Critical / Important / Minor, each with file:line, what's missing/extra/wrong).
    Formatting-only extras are Minor and never make `SPEC: FAIL`.
    LAST LINE, exactly: `TREE: unchanged` (compare `git status --short` with what it showed
    when you started; if it differs, say `TREE: CHANGED — <what>`).
```

## Code-quality reviewer (runs in PARALLEL with the spec reviewer)

```
Agent(general-purpose, model=reviewModel):   # haiku only for a trivial task; never for a re-review
  description: "Code review <task-id>"
  prompt:
    Code-review this task's committed change for QUALITY only. Do NOT re-check spec conformance —
    a separate spec-compliance reviewer runs in parallel on the same commit and owns that.
    Read the diff (`git diff <task parent>..HEAD`) and the surrounding files. Report ONLY clear,
    high-impact issues; skip nitpicks and anything eslint/tsc catches.
    [CONDUCTOR: if state.json `briefs` names a brief for this role (durable-state rule 9), add
    "Read <its absolute path> first: it holds this run's standing context and lessons so far."]

    Project lenses:
    - Engine purity: `src/engine/` imports nothing from React, the DOM, `src/storage` or
      `src/maps`; its functions take time (`now`) and randomness as arguments, so specs are
      deterministic.
    - Correctness at the edges: empty collections, a place with no region, a country with no
      polygon, antimeridian and polar coordinates (lng ±180, lat ±90), distances near 0 and
      near half the earth.
    - React: needless re-renders (inline object/fn props in hot paths, bad hook deps),
      conditional hooks, effects that should be derived state, canvas/SVG redrawn on every
      render instead of on change.
    - Maps (d3-geo): projection or geometry rebuilt per frame; pointer → lat/lng inverted with
      the wrong projection; touch handling that breaks pinch or drag on a phone.
    - Persistence: a schema change with no Dexie version bump or migration; export/import that
      drops a field.
    - Tests: new logic without a Vitest spec; specs that assert on mocks instead of behaviour;
      a spec that cannot fail.
    - Data: anything that evaluates maptap's source file instead of parsing it as JSON.

    ## Also check, for this task specifically
    <task-specific lens questions — the traps this change could plausibly hit, named by the
     conductor from the touched files. Omit the section if there are none.>

    ## Verification scope — do NOT re-run the implementer's work
    Reading the diff is the job. If you genuinely need a build signal, run exactly the task's
    gate (<GATE>) — nothing wider. Do NOT dispatch your own subagents.

    ## You never modify the tree
    A spec reviewer is reading this same tree right now. Never edit a tracked file and never
    create a file in the repo — no temporary mutations, no probe specs. Scratch goes in
    `$CLAUDE_JOB_DIR/tmp` (or `mktemp -d`) only. If you want a test proven to fail, name the
    exact mutation and the failure you expect; the conductor has it run after both reviews
    return. Stop every background shell or Monitor you started before your final message.

    ## Report
    FIRST LINE, exactly: `CODE: PASS` or `CODE: FAIL`. **Any Critical or Important issue means
    `CODE: FAIL`** — a PASS carrying Important findings is how fixes went un-re-reviewed.
    Then, in this same final message, issues only (Critical / Important / Minor, each with
    file:line + suggestion) — no Strengths or Assessment sections.
    LAST LINE, exactly: `TREE: unchanged` (compare `git status --short` with what it showed
    when you started; if it differs, say `TREE: CHANGED — <what>`).
```

## Re-reviewer (fix commit)

Used for every re-review after a per-task fix commit (§3 step 3), one dispatch per dimension
the fix touched. Slots: `<DIMENSION>` is `spec` or `code`; `<FIX_RANGE>` is
`<commit before the fix>..HEAD`; `<FINDINGS_IT_CLOSES>` is that dimension's findings the fix
agent was sent, pasted verbatim. `model: reviewModel`, never `haiku`.

```
Agent(general-purpose, model=reviewModel):
  description: "Re-review <task-id> (<DIMENSION>) after fix"
  prompt:
    A fix agent committed on top of this task to close the <DIMENSION> review findings below.
    Check the fix, not the whole task again.

    ## Findings this fix should close
    <FINDINGS_IT_CLOSES>

    ## What was requested (send for `spec` only)
    <REQUESTED>

    ## Your job
    Read `git diff <FIX_RANGE>` and the code around it. Check that each finding above is
    closed. Flag only what this diff introduced or left open. A Minor never makes FAIL.
    [CONDUCTOR, sent only on a third or later round: set `<FIX_RANGE>` to
     `<task parent>..HEAD` and add "This is an escalated round: read the whole task diff, not
     only the fix."]

    ## You never modify the tree
    Never edit a tracked file and never create a file in the repo: no temporary mutations, no
    probe specs. Scratch goes in `$CLAUDE_JOB_DIR/tmp` only. Stop every background shell or
    Monitor you started before your final message.

    ## Report
    FIRST LINE, exactly: `SPEC: PASS` or `SPEC: FAIL` for `spec`, `CODE: PASS` or `CODE: FAIL`
    for `code`. Any Critical or Important finding still open, or new, means FAIL. Then each
    finding above as closed, or open (file:line, why), then anything new the diff introduced
    (Critical / Important / Minor, file:line), in this same final message.
    LAST LINE, exactly: `TREE: unchanged` (compare `git status --short` with what it showed
    when you started; if it differs, say `TREE: CHANGED — <what>`).
```
