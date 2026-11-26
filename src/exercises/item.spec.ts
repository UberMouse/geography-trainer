import { describe, expect, it } from 'vitest';
import { ALPHA_REGIONS, COUNTRIES, DATA, DATA_WITH_ALPHA, PLACES } from './fixtures';
import { buildExerciseItem, distinctCandidates } from './item';

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

  it('offers every other country', () => {
    expect(ids(item.candidates)).toEqual(['country:beta', 'country:gamma']);
    expect(item.candidates.find((c) => c.id === 'country:beta')).toMatchObject({
      name: 'Beta',
      lng: expect.closeTo(25, 0),
      lat: expect.closeTo(45, 0),
    });
  });
});

describe('buildExerciseItem: a region', () => {
  const north = buildExerciseItem('region:alpha.north', DATA_WITH_ALPHA);

  it('targets the region on its country’s regions', () => {
    expect(north).toMatchObject({ tier: 'region', name: 'North', countryId: 'country:alpha' });
  });

  it('offers the country’s other regions that have places', () => {
    expect(ids(north.candidates)).toEqual(['region:alpha.isle', 'region:alpha.south']);
  });

  it('needs the country’s regions', () => {
    expect(() => buildExerciseItem('region:alpha.north', DATA)).toThrow(/regions/);
  });

  it('rejects another country’s regions', () => {
    const regions = {
      ...ALPHA_REGIONS,
      regions: ALPHA_REGIONS.regions.map((r) => ({ ...r, country: 'beta' })),
    };
    expect(() => buildExerciseItem('region:alpha.north', { ...DATA_WITH_ALPHA, regions })).toThrow(
      /needs alpha's regions/,
    );
  });
});

