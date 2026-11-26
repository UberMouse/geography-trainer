import { describe, expect, it } from 'vitest';
import { Rating, State, type Grade } from 'ts-fsrs';
import { PLACEMENT_SEED_STABILITY_DAYS } from './config';
import {
  applyAnswer,
  createProgress,
  dueRung,
  isIntroduced,
  isMastered,
  localDayKey,
  nextDue,
  seedFromPlacement,
  type ItemProgress,
  type Rung,
} from './srs';

const T0 = new Date('2026-03-01T00:00:00Z');
const DAY = 86_400_000;
const DK = '2026-03-01';
const at = (days: number) => new Date(T0.getTime() + days * DAY);

function answer(p: ItemProgress, rung: Rung, rating: Grade, d = 0) {
  return applyAnswer(p, rung, rating, at(d), localDayKey(at(d), 0));
}

/** Climb a fresh item to rung 3 with Good answers on day 0. */
function atRung3(): ItemProgress {
  let p = createProgress('x', T0);
  for (const r of [1, 2] as const) p = answer(p, r, Rating.Good);
  return p;
}

describe('localDayKey', () => {
  it('uses minutes east of UTC', () => {
    const now = new Date('2026-12-31T20:00:00Z');
    expect(localDayKey(now, 0)).toBe('2026-12-31');
    expect(localDayKey(now, 780)).toBe('2027-01-01');
    expect(localDayKey(now, -300)).toBe('2026-12-31');
  });
});

describe('createProgress', () => {
  it('starts at rung 1 with a new card due now', () => {
    const p = createProgress('a', T0);
    expect(p).toMatchObject({
      itemId: 'a',
      rung: 1,
      highestRung: 1,
      l3PassDays: [],
      inL3Lapse: false,
      introducedAt: null,
    });
    expect(p.cards[1]).toMatchObject({ state: State.New, due: T0.getTime() });
    expect(isMastered(p)).toBe(false);
  });
});

describe('FSRS scheduling', () => {
  it('schedules Good later than Again on a new card', () => {
    const p = createProgress('a', T0);
    const good = answer(p, 1, Rating.Good).cards[1];
    const again = answer(p, 1, Rating.Again).cards[1];
    expect(good?.due).toBeGreaterThan(again?.due ?? Infinity);
  });

  it('increments lapses on Again for a review card', () => {
    const p = seedFromPlacement('a', 'passed', T0, DK);
    const lapsed = answer(p, 3, Rating.Again, 3);
    expect(lapsed.cards[3]?.lapses).toBe(1);
    expect(lapsed.cards[3]?.state).toBe(State.Relearning);
  });

  it('does not mutate its input', () => {
    const p = createProgress('a', T0);
    const frozen = JSON.stringify(p);
    answer(p, 1, Rating.Good);
    expect(JSON.stringify(p)).toBe(frozen);
  });
});

