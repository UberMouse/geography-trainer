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

describe('[GRD-C12] mulberry32 sequence', () => {
  it.each([
    [0, [0.26642920868471265, 0.0003297457005828619, 0.2232720274478197]],
    [42, [0.6011037519201636, 0.44829055899754167, 0.8524657934904099]],
  ])('seed %i starts with the pinned outputs', (seed, outputs) => {
    const r = mulberry32(seed);
    expect([r(), r(), r()]).toEqual(outputs);
  });
});
