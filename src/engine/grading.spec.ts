import { describe, expect, it } from 'vitest';
import { Rating, type Grade } from 'ts-fsrs';
import {
  COUNTRY_NEAR_MISS_KM,
  MAPTAP_SCORE_DECAY,
  MAPTAP_SCORE_KM,
  MC_FAST_MS,
  MC_SLOW_MS,
  PLACE_EASY_KM,
  PLACE_GOOD_KM,
  PLACE_HARD_KM,
  REGION_NEAR_MISS_KM,
  TAP_EASY_FRACTION,
} from './config';
import {
  gradeMultipleChoice,
  gradeTap,
  isPass,
  maptapScore,
  maptapScoreRaw,
  type TapInput,
} from './grading';

describe('[GRD-01] isPass', () => {
  it('passes Good and Easy, not Hard or Again', () => {
    expect([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy].map(isPass)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });
});

describe('[GRD-07] maptapScore', () => {
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

describe('[GRD-02] gradeMultipleChoice', () => {
  it('wrong is Again at any speed', () => {
    expect(gradeMultipleChoice(false, 0)).toBe(Rating.Again);
    expect(gradeMultipleChoice(false, 50_000)).toBe(Rating.Again);
  });
  it('[GRD-C02] grades correct answers by speed, both sides of each boundary', () => {
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

  it.each(['country', 'region'] as const)('[GRD-03, GRD-C03] %s inside: Easy at 25% of size, Good just past', (tier) => {
    expect(gradeTap({ ...base, tier, kmFromAnswer: 250 })).toBe(Rating.Easy);
    expect(gradeTap({ ...base, tier, kmFromAnswer: 250.1 })).toBe(Rating.Good);
  });
  it('[GRD-03] inside ignores kmOutsideBorder', () => {
    expect(gradeTap({ ...base, kmFromAnswer: 900, kmOutsideBorder: 99_999 })).toBe(Rating.Good);
  });
  it('[GRD-03, GRD-C04] featureSizeKm <= 0 never gives Easy', () => {
    expect(gradeTap({ ...base, kmFromAnswer: 0, featureSizeKm: 0 })).toBe(Rating.Good);
    expect(gradeTap({ ...base, kmFromAnswer: 0, featureSizeKm: -5 })).toBe(Rating.Good);
  });
  it('[GRD-04, GRD-C03] country outside: Hard to 150 km from the border, else Again', () => {
    const out = { ...base, inside: false };
    expect(gradeTap({ ...out, kmOutsideBorder: 150 })).toBe(Rating.Hard);
    expect(gradeTap({ ...out, kmOutsideBorder: 150.1 })).toBe(Rating.Again);
  });
  it('[GRD-04, GRD-C03] region outside: Hard to 50 km from the border, else Again', () => {
    const out = { ...base, tier: 'region' as const, inside: false };
    expect(gradeTap({ ...out, kmOutsideBorder: 50 })).toBe(Rating.Hard);
    expect(gradeTap({ ...out, kmOutsideBorder: 50.1 })).toBe(Rating.Again);
  });
  it('[GRD-05, GRD-C03] place: thresholds on kmFromAnswer, inside and border ignored', () => {
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
  describe('[GRD-06, GRD-C04] bad input throws RangeError for the distances the branch uses', () => {
    it('place: NaN or negative kmFromAnswer', () => {
      const place = { ...base, tier: 'place' as const };
      expect(() => gradeTap({ ...place, kmFromAnswer: NaN })).toThrow(RangeError);
      expect(() => gradeTap({ ...place, kmFromAnswer: -1 })).toThrow(RangeError);
    });
    it('inside: NaN or negative kmFromAnswer, NaN featureSizeKm', () => {
      expect(() => gradeTap({ ...base, kmFromAnswer: NaN })).toThrow(RangeError);
      expect(() => gradeTap({ ...base, kmFromAnswer: -1 })).toThrow(RangeError);
      expect(() => gradeTap({ ...base, featureSizeKm: NaN })).toThrow(RangeError);
    });
    it('outside: NaN or negative kmOutsideBorder', () => {
      const out = { ...base, inside: false };
      expect(() => gradeTap({ ...out, kmOutsideBorder: NaN })).toThrow(RangeError);
      expect(() => gradeTap({ ...out, kmOutsideBorder: -1 })).toThrow(RangeError);
    });
    it('a field the branch ignores may be NaN; Infinity is valid', () => {
      expect(gradeTap({ ...base, kmOutsideBorder: NaN })).toBe(Rating.Easy);
      expect(gradeTap({ ...base, tier: 'place', kmFromAnswer: Infinity })).toBe(Rating.Again);
      expect(gradeTap({ ...base, inside: false, kmOutsideBorder: Infinity })).toBe(Rating.Again);
    });
  });
});

describe('[GRD-C01] rating values', () => {
  it('Again, Hard, Good and Easy are 1 to 4, and only Good and Easy pass', () => {
    expect([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]).toEqual([1, 2, 3, 4]);
    expect(([1, 2, 3, 4] as Grade[]).map(isPass)).toEqual([false, false, true, true]);
  });
});

describe('grading constants', () => {
  it('[GRD-C02] multiple-choice speed thresholds', () => {
    expect({ MC_FAST_MS, MC_SLOW_MS }).toEqual({ MC_FAST_MS: 4_000, MC_SLOW_MS: 12_000 });
  });
  it('[GRD-C03] tap thresholds', () => {
    expect({
      TAP_EASY_FRACTION,
      COUNTRY_NEAR_MISS_KM,
      REGION_NEAR_MISS_KM,
      PLACE_EASY_KM,
      PLACE_GOOD_KM,
      PLACE_HARD_KM,
    }).toEqual({
      TAP_EASY_FRACTION: 0.25,
      COUNTRY_NEAR_MISS_KM: 150,
      REGION_NEAR_MISS_KM: 50,
      PLACE_EASY_KM: 25,
      PLACE_GOOD_KM: 75,
      PLACE_HARD_KM: 200,
    });
  });
});

describe('[GRD-C05] maptap score formula', () => {
  it('uses 16,250 km and a decay of 3.5', () => {
    expect({ MAPTAP_SCORE_KM, MAPTAP_SCORE_DECAY }).toEqual({
      MAPTAP_SCORE_KM: 16_250,
      MAPTAP_SCORE_DECAY: 3.5,
    });
  });
  it('is 100 · exp(-3.5 · km / 16250) unrounded, and the score rounds it', () => {
    for (const km of [0, 1, 489, 3218, 8000, 16_000]) {
      expect(maptapScoreRaw(km)).toBeCloseTo(100 * Math.exp((-3.5 * km) / 16_250), 10);
      expect(maptapScore(km)).toBe(Math.round(maptapScoreRaw(km)));
    }
    expect(maptapScore(489)).toBe(90);
    expect(maptapScore(3218)).toBe(50);
  });
  it('returns 100 inside before looking at km', () => {
    expect(maptapScoreRaw(NaN, true)).toBe(100);
    expect(maptapScore(-1, true)).toBe(100);
  });
});

describe('[GRD-03] a region tap inside, far from the answer point', () => {
  it('is Good', () => {
    expect(
      gradeTap({ tier: 'region', inside: true, kmFromAnswer: 900, kmOutsideBorder: 0, featureSizeKm: 1000 }),
    ).toBe(Rating.Good);
  });
});