describe('ladder', () => {
  it('moves up on Good and Easy, up to rung 3', () => {
    let p = createProgress('a', T0);
    p = answer(p, 1, Rating.Good);
    expect(p).toMatchObject({ rung: 2, highestRung: 2 });
    p = answer(p, 2, Rating.Easy);
    expect(p).toMatchObject({ rung: 3, highestRung: 3 });
    p = answer(p, 3, Rating.Good);
    expect(p).toMatchObject({ rung: 3, highestRung: 3 });
  });

  it('skips a rung on Easy: L1 Easy goes straight to L3 with a new L3 card and no L2 card', () => {
    const p = answer(createProgress('a', T0), 1, Rating.Easy, 2);
    expect(p).toMatchObject({ rung: 3, highestRung: 3, inL3Lapse: false });
    expect(p.cards[2]).toBeUndefined();
    expect(p.cards[3]).toMatchObject({ state: State.New, due: at(2).getTime() });
    expect(dueRung(p)).toBe(3);
  });

  it('a skipped L2 is created fresh when an L3 lapse first needs it', () => {
    let p = answer(createProgress('a', T0), 1, Rating.Easy);
    p = answer(p, 3, Rating.Again, 1);
    expect(p).toMatchObject({ rung: 2, inL3Lapse: true });
    expect(p.cards[2]).toMatchObject({ state: State.New, due: at(1).getTime() });
  });

  it('climbs on Hard at L1, a slow but correct multiple-choice answer', () => {
    const p = answer(createProgress('a', T0), 1, Rating.Hard);
    expect(p).toMatchObject({ rung: 2, highestRung: 2 });
    expect(p.cards[1]?.reps).toBe(1);
  });

  it('Hard at L2 and L3, a near-miss tap, stays put', () => {
    const l2 = answer(createProgress('a', T0), 1, Rating.Good);
    expect(answer(l2, 2, Rating.Hard)).toMatchObject({ rung: 2, highestRung: 2 });
    expect(answer(atRung3(), 3, Rating.Hard)).toMatchObject({ rung: 3, inL3Lapse: false, l3PassDays: [] });
  });

  it('Again at L1 stays at L1', () => {
    expect(answer(createProgress('a', T0), 1, Rating.Again)).toMatchObject({ rung: 1, highestRung: 1 });
  });

  it('Again at L2 drops to L1 with no lapse flag', () => {
    const p = answer(answer(createProgress('a', T0), 1, Rating.Good), 2, Rating.Again);
    expect(p).toMatchObject({ rung: 1, highestRung: 2, inL3Lapse: false });
  });

  it('creates a rung card when first reached, due immediately', () => {
    const p = answer(createProgress('a', T0), 1, Rating.Good, 5);
    expect(p.cards[2]).toMatchObject({ state: State.New, due: at(5).getTime() });
  });

  it('lapses at L3 to L2 and returns to L3 on the next L2 pass', () => {
    let p = answer(atRung3(), 3, Rating.Again, 10);
    expect(p).toMatchObject({ rung: 2, highestRung: 3, inL3Lapse: true });
    expect(dueRung(p)).toBe(2);
    expect(nextDue(p)).toBe(p.cards[2]?.due);
    p = answer(p, 2, Rating.Good, 11);
    expect(p).toMatchObject({ rung: 3, inL3Lapse: false });
  });

  it('keeps the lapse through Hard and Again at L2', () => {
    let p = answer(atRung3(), 3, Rating.Again, 10);
    p = answer(p, 2, Rating.Hard, 11);
    expect(p).toMatchObject({ rung: 2, inL3Lapse: true });
    p = answer(p, 2, Rating.Again, 12);
    expect(p).toMatchObject({ rung: 1, highestRung: 3, inL3Lapse: true });
    p = answer(answer(p, 1, Rating.Good, 13), 2, Rating.Good, 14);
    expect(p).toMatchObject({ rung: 3, inL3Lapse: false });
  });

  it('Hard at L1 during a lapse climbs back to L2, keeping the flag', () => {
    let p = answer(answer(atRung3(), 3, Rating.Again, 10), 2, Rating.Again, 11);
    p = answer(p, 1, Rating.Hard, 12);
    expect(p).toMatchObject({ rung: 2, inL3Lapse: true });
  });

  it('schedules a lower rung without moving the ladder', () => {
    const before = atRung3();
    const p = answer(before, 1, Rating.Good, 3);
    expect(p.rung).toBe(3);
    expect(p.cards[1]?.due).not.toBe(before.cards[1]?.due);
  });

  it('Easy at L3 records a pass day and stays at 3', () => {
    expect(answer(atRung3(), 3, Rating.Easy)).toMatchObject({ rung: 3, l3PassDays: ['2026-03-01'] });
  });

  it('Easy at L2 during a lapse returns to L3 and clears the flag', () => {
    const p = answer(answer(atRung3(), 3, Rating.Again, 10), 2, Rating.Easy, 11);
    expect(p).toMatchObject({ rung: 3, inL3Lapse: false });
  });

  it('a lapse at L3 is due again at once at L2, keeping the old L2 card otherwise', () => {
    let p = answer(createProgress('a', T0), 1, Rating.Good);
    p = answer(p, 2, Rating.Easy);
    const oldL2 = p.cards[2];
    expect(oldL2?.due).toBeGreaterThan(at(1).getTime());
    p = applyAnswer(p, 3, Rating.Again, at(0.0007), '2026-03-01');
    expect(p.rung).toBe(2);
    expect(nextDue(p)).toBe(at(0.0007).getTime());
    expect(p.cards[2]).toEqual({ ...oldL2, due: at(0.0007).getTime() });
  });

  it('every step down brings the lower rung due now (L2 to L1 during a lapse)', () => {
    let p = answer(createProgress('a', T0), 1, Rating.Easy);
    p = answer(p, 3, Rating.Again, 1);
    p = answer(p, 2, Rating.Good, 1);
    p = answer(p, 3, Rating.Again, 1);
    const oldL1 = p.cards[1];
    expect(oldL1?.due).toBeGreaterThan(at(2).getTime());
    p = answer(p, 2, Rating.Again, 2);
    expect(p).toMatchObject({ rung: 1, inL3Lapse: true });
    expect(nextDue(p)).toBe(at(2).getTime());
    expect(p.cards[1]).toEqual({ ...oldL1, due: at(2).getTime() });
  });

  it('throws for a rung above the highest reached', () => {
    expect(() => answer(createProgress('a', T0), 3, Rating.Good)).toThrow();
  });
});

