import { Button, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { distanceText, verdictText } from './result';
import type { ExerciseItem, ExerciseResult } from './types';

const TONE_COLOUR = { right: 'green', near: 'yellow', wrong: 'red' } as const;

/**
 * The reveal after an answer: the verdict in plain words (`verdictText`), a tap's distance and
 * maptap score, and Next. Before the answer (`result` null) only its empty status region is there, so a screen
 * reader announces the verdict when it fills in.
 */
export default function Reveal({
  item,
  result,
  onNext,
  note,
}: {
  item: ExerciseItem;
  result: ExerciseResult | null;
  onNext: () => void;
  /** Shown above Next once answered. */
  note?: ReactNode;
}) {
  return (
    <Stack gap="xs">
      <Text role="status">
        {result && (
          <>
            <Text span fw={700} c={TONE_COLOUR[verdictText(result).tone]}>
              {verdictText(result).text}
            </Text>
            {!result.correct && <> · it is {item.label}</>}
          </>
        )}
      </Text>
      {result?.km !== undefined && (
        <Text>
          <span data-testid="reveal-km">{distanceText(item.tier, result.km)}</span>
          {result.maptapScore !== undefined && (
            <>
              {' '}
              · maptap score <span data-testid="reveal-score">{result.maptapScore}</span>
            </>
          )}
        </Text>
      )}
      {result && note}
      {result && (
        <Button onClick={onNext} autoFocus>
          Next
        </Button>
      )}
    </Stack>
  );
}
