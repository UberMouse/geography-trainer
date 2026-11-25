// Plain helpers for the progress map and the Progress page, kept out of the components so they can
// be unit-tested. `progressFill` is shared with the drill-down maps.

import {
  countryItemId,
  itemState,
  subtreeProgress,
  type Curriculum,
  type ItemState,
  type SubtreeProgress,
  type Tier,
  type TierCount,
} from '../engine/curriculum';
import type { ItemProgress } from '../engine/srs';
import type { Country } from '../engine/types';

/** The state names as shown to the user, in legend order. */
export const STATE_LABELS: Record<ItemState, string> = {
  locked: 'Locked',
  new: 'New',
  learning: 'Learning',
  mastered: 'Mastered',
};

/**
 * The CSS fill of an item on a progress map. Locked, new and learning use their own colour; a
 * mastered item is mixed between `--progress-mastered` and `--progress-complete` by the share of
 * its descendants that are mastered, and an item with no descendants is `--progress-complete`.
 */
export function progressFill(
  state: ItemState,
  subtree: Pick<SubtreeProgress, 'total' | 'mastered'>,
): string {
  if (state !== 'mastered') return `var(--progress-${state})`;
  if (subtree.total === 0) return 'var(--progress-complete)';
  const percent = Math.round((subtree.mastered / subtree.total) * 100);
  return `color-mix(in oklab, var(--progress-complete) ${percent}%, var(--progress-mastered))`;
}

export interface CountryLook {
  state: ItemState;
  fill: string;
}

/** An item's state and fill; a mastered one deepens with the share of its descendants mastered. */
export function itemLook(
  curriculum: Curriculum,
  progress: Readonly<Record<string, ItemProgress>>,
  itemId: string,
): CountryLook {
  const state = itemState(curriculum, progress, itemId);
  // Only a mastered item's fill depends on its subtree: skip the walk for the rest.
  const subtree =
    state === 'mastered'
      ? subtreeProgress(curriculum, progress, itemId)
      : { total: 0, mastered: 0 };
  return { state, fill: progressFill(state, subtree) };
}

const LOCKED_LOOK: CountryLook = { state: 'locked', fill: 'var(--progress-locked)' };

/** A map's `look` callback: the entry in `looks`, else locked. */
export const lookOrLocked =
  (looks: ReadonlyMap<string, CountryLook>) =>
  (id: string): CountryLook =>
    looks.get(id) ?? LOCKED_LOOK;

/** Each country's state and fill, for the countries that are in the curriculum. */
export function countryLooks(
  curriculum: Curriculum,
  progress: Readonly<Record<string, ItemProgress>>,
  countries: readonly Country[],
): Map<string, CountryLook> {
  const looks = new Map<string, CountryLook>();
  for (const { id } of countries) {
    const itemId = countryItemId(id);
    if (curriculum.items.has(itemId)) looks.set(id, itemLook(curriculum, progress, itemId));
  }
  return looks;
}

/** The countries that are learning or mastered, alphabetical by name. */
export function startedCountries(
  countries: readonly Country[],
  looks: ReadonlyMap<string, CountryLook>,
): { country: Country; state: ItemState }[] {
  return countries
    .flatMap((country) => {
      const state = looks.get(country.id)?.state;
      return state === 'learning' || state === 'mastered' ? [{ country, state }] : [];
    })
    .sort((a, b) => a.country.name.localeCompare(b.country.name));
}

/** Every country as a `{ id, name }` option, alphabetical by name. */
export function countryOptions(countries: readonly Country[]): { id: string; name: string }[] {
  return countries
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const TIER_LABELS: Record<Tier, [string, string]> = {
  country: ['Country', 'Countries'],
  region: ['Region', 'Regions'],
  place: ['Place', 'Places'],
};

/** "Countries: 12 learned, 5 learning of 243". */
export function tierCountText(tier: Tier, count: TierCount): string {
  const [one, many] = TIER_LABELS[tier];
  return `${count.total === 1 ? one : many}: ${count.learned} learned, ${count.learning} learning of ${count.total}`;
}
