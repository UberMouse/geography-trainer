import BorderedTapExercise from './BorderedTapExercise';
import GlobeTapExercise from './GlobeTapExercise';
import HighlightExercise from './HighlightExercise';
import type { ExerciseProps } from './types';

const BY_RUNG = {
  1: HighlightExercise,
  2: BorderedTapExercise,
  3: GlobeTapExercise,
} as const;

/**
 * The exercise for `rung`: L1 highlighted → name, L2 name → tap on a bordered map, L3 name → tap
 * on the bare globe. A new item or rung remounts it: a fresh timer, no pin, no reveal, and the
 * map views reset. The same item asked again at the same rung does not, so the
 * caller must key each new question (e.g. by a session's question index).
 */
export default function Exercise(props: ExerciseProps) {
  const Rung = BY_RUNG[props.rung];
  return <Rung key={`${props.item.id}:${props.rung}`} {...props} />;
}
