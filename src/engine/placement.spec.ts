import { Rating, type Grade } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { PLACEMENT_MAX_QUESTIONS, PLACEMENT_START_LEVEL } from './config';
import { buildCurriculum, type Curriculum } from './curriculum';
import { applyAnswer, createProgress, localDayKey, seedFromPlacement, type ItemProgress } from './srs';
import type { Country, Place, Region } from './types';
import {
  answerPlacement,
  canTestOut,
  finishPlacement,
  isStudied,
  nextQuestion,
  placementPool,
  placementSeeds,
  startPlacement,
  type PlacementItem,
  type PlacementState,
} from './placement';

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `perLevel` items at each of levels 1-8. */
const makeItems = (perLevel: number): PlacementItem[] =>
  Array.from({ length: 8 * perLevel }, (_, i) => ({ itemId: `i${i}`, level: Math.floor(i / perLevel) + 1 }));

/** Runs the test to the end; `skill(level)` is true when the user passes at that level. */
function run(items: PlacementItem[], seed: number, skill: (level: number) => boolean) {
  const rng = mulberry32(seed);
  let state: PlacementState = startPlacement(items, rng);
  const asked: string[] = [];
  for (let n = nextQuestion(state, rng); n; n = nextQuestion(state, rng)) {
    const q = n.question;
    asked.push(q.itemId);
    state = answerPlacement(n.state, q.itemId, skill(q.level) ? Rating.Good : Rating.Again);
  }
  return { state, asked, result: finishPlacement(state) };
}

/** Asks the next question and answers it; returns the new state and the level asked. */
function step(state: PlacementState, rng: () => number, rating: Grade) {
  const n = nextQuestion(state, rng)!;
  return { state: answerPlacement(n.state, n.question.itemId, rating), level: n.question.level };
}

