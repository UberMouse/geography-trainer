import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  answerPlacement,
  finishPlacement,
  nextQuestion,
  placementSeeds,
  startPlacement,
  type PlacementItem,
  type PlacementQuestion,
  type PlacementResult,
  type PlacementState,
} from '../engine/placement';
import { isPass } from '../engine/grading';
import { localDayKey, seedFromPlacement, type ItemProgress } from '../engine/srs';
import Exercise from '../exercises/Exercise';
import type { ExerciseItem, ExerciseResult } from '../exercises/types';
import { progressStore } from '../storage/progressStore';
import { emptyPoolText, NOTHING_TO_ASK_TEXT, placementHeader, resultLines, type PlacementTier } from './placementView';
import { questionSeed } from './sessionView';

export interface PlacementRunProps {
  /** The items to test (see `placementPool`). */
  pool: readonly PlacementItem[];
  /** The exercise item of every pool item, built when the data loaded. */
  items: ReadonlyMap<string, ExerciseItem>;
  /** The progress the pool was drawn from: items with a row are never seeded. */
  progress: Readonly<Record<string, ItemProgress>>;
  /** The tier of the pool, for the result wording. */
  tier: PlacementTier;
  /** The page title, shown above the test. */
  heading: string;
}

const dayKeyOf = (now: Date) => localDayKey(now, -now.getTimezoneOffset());
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One placement test over `pool`: the question loop, saving, and the result screen. */
export default function PlacementRun({ pool, items, progress, tier, heading }: PlacementRunProps) {
  // The state holding the pending question, and that question; null once nothing is left to ask.
  const [asking, setAsking] = useState<{ state: PlacementState; question: PlacementQuestion } | null>(
    () => nextQuestion(startPlacement(pool, Math.random), Math.random),
  );
  // The state after the current question's answer; it replaces `asking` when the learner presses Next.
  const [answered, setAnswered] = useState<PlacementState | null>(null);
  // Set when the test has ended: the result, and how saving its seeds is going.
  const [ended, setEnded] = useState<PlacementResult | null>(null);
  const [saving, setSaving] = useState<{ status: 'saving' | 'saved' } | { status: 'failed'; error: string }>(
    { status: 'saving' },
  );
  const [passSaveError, setPassSaveError] = useState<string | null>(null);
  const [salt] = useState(() => Math.floor(Math.random() * 2 ** 32));
  const questionRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const state = answered ?? asking?.state ?? null;
  const answeredCount = state?.answers.length ?? 0;
  // How many questions came before the one on screen: unchanged while its reveal shows.
  const position = asking?.state.answers.length ?? 0;
  const lastSeen = useRef({ position, over: ended !== null });
  // Move focus to the new question or the result: the button that had it has unmounted. Skipped
  // when nothing changed, so the first mount (and StrictMode's second effect run) leaves focus alone.
  useEffect(() => {
    const over = ended !== null;
    if (lastSeen.current.position === position && lastSeen.current.over === over) return;
    lastSeen.current = { position, over };
    (over ? resultRef : questionRef).current?.focus();
  }, [position, ended]);

  // The state is already 'saving' when a test ends and when a retry starts.
  const save = async (result: PlacementResult) => {
    try {
      const now = new Date();
      const seeds = placementSeeds(result, progress, now, dayKeyOf(now));
      if (seeds.length > 0) await progressStore.seedProgress(seeds);
      setSaving({ status: 'saved' });
    } catch (error) {
      console.error('[placement] could not save results', error);
      setSaving({ status: 'failed', error: messageOf(error) });
    }
  };

  const finish = (final: PlacementState) => {
    const result = finishPlacement(final);
    setEnded(result);
    void save(result);
  };

  if (!ended && !asking) {
    return (
      <>
        <h1>{heading}</h1>
        <p>{pool.length === 0 ? emptyPoolText(tier) : NOTHING_TO_ASK_TEXT}</p>
        <p>
          <Link to="/">Back to Home</Link>
        </p>
      </>
    );
  }

  if (ended) {
    const done = saving.status === 'saved';
    let body: ReactNode;
    if (saving.status === 'saving') body = <p>Saving your results…</p>;
    else if (saving.status === 'failed') {
      body = (
        <div role="alert">
          <p>Could not save your placement results: {saving.error}</p>
          <button type="button" className="session-button" onClick={() => {
              setSaving({ status: 'saving' });
              void save(ended);
            }}>
            Try again
          </button>
        </div>
      );
    }
    return (
      <>
        <h1>{heading}</h1>
        <h2 ref={resultRef} tabIndex={-1} className="session-summary">
          Placement done
        </h2>
        {resultLines(ended, tier).map((line) => (
          <p key={line}>{line}</p>
        ))}
        {body}
        {done && (
          <p>
            <Link to="/session" className="home-start">
              Start studying
            </Link>
          </p>
        )}
        <p>
          <Link to="/">Back to Home</Link>
        </p>
      </>
    );
  }

  const { question } = asking!;
  const item = items.get(question.itemId)!;

  const onAnswer = (result: ExerciseResult) => {
    const after = answerPlacement(asking!.state, question.itemId, result.rating);
    setAnswered(after);
    if (!isPass(result.rating)) return;
    // A pass is stored at once, so quitting partway keeps it.
    const now = new Date();
    progressStore.seedProgress([seedFromPlacement(question.itemId, 'passed', now, dayKeyOf(now))]).then(
      () => undefined,
      (error: unknown) => {
        console.error('[placement] could not save answer', question.itemId, error);
        setPassSaveError(messageOf(error));
      },
    );
  };

  const onNext = () => {
    if (!answered) return;
    const following = nextQuestion(answered, Math.random);
    setAnswered(null);
    setPassSaveError(null);
    if (following) setAsking(following);
    else finish(answered);
  };

  return (
    <>
      <h1>{heading}</h1>
      <div className="session-header">
        <span>{placementHeader(position)}</span>
        <Link to="/">Quit</Link>
      </div>
      <div
        ref={questionRef}
        tabIndex={-1}
        data-testid="placement-question"
        data-item-id={item.id}
        data-item-name={item.name}
        data-rung={4}
      >
        <Exercise
          key={position}
          item={item}
          rung={4}
          seed={questionSeed(item.id, position, salt)}
          onAnswer={onAnswer}
          onNext={onNext}
        />
        {passSaveError && <p role="alert">This answer could not be saved: {passSaveError}</p>}
      </div>
      {answeredCount > 0 && (
        <p>
          <button type="button" className="session-button" onClick={() => finish(state!)}>
            Finish now
          </button>
        </p>
      )}
    </>
  );
}
