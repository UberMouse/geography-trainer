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

export type NewAnswer = Omit<AnswerRow, 'id'>;

export const DB_NAME = 'geography-trainer';

export class GeographyDb extends Dexie {
  progress!: EntityTable<ItemProgress, 'itemId'>;
  answers!: EntityTable<AnswerRow, 'id'>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({ progress: 'itemId', answers: '++id' });
  }
}
