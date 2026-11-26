import 'fake-indexeddb/auto';
import { Rating, S_MIN } from 'ts-fsrs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAnswer, createProgress, type ItemProgress } from '../engine/srs';
import type { NewAnswer } from './db';
import { startedByTier, validateProgressFile } from './progressFile';
import { createRepo, type ProgressRepo } from './repo';
import Dexie from 'dexie';
import { GeographyDb } from './db';
import { placementKey } from './placementKeys';

const NOW = new Date('2026-03-04T10:00:00Z');

function answered(itemId: string, rating: 1 | 2 | 3 | 4 = Rating.Good): ItemProgress {
  return applyAnswer(createProgress(itemId, NOW), 1, rating, NOW, '2026-03-04');
}

function answerRow(itemId: string, extra: Partial<NewAnswer> = {}): NewAnswer {
  return { itemId, rung: 1, rating: 3, correct: true, timeMs: 1200, at: NOW.getTime(), dayKey: '2026-03-04', ...extra };
}

let repo: ProgressRepo;
let counter = 0;

beforeEach(() => {
  counter += 1;
  repo = createRepo(`test-${counter}`);
});
afterEach(() => repo.close());

/**
 * A repo holding two progress rows and three answers. One row climbed to L3, passed it, then
 * lapsed: it has an L3 pass day and `inL3Lapse` set.
 */
async function seed() {
  const a = answered('country:france');
  const later = (s: number) => new Date(NOW.getTime() + s * 1000);
  let b = applyAnswer(answered('country:peru'), 2, Rating.Good, later(1), '2026-03-04');
  b = applyAnswer(b, 3, Rating.Good, later(2), '2026-03-04');
  b = applyAnswer(b, 3, Rating.Again, later(3), '2026-03-04');
  await repo.recordAnswer({ progress: a, answer: answerRow(a.itemId, { km: 12.5, maptapScore: 99 }) });
  await repo.recordAnswer({ progress: b, answer: answerRow(b.itemId, { rung: 2, correct: false, rating: 1 }) });
  await repo.recordAnswer({ progress: b, answer: answerRow(b.itemId) });
}

describe('recordAnswer', () => {
  it('writes the progress row and the answer row', async () => {
    const progress = answered('country:france');
    await repo.recordAnswer({ progress, answer: answerRow('country:france', { km: 3 }) });
    expect(await repo.loadProgress()).toEqual({ 'country:france': progress });
    const file = await repo.exportProgress(NOW);
    expect(file.answers).toEqual([{ id: 1, ...answerRow('country:france', { km: 3 }) }]);
  });

  it('a second answer for the same item replaces its progress and appends an answer', async () => {
    const first = answered('country:france');
    const second = applyAnswer(first, 1, Rating.Easy, NOW, '2026-03-04');
    await repo.recordAnswer({ progress: first, answer: answerRow('country:france') });
    await repo.recordAnswer({ progress: second, answer: answerRow('country:france') });
    expect(await repo.loadProgress()).toEqual({ 'country:france': second });
    expect((await repo.exportProgress(NOW)).answers.map((row) => row.id)).toEqual([1, 2]);
  });

  it('loads an empty database as an empty record', async () => {
    expect(await repo.loadProgress()).toEqual({});
  });
});

