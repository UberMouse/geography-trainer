import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { answerCurrent, startRun, type SessionRun } from '../engine/sessionRun';
import { applyAnswer, createProgress } from '../engine/srs';
import { parseSavedRun } from './sessionRunStore';

const NOW = new Date('2026-03-01T09:00:00Z');
const DAY = '2026-03-01';
const known = (id: string) => id.startsWith('country:');

/** A run two questions in: France climbed to L2 and is queued again; Peru is next at L1. */
function midRun(): { run: SessionRun; progress: Record<string, ReturnType<typeof createProgress>> } {
  const france = applyAnswer(createProgress('country:france', NOW), 1, Rating.Good, NOW, DAY);
  const run = answerCurrent(
    startRun([
      { itemId: 'country:france', rung: 1 },
      { itemId: 'country:peru', rung: 1 },
    ]),
    { rating: Rating.Good, correct: true, after: france },
  );
  return { run, progress: { 'country:france': france } };
}

const saved = (dayKey: string, run: unknown) => JSON.stringify({ dayKey, run });

describe('parseSavedRun', () => {
  it('[SES-25, SES-C05] resumes a run saved today, queue and counts as they were', () => {
    const { run, progress } = midRun();
    expect(run.queue).toEqual([
      { itemId: 'country:peru', rung: 1 },
      { itemId: 'country:france', rung: 2 },
    ]);
    expect(parseSavedRun(saved(DAY, run), DAY, progress, known)).toEqual(run);
  });

  it('[SES-26, SES-C05] starts afresh for nothing saved, another day, bad JSON or a malformed run', () => {
    const { run, progress } = midRun();
    expect(parseSavedRun(null, DAY, progress, known)).toBeNull();
    expect(parseSavedRun(saved('2026-02-28', run), DAY, progress, known)).toBeNull();
    expect(parseSavedRun('{not json', DAY, progress, known)).toBeNull();
    expect(parseSavedRun(saved(DAY, { ...run, queue: [{ itemId: 'country:peru', rung: 4 }] }), DAY, progress, known)).toBeNull();
    expect(parseSavedRun(saved(DAY, { ...run, answered: -1 }), DAY, progress, known)).toBeNull();
    expect(parseSavedRun(saved(DAY, { ...run, itemTotal: undefined }), DAY, progress, known)).toBeNull();
  });

  it('[SES-26] starts afresh when nothing is left to ask', () => {
    const { run, progress } = midRun();
    expect(parseSavedRun(saved(DAY, { ...run, queue: [] }), DAY, progress, known)).toBeNull();
  });

  it('[SES-26] starts afresh when the progress can no longer answer a queued question', () => {
    const { run } = midRun();
    // Reset since: France has no row, so its L2 question cannot be answered.
    expect(parseSavedRun(saved(DAY, run), DAY, {}, known)).toBeNull();
    // An item the curriculum no longer has.
    const { progress } = midRun();
    expect(parseSavedRun(saved(DAY, run), DAY, progress, (id) => id !== 'country:peru')).toBeNull();
  });
});
