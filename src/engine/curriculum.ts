// The country -> region -> place tree, which items are unlocked, and the order new items arrive in.

import { DIFFICULTY_LEVELS, DIFFICULTY_MEAN_LEVEL_WEIGHT } from './config';
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
  /** A place's `level`. A country's is its band (1-DIFFICULTY_LEVELS) among all countries, a
   * region's its band among its country's regions (`bandDifficulty`); a country with no places
   * has Infinity. */
  readonly difficulty: number;
  /** `[lng, lat]`: a place's point, or the spherical mean of a country's or region's places; null
   * for a country with no places. */
  readonly center: readonly [number, number] | null;
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

/** What banding needs of an item's places: how many and their mean level. */
export interface PlaceStats {
  count: number;
  meanLevel: number;
}

/**
 * Difficulty bands for a group of sibling items: each is ranked by
 * `-ln(count) + DIFFICULTY_MEAN_LEVEL_WEIGHT * meanLevel` (ties by id) and the ranking cut into
 * DIFFICULTY_LEVELS equal bands, 1 the easiest. An item with no places gets Infinity.
 */
export function bandDifficulty(stats: ReadonlyMap<string, PlaceStats>): Map<string, number> {
  const out = new Map<string, number>();
  const ranked: { id: string; score: number }[] = [];
  for (const [id, { count, meanLevel }] of stats) {
    if (count === 0) out.set(id, Infinity);
    else ranked.push({ id, score: -Math.log(count) + DIFFICULTY_MEAN_LEVEL_WEIGHT * meanLevel });
  }
  ranked.sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ranked.forEach(({ id }, i) => out.set(id, 1 + Math.floor((i * DIFFICULTY_LEVELS) / ranked.length)));
  return out;
}

const RAD = Math.PI / 180;

/** The spherical mean of `[lng, lat]` points (so a group across the antimeridian stays together);
 * null for none. */
function sphericalMean(points: readonly (readonly [number, number])[]): readonly [number, number] | null {
  if (points.length === 0) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [lng, lat] of points) {
    x += Math.cos(lat * RAD) * Math.cos(lng * RAD);
    y += Math.cos(lat * RAD) * Math.sin(lng * RAD);
    z += Math.sin(lat * RAD);
  }
  return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];
}

/**
 * One `{ id, country }` per distinct region id named by a place of a country with `hasRegions`, in
 * first-seen order. Places of other countries, and places with `region: null`, contribute nothing.
 */
export function regionsFromPlaces(
  countries: readonly Pick<Country, 'id' | 'hasRegions'>[],
  places: readonly Pick<Place, 'country' | 'region'>[],
): Pick<Region, 'id' | 'country'>[] {
  const withRegions = new Set(countries.filter((c) => c.hasRegions).map((c) => c.id));
  const seen = new Set<string>();
  const out: Pick<Region, 'id' | 'country'>[] = [];
  for (const p of places) {
    if (p.region === null || !withRegions.has(p.country) || seen.has(p.region)) continue;
    seen.add(p.region);
    out.push({ id: p.region, country: p.country });
  }
  return out;
}

/** Throws on a duplicate country, region or place id, an unknown country, or a place without its region.
 * A region with no places (every region of a country without a regions tier, and many others) is
 * left out: it is not an item and not its country's child. */
