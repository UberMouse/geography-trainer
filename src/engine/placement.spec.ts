import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import {
  PLACEMENT_CLOSE_KM,
  PLACEMENT_CONFIRM_PER_DAY,
  PLACEMENT_CONFIRM_START_DAYS,
  PLACEMENT_MAX_QUESTIONS,
  PLACEMENT_MIN_QUESTIONS,
  PLACEMENT_MIN_TO_PLACE,
  PLACEMENT_START_LEVEL,
} from './config';
import { buildCurriculum, type Curriculum } from './curriculum';
import { applyAnswer, createProgress, localDayKey, seedFromPlacement, type ItemProgress } from './srs';
import type { Country, Place, Region } from './types';
import {
  abilityOf,
  answerPlacement,
  canTestOut,
  finishPlacement,
  isStudied,
  knowProbability,
  nextQuestion,
  placementCredit,
  placementPool,
  placementSeeds,
  startPlacement,
  worldArea,
  type PlacementCredit,
  type PlacementItem,
  type PlacementResult,
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

const AREAS = ['europe', 'africa', 'east-south-asia', 'south-america'];

/** `perLevel` items at each of levels 1-8, spread round-robin over AREAS. */
const makeItems = (perLevel: number): PlacementItem[] =>
  Array.from({ length: 8 * perLevel }, (_, i) => ({
    itemId: `i${i}`,
    level: Math.floor(i / perLevel) + 1,
    area: AREAS[i % AREAS.length]!,
  }));

/** Runs the test to the end; `credit(level)` is what the learner earns at that level. */
function run(items: PlacementItem[], seed: number, credit: (level: number, rng: () => number) => PlacementCredit) {
  const rng = mulberry32(seed);
  const learner = mulberry32(seed * 7919 + 1);
  let state: PlacementState = startPlacement(items, rng);
  const asked: PlacementItem[] = [];
  for (let n = nextQuestion(state, rng); n; n = nextQuestion(state, rng)) {
    const q = n.question;
    asked.push(items.find((i) => i.itemId === q.itemId)!);
    state = answerPlacement(n.state, q.itemId, credit(q.level, learner));
  }
  return { state, asked, result: finishPlacement(state) };
}

/** A learner who knows everything up to `k` and nothing above. */
const upTo = (k: number) => (level: number): PlacementCredit => (level <= k ? 1 : 0);

/** A learner of true ability `k` who passes with the model's own probability. */
const noisy = (k: number) => (level: number, rng: () => number): PlacementCredit =>
  rng() < knowProbability(k, level) ? 1 : 0;

describe('placement ability estimate', () => {
  for (const k of [2, 4, 6]) {
    it(`places a learner who knows up to level ${k} at ${k} or ${k + 1}`, () => {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const { result, asked } = run(makeItems(25), seed, upTo(k));
        expect(result.estimate, `k=${k} seed=${seed}`).toBeGreaterThanOrEqual(k);
        expect(result.estimate, `k=${k} seed=${seed}`).toBeLessThanOrEqual(k + 1);
        expect(asked.length).toBeGreaterThanOrEqual(PLACEMENT_MIN_QUESTIONS);
        expect(asked.length).toBeLessThanOrEqual(PLACEMENT_MAX_QUESTIONS);
      }
    });
  }

  it('places noisy synthetic learners within a level of their ability, on average within half', () => {
    for (const k of [2, 3.5, 5, 6.5]) {
      let totalError = 0;
      const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
      for (const seed of seeds) {
        const { state } = run(makeItems(25), seed, noisy(k));
        const { mean } = abilityOf(state.answers);
        expect(Math.abs(mean - k), `k=${k} seed=${seed}`).toBeLessThan(2);
        totalError += Math.abs(mean - k);
      }
      expect(totalError / seeds.length, `k=${k}`).toBeLessThan(0.75);
    }
  });

  it('reads close misses as rough knowledge: few right but many close is not a beginner', () => {
    // Right only on the easiest levels, close on the middle ones, far off on the hardest.
    const credit = (level: number): PlacementCredit => (level <= 1 ? 1 : level <= 6 ? 0.5 : 0);
    for (const seed of [1, 2, 3, 4]) {
      const { result } = run(makeItems(25), seed, credit);
      expect(result.estimate, `seed=${seed}`).toBeGreaterThanOrEqual(3);
      const easiest = makeItems(25).filter((i) => i.level === 1 && result.outcomes[i.itemId] !== 'passed');
      // Untested level-1 items are very likely known: confirmed in review, not taught from L1.
      expect(easiest.every((i) => ['likelyKnown', 'untestedAtOrBelow', 'close'].includes(result.outcomes[i.itemId]!))).toBe(true);
    }
  });

  it('puts a perfect learner at 8 and a hopeless one at 0 (no level shown)', () => {
    expect(run(makeItems(6), 1, () => 1).result.estimate).toBe(8);
    const hopeless = run(makeItems(6), 1, () => 0);
    expect(hopeless.result.estimate).toBe(0);
    for (const [id, outcome] of Object.entries(hopeless.result.outcomes)) {
      const asked = hopeless.asked.some((i) => i.itemId === id);
      expect(outcome).toBe(asked ? 'failed' : 'aboveEstimate');
    }
  });

  it('starts at the start level, then follows the estimate up after passes and down after misses', () => {
    const rng = mulberry32(3);
    let state = startPlacement(makeItems(6), rng);
    const first = nextQuestion(state, rng)!;
    expect(first.question.level).toBe(PLACEMENT_START_LEVEL);
    state = answerPlacement(first.state, first.question.itemId, 1);
    const afterPass = nextQuestion(state, rng)!;
    expect(afterPass.question.level).toBeGreaterThan(PLACEMENT_START_LEVEL);
    const afterMiss = nextQuestion(answerPlacement(first.state, first.question.itemId, 0), rng)!;
    expect(afterMiss.question.level).toBeLessThan(PLACEMENT_START_LEVEL);
  });

  it('spreads questions across world areas at the same level', () => {
    const items = makeItems(8);
    const { asked } = run(items, 5, upTo(4));
    // Every window of 4 consecutive questions at levels with all areas covers at least 3 areas.
    const firstFour = new Set(asked.slice(0, 4).map((i) => i.area));
    expect(firstFour.size).toBeGreaterThanOrEqual(3);
    const counts = AREAS.map((a) => asked.filter((i) => i.area === a).length);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
  });

  it('never asks an item twice', () => {
    for (const seed of [1, 2, 3]) {
      const { asked } = run(makeItems(3), seed, noisy(4));
      expect(new Set(asked.map((i) => i.itemId)).size).toBe(asked.length);
    }
  });

  it('stops early once confident, and at the question limit otherwise', () => {
    const lengths = [1, 2, 3, 4, 5, 6].map((seed) => run(makeItems(25), seed, upTo(5)).asked.length);
    expect(Math.min(...lengths)).toBeLessThan(PLACEMENT_MAX_QUESTIONS);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(PLACEMENT_MAX_QUESTIONS);
  });

  it('asks the nearest level with items when the target level is empty', () => {
    const items: PlacementItem[] = [
      { itemId: 'a', level: 1, area: 'europe' },
      { itemId: 'b', level: 7, area: 'europe' },
    ];
    const rng = mulberry32(1);
    const n = nextQuestion(startPlacement(items, rng), rng)!;
    // Prior centre 4: level 1 is 3 away, level 7 is 3 away; both are within half a level.
    expect(['a', 'b']).toContain(n.question.itemId);
    const later = nextQuestion(answerPlacement(n.state, n.question.itemId, 1), rng)!;
    expect(later.question.itemId).toBe(n.question.itemId === 'a' ? 'b' : 'a');
  });

  it('never asks items with a non-finite level, and returns null when none are left', () => {
    const rng = mulberry32(1);
    const state = startPlacement([{ itemId: 'x', level: Infinity, area: 'unknown' }], rng);
    expect(nextQuestion(state, rng)).toBeNull();
    expect(finishPlacement(state).outcomes).toEqual({ x: 'aboveEstimate' });
  });

  it('keeps non-finite items above the estimate through a JSON round trip', () => {
    const rng = mulberry32(1);
    const items = [...makeItems(2), { itemId: 'tiny', level: Infinity, area: 'unknown' }];
    let state = startPlacement(items, rng);
    for (let i = 0; i < 4; i++) {
      const n = nextQuestion(state, rng)!;
      state = answerPlacement(n.state, n.question.itemId, 1);
    }
    const copy = JSON.parse(JSON.stringify(state)) as PlacementState;
    expect(finishPlacement(copy).outcomes['tiny']).toBe('aboveEstimate');
    expect(finishPlacement(copy)).toEqual(finishPlacement(state));
  });

  it('rejects answers for items that are not the pending question', () => {
    const rng = mulberry32(1);
    const state = startPlacement(makeItems(2), rng);
    expect(() => answerPlacement(state, 'i0', 1)).toThrow(/not the pending/);
    const n = nextQuestion(state, rng)!;
    const other = makeItems(2).find((i) => i.itemId !== n.question.itemId)!.itemId;
    expect(() => answerPlacement(n.state, other, 1)).toThrow(/not the pending/);
    const answered = answerPlacement(n.state, n.question.itemId, 1);
    expect(() => answerPlacement(answered, n.question.itemId, 1)).toThrow(/not the pending/);
  });

  it('keeps one question open: nextQuestion is idempotent and spends no randomness', () => {
    let calls = 0;
    const rng = () => {
      calls++;
      return 0.5;
    };
    const n = nextQuestion(startPlacement(makeItems(2), rng), rng)!;
    expect(calls).toBe(1);
    expect(nextQuestion(n.state, rng)).toEqual(n);
    expect(calls).toBe(1);
  });

  it('survives a JSON round trip with a question pending, and finishes it as untested', () => {
    const rng = mulberry32(2);
    const n = nextQuestion(startPlacement(makeItems(2), rng), rng)!;
    const copy = JSON.parse(JSON.stringify(n.state)) as PlacementState;
    expect(nextQuestion(copy, rng)).toEqual({ state: copy, question: n.question });
    expect(finishPlacement(copy).outcomes[n.question.itemId]).toBe('aboveEstimate');
  });

  it('is pure: state is JSON and is not mutated', () => {
    const rng = mulberry32(4);
    const state = startPlacement(makeItems(2), rng);
    const before = JSON.stringify(state);
    const n = nextQuestion(state, rng)!;
    const mid = JSON.stringify(n.state);
    answerPlacement(n.state, n.question.itemId, 0.5);
    finishPlacement(n.state);
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(n.state)).toBe(mid);
  });

  it('maps answered items to passed, close or failed, and untested ones by how likely they are known', () => {
    const items = makeItems(4);
    const rng = mulberry32(9);
    let state = startPlacement(items, rng);
    const credits: Record<string, PlacementCredit> = {};
    for (let n = nextQuestion(state, rng); n; n = nextQuestion(state, rng)) {
      const c: PlacementCredit = n.question.level <= 3 ? 1 : n.question.level === 4 ? 0.5 : 0;
      credits[n.question.itemId] = c;
      state = answerPlacement(n.state, n.question.itemId, c);
    }
    const { outcomes, confidence, estimate } = finishPlacement(state);
    expect(estimate).toBeGreaterThanOrEqual(3);
    expect(estimate).toBeLessThanOrEqual(4);
    for (const item of items) {
      const outcome = outcomes[item.itemId]!;
      const c = credits[item.itemId];
      if (c !== undefined) expect(outcome).toBe(c === 1 ? 'passed' : c === 0.5 ? 'close' : 'failed');
      else if (item.level === 1) expect(outcome).toBe('likelyKnown');
      else if (item.level === 8) expect(outcome).toBe('aboveEstimate');
      expect(outcome === 'likelyKnown').toBe(confidence[item.itemId] !== undefined);
    }
  });

  it('finished early with few answers, places only what it asked', () => {
    const rng = mulberry32(6);
    let state = startPlacement(makeItems(6), rng);
    for (const credit of [1, 1, 0.5] as const) {
      const n = nextQuestion(state, rng)!;
      state = answerPlacement(n.state, n.question.itemId, credit);
    }
    expect(state.answers.length).toBeLessThan(PLACEMENT_MIN_TO_PLACE);
    const { estimate, outcomes } = finishPlacement(state);
    expect(estimate).toBe(0);
    const counts = Object.values(outcomes).reduce<Record<string, number>>((m, o) => ({ ...m, [o]: (m[o] ?? 0) + 1 }), {});
    expect(counts).toEqual({ passed: 2, close: 1, aboveEstimate: 48 - 3 });
  });

  it('can be finished early with no answers: estimate 0, every item above it', () => {
    const result = finishPlacement(startPlacement(makeItems(1), mulberry32(1)));
    expect(result.estimate).toBe(0);
    expect(new Set(Object.values(result.outcomes))).toEqual(new Set(['aboveEstimate']));
  });

  it('throws a RangeError when rng returns a value outside [0, 1)', () => {
    const state = startPlacement(makeItems(1), () => 0);
    expect(() => nextQuestion(state, () => 1)).toThrow(RangeError);
    expect(() => nextQuestion(state, () => NaN)).toThrow(RangeError);
  });
});

