import { Button, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { RATING_LABEL, formatKm } from './result';
import type { ExerciseItem, ExerciseResult } from './types';

/**
 * The verdict after an answer: correct or not, the rating, a tap's km off and maptap score, and
 * Next. Before the answer (`result` null) only its empty status region is there, so a screen
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
            <Text span fw={700} c={result.correct ? 'green' : 'red'}>
              {result.correct ? 'Correct' : 'Incorrect'}
            </Text>{' '}
            · {RATING_LABEL[result.rating]}
            {!result.correct && <> · it is {item.name}</>}
          </>
        )}
      </Text>
      {result?.km !== undefined && (
        <Text>
          <span data-testid="reveal-km">{formatKm(result.km)} km</span> off
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
