import type { ReactNode } from 'react';
import HighlightExercise from './HighlightExercise';
import TapExercise from './TapExercise';
import type { ExerciseProps } from './types';

/** An exercise's props, plus a line for its reveal (above Next). Kept out of `types.ts`, which
 * the build-data scripts import without React. */
export type ExerciseViewProps = ExerciseProps & { note?: ReactNode };

/**
 * The exercise for `rung`, in the column, driving the app's globe: L1 highlighted → name, L2
 * name → tap with borders, L3 name → tap on the bare globe. A new item or rung remounts it: a
 * fresh timer, no pin, no reveal, and the question's camera move. The same item asked again at the
 * same rung does not, so the caller must key each new question (e.g. by a session's question
 * index).
 */
export default function Exercise(props: ExerciseViewProps) {
  const key = `${props.item.id}:${props.rung}`;
  return props.rung === 1 ? (
    <HighlightExercise key={key} {...props} />
  ) : (
    <TapExercise key={key} {...props} rung={props.rung} />
  );
}
