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
const at = (days: number) => new Date(T0.getTime() + days * DAY);

function answer(p: ItemProgress, rung: Rung, rating: Grade, d = 0) {
  return applyAnswer(p, rung, rating, at(d), localDayKey(at(d), 0));
}

/** Climb a fresh item to rung 4 with Good answers on day 0. */
function atRung4(): ItemProgress {
  let p = createProgress('x', T0);
  for (const r of [1, 2, 3] as const) p = answer(p, r, Rating.Good);
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
      l4PassDays: [],
      inL4Lapse: false,
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
    const p = seedFromPlacement('a', 'passed', T0);
    const lapsed = answer(p, 4, Rating.Again, 3);
    expect(lapsed.cards[4]?.lapses).toBe(1);
    expect(lapsed.cards[4]?.state).toBe(State.Relearning);
  });

  it('does not mutate its input', () => {
    const p = createProgress('a', T0);
    const frozen = JSON.stringify(p);
    answer(p, 1, Rating.Good);
    expect(JSON.stringify(p)).toBe(frozen);
  });
});

describe('ladder', () => {
  it('moves up on Good and Easy, up to rung 4', () => {
    let p = createProgress('a', T0);
    p = answer(p, 1, Rating.Good);
    expect(p).toMatchObject({ rung: 2, highestRung: 2 });
    p = answer(p, 2, Rating.Easy);
    expect(p).toMatchObject({ rung: 3, highestRung: 3 });
    p = answer(p, 3, Rating.Good);
    expect(p).toMatchObject({ rung: 4, highestRung: 4 });
    p = answer(p, 4, Rating.Good);
    expect(p.rung).toBe(4);
  });

  it('keeps the rung on Hard', () => {
    expect(answer(createProgress('a', T0), 1, Rating.Hard).rung).toBe(1);
  });

  it('drops one rung on Again, never below 1', () => {
    let p = answer(createProgress('a', T0), 1, Rating.Good);
    p = answer(p, 2, Rating.Again);
    expect(p).toMatchObject({ rung: 1, highestRung: 2 });
    expect(answer(p, 1, Rating.Again).rung).toBe(1);
  });

  it('creates a rung card when first reached, due immediately', () => {
    const p = answer(createProgress('a', T0), 1, Rating.Good, 5);
    expect(p.cards[2]).toMatchObject({ state: State.New, due: at(5).getTime() });
  });

  it('lapses at L4 to L3 and returns to L4 on the next L3 pass', () => {
    let p = answer(atRung4(), 4, Rating.Again, 10);
    expect(p).toMatchObject({ rung: 3, highestRung: 4, inL4Lapse: true });
    expect(dueRung(p)).toBe(3);
    expect(nextDue(p)).toBe(p.cards[3]?.due);
    p = answer(p, 3, Rating.Good, 11);
    expect(p).toMatchObject({ rung: 4, inL4Lapse: false });
  });

  it('keeps the lapse through Hard and Again at L3', () => {
    let p = answer(atRung4(), 4, Rating.Again, 10);
    p = answer(p, 3, Rating.Hard, 11);
    expect(p).toMatchObject({ rung: 3, inL4Lapse: true });
    p = answer(p, 3, Rating.Again, 12);
    expect(p).toMatchObject({ rung: 2, highestRung: 4, inL4Lapse: true });
    p = answer(answer(p, 2, Rating.Good, 13), 3, Rating.Good, 14);
    expect(p).toMatchObject({ rung: 4, inL4Lapse: false });
  });

  it('schedules a lower rung without moving the ladder', () => {
    const before = atRung4();
    const p = answer(before, 2, Rating.Good, 3);
    expect(p.rung).toBe(4);
    expect(p.cards[2]?.due).not.toBe(before.cards[2]?.due);
  });

  it('Hard at L2, L3 and L4 stays put', () => {
    let p = createProgress('a', T0);
    p = answer(p, 1, Rating.Good);
    expect(answer(p, 2, Rating.Hard).rung).toBe(2);
    p = answer(p, 2, Rating.Good);
    expect(answer(p, 3, Rating.Hard).rung).toBe(3);
    expect(answer(atRung4(), 4, Rating.Hard)).toMatchObject({ rung: 4, inL4Lapse: false, l4PassDays: [] });
  });

  it('Easy at L4 records a pass day and stays at 4', () => {
    expect(answer(atRung4(), 4, Rating.Easy)).toMatchObject({ rung: 4, l4PassDays: ['2026-03-01'] });
  });

  it('Again at L3 outside a lapse drops to L2 with no lapse flag', () => {
    const p = answer(answer(answer(createProgress('a', T0), 1, Rating.Good), 2, Rating.Good), 3, Rating.Again);
    expect(p).toMatchObject({ rung: 2, inL4Lapse: false });
  });

  it('Easy at L3 during a lapse returns to L4 and clears the flag', () => {
    const p = answer(answer(atRung4(), 4, Rating.Again, 10), 3, Rating.Easy, 11);
    expect(p).toMatchObject({ rung: 4, inL4Lapse: false });
  });

  it('a lapse at L4 is due again at once at L3, keeping the old L3 card otherwise', () => {
    let p = createProgress('a', T0);
    for (const r of [1, 2, 3] as const) p = answer(p, r, Rating.Easy);
    const oldL3 = p.cards[3];
    expect(oldL3?.due).toBeGreaterThan(at(1).getTime());
    p = applyAnswer(p, 4, Rating.Again, at(0.0007), '2026-03-01');
    expect(p.rung).toBe(3);
    expect(nextDue(p)).toBe(at(0.0007).getTime());
    expect(p.cards[3]).toEqual({ ...oldL3, due: at(0.0007).getTime() });
  });

  it('every step down brings the lower rung due now (L3 to L2 during a lapse)', () => {
    let p = createProgress('a', T0);
    for (const r of [1, 2, 3] as const) p = answer(p, r, Rating.Easy);
    p = answer(p, 4, Rating.Again, 1);
    const oldL2 = p.cards[2];
    expect(oldL2?.due).toBeGreaterThan(at(2).getTime());
    p = answer(p, 3, Rating.Again, 2);
    expect(p).toMatchObject({ rung: 2, inL4Lapse: true });
    expect(nextDue(p)).toBe(at(2).getTime());
    expect(p.cards[2]).toEqual({ ...oldL2, due: at(2).getTime() });
  });

  it('throws for a rung above the highest reached', () => {
    expect(() => answer(createProgress('a', T0), 3, Rating.Good)).toThrow();
  });
});

