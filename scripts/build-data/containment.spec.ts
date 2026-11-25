import { beforeAll, describe, expect, it } from 'vitest';
import { CONTAINMENT_TOLERANCE_KM, checkContainment } from './containment';
import { type PlaceOut, type Topology, toTopology } from './emit';
import { square } from './fixtures/geometry';

// One degree of longitude at the equator is about 111.2 km.
const KM_PER_DEGREE = 111.195;

const place = (id: string, lng: number, region: string | null = null): PlaceOut => ({
  id,
  name: id,
  country: region ? 'aland' : 'bland',
  region,
  lat: 0.5,
  lng,
  type: 'city',
  level: 1,
});

describe('checkContainment', () => {
  let countries: Topology;
  let regions: Record<string, Topology>;
  const check = (places: PlaceOut[], allowList: Record<string, string> = {}) =>
    checkContainment(places, countries, regions, allowList);

  beforeAll(async () => {
    // bland spans lng 0..1; aland spans 10..12 with regions west (10..11) and east (11..12).
    countries = await toTopology('countries', [
      { id: 'aland', areas: [square(10, 0, 2)], properties: {} },
      { id: 'bland', areas: [square(0, 0)], properties: {} },
      { id: 'dot', areas: [], point: [20, 0.5], properties: { radiusKm: 20 } },
    ]);
    regions = {
      aland: await toTopology('regions', [
        { id: 'aland.east', areas: [square(11, 0)], properties: {} },
        { id: 'aland.west', areas: [square(10, 0)], properties: {} },
      ]),
    };
  });

  it('allows 10 km', () => {
    expect(CONTAINMENT_TOLERANCE_KM).toBe(10);
  });

  it('passes a place inside its country', () => {
    expect(check([place('in', 0.5)])).toEqual({ outside: [], problems: [] });
  });

  it('passes a place 5 km outside', () => {
    expect(check([place('near', 1 + 5 / KM_PER_DEGREE)])).toEqual({ outside: [], problems: [] });
  });

  it('fails a place 50 km outside', () => {
    expect(check([place('far', 1 + 50 / KM_PER_DEGREE)]).problems).toEqual([
      'place far lies 50.0 km outside bland and is not on the containment allow-list',
    ]);
  });

  it('passes a place 50 km outside with an allow-list entry, and lists it', () => {
    expect(check([place('far', 1 + 50 / KM_PER_DEGREE)], { far: 'reef' })).toEqual({
      outside: [{ id: 'far', country: 'bland', region: null, km: 50, reason: 'reef' }],
      problems: [],
    });
  });

  it('fails an allow-list entry with an empty reason', () => {
    expect(check([place('far', 1 + 50 / KM_PER_DEGREE)], { far: ' ' }).problems).toEqual([
      'containment allow-list entry far has no reason',
    ]);
  });

  it('fails a stale allow-list entry', () => {
    expect(check([place('in', 0.5)], { in: 'reef', gone: 'reef' }).problems).toEqual([
      'containment allow-list entry in is stale: no place with that id lies beyond 10 km',
      'containment allow-list entry gone is stale: no place with that id lies beyond 10 km',
    ]);
  });

  it('fails a place inside its country but 50 km outside its region', () => {
    expect(check([place('wrong', 11.5, 'aland.west')]).problems).toEqual([
      'place wrong lies 55.6 km outside aland / aland.west and is not on the containment allow-list',
    ]);
    expect(check([place('right', 11.5, 'aland.east')]).problems).toEqual([]);
  });

  it('counts a point-only country as inside within its radius', () => {
    const at = (lng: number): PlaceOut => ({ ...place('p', lng), country: 'dot' });
    expect(check([at(20 + 25 / KM_PER_DEGREE)]).problems).toEqual([]);
    expect(check([at(20 + 40 / KM_PER_DEGREE)]).problems).toHaveLength(1);
  });
});
