// The IndexedDB schema. Only src/storage imports Dexie.

import Dexie, { type EntityTable } from 'dexie';
import type { Grade } from 'ts-fsrs';
import type { ItemProgress, Rung } from '../engine/srs';

/** One recorded answer. `id` is assigned by the database. */
export interface AnswerRow {
  id: number;
  itemId: string;
  rung: Rung;
  rating: Grade;
  correct: boolean;
  timeMs: number;
  km?: number;
  maptapScore?: number;
  /** Epoch ms. */
  at: number;
  /** The learner's local day, `YYYY-MM-DD`. */
  dayKey: string;
}

/**
 * One row of the key-value table: a finished-placement marker (key `placement:…`, value `true`) or
 * a setting (key `setting:…`).
 */
export interface MetaRow {
  key: string;
  value: unknown;
}

export type NewAnswer = Omit<AnswerRow, 'id'>;

export const DB_NAME = 'geography-trainer';

export class GeographyDb extends Dexie {
  progress!: EntityTable<ItemProgress, 'itemId'>;
  answers!: EntityTable<AnswerRow, 'id'>;
  meta!: EntityTable<MetaRow, 'key'>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({ progress: 'itemId', answers: '++id' });
    // Version 2 adds the key-value table; the progress and answers rows are left as they are.
    this.version(2).stores({ progress: 'itemId', answers: '++id', meta: 'key' });
  }
}
