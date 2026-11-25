// The pages' only door to stored progress: one app-wide answer queue that every read and the
// import wait for, so a page never reads progress older than the answers already given and an
// import is never overwritten by a queued answer.

import type { ItemProgress } from '../engine/srs';
import { validateProgressFile, type ProgressFile } from './progressFile';
import type { Settings } from './settings';
import { repo, type AnswerEntry, type ProgressRepo } from './repo';
import { createSaveQueue, type SaveQueue } from './saveQueue';

export interface ProgressStore {
  /** Answers waiting to be saved (or failed); the session pushes here. */
  answers: SaveQueue<AnswerEntry>;
  /** Stored progress once pending writes settled, with answers that failed to save laid over it. */
  loadProgress(): Promise<Record<string, ItemProgress>>;
  /**
   * Adds progress rows (placement results) once pending writes settled, never overwriting an item
   * that already has a stored row. Rejects when the write fails.
   */
  seedProgress(rows: ItemProgress[]): Promise<void>;
  /** Stored settings once pending writes settled; a missing or invalid limit reads as 15. */
  loadSettings(): Promise<Settings>;
  /** Saves the daily limit once pending writes settled. Rejects, writing nothing, outside 5-50. */
  saveDailyNewCap(value: number): Promise<void>;
  /** Marker keys of the finished placement tests, once pending writes settled. */
  loadFinishedTests(): Promise<Set<string>>;
  /**
   * Adds the placement's seed rows (never overwriting a stored row) and the test's marker key
   * (`placementKey(scope)`) in one transaction, once pending writes settled: both or neither.
   */
  finishPlacement(key: string, rows: ItemProgress[]): Promise<void>;
  /**
   * Clears progress, answers and markers (not settings), and drops unsaved answers, once pending
   * writes settled. A failed reset throws and leaves the stored data and the queue unchanged.
   */
  resetProgress(): Promise<void>;
  /**
   * The stored file once pending writes settled; a failed queue is retried first. Answers still
   * unsaved after that are not in it (see `answers.getState().unsaved`).
   */
  exportProgress(now: Date): Promise<ProgressFile>;
  /**
   * Replaces everything stored, and drops unsaved answers, once pending writes settled. An invalid
   * file, or a failed import, throws and leaves the stored data and the queue unchanged.
   */
  importProgress(parsed: unknown): Promise<void>;
}

export function createProgressStore(repository: ProgressRepo): ProgressStore {
  const answers = createSaveQueue<AnswerEntry>((entry) => repository.recordAnswer(entry));
  // Writes in flight (seeds, markers, settings, reset, import), from the call to settling; reads
  // and later writes wait for them.
  const seeding = new Set<Promise<void>>();
  const whenSeedsSettled = async () => {
    await Promise.allSettled([...seeding]);
  };

  /**
   * Runs `write` after the queue settled and the writes already in flight did, and registers it
   * from the call, so a read or write started later waits for it. Waiting only for the writes
   * registered before it keeps two pending writes from waiting for each other.
   */
  const tracked = (write: () => Promise<void>, beforeWrite?: () => void) => {
    const earlier = [...seeding];
    const running = (async () => {
      await answers.whenSettled();
      await Promise.allSettled(earlier);
      beforeWrite?.();
      await write();
    })();
    seeding.add(running);
    const done = () => void seeding.delete(running);
    running.then(done, done);
    return running;
  };
  /** Waits for everything pending, then drops the unsaved answers while `run` replaces the data. */
  const replacingEverything = (run: () => Promise<void>) => {
    let dropped: ReturnType<typeof answers.unsavedEntries> = [];
    let wasFailed = false;
    return tracked(
      async () => {
        // Nothing is running now; an emptied queue has nothing for a retry or push to write over it.
        try {
          await run();
        } catch (error) {
          answers.restore(dropped, wasFailed);
          throw error;
        }
      },
      () => {
        dropped = answers.unsavedEntries();
        wasFailed = answers.getState().failed;
        answers.discard();
      },
    );
  };

  return {
    answers,
    async loadProgress() {
      await answers.whenSettled();
      await whenSeedsSettled();
      const stored = await repository.loadProgress();
      const progress = { ...stored };
      for (const entry of answers.unsavedEntries())
        progress[entry.progress.itemId] = entry.progress;
      return progress;
    },
    seedProgress: (rows) => tracked(() => repository.seedProgress(rows)),
    async loadSettings() {
      await answers.whenSettled();
      await whenSeedsSettled();
      return repository.loadSettings();
    },
    saveDailyNewCap: (value) => tracked(() => repository.saveDailyNewCap(value)),
    async loadFinishedTests() {
      await answers.whenSettled();
      await whenSeedsSettled();
      return new Set(await repository.loadFinishedTests());
    },
    finishPlacement: (key, rows) => tracked(() => repository.finishPlacement(key, rows)),
    resetProgress: () => replacingEverything(() => repository.resetProgress()),
    async exportProgress(now) {
      if (answers.getState().failed) await answers.retry();
      await answers.whenSettled();
      await whenSeedsSettled();
      return repository.exportProgress(now);
    },
    async importProgress(parsed) {
      validateProgressFile(parsed);
      await replacingEverything(() => repository.importProgress(parsed));
    },
  };
}

export const progressStore = createProgressStore(repo);
