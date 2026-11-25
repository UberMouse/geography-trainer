import { describe, expect, it } from 'vitest';
import { ALPHA_REGIONS, COUNTRIES, DATA, DATA_WITH_ALPHA } from './fixtures';
import { buildExerciseItem } from './item';

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe('buildExerciseItem: a country', () => {
  const item = buildExerciseItem('country:alpha', DATA);

  it('targets the country at the centre of its main part, ignoring its far isle', () => {
    expect(item).toMatchObject({ id: 'country:alpha', tier: 'country', name: 'Alpha' });
    expect(item.countryId).toBe('country:alpha');
    if (!('feature' in item.target)) throw new Error('expected a feature target');
    expect(item.target.feature.id).toBe('alpha');
    expect(item.target.answer[0]).toBeCloseTo(5, 0);
    expect(item.target.answer[1]).toBeCloseTo(45, 0);
  });

  it('offers every other country and draws the world', () => {
    expect(ids(item.candidates)).toEqual(['country:beta', 'country:gamma']);
    expect(item.candidates.find((c) => c.id === 'country:beta')).toMatchObject({
      name: 'Beta',
      lng: expect.closeTo(25, 0),
      lat: expect.closeTo(45, 0),
    });
    expect(item.context).toBe(COUNTRIES.features);
    expect(item.world).toBe(COUNTRIES.features);
    expect(item.outline).toBe(COUNTRIES.features[0]);
    expect(item.onGlobe).toBe(false);
  });
});

describe('buildExerciseItem: a region', () => {
  const north = buildExerciseItem('region:alpha.north', DATA_WITH_ALPHA);

  it('targets the region on its country’s regions', () => {
    expect(north).toMatchObject({ tier: 'region', name: 'North', countryId: 'country:alpha' });
    expect(north.context).toBe(ALPHA_REGIONS.features);
    expect(north.outline.id).toBe('alpha.north');
    expect(north.onGlobe).toBe(false);
  });

  it('offers the country’s other regions that have places', () => {
    expect(ids(north.candidates)).toEqual(['region:alpha.isle', 'region:alpha.south']);
  });

  it('draws the world with the country as its regions', () => {
    expect(ids(north.world)).toEqual(
      ['alpha.empty', 'alpha.isle', 'alpha.north', 'alpha.south', 'beta', 'gamma'].sort(),
    );
  });

  it('puts a region outside the country’s flat map on the globe', () => {
    expect(buildExerciseItem('region:alpha.isle', DATA_WITH_ALPHA).onGlobe).toBe(true);
  });

  it('needs the country’s regions', () => {
    expect(() => buildExerciseItem('region:alpha.north', DATA)).toThrow(/regions/);
  });
});

describe('buildExerciseItem: a place', () => {
  it('targets the point and outlines its region', () => {
    const n1 = buildExerciseItem('place:n1', DATA_WITH_ALPHA);
    expect(n1).toMatchObject({ tier: 'place', name: 'N1', countryId: 'country:alpha' });
    expect(n1.target).toEqual({ point: [2, 47] });
    expect(n1.outline.id).toBe('alpha.north');
    expect(n1.context).toBe(ALPHA_REGIONS.features);
    expect(n1.onGlobe).toBe(false);
  });

  it('offers its region’s other places when there are 3', () => {
    const n1 = buildExerciseItem('place:n1', DATA_WITH_ALPHA);
    expect(ids(n1.candidates)).toEqual(['place:n2', 'place:n3', 'place:n4']);
  });

  it('widens to its country, then everywhere, when there are fewer', () => {
    const s1 = buildExerciseItem('place:s1', DATA_WITH_ALPHA);
    expect(ids(s1.candidates)).toEqual([
      'place:i1',
      'place:n1',
      'place:n2',
      'place:n3',
      'place:n4',
    ]);
    // b1 has no region and one country neighbour: every other place.
    const b1 = buildExerciseItem('place:b1', DATA);
    expect(b1.candidates).toHaveLength(7);
  });

  it('outlines a place in a country without regions with the country, on the country alone', () => {
    const b1 = buildExerciseItem('place:b1', DATA);
    expect(b1.outline.id).toBe('beta');
    expect(ids(b1.context)).toEqual(['beta']);
    expect(b1.world).toBe(COUNTRIES.features);
  });

  it('puts a place outside the country’s flat map on the globe', () => {
    expect(buildExerciseItem('place:i1', DATA_WITH_ALPHA).onGlobe).toBe(true);
  });
});

describe('buildExerciseItem: unknown ids', () => {
  it.each(['country:nowhere', 'region:alpha.nowhere', 'place:nowhere', 'city:n1', 'alpha'])(
    'throws for %s',
    (id) => expect(() => buildExerciseItem(id, DATA_WITH_ALPHA)).toThrow(),
  );
});
