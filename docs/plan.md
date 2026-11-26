# Geography Trainer: a maptap.gg training site

## Context
You play maptap.gg daily: you're given a place name and tap it on a **bare 3D globe with no borders or labels**, scored by distance. You want a public website that trains that skill. It works down a ladder, countries → regions in a country → cities in those regions, using maptap's own place list (permission granted; credit required). It uses spaced repetition so you retain what you learn, and a placement test so you skip what you already know.

Decisions so far: placement-test calibration · per-country unlocking · public site · progress stored locally first, sync later · React + TS · a one-time generation script that pulls maptap's JS data file and converts it into our own bundled format.

**Revised 2026-11-26 (UI redo, steps 8–11):** the d3-geo maps are replaced by one MapLibre globe with Sentinel-2 imagery, which every question and the progress maps use. The ladder drops the outline rung and has 3 rungs instead of 4. Components come from Mantine. The redo is described in *Globe and layout*; *Architecture* and *Curriculum* below describe the result.

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
  maps/                    the one MapLibre globe and its layers
    Globe                  one map instance for the whole app (stays mounted across routes), globe projection, EOX imagery
    layers                 GeoJSON sources + layer modes: bare · country borders · region borders · highlight · progress
    geo.ts                 spherical point-in-polygon and distance (d3-geo math only, no rendering) used for grading
  exercises/               3 exercise types sharing one Exercise interface; they set the globe's mode, never draw maps
  pages/                   Home (today's queue + progress on the globe), Session, Placement, Progress (drill down on the globe), Settings, Credits
```

Libraries: `maplibre-gl` (globe), `@mantine/core` + `@mantine/hooks` (components), `d3-geo` (spherical math only), `topojson-client`, `ts-fsrs`, `dexie`, `react-router`. Build script only: `@turf/boolean-point-in-polygon`, `mapshaper`, Natural Earth 10m/50m (public domain).

The globe is MapLibre GL JS in globe projection (WebGL). The first globe was d3 orthographic on a 2D canvas: it re-projected every border on the CPU each frame and lagged on drag. MapLibre draws on the GPU from tiled imagery and tiled GeoJSON.

## Curriculum & learning model
- **Tree:** Country → Regions (when the country has ≥ 4 regions containing maptap places and ≥ 15 places) → Places in a region. Countries below that threshold go straight from country to places. Landmarks (monuments, mountains, etc.) sit in the places tier alongside cities, and the type filter is a setting.
- **Exercise ladder per item.** An item works up L1 → L3, all on the globe. The learning phase is the first rungs; the review card lives on the highest rung reached. (Until 2026-11-26 there were 4 rungs, with *outline → name* as L1. It was dropped, and old L2–L4 became L1–L3; see *Globe and layout → No migration*.)
  1. **Highlighted on the globe → name** (4 choices; distractors are nearby or similar-sized). Countries and regions are shaded, places are a dot.
  2. **Name → tap, with borders.** Country questions show every country's border. Region and place questions show the regions of the item's country. Correct if inside the polygon (country/region) or within the tier's km threshold (place).
  3. **Name → tap, no borders.** Imagery only, the camera stays where the last question left it (as in a maptap round). Same rule, maptap score shown.
- **Grading → FSRS rating:**
  - Multiple choice: wrong = Again, correct and slow = Hard, correct = Good, correct and fast = Easy.
  - Tap: inside the polygon = Good (Easy if within ~25% of the feature's size from the answer point). Otherwise grade by km, with thresholds per tier:
    - Countries: Hard if near-miss within 150 km of the border, else Again
    - Places: < 25 km Easy · < 75 Good · < 200 Hard · ≥ 200 Again
    - All thresholds live in one tunable config.
- **Mastery & unlocking (per country):**
  - An item is *mastered* once it passes L3 (the top rung) on 2 different days.
  - Mastering a country unlocks its regions (or its places when it has no regions tier).
  - Mastering a region unlocks that region's places.
  - Mastered items stay in FSRS review indefinitely. A lapse at L3 drops the item temporarily to L2 and doesn't re-lock its children.
- **New-item order:** within the unlocked pool, lowest `difficultyLevel` first, ties broken by how often maptap asks about that country (its place count). Example: London comes before Akron, and the US comes before Tuvalu.
- **Placement test** runs on first launch (countries), and again whenever a tier unlocks, as an optional "test out".
  - It asks L3 (no borders) questions only.
  - **Difficulty (redesigned 2026-11-26).** A country's difficulty is its band (1–8) when all countries are ranked by `-ln(place count) + 0.4 · mean place level` and cut into 8 equal bands; a region's is its band among its country's regions. (It used to be the easiest place's level, which put 120 of 243 countries at level 1.)
  - **Ability estimate (redesigned 2026-11-26).** A posterior over the learner's ability is updated after every answer: an item `d` levels hard is known with probability `logistic(1.5 · (ability − d))`. A miss within 600 km of a country's border (150 km region, 200 km place) earns half credit, and the reveal says so. Each question aims at the current estimate and goes to the world area asked least so far, so breadth is measured too. It stops after 12–20 questions, once the estimate's spread is under half a level.
  - Items passed are seeded as L3 review cards with a short initial stability, so they come back within days to confirm, never skipped outright. Close misses start at L2.
  - Untested items are placed by the probability the learner knows them: ≥ 0.85 → L3 confirmation reviews, least certain first, 6 a day from day 2 (reviews, so outside the new-item cap); ≥ 0.5 → start at L2; otherwise L1.
- **Session:** due reviews first, then new items up to a daily cap (default 15; a setting). The session interleaves exercise levels so it isn't one long run of multiple choice. A pass climbs one rung and an Easy two (decided 2026-11-26), so a country answered fast at L1 goes straight to L3 and is asked twice in a session, not three times.

## Globe and layout (UI redo, decided 2026-11-26)
- **One globe.** A single MapLibre map in globe projection stays mounted for the whole app; routes and exercises change its layers and camera rather than mounting maps of their own. Drag rotates, pinch/wheel zooms, both built in (our own gesture code goes). A tap gives `lngLat`, and grading runs on that through `maps/geo.ts` against our own geometry, never against what MapLibre rendered, so it stays deterministic and unit-tested.
- **Imagery:** EOX Sentinel-2 cloudless **2025**, hotlinked as a raster source: `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg` (row before column). Checked 2026-11-26: CORS `*`, a week's browser cache, land imagery to z15, native 10 m so it stops getting sharper around z13–14.
  - **Licence:** CC BY-NC-SA 4.0. **The site stays non-commercial** (no ads or paid tiers without a paid EOX licence). The attribution is visible on the globe (MapLibre's attribution control) and on Credits: "Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)".
  - If EOX becomes unreliable or rate-limits us, the fallback is a PMTiles copy cut to the zoom we need, in a static bucket. The 2016 mosaic (`s2cloudless_3857`, CC BY 4.0) is the fallback if the site ever needs to be commercial.
- **No labels, no vector basemap.** The style is imagery plus our own layers. Names appear only after an answer, in the question panel and as HTML markers (`maplibregl.Marker`) on the globe, so no glyph server is needed.
- **Layer modes** (one GeoJSON source per data file; region files load lazily per country, as now):
  - *bare:* imagery only.
  - *country borders:* every country's border line.
  - *region borders:* the item's country's region borders and its outline; the rest of the world bare.
  - *highlight:* one feature shaded (or one dot for a place), plus the borders of the matching tier for context.
  - *progress:* countries (or, drilled in, regions) filled by progress state; tap to drill down.
  - *reveal* (after any answer): the target outlined, the tap and answer points with a line between them, the km and maptap score.
- **Camera** (my picks; mark up to change): L1 flies to fit the highlighted feature with some context around it; L2 for countries stays on the world, for regions and places it flies to fit the item's country; L3 never moves the camera; the reveal flies to fit the tap and the answer together. Progress drill-down flies to the country.
- **Layout: side by side.** A narrow question column next to the globe; the globe gets the rest of the screen. The column holds the prompt, the 4 choices for L1, the session counter, and the reveal (result, Next). My pick: column on the left, about 320px.
  - **Phone width:** the globe on top, the question panel below it where the thumb is (prompt, a 2×2 grid of choices, counter). No horizontal scroll, 16px gutters in the panel.
  - Non-question pages (Home, Progress, Settings, Credits) use the same column for their content, with the globe beside it showing progress. Settings and Credits may hide the globe at phone width.
- **Components: Mantine 9** (`@mantine/core`, `@mantine/hooks`): buttons, choice grid, segmented controls, forms (Settings), modals (reset, import), notifications, progress bars. A dark theme suits the imagery. We write no component of our own that Mantine has.
- **No migration.** Nobody has saved progress yet (user, 2026-11-26), so the move to 3 rungs is a clean break: no Dexie upgrade that re-ladders progress, and no mapping of old export files. An old file whose rungs fall outside 1–3 is rejected on import like any other malformed file.
- **What goes:** the d3 drawing code and the SVG/canvas maps (`OutlineView`, `HighlightMap`, `TapMap`, `BareGlobe`, `ProgressMap`, `DrillMap`, our gesture code) and the outline exercise. d3-geo stays only for the spherical math in `geo.ts`.

## Data generation script (`npm run build:data`)
1. Fetch V2 → slice from `const masterLocationsV2 = ` → `JSON.parse` the array with a raw decoder (no code execution). Drop `disabled`.
2. Match countries to NE admin-0, using `map_units` for England/Scotland/Wales/NI. Use an overrides table for naming (Türkiye, Côte d'Ivoire, territories, disputed areas). Tiny countries with no polygon get a point plus a radius. **Fail the build if a country goes unmatched.**
3. Assign regions with NE admin-1 point-in-polygon. Check the result against maptap's `admin` where it exists and print disagreements for review. Coastal points that fall outside every polygon snap to the nearest region.
4. Simplify geometry and write `public/data/*`. Commit the output, so the site build never hits maptap. The script also writes `public/data/SOURCE.md` with the fetch date, entry counts, and credit text.
5. The Credits page: "Place list courtesy of MapTap.gg" + Natural Earth (+ the EOX Sentinel-2 credit from step 11 on, when the globe reaches the real pages; until then the imagery shows only in the dev playground, credited by the globe's attribution control).

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

UI redo (see *Globe and layout*):

8. **The globe.** `maplibre-gl` globe with the EOX imagery and its attribution, our country and region GeoJSON as sources, the layer modes, tap → `lngLat`. Mantine installed with the app shell: the side-by-side layout and its phone-width stacking. Shown in the playground next to the old maps; nothing else changes yet.
9. **The 3-rung ladder.** `engine/` moves to L1–L3 (mastery, lapses, placement seeding and starting rungs); no migration of saved progress (see *No migration*); import rejects rungs outside 1–3. No UI change besides what the engine change forces.
10. **Questions on the globe.** The 3 exercise types for every tier on the globe, with camera moves and the reveal, in the Mantine column/panel. Session, Placement and test-out run on them. The outline exercise and the exercise maps are deleted.
11. **Everything else on the globe.** Home and the Progress drill-down on the globe's progress mode; Settings and Credits in Mantine (Credits gains the EOX line). The remaining d3 drawing code and SVG maps are deleted, and so is anything else we built that Mantine now covers. `CLAUDE.md`'s *Stack* and *Layout* lines are updated to match (MapLibre globe, Mantine, three exercise types).

## Verification
- `npm run build:data`: asserts every active place has a country polygon match and a region for any country that has a regions tier. Prints counts that should match the source (6,612 active), plus the admin-mismatch report.
- `vitest`:
  - `maptapScore(1000) ≈ 81` and `maptapScore(23) ≥ 99.5`
  - grading thresholds
  - FSRS scheduling transitions
  - unlock rules (master FR → FR regions available, DE regions still locked)
  - placement estimate converging on synthetic users of known skill (and on noisy ones)
  - export → import round-trip
  - import rejects a file whose rungs fall outside 1–3
- Playwright smoke test on desktop and mobile viewports: complete a placement test, then a session. Check that a tap inside a highlighted polygon scores correct, that progress survives a reload, and that the globe rotates and zooms with touch.
  - Chromium runs WebGL headless through its software renderer. Taps are aimed with a test-only hook that projects a `lngLat` to screen pixels through the live map (`map.project`), so they don't depend on pixel guesses.
  - Imagery requests to EOX are stubbed in e2e with a local tile, so tests never depend on EOX being up.
  - At phone width: the panel sits below the globe, nothing scrolls sideways, and all 4 choices are reachable without scrolling.
- The globe stays smooth while dragging: check by hand on a phone, and with a Playwright trace of a drag that shows no long main-thread frames.
- Check by hand in the browser (`npm run dev`), using the `run` skill for screenshots of each exercise type.

## Choices in step 0 (my picks; mark up to change)
- sdd-loop §5 branch review: **built-in `/code-review high`** rather than porting `branch-code-review.js`
- autocompact: **slim extraction + null-registry patch** rather than taking `registry.tsx` (which drags in mj code)
- autonomous-mode skill: **not ported now** (sdd-loop references it as optional)

## Open, decided later (not blocking)
- Hosting target and domain; GitHub repo/remote (I'll `git init` locally and you choose the remote).
- Sync backend for v2 (Supabase vs Firebase).
