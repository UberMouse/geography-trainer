import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { buildCurriculum, regionsFromPlaces, type Curriculum } from '../engine/curriculum';
import { buildSession, type SessionQuestion } from '../engine/session';
import {
  answerCurrent,
  nextRound,
  questionsRemain,
  roundEnded,
  skipCurrent,
  startRun,
  type SessionRun,
} from '../engine/sessionRun';
import { isMastered, type ItemProgress } from '../engine/srs';
import { introducedToday } from '../engine/today';
import type { Place } from '../engine/types';
import { loadCountries, loadPlaces, loadRegions, type CountriesData, type RegionsData } from '../data/loaders';
import Exercise from '../exercises/Exercise';
import { buildExerciseItem } from '../exercises/item';
import type { ExerciseResult } from '../exercises/types';
import { progressStore } from '../storage/progressStore';
import Status from './LoadStatus';
import { answerEntry, countriesNeedingRegions, questionHeader, questionSeed, unlockLines } from './sessionView';
import { useLoaded } from './useLoaded';

interface SessionData {
  countries: CountriesData;
  places: Place[];
  progress: Record<string, ItemProgress>;
  curriculum: Curriculum;
  /** The session's first round queue, built when the data loaded. */
  questions: SessionQuestion[];
  /** The loaded regions of every country that owns a region or place question, by country id. */
  regions: ReadonlyMap<string, RegionsData>;
}

const loadSessionData = async (): Promise<SessionData> => {
  const [countries, places, progress] = await Promise.all([
    loadCountries(),
    loadPlaces(),
    progressStore.loadProgress(),
  ]);
  const now = new Date();
  const curriculum = buildCurriculum(countries.countries, regionsFromPlaces(countries.countries, places), places);
  const questions = buildSession({
    curriculum,
    progress,
    now,
    introducedToday: introducedToday(curriculum, progress, now, -now.getTimezoneOffset()),
  });
  // Re-asks and later rounds only repeat these items, so these are all the regions a session needs.
  const needed = countriesNeedingRegions(curriculum, questions);
  const loaded = await Promise.all(needed.map((id) => loadRegions(id)));
  const regions = new Map(needed.map((id, i) => [id, loaded[i]!]));
  return { countries, places, progress, curriculum, questions, regions };
};

/** Today's study session: countries, regions and places, in rounds, each answer saved as it is given. */
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
  const { countries, places, curriculum, regions } = data;
  const [run, setRun] = useState<SessionRun>(() => startRun(data.questions));
  const empty = data.questions.length === 0;
  // Items that passed from not mastered to mastered in this round, in answer order.
  const [mastered, setMastered] = useState<string[]>([]);
  // The run after the current question's answer; it becomes `run` when the learner presses Next.
  const [answeredRun, setAnsweredRun] = useState<SessionRun | null>(null);
  // True when the current question's answer could not be recorded and the question is skipped.
  const [recordFailed, setRecordFailed] = useState(false);
  const progress = useRef(data.progress);
  const queue = progressStore.answers;
  const { unsaved } = useSyncExternalStore(queue.subscribe, queue.getState);
  // Chosen once per visit, so the same item at the same position varies its options between visits.
  const [salt] = useState(() => Math.floor(Math.random() * 2 ** 32));
  const question = run.queue[0];
  const ended = roundEnded(run);
  // Built once per question: a new `item.target` on every render would reset the globe's view.
  const item = useMemo(
    () =>
      question
        ? buildExerciseItem(question.itemId, {
            countries,
            places,
            regions: regions.get(curriculum.items.get(question.itemId)!.countryId.replace(/^country:/, '')),
          })
        : null,
    [question, countries, places, regions, curriculum],
  );
  const questionRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const lastSeen = useRef({ answered: run.answered, ended });
  // Move focus to the new question or the summary: the button that had it has unmounted. Skipped
  // when nothing changed, so the first mount (and StrictMode's second effect run) leaves focus alone.
  useEffect(() => {
    if (lastSeen.current.answered === run.answered && lastSeen.current.ended === ended) return;
    lastSeen.current = { answered: run.answered, ended };
    (ended ? summaryRef : questionRef).current?.focus();
  }, [run.answered, ended]);

  // A country's name is in `countries`; a region is only mastered after being asked, which loaded
  // its country's regions.
  const nameOf = (itemId: string): string => {
    const item = curriculum.items.get(itemId)!;
    const id = itemId.slice(itemId.indexOf(':') + 1);
    if (item.tier === 'country') return countries.countries.find((c) => c.id === id)?.name ?? id;
    const owner = regions.get(item.countryId.replace(/^country:/, ''));
    return owner?.regions.find((r) => r.id === id)?.name ?? id;
  };

  if (empty) {
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
        {unlockLines(curriculum, mastered, nameOf).map((line) => (
          <p key={line}>{line}</p>
        ))}
        {questionsRemain(run) ? (
          <p>
            <button
              type="button"
              className="session-button"
              onClick={() => {
                setMastered([]);
                setRun(nextRound(run));
              }}
            >
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
    let after;
    try {
      const recorded = answerEntry(
        progress.current[question.itemId],
        question,
        result,
        now,
        -now.getTimezoneOffset(),
      );
      after = recorded.after;
      queue.push(recorded.entry);
      const before = progress.current[question.itemId];
      progress.current = { ...progress.current, [question.itemId]: after };
      if (isMastered(after) && !(before && isMastered(before))) {
        setMastered((ids) => [...ids, question.itemId]);
      }
    } catch (error) {
      console.error('[session] could not record answer', question.itemId, error);
      setRecordFailed(true);
      setAnsweredRun(skipCurrent(run));
      return;
    }
    setAnsweredRun(answerCurrent(run, { rating: result.rating, correct: result.correct, after }));
  };

  const onNext = () => {
    if (answeredRun) setRun(answeredRun);
    setAnsweredRun(null);
    setRecordFailed(false);
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
        {recordFailed && (
          <p role="alert">This answer could not be recorded, so this question is skipped for now.</p>
        )}
      </div>
    </div>
  );
}