describe('placement staircase', () => {
  const items = makeItems(6);

  for (const k of [2, 5, 7]) {
    it(`converges exactly on skill level ${k} when every level has plenty of items`, () => {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const { result, asked } = run(makeItems(25), seed, (level) => level <= k);
        expect(result.estimate, `k=${k} seed=${seed}`).toBe(k);
        expect(asked.length).toBeLessThanOrEqual(PLACEMENT_MAX_QUESTIONS);
      }
    });
  }

  it('puts a perfect user at 8 and a hopeless one at 0 (no level shown)', () => {
    for (const seed of [1, 2, 3]) {
      expect(run(makeItems(40), seed, () => true).result.estimate).toBe(8);
      expect(run(makeItems(40), seed, () => false).result.estimate).toBe(0);
    }
  });

  it('gives a user who fails everything estimate 0: unasked items are above it, asked ones failed', () => {
    const { result, asked } = run(makeItems(10), 4, () => false);
    expect(result.estimate).toBe(0);
    for (const { itemId } of makeItems(10)) {
      expect(result.outcomes[itemId]).toBe(asked.includes(itemId) ? 'failed' : 'aboveEstimate');
    }
  });

  it('rounds a 4/5 alternation down to 4, leaving an untested level-5 item above the estimate', () => {
    const rng = mulberry32(1);
    let s = startPlacement(makeItems(4), rng);
    // Pass at 4, fail at 5, and so on: reversals alternate 5 and 4 (mean 4.5).
    const ratings = [Rating.Good, Rating.Again, Rating.Good, Rating.Again, Rating.Good, Rating.Again, Rating.Good];
    for (const rating of ratings) {
      s = step(s, rng, rating).state;
    }
    expect(s.reversals).toEqual([5, 4, 5, 4, 5, 4]);
    const { estimate, outcomes } = finishPlacement({ ...s, items: [...s.items, { itemId: 'u5', level: 5 }] });
    expect(estimate).toBe(4);
    expect(outcomes['u5']).toBe('aboveEstimate');
  });

  it('never asks an item twice and stops at the question limit', () => {
    const settled = run(makeItems(40), 3, (level) => level <= 4);
    expect(new Set(settled.asked).size).toBe(settled.asked.length);
    expect(settled.asked.length).toBeLessThanOrEqual(PLACEMENT_MAX_QUESTIONS);
    expect(nextQuestion(settled.state, mulberry32(1))).toBeNull();
    expect(settled.state.pending).toBeNull();
    // A perfect user never reverses, so only the question limit stops it.
    const perfect = run(makeItems(40), 3, () => true);
    expect(perfect.asked).toHaveLength(PLACEMENT_MAX_QUESTIONS);
    expect(new Set(perfect.asked).size).toBe(PLACEMENT_MAX_QUESTIONS);
  });

  it('starts at the start level and moves one level per answer', () => {
    const rng = mulberry32(9);
    let s = startPlacement(items, rng);
    expect(nextQuestion(s, rng)!.question.level).toBe(PLACEMENT_START_LEVEL);
    let r = step(s, rng, Rating.Easy);
    expect(r.level).toBe(PLACEMENT_START_LEVEL);
    expect(nextQuestion(r.state, rng)!.question.level).toBe(PLACEMENT_START_LEVEL + 1);
    r = step(r.state, rng, Rating.Hard);
    r = step(r.state, rng, Rating.Again);
    s = r.state;
    expect(nextQuestion(s, rng)!.question.level).toBe(PLACEMENT_START_LEVEL - 1);
  });

  it('counts direction changes as reversals but not clamped repeats', () => {
    const rng = mulberry32(2);
    let s = startPlacement(items, rng);
    // Fail down to the floor and keep failing: no reversal.
    for (let i = 0; i < 6; i++) s = step(s, rng, Rating.Again).state;
    expect(s.reversals).toEqual([]);
    // A pass at the floor turns the staircase there (level 1), the next fail turns it at 2.
    s = step(s, rng, Rating.Good).state;
    expect(s.reversals).toEqual([1]);
    s = step(s, rng, Rating.Again).state;
    expect(s.reversals).toEqual([1, 2]);
  });

  it('does not count a clamped pass at the ceiling as a reversal', () => {
    const rng = mulberry32(3);
    let s = startPlacement(makeItems(10), rng);
    // Pass up to the ceiling, then keep passing at level 8.
    for (let i = 0; i < 8; i++) s = step(s, rng, Rating.Good).state;
    expect(s.target).toBe(8);
    const at8 = step(s, rng, Rating.Good);
    expect(at8.level).toBe(8);
    expect(at8.state.target).toBe(8);
    expect(at8.state.reversals).toEqual([]);
  });

  it('stops at 6 reversals, before the question limit', () => {
    const rng = mulberry32(8);
    let s = startPlacement(makeItems(10), rng);
    // Alternating pass/fail reverses on every move after the first.
    for (let i = 0; i < 7; i++) {
      expect(nextQuestion(s, rng)).not.toBeNull();
      s = step(s, rng, i % 2 === 0 ? Rating.Good : Rating.Again).state;
    }
    expect(s.reversals).toHaveLength(6);
    expect(s.answers.length).toBeLessThan(PLACEMENT_MAX_QUESTIONS);
    expect(nextQuestion(s, rng)).toBeNull();
  });

  it('falls back to the nearest level with unasked items, easier on a tie', () => {
    const rng = mulberry32(4);
    const sparse: PlacementItem[] = [
      { itemId: 'a', level: 2 },
      { itemId: 'b', level: 6 },
      { itemId: 'c', level: 8 },
    ];
    // Target 4 is equidistant from 2 and 6: the easier one wins.
    expect(nextQuestion(startPlacement(sparse, rng), rng)!.question).toEqual({
      itemId: 'a',
      level: 2,
    });
  });

  it('climbs past a level with no items instead of re-asking the level below it', () => {
    const rng = mulberry32(9);
    const counts: Record<number, number> = { 1: 3, 2: 4, 3: 4, 4: 5, 6: 1, 7: 2 };
    const france = Object.entries(counts).flatMap(([level, n]) =>
      Array.from({ length: n }, (_, i) => ({ itemId: `f${level}-${i}`, level: Number(level) })),
    );
    let s = startPlacement(france, rng);
    const levels: number[] = [];
    while (levels.filter((l) => l === 4).length < 1 || levels.at(-1) !== 4) {
      const r = step(s, rng, Rating.Good);
      s = r.state;
      levels.push(r.level);
    }
    // After the first pass at 4 the target is 5 (empty): go up to 6, and reach 7 before a second 4.
    const next = step(s, rng, Rating.Good);
    expect(next.level).toBe(6);
    s = next.state;
    expect(step(s, rng, Rating.Good).level).toBe(7);
  });

  it('lets a learner who passes everything climb past a level with 30 items and none above it', () => {
    const items: PlacementItem[] = [
      ...Array.from({ length: 30 }, (_, i) => ({ itemId: `a${i}`, level: 4 })),
      ...[6, 7, 8].flatMap((level) =>
        Array.from({ length: 5 }, (_, i) => ({ itemId: `b${level}-${i}`, level })),
      ),
    ];
    for (const seed of [1, 2, 3]) {
      const { state, result } = run(items, seed, () => true);
      // Level 4 is asked once to start; the other four questions at 4 come only after levels 6-8 are spent.
      const firstSix = state.answers.findIndex((a) => a.level >= 6);
      expect(firstSix, `seed=${seed}`).toBe(1);
      expect(state.answers.slice(0, 16).filter((a) => a.level === 4).length, `seed=${seed}`).toBe(1);
      expect(state.answers.some((a) => a.level === 8)).toBe(true);
      expect(result.estimate, `seed=${seed}`).toBe(8);
    }
  });

  it('moves a fail into the nearest easier level with items when the level below is empty', () => {
    const rng = mulberry32(3);
    const gap: PlacementItem[] = [
      { itemId: 'x2', level: 2 },
      { itemId: 'x4', level: 4 },
      { itemId: 'x4b', level: 4 },
    ];
    // Target 4 has items; failing there targets 3 (empty), and the question comes from level 2, not 4.
    let s = startPlacement(gap, rng);
    const first = step(s, rng, Rating.Again);
    expect(first.level).toBe(4);
    s = first.state;
    expect(step(s, rng, Rating.Again).level).toBe(2);
  });

  it('never asks items with a non-finite level, and returns null when none are left', () => {
    const rng = mulberry32(5);
    const s = startPlacement([{ itemId: 'x', level: Infinity }], rng);
    expect(nextQuestion(s, rng)).toBeNull();
    expect(finishPlacement(s).outcomes).toEqual({ x: 'aboveEstimate' });
  });

  it('keeps non-finite items above the estimate through a JSON round trip', () => {
    const rng = mulberry32(5);
    let s = startPlacement(
      [
        { itemId: 'z', level: Infinity },
        { itemId: 'a', level: 1 },
        { itemId: 'p', level: 1 },
      ],
      rng,
    );
    // A pass at level 1 makes the estimate 1, so the untested level-1 item is at or below it.
    s = answerPlacement({ ...s, pending: { itemId: 'p', level: 1 } }, 'p', Rating.Good);
    const revived = JSON.parse(JSON.stringify(s)) as PlacementState;
    expect(finishPlacement(revived).outcomes).toEqual({ z: 'aboveEstimate', a: 'untestedAtOrBelow', p: 'passed' });
  });

  it('bases the staircase on the level asked when the target level has run out', () => {
    const rng = mulberry32(6);
    // Two level-7 items and a single level-8 one: after the level-8 item is gone, target 8 falls back to 7.
    const sparse: PlacementItem[] = [
      { itemId: 'e1', level: 4 },
      { itemId: 'e2', level: 5 },
      { itemId: 'e3', level: 6 },
      { itemId: 'e4', level: 7 },
      { itemId: 'h8', level: 8 },
      { itemId: 'h7', level: 7 },
    ];
    let s = startPlacement(sparse, rng);
    let asked = 0;
    let maxLevel = 0;
    // Pass until the level-8 item has been asked, then fail the next (a level-7 fallback).
    for (;;) {
      const n = nextQuestion(s, rng)!;
      const q = n.question;
      maxLevel = Math.max(maxLevel, q.level);
      asked++;
      const afterEight = s.answers.some((a) => a.level === 8);
      s = answerPlacement(n.state, q.itemId, afterEight ? Rating.Again : Rating.Good);
      if (afterEight) {
        expect(q.level).toBe(7);
        break;
      }
      expect(asked).toBeLessThan(10);
    }
    expect(s.reversals).toEqual([7]);
    expect(finishPlacement(s).estimate).toBe(7);
    expect(finishPlacement(s).estimate).toBeLessThanOrEqual(maxLevel);
  });

  it('rejects answers for items that are not the pending question', () => {
    const rng = mulberry32(6);
    let s = startPlacement(items, rng);
    // Nothing asked yet.
    expect(() => answerPlacement(s, 'i0', Rating.Good)).toThrow();
    const n = nextQuestion(s, rng)!;
    const other = items.find((i) => i.itemId !== n.question.itemId)!.itemId;
    // An open item that was not the one asked.
    expect(() => answerPlacement(n.state, other, Rating.Good)).toThrow();
    expect(() => answerPlacement(n.state, 'nope', Rating.Good)).toThrow();
    s = answerPlacement(n.state, n.question.itemId, Rating.Good);
    // Already answered.
    expect(() => answerPlacement(s, n.question.itemId, Rating.Good)).toThrow();
    const done = run(items, 1, (l) => l <= 3).state;
    const spare = done.items.find((i) => !done.answers.some((a) => a.itemId === i.itemId))!;
    expect(() => answerPlacement(done, spare.itemId, Rating.Good)).toThrow();
  });

  it('keeps one question open: nextQuestion is idempotent and spends no randomness', () => {
    let calls = 0;
    const base = mulberry32(11);
    const rng = () => (calls++, base());
    const s = startPlacement(items, rng);
    const first = nextQuestion(s, rng)!;
    expect(calls).toBe(1);
    const second = nextQuestion(first.state, rng)!;
    expect(calls).toBe(1);
    expect(second.question).toEqual(first.question);
    expect(second.state).toBe(first.state);
  });

  it('survives a JSON round trip with a question pending, and finishes it as untested', () => {
    const rng = mulberry32(12);
    const n = nextQuestion(startPlacement(items, rng), rng)!;
    expect(n.state.pending).toEqual(n.question);
    const revived = JSON.parse(JSON.stringify(n.state)) as PlacementState;
    expect(revived).toEqual(n.state);
    expect(nextQuestion(revived, rng)!.question).toEqual(n.question);
    const next = answerPlacement(revived, n.question.itemId, Rating.Good);
    expect(next.pending).toBeNull();
    expect(finishPlacement(n.state).outcomes[n.question.itemId]).not.toBe('passed');
  });

  it('is pure: state is JSON and is not mutated', () => {
    const rng = mulberry32(7);
    const s0 = startPlacement(items, rng);
    const snapshot = JSON.stringify(s0);
    const asked = nextQuestion(s0, rng)!;
    expect(JSON.stringify(s0)).toBe(snapshot);
    const s1 = answerPlacement(asked.state, asked.question.itemId, Rating.Good);
    expect(JSON.stringify(s0)).toBe(snapshot);
    expect(JSON.parse(JSON.stringify(s1))).toEqual(s1);
  });

  it('maps outcomes: passed, and failed or untested above or at/below the estimate', () => {
    const levelled: PlacementItem[] = [
      { itemId: 'p1', level: 3 },
      { itemId: 'f1', level: 5 },
      { itemId: 'f2', level: 1 },
      { itemId: 'u1', level: 2 },
      { itemId: 'u2', level: 7 },
    ];
    const rng = mulberry32(1);
    let s = startPlacement(levelled, rng);
    const answer = (id: string, rating: Grade) => {
      // Items are chosen by hand here, so open each as the pending question first.
      const level = levelled.find((i) => i.itemId === id)!.level;
      s = answerPlacement({ ...s, pending: { itemId: id, level } }, id, rating);
    };
    // Targets 4 (pass) -> 5 (fail: reversal at 5) -> 4 (fail); the mean 5 is capped at the highest passed level, 3.
    answer('p1', Rating.Easy);
    answer('f1', Rating.Hard);
    answer('f2', Rating.Again);
    const { estimate, outcomes } = finishPlacement(s);
    expect(estimate).toBe(3);
    expect(outcomes).toEqual({
      p1: 'passed',
      f1: 'failed',
      f2: 'failed',
      u1: 'untestedAtOrBelow',
      u2: 'aboveEstimate',
    });
  });

  it('can be finished early with no answers: estimate 0, every item above it', () => {
    const rng = mulberry32(1);
    const { estimate, outcomes } = finishPlacement(startPlacement(makeItems(1), rng));
    expect(estimate).toBe(0);
    expect(Object.values(outcomes).every((o) => o === 'aboveEstimate')).toBe(true);
  });

  it('never estimates above the highest passed level', () => {
    const rng = mulberry32(11);
    const items6 = makeItems(6);
    // Pass at 4, fail at 5, stop: reversals [5], but 5 was failed.
    let s = startPlacement(items6, rng);
    s = step(s, rng, Rating.Good).state;
    s = step(s, rng, Rating.Again).state;
    expect(s.reversals).toEqual([5]);
    const early = finishPlacement(s);
    expect(early.estimate).toBe(4);
    const level5 = items6.find((i) => i.level === 5 && early.outcomes[i.itemId] !== 'failed')!;
    expect(early.outcomes[level5.itemId]).toBe('aboveEstimate');
    // A window of [5, 4, 5] starts at a peak: mean 4.67 would round to 5.
    s = step(s, rng, Rating.Good).state;
    s = step(s, rng, Rating.Again).state;
    expect(s.reversals).toEqual([5, 4, 5]);
    expect(finishPlacement(s).estimate).toBe(4);
  });

  it('throws a RangeError when rng returns a value outside [0, 1)', () => {
    const s = startPlacement(makeItems(2), mulberry32(1));
    for (const bad of [-0.1, 1, NaN]) {
      expect(() => nextQuestion(s, () => bad)).toThrow(RangeError);
    }
  });
});

