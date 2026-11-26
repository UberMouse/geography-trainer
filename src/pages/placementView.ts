// Wording and counts for the placement test, kept out of the components so they can be unit-tested.

import { PLACEMENT_MAX_LEVEL, PLACEMENT_MAX_QUESTIONS } from '../engine/config';
import type { PlacementResult } from '../engine/placement';

/** What a placement test is over: the tier whose items are tested. */
export type PlacementTier = 'countries' | 'regions' | 'places';

const NOUNS: Record<PlacementTier, { one: string; many: string }> = {
  countries: { one: 'country', many: 'countries' },
  regions: { one: 'region', many: 'regions' },
  places: { one: 'place', many: 'places' },
};

const count = (n: number, tier: PlacementTier) => `${n} ${n === 1 ? NOUNS[tier].one : NOUNS[tier].many}`;

/**
 * "Placement: question 3 of up to 20", with `answered` questions already answered and
 * `askable` items that can be asked (the test asks at most `PLACEMENT_MAX_QUESTIONS`).
 */
export const placementHeader = (answered: number, askable: number): string =>
  `Placement: question ${answered + 1} of up to ${Math.min(PLACEMENT_MAX_QUESTIONS, askable)}`;

/** A pass that failed to save as it was answered: the item and the error's message. */
export interface FailedSave {
  itemId: string;
  message: string;
}

/** The alert for answers that could not be saved (with the latest error), or null when none failed. */
export function saveFailureText(failed: readonly FailedSave[]): string | null {
  if (failed.length === 0) return null;
  const last = failed[failed.length - 1]!.message;
  // No second full stop when the message already ends a sentence.
  const message = /[.!?]$/.test(last) ? last : `${last}.`;
  return failed.length === 1
    ? `1 answer could not be saved: ${message} Finish the test to save it.`
    : `${failed.length} answers could not be saved: ${message} Finish the test to save them.`;
}

/**
 * The message for a test with nothing to test. A test out of `scopeName` (a country or region)
 * says what in it is already placed or being studied.
 */
export const emptyPoolText = (tier: PlacementTier, scopeName?: string): string =>
  scopeName === undefined
    ? `There is nothing left to place: every ${NOUNS[tier].one} is already placed or being studied.`
    : `There is nothing left to test: all of ${scopeName}'s ${NOUNS[tier].many} are already placed or being studied.`;

/** The message for a pool none of whose items can be asked (none has a difficulty). */
export const NOTHING_TO_ASK_TEXT = 'There are no questions to ask here yet.';

/** The result screen's lines, from the estimate and how each tested item came out. */
export function resultLines(result: PlacementResult, tier: PlacementTier): string[] {
  const outcomes = Object.values(result.outcomes);
  const passed = outcomes.filter((o) => o === 'passed').length;
  const known = outcomes.filter((o) => o === 'likelyKnown').length;
  const close = outcomes.filter((o) => o === 'close').length;
  const below = outcomes.filter((o) => o === 'untestedAtOrBelow').length;
  const rest = outcomes.length - passed - known - close - below;
  if (result.estimate === 0 && passed + known + close + below === 0) {
    return ['No level placed yet: everything starts from the beginning.'];
  }
  const lines = [result.estimate === 0 ? 'No level placed yet.' : `Your level: ${result.estimate} of ${PLACEMENT_MAX_LEVEL}.`];
  if (passed > 0) {
    const verb = passed === 1 ? 'comes' : 'come';
    lines.push(`${count(passed, tier)} you got right ${verb} back within a couple of days to confirm.`);
  }
  if (known > 0) {
    const verb = known === 1 ? 'comes' : 'come';
    lines.push(`${count(known, tier)} you very likely know ${verb} back one at a time over the next few weeks to confirm.`);
  }
  if (close + below > 0) {
    const verb = close + below === 1 ? 'starts' : 'start';
    const who = close > 0 && below > 0 ? 'you were close on or probably know' : close > 0 ? 'you were close on' : 'you probably know';
    lines.push(`${count(close + below, tier)} ${who} ${verb} at tapping on a bordered map.`);
  }
  if (rest > 0) lines.push(`The other ${rest} ${rest === 1 ? 'starts' : 'start'} from the beginning.`);
  return lines;
}
