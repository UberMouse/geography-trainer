import { Alert, Anchor, Button, Group, Stack, Text, Title } from '@mantine/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  answerPlacement,
  finishPlacement,
  nextQuestion,
  placementCredit,
  placementSeeds,
  startPlacement,
  type PlacementCredit,
  type PlacementItem,
  type PlacementQuestion,
  type PlacementResult,
  type PlacementState,
} from '../engine/placement';
import { localDayKey, seedFromPlacement, type ItemProgress } from '../engine/srs';
import Exercise from '../exercises/Exercise';
import type { ExerciseItem, ExerciseResult } from '../exercises/types';
import { targetPoint } from '../maps/geo';
import { placementKey } from '../storage/placementKeys';
import { progressStore } from '../storage/progressStore';
import {
  emptyPoolText,
  NOTHING_TO_ASK_TEXT,
  placementHeader,
  resultLines,
  saveFailureText,
  type FailedSave,
  type PlacementTier,
} from './placementView';
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
  /** The marker scope: `COUNTRIES_SCOPE`, or the item id being tested out of. */
  scope: string;
  /** The country or region being tested out of; absent for the countries test. */
  scopeName?: string;
}

const dayKeyOf = (now: Date) => localDayKey(now, -now.getTimezoneOffset());
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One placement test over `pool`: the question loop, saving, and the result screen. */
export default function PlacementRun({ pool, items, progress, tier, heading, scope, scopeName }: PlacementRunProps) {
  // The state holding the pending question, and that question; null once nothing is left to ask.
  const [asking, setAsking] = useState<{ state: PlacementState; question: PlacementQuestion } | null>(
    () => nextQuestion(startPlacement(pool, Math.random), Math.random),
  );
  // The state after the current question's answer; it replaces `asking` when the learner presses Next.
  const [answered, setAnswered] = useState<PlacementState | null>(null);
  // The credit the answer on screen earned, for the note under its reveal.
  const [credit, setCredit] = useState<PlacementCredit | null>(null);
  // Set when the test has ended: the result, and how saving its seeds is going.
  const [ended, setEnded] = useState<PlacementResult | null>(null);
  const [saving, setSaving] = useState<{ status: 'saving' | 'saved' } | { status: 'failed'; error: string }>(
    { status: 'saving' },
  );
  // Passes that failed to save as they were answered; the final save writes them again.
  const [failedSaves, setFailedSaves] = useState<FailedSave[]>([]);
  const [salt] = useState(() => Math.floor(Math.random() * 2 ** 32));
  const questionRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const state = answered ?? asking?.state ?? null;
  const answeredCount = state?.answers.length ?? 0;
  const saveFailure = saveFailureText(failedSaves);
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
      await progressStore.finishPlacement(placementKey(scope), seeds);
      setSaving({ status: 'saved' });
    } catch (error) {
      console.error('[placement] could not save results', error);
      setSaving({ status: 'failed', error: messageOf(error) });
    }
  };

  const finish = (final: PlacementState) => {
    // A second call (a fast double click) must not start another save; Try again calls `save`.
    if (finishedRef.current) return;
    finishedRef.current = true;
    const result = finishPlacement(final);
    setEnded(result);
    void save(result);
  };

  if (!ended && !asking) {
    return (
      <Stack>
        <Title order={1} size="h3">
          {heading}
        </Title>
        <Text>{pool.length === 0 ? emptyPoolText(tier, scopeName) : NOTHING_TO_ASK_TEXT}</Text>
        <Anchor component={Link} to="/">
          Back to Home
        </Anchor>
      </Stack>
    );
  }

  if (ended) {
    const done = saving.status === 'saved';
    let body: ReactNode;
    if (saving.status === 'saving') body = <Text>Saving your results…</Text>;
    else if (saving.status === 'failed') {
      body = (
        <Alert color="red">
          <Stack align="flex-start" gap="xs">
            <Text>Could not save your placement results: {saving.error}</Text>
            <Button
              onClick={() => {
                setSaving({ status: 'saving' });
                void save(ended);
              }}
            >
              Try again
            </Button>
          </Stack>
        </Alert>
      );
    }
    return (
      <Stack align="flex-start">
        <Title order={1} size="h3">
          {heading}
        </Title>
        <Title order={2} size="h4" ref={resultRef} tabIndex={-1} className="session-summary">
          Placement done
        </Title>
        {resultLines(ended, tier).map((line) => (
          <Text key={line}>{line}</Text>
        ))}
        {body}
        {done && (
          <Button component={Link} to="/session">
            Start studying
          </Button>
        )}
        <Anchor component={Link} to="/">
          Back to Home
        </Anchor>
      </Stack>
    );
  }

  const { question } = asking!;
  const item = items.get(question.itemId)!;

  const onAnswer = (result: ExerciseResult) => {
    const earned = placementCredit(item.tier, result.rating, result.km);
    const after = answerPlacement(asking!.state, question.itemId, earned);
    setAnswered(after);
    setCredit(earned);
    if (earned !== 1) return;
    // A pass is stored at once, so quitting partway keeps it.
    const now = new Date();
    progressStore.seedProgress([seedFromPlacement(question.itemId, 'passed', now, dayKeyOf(now))]).then(
      () => undefined,
      (error: unknown) => {
        console.error('[placement] could not save answer', question.itemId, error);
        setFailedSaves((prev) => [...prev, { itemId: question.itemId, message: messageOf(error) }]);
      },
    );
  };

  const onNext = () => {
    if (!answered) return;
    const following = nextQuestion(answered, Math.random);
    setAnswered(null);
    setCredit(null);
    if (following) setAsking(following);
    else finish(answered);
  };

  return (
    <Stack gap="sm">
      <Title order={1} size="h3">
        {heading}
      </Title>
      <Group justify="space-between">
        <Text c="dimmed">{placementHeader(position, state?.items.length ?? 0)}</Text>
        <Anchor component={Link} to="/">
          Quit
        </Anchor>
      </Group>
      <div
        ref={questionRef}
        tabIndex={-1}
        data-testid="placement-question"
        data-item-id={item.id}
        data-item-name={item.name}
        // Dev builds: where e2e aims a tap.
        data-answer={import.meta.env.DEV ? targetPoint(item.target).join(',') : undefined}
        data-rung={3}
      >
        <Exercise
          key={position}
          item={item}
          rung={3}
          seed={questionSeed(item.id, position, salt)}
          onAnswer={onAnswer}
          onNext={onNext}
          opening={position === 0}
          note={
            credit === 0.5 && (
              <Text c="yellow" data-testid="placement-close">
                Close: that counts as roughly knowing where it is.
              </Text>
            )
          }
        />
      </div>
      {saveFailure !== null && <Alert color="red">{saveFailure}</Alert>}
      {answeredCount > 0 && (
        <Button variant="default" onClick={() => finish(state!)} style={{ alignSelf: 'flex-start' }}>
          Finish now
        </Button>
      )}
    </Stack>
  );
}