const T0 = new Date('2026-03-01T00:00:00Z');
const DAY = 86_400_000;

/** An item that has passed L4 on two different days. */
function mastered(itemId: string): ItemProgress {
  let p = createProgress(itemId, T0);
  for (let day = 0; day < 40 && p.l4PassDays.length < 2; day++) {
    const now = new Date(T0.getTime() + day * DAY);
    p = applyAnswer(p, p.rung, Rating.Good, now, localDayKey(now, 0));
  }
  expect(p.l4PassDays.length).toBeGreaterThanOrEqual(2);
  return p;
}

const country = (id: string, hasRegions: boolean): Country => ({ id, name: id, places: 1, hasRegions });
const region = (id: string, c: string): Region => ({ id, name: id, country: c, places: 1 });
const place = (id: string, c: string, r: string | null, level: number): Place => ({
  id,
  name: id,
  country: c,
  region: r,
  lat: 0,
  lng: 0,
  type: 'city',
  level,
});

function fixture(): Curriculum {
  return buildCurriculum(
    [country('france', true), country('germany', true), country('tuvalu', false)],
    [region('france.bretagne', 'france'), region('france.corse', 'france'), region('germany.bayern', 'germany')],
    [
      place('rennes', 'france', 'france.bretagne', 2),
      place('brest', 'france', 'france.bretagne', 3),
      place('ajaccio', 'france', 'france.corse', 4),
      place('munich', 'germany', 'germany.bayern', 1),
      place('funafuti', 'tuvalu', null, 3),
      place('vaitupu', 'tuvalu', null, 5),
    ],
  );
}

