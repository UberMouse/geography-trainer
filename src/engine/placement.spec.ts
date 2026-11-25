import { Rating, type Grade } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { PLACEMENT_MAX_QUESTIONS, PLACEMENT_START_LEVEL } from './config';
import {
  answerPlacement,
  finishPlacement,
  nextQuestion,
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
    it(`converges within 1 of skill level ${k}`, () => {
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const { result, asked } = run(items, seed, (level) => level <= k);
        expect(Math.abs(result.estimate - k), `k=${k} seed=${seed} estimate=${result.estimate}`).toBeLessThanOrEqual(1);
        expect(asked.length).toBeLessThanOrEqual(PLACEMENT_MAX_QUESTIONS);
      }
    });
  }

  it('puts a perfect user near 8 and a hopeless one near 1', () => {
    for (const seed of [1, 2, 3]) {
      expect(run(makeItems(40), seed, () => true).result.estimate).toBeGreaterThanOrEqual(7);
      expect(run(makeItems(40), seed, () => false).result.estimate).toBeLessThanOrEqual(2);
    }
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

  it('never asks items with a non-finite level, and returns null when none are left', () => {
    const rng = mulberry32(5);
    const s = startPlacement([{ itemId: 'x', level: Infinity }], rng);
    expect(nextQuestion(s, rng)).toBeNull();
    expect(finishPlacement(s).outcomes).toEqual({ x: 'aboveEstimate' });
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
    // Targets 4 (pass) -> 5 (fail: reversal at 5) -> 4 (fail), so the estimate is 5.
    answer('p1', Rating.Easy);
    answer('f1', Rating.Hard);
    answer('f2', Rating.Again);
    const { estimate, outcomes } = finishPlacement(s);
    expect(estimate).toBe(5);
    expect(outcomes).toEqual({
      p1: 'passed',
      f1: 'untestedAtOrBelow',
      f2: 'untestedAtOrBelow',
      u1: 'untestedAtOrBelow',
      u2: 'aboveEstimate',
    });
  });

  it('can be finished early with no answers', () => {
    const rng = mulberry32(1);
    const { estimate, outcomes } = finishPlacement(startPlacement(makeItems(1), rng));
    expect(estimate).toBe(PLACEMENT_START_LEVEL);
    expect(outcomes['i7']).toBe('aboveEstimate');
    expect(outcomes['i0']).toBe('untestedAtOrBelow');
  });
});
