import { describe, expect, it } from 'vitest';
import { REGIONS_TIER_MIN_PLACES, REGIONS_TIER_MIN_REGIONS } from '../../src/engine/config';
import {
  adminDisagrees,
  applyRegionNameOverrides,
  assertDistinctRegionNames,
  admin1Rows,
  assignRegion,
  buildRegions,
  hasRegionsTier,
} from './assign-regions';
import { admin1, polygonCountry } from './fixtures/geometry';

// Three provinces in a row; north and south make up the "Upland" region when dissolved.
const ROWS = [
  admin1('AAA-1', 'North', [0, 0], { region: 'Upland', nameAlt: 'Nordland|Top' }),
  admin1('AAA-2', 'South', [1, 0], { region: 'Upland', nameEn: 'Southshire' }),
  admin1('AAA-3', 'Coast', [2, 0], { region: 'Lowland' }),
];

describe('buildRegions', () => {
  it('keeps admin-1 rows as they are by default, with <country>.<slug> ids', () => {
    const regions = buildRegions('aland', ROWS, false);
    expect(regions.map((r) => [r.id, r.name])).toEqual([
      ['aland.coast', 'Coast'],
      ['aland.north', 'North'],
      ['aland.south', 'South'],
    ]);
  });

  it('dissolves rows by region when asked, keeping a row without one on its own', () => {
    const rows = [...ROWS, admin1('AAA-4', 'Far Isles', [9, 9])];
    const regions = buildRegions('aland', rows, true);
    expect(regions.map((r) => [r.id, r.units.map((u) => u.row.code)])).toEqual([
      ['aland.far-isles', ['AAA-4']],
      ['aland.lowland', ['AAA-3']],
      ['aland.upland', ['AAA-1', 'AAA-2']],
    ]);
  });

  it('keeps ids unique when two rows share a name', () => {
    const rows = [admin1('AAA-1', 'Limburg', [0, 0]), admin1('AAA-2', 'Limburg', [1, 0])];
    expect(buildRegions('x', rows, false).map((r) => r.id)).toEqual([
      'x.limburg-aaa-1',
      'x.limburg-aaa-2',
    ]);
  });
});

describe('admin1Rows', () => {
  it("takes the country's ADM0 rows, minus another country's geounit or label point", () => {
    const home = { ...polygonCountry('home', [0, 0], 10), adm0: ['AAA'], guA3: ['AAA'] };
    const islet = { ...polygonCountry('islet', [80, 80]), guA3: ['ISL'] };
    const dot = {
      ...polygonCountry('dot', [0, 0]),
      area: null,
      box: null,
      point: { lng: 7.5, lat: 7.5, radiusKm: 10 },
    };
    const rows = [
      admin1('AAA-1', 'Main', [0, 0]),
      admin1('AAA-2', 'Islet', [50, 50], { guA3: 'ISL' }),
      admin1('AAA-3', 'Dot', [7, 7]),
      admin1('BBB-1', 'Foreign', [1, 1], { adm0: 'BBB' }),
    ];
    const result = admin1Rows(home, rows, [home, islet, dot]);
    expect(result.rows.map((r) => r.code)).toEqual(['AAA-1']);
    expect(result.dropped).toEqual([
      { code: 'AAA-3', name: 'Dot', country: 'home', labelIn: 'dot' },
    ]);
  });
});

describe('assignRegion', () => {
  const regions = buildRegions('aland', ROWS, false);
  const byId = (id: string) => regions.find((r) => r.id === id)!;

  it('assigns the region containing the point', () => {
    const a = assignRegion(regions, 1.5, 0.5, undefined);
    expect([a.region.id, a.how]).toEqual(['aland.south', 'inside']);
    expect(adminDisagrees(a, undefined)).toBe(false);
  });

  it("prefers the region maptap's admin names when the point is within tolerance of it", () => {
    const a = assignRegion(regions, 1.95, 0.5, 'Coast');
    expect([a.region.id, a.how, a.inside?.id]).toEqual(['aland.coast', 'admin', 'aland.south']);
    expect(adminDisagrees(a, 'Coast')).toBe(true);
  });

  it('keeps the point-in-polygon result when the admin region is beyond tolerance', () => {
    const a = assignRegion(regions, 1.5, 0.5, 'Coast');
    expect([a.region.id, a.how]).toEqual(['aland.south', 'inside']);
    expect(adminDisagrees(a, 'Coast')).toBe(true);
  });

  it('matches admin against name_en and name_alt, normalized', () => {
    expect(assignRegion(regions, 2.05, 0.5, 'southshire').region).toBe(byId('aland.south'));
    expect(assignRegion(regions, 1.05, 0.5, 'Nordland').region).toBe(byId('aland.north'));
  });

  it('matches admin against a dissolved region and its underlying rows', () => {
    const dissolved = buildRegions('aland', ROWS, true);
    expect(assignRegion(dissolved, 2.05, 0.5, 'Upland').region.id).toBe('aland.upland');
    expect(assignRegion(dissolved, 2.05, 0.5, 'Top').region.id).toBe('aland.upland');
  });

  it('reports an admin that names no region, keeping the point-in-polygon result', () => {
    const a = assignRegion(regions, 0.5, 0.5, 'Atlantis');
    expect([a.region.id, a.how]).toEqual(['aland.north', 'inside']);
    expect(adminDisagrees(a, 'Atlantis')).toBe(true);
  });

  it('agrees when admin and the point name the same region', () => {
    expect(adminDisagrees(assignRegion(regions, 0.5, 0.5, 'North'), 'North')).toBe(false);
  });

  it('snaps a point outside every region to the one with the nearest edge', () => {
    const a = assignRegion(regions, 3.2, 0.5, undefined);
    expect([a.region.id, a.how]).toEqual(['aland.coast', 'snapped']);
    expect(a.snappedKm).toBeCloseTo(22.2, 0);
  });

  it('reports an admin naming a region other than the one a point was snapped to', () => {
    const a = assignRegion(regions, 3.2, 0.5, 'North');
    expect([a.region.id, a.how]).toEqual(['aland.coast', 'snapped']);
    expect(adminDisagrees(a, 'North')).toBe(true);
    expect(adminDisagrees(assignRegion(regions, 3.05, 0.5, 'Coast'), 'Coast')).toBe(false);
  });
});

