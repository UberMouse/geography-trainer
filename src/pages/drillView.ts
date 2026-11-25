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
 * One row per child of `itemId`, in curriculum order: its name, state and, when locked, what
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
  return item.children.map((childId) => {
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
}

/** "No regions or places to learn here." for an item with no children. */
export const NO_CHILDREN_TEXT = 'No regions or places to learn here.';
