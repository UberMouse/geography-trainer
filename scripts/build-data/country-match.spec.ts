import { describe, expect, it } from 'vitest';
import { type Override, matchCountries, resolveBorderCountry } from './country-match';
import { polygonCountry, unit } from './fixtures/geometry';
import { normalizeName, slugify } from './normalize';

const UNITS = [
  unit('CIV', "Côte d'Ivoire", [0, 0], { NAME_LONG: "Republic of Cote d'Ivoire" }),
  unit('TCA', 'Turks and Caicos Is.', [2, 0], { NAME_LONG: 'Turks and Caicos Islands' }),
  unit('GNB', 'Guinea-Bissau', [4, 0]),
  unit('TUR', 'Turkey', [6, 0]),
  unit('ENG', 'England', [8, 0], { ADMIN: 'United Kingdom', adm0: 'GBR' }),
  unit('SCT', 'Scotland', [8, 2], { ADMIN: 'United Kingdom', adm0: 'GBR' }),
  unit('GIB', 'Gibraltar', [10, 0]),
  unit('WSB', 'Akrotiri', [12, 0]),
  unit('ESB', 'Dhekelia', [14, 0]),
  unit('FXX', 'France', [16, 0], { ADMIN: 'France', adm0: 'FRA' }),
  unit('GUF', 'French Guiana', [18, 0], { ADMIN: 'France', adm0: 'FRA' }),
];
const SUBUNITS = [
  { ...unit('SHS', 'St. Helena', [20, 0], { adm0: 'SHN' }), guA3: 'SHN' },
  { ...unit('BAC', 'Ascension', [22, 0], { adm0: 'SHN' }), guA3: 'SHN' },
];

const match = (names: string[], overrides: Record<string, Override> = {}) =>
  matchCountries(names, UNITS, SUBUNITS, overrides);

describe('normalizeName and slugify', () => {
  it('ignore case, diacritics, & versus and, and punctuation', () => {
    expect(normalizeName("Côte d'Ivoire")).toBe('cote d ivoire');
    expect(normalizeName('Turks & Caicos')).toBe(normalizeName('turks and caicos'));
    expect(slugify('Türkiye')).toBe('turkiye');
    expect(slugify('Georgia (Country)')).toBe('georgia-country');
    expect(slugify('Łódź Ø')).toBe('lodz-o');
  });
});

describe('matchCountries', () => {
  it('matches by normalized name across diacritics and punctuation', () => {
    const { countries } = match(["Cote d'Ivoire", 'Guinea Bissau', 'Turks & Caicos Islands']);
    expect(countries.map((c) => [c.id, c.ne, c.how])).toEqual([
      ['cote-d-ivoire', ['CIV'], 'name'],
      ['guinea-bissau', ['GNB'], 'name'],
      ['turks-and-caicos-islands', ['TCA'], 'name'],
    ]);
  });

  it('takes the UK nations from their own map units, not the ADMIN-level name', () => {
    const { countries } = match(['England', 'Scotland', 'United Kingdom'], {
      'United Kingdom': { kind: 'units', codes: ['GIB', 'WSB', 'ESB'] },
    });
    expect(countries.map((c) => [c.id, c.ne])).toEqual([
      ['england', ['ENG']],
      ['scotland', ['SCT']],
      ['united-kingdom', ['ESB', 'GIB', 'WSB']],
    ]);
    const uk = countries.find((c) => c.id === 'united-kingdom')!;
    expect(uk.how).toBe('override');
    expect(uk.area?.type === 'MultiPolygon' && uk.area.coordinates).toHaveLength(3);
  });

  it('applies a single-unit override', () => {
    const { countries } = match(['Türkiye'], { Türkiye: { kind: 'units', codes: ['TUR'] } });
    expect(countries).toMatchObject([{ id: 'turkiye', name: 'Türkiye', ne: ['TUR'] }]);
  });

  it('unions every map unit sharing an ADMIN name', () => {
    const { countries } = match(['France']);
    expect(countries[0]!.ne).toEqual(['FXX', 'GUF']);
  });

  it('gives point-only countries a circle and no geometry', () => {
    const { countries } = match(['Saba'], {
      Saba: { kind: 'point', lng: -63.2, lat: 17.6, radiusKm: 4 },
    });
    expect(countries).toMatchObject([
      { id: 'saba', ne: [], area: null, point: { lng: -63.2, lat: 17.6, radiusKm: 4 } },
    ]);
  });

  it('lists explicit exclusions with their reason', () => {
    const result = match(['England', 'Pacific Ocean'], {
      'Pacific Ocean': { kind: 'exclude', reason: 'open ocean' },
    });
    expect(result.countries.map((c) => c.id)).toEqual(['england']);
    expect(result.excluded).toEqual([{ name: 'Pacific Ocean', reason: 'open ocean' }]);
  });

  it('fails listing every unmatched name', () => {
    expect(() => match(['England', 'Atlantis', 'Lemuria'])).toThrow(
      /2 maptap countries match no Natural Earth unit.*"Atlantis", "Lemuria"/,
    );
  });

  it('fails when two countries share a unit', () => {
    expect(() =>
      match(['England', 'Albion'], { Albion: { kind: 'units', codes: ['ENG'] } }),
    ).toThrow(/"Albion" and "England" share Natural Earth unit\(s\) ENG/);
  });

  it('lets two countries use different subunits of one geounit', () => {
    const { countries } = match(['Ascension Island', 'Saint Helena'], {
      'Ascension Island': { kind: 'units', codes: ['BAC'], subunits: true },
      'Saint Helena': { kind: 'units', codes: ['SHS'], subunits: true },
    });
    expect(countries.map((c) => c.ne)).toEqual([['BAC'], ['SHS']]);
  });

  it('fails on an override naming an unknown unit', () => {
    expect(() => match(['X'], { X: { kind: 'units', codes: ['NOPE'] } })).toThrow(
      /no NE unit NOPE/,
    );
  });
});

describe('resolveBorderCountry', () => {
  const a = polygonCountry('a', [0, 0]);
  const b = polygonCountry('b', [1, 0]);
  const point = {
    ...polygonCountry('p', [0, 5]),
    area: null,
    box: null,
    point: { lng: 1.5, lat: 1.5, radiusKm: 500 },
  };

  const c = polygonCountry('c', [2, 0]);
  const all = [a, b, c, point];

  it('picks the named polygon containing the point', () => {
    expect(resolveBorderCountry(all, 'a/b', 1.6, 0.5).id).toBe('b');
  });

  it('trims spaces around the slash', () => {
    expect(resolveBorderCountry(all, 'a / b', 1.6, 0.5).id).toBe('b');
  });

  it('otherwise picks the nearest named polygon', () => {
    expect(resolveBorderCountry(all, 'a/b', 1.5, 1.2).id).toBe('b');
    expect(resolveBorderCountry(all, 'a/b', -0.3, 0.5).id).toBe('a');
  });

  it('ignores an unnamed country even when its polygon holds the point', () => {
    expect(resolveBorderCountry(all, 'a/b', 2.5, 0.5).id).toBe('b');
  });

  it('maps name parts through the aliases', () => {
    expect(resolveBorderCountry(all, 'A/c', 0.5, 0.5, { A: 'a' }).id).toBe('a');
  });

  it('fails on a part that names no polygon country', () => {
    expect(() => resolveBorderCountry(all, 'a/USA', 0.5, 0.5)).toThrow(
      'border place "a/USA": "USA" names no polygon country',
    );
    expect(() => resolveBorderCountry(all, 'a/p', 0.5, 0.5)).toThrow(
      '"p" names no polygon country',
    );
  });
});
