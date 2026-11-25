import { describe, expect, it } from 'vitest';
import { applyAnswer, createProgress, seedFromPlacement, type ItemProgress } from '../engine/srs';
import { buildCurriculum } from '../engine/curriculum';
import type { Country } from '../engine/types';
import { offersPlacement, showsPlacementOffer } from './homeView';

const NOW = new Date('2026-03-04T23:30:00Z');

const countries: Country[] = ['france', 'peru'].map((id) => ({ id, name: id, places: 1, hasRegions: false }));
const curriculum = buildCurriculum(
  countries,
  [],
  countries.map((c) => ({
    id: `${c.id}-city`,
    name: c.id,
    country: c.id,
    region: null,
    lat: 0,
    lng: 0,
    type: 'city' as const,
    level: 2,
  })),
);

const started = (id: string): ItemProgress =>
  applyAnswer(createProgress(id, NOW), 1, 3, NOW, '2026-03-04');

describe('offersPlacement', () => {
  it('offers while no item has been started', () => {
    expect(offersPlacement(curriculum, {})).toBe(true);
    // A row with no answered card (a fresh or L3-seeded record) is not a started item.
    expect(offersPlacement(curriculum, { 'country:france': createProgress('country:france', NOW) })).toBe(true);
  });

  it('keeps offering when only placement seeds exist', () => {
    const seed = seedFromPlacement('country:france', 'passed', NOW, '2026-03-04');
    expect(offersPlacement(curriculum, { 'country:france': seed })).toBe(true);
  });

  it('stops offering when every country already has a seed row', () => {
    const seeds = Object.fromEntries(
      ['country:france', 'country:peru'].map((id) => [id, seedFromPlacement(id, 'passed', NOW, '2026-03-04')]),
    );
    expect(offersPlacement(curriculum, seeds)).toBe(false);
  });

  it('stops offering once a passed seed is answered in a session', () => {
    const seed = seedFromPlacement('country:france', 'passed', NOW, '2026-03-04');
    const studied = applyAnswer(seed, 4, 3, NOW, '2026-03-04');
    expect(offersPlacement(curriculum, { 'country:france': studied })).toBe(false);
  });

  it('stops offering once an item is answered in a session', () => {
    expect(offersPlacement(curriculum, { 'country:france': started('country:france') })).toBe(false);
  });
});

describe('showsPlacementOffer', () => {
  const countriesMarker = new Set(['placement:countries']);

  it('offers while offersPlacement holds and no marker exists', () => {
    expect(showsPlacementOffer(curriculum, {}, new Set())).toBe(true);
  });

  it('hides once the countries test has a marker, even if offersPlacement holds', () => {
    expect(offersPlacement(curriculum, {})).toBe(true);
    expect(showsPlacementOffer(curriculum, {}, countriesMarker)).toBe(false);
  });

  it('ignores the markers of test-outs', () => {
    expect(showsPlacementOffer(curriculum, {}, new Set(['placement:country:france']))).toBe(true);
  });

  it('stays hidden when offersPlacement fails, marker or not', () => {
    const progress = { 'country:france': started('country:france') };
    expect(showsPlacementOffer(curriculum, progress, new Set())).toBe(false);
    expect(showsPlacementOffer(curriculum, progress, countriesMarker)).toBe(false);
  });
});
