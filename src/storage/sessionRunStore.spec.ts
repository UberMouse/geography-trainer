import { Rating } from 'ts-fsrs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerCurrent, startRun, type SessionRun } from '../engine/sessionRun';
import { applyAnswer, createProgress } from '../engine/srs';
import { clearSessionRun, loadSessionRun, parseSavedRun, saveSessionRun } from './sessionRunStore';

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

describe('[SES-C05] the saved run in sessionStorage', () => {
  const KEY = 'geography-trainer:session-run';

  /** A Map-backed stand-in for the tab's sessionStorage (the specs run in node, which has none). */
  function memoryStorage() {
    const items = new Map<string, string>();
    return {
      items,
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves { dayKey, run } as JSON under its key, loads it back, and clears it', () => {
    const storage = memoryStorage();
    vi.stubGlobal('sessionStorage', storage);
    const { run, progress } = midRun();
    saveSessionRun(DAY, run);
    expect([...storage.items.keys()]).toEqual([KEY]);
    expect(JSON.parse(storage.items.get(KEY)!)).toEqual({ dayKey: DAY, run });
    expect(loadSessionRun(DAY, progress, known)).toEqual(run);
    clearSessionRun();
    expect(storage.items.size).toBe(0);
    expect(loadSessionRun(DAY, progress, known)).toBeNull();
  });

  it('[SES-26] starts afresh, without throwing, when storage is missing or refuses access', () => {
    const { run, progress } = midRun();
    vi.stubGlobal('sessionStorage', undefined);
    expect(loadSessionRun(DAY, progress, known)).toBeNull();
    const refuses = () => {
      throw new Error('SecurityError');
    };
    vi.stubGlobal('sessionStorage', { getItem: refuses, setItem: refuses, removeItem: refuses });
    expect(() => saveSessionRun(DAY, run)).not.toThrow();
    expect(loadSessionRun(DAY, progress, known)).toBeNull();
    expect(() => clearSessionRun()).not.toThrow();
  });
});
