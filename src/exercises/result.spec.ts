import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { DATA } from './fixtures';
import { buildExerciseItem } from './item';
import { choiceResult, formatKm, tapResult } from './result';

const KM_PER_DEG = (Math.PI * 6371) / 180;

describe('choiceResult', () => {
  const item = buildExerciseItem('country:beta', DATA);

  it('is correct when the item is chosen, graded by speed', () => {
    expect(choiceResult(item, 'country:beta', 1000)).toEqual({
      rating: Rating.Easy,
      correct: true,
      timeMs: 1000,
    });
    expect(choiceResult(item, 'country:beta', 20_000).rating).toBe(Rating.Hard);
  });

  it('is incorrect (Again) for another option, with no km or score', () => {
    expect(choiceResult(item, 'country:alpha', 1000)).toEqual({
      rating: Rating.Again,
      correct: false,
      timeMs: 1000,
    });
  });
});

describe('tapResult on a country', () => {
  const item = buildExerciseItem('country:beta', DATA);

  it('is correct inside, 0 km off, maptap 100', () => {
    expect(tapResult(item, [25, 45], 500)).toEqual({
      rating: Rating.Easy,
      correct: true,
      timeMs: 500,
      km: 0,
      maptapScore: 100,
    });
  });

  it('is an incorrect Hard for a near miss, with km to the border', () => {
    // 1° east of the east border at 45°N: ~79 km, inside the 150 km near miss.
    const r = tapResult(item, [31, 45], 500);
    expect(r).toMatchObject({ rating: Rating.Hard, correct: false });
    expect(r.km).toBeCloseTo(KM_PER_DEG * Math.cos((45 * Math.PI) / 180), -1);
    expect(r.maptapScore).toBeLessThan(100);
  });

  it('is an incorrect Again far away', () => {
    expect(tapResult(item, [-100, 0], 500)).toMatchObject({ rating: Rating.Again, correct: false });
  });
});

describe('tapResult on a place', () => {
  const item = buildExerciseItem('place:b1', DATA);

  it('measures km from the point', () => {
    const r = tapResult(item, [22, 45.5], 500);
    expect(r.km).toBeCloseTo(KM_PER_DEG * 0.5, 0);
    expect(r).toMatchObject({ rating: Rating.Good, correct: true });
    // round(100 · exp(-3.5 · 55.6 / 16250)) = round(98.8)
    expect(r.maptapScore).toBe(99);
  });
});

describe('formatKm', () => {
  it('rounds to one decimal before choosing the format', () => {
    expect(formatKm(9.97)).toBe('10');
    expect(formatKm(9.94)).toBe('9.9');
    expect(formatKm(0)).toBe('0.0');
    expect(formatKm(1234.4)).toBe('1,234');
  });
});
