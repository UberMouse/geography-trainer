import 'fake-indexeddb/auto';
import { Rating } from 'ts-fsrs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAnswer, createProgress } from '../engine/srs';
import { createProgressStore } from './progressStore';
import { createRepo, type AnswerEntry, type ProgressRepo } from './repo';

const NOW = new Date('2026-03-04T10:00:00Z');

function entry(itemId: string, rating: 1 | 2 | 3 | 4 = Rating.Good): AnswerEntry {
  const progress = applyAnswer(createProgress(itemId, NOW), 1, rating, NOW, '2026-03-04');
  return {
    progress,
    answer: {
      itemId,
      rung: 1,
      rating,
      correct: true,
      timeMs: 1000,
      at: NOW.getTime(),
      dayKey: '2026-03-04',
    },
  };
}

let repo: ProgressRepo;
let counter = 0;

beforeEach(() => {
  counter += 1;
  repo = createRepo(`store-test-${counter}`);
});
afterEach(() => repo.close());

/** The repo, except that `recordAnswer` rejects the first `failures` times. */
function flaky(failures: number): ProgressRepo {
  let left = failures;
  return {
    ...repo,
    async recordAnswer(e) {
      if (left-- > 0) throw new Error('disk full');
      await repo.recordAnswer(e);
    },
  };
}

describe('createProgressStore', () => {
  it('loadProgress started right after a push returns the pushed progress', async () => {
    const store = createProgressStore(repo);
    const pushed = entry('country:france');
    store.answers.push(pushed);
    const loaded = await store.loadProgress();
    expect(loaded['country:france']).toEqual(pushed.progress);
    expect(await repo.loadProgress()).toHaveProperty('country:france');
  });

  it('loadProgress resolves on a failing queue and includes the unsaved progress', async () => {
    const store = createProgressStore(flaky(1));
    const pushed = entry('country:peru');
    store.answers.push(pushed);
    const loaded = await store.loadProgress();
    expect(loaded['country:peru']).toEqual(pushed.progress);
    expect(store.answers.getState()).toEqual({ unsaved: 1, failed: true });
    expect(await repo.loadProgress()).toEqual({});
  });

  it('importProgress waits for a queued write and is not overwritten by it', async () => {
    const source = createRepo(`store-source-${counter}`);
    try {
      await source.recordAnswer(entry('country:peru'));
      const file = await source.exportProgress(NOW);
      const store = createProgressStore(repo);
      store.answers.push(entry('country:france'));
      await store.importProgress(file);
      expect(Object.keys(await repo.loadProgress())).toEqual(['country:peru']);
      expect(store.answers.getState()).toEqual({ unsaved: 0, failed: false });
    } finally {
      source.close();
    }
  });

  it('an invalid import leaves the unsaved entries in place', async () => {
    const store = createProgressStore(flaky(1));
    store.answers.push(entry('country:france'));
    await store.answers.whenSettled();
    await expect(store.importProgress({ nope: true })).rejects.toThrow();
    expect(store.answers.getState()).toEqual({ unsaved: 1, failed: true });
    expect(store.answers.unsavedEntries()).toHaveLength(1);
  });

  it('exportProgress waits for a queued write', async () => {
    const store = createProgressStore(repo);
    store.answers.push(entry('country:france'));
    const file = await store.exportProgress(NOW);
    expect(file.progress.map((p) => p.itemId)).toEqual(['country:france']);
  });

  it('exportProgress retries a failed queue and includes the entry once it saves', async () => {
    const store = createProgressStore(flaky(1));
    store.answers.push(entry('country:peru'));
    await store.answers.whenSettled();
    expect(store.answers.getState().failed).toBe(true);
    const file = await store.exportProgress(NOW);
    expect(file.progress.map((p) => p.itemId)).toEqual(['country:peru']);
  });

  it('exportProgress resolves without an entry that keeps failing', async () => {
    const store = createProgressStore(flaky(Infinity));
    store.answers.push(entry('country:peru'));
    const file = await store.exportProgress(NOW);
    expect(file.progress).toEqual([]);
    expect(store.answers.getState()).toEqual({ unsaved: 1, failed: true });
  });

  it('a failed importProgress puts the dropped entries back in the queue', async () => {
    const source = createRepo(`store-source-${counter}`);
    try {
      await source.recordAnswer(entry('country:peru'));
      const file = await source.exportProgress(NOW);
      const store = createProgressStore({
        ...flaky(Infinity),
        async importProgress() {
          throw new Error('quota');
        },
      });
      store.answers.push(entry('country:france'));
      await store.answers.whenSettled();
      await expect(store.importProgress(file)).rejects.toThrow('quota');
      expect(store.answers.getState()).toEqual({ unsaved: 1, failed: true });
      expect(store.answers.unsavedEntries()[0]?.progress.itemId).toBe('country:france');
    } finally {
      source.close();
    }
  });

  it('a retry during the import does not write the old entry over it', async () => {
    const source = createRepo(`store-source-${counter}`);
    try {
      await source.recordAnswer(entry('country:peru'));
      const file = await source.exportProgress(NOW);
      const flakyRepo = flaky(1);
      const store = createProgressStore({
        ...flakyRepo,
        async importProgress(parsed) {
          void store.answers.retry();
          await repo.importProgress(parsed);
        },
      });
      store.answers.push(entry('country:france'));
      await store.answers.whenSettled();
      await store.importProgress(file);
      expect(Object.keys(await repo.loadProgress())).toEqual(['country:peru']);
    } finally {
      source.close();
    }
  });
});