describe('hasRegionsTier', () => {
  it(`needs ≥ ${REGIONS_TIER_MIN_REGIONS} regions with places and ≥ ${REGIONS_TIER_MIN_PLACES} places`, () => {
    expect(REGIONS_TIER_MIN_REGIONS).toBe(4);
    expect(REGIONS_TIER_MIN_PLACES).toBe(15);
    expect(hasRegionsTier(4, 15)).toBe(true);
    expect(hasRegionsTier(3, 15)).toBe(false);
    expect(hasRegionsTier(4, 14)).toBe(false);
  });
});

describe('region name overrides', () => {
  const rows = [
    admin1('AAA-1', 'Galway', [0, 0]),
    admin1('AAA-2', 'Galway', [1, 0]),
    admin1('AAA-3', 'Mayo', [2, 0]),
  ];
  const overrides = {
    'AAA-1': { name: 'Galway (county)', reason: 'test' },
    'AAA-2': { name: 'Galway (city)', reason: 'test' },
  };

  it('gives an overridden pair distinct names and slug ids, and leaves other rows alone', () => {
    const named = applyRegionNameOverrides(rows, overrides);
    expect(named[2]).toBe(rows[2]);
    const regions = buildRegions('ireland', named, false);
    expect(regions.map((r) => [r.id, r.name])).toEqual([
      ['ireland.galway-city', 'Galway (city)'],
      ['ireland.galway-county', 'Galway (county)'],
      ['ireland.mayo', 'Mayo'],
    ]);
    assertDistinctRegionNames('ireland', regions);
  });

  it("still matches maptap's admin against the NE name", () => {
    const regions = buildRegions('ireland', applyRegionNameOverrides(rows, overrides), false);
    expect(regions[0]!.units[0]!.row.neName).toBe('Galway');
    const hit = assignRegion(regions, 1, 0, 'Galway (city)');
    expect(hit.adminMatches.map((r) => r.name)).toContain('Galway (city)');
    expect(assignRegion(regions, 1, 0, 'Galway').adminMatches).toHaveLength(2);
  });

  it('keeps a mislabelled row from matching the name NE wrongly gave it', () => {
    // NE labels AAA-1 "Parwan" (name_en and name_alt repeat it); it is really Panjshir.
    const mislabelled = [
      admin1('AAA-1', 'Parwan', [0, 0], { nameEn: 'Parwan', nameAlt: 'Charikar|Parwan' }),
      admin1('AAA-2', 'Parwan', [1, 0]),
    ];
    const named = applyRegionNameOverrides(mislabelled, {
      'AAA-1': { name: 'Panjshir', reason: 'test', mislabel: true },
    });
    expect(named[0]).toMatchObject({ name: 'Panjshir', nameEn: null, nameAlt: null });
    expect(named[0]!.neName).toBeUndefined();
    const regions = buildRegions('afghanistan', named, false);
    // A "Parwan" place inside the Panjshir polygon is a disagreement, not a match.
    const inPanjshir = assignRegion(regions, 0.5, 0.5, 'Parwan');
    expect(inPanjshir.adminMatches.map((r) => r.name)).toEqual(['Parwan']);
    expect(adminDisagrees(inPanjshir, 'Parwan')).toBe(true);
    const inParwan = assignRegion(regions, 1.5, 0.5, 'Parwan');
    expect(adminDisagrees(inParwan, 'Parwan')).toBe(false);
    expect(assignRegion(regions, 0.5, 0.5, 'Charikar').adminMatches).toEqual([]);
  });

  it('fails for an override whose code is not in NE', () => {
    expect(() => applyRegionNameOverrides(rows, { 'ZZZ-9': { name: 'X', reason: 'r' } })).toThrow(
      /ZZZ-9/,
    );
  });

  it('fails when two regions of a country share a name, naming the country and rows', () => {
    const regions = buildRegions('ireland', rows, false);
    expect(() => assertDistinctRegionNames('ireland', regions)).toThrow(
      /ireland.*Galway.*AAA-1.*AAA-2/,
    );
  });
});
