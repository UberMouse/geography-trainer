import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { loadCountries, loadPlaces, loadRegions, type CountriesData, type RegionsData } from '../data/loaders';
import Exercise from '../exercises/Exercise';
import { buildExerciseItem } from '../exercises/item';
import type { ExerciseItem, ExerciseResult } from '../exercises/types';
import { progressStore } from '../storage/progressStore';
import Status from './LoadStatus';
import { answerEntry, countriesNeedingRegions, questionHeader, questionSeed, unlockLines } from './sessionView';
import { showsTestOutLink, testOutPath } from './testOutView';
import { useLoaded } from './useLoaded';

interface SessionData {
  countries: CountriesData;
  progress: Record<string, ItemProgress>;
  /** Marker keys of the finished placement tests (see `placementKey`). */
  finishedTests: ReadonlySet<string>;
  curriculum: Curriculum;
  /** The session's first round queue, built when the data loaded. */
  questions: SessionQuestion[];
  /** The loaded regions of every country that owns a region or place question, by country id. */
  regions: ReadonlyMap<string, RegionsData>;
  /** The exercise item of every question in the first queue, by item id. */
  items: ReadonlyMap<string, ExerciseItem>;
}

const loadSessionData = async (): Promise<SessionData> => {
  const [countries, places, progress, finishedTests] = await Promise.all([
    loadCountries(),
    loadPlaces(),
    progressStore.loadProgress(),
    progressStore.loadFinishedTests(),
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
  // Built here so an item the data cannot build (a place naming a region its country lacks) fails
  // the load, with Retry, rather than the render. Items are seed-free: the seed goes to `Exercise`.
  const items = new Map<string, ExerciseItem>();
  for (const { itemId } of questions) {
    if (items.has(itemId)) continue;
    const countryId = curriculum.items.get(itemId)!.countryId.replace(/^country:/, '');
    items.set(itemId, buildExerciseItem(itemId, { countries, places, regions: regions.get(countryId) }));
  }
  return { countries, progress, finishedTests, curriculum, questions, regions, items };
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
  const { countries, curriculum, regions, items } = data;
  const [run, setRun] = useState<SessionRun>(() => startRun(data.questions));
  const empty = data.questions.length === 0;
  // Ids of the items that passed from not mastered to mastered in this round, in answer order.
  const [mastered, setMastered] = useState<readonly string[]>([]);
  // Those of them that can be tested out of, judged when they were mastered.
  const [testable, setTestable] = useState<readonly string[]>([]);
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
  // Prebuilt at load: a new `item.target` on every render would reset the globe's view. Re-asks
  // and later rounds only repeat items of the first queue.
  const item = question ? items.get(question.itemId)! : null;
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
    const unlocks = unlockLines(curriculum, mastered, nameOf);
    return (
      <div data-unsaved={unsaved}>
        <h2 ref={summaryRef} tabIndex={-1} className="session-summary">
          Round done: {run.correctInRound} of {run.answeredInRound} right
        </h2>
        {unlocks.map((line) => (
          <p key={line.id}>
            {line.text}
            {testable.includes(line.id) && (
              <>
                {' '}
                <Link to={testOutPath(line.id)}>Test out</Link>
              </>
            )}
          </p>
        ))}
        {unlocks.length > 0 && <p>These join your new questions from your next session.</p>}
        {questionsRemain(run) ? (
          <p>
            <button
              type="button"
              className="session-button"
              onClick={() => {
                setMastered([]);
                setTestable([]);
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
    let newlyMastered = false;
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
        newlyMastered = true;
      }
    } catch (error) {
      console.error('[session] could not record answer', question.itemId, error);
      setRecordFailed(true);
      setAnsweredRun(skipCurrent(run));
      return;
    }
    if (newlyMastered) {
      try {
        if (showsTestOutLink(curriculum, progress.current, data.finishedTests, question.itemId)) {
          setTestable((ids) => [...ids, question.itemId]);
        }
      } catch (error) {
        console.error('[session] could not check test-out', question.itemId, error);
      }
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
