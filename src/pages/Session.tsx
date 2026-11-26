import { Alert, Anchor, Button, Group, Stack, Text, Title } from '@mantine/core';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { buildCurriculum, regionsFromPlaces, type Curriculum } from '../engine/curriculum';
import { buildSession, dueQuestions, type SessionQuestion } from '../engine/session';
import {
  answerCurrent,
  nextRound,
  questionsRemain,
  roundEnded,
  skipCurrent,
  startRun,
  type SessionRun,
} from '../engine/sessionRun';
import { isMastered, localDayKey, type ItemProgress } from '../engine/srs';
import { introducedToday } from '../engine/today';
import { loadCountries, loadPlaces, loadRegions, type CountriesData, type RegionsData } from '../data/loaders';
import Exercise from '../exercises/Exercise';
import { buildExerciseItem } from '../exercises/item';
import type { ExerciseItem, ExerciseResult } from '../exercises/types';
import { targetPoint } from '../maps/geo';
import { progressStore } from '../storage/progressStore';
import { clearSessionRun, loadSessionRun, saveSessionRun, type SavedSession } from '../storage/sessionRunStore';
import Status from './LoadStatus';
import {
  answerEntry,
  countriesNeedingRegions,
  questionHeader,
  questionSeed,
  resumable,
  unlockLines,
  withMastered,
  type RoundMastery,
} from './sessionView';
import { showsTestOutLink, testOutPath } from './testOutView';
import { useLoaded } from './useLoaded';

interface SessionData {
  countries: CountriesData;
  progress: Record<string, ItemProgress>;
  /** Marker keys of the finished placement tests (see `placementKey`). */
  finishedTests: ReadonlySet<string>;
  curriculum: Curriculum;
  /** The session's first round queue, built when the data loaded (a resumed run's queue). */
  questions: SessionQuestion[];
  /** The run this tab had in progress before a reload, to carry on with; null for a new one. */
  resumed: SavedSession | null;
  /** Today's local day, which a saved run belongs to. */
  dayKey: string;
  /** The loaded regions of every country that owns a region or place question, or a resumed round's mastered item, by country id. */
  regions: ReadonlyMap<string, RegionsData>;
  /** The exercise item of every question in the first queue, by item id. */
  items: ReadonlyMap<string, ExerciseItem>;
}

