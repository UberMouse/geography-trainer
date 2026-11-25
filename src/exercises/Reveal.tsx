import { RATING_LABEL, formatKm } from './result';
import type { ExerciseItem, ExerciseResult } from './types';

/** After an answer: correct or not, the rating, a tap's km off and maptap score, and Next. */
export default function Reveal({
  item,
  result,
  onNext,
}: {
  item: ExerciseItem;
  result: ExerciseResult;
  onNext: () => void;
}) {
  const { correct, rating, km, maptapScore } = result;
  return (
    <div className="exercise-reveal" data-correct={correct}>
      <p role="status">
        <strong>{correct ? 'Correct' : 'Incorrect'}</strong> · {RATING_LABEL[rating]}
        {!correct && <> · it is {item.name}</>}
      </p>
      {km !== undefined && (
        <p>
          <span data-testid="reveal-km">{formatKm(km)} km</span> off
          {maptapScore !== undefined && (
            <>
              {' '}
              · maptap score <span data-testid="reveal-score">{maptapScore}</span>
            </>
          )}
        </p>
      )}
      <button type="button" onClick={onNext} autoFocus>
        Next
      </button>
    </div>
  );
}
