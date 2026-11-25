// The country -> region -> place tree, which items are unlocked, and the order new items arrive in.

import { isIntroduced, isMastered, type ItemProgress } from './srs';
import type { Country, Place, Region } from './types';

export type Tier = 'country' | 'region' | 'place';

export interface CurriculumItem {
  /** Namespaced: `country:<id>`, `region:<id>` or `place:<id>`. */
  readonly id: string;
  readonly tier: Tier;
  /** Namespaced id of the item whose mastery unlocks this one; null for countries. */
  readonly parent: string | null;
  /** Namespaced ids of the items this one unlocks, in input order. */
  readonly children: readonly string[];
  /** Namespaced id of the owning country (itself for a country). */
  readonly countryId: string;
  /** A place's `level`; a country's or region's is the minimum `level` among all its places
   * (a region always has one; a country with no places has Infinity). */
  readonly difficulty: number;
  /** The underlying place, for place items. */
  readonly place?: Readonly<Place>;
}

export interface Curriculum {
  readonly items: ReadonlyMap<string, CurriculumItem>;
  /** Total number of places per country item id, unfiltered. */
  readonly countryPlaceCount: ReadonlyMap<string, number>;
}

export interface UnlockOptions {
  /**
   * maptap `type` values to keep; undefined means every type. Places of other types are left out,
   * and so are regions with no place of a kept type (their due reviews pause too, until the filter
   * changes). Countries are always kept.
   */
  placeTypes?: ReadonlySet<string>;
}

export const countryItemId = (id: string) => `country:${id}`;
export const regionItemId = (id: string) => `region:${id}`;
export const placeItemId = (id: string) => `place:${id}`;

/** An item while the tree is being built: `children` and `difficulty` still change. */
type DraftItem = { -readonly [K in keyof CurriculumItem]: CurriculumItem[K] } & { children: string[] };

/** Throws on a duplicate country, region or place id, an unknown country, or a place without its region.
 * A region with no places (every region of a country without a regions tier, and many others) is
 * left out: it is not an item and not its country's child. */
export function buildCurriculum(
  countries: readonly Country[],
  regions: readonly Region[],
  places: readonly Place[],
): Curriculum {
  const items = new Map<string, DraftItem>();
  const countryPlaceCount = new Map<string, number>();
  const hasRegions = new Map<string, boolean>();

  for (const c of countries) {
    const id = countryItemId(c.id);
    if (items.has(id)) throw new Error(`Duplicate country id ${c.id}`);
    items.set(id, { id, tier: 'country', parent: null, children: [], countryId: id, difficulty: Infinity });
    countryPlaceCount.set(id, 0);
    hasRegions.set(id, c.hasRegions);
  }
  for (const r of regions) {
    const country = items.get(countryItemId(r.country));
    if (!country) throw new Error(`Region ${r.id} belongs to unknown country ${r.country}`);
    const id = regionItemId(r.id);
    if (items.has(id)) throw new Error(`Duplicate region id ${r.id}`);
    items.set(id, {
      id,
      tier: 'region',
      parent: country.id,
      children: [],
      countryId: country.id,
      difficulty: Infinity,
    });
    country.children.push(id);
  }
  for (const p of places) {
    const countryId = countryItemId(p.country);
    const country = items.get(countryId);
    if (!country) throw new Error(`Place ${p.id} belongs to unknown country ${p.country}`);
    let parent = country;
    if (hasRegions.get(countryId)) {
      const region = p.region === null ? undefined : items.get(regionItemId(p.region));
      if (!region) throw new Error(`Place ${p.id} has no known region in regions-tier country ${p.country}`);
      if (region.countryId !== countryId) {
        throw new Error(`Place ${p.id} names region ${p.region} of a country other than ${p.country}`);
      }
      parent = region;
    }
    const id = placeItemId(p.id);
    if (items.has(id)) throw new Error(`Duplicate place id ${p.id}`);
    items.set(id, { id, tier: 'place', parent: parent.id, children: [], countryId, difficulty: p.level, place: p });
    parent.children.push(id);
    countryPlaceCount.set(countryId, (countryPlaceCount.get(countryId) ?? 0) + 1);
    country.difficulty = Math.min(country.difficulty, p.level);
    parent.difficulty = Math.min(parent.difficulty, p.level);
  }
  for (const r of regions) {
    const region = items.get(regionItemId(r.id))!;
    if (region.children.length > 0) continue;
    items.delete(region.id);
    const country = items.get(region.parent!)!;
    country.children = country.children.filter((c) => c !== region.id);
  }
  return { items, countryPlaceCount };
}

