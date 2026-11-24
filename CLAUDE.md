# Geography Trainer

A public web app that trains the skill maptap.gg tests: given a place name, tap it on a bare
globe. It teaches countries, then a country's regions, then the cities and landmarks in them,
with spaced repetition (FSRS) and a placement test. The approved design is
`docs/plan.md` (copied from the planning session): its *Build order* lists the steps, and the
design sections above it say what each step builds.

## Stack

Vite + React + TypeScript, one npm package, static site, no backend. Progress lives in the
browser (IndexedDB via Dexie) with JSON export/import. Maps are d3-geo (orthographic globe on a
canvas, other maps in SVG) with topojson. Unit tests are Vitest; e2e tests are Playwright.

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
| `npm run verify` | typecheck, lint, test, test:e2e, stopping at the first failure |
| `npm run build:data` | regenerate `public/data/` from maptap's list (network; rarely run) |

Filtered runs: `npx vitest run <paths>`, `npx playwright test <spec> --grep '<name>'`.

## Layout and rules

- `src/engine/` is pure TypeScript: curriculum, FSRS scheduling, grading, placement, session
  building. **It imports nothing from React, the DOM, `src/storage` or `src/maps`**, and takes
  time (`now`) and randomness as arguments, so every spec is deterministic. All learning logic
  lives here and is unit-tested.
- `src/storage/` is the only code that touches IndexedDB. A schema change bumps the Dexie
  version with a migration, and export/import round-trips every field.
- `src/maps/` holds the d3-geo components; `src/exercises/` the four exercise types;
  `src/pages/` the screens.
- `scripts/build-data/` generates `public/data/` from `https://maptap.gg/data/master_locations_v2.js`.
  **Never `eval`, `require` or `import` maptap's file**: slice out the JSON array literal and
  `JSON.parse` it. The generated `public/data/` is committed, so the site build never fetches
  from maptap. Regenerated data is its own commit, never mixed with logic.
- The place list is maptap's, used with permission: the Credits page says "Place list courtesy
  of MapTap.gg" and credits Natural Earth for boundaries. Keep both.
- maptap's score for a tap is `round(100 · exp(-3.5 · km / 16250))`, or 100 inside the target's
  polygon. Show it for familiarity; schedule on raw km (see `docs/plan.md`).
- The layout works at phone width (a 16px side gutter, no horizontal scroll) and with touch:
  drag to rotate, pinch to zoom.

## How work gets done here

Each build step in `docs/plan.md` is one `/sdd-loop` run (`.claude/skills/sdd-loop/`): the
user types it, the conductor takes the intake, and the step's *Build order* entry, the design
sections it builds on and the plan's *Verification* section are where its acceptance criteria
start. The run keeps durable state in `.durable-state/state.json`
(`.claude/skills/durable-state/`); the `idle-compact` mod (`.claude/skills/idle-compact/`)
auto-compacts an idle conductor while its subagents work.

Selftests for that tooling:

```bash
python3 -I .claude/skills/durable-state/scripts/state_selftest.py
bash .claude/hooks/durable-state-resume.selftest.sh
claude plugin test .claude/skills/idle-compact
```

## Git

- `main` is the default branch. Work happens on a feature branch in a worktree; never push to
  `main`, force-push or merge from an agent.
- Commit subjects are `<type>(<scope>): <what>` (`feat`, `fix`, `refactor`, `test`, `chore`,
  `docs`, `data`). A `refactor` commit changes no behaviour and says `No behaviour change.`
