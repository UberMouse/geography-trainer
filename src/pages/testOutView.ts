// Which test-out page a URL names, and the links to it, kept out of the components so they can be
// unit-tested.

import { countryItemId, regionItemId, unlockedBy, type Curriculum } from '../engine/curriculum';
import { isMastered, type ItemProgress } from '../engine/srs';
import type { Country } from '../engine/types';
import type { PlacementTier } from './placementView';

/** The tier of a test out's questions: the children of the item. */
export type TestOutTier = Exclude<PlacementTier, 'countries'>;

export type TestOutRoute =
  | {
      kind: 'run';
      /** The item being tested out of; its children are the questions. */
      itemId: string;
      countryId: string;
      tier: TestOutTier;
      /** Whether the questions need the country's regions loaded (it has a regions tier). */
      needsRegions: boolean;
    }
  /** `back` is where the message links: the country's progress page when valid, else Progress. */
  | { kind: 'unavailable'; back: string };

/**
 * What `/placement/:country[/:region]` names (a region id is the full `<country>.<region>` id).
 * The test runs for a mastered item with children, even when some child already has a row (it then
 * covers the children without one). Anything else is unavailable. The country list is checked
 * first, so an unknown country never reaches `loadRegions`.
 */
export function resolveTestOutRoute(
  curriculum: Curriculum,
  countries: readonly Country[],
  progress: Readonly<Record<string, ItemProgress>>,
  countryId: string,
  regionId?: string,
): TestOutRoute {
  const country = countries.find((c) => c.id === countryId);
  if (!country || !curriculum.items.has(countryItemId(countryId))) {
    return { kind: 'unavailable', back: '/progress' };
  }
  const unavailable = { kind: 'unavailable', back: `/progress/${countryId}` } as const;
  let itemId = countryItemId(countryId);
  if (regionId !== undefined) {
    const region = curriculum.items.get(regionItemId(regionId));
    if (
      !country.hasRegions ||
      !regionId.startsWith(`${countryId}.`) ||
      region?.tier !== 'region' ||
      region.countryId !== countryItemId(countryId)
    ) {
      return unavailable;
    }
    itemId = region.id;
  }
  const unlocked = unlockedBy(curriculum, itemId);
  const own = progress[itemId];
  if (!unlocked || !own || !isMastered(own)) return unavailable;
  return {
    kind: 'run',
    itemId,
    countryId,
    tier: unlocked.tier === 'region' ? 'regions' : 'places',
    needsRegions: country.hasRegions,
  };
}

/** The test-out page of a country or region item id. */
export function testOutPath(itemId: string): string {
  const id = itemId.slice(itemId.indexOf(':') + 1);
  if (!itemId.startsWith('region:')) return `/placement/${id}`;
  return `/placement/${id.slice(0, id.indexOf('.'))}/${id}`;
}

/** "Test out of France's regions": the page heading and the drill page's link text. */
export const testOutLabel = (name: string, tier: TestOutTier): string => `Test out of ${name}'s ${tier}`;
