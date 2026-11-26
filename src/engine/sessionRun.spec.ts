import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { SESSION_MAX_ASKS_PER_ITEM, SESSION_REQUEUE_GAP, SESSION_ROUND_SIZE } from './config';
import type { SessionQuestion } from './session';
import {
  answerCurrent,
  nextRound,
  questionsRemain,
  roundEnded,
  skipCurrent,
  startRun,
  type SessionRun,
} from './sessionRun';
import { applyAnswer, createProgress, localDayKey, type ItemProgress, type Rung } from './srs';

const T0 = new Date('2026-03-01T00:00:00Z');
const MIN = 60_000;

type Grade = 1 | 2 | 3 | 4;

const q = (n: number, rung: Rung = 1): SessionQuestion => ({ itemId: `country:c${n}`, rung });
const queueOf = (count: number, rung: Rung = 1): SessionQuestion[] =>
  Array.from({ length: count }, (_, i) => q(i, rung));
const ids = (run: SessionRun) => run.queue.map((x) => x.itemId.replace('country:c', ''));

/** Progress of an item that has been answered Good until it sits at `rung`. */
function atRung(rung: Rung): ItemProgress {
  let p = createProgress('country:x', T0);
  let t = 0;
  while (p.rung < rung) {
    t += MIN;
    const now = new Date(T0.getTime() + t);
    p = applyAnswer(p, p.rung, Rating.Good, now, localDayKey(now, 0));
  }
  return p;
}

/** Answers the head of the queue, applying `rating` to `before` (progress at the asked rung). */
function answer(run: SessionRun, before: ItemProgress, rating: Grade): SessionRun {
  const now = new Date(T0.getTime() + 10 * MIN);
  const next = applyAnswer(before, before.rung, rating, now, localDayKey(now, 0));
  return answerCurrent(run, { rating, correct: rating !== Rating.Again, after: next });
}