const rows = (...ids: string[]): Record<string, ItemProgress> =>
  Object.fromEntries(ids.map((id) => [id, createProgress(id, T0)]));

describe('placementPool', () => {
  const c = fixture();

  it('lists every country without progress, in curriculum order, at its difficulty', () => {
    expect(placementPool(c, {}, 'countries')).toEqual([
      { itemId: 'country:france', level: 2 },
      { itemId: 'country:germany', level: 1 },
      { itemId: 'country:tuvalu', level: 3 },
    ]);
  });

  it('skips countries with a progress row', () => {
    const pool = placementPool(c, rows('country:germany'), 'countries');
    expect(pool.map((i) => i.itemId)).toEqual(['country:france', 'country:tuvalu']);
  });

  it('a country with a regions tier lists its regions', () => {
    expect(placementPool(c, {}, 'country:france')).toEqual([
      { itemId: 'region:france.bretagne', level: 2 },
      { itemId: 'region:france.corse', level: 4 },
    ]);
  });

  it('a regionless country lists its places, and a region its places', () => {
    expect(placementPool(c, {}, 'country:tuvalu').map((i) => i.itemId)).toEqual(['place:funafuti', 'place:vaitupu']);
    expect(placementPool(c, {}, 'region:france.bretagne')).toEqual([
      { itemId: 'place:rennes', level: 2 },
      { itemId: 'place:brest', level: 3 },
    ]);
  });

  it('leaves out children that have a progress row', () => {
    const pool = placementPool(c, rows('place:rennes'), 'region:france.bretagne');
    expect(pool.map((i) => i.itemId)).toEqual(['place:brest']);
  });

  it('is empty for a place and throws for an unknown id', () => {
    expect(placementPool(c, {}, 'place:rennes')).toEqual([]);
    expect(() => placementPool(c, {}, 'country:nowhere')).toThrow(/Unknown item/);
  });
});

