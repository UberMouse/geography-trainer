// Plain helpers for Home's placement offer, kept out of the component so they can be unit-tested.

import { isStudied, placementPool } from '../engine/placement';
import type { Curriculum } from '../engine/curriculum';
import type { ItemProgress } from '../engine/srs';
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
