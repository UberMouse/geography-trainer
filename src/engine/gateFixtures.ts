// Test data for the deeper-tier gate (CUR-21): countries that exist only to be counted as mastered.

import { GATE_WAVE2_MASTERED_COUNTRIES } from './config';
import { countryItemId } from './curriculum';
import type { ItemProgress } from './srs';
import type { Country } from './types';

/**
 * `n` countries with no places (`filler-000`, `filler-001`, ...). With no places they have no
 * children, no band (Infinity difficulty) and no effect on any other country's band or place
 * count, so adding them to a curriculum changes nothing but what `masteredCountryCount` can reach.
 * The default opens every gate.
 */
export const gateFillers = (n: number = GATE_WAVE2_MASTERED_COUNTRIES): Country[] =>
  Array.from({ length: n }, (_, i) => {
    const id = `filler-${String(i).padStart(3, '0')}`;
    return { id, name: id, places: 0, hasRegions: false };
  });

/** `progress` plus every country of `fillers` mastered, each a copy of `mastered` (a mastered
 * row) under the filler's item id. */
export function withFillersMastered(
  progress: Readonly<Record<string, ItemProgress>>,
  mastered: ItemProgress,
  fillers: readonly Country[] = gateFillers(),
): Record<string, ItemProgress> {
  const out: Record<string, ItemProgress> = { ...progress };
  for (const c of fillers) out[countryItemId(c.id)] = { ...mastered, itemId: countryItemId(c.id) };
  return out;
}
