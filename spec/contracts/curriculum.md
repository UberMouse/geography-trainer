# Curriculum contracts (CUR)

`src/engine/curriculum.ts` and the constants it reads. Mastery itself (`isMastered`) is the
grading area's (GRD-C06, GRD-C08). The module is pure: it imports
nothing from React, the DOM, storage or maps, and every function returns the same output for the
same input.

### CUR-C01 Regions-tier thresholds
Up: DAT-21

| Constant | Value | Meaning |
|---|---|---|
| `REGIONS_TIER_MIN_REGIONS` | 4 | regions that hold at least one place |
| `REGIONS_TIER_MIN_PLACES` | 15 | places in the country |

Both must be met (`>=`). Live in `src/engine/config.ts`. Applied when the data is generated, by
`hasRegionsTier(regionsWithPlaces, places)` in `scripts/build-data/assign-regions.ts`; the result
is each country's `hasRegions` property in `public/data/countries.topo.json`, which the app reads
as given.

### CUR-C03 Difficulty bands
Up: CUR-20

| Constant | Value |
|---|---|
| `DIFFICULTY_LEVELS` | 8 bands |
| `DIFFICULTY_MEAN_LEVEL_WEIGHT` | 0.4 |

Live in `src/engine/config.ts`.
`bandDifficulty(stats: ReadonlyMap<id, { count, meanLevel }>): Map<id, number>`:

- score = `-ln(count) + DIFFICULTY_MEAN_LEVEL_WEIGHT * meanLevel`; sorted ascending, ties by id.
- band of the item at rank `i` (0-based) of `n` = `1 + floor(i * DIFFICULTY_LEVELS / n)`, so
  bands run 1..8 and are as equal as `n` allows (with `n < 8` some bands are empty).
- `count === 0` gives `Infinity`, and the item takes no rank.

`buildCurriculum` bands every country against all countries and each country's regions against
each other, with `count` and `meanLevel` over the item's own places. A place's `difficulty` is its
`level` (maptap's `difficultyLevel`, 1–8).

### CUR-C04 Item ids and the item shape
Up: CUR-03, CUR-05

Ids are namespaced by tier, so a place and a country with the same data id never collide:
`countryItemId(id)` = `country:<id>`, `regionItemId(id)` = `region:<id>`,
`placeItemId(id)` = `place:<id>`.

```ts
type Tier = 'country' | 'region' | 'place';
interface CurriculumItem {
  id: string;                     // namespaced
  tier: Tier;
  parent: string | null;          // the item whose mastery unlocks this one; null for a country
  children: readonly string[];    // namespaced, in input order
  countryId: string;              // the owning country's item id (itself for a country)
  difficulty: number;             // CUR-C03
  center: readonly [lng, lat] | null; // spherical mean of the places; a place's own point; null with no places
  place?: Place;                  // place items only
}
interface Curriculum {
  items: ReadonlyMap<string, CurriculumItem>; // countries, then regions, then places, each in input order
  countryPlaceCount: ReadonlyMap<string, number>; // places per country item id, unfiltered
}
```

### CUR-C05 Building the tree
Up: CUR-03, CUR-06, CUR-07

`buildCurriculum(countries: Country[], regions: {id, country}[], places: Place[]): Curriculum`

- A place's parent is its region when its country has `hasRegions`, else its country.
- A region left with no places is dropped: not an item, not a child.
- Throws an `Error` naming the id on a duplicate country, region or place id; a region or place of
  an unknown country; a place in a `hasRegions` country whose `region` is null or unknown; a place
  whose region belongs to another country.
- A `Country`'s own `places` field is not read: counts come from `places`.

`regionsFromPlaces(countries, places): {id, country}[]`: one entry per distinct region id named by
a place of a `hasRegions` country, in first-seen order. Places with `region: null` and places of
other countries add nothing. The app builds its tree as
`buildCurriculum(countries, regionsFromPlaces(countries, places), places)`.

### CUR-C06 Unlocked and new items
Up: CUR-01, CUR-08, CUR-09, CUR-10, CUR-11, CUR-12, CUR-18, CUR-19

```ts
interface UnlockOptions { placeTypes?: ReadonlySet<string> } // undefined: every type
unlockedItems(curriculum, progress: Record<itemId, ItemProgress>, opts?): CurriculumItem[]
newItems(curriculum, progress, opts?): CurriculumItem[]
```

- `unlockedItems`: in `items` order, the items whose parent is null; or whose parent is a region
  that `isMastered` (GRD-C08); or whose parent is a country that `isMastered` and either
  `gateOpen` holds for it (CUR-C08) or the item itself `isIntroduced`. Only the direct parent is
  checked. With `placeTypes`, places of other types and regions with no child of those types are
  dropped; countries are always kept.
- `newItems`: `unlockedItems` without the ones that are `isIntroduced` (some card has
  `reps > 0`), sorted by `difficulty` ascending (plus `DEEPER_TIER_ORDER_OFFSET` for a region or
  a place; the item's own `difficulty` is unchanged), then `countryPlaceCount` of the owning
  country descending, then id ascending.

### CUR-C07 States and counts
Up: CUR-14, CUR-15, CUR-16, CUR-17

```ts
type ItemState = 'locked' | 'new' | 'learning' | 'mastered';
itemState(curriculum, progress, itemId): ItemState
subtreeProgress(curriculum, progress, itemId): { total, mastered, learning, unlocked }
masteredShare(s): number                       // mastered / total, 0 when total is 0
tierCounts(curriculum, progress): Record<Tier, { total, learning, learned }>
unlockedBy(curriculum, itemId): { tier: 'region' | 'place'; childIds: string[] } | null
```

- `itemState`: `locked` when the item is not unlocked by `unlockedItems`' rule (CUR-C06, without
  a place-type filter); else `mastered` (`isMastered`),
  `learning` (`isStudied`: `introducedAt` set, or a card with `reps > 1`), or `new`.
- `subtreeProgress` counts descendants only; `unlocked` is every state but `locked`.
- `tierCounts`: `learned` is mastered, `learning` is studied and not mastered; ids not in
  `items` are ignored. It does not look at lock state.
- `unlockedBy`: the item's children and the tier of the first; null when it has none.
- `itemState`, `subtreeProgress` and `unlockedBy` throw an `Error` for an id not in `items`.

### CUR-C08 The deeper-tier gate
Up: CUR-19, CUR-21, CUR-22

| Constant | Value | Meaning |
|---|---|---|
| `GATE_WAVE1_MIN_PLACES` | 50 | a country with at least this many places (`countryPlaceCount`, unfiltered) is in the first wave |
| `GATE_WAVE1_MASTERED_COUNTRIES` | 60 | mastered countries that open a first-wave country's children |
| `GATE_WAVE2_MASTERED_COUNTRIES` | 150 | mastered countries that open every other country's children |
| `DEEPER_TIER_ORDER_OFFSET` | 3 | bands added to a region's or a place's difficulty when ordering new items |

Live in `src/engine/config.ts`. In `src/engine/curriculum.ts`:

```ts
masteredCountryCount(curriculum, progress): number        // country items that isMastered; ids not in items ignored
countryGate(curriculum, countryItemId): number            // 60 when countryPlaceCount >= 50, else 150
gateOpen(curriculum, progress, countryItemId): boolean    // masteredCountryCount >= countryGate
```

`countryGate` and `gateOpen` throw an `Error` for an id that is not a country item.
