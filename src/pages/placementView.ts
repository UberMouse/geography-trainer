// Wording and counts for the placement test, kept out of the components so they can be unit-tested.

import { PLACEMENT_MAX_QUESTIONS } from '../engine/config';
import type { PlacementResult } from '../engine/placement';

/** What a placement test is over: the tier whose items are tested. */
export type PlacementTier = 'countries' | 'regions' | 'places';

const NOUNS: Record<PlacementTier, { one: string; many: string }> = {
  countries: { one: 'country', many: 'countries' },
  regions: { one: 'region', many: 'regions' },
  places: { one: 'place', many: 'places' },
};

const count = (n: number, tier: PlacementTier) => `${n} ${n === 1 ? NOUNS[tier].one : NOUNS[tier].many}`;

/** "Placement: question 3 of up to 20", with `answered` questions already answered. */
export const placementHeader = (answered: number): string =>
  `Placement: question ${answered + 1} of up to ${PLACEMENT_MAX_QUESTIONS}`;

/** The message for a test with nothing to test. */
export const emptyPoolText = (tier: PlacementTier): string =>
  `There is nothing left to place: you have started every ${NOUNS[tier].one}.`;

/** The message for a pool none of whose items can be asked (none has a difficulty). */
export const NOTHING_TO_ASK_TEXT = 'There are no questions to ask here yet.';

/** The result screen's lines, from the estimate and how each tested item came out. */
export function resultLines(result: PlacementResult, tier: PlacementTier): string[] {
  const outcomes = Object.values(result.outcomes);
  const passed = outcomes.filter((o) => o === 'passed').length;
  const below = outcomes.filter((o) => o === 'untestedAtOrBelow').length;
  const rest = outcomes.length - passed - below;
  const lines = [
    result.estimate === 0
      ? 'No level placed yet: everything starts from the beginning.'
      : `Your level: ${result.estimate} of 8.`,
  ];
  if (passed > 0) lines.push(`${count(passed, tier)} you got right come back within a couple of days to confirm.`);
  if (below > 0) lines.push(`${count(below, tier)} at or below your level start at tapping on a bordered map.`);
  if (rest > 0) lines.push(`The other ${rest} start from the beginning.`);
  return lines;
}
