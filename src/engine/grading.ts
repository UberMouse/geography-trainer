import { Rating, type Grade } from 'ts-fsrs';
import {
  COUNTRY_NEAR_MISS_KM,
  MAPTAP_SCORE_DECAY,
  MAPTAP_SCORE_KM,
  MC_FAST_MS,
  MC_SLOW_MS,
  PLACE_EASY_KM,
  PLACE_GOOD_KM,
  PLACE_HARD_KM,
  REGION_NEAR_MISS_KM,
  TAP_EASY_FRACTION,
} from './config';

export interface TapInput {
  tier: 'country' | 'region' | 'place';
  /** Whether the tap landed inside the target's polygon. */
  inside: boolean;
  /** Distance from the tap to the answer point. */
  kmFromAnswer: number;
  /** Distance from the tap to the target's border (used when outside). */
  kmOutsideBorder: number;
  /** A size for the target feature, for the Easy test. */
  featureSizeKm: number;
}

/** maptap's score before rounding: 0 at 16,250 km and beyond. */
export function maptapScoreRaw(km: number, inside = false): number {
  if (inside) return 100;
  if (Number.isNaN(km) || km < 0) throw new RangeError(`km must be a non-negative number, got ${km}`);
  if (km >= MAPTAP_SCORE_KM) return 0;
  return 100 * Math.exp((-MAPTAP_SCORE_DECAY * km) / MAPTAP_SCORE_KM);
}

/** maptap's score for a tap: 100 inside the target, else round(100 * exp(-3.5 * km / 16250)). */
export function maptapScore(km: number, inside = false): number {
  return Math.round(maptapScoreRaw(km, inside));
}

/** Grade a multiple-choice answer: wrong is Again; correct is Easy/Good/Hard by speed. */
export function gradeMultipleChoice(correct: boolean, timeMs: number): Grade {
  if (Number.isNaN(timeMs) || timeMs < 0) {
    throw new RangeError(`timeMs must be a non-negative number, got ${timeMs}`);
  }
  if (!correct) return Rating.Again;
  if (timeMs < MC_FAST_MS) return Rating.Easy;
  if (timeMs > MC_SLOW_MS) return Rating.Hard;
  return Rating.Good;
}

function requireDistance(name: string, km: number): void {
  if (Number.isNaN(km) || km < 0) throw new RangeError(`${name} must be a non-negative number, got ${km}`);
}

/**
 * Grade a tap from quantities the map layer measured. Throws a RangeError for a NaN or negative
 * distance the tier/branch uses; a field the branch ignores is not checked. featureSizeKm <= 0 is
 * valid and means "never Easy".
 */
export function gradeTap(input: TapInput): Grade {
  const { tier, inside, kmFromAnswer, kmOutsideBorder, featureSizeKm } = input;
  if (tier === 'place') {
    requireDistance('kmFromAnswer', kmFromAnswer);
    if (kmFromAnswer < PLACE_EASY_KM) return Rating.Easy;
    if (kmFromAnswer < PLACE_GOOD_KM) return Rating.Good;
    if (kmFromAnswer < PLACE_HARD_KM) return Rating.Hard;
    return Rating.Again;
  }
  if (inside) {
    requireDistance('kmFromAnswer', kmFromAnswer);
    if (Number.isNaN(featureSizeKm)) throw new RangeError(`featureSizeKm must not be NaN, got ${featureSizeKm}`);
    const easy = featureSizeKm > 0 && kmFromAnswer <= TAP_EASY_FRACTION * featureSizeKm;
    return easy ? Rating.Easy : Rating.Good;
  }
  requireDistance('kmOutsideBorder', kmOutsideBorder);
  const nearMiss = tier === 'country' ? COUNTRY_NEAR_MISS_KM : REGION_NEAR_MISS_KM;
  return kmOutsideBorder <= nearMiss ? Rating.Hard : Rating.Again;
}
