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
}: {
  item: ExerciseItem;
  result: ExerciseResult | null;
  onNext: () => void;
}) {
  return (
    <div className="exercise-reveal" data-correct={result?.correct}>
      <p role="status">
        {result && (
          <>
            <strong>{result.correct ? 'Correct' : 'Incorrect'}</strong> ·{' '}
            {RATING_LABEL[result.rating]}
            {!result.correct && <> · it is {item.name}</>}
          </>
        )}
      </p>
      {result?.km !== undefined && (
        <p>
          <span data-testid="reveal-km">{formatKm(result.km)} km</span> off
          {result.maptapScore !== undefined && (
            <>
              {' '}
              · maptap score <span data-testid="reveal-score">{result.maptapScore}</span>
            </>
          )}
        </p>
      )}
      {result && (
        <button type="button" onClick={onNext} autoFocus>
          Next
        </button>
      )}
    </div>
  );
}
