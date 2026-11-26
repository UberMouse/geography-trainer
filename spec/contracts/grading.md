# Grading contracts (GRD)

The grading module (`src/engine/grading.ts`), the scheduler and ladder (`src/engine/srs.ts`), the
distractors (`src/engine/distractors.ts`) and the seeded generator (`src/engine/rng.ts`). All four
are pure engine code: they import nothing from React, the DOM, storage or the maps, never read the
clock and never call `Math.random`; time and randomness come in as arguments.

## Grading

### GRD-C01 Ratings
Up: GRD-01

Ratings are ts-fsrs's `Grade` values (`Rating` minus `Manual`):

| Rating | Value |
|---|---|
| Again | 1 |
| Hard | 2 |
| Good | 3 |
| Easy | 4 |

`isPass(rating: Grade): boolean` is true for Good and Easy only. The placement estimate and the
exercise result's `correct` both use it.

### GRD-C02 Multiple-choice speed thresholds
Up: GRD-02

| Constant | Value | Rule |
|---|---|---|
| `MC_FAST_MS` | 4,000 ms | a correct answer with `timeMs < MC_FAST_MS` is Easy |
| `MC_SLOW_MS` | 12,000 ms | a correct answer with `timeMs > MC_SLOW_MS` is Hard; between the two (inclusive) is Good |

Live in `src/engine/config.ts`. A wrong answer is Again whatever the time.

`gradeMultipleChoice(correct: boolean, timeMs: number): Grade` throws a `RangeError` for a
negative or NaN `timeMs`, even for a wrong answer.

### GRD-C03 Tap thresholds
Up: GRD-03, GRD-04, GRD-05

| Constant | Value | Rule |
|---|---|---|
| `TAP_EASY_FRACTION` | 0.25 | inside a country or region: Easy when `kmFromAnswer <= 0.25 × featureSizeKm` (and `featureSizeKm > 0`), else Good |
| `COUNTRY_NEAR_MISS_KM` | 150 km | outside a country: Hard when `kmOutsideBorder <= 150`, else Again |
| `REGION_NEAR_MISS_KM` | 50 km | outside a region: Hard when `kmOutsideBorder <= 50`, else Again |
| `PLACE_EASY_KM` | 25 km | a place tap with `kmFromAnswer < 25` is Easy |
| `PLACE_GOOD_KM` | 75 km | `< 75` is Good |
| `PLACE_HARD_KM` | 200 km | `< 200` is Hard, otherwise Again |

All live in `src/engine/config.ts`. Note the boundaries: the inside and near-miss tests are
inclusive (`<=`), the place tests strict (`<`). `PLACE_EASY_KM` is also the distractor exclusion
radius (GRD-C10).

### GRD-C04 `gradeTap`
Up: GRD-03, GRD-04, GRD-05, GRD-06

```ts
interface TapInput {
  tier: 'country' | 'region' | 'place';
  inside: boolean;          // the tap is inside the target's polygon
  kmFromAnswer: number;     // tap to the answer point, km
  kmOutsideBorder: number;  // tap to the target's border, km (used when outside)
  featureSizeKm: number;    // a size for the target, km (used for the inside Easy test)
}
function gradeTap(input: TapInput): Grade;
```

The map layer measures these (`measureTap` in `src/maps/geo.ts`: `featureSizeKm` is the square
root of the target's main part's area, in km; a place target has `inside: false` and `0` for the
other two). Which fields each branch reads:

| Branch | Reads | Ignores |
|---|---|---|
| `tier: 'place'` | `kmFromAnswer` | `inside`, `kmOutsideBorder`, `featureSizeKm` |
| country/region, `inside` | `kmFromAnswer`, `featureSizeKm` | `kmOutsideBorder` |
| country/region, outside | `kmOutsideBorder` | `kmFromAnswer`, `featureSizeKm` |

A field the branch reads throws a `RangeError` when it is NaN or negative (`featureSizeKm` only
when NaN: `<= 0` means "never Easy"). An ignored field is not checked. `Infinity` is a valid
distance.

### GRD-C05 maptap's score
Up: GRD-07

