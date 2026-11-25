import { describe, expect, it } from 'vitest';
import { multipleChoice, pickDistractors } from './distractors';
import { mulberry32 } from './rng';

// Points along the equator: distance from the target (id "t", lng 0) grows with lng.
const target = { id: 't', lat: 0, lng: 0 };
const line = Array.from({ length: 12 }, (_, i) => ({
  id: `c${String(i).padStart(2, '0')}`,
  lat: 0,
  lng: i + 1,
}));
const nearest6 = line.slice(0, 6).map((c) => c.id);

describe('pickDistractors', () => {
  it('returns 3 distinct ids from the 6 nearest, never the target', () => {
    for (let seed = 0; seed < 50; seed++) {
      const out = pickDistractors(target, [{ ...target }, ...line], mulberry32(seed));
      expect(out).toHaveLength(3);
      expect(new Set(out).size).toBe(3);
      expect(out).not.toContain('t');
      for (const id of out) expect(nearest6).toContain(id);
    }
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const run = (seed: number) => pickDistractors(target, line, mulberry32(seed));
    expect(run(5)).toEqual(run(5));
    expect(new Set(Array.from({ length: 30 }, (_, s) => run(s).join())).size).toBeGreaterThan(1);
  });

  it('breaks distance ties by id', () => {
    const tied = ['b', 'a', 'd', 'c'].map((id) => ({ id, lat: 0, lng: 1 }));
    // With count 1 the pool is the two lowest ids.
    for (let seed = 0; seed < 20; seed++) {
      expect(['a', 'b']).toContain(pickDistractors(target, tied, mulberry32(seed), 1)[0]);
    }
  });

  it('honours count', () => {
    expect(pickDistractors(target, line, mulberry32(1), 5)).toHaveLength(5);
  });

  it('returns all candidates when there are fewer than count', () => {
    expect(pickDistractors(target, line.slice(0, 2), mulberry32(1)).sort()).toEqual(['c00', 'c01']);
    expect(pickDistractors(target, [], mulberry32(1))).toEqual([]);
  });
});

describe('multipleChoice', () => {
  it('contains the target and distractors exactly once, deterministic per seed', () => {
    const out = multipleChoice('t', ['a', 'b', 'c'], mulberry32(9));
    expect([...out].sort()).toEqual(['a', 'b', 'c', 't']);
    expect(multipleChoice('t', ['a', 'b', 'c'], mulberry32(9))).toEqual(out);
  });

  it('puts the target in every position across seeds', () => {
    const positions = new Set<number>();
    for (let s = 0; s < 100; s++) {
      positions.add(multipleChoice('t', ['a', 'b', 'c'], mulberry32(s)).indexOf('t'));
    }
    expect(positions.size).toBe(4);
  });
});
