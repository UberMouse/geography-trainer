---
name: sdd-loop
disable-model-invocation: true
description: Run a small, already-understood change through the subagent-driven-development review loop end to end, with no artifact-review gates. You ASK whatever you need to pin the ask down, restate it as acceptance criteria, implement it (usually as ONE task) via a fresh subagent, review each task with a spec-compliance and a code-quality reviewer IN PARALLEL, fix-forward until both are clean, then run the branch code review, fix what it confirms, decide what it only suspects, and ship the branch (a PR when the repo has a GitHub remote). In this repo a run starts from an edit to the spec (`spec/`): the scenarios and contract entries it adds or changes are the acceptance criteria, and the tests that land cite their IDs.
---

# SDD Loop (lightweight, ungated)

Subagent-driven development without a planning pipeline: no approach gate and no plan. The
change is pinned down as an edit to the repo's spec (`spec/`, format in `spec/README.md`), which
becomes the acceptance criteria. You take the ask, edit the spec, implement it under
subagent-driven development, let the independent reviewers converge, and hand back a reviewed
branch whose tests trace to the spec.

> **Ungated does not mean silent.** What's removed is *artifact* review: you never hand the user
> a plan, a spec, or a report and wait for approval. **Asking questions is not a gate; ask
> freely**, especially at intake (§0), where you derive the criteria the whole loop is judged
> against. Get the ask wrong there and every downstream reviewer faithfully validates the wrong
> thing. A question costs one round-trip; a wrong spec costs the whole run.

**Core principle:** a change is done not when it works, but when a reviewer that did not write
it, reading the real committed tree, cannot find anything wrong with it.

**Announce at start:** "Using the sdd-loop skill — implementing this under subagent-driven
development with autonomous review. I'll ask up front if anything's ambiguous, then run without
planning gates."

```
  0. Intake        ASK what you need ─► EDIT spec/ (or take the user's edit) ─► ACCEPTANCE
                     CRITERIA = the spec diff + tracing ─► one COLD READ by an agent without
                     this conversation
  1. Setup         worktree + preflight (clean tree, rebase on main while nothing has landed,
                     npm ci if the lockfile moved, verify green); record BASE + branch; state.json;
                     commit the spec edit first, as `docs(spec): …`
  2. Split         DEFAULT: one task. Split only if genuinely separable (2-4, primitives-first);
                     each tagged refactor | behaviour, refactors first
  3. SDD loop      per task, sequentially:
                     implement ─► ⟨spec-review ∥ quality-review⟩ ─► one combined fix
                       ─►(re-review what the fix addressed)*─► task done, committed
  4. Verify        `npm run verify` exits 0
  5. Branch review /code-review high on the branch ─► fix every CONFIRMED finding
                     ─► decide every PLAUSIBLE one (fix / skip) ─► re-verify ─► screenshots
  6. Ship          commit; PR (ready, not draft) when a GitHub remote exists, else
                     fast-forward local main to the branch yourself; report
```

## When to use

- A spec edit (new or changed behaviour), a bug fix, small feature, or refactor you already
  understand.
- You want the SDD quality bar (independent spec + quality review, fix-forward) without
  sitting through gates.
- Long unattended runs: the questions are front-loaded at §0, so once answered the loop runs to
  the end without stopping again.

## When NOT to use

| Situation | Use instead |
|---|---|
| Real design decisions, competing approaches | Plan mode first (`EnterPlanMode`), then this loop per step |
| Code is already written; you just want it reviewed | `/code-review` directly |
| A typo, a comment, a version bump | Just edit it. Three subagents to fix a typo is theatre. |

If mid-loop the work turns out to need genuine design work, do **not** silently keep going; see
*Escape hatch*.

## Prerequisites

- **A git worktree on a dedicated feature branch.** Every task commits there. If you are not
  under `.claude/worktrees/`, enter one (`EnterWorktree`) before §1.