const loadSessionData = async (): Promise<SessionData> => {
  const [countries, places, progress, finishedTests, settings] = await Promise.all([
    loadCountries(),
    loadPlaces(),
    progressStore.loadProgress(),
    progressStore.loadFinishedTests(),
    progressStore.loadSettings(),
  ]);
  const now = new Date();
  const curriculum = buildCurriculum(countries.countries, regionsFromPlaces(countries.countries, places), places);
  const dayKey = localDayKey(now, -now.getTimezoneOffset());
  const resumed = resumable(
    loadSessionRun(dayKey, progress, (id) => curriculum.items.has(id)),
    dueQuestions({ curriculum, progress, now }),
  );
  const questions = resumed ? [...resumed.run.queue] : buildSession({
    curriculum,
    progress,
    now,
    dailyCap: settings.dailyNewCap,
    introducedToday: introducedToday(curriculum, progress, now, -now.getTimezoneOffset()),
  });
  // Re-asks and later rounds only repeat these items, so these are all the regions a session needs,
  // plus those of a resumed round's mastered items, so a mastered region's line can name its country.
  const needed = countriesNeedingRegions(curriculum, [
    ...questions.map((question) => question.itemId),
    ...(resumed?.mastered ?? []),
  ]);
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
  return { countries, progress, finishedTests, curriculum, questions, resumed, dayKey, regions, items };
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
  const [run, setRun] = useState<SessionRun>(() => data.resumed?.run ?? startRun(data.questions));
  // Leaving the page ends the session: only a reload (which runs no cleanup) resumes it. A resumed
  // run is written again on mount, so StrictMode's dev remount (which runs the cleanup) keeps it.
  useEffect(() => {
    const { dayKey, resumed } = data;
    if (resumed) saveSessionRun(dayKey, resumed.run, resumed.mastered, resumed.testable);
    return clearSessionRun;
    // Only on mount: `data` is fixed for this page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A resumed run with an empty queue is the day's last summary, not an empty session.
  const empty = data.questions.length === 0 && !data.resumed;
  // What this round has mastered, in answer order, and which of it can be tested out of (judged when
  // mastered). Saved with the run, so a reload on a summary or mid-round keeps them.
  const [round, setRound] = useState<RoundMastery>(() => ({
    mastered: data.resumed?.mastered ?? [],
    testable: data.resumed?.testable ?? [],
  }));
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
  // Prebuilt at load: a new item on every render would redraw the globe and move its camera again.
  // Re-asks and later rounds only repeat items of the first queue.
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

  // A country's name is in `countries`; a region is only mastered after being asked or in a resumed
  // round, and either way its country's regions were loaded.
  const nameOf = (itemId: string): string => {
    const item = curriculum.items.get(itemId)!;
    const id = itemId.slice(itemId.indexOf(':') + 1);
    if (item.tier === 'country') return countries.countries.find((c) => c.id === id)?.name ?? id;
    const owner = regions.get(item.countryId.replace(/^country:/, ''));
    return owner?.regions.find((r) => r.id === id)?.name ?? id;
  };

  if (empty) {
    return (
      <Stack>
        <Text>There is nothing to study right now.</Text>
        <Anchor component={Link} to="/">
          Back to Home
        </Anchor>
      </Stack>
    );
  }

  if (ended || !question || !item) {
    const unlocks = unlockLines(curriculum, round.mastered, nameOf);
    return (
      <Stack data-unsaved={unsaved} align="flex-start">
        <Title order={2} size="h3" ref={summaryRef} tabIndex={-1} className="session-summary">
          Round done: {run.correctInRound} of {run.answeredInRound} right
        </Title>
        {unlocks.map((line) => (
          <Text key={line.id}>
            {line.text}
            {round.testable.includes(line.id) && (
              <>
                {' '}
                <Anchor component={Link} to={testOutPath(line.id)}>
                  Test out
                </Anchor>
              </>
            )}
          </Text>
        ))}
        {unlocks.length > 0 && <Text>These join your new questions from your next session.</Text>}
        {questionsRemain(run) ? (
          <Button
            onClick={() => {
              setRound({ mastered: [], testable: [] });
              const next = nextRound(run);
              saveSessionRun(data.dayKey, next, [], []);
              setRun(next);
            }}
          >
            Keep going
          </Button>
        ) : (
          <Text>That is everything for today.</Text>
        )}
        <Anchor component={Link} to="/">
          Back to Home
        </Anchor>
      </Stack>
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
        newlyMastered = true;
      }
    } catch (error) {
      console.error('[session] could not record answer', question.itemId, error);
      setRecordFailed(true);
      const skipped = skipCurrent(run);
      saveSessionRun(data.dayKey, skipped, round.mastered, round.testable);
      setAnsweredRun(skipped);
      return;
    }
    let roundAfter = round;
    if (newlyMastered) {
      let testOut = false;
      try {
        testOut = showsTestOutLink(curriculum, progress.current, data.finishedTests, question.itemId);
      } catch (error) {
        console.error('[session] could not check test-out', question.itemId, error);
      }
      roundAfter = withMastered(round, question.itemId, testOut);
      setRound(roundAfter);
    }
    const next = answerCurrent(run, { rating: result.rating, correct: result.correct, after });
    // Saved as answered, so a reload carries on after this question rather than asking it again.
    saveSessionRun(data.dayKey, next, roundAfter.mastered, roundAfter.testable);
    setAnsweredRun(next);
  };

  const onNext = () => {
    if (answeredRun) setRun(answeredRun);
    setAnsweredRun(null);
    setRecordFailed(false);
  };

  return (
    <div data-unsaved={unsaved}>
      <Group justify="space-between" mb="xs">
        <Text c="dimmed">{questionHeader(run)}</Text>
        <Anchor component={Link} to="/">
          Quit
        </Anchor>
      </Group>
      <div
        ref={questionRef}
        tabIndex={-1}
        data-testid="session-question"
        data-item-id={item.id}
        data-item-name={item.name}
        // Dev builds: where e2e aims a tap.
        data-answer={import.meta.env.DEV ? targetPoint(item.target).join(',') : undefined}
        data-rung={question.rung}
      >
        <Exercise
          key={run.answered}
          item={item}
          rung={question.rung}
          seed={questionSeed(item.id, run.answered, salt)}
          onAnswer={onAnswer}
          onNext={onNext}
          opening={run.answered === 0}
        />
        {recordFailed && (
          <Alert color="red" mt="sm">
            This answer could not be recorded, so this question is skipped for now.
          </Alert>
        )}
      </div>
    </div>
  );
}