describe('placementCredit', () => {
  it('gives full credit to a pass, half to a close miss and none to a far one', () => {
    expect(placementCredit('country', Rating.Good, 0)).toBe(1);
    expect(placementCredit('country', Rating.Easy, undefined)).toBe(1);
    expect(placementCredit('country', Rating.Hard, PLACEMENT_CLOSE_KM.country)).toBe(0.5);
    expect(placementCredit('country', Rating.Again, PLACEMENT_CLOSE_KM.country + 1)).toBe(0);
    expect(placementCredit('region', Rating.Again, PLACEMENT_CLOSE_KM.region)).toBe(0.5);
    expect(placementCredit('place', Rating.Again, PLACEMENT_CLOSE_KM.place + 1)).toBe(0);
    expect(placementCredit('country', Rating.Again, undefined)).toBe(0);
  });
});

describe('worldArea', () => {
  it('buckets points into coarse world areas', () => {
    expect(worldArea([-98, 39])).toBe('north-america');
    expect(worldArea([-55, -10])).toBe('south-america');
    expect(worldArea([10, 51])).toBe('europe');
    expect(worldArea([20, 0])).toBe('africa');
    expect(worldArea([30, 26])).toBe('africa');
    expect(worldArea([45, 24])).toBe('west-central-asia');
    expect(worldArea([67, 48])).toBe('west-central-asia');
    expect(worldArea([105, 35])).toBe('east-south-asia');
    expect(worldArea([134, -25])).toBe('oceania');
    expect(worldArea([178, -18])).toBe('oceania');
    expect(worldArea([0, -80])).toBe('oceania');
    expect(worldArea([39, 15])).toBe('africa');
    expect(worldArea([47, 15])).toBe('west-central-asia');
    expect(worldArea(null)).toBe('unknown');
  });
});

