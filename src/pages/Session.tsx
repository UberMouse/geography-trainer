import { useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { buildCountryCurriculum } from '../engine/curriculum';
import { buildSession } from '../engine/session';
import {
  answerCurrent,
  nextRound,
  questionsRemain,
  roundEnded,
  startRun,
  type SessionRun,
} from '../engine/sessionRun';
import { applyAnswer, createProgress, localDayKey, type ItemProgress } from '../engine/srs';
import { introducedToday } from '../engine/today';
import type { Place } from '../engine/types';
import { loadCountries, loadPlaces, type CountriesData } from '../data/loaders';
import Exercise from '../exercises/Exercise';
import { buildExerciseItem } from '../exercises/item';
import type { ExerciseResult } from '../exercises/types';
import { repo, type AnswerEntry } from '../storage/repo';
import { createSaveQueue } from '../storage/saveQueue';
import Status from './LoadStatus';
import { questionHeader, questionSeed } from './sessionView';
import { useLoaded } from './useLoaded';

interface SessionData {
  countries: CountriesData;
  places: Place[];
  progress: Record<string, ItemProgress>;
}

const loadSessionData = async (): Promise<SessionData> => {
  const [countries, places, progress] = await Promise.all([
    loadCountries(),
    loadPlaces(),
    repo.loadProgress(),
  ]);
  return { countries, places, progress };
};

/** Today's study session: countries only, in rounds, each answer saved as it is given. */
export default function Session() {
  const [data, retry] = useLoaded('session', loadSessionData);
  return (
    <Status
      state={data}
      retry={retry}
      failure="Could not load the map data or your saved progress:"
    >
      {(loaded) => <Runner data={loaded} />}
    </Status>
  );
}

function Runner({ data }: { data: SessionData }) {
  const { countries, places } = data;
  const [initial] = useState(() => {
    const now = new Date();
    const curriculum = buildCountryCurriculum(countries.countries, places);
    const questions = buildSession({
      curriculum,
      progress: data.progress,
      now,
      introducedToday: introducedToday(curriculum, data.progress, now, -now.getTimezoneOffset()),
    });
    return { run: startRun(questions), empty: questions.length === 0 };
  });
  const [run, setRun] = useState<SessionRun>(initial.run);
  // The run after the current question's answer; it becomes `run` when the learner presses Next.
  const [answeredRun, setAnsweredRun] = useState<SessionRun | null>(null);
  const progress = useRef(data.progress);
  const [queue] = useState(() => createSaveQueue<AnswerEntry>((entry) => repo.recordAnswer(entry)));
  const { failed, unsaved } = useSyncExternalStore(queue.subscribe, queue.getState);

  if (initial.empty) {
    return (
      <>
        <p>There is nothing to study right now.</p>
        <p>
          <Link to="/">Back to Home</Link>
        </p>
      </>
    );
  }

  const banner = failed && (
    <div role="alert" className="session-banner">
      <p>
        Your last {unsaved === 1 ? 'answer' : `${unsaved} answers`} could not be saved. You can keep
        going; leaving this page before it is saved loses {unsaved === 1 ? 'it' : 'them'}.
      </p>
      <button type="button" onClick={() => void queue.retry()}>
        Retry
      </button>
    </div>
  );

  if (roundEnded(run)) {
    return (
      <>
        {banner}
        <h1>
          Round done: {run.correctInRound} of {run.answeredInRound} right
        </h1>
        {questionsRemain(run) ? (
          <p>
            <button type="button" onClick={() => setRun(nextRound(run))}>
              Keep going
            </button>
          </p>
        ) : (
          <p>That is everything for today.</p>
        )}
        <p>
          <Link to="/">Back to Home</Link>
        </p>
      </>
    );
  }

  const question = run.queue[0]!;
  const item = buildExerciseItem(question.itemId, { countries, places });

  const onAnswer = (result: ExerciseResult) => {
    const now = new Date();
    const dayKey = localDayKey(now, -now.getTimezoneOffset());
    const before = progress.current[question.itemId] ?? createProgress(question.itemId, now);
    const after = applyAnswer(before, question.rung, result.rating, now, dayKey);
    progress.current = { ...progress.current, [question.itemId]: after };
    queue.push({
      progress: after,
      answer: {
        itemId: question.itemId,
        rung: question.rung,
        rating: result.rating,
        correct: result.correct,
        timeMs: result.timeMs,
        km: result.km,
        maptapScore: result.maptapScore,
        at: now.getTime(),
        dayKey,
      },
    });
    setAnsweredRun(answerCurrent(run, { rating: result.rating, correct: result.correct, after }));
  };

  const onNext = () => {
    if (answeredRun) setRun(answeredRun);
    setAnsweredRun(null);
  };

  return (
    <>
      {banner}
      <div className="session-header">
        <span>{questionHeader(run)}</span>
        <Link to="/">Quit</Link>
      </div>
      <div
        data-testid="session-question"
        data-item-id={item.id}
        data-item-name={item.name}
        data-rung={question.rung}
      >
        <Exercise
          key={run.answered}
          item={item}
          rung={question.rung}
          seed={questionSeed(item.id, run.answered)}
          onAnswer={onAnswer}
          onNext={onNext}
        />
      </div>
    </>
  );
}
