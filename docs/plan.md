# Geography Trainer: a maptap.gg training site

## Context
You play maptap.gg daily: you're given a place name and tap it on a **bare 3D globe with no borders or labels**, scored by distance. You want a public website that trains that skill. It works down a ladder, countries → regions in a country → cities in those regions, using maptap's own place list (permission granted; credit required). It uses spaced repetition so you retain what you learn, and a placement test so you skip what you already know.

Decisions so far: placement-test calibration · all 4 exercise types · per-country unlocking · public site · progress stored locally first, sync later · React + TS · a one-time generation script that pulls maptap's JS data file and converts it into our own bundled format.

## Facts established from maptap (verified by reading their files)
- **Place pool:** `https://maptap.gg/data/master_locations_v2.js` is the list the Atlas shows ("every place in the practice & versus pool"). It has 9,462 entries, 6,612 of them active. It's one JS file: `const masterLocationsV2 = [ …JSON… ]`, followed by a separate `masterLocationsV2Shapes` array.
  - Fields: `id, name, country, lat, lng, continent, type, population?, difficulty, difficultyLevel (1–8), admin?, prevNames?, disabled?`
  - Types: city 5,534 · capital 241 · monument 198 · mountain 145 · island 144 · ancient_monument 109 · natural_wonder 107 · religious_site 62 · state_capital 50 · national_park 22
  - 265 "countries", using maptap's naming (England and Scotland are separate, "Türkiye", "Côte d'Ivoire")
  - The `admin` field (region) is only filled in for US, CN, IN, BR, RU, CA, MX, AR, AU (partly for ID and FR). Every other country has none.
  - The older `master_locations.js` (V1, about 1,856 entries) is still loaded by the game page. **We use V2**: it covers all of V1 and has difficulty levels and admin.
- **Scoring** (`js/adventures-geometry.js` → `calculateScore`): `score = exp(-3.5 · d / 16250)` and ×100, where d is in km. A tap inside the target polygon scores 100. Anything at 16,250 km or more scores 0.
  - Because the curve is so flat, 90 points = 489 km and 50 points = 3,218 km.
  - So **our scheduling grades on raw km**, and we show the maptap score alongside for familiarity.
- For regions, the pool coordinate is the *answer point*. It isn't always the centroid (Nunavut's is Iqaluit), so tapping inside the polygon has to count as correct.

## Architecture
Vite + React + TypeScript static site. No backend in v1. Hosted on Cloudflare Pages or GitHub Pages; we pick one at deploy time.

```
scripts/build-data/        one-time/re-runnable Node script (tsx)
  fetch-maptap.ts          download master_locations_v2.js → JSON.parse the array literal (never eval/require)
  country-match.ts         maptap country name → Natural Earth admin-0 feature (+ overrides table, reports unmatched)
  assign-regions.ts        point-in-polygon each place against NE admin-1; prefer maptap `admin` where present, log mismatches
  emit.ts                  writes public/data/*
public/data/
  places.json              compact: id,name,country,region,lat,lng,type,level,pop
  countries.topo.json      world admin-0, simplified (mapshaper), maptap-named
  regions/<countryId>.topo.json   lazy-loaded per country
src/
  data/                    loaders + typed model (Country, Region, Place, curriculum graph)
  engine/                  PURE TS, no React, fully unit-tested
    curriculum.ts          tree, unlock rules, new-item ordering
    srs.ts                 ts-fsrs wrapper, card per (item, exercise level)
    grading.ts             km/answer → FSRS rating; maptapScore(d)
    placement.ts           adaptive placement test
    session.ts             builds a session queue (due reviews + new items, daily cap)
  storage/                 Dexie (IndexedDB) repo, export/import JSON, schema version
  maps/                    d3-geo components
    OutlineView            one shape on its own, auto-fit
    HighlightMap           region context map with one feature shaded (cities: a dot)
    TapMap                 bordered map, tap → lat/lng
    BareGlobe              orthographic, drag-rotate + pinch/wheel zoom, no borders/labels (maptap-like)
  exercises/               4 exercise components sharing one Exercise interface
  pages/                   Home (today's queue + progress map), Session, Placement, Progress (world/country drilldown), Settings, Credits
```

