# Screens contracts (SCR)

The constants the non-question pages use, their routes, and the pure view helpers under
`src/pages/` that the components are thin wrappers around. Every helper here is pure: no React,
no DOM, no storage, and the same output for the same input.

### SCR-C01 Progress colours
Up: SCR-06, SCR-07, SCR-10, SCR-15

| Key | Colour | Used for |
|---|---|---|
| `locked` | `#404040` | a locked item; a feature with no look on the world globe |
| `new` | `#7d8fbf` | a new item (cool and muted, so the untouched world reads calm) |
| `learning` | `#ea580c` | a learning item |
| `mastered` | `#4d8f63` | a mastered item with none of its descendants mastered |
| `complete` | `#4ade80` | a mastered item with every descendant mastered, or with none |
| `NEUTRAL_DOT` | `#3b3a35` | a drill-down dot for a place that is not in the curriculum |

A mastered item's fill is `mixOklab(mastered, complete, share)`, with `share` = mastered
descendants / all descendants, rounded to the nearest 0.01. `mixOklab(from, to, share)` mixes two
`#rrggbb` colours in Oklab (Björn Ottosson's matrices), clamping each channel to sRGB, and gives
what CSS's `color-mix(in oklab, to share, from)` gives. The legend's swatches use the same values.

Lives in `src/pages/progressView.ts` (`PROGRESS_COLOURS`, `progressFill`, `mixOklab`) and
`src/pages/progressGlobe.ts` (`NEUTRAL_DOT`).

### SCR-C02 Settings values
Up: SCR-19, SCR-20, SCR-23

| Value | | Lives in |
|---|---|---|
| Daily limit, range | `DAILY_NEW_CAP_MIN` to `DAILY_NEW_CAP_MAX` (STO-C05) | `src/storage/settings.ts` |
| Daily limit, default | `DAILY_NEW_CAP` (SES-C01) | `src/engine/config.ts` |
| Accepted limit text | `^\d+$` after trimming, within the range | `src/pages/settingsView.ts` `checkLimitText` |
| Reset word | `reset`, compared trimmed and lower-cased | `src/pages/settingsView.ts` `RESET_WORD` |
| Export file name | `geography-trainer-progress-<YYYY-MM-DD>.json`, the local day of the export | `src/pages/settingsView.ts` `exportFilename` |

The storage area owns the limit's range (STO-C05) and the export file's format (STO-C03), the
session area the default (SES-C01); Settings reads them from there.

### SCR-C03 Home's clock and placement offer
Up: SCR-04, SCR-05

| Value | | Lives in |
|---|---|---|
| Refresh interval | 60 000 ms, and on `visibilitychange` (when visible) and window `focus` | `src/pages/Home.tsx` `useNow` |
| Placement length shown in the offer | `PLACEMENT_MIN_QUESTIONS` to `PLACEMENT_MAX_QUESTIONS` questions (PLC-C02) | `src/pages/Home.tsx` |
| Time zone | the browser's, as minutes east of UTC (`-getTimezoneOffset()`) | `src/pages/Home.tsx`, `src/pages/Settings.tsx` |

### SCR-C04 Drill-down camera
Up: SCR-15, SCR-17

`drillCamera(country, region?)` returns a camera move:

| Page | Move |
|---|---|
| region page | `{ kind: 'fit', feature: region }` |
| country page, point-only country | `{ kind: 'span', at: answerPoint(country), km: NEIGHBOURHOOD_VIEW_KM }` |
| country page, any other country | `{ kind: 'fit', feature: country }` |

`NEIGHBOURHOOD_VIEW_KM` is the globe's (GLB-C13). Home and Progress move the camera
to `{ kind: 'world' }` once their data has loaded.

### SCR-C05 Routes
Up: SCR-13, SCR-27, SCR-29

| Path | Page |
|---|---|
| `/` | Home |
| `/progress` | Progress, the world |
| `/progress/:country` | a country's drill-down page |
| `/progress/:country/:region` | a region's page; `:region` is the full `<country>.<region>` id |
| `/settings` | Settings |
| `/credits` | Credits |
| `/playground` | the playground, only when `import.meta.env.DEV` |
| any other path | redirects to `/` |

A drill-down child row links to `/progress/<country>/<country>.<region>`. Routes are declared in
`src/App.tsx`.

### SCR-C06 Home's helpers
Up: SCR-02, SCR-05

`src/pages/homeView.ts`:

- `offersPlacement(curriculum, progress): boolean` is true while no progress row `isStudied`
  (a placement seed alone is not studied) and `placementPool(curriculum, progress, 'countries')`
  is not empty.
- `showsPlacementOffer(curriculum, progress, finishedTests): boolean` is `offersPlacement` and
  `finishedTests` lacks `placementKey(COUNTRIES_SCOPE)` (`placement:countries`). Test-out markers
  do not count.
- `newTodayText(newToday, cap): string` gives `"<n> of <cap> new today"`, or
  `"<n> new today (limit <cap>)"` once `newToday > cap`.

Home's numbers come from `todayNumbers` (`src/engine/today.ts`), owned by the session area.

### SCR-C07 Progress helpers
Up: SCR-09, SCR-10, SCR-11, SCR-12

`src/pages/progressView.ts`:

| Function | Contract |
|---|---|
| `progressFill(state, { total, mastered }) → colour` | as SCR-C01 |
| `itemLook(curriculum, progress, itemId) → { state, fill }` | `itemState`, and the fill; the subtree is walked only for a mastered item |
| `countryLooks(curriculum, progress, countries) → Map<countryId, look>` | one entry per country whose `country:<id>` item is in the curriculum |
| `lookOrLocked(looks) → (id) → look` | the entry, else `{ state: 'locked', fill: locked }` |
| `startedCountries(countries, looks)` | the countries whose look is learning or mastered, sorted by name (`localeCompare`) |
| `countryOptions(countries) → { id, name }[]` | every country, sorted by name |
| `tierCountText(tier, { total, learned, learning }) → string` | `"<Tier>: <learned> learned, <learning> learning of <total>"`, the tier singular only when `total` is 1 |

### SCR-C08 Progress globe modes
Up: SCR-06, SCR-15, SCR-17

`src/pages/progressGlobe.ts` builds the globe's `progress` mode, `{ kind: 'progress', features,
fills, dots }`:

- `countriesMode(features, look)`: every country feature, `fills[id] = look(id).fill`, and a dot
  `{ id, at: answerPoint(feature), colour: fill }` for each `pointOnly` country.
- `drillMode(features, fill, places, dotColour)`: `fills[id] = fill(id)` for each feature whose
  `fill` is not null (the rest unfilled), and a dot per place coloured `dotColour(id)`, or
  `NEUTRAL_DOT` when that is null.

The drill page passes `fill` = the region item's `itemLook` fill when the region is in the
curriculum (null otherwise, and always null for a country outline), and `dotColour` =
`PROGRESS_COLOURS[itemState]` for a place in the curriculum.

### SCR-C09 Drill-down helpers
Up: SCR-13, SCR-14, SCR-16, SCR-18

`src/pages/drillView.ts`:

- `resolveDrillRoute(curriculum, countries, countryId, regionId?)` returns
  `{ kind: 'country', countryId, hasRegions }`, `{ kind: 'region', countryId, regionId }` or
  `{ kind: 'not-found', back }`, with `back` `/progress` for an unknown country (one missing from
  `countries` or from the curriculum) and `/progress/<country>` otherwise. A region resolves only
  when `region:<regionId>` is a region item of `country:<countryId>`. The country list is checked
  first, so an unknown country never reaches `loadRegions`.
- `childRows(curriculum, progress, itemId, names) → ChildRow[]`: one row per child,
  `{ itemId, tier, name, state, stateLabel, unlockText, href }`, sorted by name; `unlockText` is
  set only for a locked row: it names `itemId` when `itemId` is not mastered, and the gate's count
  and `masteredCountryCount` (CUR-C08) when `itemId` is a mastered country whose gate is shut; `href` is set only for a region. A name missing
  from `names` shows the id. An unknown `itemId` gives `[]`.
- `splitByFrame(frame, items, at) → { onMap, off }`: by `frameTest(frame)` (the padded extent of
  the country's `mainPart`, from `src/maps/geo.ts`).
- `sortOffMap(entries)`: a sorted copy, by name; the input is not changed.

The test-out link uses `showsTestOutLink`, `testOutPath` and `testOutLabel` from
`src/pages/testOutView.ts`, owned by the placement area; the link's tier is the plural of the
child tier (`regions` or `places`).

### SCR-C10 Settings helpers
Up: SCR-19, SCR-20, SCR-21, SCR-22, SCR-23

`src/pages/settingsView.ts`:

- `checkImportText(text, current, tzOffsetMinutes)` returns `{ ok: false, message }` when `text`
  is not JSON or `validateProgressFile` throws (its message), else
  `{ ok: true, parsed, summary: { here, inFile, exportedOn } }`, where `here` and `inFile` are
  `startedByTier` of this browser's rows and the file's, and `exportedOn` is the file's
  `exportedAt` as a local `YYYY-MM-DD`. It writes nothing: the import runs only on Replace.
- `importConfirmText(summary)`, `leftOutText(n)`: the confirmation and the left-out warning.
- `checkLimitText(text) → { ok: true, value } | { ok: false, message }`: as SCR-C02; the message
  names the range.
- `isResetConfirmed(typed)`, `exportFilename(now, tzOffsetMinutes)`: as SCR-C02.

`startedByTier`, `validateProgressFile` and the file format belong to the storage area.

### SCR-C11 Page data loading
Up: SCR-01, SCR-06, SCR-25

- `loadWorldData(): Promise<WorldData>` (`src/pages/worldData.ts`), for Home and the Progress
  pages, loads the countries, the places, the saved progress, the finished-test markers and the
  settings in parallel, and builds the curriculum, so inconsistent data fails the load instead of
  a render. `WorldData` is `{ countries, places, progress, curriculum, finishedTests,
  dailyNewCap }`.
- `useLoaded(key, load) → [Loaded<T>, retry]` (`src/pages/useLoaded.ts`) runs `load` once per
  key and attempt; `Loaded<T>` is `{ status: 'loading' } | { status: 'error', error } |
  { status: 'ready', data }`. A result is kept with the key and attempt it answers, so a stale
  one reads as loading; `retry` starts a new attempt.
- `Status` (`src/pages/LoadStatus.tsx`) renders loading, an error alert with the reason and a
  Retry button, or its children with the data.

### SCR-C12 Library credits
Up: SCR-28

`DEPENDENCY_CREDITS: readonly { name, licence, url }[]` in `src/pages/credits.ts` names every key
of `package.json`'s `dependencies`, each with a non-empty licence and an `https://` URL.

| Library | Licence |
|---|---|
| @mantine/core, @mantine/hooks | MIT |
| d3-geo | ISC |
| dexie | Apache-2.0 |
| maplibre-gl | BSD-3-Clause |
| react, react-dom, react-router | MIT |
| topojson-client | ISC |
| ts-fsrs | MIT |

### SCR-C13 Playground addresses
Up: SCR-30, SCR-31

| Query | Effect |
|---|---|
| none, or `mode=exercises` | the Exercises tab |
| `mode=globe` | the Globe tab |
| `item=<item id>` | the exercise's item, `country:<id>`, `region:<country>.<region>` or `place:<id>`; default `country:france` |
| `rung=1`, `2` or `3` | the exercise's rung; anything else is 1 |

The Exercises tab shows the item's id (`data-testid="item-id"`) and answer point, and the last
result's rating, correctness, time, km and maptap score. The Globe tab's default mode is
`countryBorders` and its default country `france`; its progress demo fills every feature but each
third (by id) from a four-colour palette. Lives in `src/pages/Playground.tsx`,
`ExercisePlayground.tsx` and `GlobePlayground.tsx`.
