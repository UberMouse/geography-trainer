import { describe, expect, it } from 'vitest';
import { buildCurriculum, countryItemId, placeItemId } from '../engine/curriculum';
import type { ItemProgress } from '../engine/srs';
import type { Country, Place } from '../engine/types';
import {
  countryLooks,
  countryOptions,
  itemLook,
  lookOrLocked,
  mixOklab,
  PROGRESS_COLOURS,
  progressFill,
  startedCountries,
  tierCountText,
  type CountryLook,
} from './progressView';

describe('[SCR-10, SCR-C01, SCR-C07] progressFill', () => {
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

describe('[SCR-C01] mixOklab', () => {
  it('gives each end unchanged', () => {
    expect(mixOklab('#4d8f63', '#4ade80', 0)).toBe('#4d8f63');
    expect(mixOklab('#4d8f63', '#4ade80', 1)).toBe('#4ade80');
  });

  it('mixes by lightness in Oklab, not by sRGB channel', () => {
    // Halfway from black to white is Oklab lightness 0.5: sRGB 99, not the channel midpoint 128.
    expect(mixOklab('#000000', '#ffffff', 0.5)).toBe('#636363');
  });

  it("matches Chromium's color-mix(in oklab, …) between hues", () => {
    // Read off Chromium: `color-mix(in oklab, <to> <share>, <from>)` drawn to a canvas pixel.
    expect(mixOklab('#4d8f63', '#4ade80', 0.5)).toBe('#4eb672');
    expect(mixOklab('#4d8f63', '#4ade80', 0.25)).toBe('#4ea26a');
    expect(mixOklab('#a16207', '#4ade80', 0.5)).toBe('#8fa14c');
  });
});

describe('[SCR-12, SCR-C07] startedCountries', () => {
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

describe('[SCR-09, SCR-C07] tierCountText', () => {
  it('words the counts and pluralises the tier name', () => {
    expect(tierCountText('country', { total: 243, learning: 5, learned: 12 })).toBe(
      'Countries: 12 learned, 5 learning of 243',
    );
    expect(tierCountText('region', { total: 1, learning: 0, learned: 0 })).toBe(
      'Region: 0 learned, 0 learning of 1',
    );
  });
});

describe('[SCR-11, SCR-C07] countryOptions', () => {
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

describe('[SCR-C01] PROGRESS_COLOURS', () => {
  it('has the spec’s colours', () => {
    expect(PROGRESS_COLOURS).toEqual({
      locked: '#404040',
      new: '#7d8fbf',
      learning: '#ea580c',
      mastered: '#4d8f63',
      complete: '#4ade80',
    });
  });

  it('rounds the share of mastered descendants to hundredths', () => {
    // 1/3 rounds to 0.33, 1/300 to 0.
    expect(progressFill('mastered', { total: 3, mastered: 1 })).toBe(
      mixOklab(PROGRESS_COLOURS.mastered, PROGRESS_COLOURS.complete, 0.33),
    );
    expect(progressFill('mastered', { total: 300, mastered: 1 })).toBe(PROGRESS_COLOURS.mastered);
  });
});

describe('[SCR-06, SCR-10, SCR-C07] the looks of items and countries', () => {
  const countries: Country[] = [
    { id: 'fr', name: 'France', places: 2, hasRegions: false },
    { id: 'pe', name: 'Peru', places: 1, hasRegions: false },
  ];
  const place = (id: string, country: string): Place => ({
    id,
    name: id,
    country,
    region: null,
    lat: 0,
    lng: 0,
    type: 'city',
    level: 1,
  });
  const curriculum = buildCurriculum(countries, [], [
    place('paris', 'fr'),
    place('lyon', 'fr'),
    place('lima', 'pe'),
  ]);
  // Mastered: L3 passed on two different days.
  const mastered = (itemId: string): ItemProgress =>
    ({
      itemId,
      rung: 3,
      highestRung: 3,
      cards: {},
      l3PassDays: ['2026-01-10', '2026-01-20'],
      inL3Lapse: false,
      introducedAt: 1,
    }) as unknown as ItemProgress;
  const fr = countryItemId('fr');
  const paris = placeItemId('paris');

  it('gives each state its colour, and deepens a mastered country by its mastered places', () => {
    expect(itemLook(curriculum, {}, fr)).toEqual({ state: 'new', fill: PROGRESS_COLOURS.new });
    expect(itemLook(curriculum, {}, paris)).toEqual({ state: 'locked', fill: PROGRESS_COLOURS.locked });
    expect(itemLook(curriculum, { [fr]: mastered(fr), [paris]: mastered(paris) }, fr)).toEqual({
      state: 'mastered',
      fill: mixOklab(PROGRESS_COLOURS.mastered, PROGRESS_COLOURS.complete, 0.5),
    });
  });

  it('has a look per curriculum country, and a feature without one reads as locked', () => {
    const extra: Country = { id: 'xx', name: 'X', places: 0, hasRegions: false };
    const looks = countryLooks(curriculum, { [fr]: mastered(fr) }, [...countries, extra]);
    expect([...looks.keys()]).toEqual(['fr', 'pe']);
    expect(looks.get('fr')).toEqual({ state: 'mastered', fill: PROGRESS_COLOURS.mastered });
    expect(lookOrLocked(looks)('pe')).toEqual({ state: 'new', fill: PROGRESS_COLOURS.new });
    expect(lookOrLocked(looks)('xx')).toEqual({ state: 'locked', fill: PROGRESS_COLOURS.locked });
  });
});
