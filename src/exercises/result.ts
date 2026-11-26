import { Rating, type Grade } from 'ts-fsrs';
import { gradeMultipleChoice, gradeTap, isPass, maptapScore } from '../engine/grading';
import { measureTap, type LngLat } from '../maps/geo';
import type { Tier } from '../engine/curriculum';
import type { ExerciseItem, ExerciseResult } from './types';

export const RATING_LABEL: Record<Grade, string> = {
  [Rating.Again]: 'Again',
  [Rating.Hard]: 'Hard',
  [Rating.Good]: 'Good',
  [Rating.Easy]: 'Easy',
};

/**
 * km for display: rounded to one decimal, shown with it under 10 km, else as whole km with
 * thousands separators (so 9.97 reads "10", not "10.0").
 */
export function formatKm(km: number): string {
  const tenths = Math.round(km * 10) / 10;
  return tenths < 10 ? tenths.toFixed(1) : Math.round(km).toLocaleString('en');
}

/**
 * The reveal's verdict in plain words, not the scheduler's ratings: "Correct · spot on" (fast, or
 * near the middle), "Correct", "Correct · slow" (a slow multiple-choice answer), "Incorrect ·
 * near miss" (a tap just outside) or "Incorrect". `tone` colours it.
 */
export function verdictText(result: Pick<ExerciseResult, 'correct' | 'rating'>): {
  text: string;
  tone: 'right' | 'near' | 'wrong';
} {
  if (result.correct) {
    if (result.rating === Rating.Easy) return { text: 'Correct · spot on', tone: 'right' };
    if (result.rating === Rating.Hard) return { text: 'Correct · slow', tone: 'right' };
    return { text: 'Correct', tone: 'right' };
  }
  if (result.rating === Rating.Hard) return { text: 'Incorrect · near miss', tone: 'near' };
  return { text: 'Incorrect', tone: 'wrong' };
}

/**
 * What a tap's `km` measures, for the reveal: a place's distance from its point ("12 km away"),
 * or a country's or region's distance outside its border ("inside the border" at 0). maptap's
 * score, shown beside it, is from the answer point instead, so the words say which this is.
 */
export function distanceText(tier: Tier, km: number): string {
  if (tier === 'place') return `${formatKm(km)} km away`;
  return km === 0 ? 'inside the border' : `${formatKm(km)} km outside the border`;
}

/** A multiple-choice answer's result: `correct` when the item itself was chosen. */
export function choiceResult(item: ExerciseItem, chosenId: string, timeMs: number): ExerciseResult {
  const correct = chosenId === item.id;
  return { rating: gradeMultipleChoice(correct, timeMs), correct, timeMs };
}

/**
 * A confirmed tap's result: graded by `gradeTap`, `correct` when that passes (Good or Easy, so a
 * near miss is not). `km` is the distance off the target as shown (outside a border, 0 inside; or
 * from a place) and `maptapScore` maptap's score from the answer point.
 */
export function tapResult(item: ExerciseItem, tap: LngLat, timeMs: number): ExerciseResult {
  const m = measureTap(item.target, tap);
  const rating = gradeTap({ tier: item.tier, ...m });
  return {
    rating,
    correct: isPass(rating),
    timeMs,
    km: item.tier === 'place' ? m.kmFromAnswer : m.kmOutsideBorder,
    maptapScore: maptapScore(m.kmFromAnswer, m.inside),
  };
}
