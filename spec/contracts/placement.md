# Placement contracts (PLC)

The placement engine (`src/engine/placement.ts`), its constants, the finished-test marker keys and
the test-out routes.

### PLC-C01 The ability model
Up: PLC-04, PLC-07, PLC-17

| Constant | Value | Meaning |
|---|---|---|
| `PLACEMENT_START_LEVEL` | 4 | the prior's centre, where the first question aims |
| `PLACEMENT_PRIOR_SD` | 2.5 levels | the prior's spread (a normal prior) |
| `PLACEMENT_SLOPE` | 1.5 | the logistic slope: P(know) = `1 / (1 + exp(−1.5 · (ability − level)))` |
| `PLACEMENT_MIN_LEVEL` | 1 | the lowest level a question aims at |
| `PLACEMENT_MAX_LEVEL` | `DIFFICULTY_LEVELS` (CUR-C03) | the highest level a question aims at, and the highest estimate |
| `PLACEMENT_NO_ESTIMATE` | 0 | the estimate when nothing was shown |
| grid | 0 to 9 in steps of 0.25 | the ability values the posterior is held on (37 points) |

The constants live in `src/engine/config.ts`; the grid is `GRID` in `src/engine/placement.ts`.

The posterior after answers `(level, credit)` is, on each grid point `a`, proportional to
`exp(−((a − 4) / 2.5)² / 2) · Π p^credit · (1 − p)^(1 − credit)` with `p = knowProbability(a, level)`,
so a half credit counts as half a pass and half a miss. `abilityOf(answers)` returns its mean and
standard deviation.

### PLC-C02 Stopping and early finish
Up: PLC-11, PLC-12

| Constant | Value | Meaning |
|---|---|---|
| `PLACEMENT_MIN_QUESTIONS` | 12 | no early stop before this many answers |
| `PLACEMENT_MAX_QUESTIONS` | 20 | the test always stops here; the counter's "of up to" |
| `PLACEMENT_STOP_SD` | 0.45 levels | stop (after the minimum) once the posterior SD is below this |
| `PLACEMENT_MIN_TO_PLACE` | 8 | an early finish with fewer answers, and unasked items left, places nothing untested |

Lives in `src/engine/config.ts`. `isFinished(state)` is
`answers ≥ 20 || (answers ≥ 12 && sd < 0.45)`; a pool that ran out ends the test through
`nextQuestion` returning null.

### PLC-C03 Close-miss distances
Up: PLC-05

| Tier | Half credit when a missed tap is within | Measured from |
|---|---|---|
| country | 600 km | the border |
| region | 150 km | the border |
| place | 200 km | the point |

Lives in `src/engine/config.ts` (`PLACEMENT_CLOSE_KM`). The bound is inclusive. A pass is a
Good or Easy rating (`isPass`), whatever the distance.

### PLC-C04 Placing untested items and spacing confirmations
Up: PLC-13, PLC-14, PLC-15

| Constant | Value | Meaning |
|---|---|---|
| `PLACEMENT_LIKELY_KNOWN` | 0.85 | at or above: an L3 confirmation review (`likelyKnown`), if at or below the highest level passed outright |
| `PLACEMENT_PROBABLY_KNOWN` | 0.5 | at or above (and not `likelyKnown`): start at L2 (`untestedAtOrBelow`) |
| `PLACEMENT_CONFIRM_START_DAYS` | 2 days | the first confirmation reviews fall due this long after the test |
| `PLACEMENT_CONFIRM_PER_DAY` | 6 | at most this many confirmations fall due per day |

Lives in `src/engine/config.ts`. A passed item's L3 review card takes its stability and due offset
from `PLACEMENT_SEED_STABILITY_DAYS` (GRD-C06), through `seedFromPlacement` (GRD-C08).

The probability is the predictive one: `knowProbability` averaged over the posterior. Confirmation
`i` (0-based, least certain first, ties by item id) is due
`PLACEMENT_CONFIRM_START_DAYS + floor(i / PLACEMENT_CONFIRM_PER_DAY)` days after the test.

### PLC-C05 The engine's state machine
Up: PLC-04, PLC-07, PLC-08, PLC-09, PLC-10, PLC-11

```ts
startPlacement(items: PlacementItem[], rng): PlacementState
nextQuestion(state, rng): { state; question: { itemId; level } } | null
answerPlacement(state, itemId, credit: 0 | 0.5 | 1): PlacementState
finishPlacement(state): PlacementResult
isFinished(state): boolean
placementCredit(tier, rating, km | undefined): 0 | 0.5 | 1
knowProbability(ability, level): number
abilityOf(answers): { mean; sd }
worldArea([lng, lat] | null): string
```

```json
{
  "items":      [{ "itemId": "country:peru", "level": 3, "area": "south-america" }],
  "unaskable":  ["country:tiny"],
  "answers":    [{ "itemId": "country:peru", "level": 3, "credit": 0.5 }],
  "pending":    { "itemId": "country:chile", "level": 4 }
}
```

- Pure and deterministic given `rng`; the state is plain JSON and never mutated. Items with a
  non-finite level go to `unaskable` (JSON would turn `Infinity` into null).
- `startPlacement` spends no randomness. `nextQuestion` calls `rng` once per new question and not
  at all while one is pending (it returns the pending one); it returns null when the test is
  finished or no askable item is left, and throws a `RangeError` when `rng` returns a value
  outside [0, 1).
