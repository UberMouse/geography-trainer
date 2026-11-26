# The spec

`spec/` says what Geography Trainer does. It is the source of truth: to change behaviour, edit the
spec first, then make the code and its tagged test follow. `npm run spec:check` (part of
`npm run verify`) holds the spec and the tests to each other.

It describes the app **as built**. Where the code and the old plan (`docs/history/plan.md`)
disagree, the spec follows the code, and the plan is history.

## Tiers

| Tier | Where | IDs | Holds |
|---|---|---|---|
| L0 product | `00-product.md` | `PRD-01` | What the app is for and the promises it keeps: who it's for, the journeys, invariants (no backend, non-commercial, credits). Prose, no scenarios. |
| L1 features | `features/<area>.md` | `SES-03` | Behaviour per area, as Given/When/Then scenarios. What a learner (or the build script) sees happen. |
| L2 contracts | `contracts/<area>.md` | `SES-C03` | Module contracts: the functions other code relies on, their inputs and outputs, **every constant's value**, data-file formats, the storage schema and the export file. |

Each L1 scenario links up to the L0 item(s) it serves; each L2 entry links up to the L1
scenario(s) it makes possible. Every L0 item has at least one scenario under it.

Areas and their ID prefixes:

| File | Prefix | Covers |
|---|---|---|
| `curriculum.md` | `CUR` | the country → regions → places tree, unlocking, mastery, new-item order, difficulty bands |
| `grading.md` | `GRD` | the exercise ladder, tap and choice grading, FSRS ratings and scheduling, distractors, maptap score |
| `placement.md` | `PLC` | the placement test and test-out: ability estimate, stopping, seeding |
| `session.md` | `SES` | building a session, running a round, resume after reload, the counter, the summary |
| `exercises.md` | `EXR` | the three exercise types on screen, the reveal, camera moves per question |
| `globe.md` | `GLB` | the one globe: imagery, layer modes, gestures, spherical maths, the app shell and layout |
| `screens.md` | `SCR` | Home, Progress and its drill-down, Settings, Credits, the dev playground |
| `storage.md` | `STO` | IndexedDB, saving, export and import, reset, the loaded data files |
| `data-pipeline.md` | `DAT` | `npm run build:data`: fetching maptap's list, matching, regions, emitting `public/data/` |
| `tooling.md` | `TLG` | the spec checker itself |

A contract file can be split further (`contracts/engine-srs.md`) but keeps its area's prefix.

## An L1 scenario

````markdown
### SES-03 Due reviews come before new items
Up: PRD-06

```gherkin
Scenario: due reviews come first
  Given 3 reviews are due
    And 10 new items are unlocked
  When a session is built
  Then the first 3 items are the reviews
```
````

- The heading starts with the ID, then a short name. IDs are never reused or renumbered; a
  removed scenario's ID is retired.
- `Up:` names the parent ID(s), comma-separated.
- The body is one ```` ```gherkin ```` block with one `Scenario:`, or several when they are
  facets of one rule. Prose before the block is allowed for context (a *Why:* line is welcome).
- **A table of cases is one `Scenario Outline:` with an `Examples:` table**, not one scenario per
  case:

  ```gherkin
  Scenario Outline: place taps are graded by distance
    Given a place question
    When the tap lands <km> km from the answer point
    Then the rating is <rating>
    Examples:
      | km  | rating |
      | 24  | Easy   |
      | 74  | Good   |
  ```
- **UI is behaviour only.** Say what appears and when ("the reveal names the place and says how
  far off the tap was"), and paraphrase on-screen wording rather than quoting it. Layout is in
  the spec only where it is a rule (the phone stacking, 16px gutters, no sideways scroll).
- Scenarios describe what is observable (by a learner, through the engine's API, or in the
  output files), not how the code is arranged.

## An L2 contract entry

```markdown
### GRD-C02 Place distance thresholds
Up: GRD-04

| Rating | Distance from the answer point |
|---|---|
| Easy | < 25 km |
| Good | < 75 km |
| Hard | < 200 km |
| Again | ≥ 200 km |

Lives in `src/engine/config.ts` (`PLACE_KM`).
```

Free-form: signatures, tables, JSON shapes. **The spec states the value; a test tagged with the
entry's ID pins the code to it**, so changing a number starts here and a test fails until the
code follows. Say where the value lives in the code.

## Tracing to tests

Every test cites the ID(s) it verifies in square brackets in its title, or in a `describe`
title around it, which covers every test inside:

```ts
describe('[GRD-04] place taps', () => {
  it.each(cases)('rates a %d km tap %s', …);
});
test('[SES-03, SES-05] a session from Home', async ({ page }) => …);
```

Tests cite L1 or L2 IDs, never L0.

An entry that no test can reasonably check says how it *is* checked, on a line after `Up:`:

```
Verified: manual — the globe stays smooth while dragging; checked on a phone
```

The kinds are `manual`, `typecheck`, `lint` and `build:data`, each followed by a reason. Use it
sparingly: if a test could check it, write the test.

## `npm run spec:check`

Fails when:

- an ID is duplicated, or has the wrong shape for its file (`PRD-` only in `00-product.md`,
  `-C` IDs only in `contracts/`);
- an L1 or L2 entry has no `Up:`, or names a parent that doesn't exist or isn't one tier up;
- an L0 item has no scenario under it;
- an L1 entry has no ```` ```gherkin ```` block with a `Scenario`;
- an L1 or L2 entry is cited by no test and has no valid `Verified:` line;
- a test cites no ID, or an ID that doesn't exist, or an L0 ID.

`npm run spec:check -- --quiet` prints the summary and a count per kind of error.

## Changing behaviour

1. Edit the spec: change a scenario or contract value, or add one with a new ID.
2. Run `/sdd-loop`; the spec diff becomes the acceptance criteria.
3. The change lands with its tests citing the new or changed IDs, and `spec:check` green.
