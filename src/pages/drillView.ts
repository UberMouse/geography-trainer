// Plain helpers for the progress drill-down pages (`/progress/:country[/:region]`), kept out of the
// components so they can be unit-tested.

import {
  countryItemId,
  itemState,
  regionItemId,
  type Curriculum,
  type ItemState,
  type Tier,
} from '../engine/curriculum';
import type { ItemProgress } from '../engine/srs';
import type { Country } from '../engine/types';
import type { AreaFeature, LngLat } from '../maps/geo';
import { fitFlat, MAP_SIZE } from '../maps/view';
import { STATE_LABELS } from './progressView';

export type DrillRoute =
  | { kind: 'country'; countryId: string; hasRegions: boolean }
  | { kind: 'region'; countryId: string; regionId: string }
  /** `back` is where the not-found message links: the country when it is valid, else Progress. */
  | { kind: 'not-found'; back: string };

/**
 * What the URL names. A region id is the full `<country>.<region>` id. A region page needs a
 * region of that country that is in the curriculum (so a country without a regions tier, a region
 * of another country and a region with no places are all not found). Checking the country list
 * first keeps an unknown country from ever reaching `loadRegions`.
 */
export function resolveDrillRoute(
  curriculum: Curriculum,
  countries: readonly Country[],
  countryId: string,
  regionId?: string,
): DrillRoute {
  const country = countries.find((c) => c.id === countryId);
  if (!country || !curriculum.items.has(countryItemId(countryId))) {
    return { kind: 'not-found', back: '/progress' };
  }
  if (regionId === undefined) {
    return { kind: 'country', countryId, hasRegions: country.hasRegions };
  }
  const region = curriculum.items.get(regionItemId(regionId));
  if (region?.tier !== 'region' || region.countryId !== countryItemId(countryId)) {
    return { kind: 'not-found', back: `/progress/${countryId}` };
  }
  return { kind: 'region', countryId, regionId };
}

export interface ChildRow {
  itemId: string;
  tier: Tier;
  name: string;
  state: ItemState;
  stateLabel: string;
  /** "Master France to unlock" for a locked item, else null. */
  unlockText: string | null;
  /** The region's drill-down page; null for a place. */
  href: string | null;
}

/**
 * One row per child of `itemId`, sorted by name: its name, state and, when locked, what
 * unlocks it. `names` maps item ids to display names (an item missing from it shows its id).
 */
export function childRows(
  curriculum: Curriculum,
  progress: Readonly<Record<string, ItemProgress>>,
  itemId: string,
  names: ReadonlyMap<string, string>,
): ChildRow[] {
  const item = curriculum.items.get(itemId);
  if (!item) return [];
  const nameOf = (id: string) => names.get(id) ?? id;
  const rows = item.children.map((childId) => {
    const child = curriculum.items.get(childId)!;
    const state = itemState(curriculum, progress, childId);
    return {
      itemId: childId,
      tier: child.tier,
      name: nameOf(childId),
      state,
      stateLabel: STATE_LABELS[state],
      unlockText: state === 'locked' ? `Master ${nameOf(itemId)} to unlock` : null,
      href:
        child.tier === 'region'
          ? `/progress/${item.countryId.slice('country:'.length)}/${childId.slice('region:'.length)}`
          : null,
    };
  });
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Splits `items` by whether `at(item)` falls in the flat map fitted to `frame` (`fitFlat`), the
 * test the exercises use for `onGlobe`: `onMap` is drawn, `off` is named under the map.
 */
export function splitByFrame<T>(
  frame: AreaFeature,
  items: readonly T[],
  at: (item: T) => LngLat,
): { onMap: T[]; off: T[] } {
  const project = fitFlat([frame]);
  const onMap: T[] = [];
  const off: T[] = [];
  for (const item of items) {
    const p = project(at(item));
    const inside = !!p && p.every((v) => Number.isFinite(v) && v >= 0 && v <= MAP_SIZE);
    (inside ? onMap : off).push(item);
  }
  return { onMap, off };
}

/** An item named under the map because it is outside its frame. */
export interface OffMapEntry {
  id: string;
  name: string;
  /** A region (which may have a page) rather than a place (which has none). */
  isRegion: boolean;
}

/** `entries` sorted alphabetically by name, for the "Not on this map" line. */
export const sortOffMap = (entries: readonly OffMapEntry[]): OffMapEntry[] =>
  [...entries].sort((a, b) => a.name.localeCompare(b.name));

/** "No regions or places to learn here." for an item with no children. */
export const NO_CHILDREN_TEXT = 'No regions or places to learn here.';
