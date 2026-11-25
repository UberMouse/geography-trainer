// The progress store: the only module that reads and writes IndexedDB.

import type { ItemProgress } from '../engine/srs';
import { DB_NAME, GeographyDb, type NewAnswer } from './db';
import { isPlacementKey, MARKER_PREFIX } from './placementKeys';
import { FILE_FORMAT, FILE_VERSION, validateProgressFile, type ProgressFile } from './progressFile';
import { DAILY_NEW_CAP_KEY, dailyNewCapOrDefault, isValidDailyNewCap, type Settings } from './settings';

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
  /** The stored settings; a missing or invalid stored value reads as its default. */
  loadSettings(): Promise<Settings>;
  /** Stores the daily limit. Throws without writing when it is not an integer from 5 to 50. */
  saveDailyNewCap(value: number): Promise<void>;
  /** Marker keys of the finished placement tests. */
  loadFinishedTests(): Promise<string[]>;
  /**
   * Adds the seed rows (skipping any item with a stored row) and the test's marker in one
   * transaction: both or neither. Throws without writing when the key is not a marker key.
   */
  finishPlacement(key: string, rows: ItemProgress[]): Promise<void>;
  /** Clears progress, answers and every marker in one transaction; settings are kept. */
  resetProgress(): Promise<void>;
  exportProgress(now: Date): Promise<ProgressFile>;
  /**
   * Replaces progress, answers and placement markers with the file's in one transaction (settings
   * are untouched). Validates first and throws an
   * `Error` naming the problem, leaving the stored data untouched.
   */
  importProgress(parsed: unknown): Promise<void>;
  close(): void;
}

export function createRepo(name: string = DB_NAME): ProgressRepo {
  const db = new GeographyDb(name);

  /** Inside a transaction on `progress`: adds the rows whose item has no stored row. */
  async function addAbsent(rows: ItemProgress[]) {
    const stored = await db.progress.bulkGet(rows.map((row) => row.itemId));
    await db.progress.bulkAdd(rows.filter((_, i) => !stored[i]));
  }

  const markerKeys = () => db.meta.where('key').startsWith(MARKER_PREFIX).primaryKeys();

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
      await db.transaction('rw', db.progress, () => addAbsent(rows));
    },

    async loadSettings() {
      const row = await db.meta.get(DAILY_NEW_CAP_KEY);
      return { dailyNewCap: dailyNewCapOrDefault(row?.value) };
    },

    async saveDailyNewCap(value) {
      if (!isValidDailyNewCap(value)) throw new Error('The daily limit is not an integer from 5 to 50');
      await db.meta.put({ key: DAILY_NEW_CAP_KEY, value });
    },

    loadFinishedTests: () => markerKeys(),

    async finishPlacement(key, rows) {
      if (!isPlacementKey(key)) throw new Error(`Not a placement key: ${String(key)}`);
      await db.transaction('rw', db.progress, db.meta, async () => {
        await addAbsent(rows);
        await db.meta.put({ key, value: true });
      });
    },

    async resetProgress() {
      await db.transaction('rw', db.progress, db.answers, db.meta, async () => {
        await db.progress.clear();
        await db.answers.clear();
        await db.meta.where('key').startsWith(MARKER_PREFIX).delete();
      });
    },

    async exportProgress(now) {
      return db.transaction('r', db.progress, db.answers, db.meta, async () => ({
        format: FILE_FORMAT,
        version: FILE_VERSION,
        exportedAt: now.toISOString(),
        progress: await db.progress.toArray(),
        answers: await db.answers.toArray(),
        placementsDone: await markerKeys(),
      }));
    },

    async importProgress(parsed) {
      const file = validateProgressFile(parsed);
      await db.transaction('rw', db.progress, db.answers, db.meta, async () => {
        await db.progress.clear();
        await db.answers.clear();
        await db.meta.where('key').startsWith(MARKER_PREFIX).delete();
        await db.progress.bulkAdd(file.progress);
        await db.answers.bulkAdd(file.answers);
        await db.meta.bulkAdd(file.placementsDone.map((key) => ({ key, value: true })));
      });
    },

    close: () => db.close(),
  };
}

/** The app's repo, on the `geography-trainer` database. */
export const repo = createRepo();