describe('export and import', () => {
  it('round-trips every field of every row, ids and optional fields included', async () => {
    await seed();
    const before = await repo.exportProgress(NOW);
    expect(before.format).toBe('geography-trainer-progress');
    expect(before.version).toBe(3);
    expect(before.placementsDone).toEqual([]);
    expect(before.progress[1]).toMatchObject({ rung: 2, highestRung: 3, l3PassDays: ['2026-03-04'], inL3Lapse: true });
    expect(before.exportedAt).toBe(NOW.toISOString());
    expect(before.progress).toHaveLength(2);
    expect(before.answers).toHaveLength(3);
    expect(before.answers[0]).toMatchObject({ km: 12.5, maptapScore: 99 });
    expect(Object.values(before.progress[0]?.cards ?? {})[0]).toHaveProperty('last_review');

    const json = JSON.parse(JSON.stringify(before));
    repo.close();
    repo = createRepo(`test-restore-${counter}`);
    await repo.importProgress(json);
    const after = await repo.exportProgress(NOW);
    expect(after).toEqual(before);
  });

  it('import replaces: rows not in the file are gone, unknown item ids are kept', async () => {
    await seed();
    const file = await repo.exportProgress(NOW);
    const stranger = { ...answered('place:atlantis'), itemId: 'place:atlantis' };
    const replacement = {
      ...file,
      progress: [stranger],
      answers: [{ id: 41, ...answerRow('place:atlantis') }],
    };
    await repo.importProgress(replacement);
    const after = await repo.exportProgress(NOW);
    expect(after.progress).toEqual([stranger]);
    expect(after.answers).toEqual(replacement.answers);
    await repo.recordAnswer({ progress: answered('country:peru'), answer: answerRow('country:peru') });
    expect((await repo.exportProgress(NOW)).answers.map((row) => row.id)).toEqual([41, 42]);
  });
});

