import { describe, expect, it } from 'vitest';
import {
  countryOptions,
  progressFill,
  startedCountries,
  tierCountText,
  type CountryLook,
} from './progressView';

describe('progressFill', () => {
  it('uses the state colour for locked, new and learning', () => {
    for (const state of ['locked', 'new', 'learning'] as const) {
      expect(progressFill(state, { total: 10, mastered: 5 })).toBe(`var(--progress-${state})`);
    }
  });

  it('mixes a mastered item by the share of its mastered descendants', () => {
    expect(progressFill('mastered', { total: 4, mastered: 1 })).toBe(
      'color-mix(in oklab, var(--progress-complete) 25%, var(--progress-mastered))',
    );
    expect(progressFill('mastered', { total: 4, mastered: 0 })).toContain('complete) 0%');
    expect(progressFill('mastered', { total: 4, mastered: 4 })).toContain('complete) 100%');
  });

  it('gives a mastered item with no descendants the complete colour', () => {
    expect(progressFill('mastered', { total: 0, mastered: 0 })).toBe('var(--progress-complete)');
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