const T0 = new Date('2026-03-01T00:00:00Z');
const DAY = 86_400_000;

/** An item that has passed L3 on two different days. */
function mastered(itemId: string): ItemProgress {
  let p = createProgress(itemId, T0);
  for (let day = 0; day < 40 && p.l3PassDays.length < 2; day++) {
    const now = new Date(T0.getTime() + day * DAY);
    p = applyAnswer(p, p.rung, Rating.Good, now, localDayKey(now, 0));
  }
  expect(p.l3PassDays.length).toBeGreaterThanOrEqual(2);
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

  it('lists every country without progress, in curriculum order, at its difficulty band and area', () => {
    // france: 3 places, mean level 3; germany: 1 at level 1; tuvalu: 2, mean 4. Ranked in that
    // order and cut into 8 bands. Every fixture place sits at 0,0.
    expect(placementPool(c, {}, 'countries')).toEqual([
      { itemId: 'country:france', level: 1, area: 'africa' },
      { itemId: 'country:germany', level: 3, area: 'africa' },
      { itemId: 'country:tuvalu', level: 6, area: 'africa' },
    ]);
  });

  it('skips countries with a progress row', () => {
    const pool = placementPool(c, rows('country:germany'), 'countries');
    expect(pool.map((i) => i.itemId)).toEqual(['country:france', 'country:tuvalu']);
  });

  it('a country with a regions tier lists its regions', () => {
    expect(placementPool(c, {}, 'country:france')).toEqual([
      { itemId: 'region:france.bretagne', level: 1, area: 'africa' },
      { itemId: 'region:france.corse', level: 5, area: 'africa' },
    ]);
  });

  it('a regionless country lists its places, and a region its places', () => {
    expect(placementPool(c, {}, 'country:tuvalu').map((i) => i.itemId)).toEqual(['place:funafuti', 'place:vaitupu']);
    expect(placementPool(c, {}, 'region:france.bretagne')).toEqual([
      { itemId: 'place:rennes', level: 2, area: 'africa' },
      { itemId: 'place:brest', level: 3, area: 'africa' },
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
  const result: PlacementResult = {
    estimate: 3,
    outcomes: {
      'country:a': 'passed',
      'country:b': 'failed',
      'country:k1': 'likelyKnown',
      'country:c': 'untestedAtOrBelow',
      'country:d': 'aboveEstimate',
      'country:e': 'close',
      'country:k2': 'likelyKnown',
    },
    confidence: { 'country:k1': 0.99, 'country:k2': 0.9 },
  };

  it('seeds passed, close and untestedAtOrBelow items in outcome order, then likelyKnown ones least certain first', () => {
    const seeds = placementSeeds(result, {}, NOW, day);
    const at = (days: number) => new Date(NOW.getTime() + days * DAY);
    expect(seeds).toEqual([
      seedFromPlacement('country:a', 'passed', NOW, day),
      seedFromPlacement('country:c', 'untestedAtOrBelow', NOW, day),
      seedFromPlacement('country:e', 'close', NOW, day),
      seedFromPlacement('country:k2', 'likelyKnown', NOW, day, at(PLACEMENT_CONFIRM_START_DAYS)),
      seedFromPlacement('country:k1', 'likelyKnown', NOW, day, at(PLACEMENT_CONFIRM_START_DAYS)),
    ]);
  });

  it('spreads likelyKnown seeds over days, PLACEMENT_CONFIRM_PER_DAY a day', () => {
    const n = PLACEMENT_CONFIRM_PER_DAY * 2 + 1;
    const ids = Array.from({ length: n }, (_, i) => `country:x${String(i).padStart(2, '0')}`);
    const many: PlacementResult = {
      estimate: 6,
      outcomes: Object.fromEntries(ids.map((id) => [id, 'likelyKnown'])),
      confidence: Object.fromEntries(ids.map((id, i) => [id, 0.99 - i / 1000])),
    };
    const seeds = placementSeeds(many, {}, NOW, day);
    // Least certain (the last id) first.
    expect(seeds[0]!.itemId).toBe(ids[n - 1]);
    const dueDays = seeds.map((s) => Math.round((s.cards[3]!.due - NOW.getTime()) / DAY));
    const start = PLACEMENT_CONFIRM_START_DAYS;
    expect(dueDays).toEqual([
      ...Array(PLACEMENT_CONFIRM_PER_DAY).fill(start),
      ...Array(PLACEMENT_CONFIRM_PER_DAY).fill(start + 1),
      start + 2,
    ]);
    for (const s of seeds) {
      expect(s.rung).toBe(3);
      expect(s.l3PassDays).toEqual([]);
      expect(s.introducedAt).toBeNull();
    }
  });

  it('never seeds an item that already has progress', () => {
    const seeds = placementSeeds(result, rows('country:a', 'country:k1'), NOW, day);
    expect(seeds.map((s) => s.itemId)).toEqual(['country:c', 'country:e', 'country:k2']);
  });
});

describe('isStudied', () => {
  const DAY = '2026-03-04';
  it('is false for a fresh row and for every placement seed', () => {
    expect(isStudied(createProgress('country:a', T0))).toBe(false);
    for (const outcome of ['passed', 'close', 'likelyKnown', 'untestedAtOrBelow', 'failed', 'aboveEstimate'] as const) {
      expect(isStudied(seedFromPlacement('country:a', outcome, T0, DAY))).toBe(false);
    }
  });

  it('is true for a passed seed after one answer at rung 3, whatever the rating', () => {
    const seed = seedFromPlacement('country:a', 'passed', T0, DAY);
    expect(isStudied(applyAnswer(seed, 3, Rating.Good, T0, DAY))).toBe(true);
    expect(isStudied(applyAnswer(seed, 3, Rating.Again, T0, DAY))).toBe(true);
  });

  it('is true for an untestedAtOrBelow seed after one answer', () => {
    const seed = seedFromPlacement('country:a', 'untestedAtOrBelow', T0, DAY);
    expect(isStudied(applyAnswer(seed, 2, Rating.Good, T0, DAY))).toBe(true);
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
    const studied = applyAnswer(seed, 3, Rating.Good, T0, '2026-03-04');
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
