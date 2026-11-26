import BareGlobe from '../maps/BareGlobe';
import TapMap from '../maps/TapMap';
import TapQuestion from './TapQuestion';
import type { ExerciseProps } from './types';

/**
 * L2: tap the named item on a bordered map: a country on the bordered globe; a region or place on
 * its country's map with region borders (the bordered globe when it is outside that map,
 * `onGlobe`).
 */
export default function BorderedTapExercise(props: ExerciseProps) {
  const { item, initialView } = props;
  const onGlobe = item.tier === 'country' || item.onGlobe;
  return (
    <TapQuestion
      {...props}
      map={(map) =>
        onGlobe ? (
          <BareGlobe features={item.world} borders initialView={initialView} {...map} />
        ) : (
          <TapMap features={item.context} frame={item.frame} {...map} />
        )
      }
    />
  );
}