describe('mastery', () => {
  it('needs L4 passes on two different days', () => {
    let p = atRung4();
    p = answer(p, 4, Rating.Good, 0);
    p = answer(p, 4, Rating.Easy, 0);
    expect(p.l4PassDays).toEqual(['2026-03-01']);
    expect(isMastered(p)).toBe(false);
    p = answer(p, 4, Rating.Good, 3);
    expect(p.l4PassDays).toEqual(['2026-03-01', '2026-03-04']);
    expect(isMastered(p)).toBe(true);
  });

  it('does not count Hard or Again at L4', () => {
    let p = atRung4();
    p = answer(p, 4, Rating.Hard, 1);
    p = answer(p, 4, Rating.Again, 2);
    expect(p.l4PassDays).toEqual([]);
  });

  it('stays mastered through a later lapse', () => {
    let p = answer(answer(atRung4(), 4, Rating.Good, 1), 4, Rating.Good, 5);
    expect(isMastered(p)).toBe(true);
    p = answer(p, 4, Rating.Again, 20);
    expect(p.inL4Lapse).toBe(true);
    expect(isMastered(p)).toBe(true);
  });
});

describe('serialisation', () => {
  it('round-trips through JSON and behaves identically', () => {
    const p = answer(atRung4(), 4, Rating.Good, 1);
    const copy = JSON.parse(JSON.stringify(p)) as ItemProgress;
    expect(copy).toEqual(p);
    expect(answer(copy, 4, Rating.Good, 4)).toEqual(answer(p, 4, Rating.Good, 4));
  });
});