describe('mastery', () => {
  it('needs L3 passes on two different days', () => {
    let p = atRung3();
    p = answer(p, 3, Rating.Good, 0);
    p = answer(p, 3, Rating.Easy, 0);
    expect(p.l3PassDays).toEqual(['2026-03-01']);
    expect(isMastered(p)).toBe(false);
    p = answer(p, 3, Rating.Good, 3);
    expect(p.l3PassDays).toEqual(['2026-03-01', '2026-03-04']);
    expect(isMastered(p)).toBe(true);
  });

  it('does not count Hard or Again at L3', () => {
    let p = atRung3();
    p = answer(p, 3, Rating.Hard, 1);
    p = answer(p, 3, Rating.Again, 2);
    expect(p.l3PassDays).toEqual([]);
  });

  it('does not count a pass at L2 or L1, even after L3 was reached', () => {
    let p = answer(atRung3(), 3, Rating.Again, 1);
    p = answer(p, 1, Rating.Good, 2);
    p = answer(p, 2, Rating.Good, 3);
    expect(p).toMatchObject({ rung: 3, l3PassDays: [] });
  });

  it('stays mastered through a later lapse', () => {
    let p = answer(answer(atRung3(), 3, Rating.Good, 1), 3, Rating.Good, 5);
    expect(isMastered(p)).toBe(true);
    p = answer(p, 3, Rating.Again, 20);
    expect(p.inL3Lapse).toBe(true);
    expect(isMastered(p)).toBe(true);
  });
});

describe('serialisation', () => {
  it('round-trips through JSON and behaves identically', () => {
    const p = answer(atRung3(), 3, Rating.Good, 1);
    const copy = JSON.parse(JSON.stringify(p)) as ItemProgress;
    expect(copy).toEqual(p);
    expect(answer(copy, 3, Rating.Good, 4)).toEqual(answer(p, 3, Rating.Good, 4));
  });
});

describe('introducedAt', () => {
  it('is null for a fresh item and every seed outcome', () => {
    expect(createProgress('a', T0).introducedAt).toBeNull();
    for (const o of ['passed', 'failed', 'aboveEstimate', 'untestedAtOrBelow'] as const) {
      expect(seedFromPlacement('a', o, T0, DK).introducedAt).toBeNull();
    }
  });

  it('is set by the first answer and unchanged by the second', () => {
    const first = answer(createProgress('a', T0), 1, Rating.Good, 1);
    expect(first.introducedAt).toBe(at(1).getTime());
    expect(answer(first, 2, Rating.Good, 2).introducedAt).toBe(at(1).getTime());
  });

  it('is set by the first answer to an untested seed', () => {
    const p = answer(seedFromPlacement('a', 'untestedAtOrBelow', T0, DK), 2, Rating.Good, 1);
    expect(p.introducedAt).toBe(at(1).getTime());
  });

  it('stays null when a passed seed is answered', () => {
    expect(answer(seedFromPlacement('a', 'passed', T0, DK), 3, Rating.Good, 1).introducedAt).toBeNull();
  });

  it('survives JSON as null', () => {
    const p = createProgress('a', T0);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });
});

