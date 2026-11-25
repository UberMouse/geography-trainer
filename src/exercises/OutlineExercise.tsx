import OutlineView from '../maps/OutlineView';
import ChoiceQuestion from './ChoiceQuestion';
import type { ExerciseProps } from './types';

const PROMPT = {
  country: 'Which country is this?',
  region: 'Which region is this?',
  place: 'Which place is marked?',
} as const;

/** L1: an outline (a place's region or country, with a dot) to name from the options. */
export default function OutlineExercise(props: ExerciseProps) {
  const { item } = props;
  const point = 'point' in item.target ? item.target.point : undefined;
  return (
    <ChoiceQuestion
      {...props}
      prompt={PROMPT[item.tier]}
      picture={<OutlineView feature={item.outline} point={point} />}
    />
  );
}
