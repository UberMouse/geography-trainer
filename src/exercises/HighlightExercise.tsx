import ChoiceQuestion from './ChoiceQuestion';
import HighlightPicture from './HighlightPicture';
import type { ExerciseProps } from './types';

const PROMPT = {
  country: 'Which country is highlighted?',
  region: 'Which region is highlighted?',
  place: 'Which place is marked?',
} as const;

/** L1: the item in context (see `HighlightPicture`) to name from the options. */
export default function HighlightExercise(props: ExerciseProps) {
  const { item } = props;
  return (
    <ChoiceQuestion
      {...props}
      prompt={PROMPT[item.tier]}
      picture={<HighlightPicture item={item} />}
    />
  );
}