describe('placementSeeds', () => {
  const NOW = new Date('2026-03-10T09:00:00Z');
  const day = '2026-03-10';
  const result = {
    estimate: 3,
    outcomes: {
      'country:a': 'passed',
      'country:b': 'failed',
      'country:c': 'untestedAtOrBelow',
      'country:d': 'aboveEstimate',
    },
  } as const;

  it('seeds passed and untestedAtOrBelow items, in outcome order, and nothing for the others', () => {
    const seeds = placementSeeds(result, {}, NOW, day);
    expect(seeds).toEqual([
      seedFromPlacement('country:a', 'passed', NOW, day),
      seedFromPlacement('country:c', 'untestedAtOrBelow', NOW, day),
    ]);
  });

  it('never seeds an item that already has progress', () => {
    const seeds = placementSeeds(result, rows('country:a'), NOW, day);
    expect(seeds.map((s) => s.itemId)).toEqual(['country:c']);
  });
});

describe('isStudied', () => {
  const DAY = '2026-03-04';
  it('is false for a fresh row and for every placement seed', () => {
    expect(isStudied(createProgress('country:a', T0))).toBe(false);
    for (const outcome of ['passed', 'untestedAtOrBelow', 'failed', 'aboveEstimate'] as const) {
      expect(isStudied(seedFromPlacement('country:a', outcome, T0, DAY))).toBe(false);
    }
  });

  it('is true for a passed seed after one answer at rung 4, whatever the rating', () => {
    const seed = seedFromPlacement('country:a', 'passed', T0, DAY);
    expect(isStudied(applyAnswer(seed, 4, Rating.Good, T0, DAY))).toBe(true);
    expect(isStudied(applyAnswer(seed, 4, Rating.Again, T0, DAY))).toBe(true);
  });

  it('is true for an untestedAtOrBelow seed after one answer', () => {
    const seed = seedFromPlacement('country:a', 'untestedAtOrBelow', T0, DAY);
    expect(isStudied(applyAnswer(seed, 3, Rating.Good, T0, DAY))).toBe(true);
  });
});

