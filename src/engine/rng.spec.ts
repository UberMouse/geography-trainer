import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng';

describe('[GRD-26] mulberry32', () => {
  it('repeats for the same seed and differs between seeds', () => {
    const take = (seed: number) => {
      const r = mulberry32(seed);
      return Array.from({ length: 5 }, () => r());
    };
    expect(take(42)).toEqual(take(42));
    expect(take(42)).not.toEqual(take(43));
  });

  it('stays in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