```ts
maptapScoreRaw(km: number, inside = false): number  // 100 · exp(−MAPTAP_SCORE_DECAY · km / MAPTAP_SCORE_KM)
maptapScore(km: number, inside = false): number     // Math.round(maptapScoreRaw(km, inside))
```

| Constant | Value |
|---|---|
| `MAPTAP_SCORE_KM` | 16,250 km: at or beyond it the score is 0 |
| `MAPTAP_SCORE_DECAY` | 3.5 |

Live in `src/engine/config.ts`. `inside: true` returns 100 before `km` is looked at; otherwise a
negative or NaN `km` throws a `RangeError`.

## The ladder and scheduling

### GRD-C06 Ladder and mastery constants
Up: GRD-09, GRD-15, GRD-19

| Constant | Value | Where | Meaning |
|---|---|---|---|
| `Rung` | `1 \| 2 \| 3` | `src/engine/srs.ts` | the three rungs |
| climb on a pass | 1 rung; 2 on Easy; capped at 3 | `applyAnswer` | |
| climb on Hard | 1 rung, at L1 only | `applyAnswer` | |
| drop on Again | 1 rung, not below 1 | `applyAnswer` | |
| `MASTERY_DISTINCT_DAYS` | 2 days | `src/engine/config.ts` | distinct local days with an L3 pass to master |
| `PLACEMENT_SEED_STABILITY_DAYS` | 2 days | `src/engine/config.ts` | a review seed's minimum (and default) days until due |

### GRD-C07 Item progress format
Up: GRD-08, GRD-11, GRD-17, GRD-21

Progress is plain JSON: no `Date`s, no class instances. Every srs function returns new data and
never mutates its argument. Storage stores it as is and the export file carries it.

```ts
interface ItemProgress {
  itemId: string;                           // namespaced item id, e.g. "country:FR"
  rung: 1 | 2 | 3;                          // the rung asked next
  highestRung: 1 | 2 | 3;                   // the highest rung ever reached; never falls
  cards: Partial<Record<1 | 2 | 3, StoredCard>>; // one card per rung reached (a rung skipped by Easy has none)
  l3PassDays: string[];                     // sorted, distinct local days "YYYY-MM-DD" with an L3 pass
  inL3Lapse: boolean;                       // from an Again at L3 until the item is back at L3
  introducedAt: number | null;              // epoch ms of the first answer as a new item
}
interface StoredCard {                      // a ts-fsrs Card with its dates as epoch ms
  due: number;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: 0 | 1 | 2 | 3;                     // ts-fsrs State: New, Learning, Review, Relearning
  last_review?: number;                     // absent on a new card
}
```

### GRD-C08 The srs functions
Up: GRD-08, GRD-09, GRD-10, GRD-12, GRD-13, GRD-14, GRD-15, GRD-16, GRD-17, GRD-18, GRD-19

| Function | Contract |
|---|---|
| `localDayKey(now: Date, tzOffsetMinutes: number): string` | the local `YYYY-MM-DD`; the offset is minutes **east** of UTC (the negation of `Date.getTimezoneOffset()`) |
| `createProgress(itemId, now)` | rung 1, one new L1 card due `now`, `introducedAt: null` |
| `applyAnswer(progress, rung, rating, now, dayKey)` | schedules `cards[rung]` with FSRS at `now`; moves the ladder only when `rung === progress.rung`; adds `dayKey` to `l3PassDays` only on a pass at rung 3 while the current rung is 3; a card first reached is new and due `now`; a card stepped down to keeps its state with `due = now`; throws when `rung > highestRung` or the rung has no card |
| `isIntroduced(p)` | some card has `reps > 0` |
| `isStudied(p)` | `introducedAt !== null`, or some card has `reps > 1` |
| `isMastered(p)` | `l3PassDays.length >= MASTERY_DISTINCT_DAYS`; `l3PassDays` only grows, so a lapse never undoes it |
| `dueRung(p)` | `p.rung` |
| `nextDue(p)` | `p.cards[p.rung].due`; throws if that card is missing |
| `seedFromPlacement(itemId, outcome, now, dayKey, due?)` | fresh progress for a placement `outcome` (`'passed' \| 'close' \| 'failed' \| 'likelyKnown' \| 'aboveEstimate' \| 'untestedAtOrBelow'`); builds new data, so callers seed only items with no progress |