describe('canTestOut', () => {
  const c = fixture();
  const masteredFrance = { 'country:france': mastered('country:france') };

  it('is true for a mastered country or region whose children have no rows', () => {
    expect(canTestOut(c, masteredFrance, 'country:france')).toBe(true);
    const bretagne = { 'region:france.bretagne': mastered('region:france.bretagne') };
    expect(canTestOut(c, bretagne, 'region:france.bretagne')).toBe(true);
  });

  it('is false for an item that is not mastered or has no progress', () => {
    expect(canTestOut(c, {}, 'country:france')).toBe(false);
    expect(canTestOut(c, rows('country:france'), 'country:france')).toBe(false);
  });

  it('is false for a mastered item with no children', () => {
    expect(canTestOut(c, { 'place:rennes': mastered('place:rennes') }, 'place:rennes')).toBe(false);
  });

  it('is false once a child has been studied', () => {
    const studied = applyAnswer(createProgress('region:france.corse', T0), 1, Rating.Good, T0, '2026-03-04');
    expect(studied.introducedAt).not.toBeNull();
    expect(canTestOut(c, { ...masteredFrance, 'region:france.corse': studied }, 'country:france')).toBe(false);
  });

  it('is false once a passed-seed child has been studied', () => {
    const seed = seedFromPlacement('region:france.corse', 'passed', T0, '2026-03-04');
    const studied = applyAnswer(seed, 4, Rating.Good, T0, '2026-03-04');
    expect(canTestOut(c, { ...masteredFrance, 'region:france.corse': studied }, 'country:france')).toBe(false);
  });

  it('stays true when a child has only a placement seed and another has no row', () => {
    const seed = seedFromPlacement('region:france.corse', 'passed', T0, '2026-03-04');
    expect(canTestOut(c, { ...masteredFrance, 'region:france.corse': seed }, 'country:france')).toBe(true);
  });

  it('is false once every child has a row', () => {
    const seeds = {
      'region:france.corse': seedFromPlacement('region:france.corse', 'passed', T0, '2026-03-04'),
      'region:france.bretagne': seedFromPlacement('region:france.bretagne', 'failed', T0, '2026-03-04'),
    };
    expect(canTestOut(c, { ...masteredFrance, ...seeds }, 'country:france')).toBe(false);
  });

  it('throws for an id not in the curriculum', () => {
    expect(() => canTestOut(c, {}, 'country:nowhere')).toThrow(/Unknown item/);
  });
});
