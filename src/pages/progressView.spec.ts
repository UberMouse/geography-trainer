import { describe, expect, it } from 'vitest';
import {
  countryOptions,
  mixOklab,
  PROGRESS_COLOURS,
  progressFill,
  startedCountries,
  tierCountText,
  type CountryLook,
} from './progressView';

describe('progressFill', () => {
  it('uses the state colour for locked, new and learning', () => {
    for (const state of ['locked', 'new', 'learning'] as const) {
      expect(progressFill(state, { total: 10, mastered: 5 })).toBe(PROGRESS_COLOURS[state]);
    }
  });

  it('mixes a mastered item by the share of its mastered descendants', () => {
    expect(progressFill('mastered', { total: 4, mastered: 1 })).toBe(
      mixOklab(PROGRESS_COLOURS.mastered, PROGRESS_COLOURS.complete, 0.25),
    );
    expect(progressFill('mastered', { total: 4, mastered: 0 })).toBe(PROGRESS_COLOURS.mastered);
    expect(progressFill('mastered', { total: 4, mastered: 4 })).toBe(PROGRESS_COLOURS.complete);
  });

  it('gives a mastered item with no descendants the complete colour', () => {
    expect(progressFill('mastered', { total: 0, mastered: 0 })).toBe(PROGRESS_COLOURS.complete);
  });
});

describe('mixOklab', () => {
  it('gives each end unchanged', () => {
    expect(mixOklab('#4d8f63', '#4ade80', 0)).toBe('#4d8f63');
    expect(mixOklab('#4d8f63', '#4ade80', 1)).toBe('#4ade80');
  });

  it('mixes by lightness in Oklab, not by sRGB channel', () => {
    // Halfway from black to white is Oklab lightness 0.5: sRGB 99, not the channel midpoint 128.
    expect(mixOklab('#000000', '#ffffff', 0.5)).toBe('#636363');
  });
});

describe('startedCountries', () => {
  const country = (id: string, name: string) => ({ id, name, places: 1, hasRegions: false });
  const countries = [
    country('c', 'Chad'),
    country('a', 'Albania'),
    country('b', 'Brazil'),
    country('d', 'Denmark'),
  ];
  const look = (state: CountryLook['state']): CountryLook => ({ state, fill: '' });

  it('keeps learning and mastered countries, alphabetical by name', () => {
    const looks = new Map([
      ['c', look('mastered')],
      ['a', look('learning')],
      ['b', look('new')],
      ['d', look('locked')],
    ]);
    expect(startedCountries(countries, looks).map((s) => [s.country.name, s.state])).toEqual([
      ['Albania', 'learning'],
      ['Chad', 'mastered'],
    ]);
  });

  it('is empty when nothing is started or a country has no look', () => {
    expect(startedCountries(countries, new Map([['a', look('new')]]))).toEqual([]);
  });
});

describe('tierCountText', () => {
  it('words the counts and pluralises the tier name', () => {
    expect(tierCountText('country', { total: 243, learning: 5, learned: 12 })).toBe(
      'Countries: 12 learned, 5 learning of 243',
    );
    expect(tierCountText('region', { total: 1, learning: 0, learned: 0 })).toBe(
      'Region: 0 learned, 0 learning of 1',
    );
  });
});

describe('countryOptions', () => {
  it('lists every country, alphabetical by name, as id and name only', () => {
    const country = (id: string, name: string) => ({ id, name, places: 1, hasRegions: false });
    expect(
      countryOptions([country('c', 'Chad'), country('a', 'Albania'), country('b', 'Brazil')]),
    ).toEqual([
      { id: 'a', name: 'Albania' },
      { id: 'b', name: 'Brazil' },
      { id: 'c', name: 'Chad' },
    ]);
  });
});
