# Exercises: contracts (EXR)

The modules under `src/exercises/` and the camera distances they use. Everything here except the
React components is pure: given the same item, rung, tap and seed it returns the same data, and it
fetches nothing.

### EXR-C01 `buildExerciseItem` and `ExerciseItem`
Up: EXR-02, EXR-03, EXR-12, EXR-20, EXR-21, EXR-22, EXR-24

`buildExerciseItem(itemId: string, data: ExerciseData): ExerciseItem` in `src/exercises/item.ts`.
`ExerciseData` is `{ countries: CountriesData; places: Place[]; regions?: RegionsData }`, where
`regions` is the item's country's, when it has them. It throws for every case in EXR-22.

| Field | Type | Holds |
|---|---|---|
| `id` | string | the namespaced item id: `country:<id>`, `region:<country>.<id>` or `place:<id>` |
| `tier` | `'country' \| 'region' \| 'place'` | from the id's prefix |
| `name` | string | the feature's or place's name |
| `label` | string | what a tap prompt and a wrong verdict call it (EXR-24): `name` for a country or place, `<region name>, <country name>` for a region |
| `countryName` | string | the owning country's name (the country's own for a country) |
| `countryId` | string | the owning country's namespaced id (`country:<id>`) |
| `target` | `TapTarget` | `{ feature, answer, alsoInside? }` for a country or region (`answer` is `answerPoint(feature)`; `alsoInside` lists same-named sibling regions, only when there are any), `{ point }` for a place |
| `candidates` | `Candidate[]` | the wrong-option pool (GRD-25), from `countryCandidates`, `regionCandidates` or `placeCandidates` in `src/engine/distractors.ts`; may be empty for a region |
| `frame` | `AreaFeature` | the owning country's main part (`mainPart`) |
| `outsideFrame` | boolean | `!frameTest(frame)(answer point)`; always false for a country |
| `highlightMode` | `GlobeMode` | L1's: `highlight` with target `{kind:'country', feature, countries}`, `{kind:'region', feature, country, regions}` or `{kind:'place', place, country, regions?}` (`regions` undefined for a country without a regions tier) |
| `bordersMode` | `GlobeMode` | L2's: `{kind:'countryBorders', countries}` for a country, else `{kind:'regionBorders', country, regions?}` |
| `bareMode` | `GlobeMode` | L3's: `{kind:'regionBorders', country}` (no `regions`, so the country's outline alone) for a region, else `{kind:'bare'}`, the same object for every item |
| `pointOnly` | boolean | the country (or the place's country) has `pointOnly: true`; always false for a region |

`distinctCandidates` is re-exported from `src/engine/distractors.ts`.

### EXR-C02 `ExerciseResult`, `choiceResult` and `tapResult`
Up: EXR-18, EXR-19

What an answered question reports to the page, which hands it to the scheduler. In
`src/exercises/types.ts` and `src/exercises/result.ts`.

| Field | Type | Holds |
|---|---|---|
| `rating` | `Grade` (ts-fsrs) | Again, Hard, Good or Easy |
| `correct` | boolean | a choice: the item was chosen; a tap: `isPass(rating)` (Good or Easy) |
| `timeMs` | number | from the question's first render to the answer, ≥ 0 |
| `km` | number? | taps only: `kmFromAnswer` for a place, `kmOutsideBorder` (0 inside) for a country or region, from `measureTap` |
| `maptapScore` | number? | taps only: `maptapScore(kmFromAnswer, inside)` |

- `choiceResult(item, chosenId, timeMs)`: `rating` is `gradeMultipleChoice(chosenId === item.id, timeMs)`; no `km` or `maptapScore`.
- `tapResult(item, tap: LngLat, timeMs)`: `rating` is `gradeTap({ tier, ...measureTap(item.target, tap) })`.

### EXR-C03 The question's globe, as data
Up: EXR-01, EXR-02, EXR-08, EXR-09, EXR-10, EXR-15, EXR-16, EXR-24

Pure functions in `src/exercises/questionGlobe.ts`; `useQuestionGlobe` hands their output to the
shared globe (`useGlobe`, `moveCamera` in `src/maps/globeContext.ts`).

| Function | Returns |
|---|---|
| `questionMode(item, rung)` | `item.highlightMode` (L1), `item.bordersMode` (L2), or `item.bareMode` (L3), the same object every call so the globe does not redraw |
| `questionCamera(item, rung, opening = false)` | a `CameraMove`: `fit` (a feature), `span` (the neighbourhood of a point, or an area in its surroundings, EXR-C06), `world` (optionally `at`), or `stay`, per EXR-09 and EXR-10; a region at L3 gets exactly its L2 move, `opening` or not |
| `questionReveal(item, tap?)` | `{ target: {kind:'area', feature} \| {kind:'point', at}, tap?: { at: tap, answer: targetPoint(target) } }` |
| `revealCamera(item, tap)` | `pair` (`a: tap`, `b: answer`, `feature` for an area target), or `world` centred on the midpoint or the answer, per EXR-16 |
| `questionMarkers(item, pin, answered)` | unanswered: `[]` or `[{kind:'pin', at: pin}]`; answered: `[{kind:'name', at: targetPoint(target), text: item.name}]` (the name, not the label) |

The question's camera move runs once as the question mounts; the reveal's runs once when a
confirmed tap is revealed. A choice reveals no tap, so it moves nothing.

### EXR-C04 `buildChoices`
Up: EXR-04

`buildChoices(item: ExerciseItem, rng: Rng): Choice[]` in `src/exercises/options.ts`, `Choice` being
`{ id, name }`. It picks up to `DISTRACTORS` (GRD-C10)
wrong options from `item.candidates` near the target point with `pickDistractors`, then shuffles
them with the item using `multipleChoice`, both from `rng`. The exercise seeds `rng` with
`mulberry32(seed)`, so one seed gives one set of options in one order.

### EXR-C05 The reveal's wording
Up: EXR-13, EXR-14

In `src/exercises/result.ts`.

`verdictText({ correct, rating })` returns `{ text, tone }`:

| correct | rating | text (paraphrased) | tone |
|---|---|---|---|
| true | Easy | correct, spot on | `right` |
| true | Hard | correct, slow | `right` |
| true | Good | correct | `right` |
| false | Hard | incorrect, near miss | `near` |
| false | Again | incorrect | `wrong` |

`Reveal.tsx` colours the tones green (`right`), yellow (`near`) and red (`wrong`).

`formatKm(km)` rounds to one decimal first; under 10 it shows that one decimal, else whole km
with `en` thousands separators. `distanceText(tier, km)` is `<formatKm> km away` for a place, and
for a country or region "inside the border" at exactly 0, else `<formatKm> km outside the border`.

`RATING_LABEL` names each `Grade` for the playground: Again, Hard, Good, Easy.

### EXR-C06 Camera distances
Up: EXR-09, EXR-16

| Constant | Value | Lives in | Is |
|---|---|---|---|
| `REVEAL_WORLD_KM` | 5,000 km | `src/exercises/questionGlobe.ts` | beyond this tap-to-answer distance the reveal shows the whole globe instead of framing both |
| `REVEAL_FAR_SIDE_KM` | 9,000 km | `src/exercises/questionGlobe.ts` | beyond this the whole globe centres on the answer point, not halfway |
| `L1_CONTEXT_SCALE` | 2.5 | `src/exercises/questionGlobe.ts` | an L1 area's view is this many times its main part's span, so the main part takes about 2/5 of the shorter side |
| `REGION_CONTEXT_MIN_KM` | 300 km | `src/exercises/questionGlobe.ts` | the narrowest view an L1 region gets; an L1 country's is `NEIGHBOURHOOD_VIEW_KM` |
| `L1_CONTEXT_MAX_SCALE` | 10 | `src/exercises/questionGlobe.ts` | an L1 area's view is never more than this many times its main part's span, so a tiny one (Monaco, a city district) still takes about a tenth of the shorter side |

A question's `span` move shows `NEIGHBOURHOOD_VIEW_KM` (GLB-C13) around a place or a point-only
country. An L1 country or region with an area (its `target.feature`) gets
`{ kind: 'span', at: boundsCentre(featureBounds(feature)), km }` with
`km = max(L1_CONTEXT_SCALE · s, min(floor, L1_CONTEXT_MAX_SCALE · s))`, `s` being
`featureSpanKm(feature)` and the floor `NEIGHBOURHOOD_VIEW_KM` for a country and
`REGION_CONTEXT_MIN_KM` for a region. A `km` wider than
the globe can show ends at the whole sphere, since the globe's zoom never goes below its fitted
minimum (GLB-C14). Both reveal limits compare `distanceKm(tap, answer point)` with `>`, so a distance equal to the
limit is the nearer case.

### EXR-C07 The `Exercise` component
Up: EXR-06, EXR-07, EXR-10, EXR-17, EXR-18

`src/exercises/Exercise.tsx` (default export) takes `ExerciseProps` (`src/exercises/types.ts`) plus
`note?: ReactNode`:

| Prop | Is |
|---|---|
| `item: ExerciseItem` | what is asked |
| `rung: 1 \| 2 \| 3` | L1 renders `HighlightExercise`, L2 and L3 `TapExercise` |
| `seed: number` | seeds the options (`mulberry32(seed)`); a number, so React's double-run initialiser picks the same options |
| `onAnswer(result)` | called exactly once per question, when it is answered |
| `onNext()` | called when the learner presses Next after the reveal |
| `opening?: boolean` | the page's first question: an L3 country or place then starts from the whole world (an L3 region makes its own move, EXR-10) |
| `note?` | a line shown above Next once answered |

It remounts (a fresh timer, no pin, no reveal, the question's camera move) when `item.id` or
`rung` changes. The same item at the same rung again does not, so the caller keys each new
question (a session keys by question index). The timer starts at the first render's commit
(`performance.now()`).

### EXR-C08 A country's name in running text
Up: EXR-03

`countryInText(countryId: string, name: string): string` in `src/exercises/item.ts` is how the L1
region prompt names the country after "of": `the <name>` when the country's namespaced id is in
`COUNTRIES_WITH_THE`, else `<name>`. A label (`Texas, United States`) never takes the article.

| Constant | Value | Lives in |
|---|---|---|
| `COUNTRIES_WITH_THE` | `country:democratic-republic-of-the-congo`, `country:netherlands`, `country:philippines`, `country:united-states` | `src/exercises/item.ts` |

The value is the regions-tier countries (`hasRegions`) whose name takes "the" in English prose.