- `npm ci` has run in the worktree (a fresh worktree has no `node_modules`).
- Human input comes through `AskUserQuestion`, or the Plannotator Inbox when the user keeps
  one (a `:::question` per decision, then keep working).

## State you carry

| Field | Meaning |
|---|---|
| `criteria` | the acceptance-criteria list from §0 — the spec every spec-review checks against |
| `tasks` | usually one; each with title, `kind`, criteria slice, files, skills |
| `BASE` / `branch` | the commit + branch you implement on |
| `implModel` | `sonnet` default; `opus` for a genuinely hard change |
| `reviewModel` | `sonnet` default; `haiku` for a trivial task, never for a re-review |

**Persist it** as durable state in `<worktree>/.durable-state/state.json`. **Read
`.claude/skills/durable-state/SKILL.md` before the first write**: it owns the generic contract
(write discipline, `inFlight`, `standingInstructions`, `decisionsLog`, `phase: "done"`, the
resume hook, handoff). What sdd-loop adds:

- **`skill`**: `"sdd-loop"`. **`phase`**: `implement` (§1–§6) → `done` (after §6). There is no
  marker between them; §Resuming finds the tail from git.
- **Owner fields**: `base` (set-once, §1), `branch`, `implModel`, `reviewModel`, and
  `screenshots` (§5; empty only for a change with no visible UI).
- **`tasks[]`** entries add `commit`, `spec`/`code` verdicts, `deferredMinors`, `fixRounds` and
  `agentInFlight`.
- **`criteria`**: the §0 list verbatim, written once after §0d with
  `state set criteria '<JSON array of strings>'`, so the criteria survive compaction. It is the
  conductor's copy; agents still get the criteria inline, never as a file.
- **`invariants`**: the three under §Resuming step 3, one line each.
- Rewrite `state.json` on every task transition (dispatched, reviewed, fixed, done), keeping
  `tasks[]` verdicts, `fixRounds`, `agentInFlight` and `inFlight` accurate. Every background
  agent goes in `inFlight` (`state inflight add agent <id> <what>`) and comes out when its
  notification arrives: the `idle-compact` autocompact mod compacts an idle conductor only while
  something is listed there.

## Resuming — after compaction, a resume, or a handoff

After compaction the harness may re-attach this skill truncated, or not at all. Whatever you
remember about the loop, re-read it:

1. `Read` this file's §3 (the loop) and `references/dispatch-templates.md` beside it, then
   follow `.claude/skills/durable-state/SKILL.md` §Resuming (Read `.durable-state/state.json`;
   check `inFlight`). Its `standingInstructions` are the user's words and still bind; its
   `criteria` are the spec.
2. Run the §1 **preflight** (it runs on every resume), then continue from the first task that is
   not `done`. A task whose `agentInFlight` died on an API error: see §3 step 1. If every task
   is already `done`, `Read` §4–§6 too. Find where the tail stopped from durable evidence:
   - A GitHub remote and `gh pr list --head "$BRANCH" --json number` returns a PR, or no remote
     and `git merge-base --is-ancestor "$BRANCH" main` succeeds (main already fast-forwarded)
     → §6 already ran; give the report if a `notes` entry doesn't say it was given, and write
     `phase: "done"`.
   - A staged but uncommitted diff → a §5 fix group stopped mid-review; do §5 step 3 on it first.
   - Otherwise re-run §4, then §5 from the start. Both are safe to repeat: `fix(review): …`
     commits already on the branch are earlier groups that landed, and the fresh review sees them.
3. Invariants that have drifted after compactions:
   - **The conductor never edits `src/` (or `scripts/`, `public/data/`) for a task or a
     finding.** Implementers and fix agents do; a hand-implemented task skips both reviews.
     Conversely, only the conductor edits `spec/`, and the spec edit is the branch's first commit.
   - **Every Agent call passes `model` explicitly** (`implModel` / `reviewModel`). An omitted
     `model` inherits the conductor's model.
   - Every dispatch uses the templates (FIRST LINE verdicts; implementers commit their own work).