describe('L3 pass during a lapse', () => {
  it('adds no further pass day and leaves the ladder alone', () => {
    const lapsed = answer(seedFromPlacement('a', 'passed', T0, DK), 3, Rating.Again, 1);
    expect(lapsed).toMatchObject({ rung: 2, inL3Lapse: true });
    const p = answer(lapsed, 3, Rating.Good, 2);
    expect(p).toMatchObject({ rung: 2, inL3Lapse: true, l3PassDays: [DK] });
  });
});

describe('seedFromPlacement', () => {
  it('passed: rung 3, a single review card with seed stability, not mastered', () => {
    const p = seedFromPlacement('a', 'passed', T0, DK);
    expect(p).toMatchObject({ rung: 3, highestRung: 3, l3PassDays: [DK], inL3Lapse: false, introducedAt: null });
    expect(Object.keys(p.cards)).toEqual(['3']);
    expect(p.cards[3]).toMatchObject({
      state: State.Review,
      stability: PLACEMENT_SEED_STABILITY_DAYS,
      reps: 1,
      lapses: 0,
      last_review: T0.getTime(),
      due: T0.getTime() + PLACEMENT_SEED_STABILITY_DAYS * DAY,
    });
    expect(p.cards[3]?.difficulty).toBeGreaterThan(1);
    expect(isMastered(p)).toBe(false);
    expect(dueRung(p)).toBe(3);
    expect(nextDue(p)).toBe(T0.getTime() + PLACEMENT_SEED_STABILITY_DAYS * DAY);
  });

  it('passed: the seed is the first L3 pass day; one Good on another day masters, the same day does not', () => {
    const p = seedFromPlacement('a', 'passed', T0, DK);
    expect(p.l3PassDays).toEqual([DK]);
    expect(isMastered(p)).toBe(false);
    expect(isMastered(answer(p, 3, Rating.Good, 0))).toBe(false);
    expect(isMastered(answer(p, 3, Rating.Good, 3))).toBe(true);
  });

  it('aboveEstimate: rung 1', () => {
    expect(seedFromPlacement('a', 'aboveEstimate', T0, DK)).toEqual(createProgress('a', T0));
  });

  it('failed: rung 1 with a new card', () => {
    expect(seedFromPlacement('a', 'failed', T0, DK)).toEqual(createProgress('a', T0));
  });

  it('only a passed seed counts as introduced', () => {
    expect(isIntroduced(seedFromPlacement('a', 'passed', T0, DK))).toBe(true);
    for (const o of ['failed', 'aboveEstimate', 'untestedAtOrBelow'] as const) {
      expect(isIntroduced(seedFromPlacement('a', o, T0, DK))).toBe(false);
    }
    expect(isIntroduced(createProgress('a', T0))).toBe(false);
    expect(isIntroduced(answer(createProgress('a', T0), 1, Rating.Again))).toBe(true);
  });

  it('untestedAtOrBelow: rung 2 with one new card due now', () => {
    const p = seedFromPlacement('a', 'untestedAtOrBelow', T0, DK);
    expect(p).toMatchObject({ rung: 2, highestRung: 2, l3PassDays: [], inL3Lapse: false });
    expect(Object.keys(p.cards)).toEqual(['2']);
    expect(p.cards[2]).toMatchObject({ state: State.New, due: T0.getTime() });
    expect(nextDue(p)).toBe(T0.getTime());
  });
});