describe('sessionRun', () => {
  it('[SES-C04] starts with the whole queue, zero counts and a total capped at the round size', () => {
    const run = startRun(queueOf(5));
    expect(run).toMatchObject({ answered: 0, answeredInRound: 0, correctInRound: 0, roundTotal: 5 });
    expect(startRun(queueOf(30)).roundTotal).toBe(SESSION_ROUND_SIZE);
    expect(roundEnded(startRun([]))).toBe(true);
  });

  it('[SES-11] re-queues a climb at the next rung, SESSION_REQUEUE_GAP questions later', () => {
    const run = answer(startRun(queueOf(6)), atRung(1), Rating.Good);
    expect(ids(run)).toEqual(['1', '2', '3', '0', '4', '5']);
    expect(run.queue[SESSION_REQUEUE_GAP]).toEqual({ itemId: 'country:c0', rung: 2 });
    expect(run).toMatchObject({ answered: 1, answeredInRound: 1, correctInRound: 1, roundTotal: 7 });
  });

  it('[SES-11] re-queues an Again, including at L1, at its dropped rung', () => {
    const atL1 = answer(startRun(queueOf(5)), atRung(1), Rating.Again);
    expect(atL1.queue[SESSION_REQUEUE_GAP]).toEqual({ itemId: 'country:c0', rung: 1 });
    expect(atL1.correctInRound).toBe(0);
    const atL2 = answer(startRun([q(0, 2), q(1), q(2), q(3), q(4)]), atRung(2), Rating.Again);
    expect(atL2.queue[SESSION_REQUEUE_GAP]).toEqual({ itemId: 'country:c0', rung: 1 });
  });

  it('[SES-11] does not re-queue an L3 pass or an L2 Hard near-miss', () => {
    const l3 = answer(startRun([q(0, 3), q(1), q(2)]), atRung(3), Rating.Good);
    expect(ids(l3)).toEqual(['1', '2']);
    const hard = answer(startRun([q(0, 2), q(1), q(2)]), atRung(2), Rating.Hard);
    expect(ids(hard)).toEqual(['1', '2']);
    expect(hard.correctInRound).toBe(1);
  });

  it('[SES-11] puts the item at the end when fewer than SESSION_REQUEUE_GAP questions remain', () => {
    expect(ids(answer(startRun(queueOf(3)), atRung(1), Rating.Good))).toEqual(['1', '2', '0']);
    expect(ids(answer(startRun(queueOf(1)), atRung(1), Rating.Good))).toEqual(['0']);
  });

  it('[SES-12] stops re-queuing once an item has been answered SESSION_MAX_ASKS_PER_ITEM times', () => {
    let run = startRun([q(0)]);
    for (let n = 1; n < SESSION_MAX_ASKS_PER_ITEM; n++) {
      run = answer(run, atRung(1), Rating.Again);
      expect(ids(run)).toEqual(['0']);
    }
    run = answer(run, atRung(1), Rating.Again);
    expect(run.queue).toEqual([]);
    expect(run.asks['country:c0']).toBe(SESSION_MAX_ASKS_PER_ITEM);
  });

  it('[SES-12] never holds two pending questions for one item, over a long run', () => {
    let run = startRun(queueOf(8));
    let steps = 0;
    while (run.queue.length > 0 && steps < 500) {
      expect(new Set(ids(run)).size).toBe(run.queue.length);
      steps++;
      run = answer(run, atRung(1), steps % 2 ? Rating.Again : Rating.Good);
    }
    expect(run.queue).toEqual([]);
    expect(Math.max(...Object.values(run.asks))).toBeLessThanOrEqual(SESSION_MAX_ASKS_PER_ITEM);
  });

  it('[SES-13] ends a round after SESSION_ROUND_SIZE answers while questions remain, and keep going resets', () => {
    let run = startRun(queueOf(25, 3));
    for (let i = 0; i < SESSION_ROUND_SIZE; i++) {
      expect(roundEnded(run)).toBe(false);
      run = answer(run, atRung(3), Rating.Good);
    }
    expect(roundEnded(run)).toBe(true);
    expect(questionsRemain(run)).toBe(true);
    expect(run).toMatchObject({ answeredInRound: 20, correctInRound: 20, roundTotal: 20, answered: 20 });
    const next = nextRound(run);
    expect(next).toMatchObject({ answeredInRound: 0, correctInRound: 0, roundTotal: 5, answered: 20 });
    expect(roundEnded(next)).toBe(false);
    expect(next.queue).toEqual(run.queue);
  });

  it('[SES-13] ends a round when the queue empties, with nothing remaining', () => {
    let run = startRun([q(0, 3), q(1, 3)]);
    run = answer(run, atRung(3), Rating.Good);
    expect(roundEnded(run)).toBe(false);
    run = answer(run, atRung(3), Rating.Again);
    expect(roundEnded(run)).toBe(false);
    expect(run.queue).toHaveLength(1);
    // The lapsed item is back at L2; a Hard there is a near-miss that stays put.
    run = answer(run, atRung(2), Rating.Hard);
    expect(roundEnded(run)).toBe(true);
    expect(questionsRemain(run)).toBe(false);
  });

  it('[SES-C04] lets a re-queue grow the displayed total up to the round size, never past it', () => {
    // An L3 Again re-queues: 1 answered + 2 remaining + the item itself = 4.
    const small = answer(startRun([q(0, 3), q(1, 3), q(2, 3)]), atRung(3), Rating.Again);
    expect(small.roundTotal).toBe(4);
    // An L3 pass re-queues nothing: the total stays answered + remaining = 3.
    const shrunk = answer(startRun([q(0, 3), q(1, 3), q(2, 3)]), atRung(3), Rating.Good);
    expect(shrunk.roundTotal).toBe(3);
    // 19 queued, a climb re-queues: 1 answered + 19 remaining = 20, capped at the round size.
    expect(answer(startRun(queueOf(19)), atRung(1), Rating.Good).roundTotal).toBe(20);
    expect(answer(startRun(queueOf(40)), atRung(1), Rating.Good).roundTotal).toBe(20);
  });

  it('[SES-C04] does not mutate its inputs', () => {
    const queue = queueOf(5);
    const run = startRun(queue);
    const runSnapshot = JSON.stringify(run);
    const progress = atRung(1);
    const progressSnapshot = JSON.stringify(progress);
    const next = answer(run, progress, Rating.Good);
    nextRound(next);
    expect(JSON.stringify(run)).toBe(runSnapshot);
    expect(JSON.stringify(progress)).toBe(progressSnapshot);
    expect(queue).toEqual(queueOf(5));
  });

  describe('[SES-15, SES-C04] skipCurrent', () => {
    it('removes the head without a re-queue and leaves the round counts alone', () => {
      const run = startRun(queueOf(4));
      const next = skipCurrent(run);
      expect(ids(next)).toEqual(['1', '2', '3']);
      expect(next.answered).toBe(1);
      expect(next.answeredInRound).toBe(0);
      expect(next.correctInRound).toBe(0);
      expect(next.asks).toEqual({ 'country:c0': 1 });
      expect(next.roundTotal).toBe(3);
    });

    it('does not move the round towards SESSION_ROUND_SIZE', () => {
      let run = startRun(queueOf(SESSION_ROUND_SIZE + 5));
      for (let i = 0; i < SESSION_ROUND_SIZE; i++) run = skipCurrent(run);
      expect(run.answeredInRound).toBe(0);
      expect(roundEnded(run)).toBe(false);
      expect(questionsRemain(run)).toBe(true);
    });

    it('does not mutate its input and throws on an empty queue', () => {
      const run = startRun(queueOf(3));
      const snapshot = JSON.stringify(run);
      skipCurrent(run);
      expect(JSON.stringify(run)).toBe(snapshot);
      expect(() => skipCurrent(startRun([]))).toThrow('No current question');
    });
  });
});