**Handoff**: per `durable-state` (rewrite `state.json` now; give its absolute path and this
skill's path).

---

## 0. Intake — ask, edit the spec, then write the acceptance criteria

The repo's spec (`spec/`: L0 product, L1 Given/When/Then scenarios in `features/`, L2 contracts
with every constant's value in `contracts/`; `spec/README.md` has the format) says what the app
does today. **A change is an edit to it, and that edit is what this run implements.** Without it
the spec-compliance reviewer has nothing to check against and degenerates into a second code
review.

That makes this the **highest-leverage step in the loop**, and the only one where a human is
cheap to consult. Everything downstream faithfully executes whatever you write here.

### Start from the spec

Read the spec files the change touches (the area's `features/` and `contracts/` files, and the
L0 item above them) before anything else. Then find which case this run is:

- **The user edited `spec/` already** (uncommitted, or committed on the branch): that diff is
  the change. Check it follows `spec/README.md` (IDs, `Up:`, one gherkin block, outlines for
  tables) and ask, at §0b, only about what it leaves open.
- **The user described the change**: after §0a and §0b, **write the spec edit yourself**.
  Change scenarios and contract values in place, keeping their IDs. Add new entries with the next
  free ID in the area, each with its `Up:` link. Retire removed entries by deleting them; an ID
  is never reused. New behaviour states its edge cases as scenarios (§0c's *Stateful change*
  rows belong in the spec, not only in the criteria). New constants go in the area's contract
  with their values.
- **A bug where the spec already says the right thing** (the code disagrees with a scenario):
  no spec edit. The criteria cite the existing ID, and the fix's test must fail before the fix.
- **A refactor**: no spec edit. The criteria say "no file under `spec/` changes, and every
  existing test passes with its title and logic unedited".
- **A change the spec doesn't cover at all** (a new area or L0 promise): add the L0 item and the
  area file in the same edit. A new L0 promise is a product decision: ask the user (§0b), or
  under autonomous mode log it needs-review.

You (the conductor) write `spec/`; implementers never edit it. The edit is committed as the
branch's first commit (§1), before any implementer dispatch.

### 0a. Read the code first

Read the files the ask touches **before** asking anything. Most apparent ambiguities dissolve on
contact with the code: an existing convention, a neighbouring function that already answers it,
a single obvious call site. Questions you could have answered by reading are noise, and they
train the user to stop reading your questions.

### 0b. Ask what's actually load-bearing

Then **ask whatever survives.** You are pinning down the ask, not asking permission. Batch it
into one call (up to 4 questions, options with real trade-offs in the descriptions) so it's a
single interruption.

**Ask when** two readings of the ask would produce **materially different code**:

- Scope boundaries: "show progress" — one screen, or every screen that lists places?
- Behaviour at edges the ask didn't mention: empty state, a place with no region, a country
  with no polygon, what happens to existing saved progress.
- An intentional-looking oddity in the code you'd otherwise "fix"; it may be load-bearing.
- Migration/compat: does existing saved progress (IndexedDB, an export file) need handling, or
  is a clean break fine?
- Which of two established patterns applies, when both are live and the choice sticks.

**Don't ask; decide and note it** when the answer is conventional, cheap to change, or the repo
already votes:

- Naming, file placement, test-file location, whether to extract a helper.
- Anything a neighbouring file already demonstrates.
- Anything where you'd recommend one option and the other is nobody's real preference.

For these, pick the repo-conventional option and write it into the criteria as an explicit
`**Assumption:**` line. The user sees it in the criteria echo and the final report; if it's
wrong they say so, at the cost of one line instead of a round-trip.

**If the ask is a one-liner with no real ambiguity, ask nothing.** The test: would a wrong guess
cost more than the interruption?

> **Under autonomous mode** (if the user's `autonomous-mode` skill is installed and on): decide
> each question yourself, write it into the criteria as an `**Assumption:**` line plus a
> decisions-log entry marked needs-review; a question that would trigger the escape hatch is a
> hard stop, per that skill.

### 0c. Write the criteria

The criteria are the spec diff plus its tracing. List every entry the edit adds, changes or
retires, **verbatim with its ID**, then the lines that hold the code and tests to it:

```
## Acceptance criteria
- [ ] SES-14 (new): <the scenario, verbatim>
- [ ] GRD-C02 (changed: Good < 75 km → < 60 km): <the entry, verbatim>
- [ ] CUR-07 (retired): no test cites it; the behaviour it described is gone
- [ ] Every new or changed ID is cited by a test that exercises it and fails without the change
      (a Vitest spec; a Playwright case for <the user-visible path> — or: no e2e, because <reason>)
- [ ] `npm run spec:check` exits 0
- [ ] **Assumption:** <anything you decided for the user>
- [ ] No change to <thing explicitly out of scope>; the scenarios it is pinned by stay unedited
```

Rules:

- **The spec entry is the criterion; don't paraphrase it.** If a criterion needs words the spec
  doesn't have, the spec edit is incomplete: put the words in the spec.
- **Implementation pointers are allowed** (`<symbol>` in `<file>`), where the code makes the
  change land in one obvious place, but as additions under the spec lines, never instead of them.

- **Keep it to what the user asked for.** Improvements you noticed go in the final report's
  *Follow-ups*, not the criteria.
- **Include an explicit out-of-scope line** when the ask has an obvious adjacent temptation, so
  the spec reviewer can flag over-building as a defect rather than a bonus.
- **Include the test criteria, one per tier.** Engine logic gets Vitest specs (deterministic:
  time and randomness passed in). The e2e line is always present: a change a user can see or
  tap names the Playwright case and its happy path; anything else records why there is none
  ("no e2e: engine only").
- **Fold the answers in.** Every §0b answer that is behaviour belongs in the spec edit, and so
  in this list; an answer that isn't behaviour (a file location, an approach) is an
  `**Assumption:**` line. That is what makes it enforceable. An answer you merely remember is one
  no reviewer can check.
- **Stateful change? Write criteria for the states it doesn't mention too.** When the change
  adds or alters an event or step in a multi-step flow (a session, a placement test), list each
  state the event can arrive in, not just the one the ask is about. Mark each one handled,
  ignored on purpose, or rejected with what the user sees. Also give the failure path
  (`IF <storage write fails> THEN <state + message>`):
  ```
  - [ ] `answer` while the reveal is showing: ignored (no double grading)
  - [ ] `skip` on the last card: ends the session, summary shown
  - [ ] IF the IndexedDB write fails THEN the answer is kept in memory and a retry banner shows
  ```

### 0d. Cold-read the criteria

You wrote the criteria with the whole conversation in your head, and every agent downstream gets
only the list. Whatever you knew and did not write down, the implementer guesses and the spec
reviewer cannot check. So before the first dispatch, have one agent that has **not** seen this
conversation read the list and say what it would have to guess.

Run §1's preflight first: it can rebase the branch, and the reader's `file:line` evidence has to
come from the tree the implementer will get. Then dispatch ONE read-only `general-purpose` agent
(`model: reviewModel`, explicitly) with the criteria **verbatim inline**, the worktree's absolute
path, and nothing else from the conversation: no ask, no summary, no answers from §0b. If the
list needs those to make sense, that is the finding. Brief:

```
You are about to be handed these acceptance criteria to implement in <worktree absolute path>.
You have no other context and cannot ask the author anything. Read the code the criteria name
(send the reads and searches you already know you need as parallel tool calls in one turn).
Do NOT implement, edit or review the approach, and do NOT propose extra work.

List only what you would have to GUESS to implement this, each as one line:
- the criterion (quote it), and what is undetermined: a term or reference the list never
  defines, two readings that produce different code, or a state / error / empty / existing-data
  case the list is silent on and the change must pick a behaviour for;
- `repo answers: <file:line>` when the code settles it, else `repo silent`.

FIRST LINE: `CLEAR` (nothing to guess) or `GAPS: <n>`.

<criteria, verbatim>
```

Then triage each gap, once. This is one read, not a loop: do not re-dispatch after editing.

- **`repo answers`**: reword the criterion so it says what the code already settles.
- **`repo silent`, and §0b's test says ask** (two readings, materially different code): one more
  question batch, and fold the answers in.
- **`repo silent`, conventional or cheap to change**: an `**Assumption:**` line.
- **Asks for more than the ask**: drop it. The cold reader does not widen scope.

**Skip it** only when §0b had nothing to ask and the list carries no `**Assumption:**` line: a
one-liner with nothing to guess gains nothing from a fourth agent.

A gap that is behaviour goes into the spec edit (and so into the list), never only into the
criteria.

**Echo the criteria to the user as narration, then keep going; do not wait for approval.** You
asked your questions in §0b; now you report what you concluded, without requesting sign-off. If
they disagree they'll say so; the loop doesn't stop to find out.

The criteria are passed **verbatim inline** to every subagent. The state.json copy is for you
after a compaction; never point an agent at it.

## 1. Setup

Confirm the tree is clean. **If it is dirty, stop and reconcile**: implementing on top of an
unknown state makes every downstream review diff meaningless. The one exception is the user's
own uncommitted edit confined to `spec/` (§0 *Start from the spec*): commit it on the branch
first, as below, and then run the preflight.

**Preflight — here AND on every resume.**

```bash
git status --short                                  # must be empty
git remote                                          # empty ⇒ no remote: skip the fetch lines
OLD=$(git merge-base HEAD main)                     # capture BEFORE any rebase
git fetch origin main && git rev-list --count HEAD..origin/main    # (remote only) how far behind
git diff --name-only main...HEAD                    # nothing ⇒ no task code yet: rebase now
git rebase main                                     #   (origin/main with a remote)
git diff --name-only "$OLD" main -- package-lock.json   # any hit ⇒ npm ci
npm run verify                                      # must exit 0 before any task is dispatched;
                                                    #   red on main ⇒ stop and report: not this run's to fix
# BASE is set ONCE, on the first run; a resume reads it back. Re-taking HEAD after a task has
# committed would drop that task from the §5 branch review.
jq -r '.base // empty' .durable-state/state.json   # a sha: that is BASE. Nothing (or no file):
git rev-parse HEAD                                  #   this is BASE; record it, its own call:
state --skill sdd-loop set base <sha>               #   creates the file as {skill, sessionId}
git rev-parse --abbrev-ref HEAD                     # BRANCH
```

**The spec edit is the branch's first commit**, `docs(spec): <what changes>`, made by you after
the preflight and before the first dispatch, on its own (no code). When a spec edit is already
committed or in the tree as the preflight runs, `npm run verify` stops at its first step,
`spec:check`, and that is expected. Run `npm run spec:check` and confirm its only errors are
"not cited by any test" for the IDs the edit adds or changes, and "unknown ID" for tests citing
IDs it retires. Then run the rest of the checks
(`npm run typecheck && npm run lint && npm test && npm run test:e2e`) as the green baseline.
Any other spec:check error means the edit is malformed: fix the edit.

Once task code is on the branch, do not rebase unprompted; report the behind-count instead.
Write the rest of state.json with `state`, one call per field, arguments only (durable-state
*Write discipline* rule 3): `state set phase implement`, `state set branch <branch>`,
`state set implModel sonnet`, `state set reviewModel sonnet`,
`state set invariants '["…", "…", "…"]'` (a JSON value is stored as JSON), and
`state task T01 status=pending title=…` for each task.

## 2. Split only if you must

**The default is ONE task.** A small change reviewed as one commit gives the reviewers a diff
they can hold in their heads; that is the whole advantage of the lightweight loop.

Split into 2-4 tasks only for genuinely separable units, e.g. a shared type or module that later
work consumes, or two independent files with no interaction. Order **primitives-first**:
whatever creates a shared symbol lands before its consumers.

**Tag every task `refactor` or `behaviour`.** A restructure the change needs (extract, move,
rename, widen a type, add a seam) is always its own `refactor` task, first, even when that is
the only reason to split; it changes no behaviour and its existing tests pass unedited.
Mechanical changes (a regenerated `public/data/`, a codemod) never share a task with logic, and
deleting replaced code is its own task once its last consumer has moved.

No task document, no planner, no gate. Wanting five or more tasks is the signal the step is too
big for one run (see *Escape hatch*).

Create a task list (`TaskCreate`) with the task(s).

## 3. The SDD loop

Run tasks **strictly sequentially**. Each task edits the real worktree and commits; git on disk
is the durable state.

1. **Dispatch the implementer** (`Agent`, `implementer`, `model: implModel` — explicitly)
   with the *Implementer* template from `references/dispatch-templates.md` (Read it before the
   first dispatch). It implements the task, runs the task gate, **commits**, and self-reviews.
   Record it in state.json (`in-progress`, `agentInFlight`, and `inFlight`).
   - If it returns a **blocking question**, route it to the user and re-dispatch with the
     answer. Do not answer on the user's behalf when the answer is a real decision; equally,
     don't escalate a choice the repo already answers.
     > **Under autonomous mode:** decide it yourself per that skill — the recommended option, a
     > decisions-log entry — and re-dispatch. A question that is a hard stop there marks the
     > task `blocked-needs-human` instead, with every task that depends on it. Then continue
     > with the next runnable `pending` task; one blocked task does not end the run.
   - A **`refactor` task that needs a test edit or a behaviour change** to go green has found
     behaviour: split that part into a `behaviour` task after it and re-dispatch the refactor
     without it. Never re-tag it to make the test edit pass.
   - **An agent that died on an API error** (529/500): check `git status --short` and
     `git log -1`. It left edits ⇒ resume that same agent with `SendMessage`; it left none ⇒
     re-dispatch from the template.
2. **Review in PARALLEL.** Dispatch BOTH reviewers **in a single message** against the SAME
   commit, each with `model` passed explicitly. Add both to `inFlight`; remove each when its
   notification arrives. Neither modifies the tree, so they cannot conflict and there is no
   spec-before-quality ordering:
   - **Spec-compliance reviewer** (`reviewModel`): checks the committed code against the §0
     criteria: missing, extra, or misunderstood, and whether the task's `kind` is honest (a
     `refactor` that edits a test or behaviour fails).
   - **Code-quality reviewer** (`reviewModel`, `haiku` for a trivial task, never for a
     re-review): quality only.
   - **Falsification.** A reviewer that wants a test proven to fail names the exact mutation and
     the expected failure; it never applies it. Have it run only after BOTH reviewers have
     returned, by the next fix agent or by an `isolation: "worktree"` agent. Never ask a
     reviewer running in parallel to mutate code.
3. **Converge.** A dimension is **flagged** if it returned FAIL, or PASS with any finding you send
   to a fix agent. **A PASS whose findings are all Minor closes the task**: record the Minors
   in the task's state.json `deferredMinors` and hand them to §5's fix agent for their file
   group. Send a Minor to a fix agent in the loop only when (a) the next task copies or builds
   on that code, or (b) you re-grade it Important because it is a test that cannot fail or a
   wrong answer from the deliverable. If either dimension flagged, dispatch **ONE combined fix
   agent** (Implementer template, fix mode A, `model: implModel`) carrying *both* finding sets,
   so a single pass closes spec and quality gaps together. Add it to `inFlight`; remove it when
   its notification arrives. It commits on top. Then **re-run each review the fix addressed**,
   with the *Re-reviewer (fix commit)* template: every fix commit is re-reviewed by every
   dimension whose findings it touched; a dimension that came back clean and wasn't touched
   drops out. Repeat until no review that ran most recently has an open Critical or Important
   finding.
   **You never apply an in-loop fix yourself**: a conductor edit counts as a fix round and still
   gets re-reviewed. (*When NOT to use*'s "just edit it" is about whether to run this loop at
   all, not an exception inside it.)
4. **Close the task and start the next one in the same turn.**
   - Record the task in state.json: `done`, commit, `spec`/`code` verdicts, `fixRounds`,
     `agentInFlight` cleared. A task not implemented and reviewed through this loop is
     **UNREVIEWED**: run its reviews before moving on, or tell the user. §6's report is written
     from these records, so they must be true.
   - **Dispatch the NEXT task's implementer in the SAME turn as any progress note**, and add it
     to `inFlight`. A turn that ends with tasks left and no Agent in flight is a **stall**.

**Rules — do not break these:**

- **Only ONE agent edits the tree at a time**: never two implementers, never two fix agents.
  The two *reviewers* run concurrently only because they never modify it: no edits to tracked
  files, no new files in the repo, no temporary mutations, no probe specs.
- **The conductor never edits `src/` for a task or a finding**, and **every Agent call
  passes `model` explicitly**.
- **Implementers never edit `spec/`.** If the spec can't be built as written, or the tests show
  it describes something other than what the user meant, the implementer stops with a blocking
  question. A spec change mid-run is the conductor's: it is a new `docs(spec): …` commit, the
  criteria are updated from it, and the user hears about it in the report.
- **Never skip a review, never proceed with open Critical or Important findings.** The task is
  done when neither dimension has one open (its Minors deferred per §3 step 3), not when the
  code runs.
- **Re-review is targeted, not blanket**: a clean dimension the fix didn't touch is trusted to
  stay clean. §5 is the backstop that sees the whole branch.
- **Fix-forward only.** Fix agents commit on top; never rewind a prior task.
- **Git-on-disk is the state.** Commit every task. Dirty or inconsistent tree at task start ⇒
  stop and reconcile.
- **Scope discipline.** Tech debt found along the way goes in the final report's *Follow-ups*,
  not extra commits.

## 4. Verify

```bash
npm run verify   # typecheck + lint + vitest + playwright; must exit 0
```

Run it through the `build-and-test-runner` subagent (`model` explicit) when you want the output
read for you; dispatch it from the worktree and put the worktree's absolute path in the prompt.

Do not proceed to §5 with a red build; the branch reviewers would waste their pass reporting
symptoms of a broken tree.

## 5. Branch review — fix what it confirms, decide what it suspects

The per-task reviews saw one task each. This is the only pass that sees the change **as a
whole**, which is where cross-task coupling bugs live. It is not optional, and it runs for a
one-task run too.

Run the built-in review on the branch, from the worktree:

```
Skill(code-review, args: "high <BRANCH>")
```

It reviews the branch's diff against `main` and reports its findings (each `CONFIRMED` or
`PLAUSIBLE`, with file, line and a failure scenario).