describe('import rejection leaves the database unchanged', () => {
  type Mutate = (file: Record<string, any>) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  const cases: [string, Mutate, RegExp][] = [
    ['a wrong format', (f) => (f.format = 'other'), /format/],
    ['an unsupported version', (f) => (f.version = 4), /^Unsupported version: 4$/],
    ['a version-2 file', (f) => (f.version = 2), /older version of Geography Trainer \(version 2\), before the exercise ladder changed/],
    ['a non-array progress', (f) => (f.progress = {}), /progress is not an array/],
    ['a non-array answers', (f) => (f.answers = 'x'), /answers is not an array/],
    ['a progress row without itemId', (f) => delete f.progress[0].itemId, /itemId/],
    ['a progress rung of 4', (f) => (f.progress[0].rung = 4), /progress\[0\]\.rung is not 1-3/],
    ['a progress highestRung of 4', (f) => (f.progress[0].highestRung = 4), /progress\[0\]\.highestRung is not 1-3/],
    ['a card key of 4', (f) => (f.progress[0].cards[4] = f.progress[0].cards[1]), /progress\[0\]\.cards has the key "4"/],
    ['a progress highestRung of 0', (f) => (f.progress[0].highestRung = 0), /highestRung/],
    ['a non-object cards', (f) => (f.progress[0].cards = []), /cards/],
    ['a card key of 7', (f) => (f.progress[0].cards[7] = f.progress[0].cards[1]), /cards/],
    ['a card with a string due', (f) => (f.progress[0].cards[1].due = '2026'), /due/],
    ['a card without reps', (f) => delete f.progress[0].cards[1].reps, /reps/],
    ['a card with a string last_review', (f) => (f.progress[0].cards[1].last_review = 'x'), /last_review/],
    ['no card for the rung', (f) => ((f.progress[0].rung = 3), (f.progress[0].highestRung = 3)), /no card for its rung/],
    ['l3PassDays holding a number', (f) => (f.progress[0].l3PassDays = [1]), /l3PassDays/],
    ['a non-boolean inL3Lapse', (f) => (f.progress[0].inL3Lapse = 0), /inL3Lapse/],
    ['an undefined introducedAt', (f) => delete f.progress[0].introducedAt, /introducedAt/],
    ['an exportedAt that is not a date', (f) => (f.exportedAt = 'yesterday'), /exportedAt/],
    [
      'a rung above its highestRung',
      (f) => (
        (f.progress[0].rung = 2),
        (f.progress[0].highestRung = 1),
        (f.progress[0].cards[2] = f.progress[0].cards[1])
      ),
      /rung is above its highestRung/,
    ],
    ['a card key of "01"', (f) => (f.progress[0].cards['01'] = f.progress[0].cards[1]), /cards has the key "01"/],
    ['l3PassDays that is not a date', (f) => (f.progress[0].l3PassDays = ['today']), /l3PassDays/],
    [
      'l3PassDays with a repeated day',
      (f) => (f.progress[0].l3PassDays = ['2026-01-01', '2026-01-01']),
      /l3PassDays has a repeated day/,
    ],
    ['a fractional reps', (f) => (f.progress[0].cards[1].reps = 1.5), /reps/],
    ['a negative lapses', (f) => (f.progress[0].cards[1].lapses = -1), /lapses/],
    ['a fractional scheduled_days', (f) => (f.progress[0].cards[1].scheduled_days = 0.5), /scheduled_days/],
    ['a fractional learning_steps', (f) => (f.progress[0].cards[1].learning_steps = 0.5), /learning_steps/],
    ['a card state of 4', (f) => (f.progress[0].cards[1].state = 4), /state/],
    ['an answer id of 0', (f) => (f.answers[0].id = 0), /answers\[0\]\.id/],
    ['a fractional answer id', (f) => (f.answers[0].id = 1.5), /answers\[0\]\.id/],
    ['an answer without id', (f) => delete f.answers[0].id, /id/],
    ['an answer rating of 0', (f) => (f.answers[0].rating = 0), /answers\[0\]\.rating is not 1-4/],
    ['an answer rating of 5', (f) => (f.answers[0].rating = 5), /answers\[0\]\.rating is not 1-4/],
    ['an answer rung of 4', (f) => (f.answers[0].rung = 4), /answers\[0\]\.rung is not 1-3/],
    ['an answer rung of 9', (f) => (f.answers[0].rung = 9), /rung/],
    ['a string correct', (f) => (f.answers[0].correct = 'yes'), /correct/],
    ['a string timeMs', (f) => (f.answers[0].timeMs = '5'), /timeMs/],
    ['a string km', (f) => (f.answers[0].km = '5'), /km/],
    ['a string maptapScore', (f) => (f.answers[0].maptapScore = '5'), /maptapScore/],
    ['a missing dayKey', (f) => delete f.answers[0].dayKey, /dayKey/],
    ['an answer dayKey of "yesterday"', (f) => (f.answers[0].dayKey = 'yesterday'), /dayKey/],
    ['an answer dayKey of 2026-13-45', (f) => (f.answers[0].dayKey = '2026-13-45'), /dayKey/],
    ['l3PassDays with an impossible date', (f) => (f.progress[0].l3PassDays = ['2026-02-30']), /l3PassDays/],
    [
      'l3PassDays with days at highestRung 2',
      (f) => (
        (f.progress[1].rung = 2), (f.progress[1].highestRung = 2), delete f.progress[1].cards[3]
      ),
      /progress\[1\]\.l3PassDays has days but highestRung is not 3/,
    ],
    ['an introducedAt of 1e20', (f) => (f.progress[0].introducedAt = 1e20), /introducedAt/],
    ['a card due of 1e20', (f) => (f.progress[0].cards[1].due = 1e20), /due/],
    ['a card last_review of 1e300', (f) => (f.progress[0].cards[1].last_review = 1e300), /last_review/],
    ['an answer at of 1e20', (f) => (f.answers[0].at = 1e20), /answers\[0\]\.at/],
    ['an answer at of 1.5', (f) => (f.answers[0].at = 1.5), /answers\[0\]\.at/],
    ['an answer id of 2^53-1', (f) => (f.answers[0].id = 2 ** 53 - 1), /answers\[0\]\.id/],
    ['an answer id of 2^52+1', (f) => (f.answers[0].id = 2 ** 52 + 1), /answers\[0\]\.id/],
    ['an introducedAt of 8.64e15', (f) => (f.progress[0].introducedAt = 8.64e15), /introducedAt/],
    ['a negative introducedAt', (f) => (f.progress[0].introducedAt = -1), /introducedAt/],
    ['an exportedAt past year 9999', (f) => (f.exportedAt = '+275760-09-13T00:00:00.000Z'), /exportedAt/],
    ['an answer id past 2^53', (f) => (f.answers[0].id = 2 ** 53 + 2), /answers\[0\]\.id/],
    ['a zero stability on a non-New card', (f) => (f.progress[0].cards[1].stability = 0), /memory state/],
    ['a negative stability', (f) => (f.progress[0].cards[1].stability = -3), /memory state/],
    ['a difficulty of -50', (f) => (f.progress[0].cards[1].difficulty = -50), /memory state/],
    ['a duplicate progress itemId', (f) => f.progress.push({ ...f.progress[0] }), /progress rows/],
    ['a duplicate answer id', (f) => f.answers.push({ ...f.answers[0] }), /answer rows/],
  ];

  it.each(cases)('%s', async (_name, mutate, message) => {
    await seed();
    const good = await repo.exportProgress(NOW);
    const bad = JSON.parse(JSON.stringify(good));
    mutate(bad);
    await expect(repo.importProgress(bad)).rejects.toThrow(message);
    expect(() => validateProgressFile(bad)).toThrow(Error);
    expect(await repo.exportProgress(NOW)).toEqual(good);
  });

  it('rejects a non-object file', async () => {
    await expect(repo.importProgress(null)).rejects.toThrow(/not a progress export/);
  });
});