A review seed (`passed`, `likelyKnown`) is one L3 card: `state: Review`, `reps: 1`, `lapses: 0`,
`last_review: now`, `learning_steps: 0`, the difficulty ts-fsrs gives a first Good, and
`stability = scheduled_days = max(PLACEMENT_SEED_STABILITY_DAYS, round(days until due))`,
`due = now + that many days`. `due` defaults to `now + PLACEMENT_SEED_STABILITY_DAYS` days; only
`likelyKnown` reads it. A `passed` seed's `l3PassDays` is `[dayKey]`; others ignore `dayKey`.

### GRD-C09 The FSRS scheduler
Up: GRD-20

ts-fsrs `6.0.1` (pinned in `package.json`) with its default parameters and `enable_fuzz: false`,
built once in `src/engine/srs.ts`. With fuzz off nothing is random, so these first answers on a
new card at `now` are exact:

| Rating | Next due | State after |
|---|---|---|
| Again | now + 1 min | Learning |
| Hard | now + 5.5 min | Learning |
| Good | now + 10 min | Learning |
| Easy | now + 8 days | Review |

A ts-fsrs upgrade or a parameter change that moves these is a behaviour change: edit this table
first.

## Multiple-choice options

### GRD-C10 Distractor constants
Up: GRD-22, GRD-23, GRD-25

| Constant | Value | Where |
|---|---|---|
| `DISTRACTORS` | 3 wrong options per question | `src/engine/distractors.ts` |
| draw pool | the `2 × count` nearest candidates (6 by default) | `pickDistractors` |
| place exclusion radius | `PLACE_EASY_KM` (GRD-C03): a place closer than this to the target is never a candidate | `src/engine/config.ts` |
| widening threshold | a place's pool widens while it has fewer than `DISTRACTORS` distinct names | `placeCandidates` |
| distance | great-circle (haversine), Earth radius 6,371 km | `src/engine/distractors.ts` |

### GRD-C11 The distractor functions
Up: GRD-22, GRD-23, GRD-24, GRD-25

```ts
interface Located { id: string; lat: number; lng: number }
interface Candidate { id: string; name: string; lat: number; lng: number } // id is namespaced
interface PointRecord { id: string; name: string; lat: number; lng: number } // id is raw

distinctCandidates(candidates: Candidate[], name: string, from: [lng, lat]): Candidate[]
countryCandidates(country: PointRecord, countries: PointRecord[]): Candidate[]       // ids "country:<id>"
regionCandidates(region: PointRecord, regions: (PointRecord & { places: number })[]): Candidate[] // "region:<id>"
placeCandidates(place: Place, places: Place[]): Candidate[]                           // "place:<id>"
pickDistractors(target: Located, candidates: Located[], rng: Rng, count = DISTRACTORS): string[]
multipleChoice(targetId: string, distractorIds: string[], rng: Rng): string[]
```

- `distinctCandidates` drops every candidate named `name` and keeps, per name, the one nearest
  `from` (note: `[lng, lat]` order).
- `pickDistractors` sorts by distance then id, keeps the first `2 × count`, and draws `count` of
  them with a partial Fisher–Yates using `rng`; with `count` or fewer it returns them all,
  unshuffled. The target's id is never returned.
- `multipleChoice` returns `[targetId, ...distractorIds]` in a Fisher–Yates order from `rng`.
- The exercise layer calls `pickDistractors` then `multipleChoice` with one `mulberry32(seed)`,
  so the seed fixes both.

## Randomness

### GRD-C12 The seeded generator
Up: GRD-26

```ts
type Rng = () => number;              // a number in [0, 1)
function mulberry32(seed: number): Rng;
```

mulberry32 over the seed as an unsigned 32-bit integer. The algorithm is a contract: a question
is rebuilt from its stored seed, so changing it reshuffles every saved question. Its first three
outputs:

| Seed | Outputs |
|---|---|
| 0 | 0.26642920868471265, 0.0003297457005828619, 0.2232720274478197 |
| 42 | 0.6011037519201636, 0.44829055899754167, 0.8524657934904099 |
