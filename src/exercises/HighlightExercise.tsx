import { Button, SimpleGrid, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { mulberry32 } from '../engine/rng';
import { buildChoices } from './options';
import { choiceResult } from './result';
import Reveal from './Reveal';
import type { ExerciseViewProps } from './Exercise';
import { useQuestion } from './useQuestion';
import type { ExerciseItem } from './types';
import { useQuestionGlobe } from './useQuestionGlobe';

const prompt = (item: ExerciseItem) =>
  ({
    country: 'Which country is highlighted?',
    region: `Which region of ${item.countryName} is highlighted?`,
    place: 'Which place is marked?',
  })[item.tier];

/** A choice's look: the right option and a wrong choice are marked after the answer. */
const LOOK = {
  correct: { variant: 'filled', color: 'green' },
  wrong: { variant: 'filled', color: 'red' },
  none: { variant: 'default', color: undefined },
} as const;

/**
 * L1: the item highlighted on the globe, to name from 4 options (a 2×2 grid), graded on the first
 * click. The reveal marks the right option and a wrong choice, and the options are then
 * aria-disabled (still focusable; a click is ignored).
 */
export default function HighlightExercise({ item, seed, onAnswer, onNext, opening, note }: ExerciseViewProps) {
  const [choices] = useState(() => buildChoices(item, mulberry32(seed)));
  const [chosen, setChosen] = useState<string | null>(null);
  const { result, answer } = useQuestion(onAnswer);
  useQuestionGlobe({ item, rung: 1, opening, answered: result !== null });
  const choose = (id: string) => {
    if (answer((timeMs) => choiceResult(item, id, timeMs))) setChosen(id);
  };
  const mark = (id: string) => {
    if (!result) return undefined;
    if (id === item.id) return 'correct';
    return id === chosen ? 'wrong' : undefined;
  };

  return (
    <Stack gap="sm">
      <Text size="lg">{prompt(item)}</Text>
      <SimpleGrid cols={2} spacing="xs" role="group" aria-label="Options">
        {choices.map((c) => {
          const m = mark(c.id);
          return (
            <Button
              key={c.id}
              {...LOOK[m ?? 'none']}
              data-mark={m}
              aria-disabled={result ? true : undefined}
              onClick={() => choose(c.id)}
              h="auto"
              mih={44}
              py={6}
              styles={{ label: { whiteSpace: 'normal', textAlign: 'center' } }}
            >
              {c.name}
            </Button>
          );
        })}
      </SimpleGrid>
      <Reveal item={item} result={result} onNext={onNext} note={note} />
    </Stack>
  );
}
