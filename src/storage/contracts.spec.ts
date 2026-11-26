import 'fake-indexeddb/auto';
import { Rating, S_MIN } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { applyAnswer, createProgress } from '../engine/srs';
import { DB_NAME, GeographyDb } from './db';
import { FILE_FORMAT, FILE_VERSION, validateProgressFile } from './progressFile';
import {
  DAILY_NEW_CAP_KEY,
  DAILY_NEW_CAP_MAX,
  DAILY_NEW_CAP_MIN,
  dailyNewCapOrDefault,
  isValidDailyNewCap,
} from './settings';

// Pins the values spec/contracts/storage.md states.

const NOW = new Date('2026-03-04T10:00:00Z');

describe('[STO-C01] the IndexedDB schema', () => {
  it('is the geography-trainer database at version 2 with its three tables and keys', () => {
    expect(DB_NAME).toBe('geography-trainer');
    const app = new GeographyDb();
    expect(app.name).toBe('geography-trainer');
    app.close();
    const db = new GeographyDb('contracts-schema');
    try {
      expect(db.verno).toBe(2);
      const keys = Object.fromEntries(
        db.tables.map((t) => [t.name, { key: t.schema.primKey.keyPath, auto: t.schema.primKey.auto }]),
      );
      expect(keys).toEqual({
        progress: { key: 'itemId', auto: false },
        answers: { key: 'id', auto: true },
        meta: { key: 'key', auto: false },
      });
    } finally {
      db.close();
    }
  });
});

describe('[STO-C03] the export file', () => {
  it('is format geography-trainer-progress, version 3', () => {
    expect(FILE_FORMAT).toBe('geography-trainer-progress');
    expect(FILE_VERSION).toBe(3);
  });
});

describe('[STO-C04] import validation bounds', () => {
  const MAX_EPOCH_MS = Date.UTC(9999, 11, 31);

  function file(overrides: { introducedAt?: number; answerId?: number; exportedAt?: string } = {}) {
    const row = applyAnswer(createProgress('country:france', NOW), 1, Rating.Good, NOW, '2026-03-04');
    return JSON.parse(
      JSON.stringify({
        format: FILE_FORMAT,
        version: FILE_VERSION,
        exportedAt: overrides.exportedAt ?? NOW.toISOString(),
        progress: [{ ...row, introducedAt: overrides.introducedAt ?? row.introducedAt }],
        answers: [
          {
            id: overrides.answerId ?? 1,
            itemId: 'country:france',
            rung: 1,
            rating: 3,
            correct: true,
            timeMs: 900,
            at: NOW.getTime(),
            dayKey: '2026-03-04',
          },
        ],
        placementsDone: [],
      }),
    );
  }

  it('accepts an epoch ms of exactly Date.UTC(9999, 11, 31) and rejects one past it', () => {
    expect(() => validateProgressFile(file({ introducedAt: MAX_EPOCH_MS }))).not.toThrow();
    expect(() => validateProgressFile(file({ exportedAt: new Date(MAX_EPOCH_MS).toISOString() }))).not.toThrow();
    expect(() => validateProgressFile(file({ introducedAt: MAX_EPOCH_MS + 1 }))).toThrow(/introducedAt/);
    expect(() => validateProgressFile(file({ introducedAt: 0 }))).not.toThrow();
  });

  it('accepts an answer id of exactly 2^52 and rejects 2^52 + 1', () => {
    expect(() => validateProgressFile(file({ answerId: 2 ** 52 }))).not.toThrow();
    expect(() => validateProgressFile(file({ answerId: 2 ** 52 + 1 }))).toThrow(/answers\[0\]\.id/);
  });

  it('takes the stability floor from ts-fsrs S_MIN, which is 0.001', () => {
    expect(S_MIN).toBe(0.001);
    const at = (stability: number, difficulty: number) => {
      const f = file();
      f.progress[0].cards[1] = { ...f.progress[0].cards[1], stability, difficulty };
      return () => validateProgressFile(f);
    };
    expect(at(0.001, 1)).not.toThrow();
    expect(at(0.0009, 1)).toThrow(/memory state/);
    expect(at(0.001, 0.99)).toThrow(/memory state/);
  });
});

describe('[STO-C05] the daily new-item limit', () => {
  it('is stored under setting:dailyNewCap, from 5 to 50, defaulting to 15', () => {
    expect(DAILY_NEW_CAP_KEY).toBe('setting:dailyNewCap');
    expect(DAILY_NEW_CAP_MIN).toBe(5);
    expect(DAILY_NEW_CAP_MAX).toBe(50);
    expect(dailyNewCapOrDefault(undefined)).toBe(15);
    expect(dailyNewCapOrDefault(7)).toBe(7);
    expect([4, 5, 50, 51, 5.5, '5'].map(isValidDailyNewCap)).toEqual([false, true, true, false, false, false]);
  });
});
