import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { buildCurriculum } from '../engine/curriculum';
import { applyAnswer, createProgress, localDayKey, seedFromPlacement, type ItemProgress } from '../engine/srs';
import { gateFillers, withFillersMastered } from '../engine/gateFixtures';
import type { Country, Place, Region } from '../engine/types';
import { resolveTestOutRoute, showsTestOutLink, testOutLabel, testOutPath } from './testOutView';

const T0 = new Date('2026-01-01T12:00:00Z');
const DAY = 86_400_000;

function mastered(itemId: string): ItemProgress {
  let p = createProgress(itemId, T0);
  for (let day = 0; day < 40 && p.l3PassDays.length < 2; day++) {
    const now = new Date(T0.getTime() + day * DAY);
    p = applyAnswer(p, p.rung, Rating.Good, now, localDayKey(now, 0));
  }
  expect(p.l3PassDays.length).toBeGreaterThanOrEqual(2);
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
// The fillers (placeless countries) are in the curriculum only, so `opened` can open every gate.
const fillers = gateFillers();
const curriculum = buildCurriculum(
  [...countries, ...fillers],
  // germany.empty has no places, so it is not a curriculum item.
  [region('france.bretagne', 'france'), region('germany.bayern', 'germany'), region('germany.empty', 'germany')],
  [
    place('rennes', 'france', 'france.bretagne'),
    place('munich', 'germany', 'germany.bayern'),
    place('funafuti', 'tuvalu', null),
  ],
);

/** `progress` with every filler mastered: every gate (CUR-21) is open. */
const opened = (progress: Record<string, ItemProgress>) =>
  withFillersMastered(progress, mastered('country:filler'), fillers);
const rowFor = (id: string): Record<string, ItemProgress> => ({ [id]: createProgress(id, T0) });
const masteredFrance = opened({ 'country:france': mastered('country:france') });
const resolve = (progress: Record<string, ItemProgress>, c: string, r?: string) =>
  resolveTestOutRoute(curriculum, countries, progress, c, r);

describe('[PLC-23] resolveTestOutRoute', () => {
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
    expect(resolve(opened({ 'country:tuvalu': mastered('country:tuvalu') }), 'tuvalu')).toEqual({
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

  it('still runs when a child has only a passed placement seed', () => {
    const seed = seedFromPlacement('region:france.bretagne', 'passed', T0, localDayKey(T0, 0));
    expect(resolve({ ...masteredFrance, 'region:france.bretagne': seed }, 'france').kind).toBe('run');
  });

  it('is unavailable at the country for a mastered country whose gate is shut', () => {
    for (const id of ['france', 'tuvalu']) {
      expect(resolve({ [`country:${id}`]: mastered(`country:${id}`) }, id)).toEqual({
        kind: 'unavailable',
        back: `/progress/${id}`,
      });
    }
  });

  it('is unavailable at the country once a child has been studied', () => {
    const studied = applyAnswer(createProgress('region:france.bretagne', T0), 1, Rating.Good, T0, localDayKey(T0, 0));
    expect(resolve({ ...masteredFrance, 'region:france.bretagne': studied }, 'france')).toEqual({
      kind: 'unavailable',
      back: '/progress/france',
    });
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

describe('[PLC-C09] testOutPath', () => {
  it('links a country by its id and a region by its country and full id', () => {
    expect(testOutPath('country:france')).toBe('/placement/france');
    expect(testOutPath('region:france.bretagne')).toBe('/placement/france/france.bretagne');
  });
});

describe('[PLC-23] testOutLabel', () => {
  it('names the item and the tier of its children', () => {
    expect(testOutLabel('France', 'regions')).toBe("Test out of France's regions");
    expect(testOutLabel('Bretagne', 'places')).toBe("Test out of Bretagne's places");
  });
});

describe('[PLC-24] showsTestOutLink', () => {
  const show = (progress: Record<string, ItemProgress>, finished: string[], id: string) =>
    showsTestOutLink(curriculum, progress, new Set(finished), id);

  it('shows for a testable item with no marker', () => {
    expect(show(masteredFrance, [], 'country:france')).toBe(true);
  });

  it('hides once that item has a marker', () => {
    expect(show(masteredFrance, ['placement:country:france'], 'country:france')).toBe(false);
    const region = { 'region:france.bretagne': mastered('region:france.bretagne') };
    expect(show(region, ['placement:region:france.bretagne'], 'region:france.bretagne')).toBe(false);
  });

  it('ignores other items and the countries marker', () => {
    expect(show(masteredFrance, ['placement:country:germany', 'placement:countries'], 'country:france')).toBe(true);
  });

  it('hides for a mastered country whose gate is shut', () => {
    expect(show({ 'country:france': mastered('country:france') }, [], 'country:france')).toBe(false);
  });

  it('stays hidden when canTestOut fails, marker or not', () => {
    expect(show({}, [], 'country:france')).toBe(false);
    expect(show({}, ['placement:country:france'], 'country:france')).toBe(false);
  });
});
