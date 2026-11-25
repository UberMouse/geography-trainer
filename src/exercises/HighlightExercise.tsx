import HighlightMap from '../maps/HighlightMap';
import ChoiceQuestion from './ChoiceQuestion';
import type { ExerciseProps } from './types';

const PROMPT = {
  country: 'Which country is highlighted?',
  region: 'Which region is highlighted?',
  place: 'Which place is marked?',
} as const;

/**
 * L2: the item in context to name from the options. A country is shaded on the globe; a region
 * shaded, or a place dotted, on its country's regions (on the globe when it is outside the
 * country's flat map, `onGlobe`).
 */
export default function HighlightExercise(props: ExerciseProps) {
  const { item } = props;
  const { target } = item;
  const onGlobe = item.tier === 'country' || item.onGlobe;
  return (
    <ChoiceQuestion
      {...props}
      prompt={PROMPT[item.tier]}
      picture={
        <HighlightMap
          mode={onGlobe ? 'globe' : 'fit'}
          features={onGlobe ? item.world : item.context}
          frame={onGlobe ? undefined : item.frame}
          highlightId={'feature' in target ? String(target.feature.id) : undefined}
          point={'point' in target ? target.point : undefined}
        />
      }
    />
  );
}
