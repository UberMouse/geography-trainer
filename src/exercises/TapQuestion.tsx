import { useState, type ReactNode } from 'react';
import type { LngLat, TapTarget } from '../maps/geo';
import { tapResult } from './result';
import Reveal from './Reveal';
import type { ExerciseProps } from './types';
import { useQuestion } from './useQuestion';

export interface TapMapProps {
  pin: LngLat | null;
  onPin: (at: LngLat) => void;
  reveal?: TapTarget;
}

/**
 * Name the item, tap the map: a tap drops or moves the pin, Confirm (enabled once there is a pin)
 * grades it. After that the map reveals the target and taps are ignored.
 */
export default function TapQuestion({
  item,
  onAnswer,
  onNext,
  map,
}: Omit<ExerciseProps, 'rung' | 'seed'> & { map: (props: TapMapProps) => ReactNode }) {
  const [pin, setPin] = useState<LngLat | null>(null);
  const { result, answer } = useQuestion(onAnswer);
  const onPin = (at: LngLat) => {
    if (!result) setPin(at);
  };
  const confirm = () => {
    if (pin) answer((timeMs) => tapResult(item, pin, timeMs));
  };

  return (
    <div className="exercise">
      <p className="exercise-prompt">
        Tap <strong>{item.name}</strong>
      </p>
      <div className="exercise-map">
        {map({ pin, onPin, reveal: result ? item.target : undefined })}
      </div>
      <button type="button" disabled={!pin || !!result} onClick={confirm}>
        Confirm
      </button>
      <Reveal item={item} result={result} onNext={onNext} />
    </div>
  );
}
