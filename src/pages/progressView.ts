// Plain helpers for the progress globe and the Progress page, kept out of the components so they
// can be unit-tested. `progressFill` is shared with the drill-down pages.

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
 * The progress colours, as hex: the globe's layers take them (MapLibre parses no CSS variables),
 * and so do the legend's swatches. `complete` is a mastered item with everything below it mastered.
 */
export const PROGRESS_COLOURS: Record<ItemState | 'complete', string> = {
  locked: '#404040',
  new: '#a16207',
  learning: '#ea580c',
  mastered: '#4d8f63',
  complete: '#4ade80',
};

/**
 * The fill of an item on the progress globe. Locked, new and learning use their own colour; a
 * mastered item is mixed between `mastered` and `complete` by the share of its descendants that
 * are mastered, and an item with no descendants is `complete`.
 */
export function progressFill(
  state: ItemState,
  subtree: Pick<SubtreeProgress, 'total' | 'mastered'>,
): string {
  if (state !== 'mastered') return PROGRESS_COLOURS[state];
  if (subtree.total === 0) return PROGRESS_COLOURS.complete;
  const share = Math.round((subtree.mastered / subtree.total) * 100) / 100;
  return mixOklab(PROGRESS_COLOURS.mastered, PROGRESS_COLOURS.complete, share);
}

type Triple = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** A `#rrggbb` colour in Oklab (Björn Ottosson's matrices). */
function hexToOklab(hex: string): Triple {
  const [r, g, b] = [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255)) as Triple;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** An Oklab colour as `#rrggbb`, each channel clamped to the sRGB range. */
function oklabToHex([L, a, b]: Triple): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb
    .map((c) => Math.round(Math.min(1, Math.max(0, fromLinear(c))) * 255))
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * `from` and `to` (`#rrggbb`) mixed in Oklab, `share` (0 to 1) of the way to `to`: what CSS's
 * `color-mix(in oklab, to share, from)` gives.
 */
export function mixOklab(from: string, to: string, share: number): string {
  const a = hexToOklab(from);
  const b = hexToOklab(to);
  return oklabToHex(a.map((v, i) => v + (b[i]! - v) * share) as Triple);
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

const LOCKED_LOOK: CountryLook = { state: 'locked', fill: PROGRESS_COLOURS.locked };

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
