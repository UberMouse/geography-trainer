import { useState, type ReactNode } from 'react';
import { mulberry32 } from '../engine/rng';
import { buildChoices } from './options';
import { choiceResult } from './result';
import Reveal from './Reveal';
import type { ExerciseProps } from './types';
import { useQuestion } from './useQuestion';

/**
 * A multiple-choice question about `picture`: name buttons, graded on the first click. The reveal
 * marks the right option and a wrong choice, and the options are then aria-disabled (still
 * focusable; a click is ignored).
 */
export default function ChoiceQuestion({
  item,
  seed,
  onAnswer,
  onNext,
  prompt,
  picture,
}: Omit<ExerciseProps, 'rung'> & { prompt: string; picture: ReactNode }) {
  const [choices] = useState(() => buildChoices(item, mulberry32(seed)));
  const [chosen, setChosen] = useState<string | null>(null);
  const { result, answer } = useQuestion(onAnswer);
  const choose = (id: string) => {
    if (answer((timeMs) => choiceResult(item, id, timeMs))) setChosen(id);
  };
  const mark = (id: string) => {
    if (!result) return undefined;
    if (id === item.id) return 'correct';
    return id === chosen ? 'wrong' : undefined;
  };

  return (
    <div className="exercise">
      <p className="exercise-prompt">{prompt}</p>
      <div className="exercise-map">{picture}</div>
      <div className="exercise-choices" role="group" aria-label="Options">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            className="exercise-choice"
            data-mark={mark(c.id)}
            aria-disabled={result ? true : undefined}
            onClick={() => choose(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
      <Reveal item={item} result={result} onNext={onNext} />
    </div>
  );
}