- **Zero findings**: go to the screenshots paragraph below, then §6.
- Otherwise adjudicate: **fix every `CONFIRMED` finding** (skip one only when the cited code
  proves it wrong, with that evidence), and **decide every `PLAUSIBLE` finding yourself**: read
  the cited code, then promote it (fix it with the confirmed ones) or skip it with a one-line
  reason. None is left for the user.

Fix them in groups:

1. **Group the findings to fix (confirmed + promoted) by file**, ordering groups so
   definitions/exports change before their importers. Each task's `deferredMinors` (§3 step 3)
   join the group for their file, or form one of their own when no finding touches it.
2. Per group, **strictly sequentially**: dispatch a fix agent (Implementer template, fix mode B)
   with the finding text + resolution **inline**. It stages but does **not** commit.
3. **Review the staged diff before committing.** Check (a) each finding is actually resolved,
   (b) **the fix introduced no new bug**: re-check empty-collection and null cases, and any
   fallback the fix might have defeated, (c) nothing out of scope changed. Then commit as
   `fix(review): <what changed>`, the body stating each finding's problem and fix.
4. Confirm `npm run typecheck` exits 0 before the next group.

If a finding cannot be fixed without a refactor beyond its own scope, **do not force a bad fix**:
mark it *deferred* and list it under *Follow-ups* in the final report.