describe('validated boundary cards', () => {
  it('a card at the scheduler bounds, and a New card, survive validation and applyAnswer', () => {
    const base = answered('country:france');
    const rung = base.rung;
    const card = base.cards[rung]!;
    const bounds = { ...base, cards: { [rung]: { ...card, stability: S_MIN, difficulty: 1 } } };
    const fresh = createProgress('country:peru', NOW);
    const file = {
      format: 'geography-trainer-progress',
      version: 3,
      exportedAt: NOW.toISOString(),
      progress: [bounds, fresh],
      answers: [],
      placementsDone: [],
    };
    const { progress } = validateProgressFile(JSON.parse(JSON.stringify(file)));
    for (const row of progress) {
      expect(() => applyAnswer(row, row.rung, Rating.Good, new Date(NOW.getTime() + 1000), '2026-03-04')).not.toThrow();
    }
  });
});

describe('startedByTier', () => {
  it('counts introduced rows per tier', () => {
    const fresh = createProgress('country:chad', NOW);
    expect(
      startedByTier([
        answered('country:france'),
        answered('place:paris'),
        answered('region:fr.bre'),
        fresh,
        createProgress('region:fr.pdl', NOW),
        answered('country:peru'),
      ]),
    ).toEqual({ countries: 2, regions: 1, places: 1 });
  });

  it('counts a validated file', async () => {
    await seed();
    const file = validateProgressFile(JSON.parse(JSON.stringify(await repo.exportProgress(NOW))));
    expect(startedByTier(file.progress).countries).toBe(2);
    expect(startedByTier(Object.values(await repo.loadProgress())).countries).toBe(2);
  });
});

describe('seedProgress', () => {
  it('adds rows and leaves a stored row untouched', async () => {
    const stored = answered('country:france');
    await repo.recordAnswer({ progress: stored, answer: answerRow(stored.itemId) });
    const rows = [createProgress('country:france', NOW), createProgress('country:peru', NOW), answered('country:chad')];
    await repo.seedProgress(rows);
    expect(await repo.loadProgress()).toEqual({
      'country:france': stored,
      'country:peru': rows[1],
      'country:chad': rows[2],
    });
  });

  it('an exported file after seeding round-trips through import', async () => {
    await repo.seedProgress([createProgress('country:peru', NOW), answered('country:chad')]);
    const file = JSON.parse(JSON.stringify(await repo.exportProgress(NOW)));
    await repo.importProgress(file);
    expect(await repo.exportProgress(NOW)).toEqual(file);
    expect(Object.keys(await repo.loadProgress()).sort()).toEqual(['country:chad', 'country:peru']);
  });
});

describe('the version-2 upgrade', () => {
  it('keeps every progress and answers row and starts with no settings or markers', async () => {
    const name = `upgrade-${counter}`;
    const progress = [answered('country:france'), answered('country:peru')];
    const answers = [
      { id: 1, ...answerRow('country:france', { km: 4 }) },
      { id: 2, ...answerRow('country:peru') },
    ];
    const old = new Dexie(name);
    old.version(1).stores({ progress: 'itemId', answers: '++id' });
    await old.table('progress').bulkAdd(progress);
    await old.table('answers').bulkAdd(answers);
    old.close();

    const upgraded = createRepo(name);
    try {
      const file = await upgraded.exportProgress(NOW);
      expect(file.progress).toEqual(progress);
      expect(file.answers).toEqual(answers);
      expect(file.placementsDone).toEqual([]);
      expect(await upgraded.loadFinishedTests()).toEqual([]);
      expect(await upgraded.loadSettings()).toEqual({ dailyNewCap: 15 });
    } finally {
      upgraded.close();
    }
  });
});