export function buildCurriculum(
  countries: readonly Country[],
  regions: readonly Pick<Region, 'id' | 'country'>[],
  places: readonly Place[],
): Curriculum {
  const items = new Map<string, DraftItem>();
  const countryPlaceCount = new Map<string, number>();
  const hasRegions = new Map<string, boolean>();
  const placesOf = new Map<string, Place[]>();

  for (const c of countries) {
    const id = countryItemId(c.id);
    if (items.has(id)) throw new Error(`Duplicate country id ${c.id}`);
    items.set(id, { id, tier: 'country', parent: null, children: [], countryId: id, difficulty: Infinity, center: null });
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
      center: null,
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
    const center = [p.lng, p.lat] as const;
    items.set(id, { id, tier: 'place', parent: parent.id, children: [], countryId, difficulty: p.level, center, place: p });
    parent.children.push(id);
    countryPlaceCount.set(countryId, (countryPlaceCount.get(countryId) ?? 0) + 1);
    for (const owner of new Set([country, parent])) {
      const list = placesOf.get(owner.id) ?? [];
      list.push(p);
      placesOf.set(owner.id, list);
    }
  }
  const statsOf = (ids: readonly string[]) =>
    new Map(
      ids.map((id): [string, PlaceStats] => {
        const list = placesOf.get(id) ?? [];
        const meanLevel = list.reduce((sum, p) => sum + p.level, 0) / Math.max(1, list.length);
        return [id, { count: list.length, meanLevel }];
      }),
    );
  const setBands = (ids: readonly string[]) => {
    for (const [id, band] of bandDifficulty(statsOf(ids))) {
      const item = items.get(id)!;
      item.difficulty = band;
      item.center = sphericalMean((placesOf.get(id) ?? []).map((p) => [p.lng, p.lat] as const));
    }
  };
  const countryIds = [...items.values()].filter((i) => i.tier === 'country').map((i) => i.id);
  setBands(countryIds);
  for (const id of countryIds) {
    const regionIds = items.get(id)!.children.filter((c) => items.get(c)!.tier === 'region');
    setBands(regionIds);
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

export type ItemState = 'locked' | 'new' | 'learning' | 'mastered';

export interface SubtreeProgress {
  /** Descendants of the item (children, grandchildren), not the item itself. */
  total: number;
  mastered: number;
  /** Introduced and not mastered. */
  learning: number;
  /** Descendants that are not locked. */
  unlocked: number;
}

export interface TierCount {
  total: number;
  /** Introduced and not mastered. */
  learning: number;
  /** Mastered. */
  learned: number;
}

type ProgressMap = Readonly<Record<string, ItemProgress>>;

function itemOrThrow(curriculum: Curriculum, itemId: string): CurriculumItem {
  const item = curriculum.items.get(itemId);
  if (!item) throw new Error(`Unknown curriculum item ${itemId}`);
  return item;
}

function stateOf(item: CurriculumItem, progress: ProgressMap): ItemState {
  if (item.parent !== null) {
    const parent = progress[item.parent];
    if (!parent || !isMastered(parent)) return 'locked';
  }
  const own = progress[item.id];
  if (own && isMastered(own)) return 'mastered';
  if (own && isIntroduced(own)) return 'learning';
  return 'new';
}

/** Locked while the parent is not mastered; else mastered, learning (introduced) or new. Throws for an unknown id. */
export function itemState(curriculum: Curriculum, progress: ProgressMap, itemId: string): ItemState {
  return stateOf(itemOrThrow(curriculum, itemId), progress);
}

/** Counts over every descendant of the item, in one walk of its subtree. Throws for an unknown id. */
export function subtreeProgress(curriculum: Curriculum, progress: ProgressMap, itemId: string): SubtreeProgress {
  const out: SubtreeProgress = { total: 0, mastered: 0, learning: 0, unlocked: 0 };
  const stack = [...itemOrThrow(curriculum, itemId).children];
  while (stack.length > 0) {
    const item = curriculum.items.get(stack.pop()!)!;
    const state = stateOf(item, progress);
    out.total++;
    if (state === 'mastered') out.mastered++;
    else if (state === 'learning') out.learning++;
    if (state !== 'locked') out.unlocked++;
    stack.push(...item.children);
  }
  return out;
}

/** `mastered / total`, 0 for an empty subtree. */
export const masteredShare = (s: SubtreeProgress): number => (s.total === 0 ? 0 : s.mastered / s.total);

/** Per-tier totals over the curriculum's items; progress rows for other ids are ignored. */
export function tierCounts(curriculum: Curriculum, progress: ProgressMap): Record<Tier, TierCount> {
  const out: Record<Tier, TierCount> = {
    country: { total: 0, learning: 0, learned: 0 },
    region: { total: 0, learning: 0, learned: 0 },
    place: { total: 0, learning: 0, learned: 0 },
  };
  for (const item of curriculum.items.values()) {
    const count = out[item.tier];
    count.total++;
    const own = progress[item.id];
    if (!own) continue;
    if (isMastered(own)) count.learned++;
    else if (isIntroduced(own)) count.learning++;
  }
  return out;
}

/** What mastering the item unlocks: its children and their tier; null when it has none. Throws for an unknown id. */
export function unlockedBy(
  curriculum: Curriculum,
  itemId: string,
): { tier: 'region' | 'place'; childIds: string[] } | null {
  const { children } = itemOrThrow(curriculum, itemId);
  if (children.length === 0) return null;
  const tier = curriculum.items.get(children[0]!)!.tier as 'region' | 'place';
  return { tier, childIds: [...children] };
}
