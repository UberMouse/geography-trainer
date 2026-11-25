// The pages' only door to stored progress: one app-wide answer queue that every read and the
// import wait for, so a page never reads progress older than the answers already given and an
// import is never overwritten by a queued answer.

import type { ItemProgress } from '../engine/srs';
import { validateProgressFile, type ProgressFile } from './progressFile';
import { repo, type AnswerEntry, type ProgressRepo } from './repo';
import { createSaveQueue, type SaveQueue } from './saveQueue';

export interface ProgressStore {
  /** Answers waiting to be saved (or failed); the session pushes here. */
  answers: SaveQueue<AnswerEntry>;
  /** Stored progress once pending writes settled, with answers that failed to save laid over it. */
  loadProgress(): Promise<Record<string, ItemProgress>>;
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
      if (answers.getState().failed) await answers.retry();
      await answers.whenSettled();
      return repository.exportProgress(now);
    },
    async importProgress(parsed) {
      validateProgressFile(parsed);
      await answers.whenSettled();
      // Nothing is running now; an emptied queue has nothing for a retry or push to write over the import.
      const dropped = answers.unsavedEntries();
      answers.discard();
      try {
        await repository.importProgress(parsed);
      } catch (error) {
        for (const entry of dropped) answers.push(entry);
        throw error;
      }
    },
  };
}

export const progressStore = createProgressStore(repo);