/**
 * A curriculum of country items only (no regions, no places, so mastering a country unlocks
 * nothing). `difficulty` and `countryPlaceCount` equal what `buildCurriculum` gives each country.
 * Throws on a duplicate country id or a place of an unknown country.
 */
export function buildCountryCurriculum(countries: readonly Country[], places: readonly Place[]): Curriculum {
  const items = new Map<string, CurriculumItem>();
  const countryPlaceCount = new Map<string, number>();
  const difficulty = new Map<string, number>();
  for (const c of countries) {
    const id = countryItemId(c.id);
    if (items.has(id)) throw new Error(`Duplicate country id ${c.id}`);
    items.set(id, { id, tier: 'country', parent: null, children: [], countryId: id, difficulty: Infinity });
    countryPlaceCount.set(id, 0);
    difficulty.set(id, Infinity);
  }
  for (const p of places) {
    const id = countryItemId(p.country);
    if (!items.has(id)) throw new Error(`Place ${p.id} belongs to unknown country ${p.country}`);
    countryPlaceCount.set(id, countryPlaceCount.get(id)! + 1);
    difficulty.set(id, Math.min(difficulty.get(id)!, p.level));
  }
  for (const [id, item] of items) items.set(id, { ...item, difficulty: difficulty.get(id)! });
  return { items, countryPlaceCount };
}

/**
 * Unlocked items, mastered and in-progress ones included. A mastered parent unlocks its children.
 * With `placeTypes`, places of other types are left out, and so are regions with no place of those
 * types; countries are always kept.
 */
export function unlockedItems(
  curriculum: Curriculum,
  progress: Readonly<Record<string, ItemProgress>>,
  opts: UnlockOptions = {},
): CurriculumItem[] {
  const out: CurriculumItem[] = [];
  for (const item of curriculum.items.values()) {
    const types = opts.placeTypes;
    if (types && item.place && !types.has(item.place.type)) continue;
    if (types && item.tier === 'region') {
      const hasMatch = item.children.some((c) => types.has(curriculum.items.get(c)!.place!.type));
      if (!hasMatch) continue;
    }
    if (item.parent !== null) {
      const parentProgress = progress[item.parent];
      if (!parentProgress || !isMastered(parentProgress)) continue;
    }
    out.push(item);
  }
  return out;
}

function compareNew(curriculum: Curriculum) {
  return (a: CurriculumItem, b: CurriculumItem): number => {
    if (a.difficulty !== b.difficulty) return a.difficulty < b.difficulty ? -1 : 1;
    const ca = curriculum.countryPlaceCount.get(a.countryId) ?? 0;
    const cb = curriculum.countryPlaceCount.get(b.countryId) ?? 0;
    if (ca !== cb) return cb - ca;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/** Unlocked items that are still new: no progress yet, or progress that has never been answered
 * (a fresh or placement-seeded item, see `isIntroduced`). Lowest difficulty first, then the owning country's
 * place count (descending), then id. */
export function newItems(
  curriculum: Curriculum,
  progress: Readonly<Record<string, ItemProgress>>,
  opts: UnlockOptions = {},
): CurriculumItem[] {
  return unlockedItems(curriculum, progress, opts)
    .filter((item) => {
      const p = progress[item.id];
      return !p || !isIntroduced(p);
    })
    .sort(compareNew(curriculum));
}
