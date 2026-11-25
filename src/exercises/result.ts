import { Rating, type Grade } from 'ts-fsrs';
import { gradeMultipleChoice, gradeTap, isPass, maptapScore } from '../engine/grading';
import { measureTap, type LngLat } from '../maps/geo';
import type { ExerciseItem, ExerciseResult } from './types';

export const RATING_LABEL: Record<Grade, string> = {
  [Rating.Again]: 'Again',
  [Rating.Hard]: 'Hard',
  [Rating.Good]: 'Good',
  [Rating.Easy]: 'Easy',
};

/** km for display: one decimal under 10 km, else whole km with thousands separators. */
export const formatKm = (km: number) =>
  km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString('en');

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
