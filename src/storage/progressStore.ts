// The pages' only door to stored progress: one app-wide answer queue that every read and the
// import wait for, so a page never reads progress older than the answers already given and an
// import is never overwritten by a queued answer.

import type { ItemProgress } from '../engine/srs';
import type { ProgressFile } from './progressFile';
import { repo, type AnswerEntry, type ProgressRepo } from './repo';
import { createSaveQueue, type SaveQueue } from './saveQueue';

export interface ProgressStore {
  /** Answers waiting to be saved (or failed); the session pushes here. */
  answers: SaveQueue<AnswerEntry>;
  /** Stored progress once pending writes settled, with answers that failed to save laid over it. */
  loadProgress(): Promise<Record<string, ItemProgress>>;
  /** The stored file once pending writes settled. Answers that failed to save are not in it. */
  exportProgress(now: Date): Promise<ProgressFile>;
  /**
   * Replaces everything stored, and drops unsaved answers, once pending writes settled. An invalid
   * file throws and leaves the stored data and the queue unchanged.
   */
  importProgress(parsed: unknown): Promise<void>;
}

export function createProgressStore(repository: ProgressRepo): ProgressStore {
  const answers = createSaveQueue<AnswerEntry>((entry) => repository.recordAnswer(entry));

  return {
    answers,
    async loadProgress() {
      await answers.whenSettled();
      const stored = await repository.loadProgress();
      const progress = { ...stored };
      for (const entry of answers.unsavedEntries())
        progress[entry.progress.itemId] = entry.progress;
      return progress;
    },
    async exportProgress(now) {
      await answers.whenSettled();
      return repository.exportProgress(now);
    },
    async importProgress(parsed) {
      await answers.whenSettled();
      await repository.importProgress(parsed);
      answers.discard();
    },
  };
}

export const progressStore = createProgressStore(repo);
