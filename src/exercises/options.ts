import { DISTRACTORS, multipleChoice, pickDistractors } from '../engine/distractors';
import type { Rng } from '../engine/rng';
import { targetPoint } from '../maps/geo';
import type { ExerciseItem } from './types';

export interface Choice {
  /** Namespaced item id. */
  id: string;
  name: string;
}

/**
 * A multiple-choice question's options: the item and up to `DISTRACTORS` wrong options from its
 * candidates near it (`pickDistractors`), shuffled (`multipleChoice`), both with `rng`.
 */
export function buildChoices(item: ExerciseItem, rng: Rng): Choice[] {
  const [lng, lat] = targetPoint(item.target);
  const wrong = pickDistractors({ id: item.id, lat, lng }, item.candidates, rng, DISTRACTORS);
  const names = new Map(item.candidates.map((c) => [c.id, c.name]));
  names.set(item.id, item.name);
  return multipleChoice(item.id, wrong, rng).map((id) => ({ id, name: names.get(id)! }));
}
