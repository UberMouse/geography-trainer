import BareGlobe from '../maps/BareGlobe';
import TapQuestion from './TapQuestion';
import type { ExerciseProps } from './types';

/** L4: tap the named item on the bare globe, which starts from the neutral view. */
export default function GlobeTapExercise(props: ExerciseProps) {
  const { item, initialView } = props;
  return (
    <TapQuestion
      {...props}
      map={(map) => <BareGlobe features={item.world} initialView={initialView} {...map} />}
    />
  );
}