describe('introducedAt', () => {
  it('is null for a fresh item and every seed outcome', () => {
    expect(createProgress('a', T0).introducedAt).toBeNull();
    for (const o of ['passed', 'failed', 'aboveEstimate', 'untestedAtOrBelow'] as const) {
      expect(seedFromPlacement('a', o, T0).introducedAt).toBeNull();
    }
  });

  it('is set by the first answer and unchanged by the second', () => {
    const first = answer(createProgress('a', T0), 1, Rating.Good, 1);
    expect(first.introducedAt).toBe(at(1).getTime());
    expect(answer(first, 2, Rating.Good, 2).introducedAt).toBe(at(1).getTime());
  });

  it('is set by the first answer to an untested seed', () => {
    const p = answer(seedFromPlacement('a', 'untestedAtOrBelow', T0), 3, Rating.Good, 1);
    expect(p.introducedAt).toBe(at(1).getTime());
  });

  it('stays null when a passed seed is answered', () => {
    expect(answer(seedFromPlacement('a', 'passed', T0), 4, Rating.Good, 1).introducedAt).toBeNull();
  });

  it('survives JSON as null', () => {
    const p = createProgress('a', T0);
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });
});

describe('L4 pass during a lapse', () => {
  it('adds no pass day and leaves the ladder alone', () => {
    const lapsed = answer(seedFromPlacement('a', 'passed', T0), 4, Rating.Again, 1);
    expect(lapsed).toMatchObject({ rung: 3, inL4Lapse: true });
    const p = answer(lapsed, 4, Rating.Good, 2);
    expect(p).toMatchObject({ rung: 3, inL4Lapse: true, l4PassDays: [] });
  });
});

describe('seedFromPlacement', () => {
  it('passed: rung 4, review card with seed stability, not mastered', () => {
    const p = seedFromPlacement('a', 'passed', T0);
    expect(p).toMatchObject({ rung: 4, highestRung: 4, l4PassDays: [], inL4Lapse: false, introducedAt: null });
    expect(p.cards[4]).toMatchObject({
      state: State.Review,
      stability: PLACEMENT_SEED_STABILITY_DAYS,
      reps: 1,
      lapses: 0,
      last_review: T0.getTime(),
      due: T0.getTime() + PLACEMENT_SEED_STABILITY_DAYS * DAY,
    });
    expect(p.cards[4]?.difficulty).toBeGreaterThan(1);
    expect(isMastered(p)).toBe(false);
    expect(dueRung(p)).toBe(4);
    expect(nextDue(p)).toBe(T0.getTime() + PLACEMENT_SEED_STABILITY_DAYS * DAY);
  });

  it('aboveEstimate: rung 1', () => {
    expect(seedFromPlacement('a', 'aboveEstimate', T0)).toEqual(createProgress('a', T0));
  });

  it('failed: rung 1 with a new card', () => {
    expect(seedFromPlacement('a', 'failed', T0)).toEqual(createProgress('a', T0));
  });

  it('only a passed seed counts as introduced', () => {
    expect(isIntroduced(seedFromPlacement('a', 'passed', T0))).toBe(true);
    for (const o of ['failed', 'aboveEstimate', 'untestedAtOrBelow'] as const) {
      expect(isIntroduced(seedFromPlacement('a', o, T0))).toBe(false);
    }
    expect(isIntroduced(createProgress('a', T0))).toBe(false);
    expect(isIntroduced(answer(createProgress('a', T0), 1, Rating.Again))).toBe(true);
  });

  it('untestedAtOrBelow: rung 3 with a new card due now', () => {
    const p = seedFromPlacement('a', 'untestedAtOrBelow', T0);
    expect(p).toMatchObject({ rung: 3, highestRung: 3 });
    expect(p.cards[3]).toMatchObject({ state: State.New, due: T0.getTime() });
    expect(nextDue(p)).toBe(T0.getTime());
  });
});