describe('settings', () => {
  it('reads 15 when none is stored, then what was saved', async () => {
    expect(await repo.loadSettings()).toEqual({ dailyNewCap: 15 });
    await repo.saveDailyNewCap(30);
    expect(await repo.loadSettings()).toEqual({ dailyNewCap: 30 });
    await repo.saveDailyNewCap(5);
    await repo.saveDailyNewCap(50);
    expect(await repo.loadSettings()).toEqual({ dailyNewCap: 50 });
  });

  it.each([4, 51, 10.5, NaN, Infinity, -10])('rejects %s without writing', async (value) => {
    await repo.saveDailyNewCap(20);
    await expect(repo.saveDailyNewCap(value)).rejects.toThrow(/daily limit/);
    expect(await repo.loadSettings()).toEqual({ dailyNewCap: 20 });
  });

  it('a stored value outside 5-50 or not an integer reads as 15', async () => {
    const db = new Dexie(`test-${counter}`);
    db.version(2).stores({ progress: 'itemId', answers: '++id', meta: 'key' });
    for (const bad of [3, 99, 7.5, '20', null]) {
      await db.table('meta').put({ key: 'setting:dailyNewCap', value: bad });
      expect(await repo.loadSettings()).toEqual({ dailyNewCap: 15 });
    }
    db.close();
  });

  it('settings are not in the export, survive an import and a reset', async () => {
    await repo.saveDailyNewCap(25);
    const file = JSON.parse(JSON.stringify(await repo.exportProgress(NOW)));
    expect(JSON.stringify(file)).not.toContain('25');
    await repo.importProgress(file);
    expect(await repo.loadSettings()).toEqual({ dailyNewCap: 25 });
    await repo.resetProgress();
    expect(await repo.loadSettings()).toEqual({ dailyNewCap: 25 });
  });
});

describe('finishPlacement', () => {
  it('writes the seed rows (add-if-absent) and the marker', async () => {
    const stored = answered('country:france');
    await repo.recordAnswer({ progress: stored, answer: answerRow(stored.itemId) });
    const fresh = createProgress('country:peru', NOW);
    await repo.finishPlacement(placementKey('countries'), [createProgress('country:france', NOW), fresh]);
    expect(await repo.loadProgress()).toEqual({ 'country:france': stored, 'country:peru': fresh });
    expect(await repo.loadFinishedTests()).toEqual(['placement:countries']);
  });

  it('a failed seed write leaves no marker and no rows', async () => {
    const dupe = createProgress('country:peru', NOW);
    // bulkAdd of two rows with one item id fails inside the transaction, after the rows are checked.
    await expect(repo.finishPlacement(placementKey('countries'), [dupe, dupe])).rejects.toThrow();
    expect(await repo.loadProgress()).toEqual({});
    expect(await repo.loadFinishedTests()).toEqual([]);
  });

  it('a failed marker write rolls back the seed rows already added', async () => {
    const probe = new Dexie(`probe-${counter}`);
    probe.version(1).stores({ meta: 'key' });
    // Dexie gives each database its own table class; `put` is defined on the shared base class.
    let tableClass = Object.getPrototypeOf(probe.table('meta'));
    while (!Object.hasOwn(tableClass, 'put')) tableClass = Object.getPrototypeOf(tableClass);
    const put = vi.spyOn(tableClass, 'put').mockRejectedValueOnce(new Error('disk full'));
    try {
      await expect(repo.finishPlacement(placementKey('countries'), [createProgress('country:peru', NOW)])).rejects.toThrow(
        'disk full',
      );
    } finally {
      put.mockRestore();
      probe.close();
    }
    expect(await repo.loadProgress()).toEqual({});
    expect(await repo.loadFinishedTests()).toEqual([]);
  });

  it('rejects a malformed key without writing', async () => {
    await expect(repo.finishPlacement('placement:place:paris', [createProgress('country:peru', NOW)])).rejects.toThrow(
      /placement key/,
    );
    expect(await repo.loadProgress()).toEqual({});
  });

  it('markers for several tests are listed and a retake writes the same marker again', async () => {
    await repo.finishPlacement(placementKey('region:us.tx'), []);
    await repo.finishPlacement(placementKey('country:peru'), []);
    await repo.finishPlacement(placementKey('country:peru'), []);
    expect(await repo.loadFinishedTests()).toEqual(['placement:country:peru', 'placement:region:us.tx']);
  });
});

