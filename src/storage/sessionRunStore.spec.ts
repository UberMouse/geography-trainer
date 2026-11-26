import { Rating } from 'ts-fsrs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerCurrent, startRun, type SessionRun } from '../engine/sessionRun';
import { applyAnswer, createProgress, type ItemProgress } from '../engine/srs';
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

/** Progress that `isMastered` accepts. */
const masteredRow = (p: ItemProgress): ItemProgress => ({ ...p, l3PassDays: ['2026-02-27', '2026-02-28'] });

const saved = (dayKey: string, run: unknown, lists: object = {}) => JSON.stringify({ dayKey, run, ...lists });

describe('parseSavedRun', () => {
  it('[SES-25, SES-C05] resumes a run saved today, queue and counts as they were', () => {
    const { run, progress } = midRun();
    expect(run.queue).toEqual([
      { itemId: 'country:peru', rung: 1 },
      { itemId: 'country:france', rung: 2 },
    ]);
    expect(parseSavedRun(saved(DAY, run), DAY, progress, known)).toEqual({ run, mastered: [], testable: [] });
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

  it('[SES-26, SES-C05] starts afresh when nothing is left to ask and nothing was answered', () => {
    const { run, progress } = midRun();
    expect(parseSavedRun(saved(DAY, { ...run, queue: [], answered: 0 }), DAY, progress, known)).toBeNull();
  });

  it('[SES-25, SES-C05] returns an empty queue after answers: the last summary of the day', () => {
    const { run, progress } = midRun();
    const done = { ...run, queue: [] };
    const lists = { mastered: ['country:france'], testable: ['country:france'] };
    const backed = { 'country:france': masteredRow(progress['country:france']!), 'country:peru': createProgress('country:peru', NOW) };
    expect(parseSavedRun(saved(DAY, done, lists), DAY, backed, known)).toEqual({ run: done, ...lists });
  });

  it('[SES-25, SES-C05] reads mastered and testable as saved, and a missing list as empty', () => {
    const { run, progress } = midRun();
    const lists = { mastered: ['country:france', 'country:peru'], testable: ['country:peru'] };
    const backed = {
      'country:france': masteredRow(progress['country:france']!),
      'country:peru': masteredRow(createProgress('country:peru', NOW)),
    };
    expect(parseSavedRun(saved(DAY, run, lists), DAY, backed, known)).toEqual({ run, ...lists });
    expect(parseSavedRun(saved(DAY, run, { mastered: ['country:peru'] }), DAY, backed, known)).toEqual({
      run,
      mastered: ['country:peru'],
      testable: [],
    });
    expect(parseSavedRun(saved(DAY, run, { testable: [] }), DAY, backed, known)?.mastered).toEqual([]);
  });

  it('[SES-26, SES-C05] starts afresh for a mastered or testable list that is not valid', () => {
    const { run, progress } = midRun();
    const parse = (lists: object) => parseSavedRun(saved(DAY, run, lists), DAY, progress, known);
    expect(parse({ mastered: 'country:france' })).toBeNull();
    expect(parse({ mastered: ['country:france', 3] })).toBeNull();
    expect(parse({ mastered: ['region:x.y'] })).toBeNull();
    expect(parse({ testable: {} })).toBeNull();
    expect(parse({ mastered: ['country:france'], testable: [7] })).toBeNull();
    expect(parse({ mastered: ['country:france'], testable: ['country:peru'] })).toBeNull();
    expect(parse({ testable: ['country:peru'] })).toBeNull();
  });

  it('[SES-25, SES-C05] leaves out an unlock the saved progress does not back', () => {
    const { run, progress } = midRun();
    const lists = { mastered: ['country:france', 'country:peru'], testable: ['country:france', 'country:peru'] };
    const backed = { ...progress, 'country:peru': masteredRow(createProgress('country:peru', NOW)) };
    // France's mastering answer was not saved (not mastered in progress); Peru's was.
    expect(parseSavedRun(saved(DAY, run, lists), DAY, backed, known)).toEqual({
      run,
      mastered: ['country:peru'],
      testable: ['country:peru'],
    });
    // No row at all for Peru: left out too.
    expect(parseSavedRun(saved(DAY, run, lists), DAY, progress, known)).toEqual({ run, mastered: [], testable: [] });
  });

  it('[SES-26, SES-C05] starts afresh when nothing is left to ask and an item asked has no progress', () => {
    const { run, progress } = midRun();
    const done = { ...run, queue: [], asks: { ...run.asks, 'country:peru': 1 } };
    // Peru was asked but has no row: reset since, or its answer was never recorded.
    expect(parseSavedRun(saved(DAY, done), DAY, progress, known)).toBeNull();
    expect(parseSavedRun(saved(DAY, done), DAY, {}, known)).toBeNull();
    const backed = { ...progress, 'country:peru': createProgress('country:peru', NOW) };
    expect(parseSavedRun(saved(DAY, done), DAY, backed, known)).toEqual({ run: done, mastered: [], testable: [] });
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

  it('saves { dayKey, run, mastered, testable } as JSON under its key, loads it back, and clears it', () => {
    const storage = memoryStorage();
    vi.stubGlobal('sessionStorage', storage);
    const { run, progress: mid } = midRun();
    const progress = { 'country:france': masteredRow(mid['country:france']!) };
    const lists = { mastered: ['country:france'], testable: ['country:france'] };
    saveSessionRun(DAY, run, lists.mastered, lists.testable);
    expect([...storage.items.keys()]).toEqual([KEY]);
    expect(JSON.parse(storage.items.get(KEY)!)).toEqual({ dayKey: DAY, run, ...lists });
    expect(loadSessionRun(DAY, progress, known)).toEqual({ run, ...lists });
    // Keep going saves the lists empty, so the next round's summary lists only what that round masters.
    saveSessionRun(DAY, run, [], []);
    expect(loadSessionRun(DAY, progress, known)).toEqual({ run, mastered: [], testable: [] });
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
    expect(() => saveSessionRun(DAY, run, [], [])).not.toThrow();
    expect(loadSessionRun(DAY, progress, known)).toBeNull();
    expect(() => clearSessionRun()).not.toThrow();
  });
});