describe('buildExerciseItem: a place', () => {
  it('targets the point on its region’s country', () => {
    const n1 = buildExerciseItem('place:n1', DATA_WITH_ALPHA);
    expect(n1).toMatchObject({ tier: 'place', name: 'N1', countryId: 'country:alpha' });
    expect(n1.target).toEqual({ point: [2, 47] });
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

  it('dedups each pool before testing its size, so a thin one falls back', () => {
    // n1's region has 3 other places, but two share a name: only 2 distinct, so the country's pool.
    const places = PLACES.map((p) => (p.id === 'n3' ? { ...p, name: 'N2' } : p));
    const n1 = buildExerciseItem('place:n1', { ...DATA_WITH_ALPHA, places });
    expect(ids(n1.candidates)).toEqual(['place:i1', 'place:n2', 'place:n4', 'place:s1']);
  });

  it('marks a place in a point-only country, and the country', () => {
    const pointOnlyBeta = {
      ...COUNTRIES,
      features: COUNTRIES.features.map((f) =>
        f.id === 'beta' ? { ...f, properties: { ...f.properties, pointOnly: true } } : f,
      ),
    };
    const data = { ...DATA, countries: pointOnlyBeta };
    const b1 = buildExerciseItem('place:b1', data);
    expect(b1.pointOnly).toBe(true);
    expect(buildExerciseItem('country:beta', data).pointOnly).toBe(true);
    expect(buildExerciseItem('place:b1', DATA).pointOnly).toBe(false);
  });
});

describe('buildExerciseItem: the globe modes', () => {
  const [alpha, beta] = COUNTRIES.features;
  const regions = ALPHA_REGIONS.features;

  it('a country: highlighted among every country’s borders, which L2 draws', () => {
    const item = buildExerciseItem('country:alpha', DATA);
    expect(item.highlightMode).toEqual({
      kind: 'highlight',
      target: { kind: 'country', feature: alpha, countries: COUNTRIES.features },
    });
    expect(item.bordersMode).toEqual({ kind: 'countryBorders', countries: COUNTRIES.features });
  });

  it('a region: highlighted among its country’s regions, whose borders L2 draws', () => {
    const item = buildExerciseItem('region:alpha.north', DATA_WITH_ALPHA);
    expect(item.highlightMode).toEqual({
      kind: 'highlight',
      target: { kind: 'region', feature: regions[0], country: alpha, regions },
    });
    expect(item.bordersMode).toEqual({ kind: 'regionBorders', country: alpha, regions });
  });

  it('a place: dotted among its country’s regions', () => {
    const item = buildExerciseItem('place:n1', DATA_WITH_ALPHA);
    expect(item.highlightMode).toEqual({
      kind: 'highlight',
      target: { kind: 'place', place: PLACES[0], country: alpha, regions },
    });
    expect(item.bordersMode).toEqual({ kind: 'regionBorders', country: alpha, regions });
  });

  it('a place in a country without regions: its country’s outline alone', () => {
    const item = buildExerciseItem('place:b1', DATA);
    expect(item.highlightMode).toEqual({
      kind: 'highlight',
      target: { kind: 'place', place: PLACES[6], country: beta, regions: undefined },
    });
    expect(item.bordersMode).toEqual({ kind: 'regionBorders', country: beta, regions: undefined });
  });
});

describe('buildExerciseItem: empty regions data', () => {
  const regions = { features: [], regions: [] };

  it('throws for a region and for a regions-tier place', () => {
    for (const id of ['region:alpha.north', 'place:n1']) {
      expect(() => buildExerciseItem(id, { ...DATA_WITH_ALPHA, regions })).toThrow(
        /needs alpha's regions/,
      );
    }
  });
});

describe('buildExerciseItem: unknown ids', () => {
  it.each(['country:nowhere', 'region:alpha.nowhere', 'place:nowhere', 'city:n1', 'alpha'])(
    'throws for %s',
    (id) => expect(() => buildExerciseItem(id, DATA_WITH_ALPHA)).toThrow(),
  );
});

describe('distinctCandidates', () => {
  const at = (id: string, name: string, lng: number) => ({ id, name, lng, lat: 0 });

  it('drops the target’s own name and keeps the nearest of each repeated name', () => {
    const out = distinctCandidates(
      [at('far-x', 'X', 30), at('near-x', 'X', 10), at('same', 'Target', 5), at('y', 'Y', 20)],
      'Target',
      [0, 0],
    );
    expect(ids(out)).toEqual(['near-x', 'y']);
  });
});

describe('buildExerciseItem: same-named siblings', () => {
  it('never offers the target’s name, or one name twice, for a place', () => {
    const places = [
      ...PLACES,
      { ...PLACES[0]!, id: 'n1b', name: 'N1', lng: 9 },
      { ...PLACES[1]!, id: 'n2b', name: 'N2', lng: 9.5 },
    ].map((p) => (p.id === 'n1' ? { ...p, name: 'N1' } : p));
    const item = buildExerciseItem('place:n1', { ...DATA_WITH_ALPHA, places });
    const names = item.candidates.map((c) => c.name);
    expect(names).not.toContain('N1');
    expect(new Set(names).size).toBe(names.length);
    expect(item.candidates.filter((c) => c.name === 'N2').map((c) => c.id)).toEqual(['place:n2']);
  });

  it('lists same-named sibling regions as also inside', () => {
    const renamed = (name: string) =>
      ALPHA_REGIONS.features.map((f) =>
        f.id === 'alpha.south' ? { ...f, properties: { ...f.properties, name } } : f,
      );
    const twin = (name: string) => {
      const regions = { ...ALPHA_REGIONS, features: renamed(name) };
      return buildExerciseItem('region:alpha.north', { ...DATA_WITH_ALPHA, regions }).target;
    };
    const twinned = twin('North');
    if (!('feature' in twinned)) throw new Error('expected a feature target');
    expect(twinned.alsoInside?.map((f) => (f as { id?: string }).id)).toEqual(['alpha.south']);
    const alone = twin('South');
    if (!('feature' in alone)) throw new Error('expected a feature target');
    expect(alone.alsoInside).toBeUndefined();
  });

  it('never offers the target’s name for a region', () => {
    const features = ALPHA_REGIONS.features.map((f) =>
      f.id === 'alpha.south' ? { ...f, properties: { ...f.properties, name: 'North' } } : f,
    );
    const item = buildExerciseItem('region:alpha.north', {
      ...DATA_WITH_ALPHA,
      regions: { ...ALPHA_REGIONS, features },
    });
    expect(item.candidates.map((c) => c.name)).toEqual(['Isle']);
  });
});
