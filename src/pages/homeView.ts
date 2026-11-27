// Plain helpers for Home's placement offer, kept out of the component so they can be unit-tested.

import { isStudied, placementPool } from '../engine/placement';
import type { Curriculum } from '../engine/curriculum';
import { itemsDone } from '../engine/sessionRun';
import type { ItemProgress } from '../engine/srs';
import type { SavedSession } from '../storage/sessionRunStore';
import { COUNTRIES_SCOPE, placementKey } from '../storage/placementKeys';

/**
 * Whether Home offers the placement test: while no item has been studied (`isStudied`: a
 * placement seed alone is not studied) and some country is left to place.
 */
export const offersPlacement = (curriculum: Curriculum, progress: Readonly<Record<string, ItemProgress>>): boolean =>
  !Object.values(progress).some(isStudied) && placementPool(curriculum, progress, 'countries').length > 0;

/**
 * Whether Home shows the placement offer: `offersPlacement` holds and the countries test has no
 * marker in `finishedTests` (the marker keys of the finished tests).
 */
export const showsPlacementOffer = (
  curriculum: Curriculum,
  progress: Readonly<Record<string, ItemProgress>>,
  finishedTests: ReadonlySet<string>,
): boolean =>
  !finishedTests.has(placementKey(COUNTRIES_SCOPE)) && offersPlacement(curriculum, progress);

/** Home's "new today" line: the limit may have been lowered below what was already started. */
export const newTodayText = (newToday: number, cap: number): string =>
  newToday > cap ? `${newToday} new today (limit ${cap})` : `${newToday} of ${cap} new today`;

/**
 * The items left in a kept session (SCR-C06), or null when Home offers Start instead: nothing is
 * kept, or the kept run has no questions left (a last-of-day summary).
 */
export const itemsLeft = (kept: SavedSession | null): number | null =>
  kept && kept.run.queue.length > 0 ? kept.run.itemTotal - itemsDone(kept.run) : null;