describe('resetProgress', () => {
  it('clears progress, answers and markers and keeps settings', async () => {
    await seed();
    await repo.finishPlacement(placementKey('countries'), []);
    await repo.saveDailyNewCap(40);
    await repo.resetProgress();
    const file = await repo.exportProgress(NOW);
    expect(file).toMatchObject({ progress: [], answers: [], placementsDone: [] });
    expect(await repo.loadSettings()).toEqual({ dailyNewCap: 40 });
  });
});

describe('a malformed marker row', () => {
  it('is left out of the export and of loadFinishedTests, and the export re-imports', async () => {
    await repo.finishPlacement(placementKey('countries'), []);
    const raw = new GeographyDb(`test-${counter}`);
    await raw.meta.put({ key: 'placement:place:paris', value: true });
    raw.close();
    const file = await repo.exportProgress(NOW);
    expect(file.placementsDone).toEqual(['placement:countries']);
    expect(await repo.loadFinishedTests()).toEqual(['placement:countries']);
    await repo.importProgress(JSON.parse(JSON.stringify(file)));
  });
});

describe('export version 3 and import', () => {
  it('round-trips the markers, replacing the markers already stored', async () => {
    await seed();
    await repo.finishPlacement(placementKey('countries'), []);
    await repo.finishPlacement(placementKey('region:us.tx'), []);
    const before = JSON.parse(JSON.stringify(await repo.exportProgress(NOW)));
    expect(before.placementsDone).toEqual(['placement:countries', 'placement:region:us.tx']);
    await repo.finishPlacement(placementKey('country:peru'), []);
    await repo.importProgress(before);
    expect(await repo.exportProgress(NOW)).toEqual(before);
  });

  it.each([1, 2])('rejects a version-%i file, leaving the data unchanged', async (version) => {
    await seed();
    const good = await repo.exportProgress(NOW);
    const old = { format: 'geography-trainer-progress', version, exportedAt: NOW.toISOString(), progress: [answered('country:chad')], answers: [], placementsDone: [] };
    await expect(repo.importProgress(old)).rejects.toThrow(
      `This file is from an older version of Geography Trainer (version ${version}), before the exercise ladder changed, and can't be imported.`,
    );
    expect(await repo.exportProgress(NOW)).toEqual(good);
  });

  it('accepts an answer rated 4 (Easy)', async () => {
    await seed();
    const file = JSON.parse(JSON.stringify(await repo.exportProgress(NOW)));
    file.answers[0].rating = Rating.Easy;
    await repo.importProgress(file);
    expect((await repo.exportProgress(NOW)).answers[0]?.rating).toBe(4);
  });

  it.each([
    ['missing', undefined],
    ['not an array', 'placement:countries'],
    ['holding a non-string', [3]],
    ['holding a malformed key', ['placement:place:paris']],
    ['holding an empty region part', ['placement:region:us.']],
    ['holding an empty country id', ['placement:country:']],
    ['holding a duplicate', ['placement:countries', 'placement:countries']],
  ])('rejects a version-3 file whose placementsDone is %s, leaving the data unchanged', async (_, value) => {
    await seed();
    const file = JSON.parse(JSON.stringify(await repo.exportProgress(NOW)));
    file.placementsDone = value;
    await expect(repo.importProgress(file)).rejects.toThrow(/placement/);
    expect((await repo.exportProgress(NOW)).progress).toHaveLength(2);
  });
});
