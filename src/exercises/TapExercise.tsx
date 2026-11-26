import { Button, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import type { LngLat } from '../maps/geo';
import { tapResult } from './result';
import Reveal from './Reveal';
import type { ExerciseProps } from './types';
import { useQuestion } from './useQuestion';
import { useQuestionGlobe } from './useQuestionGlobe';

/**
 * L2 and L3: name → tap on the globe, with borders (L2) or bare (L3). A tap drops or moves the
 * pin, and Confirm (enabled once there is a pin) grades it. After that the globe reveals the
 * target and taps are ignored.
 */
export default function TapExercise({
  item,
  rung,
  onAnswer,
  onNext,
  opening,
}: ExerciseProps & { rung: 2 | 3 }) {
  const [pin, setPin] = useState<LngLat | null>(null);
  const { result, answer } = useQuestion(onAnswer);
  useQuestionGlobe({ item, rung, opening, pin, answered: result !== null, onTap: setPin });
  const confirm = () => {
    if (pin) answer((timeMs) => tapResult(item, pin, timeMs));
  };

  return (
    <Stack gap="sm">
      <Text size="lg">
        Tap <strong>{item.name}</strong>
      </Text>
      <Button disabled={!pin || !!result} onClick={confirm}>
        Confirm
      </Button>
      <Reveal item={item} result={result} onNext={onNext} />
    </Stack>
  );
}
