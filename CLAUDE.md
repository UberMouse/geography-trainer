# Geography Trainer

A public web app that trains the skill maptap.gg tests: given a place name, tap it on a bare
globe. It teaches countries, then a country's regions, then the cities and landmarks in them,
with spaced repetition (FSRS) and a placement test.

**`spec/` says what the app does, and it is the source of truth** (`spec/README.md` has the
format). It has three tiers: `00-product.md` (L0, what the product promises),
`features/<area>.md` (L1, Given/When/Then scenarios) and `contracts/<area>.md` (L2, module
contracts, data formats and every constant's value). Behaviour changes start as a spec edit.
`docs/history/plan.md` is the original plan, kept as the record of past decisions. Where it and
the spec disagree, the spec wins.

## Stack

Vite + React + TypeScript, one npm package, static site, no backend. Progress lives in the
browser (IndexedDB via Dexie) with JSON export/import. The map is one MapLibre globe (globe
projection, EOX Sentinel-2 cloudless imagery) shared by every screen; boundaries are topojson, and
d3-geo does the spherical maths. The UI is Mantine components. Unit tests are Vitest; e2e tests
are Playwright.

## Commands

These scripts are the contract every skill and agent relies on: keep their names.

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | production build into `dist/` |
| `npm run typecheck` | `tsc --noEmit` over the app, the scripts and the specs |
| `npm run lint` | eslint over the repo (never `--fix` in a check) |
| `npm test` | `vitest run`, every unit spec |
| `npm run test:e2e` | `playwright test` (it starts the dev server itself) |
| `npm run spec:check` | every spec entry is linked and tested (or `Verified:`), and every test cites a spec ID that exists |
| `npm run verify` | spec:check, typecheck, lint, test, test:e2e, stopping at the first failure |
| `npm run build:data` | regenerate `public/data/` from maptap's list (network; rarely run) |

Filtered runs: `npm test -- <paths>`, `npm run test:e2e -- <spec> --grep '<name>'`,
`npm run lint -- <files>`.

The heavy scripts (build, typecheck, lint, test, test:e2e, build:data) wait for a slot from the
machine-wide build semaphore (`kx-build-slot`, from the user's dotfiles) via `scripts/slot.sh`,
which just runs the command where `kx-build-slot` isn't installed (CI). Vitest and Playwright
are capped at 4 workers each. So run checks through these npm scripts, never bare
`npx vitest`/`npx playwright`/`npx eslint`/`npx tsc`, which would skip the queue. A wait
before output starts is a queued job, not a hang.

## Layout and rules

- `src/engine/` is pure TypeScript: curriculum, FSRS scheduling, grading, placement, session
  building. **It imports nothing from React, the DOM, `src/storage` or `src/maps`**, and takes
  time (`now`) and randomness as arguments, so every spec is deterministic. All learning logic
  lives here and is unit-tested.
- `src/storage/` is the only code that touches IndexedDB. A schema change bumps the Dexie
  version with a migration, and export/import round-trips every progress field (progress,
  answers, finished placement tests). Device settings such as the daily new-item limit stay
  out of the export file on purpose: an import leaves them as they are.
- `src/maps/` holds the globe, its layers and `geo.ts` (the spherical maths); `src/exercises/`
  the three exercise types (L1 multiple choice, L2 tap with borders, L3 tap on the bare globe);
  `src/pages/` the screens.
- `scripts/build-data/` generates `public/data/` from `https://maptap.gg/data/master_locations_v2.js`.
  **Never `eval`, `require` or `import` maptap's file**: slice out the JSON array literal and
  `JSON.parse` it. The generated `public/data/` is committed, so the site build never fetches
  from maptap. Regenerated data is its own commit, never mixed with logic.
- The place list is maptap's, used with permission: the Credits page says "Place list courtesy
  of MapTap.gg" and credits Natural Earth for boundaries. Keep both.
- maptap's score for a tap is `round(100 · exp(-3.5 · km / 16250))`, or 100 inside the target's
  polygon. Show it for familiarity; schedule on raw km (see `spec/features/grading.md`).
- **Every test traces to the spec.** Its title, or a `describe` title around it, cites the
  ID(s) it verifies in square brackets (`it('[SES-03] …')`). A constant's value lives in its L2
  contract entry, and a test citing that entry pins the code to it. To change a number, edit
  the spec first.
- The layout works at phone width (a 16px side gutter, no horizontal scroll) and with touch:
  drag to rotate, pinch to zoom.

## How work gets done here

Each change is one `/sdd-loop` run (`.claude/skills/sdd-loop/`), and it starts from the spec.
The user either edits `spec/` themselves or describes the change, in which case the conductor
drafts the spec edit at intake. The scenarios and contract entries the edit adds, changes or
retires are the acceptance criteria. The edit lands as the branch's first commit
(`docs(spec): …`), the tests that land cite its IDs, and `spec:check` keeps spec and tests
traced. A refactor changes no file under `spec/`. The run keeps durable state in `.durable-state/state.json`
(`.claude/skills/durable-state/`); the `idle-compact` mod (`.claude/skills/idle-compact/`)
auto-compacts an idle conductor while its subagents work.

Worktrees are made by the `WorktreeCreate` hook (`.claude/hooks/worktree-create.sh`), which
replaces Claude Code's own `git worktree add`: same path, branch and `worktree.baseRef`
handling, then `npm ci` and a check that the Playwright browsers match. A fresh worktree is
ready to run `npm run verify`. Its `WorktreeRemove` partner only removes a clean worktree
and deletes the branch only once it is merged. Their log lines match `\[worktree-setup\]`.

Selftests for that tooling:

```bash
python3 -I .claude/skills/durable-state/scripts/state_selftest.py
bash .claude/hooks/durable-state-resume.selftest.sh
bash .claude/hooks/worktree-hooks.selftest.sh
claude plugin test .claude/skills/idle-compact
```

## Git

- `main` is the default branch. Work happens on a feature branch in a worktree.
- The agent merges its own finished work: once a branch is reviewed and `npm run verify` passes
  on it, fast-forward local `main` to it (`git merge --ff-only <branch>` from the main checkout)
  and carry on with the next step. Never merge red or unreviewed work, never force-push, and
  never rewrite `main`'s history.
- Commit subjects are `<type>(<scope>): <what>` (`feat`, `fix`, `refactor`, `test`, `chore`,
  `docs`, `data`). A `refactor` commit changes no behaviour and says `No behaviour change.`
