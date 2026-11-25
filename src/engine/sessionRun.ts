// Runs a session over the queue `buildSession` produced: re-queues items that climbed or lapsed, and
// splits the session into rounds. Pure and immutable: every function returns a new run.

import { Rating, type Grade } from 'ts-fsrs';
import { SESSION_MAX_ASKS_PER_ITEM, SESSION_REQUEUE_GAP, SESSION_ROUND_SIZE } from './config';
import type { SessionQuestion } from './session';
import { dueRung, type ItemProgress } from './srs';

export interface SessionRun {
  /** Questions still to ask; the head is the current question. */
  readonly queue: readonly SessionQuestion[];
  /** Questions answered in the whole session. */
  readonly answered: number;
  /** Questions answered in the current round. */
  readonly answeredInRound: number;
  /** Correct answers in the current round. */
  readonly correctInRound: number;
  /** Answers given so far this session, per item id. */
  readonly asks: Readonly<Record<string, number>>;
  /** The round's displayed total ("of N"): min(SESSION_ROUND_SIZE, answeredInRound + queue.length). */
  readonly roundTotal: number;
}

export interface RunAnswer {
  rating: Grade;
  correct: boolean;
  /** The item's progress after `applyAnswer` for this answer. */
  after: ItemProgress;
}

const roundTotalOf = (answeredInRound: number, queueLength: number): number =>
  Math.min(SESSION_ROUND_SIZE, answeredInRound + queueLength);

export function startRun(questions: readonly SessionQuestion[]): SessionRun {
  return {
    queue: [...questions],
    answered: 0,
    answeredInRound: 0,
    correctInRound: 0,
    asks: {},
    roundTotal: roundTotalOf(0, questions.length),
  };
}

/** A round ends after SESSION_ROUND_SIZE answers or when the queue empties. */
export function roundEnded(run: SessionRun): boolean {
  return run.answeredInRound >= SESSION_ROUND_SIZE || run.queue.length === 0;
}

/** True when questions remain, so a finished round offers "Keep going". */
export function questionsRemain(run: SessionRun): boolean {
  return run.queue.length > 0;
}

/**
 * Records the answer to the current question (the head of the queue) and removes it. The item is
 * re-queued at its new rung, SESSION_REQUEUE_GAP questions later (at the end when fewer remain), when
 * it climbed or the rating was Again, unless this was its SESSION_MAX_ASKS_PER_ITEM-th answer.
 * Throws when the queue is empty.
 */
export function answerCurrent(run: SessionRun, answer: RunAnswer): SessionRun {
  const [current, ...rest] = run.queue;
  if (!current) throw new Error('No current question');
  const asked = (run.asks[current.itemId] ?? 0) + 1;
  const climbed = answer.after.rung > current.rung;
  const requeue = (climbed || answer.rating === Rating.Again) && asked < SESSION_MAX_ASKS_PER_ITEM;
  const queue = requeue
    ? [
        ...rest.slice(0, SESSION_REQUEUE_GAP),
        { itemId: current.itemId, rung: dueRung(answer.after) },
        ...rest.slice(SESSION_REQUEUE_GAP),
      ]
    : rest;
  const answeredInRound = run.answeredInRound + 1;
  return {
    queue,
    answered: run.answered + 1,
    answeredInRound,
    correctInRound: run.correctInRound + (answer.correct ? 1 : 0),
    asks: { ...run.asks, [current.itemId]: asked },
    roundTotal: roundTotalOf(answeredInRound, queue.length),
  };
}

/**
 * Drops the current question (the head of the queue) without re-queuing it, counting it as an answered,
 * incorrect question. For an answer that could not be recorded. Throws when the queue is empty.
 */
export function skipCurrent(run: SessionRun): SessionRun {
  const [current, ...queue] = run.queue;
  if (!current) throw new Error('No current question');
  const answeredInRound = run.answeredInRound + 1;
  return {
    queue,
    answered: run.answered + 1,
    answeredInRound,
    correctInRound: run.correctInRound,
    asks: { ...run.asks, [current.itemId]: (run.asks[current.itemId] ?? 0) + 1 },
    roundTotal: roundTotalOf(answeredInRound, queue.length),
  };
}

/** "Keep going": the next round, with its counts at zero and the queue as it is. */
export function nextRound(run: SessionRun): SessionRun {
  return { ...run, answeredInRound: 0, correctInRound: 0, roundTotal: roundTotalOf(0, run.queue.length) };
}