Libraries: `d3-geo`, `topojson-client`, `ts-fsrs`, `dexie`, `react-router`. Build script only: `@turf/boolean-point-in-polygon`, `mapshaper`, Natural Earth 10m/50m (public domain).

The globe is d3 orthographic on canvas, not WebGL. That's lighter, works well on phones, and is close enough to maptap's globe, because what matters here is how tapping feels.

## Curriculum & learning model
- **Tree:** Country → Regions (when the country has ≥ 4 regions containing maptap places and ≥ 15 places) → Places in a region. Countries below that threshold go straight from country to places. Landmarks (monuments, mountains, etc.) sit in the places tier alongside cities, and the type filter is a setting.
- **Exercise ladder per item.** An item works up L1 → L4. The learning phase is the first rungs; the review card lives on the highest rung reached.
  1. **Outline → name** (4 choices; distractors are nearby or similar-sized). For points (cities), a dot on an unlabeled region map → name.
  2. **Highlighted on map → name** (shaded feature or dot in context, 4 choices)
  3. **Name → tap on a bordered map.** Correct if inside the polygon (country/region) or within the tier's km threshold (place).
  4. **Name → tap on the bare globe.** Same rule, maptap score shown.
- **Grading → FSRS rating:**
  - Multiple choice: wrong = Again, correct and slow = Hard, correct = Good, correct and fast = Easy.
  - Tap: inside the polygon = Good (Easy if within ~25% of the feature's size from the answer point). Otherwise grade by km, with thresholds per tier:
    - Countries: Hard if near-miss within 150 km of the border, else Again
    - Places: < 25 km Easy · < 75 Good · < 200 Hard · ≥ 200 Again
    - All thresholds live in one tunable config.
- **Mastery & unlocking (per country):**
  - An item is *mastered* once it passes L4 on 2 different days.
  - Mastering a country unlocks its regions (or its places when it has no regions tier).
  - Mastering a region unlocks that region's places.
  - Mastered items stay in FSRS review indefinitely. A lapse at L4 drops the item temporarily to L3 and doesn't re-lock its children.
- **New-item order:** within the unlocked pool, lowest `difficultyLevel` first, ties broken by how often maptap asks about that country (its place count). Example: London comes before Akron, and the US comes before Tuvalu.
- **Placement test** runs on first launch (countries), and again whenever a tier unlocks, as an optional "test out".
  - It asks L4 (bare globe) questions only.
  - It's an adaptive staircase over difficulty levels 1–8: pass → harder, fail → easier. It stops at about 20 questions or when the estimate settles.
  - Items passed are seeded as L4 review cards with a short initial stability, so they come back within days to confirm, never skipped outright.
  - Items above the estimated level start at L1. Untested items at or below the estimate start at L3.
- **Session:** due reviews first, then new items up to a daily cap (default 15; a setting). The session interleaves exercise levels so it isn't one long run of multiple choice.

## Data generation script (`npm run build:data`)
1. Fetch V2 → slice from `const masterLocationsV2 = ` → `JSON.parse` the array with a raw decoder (no code execution). Drop `disabled`.
2. Match countries to NE admin-0, using `map_units` for England/Scotland/Wales/NI. Use an overrides table for naming (Türkiye, Côte d'Ivoire, territories, disputed areas). Tiny countries with no polygon get a point plus a radius. **Fail the build if a country goes unmatched.**
3. Assign regions with NE admin-1 point-in-polygon. Check the result against maptap's `admin` where it exists and print disagreements for review. Coastal points that fall outside every polygon snap to the nearest region.
4. Simplify geometry and write `public/data/*`. Commit the output, so the site build never hits maptap. The script also writes `public/data/SOURCE.md` with the fetch date, entry counts, and credit text.
5. The Credits page: "Place list courtesy of MapTap.gg" + Natural Earth.

## Step 0: Port the Claude tooling from kawaka (before any app code)
I do this by hand in the conductor session, not through sdd-loop, because sdd-loop doesn't exist here yet. First `git init` (branch `main`), then add `.gitignore` with `.durable-state/`. Sources are under `~/code/kawaka/` (paths below are relative to it).

**0a. durable-state** (bash + jq + python3; no Node). Copy as-is, then trim:
- `.claude/skills/durable-state/{SKILL.md,scripts/state.py,scripts/state_selftest.py}`
- `.claude/bin/state`
- `.claude/hooks/{claude-bin-nearest.sh,claude-bin-path.sh,durable-state-resume.sh,lib/hook-common.sh,lib/selftest.sh,durable-state-resume.selftest.sh}`
- Register them in `.claude/settings.json`: SessionStart `""` → `claude-bin-path.sh`, and SessionStart `compact|resume` → `durable-state-resume.sh`.
- Trim:
  - Drop the `.plan-impl/` legacy fallback, in both `hook-common.sh` and `state.py` together, as their comments ask.
  - Drop the kx-ops registry reading (`kxops_registry` in `hook-common.sh`, the registry lines in `durable-state-resume.sh:83-127`, `kxops_fixture` in `lib/selftest.sh`, and SKILL.md §46-77/§129-141). The registry isn't ported, so these would only ever be dead code.
  - Rename the `_kx_` variable prefix in `claude-bin-nearest.sh`.
  - Replace the `packages/` fallback invariant in `durable-state-resume.sh:194-195` with "the conductor never edits `src/` itself".
  - Remove the SKILL.md paragraphs that only make sense in kawaka (`issuesCreated`/rule 9, plan-and-implement's `brief.py`).
  - Rewrite the selftest fixtures from plan-and-implement to sdd-loop.
- Verify: `python3 -I .claude/skills/durable-state/scripts/state_selftest.py` and `bash .claude/hooks/durable-state-resume.selftest.sh` both pass.

**0b. kx-ops autocompact, extracted as a slim mod renamed `idle-compact`** → `.claude/skills/idle-compact/` (loads as `idle-compact@skills-dir`). The rename covers every place "kx-ops" appears:
- plugin name in `plugin.json`
- `$.state`/atom keys `kx-ops.*` → `idle-compact.*` (e.g. `idle-compact.idle`)
- `/kx-autocompact` → `/idle-compact`
- the `claude plugin configure kx-ops@skills-dir` hint in `autocompact.tsx:444`
- text and log prefixes, and the `texts.test.ts` pins on them
- trail path `~/.claude/state/kx-ops/trail/` → `~/.claude/state/idle-compact/trail/`

When done, `grep -ri 'kx-ops\|kx_' .claude` must return nothing. Files:
- Files:
  - `.claude-plugin/plugin.json` (only the `autocompact` userConfig) and `hooks/hooks.json`
  - `register.tsx`, trimmed to `registerIdle` + `registerAutocompact`
  - from `hooks/`: `autocompact.tsx, autocompact-model.ts, idle.tsx, outbox.ts, util.ts, state-initial.ts, run-state.ts, trail.ts, ui-texts.ts, registry-model.ts, never-ending.ts, relay-model.ts`
  - `types/index.d.ts`, `tsconfig.json`
  - tests: `autocompact.test.ts, testkit.ts, texts.test.ts`
- Left behind: mj, prwatch, relay, band, registry.tsx, pane/package-folder, `bin/`.
- **Patch:** with no `registry.tsx`, rule 1 ("compact an idle durable-state run over 25%") only counts hand-kept `gate` entries in flight. I'll pass a `null` registry, so that hand-kept `agent` entries in `state.json` `inFlight` count too. That means autocompact fires while sdd-loop subagents run.
- Trim the kawaka-only parts:
  - rule 4 (PR-green), which needs prwatch; drop it along with its fixtures
  - the mj/rushx patterns in `never-ending.ts`, replaced with `vite`/`npm run dev`
  - the tsc path in `mods.selftest.sh`, pointed at `node_modules/.bin/tsc`, with the mod-twins check dropped
- Verify: `claude plugin validate .claude/skills/idle-compact`, `claude plugin test .claude/skills/idle-compact`, `tsc -p`, and the no-`kx-ops` grep above.

**0c. sdd-loop, adapted to this repo.** sdd-loop is the most kawaka-bound of the three, so this is a rewrite of its mechanics while its shape stays the same: §0 intake + cold-read criteria → split → implementer → spec + quality review → verify → branch review → ship.
- Bring along `plan-and-implement/references/dispatch-templates.md` → `.claude/skills/sdd-loop/references/dispatch-templates.md`, and `.claude/agents/{implementer,build-and-test-runner}.md`.
- Replace:
  - `mj settle`/`rushx test`/`rush lint` → `npm run verify` (typecheck + lint + vitest + playwright)
  - `origin/master` → `main`
  - `packages/` → `src/`
- Remove: estaging/acceptance-test, `gh stack`, story-shots, `pr-shape-guard`, the mj subscription lines, work-specific CLAUDE.md sections.
- §5 branch review → the built-in `/code-review high` (instead of porting the 1,921-line `branch-code-review.js` workflow).
- §6 ship → commit on a feature branch, open a PR once a GitHub remote exists, otherwise stop at a local branch for you to merge.
- autonomous-mode references: kept as optional ("if the autonomous-mode skill is installed"), because it isn't ported in this step.
- Verify: a cold-read subagent checks that the adapted SKILL.md has no dangling references (every file, skill, binary and npm script it names exists).

**0d. Project CLAUDE.md:** stack, `npm run verify`, the engine purity rule (`src/engine` has no React or DOM), the data-script rule (never eval maptap's file), and a pointer to sdd-loop for each build step.

From here on, **each build step below is one `/sdd-loop` run**: you type it, I take the intake, and its acceptance criteria come from this plan's section for that step.

## Build order (each step ends in something usable)
1. Scaffold the app (Vite/React/TS, Vitest, Playwright, ESLint/Prettier, `npm run verify`), then the data script → committed `public/data`.
2. `engine/` (curriculum, srs, grading, placement, session) with unit tests. No UI yet.
3. Map components + 4 exercises, checked in a dev "playground" route.
4. Session page + Home + persistence (Dexie, export/import). **First usable version: countries only.**
5. Regions + places tiers, per-country unlocking, Progress drilldown map.
6. Placement test.
7. PWA (offline, installable on phone), Settings, Credits, deploy.

## Verification
- `npm run build:data`: asserts every active place has a country polygon match and a region for any country that has a regions tier. Prints counts that should match the source (6,612 active), plus the admin-mismatch report.
- `vitest`:
  - `maptapScore(1000) ≈ 81` and `maptapScore(23) ≥ 99.5`
  - grading thresholds
  - FSRS scheduling transitions
  - unlock rules (master FR → FR regions available, DE regions still locked)
  - placement staircase converging on synthetic users of known skill
  - export → import round-trip
- Playwright smoke test on desktop and mobile viewports: complete a placement test, then a session. Check that a tap inside a highlighted polygon scores correct, that progress survives a reload, and that the bare globe rotates and zooms with touch.
- Check by hand in the browser (`npm run dev`), using the `run` skill for screenshots of each exercise type.

## Choices in step 0 (my picks; mark up to change)
- sdd-loop §5 branch review: **built-in `/code-review high`** rather than porting `branch-code-review.js`
- autocompact: **slim extraction + null-registry patch** rather than taking `registry.tsx` (which drags in mj code)
- autonomous-mode skill: **not ported now** (sdd-loop references it as optional)

## Open, decided later (not blocking)
- Hosting target and domain; GitHub repo/remote (I'll `git init` locally and you choose the remote).
- Sync backend for v2 (Supabase vs Firebase).
