// The progress store: the only module that reads and writes IndexedDB.

import type { ItemProgress } from '../engine/srs';
import { DB_NAME, GeographyDb, type NewAnswer } from './db';
import { FILE_FORMAT, FILE_VERSION, validateProgressFile, type ProgressFile } from './progressFile';

/** What the session saves for one answer: the item's new progress and the answer's log row. */
export interface AnswerEntry {
  progress: ItemProgress;
  answer: NewAnswer;
}

export interface ProgressRepo {
  /** Every stored progress row by item id. Rejects when the database cannot be opened. */
  loadProgress(): Promise<Record<string, ItemProgress>>;
  /** Writes the item's progress and appends the answer row in one transaction. */
  recordAnswer(entry: AnswerEntry): Promise<void>;
  /** Adds the rows in one transaction, skipping any item that already has a stored row. */
  seedProgress(rows: ItemProgress[]): Promise<void>;
  exportProgress(now: Date): Promise<ProgressFile>;
  /**
   * Replaces both tables with the file's rows in one transaction. Validates first and throws an
   * `Error` naming the problem, leaving the stored data untouched.
   */
  importProgress(parsed: unknown): Promise<void>;
  close(): void;
}

export function createRepo(name: string = DB_NAME): ProgressRepo {
  const db = new GeographyDb(name);

  return {
    async loadProgress() {
      const rows = await db.progress.toArray();
      return Object.fromEntries(rows.map((row) => [row.itemId, row]));
    },

    async recordAnswer({ progress, answer }) {
      await db.transaction('rw', db.progress, db.answers, async () => {
        await db.progress.put(progress);
        await db.answers.add(answer);
      });
    },

    async seedProgress(rows) {
      await db.transaction('rw', db.progress, async () => {
        const stored = await db.progress.bulkGet(rows.map((row) => row.itemId));
        await db.progress.bulkAdd(rows.filter((_, i) => !stored[i]));
      });
    },

    async exportProgress(now) {
      return db.transaction('r', db.progress, db.answers, async () => ({
        format: FILE_FORMAT,
        version: FILE_VERSION,
        exportedAt: now.toISOString(),
        progress: await db.progress.toArray(),
        answers: await db.answers.toArray(),
      }));
    },

    async importProgress(parsed) {
      const file = validateProgressFile(parsed);
      await db.transaction('rw', db.progress, db.answers, async () => {
        await db.progress.clear();
        await db.answers.clear();
        await db.progress.bulkAdd(file.progress);
        await db.answers.bulkAdd(file.answers);
      });
    },

    close: () => db.close(),
  };
}

/** The app's repo, on the `geography-trainer` database. */
export const repo = createRepo();
