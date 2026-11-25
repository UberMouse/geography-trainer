import OutlineView from '../maps/OutlineView';
import ChoiceQuestion from './ChoiceQuestion';
import HighlightPicture from './HighlightPicture';
import type { ExerciseProps } from './types';

const PROMPT = {
  country: 'Which country is this?',
  region: 'Which region is this?',
  place: 'Which place is marked?',
} as const;

/**
 * L1: an outline (a place's region or country, with a dot) to name from the options. A point-only
 * country's outline is a featureless disc, so it (and a place in it) is shown as L2 shows it:
 * marked on the globe.
 */
export default function OutlineExercise(props: ExerciseProps) {
  const { item } = props;
  if (item.pointOnly) {
    return (
      <ChoiceQuestion
        {...props}
        prompt={item.tier === 'country' ? 'Which country is marked?' : PROMPT.place}
        picture={<HighlightPicture item={item} />}
      />
    );
  }
  const point = 'point' in item.target ? item.target.point : undefined;
  return (
    <ChoiceQuestion
      {...props}
      prompt={PROMPT[item.tier]}
      picture={<OutlineView feature={item.outline} point={point} />}
    />
  );
}