- Choice: aim = posterior mean clamped to 1–8; candidates are the unasked items within 0.5 of the
  nearest unasked level's distance to the aim; then those in the least-asked world areas; then
  `candidates[floor(rng() · n)]`.
- `answerPlacement` throws unless `itemId` is the pending question.

`worldArea` rules, first match wins (`lng`, `lat` in degrees):

| Rule | Area |
|---|---|
| no centre | unknown |
| `lat < −60` | antarctica |
| `lng < −150`, `lng > 150`, (`lng > 110` and `lat < −10`), or (`lng < −110` and `lat < 0`) | oceania |
| `lng < −30`: north-america when `lat ≥ 13` or (`lat ≥ 7` and `lng < −77`), else south-america | |
| `lng < 33` and `lat < 35.5` | africa |
| `lng < 45` and `lat ≥ 35` | europe |
| (`lng < 43` and `lat < 20`), (`lng < 52` and `lat < 12`), or (`lat < 0` and `lng < 80`) | africa |
| `lng < 75` | west-central-asia |
| otherwise | east-south-asia |

### PLC-C06 The result and the seeds it stores
Up: PLC-12, PLC-13, PLC-14, PLC-15, PLC-16, PLC-17

```json
{
  "estimate": 5,
  "outcomes": { "country:peru": "passed", "country:chile": "likelyKnown", "country:tiny": "aboveEstimate" },
  "confidence": { "country:chile": 0.93 }
}
```

`finishPlacement` gives an outcome for every item passed to `startPlacement`; `confidence` holds
exactly the `likelyKnown` items. `placementSeeds(result, progress, now, dayKey)` turns it into
progress rows (`seedFromPlacement` in `src/engine/srs.ts`):

| Outcome | From | Row stored |
|---|---|---|
| `passed` | credit 1 | rung 3, an L3 review card (reps 1) due in `PLACEMENT_SEED_STABILITY_DAYS` days (GRD-C06), `l3PassDays: [dayKey]` |
| `close` | credit 0.5 | rung 2, a fresh L2 card |
| `failed` | credit 0 | none |
| `likelyKnown` | untested, P ≥ 0.85, level ≤ highest passed | rung 3, an L3 review card due per PLC-C04, `l3PassDays: []` |
| `untestedAtOrBelow` | untested, P ≥ 0.5 | rung 2, a fresh L2 card |
| `aboveEstimate` | untested otherwise, unaskable, or any untested item after an early finish | none |

Every seed has `introducedAt: null`, so storing it counts nothing against today's new-item limit
and the item is not "studied" (`isStudied`). A `close` or `untestedAtOrBelow` seed has no answered
card, so it is still a new item (`newItems`); a `passed` or `likelyKnown` seed has one rep, so it is
not.
Rows come in `outcomes` order with the `likelyKnown` ones moved to the end, least certain first.
An item that already has a row is skipped.

### PLC-C07 Pools and test-out eligibility
Up: PLC-01, PLC-02, PLC-24

- `placementPool(curriculum, progress, scope)`: `scope` is `'countries'` (every country item) or
  an item id (its unlocked children, `[]` for a place). Items with a progress row are left out;
  the rest come in curriculum order as `{ itemId, level: difficulty, area: worldArea(center) }`.
  Throws for an id not in the curriculum.
- `canTestOut(curriculum, progress, itemId)`: the item is mastered, has children, at least one
  child has no row, no child `isStudied`, and, for a country, `gateOpen` (CUR-C08) holds. Throws for an id not in the curriculum.
- `showsTestOutLink(curriculum, progress, finishedTests, itemId)` (`src/pages/testOutView.ts`):
  `canTestOut` and no marker for the item in `finishedTests`.

### PLC-C08 Finished-test marker keys
Up: PLC-22

| Test | Marker key |
|---|---|
| the countries test | `placement:countries` |
| test-out of a country | `placement:country:<country>` |
| test-out of a region | `placement:region:<country>.<region>` |

Lives in `src/storage/placementKeys.ts` (`MARKER_PREFIX = 'placement:'`, `COUNTRIES_SCOPE =
'countries'`, `placementKey(scope)`). `isPlacementKey` accepts exactly those three shapes, with a
non-empty country, and a region id of exactly two non-empty dot-separated parts; anything else
(other `placement:` kinds, a non-string) is rejected. Markers are stored in the `meta` table
with seeds in one transaction (`finishPlacement` in the repo).

### PLC-C09 Placement routes
Up: PLC-18, PLC-21, PLC-23

| Path | Page |
|---|---|
| `/placement` | the countries test |
| `/placement/:country` | test-out of a country, e.g. `/placement/france` |
| `/placement/:country/:region` | test-out of a region; `:region` is the full id, e.g. `/placement/france/france.bretagne` |

`testOutPath(itemId)` builds these from an item id. `resolveTestOutRoute` returns
`{ kind: 'run', itemId, countryId, tier: 'regions' | 'places', needsRegions, back }`, where
`back` is the tested item's drill-down page (`/progress/<country>` or
`/progress/<country>/<country>.<region>`), or
`{ kind: 'unavailable', back: '/progress' | '/progress/<country>' }`; an unknown country is
rejected before any region data is loaded.