Then **re-run §4**; the fixes are code too. Re-run this section only when a fix added or
changed behaviour.

**Capture screenshots here.** Any visible change gets screenshots of it, at a phone width and a
desktop width, from the finished, fixed branch (the `run` skill drives the dev server and the
browser). Look at every shot. Anything that looks wrong is a finding: fix it as above and
re-shoot. Record the PNG paths in state.json (`screenshots`) so a resumed §6 still has them.

## 6. Ship

This skill ends in a **reviewed branch**, not a question.

- **With a GitHub remote** (`git remote` lists `origin`): push the branch and open a PR **ready
  for review, not a draft**:
  ```bash
  git push -u origin "$BRANCH"
  gh pr create --base main --title "<type>(<scope>): <what>" --body-file <body.md>
  ```
  The body: *What* (one paragraph), *How to review* (the heart of the change first, `refactor`
  commits named as no-behaviour-change), *Review coverage* (copied from the per-task records in
  state.json, any UNREVIEWED task listed by id), *Verification* (§4's result),
  *Screenshots* (or N/A), *Follow-ups*. End it with the PR attribution lines from the session's
  system reminder.
- **Without a remote**: merge your own finished work (CLAUDE.md *Git*). Once §4 and §5 are
  green, leave the worktree (`ExitWorktree`, `keep`: a worktree-isolated session cannot run git
  in the main checkout), check the main checkout is clean and on `main`, and run
  `git merge --ff-only <branch>` there. If `main` moved and the merge is not a fast-forward, or
  the main checkout is dirty, stop and report instead of rebasing or merging another way.
- **Never** push to `main`, force-push, rewrite `main`'s history, or merge red or unreviewed work.
- Branch names must not contain `/`.
- After the PR is opened (without a remote: after `main` is fast-forwarded and the report given), write `phase: "done"` to
  state.json and a `notes` entry saying so. The resume hook and autocompact key on `phase`, and
  a finished run left at `implement` reads as a stalled one.

> **Under autonomous mode:** push and PR need the grants that skill records. Without them, stop
> at a committed branch and report.

**Final report to the user:**

- The spec edit: the IDs added, changed and retired, with the `docs(spec)` commit.
- What was implemented, per task, with commit SHAs.
- What the per-task reviews caught and fixed.
- Branch review: confirmed findings fixed, plausible findings promoted and skipped (one line
  each with the reason), anything deferred.
- Final `npm run verify` result.
- The branch name, and the PR link or the commit `main` was fast-forwarded to.
- Any assumption you had to make, and *Follow-ups*: the tech debt and improvements you noticed
  but kept out of scope.

---

## Escape hatch

If, after reading the code, the work needs genuine design decisions or five-plus tasks (§2),
**stop and say so** instead of hand-rolling a large change through a loop built for small ones.
Ask: proceed anyway under sdd-loop / plan it first (plan mode) / narrow the scope.

> **Under autonomous mode:** this choice is not yours to make — log it needs-human and stop.

The trigger is **size, not uncertainty**. A handful of ambiguities is §0b doing its job. The
trigger is an ask that needs *competing approaches weighed* rather than *details pinned down*.

## Subagent dispatch templates

The Implementer (also the fix agent), Spec-compliance reviewer, Code-quality reviewer and
Re-reviewer (fix commit) templates are in `references/dispatch-templates.md`. **Read it before
the first dispatch** (§3 step 1): the §0 criteria are the spec slice, commit messages are
`<type>(<scope>): <what>`, and §5's fix agents use fix mode B (stage only; you commit).

The agent types are this repo's `.claude/agents/implementer.md` (compacts its own context at
275k tokens) and `general-purpose` for every reviewer; `.claude/agents/build-and-test-runner.md`
runs and reads `npm run verify` without fixing anything.
