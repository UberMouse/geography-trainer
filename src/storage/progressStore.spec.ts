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

  it('a failed importProgress on a failed queue restores the dropped entries first, still failed', async () => {
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
      store.answers.push(entry('country:chile'));
      await store.answers.whenSettled();
      await expect(store.importProgress(file)).rejects.toThrow('quota');
      expect(store.answers.getState()).toEqual({ unsaved: 2, failed: true });
      expect(store.answers.unsavedEntries().map((e) => e.progress.itemId)).toEqual([
        'country:france',
        'country:chile',
      ]);
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

describe('seedProgress', () => {
  it('waits for a queued answer and never overwrites it', async () => {
    const store = createProgressStore(repo);
    const pushed = entry('country:france');
    store.answers.push(pushed);
    await store.seedProgress([createProgress('country:france', NOW), createProgress('country:peru', NOW)]);
    const stored = await repo.loadProgress();
    expect(stored['country:france']).toEqual(pushed.progress);
    expect(stored).toHaveProperty('country:peru');
  });

  it('makes loadProgress wait for a seed write in flight, and a failed one does not reject it', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const store = createProgressStore({
      ...repo,
      async seedProgress(rows) {
        await gate;
        await repo.seedProgress(rows);
      },
    });
    const seeding = store.seedProgress([createProgress('country:peru', NOW)]);
    const loading = store.loadProgress();
    release();
    await seeding;
    expect(await loading).toHaveProperty('country:peru');

    const failing = createProgressStore({ ...repo, seedProgress: () => Promise.reject(new Error('disk full')) });
    const failed = failing.seedProgress([createProgress('country:chile', NOW)]);
    const loadAfter = failing.loadProgress();
    await expect(failed).rejects.toThrow('disk full');
    await expect(loadAfter).resolves.not.toHaveProperty('country:chile');
  });

  it('rejects when the write fails', async () => {
    const store = createProgressStore({
      ...repo,
      seedProgress: () => Promise.reject(new Error('disk full')),
    });
    await expect(store.seedProgress([createProgress('country:peru', NOW)])).rejects.toThrow('disk full');
  });
});

describe('settings, markers and reset through the store', () => {
  it('reads the default limit, saves a valid one, rejects an invalid one without writing', async () => {
    const store = createProgressStore(repo);
    expect(await store.loadSettings()).toEqual({ dailyNewCap: 15 });
    await store.saveDailyNewCap(20);
    await expect(store.saveDailyNewCap(4)).rejects.toThrow();
    expect(await store.loadSettings()).toEqual({ dailyNewCap: 20 });
  });

  it('finishPlacement writes seeds and the marker; a read started at once sees both', async () => {
    const store = createProgressStore(repo);
    const row = createProgress('country:peru', NOW);
    const finished = store.finishPlacement('placement:countries', [row]);
    const [tests, progress] = await Promise.all([store.loadFinishedTests(), store.loadProgress()]);
    await finished;
    expect(tests).toEqual(new Set(['placement:countries']));
    expect(progress['country:peru']).toEqual(row);
  });

  it('a failed finishPlacement rejects and stores neither', async () => {
    const store = createProgressStore({
      ...repo,
      finishPlacement: () => Promise.reject(new Error('disk full')),
    });
    await expect(store.finishPlacement('placement:countries', [])).rejects.toThrow('disk full');
    expect(await repo.loadFinishedTests()).toEqual([]);
  });

  it('resetProgress clears progress and markers, keeps settings, drops unsaved answers', async () => {
    const store = createProgressStore(flaky(Infinity));
    await store.saveDailyNewCap(30);
    await store.finishPlacement('placement:countries', []);
    store.answers.push(entry('country:peru'));
    await store.resetProgress();
    expect(store.answers.getState()).toEqual({ unsaved: 0, failed: false });
    expect(await store.loadProgress()).toEqual({});
    expect(await store.loadFinishedTests()).toEqual(new Set());
    expect(await store.loadSettings()).toEqual({ dailyNewCap: 30 });
  });

  it('a marker finished right after a reset was started survives it', async () => {
    const store = createProgressStore(repo);
    await store.finishPlacement('placement:countries', []);
    const reset = store.resetProgress();
    const finished = store.finishPlacement('placement:region:us.tx', []);
    await Promise.all([reset, finished]);
    expect(await store.loadFinishedTests()).toEqual(new Set(['placement:region:us.tx']));
  });

  it('a read started right after a reset waits for it', async () => {
    const store = createProgressStore(repo);
    await store.finishPlacement('placement:countries', []);
    const reset = store.resetProgress();
    expect(await store.loadFinishedTests()).toEqual(new Set());
    await reset;
  });

  it('a failed reset changes nothing, queued unsaved answers included', async () => {
    const store = createProgressStore({
      ...flaky(1),
      resetProgress: () => Promise.reject(new Error('blocked')),
    });
    await store.finishPlacement('placement:countries', []);
    const pushed = entry('country:peru');
    store.answers.push(pushed);
    await expect(store.resetProgress()).rejects.toThrow('blocked');
    expect(store.answers.getState()).toEqual({ unsaved: 1, failed: true });
    expect((await store.loadProgress())['country:peru']).toEqual(pushed.progress);
    expect(await store.loadFinishedTests()).toEqual(new Set(['placement:countries']));
  });
});
