import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
import type { ItemProgress } from '../engine/srs';
import { introducedToday } from '../engine/today';
import type { Place } from '../engine/types';
import { loadCountries, loadPlaces, type CountriesData } from '../data/loaders';
import Exercise from '../exercises/Exercise';
import { buildExerciseItem } from '../exercises/item';
import type { ExerciseResult } from '../exercises/types';
import { progressStore } from '../storage/progressStore';
import Status from './LoadStatus';
import { answerEntry, questionHeader, questionSeed } from './sessionView';
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
    progressStore.loadProgress(),
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
  const queue = progressStore.answers;
  const { unsaved } = useSyncExternalStore(queue.subscribe, queue.getState);
  // Chosen once per visit, so the same item at the same position varies its options between visits.
  const [salt] = useState(() => Math.floor(Math.random() * 2 ** 32));
  const question = run.queue[0];
  const ended = roundEnded(run);
  // Built once per question: a new `item.target` on every render would reset the globe's view.
  const item = useMemo(
    () => (question ? buildExerciseItem(question.itemId, { countries, places }) : null),
    [question, countries, places],
  );
  const questionRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  // Move focus to the new question or the summary: the button that had it has unmounted.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    (ended ? summaryRef : questionRef).current?.focus();
  }, [run.answered, ended]);

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

  if (ended || !question || !item) {
    return (
      <div data-unsaved={unsaved}>
        <h2 ref={summaryRef} tabIndex={-1} className="session-summary">
          Round done: {run.correctInRound} of {run.answeredInRound} right
        </h2>
        {questionsRemain(run) ? (
          <p>
            <button type="button" className="session-button" onClick={() => setRun(nextRound(run))}>
              Keep going
            </button>
          </p>
        ) : (
          <p>That is everything for today.</p>
        )}
        <p>
          <Link to="/">Back to Home</Link>
        </p>
      </div>
    );
  }

  const onAnswer = (result: ExerciseResult) => {
    const now = new Date();
    const { after, entry } = answerEntry(
      progress.current[question.itemId],
      question,
      result,
      now,
      -now.getTimezoneOffset(),
    );
    progress.current = { ...progress.current, [question.itemId]: after };
    queue.push(entry);
    setAnsweredRun(answerCurrent(run, { rating: result.rating, correct: result.correct, after }));
  };

  const onNext = () => {
    if (answeredRun) setRun(answeredRun);
    setAnsweredRun(null);
  };

  return (
    <div data-unsaved={unsaved}>
      <div className="session-header">
        <span>{questionHeader(run)}</span>
        <Link to="/">Quit</Link>
      </div>
      <div
        ref={questionRef}
        tabIndex={-1}
        data-testid="session-question"
        data-item-id={item.id}
        data-item-name={item.name}
        data-rung={question.rung}
      >
        <Exercise
          key={run.answered}
          item={item}
          rung={question.rung}
          seed={questionSeed(item.id, run.answered, salt)}
          onAnswer={onAnswer}
          onNext={onNext}
        />
      </div>
    </div>
  );
}
