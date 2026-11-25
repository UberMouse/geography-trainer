import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { gradeMultipleChoice, gradeTap, maptapScore, maptapScoreRaw, type TapInput } from './grading';

describe('maptapScore', () => {
  it('is 100 at 0 km', () => expect(maptapScore(0)).toBe(100));
  it('is about 81 at 1000 km', () => expect(maptapScore(1000)).toBe(81));
  it('is at least 99.5 unrounded at 23 km', () =>
    expect(maptapScoreRaw(23)).toBeGreaterThanOrEqual(99.5));
  it('is 100 when inside whatever the km', () => {
    expect(maptapScore(5000, true)).toBe(100);
    expect(maptapScore(Infinity, true)).toBe(100);
  });
  it('clamps to 0 at 16,250 km and beyond', () => {
    expect(maptapScore(16_249)).toBe(3);
    expect(maptapScore(16_250)).toBe(0);
    expect(maptapScore(20_000)).toBe(0);
  });
  it('throws on negative or NaN km', () => {
    expect(() => maptapScore(-1)).toThrow(RangeError);
    expect(() => maptapScore(NaN)).toThrow(RangeError);
  });
});

describe('gradeMultipleChoice', () => {
  it('wrong is Again at any speed', () => {
    expect(gradeMultipleChoice(false, 0)).toBe(Rating.Again);
    expect(gradeMultipleChoice(false, 50_000)).toBe(Rating.Again);
  });
  it('grades correct answers by speed, both sides of each boundary', () => {
    expect(gradeMultipleChoice(true, 3_999)).toBe(Rating.Easy);
    expect(gradeMultipleChoice(true, 4_000)).toBe(Rating.Good);
    expect(gradeMultipleChoice(true, 12_000)).toBe(Rating.Good);
    expect(gradeMultipleChoice(true, 12_001)).toBe(Rating.Hard);
  });
  it('throws on negative or NaN time', () => {
    expect(() => gradeMultipleChoice(true, -1)).toThrow(RangeError);
    expect(() => gradeMultipleChoice(true, NaN)).toThrow(RangeError);
  });
});

describe('gradeTap', () => {
  const base: TapInput = {
    tier: 'country',
    inside: true,
    kmFromAnswer: 100,
    kmOutsideBorder: 0,
    featureSizeKm: 1000,
  };

  it.each(['country', 'region'] as const)('%s inside: Easy at 25% of size, Good just past', (tier) => {
    expect(gradeTap({ ...base, tier, kmFromAnswer: 250 })).toBe(Rating.Easy);
    expect(gradeTap({ ...base, tier, kmFromAnswer: 250.1 })).toBe(Rating.Good);
  });
  it('inside ignores kmOutsideBorder', () => {
    expect(gradeTap({ ...base, kmFromAnswer: 900, kmOutsideBorder: 99_999 })).toBe(Rating.Good);
  });
  it('featureSizeKm <= 0 never gives Easy', () => {
    expect(gradeTap({ ...base, kmFromAnswer: 0, featureSizeKm: 0 })).toBe(Rating.Good);
    expect(gradeTap({ ...base, kmFromAnswer: 0, featureSizeKm: -5 })).toBe(Rating.Good);
  });
  it('country outside: Hard to 150 km from the border, else Again', () => {
    const out = { ...base, inside: false };
    expect(gradeTap({ ...out, kmOutsideBorder: 150 })).toBe(Rating.Hard);
    expect(gradeTap({ ...out, kmOutsideBorder: 150.1 })).toBe(Rating.Again);
  });
  it('region outside: Hard to 50 km from the border, else Again', () => {
    const out = { ...base, tier: 'region' as const, inside: false };
    expect(gradeTap({ ...out, kmOutsideBorder: 50 })).toBe(Rating.Hard);
    expect(gradeTap({ ...out, kmOutsideBorder: 50.1 })).toBe(Rating.Again);
  });
  it('place: thresholds on kmFromAnswer, inside and border ignored', () => {
    const place = { ...base, tier: 'place' as const, inside: false, kmOutsideBorder: 0 };
    const at = (km: number) => gradeTap({ ...place, kmFromAnswer: km });
    expect(at(24.9)).toBe(Rating.Easy);
    expect(at(25)).toBe(Rating.Good);
    expect(at(74.9)).toBe(Rating.Good);
    expect(at(75)).toBe(Rating.Hard);
    expect(at(199.9)).toBe(Rating.Hard);
    expect(at(200)).toBe(Rating.Again);
    expect(gradeTap({ ...place, inside: true, kmFromAnswer: 500 })).toBe(Rating.Again);
  });
});
