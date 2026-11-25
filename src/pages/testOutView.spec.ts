import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { buildCurriculum } from '../engine/curriculum';
import { applyAnswer, createProgress, localDayKey, type ItemProgress } from '../engine/srs';
import type { Country, Place, Region } from '../engine/types';
import { resolveTestOutRoute, testOutLabel, testOutPath } from './testOutView';

const T0 = new Date('2026-01-01T12:00:00Z');
const DAY = 86_400_000;

function mastered(itemId: string): ItemProgress {
  let p = createProgress(itemId, T0);
  for (let day = 0; day < 40 && p.l4PassDays.length < 2; day++) {
    const now = new Date(T0.getTime() + day * DAY);
    p = applyAnswer(p, p.rung, Rating.Good, now, localDayKey(now, 0));
  }
  expect(p.l4PassDays.length).toBeGreaterThanOrEqual(2);
  return p;
}

const country = (id: string, hasRegions: boolean): Country => ({ id, name: id, places: 1, hasRegions });
const region = (id: string, c: string): Region => ({ id, name: id, country: c, places: 1 });
const place = (id: string, c: string, r: string | null): Place => ({
  id,
  name: id,
  country: c,
  region: r,
  lat: 0,
  lng: 0,
  type: 'city',
  level: 2,
});

const countries = [country('france', true), country('germany', true), country('tuvalu', false)];
const curriculum = buildCurriculum(
  countries,
  // germany.empty has no places, so it is not a curriculum item.
  [region('france.bretagne', 'france'), region('germany.bayern', 'germany'), region('germany.empty', 'germany')],
  [
    place('rennes', 'france', 'france.bretagne'),
    place('munich', 'germany', 'germany.bayern'),
    place('funafuti', 'tuvalu', null),
  ],
);

const rowFor = (id: string): Record<string, ItemProgress> => ({ [id]: createProgress(id, T0) });
const masteredFrance = { 'country:france': mastered('country:france') };
const resolve = (progress: Record<string, ItemProgress>, c: string, r?: string) =>
  resolveTestOutRoute(curriculum, countries, progress, c, r);

describe('resolveTestOutRoute', () => {
  it('runs for a mastered country with a regions tier', () => {
    expect(resolve(masteredFrance, 'france')).toEqual({
      kind: 'run',
      itemId: 'country:france',
      countryId: 'france',
      tier: 'regions',
      needsRegions: true,
    });
  });

  it('runs for a mastered country without a regions tier, over its places, needing no regions', () => {
    expect(resolve({ 'country:tuvalu': mastered('country:tuvalu') }, 'tuvalu')).toEqual({
      kind: 'run',
      itemId: 'country:tuvalu',
      countryId: 'tuvalu',
      tier: 'places',
      needsRegions: false,
    });
  });

  it('runs for a mastered region, over its places', () => {
    const progress = { 'region:france.bretagne': mastered('region:france.bretagne') };
    expect(resolve(progress, 'france', 'france.bretagne')).toEqual({
      kind: 'run',
      itemId: 'region:france.bretagne',
      countryId: 'france',
      tier: 'places',
      needsRegions: true,
    });
  });

  it('still runs when one child already has a row', () => {
    const progress = { ...masteredFrance, ...rowFor('region:france.bretagne') };
    expect(resolve(progress, 'france').kind).toBe('run');
  });

  it('is unavailable at the world for an unknown country, with or without a region', () => {
    expect(resolve(masteredFrance, 'atlantis')).toEqual({ kind: 'unavailable', back: '/progress' });
    expect(resolve(masteredFrance, 'atlantis', 'atlantis.x')).toEqual({ kind: 'unavailable', back: '/progress' });
  });

  it('is unavailable at the country for an item that is not mastered or has no progress', () => {
    const back = { kind: 'unavailable', back: '/progress/france' };
    expect(resolve({}, 'france')).toEqual(back);
    expect(resolve(rowFor('country:france'), 'france')).toEqual(back);
  });

  it('is unavailable at the country for a region page of a country without a regions tier', () => {
    const progress = { 'country:tuvalu': mastered('country:tuvalu') };
    expect(resolve(progress, 'tuvalu', 'tuvalu.x')).toEqual({ kind: 'unavailable', back: '/progress/tuvalu' });
  });

  it('is unavailable at the country for a region id of another country or not starting with it', () => {
    const progress = { ...masteredFrance, 'region:germany.bayern': mastered('region:germany.bayern') };
    const back = { kind: 'unavailable', back: '/progress/france' };
    expect(resolve(progress, 'france', 'germany.bayern')).toEqual(back);
    expect(resolve(progress, 'france', 'bretagne')).toEqual(back);
  });

  it('is unavailable at the country for a region that is not in the curriculum', () => {
    const progress = { 'region:germany.empty': mastered('region:germany.empty') };
    expect(resolve(progress, 'germany', 'germany.empty')).toEqual({
      kind: 'unavailable',
      back: '/progress/germany',
    });
  });

  it('is unavailable for a region that is not mastered even when its country is',() => {
    expect(resolve(masteredFrance, 'france', 'france.bretagne')).toEqual({
      kind: 'unavailable',
      back: '/progress/france',
    });
  });
});

describe('testOutPath', () => {
  it('links a country by its id and a region by its country and full id', () => {
    expect(testOutPath('country:france')).toBe('/placement/france');
    expect(testOutPath('region:france.bretagne')).toBe('/placement/france/france.bretagne');
  });
});

describe('testOutLabel', () => {
  it('names the item and the tier of its children', () => {
    expect(testOutLabel('France', 'regions')).toBe("Test out of France's regions");
    expect(testOutLabel('Bretagne', 'places')).toBe("Test out of Bretagne's places");
  });
});
