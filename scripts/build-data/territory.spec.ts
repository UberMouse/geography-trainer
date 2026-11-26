import { describe, expect, it } from 'vitest';
import { admin1Rows, buildRegions } from './assign-regions';
import { admin1, polygonCountry } from './fixtures/geometry';
import { type Area, areaContains, bboxOf } from './geo';
import { applyTerritoryMoves } from './territory';

// aaa spans lng 0..2 with rows AAA-1 (0..1) and AAA-2 (1..2); bbb spans 2..3 with row BBB-1.
const countries = () => [polygonCountry('aaa', [0, 0], 2), polygonCountry('bbb', [2, 0])];
const rows = [
  admin1('AAA-1', 'West', [0, 0]),
  admin1('AAA-2', 'East', [1, 0]),
  admin1('BBB-1', 'Home', [2, 0], { adm0: 'BBB' }),
];
const rect = (west: number, south: number, east: number, north: number): Area => ({
  type: 'Polygon',
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});
const disputed = (area: Area) => new Map([['D1', area]]);
const MOVE_D1 = [{ from: 'aaa', to: 'bbb', territory: { disputedArea: 'D1' } }];
const inside = (area: Area | null | undefined, lng: number) =>
  !!area && areaContains(area, bboxOf(area), lng, 0.5);

describe('applyTerritoryMoves', () => {
  it('[DAT-11] moves an admin-1 row from A to B: its geometry and its region land in B', () => {
    const moved = applyTerritoryMoves(countries(), rows, new Map(), [
      { from: 'aaa', to: 'bbb', territory: { admin1: ['AAA-2'] }, region: 'Moved' },
    ]);
    const [a, b] = moved.countries.map((c) => c.area);
    expect([inside(a, 1.5), inside(b, 1.5)]).toEqual([false, true]);
    expect([inside(a, 0.5), inside(b, 2.5)]).toEqual([true, true]);

    const regionIds = (i: number) =>
      buildRegions(
        moved.countries[i]!.id,
        admin1Rows(moved.countries[i]!, moved.admin1, moved.countries).rows,
        false,
      ).map((r) => r.id);
    expect(regionIds(0)).toEqual(['aaa.west']);
    expect(regionIds(1)).toEqual(['bbb.home', 'bbb.moved']);
  });

  it('[DAT-11] clips a row a disputed area straddles, giving B the clipped-off piece', () => {
    const moved = applyTerritoryMoves(
      countries(),
      rows,
      disputed(rect(1.5, -0.5, 2, 1.5)),
      MOVE_D1,
    );
    const [a, b] = moved.countries.map((c) => c.area);
    expect([inside(a, 1.75), inside(b, 1.75)]).toEqual([false, true]);
    expect(inside(a, 1.25)).toBe(true);

    const east = moved.admin1.filter((r) => r.code.startsWith('AAA-2'));
    expect(east.map((r) => [r.code, r.adm0])).toEqual([
      ['AAA-2', 'AAA'],
      ['AAA-2>bbb', 'BBB'],
    ]);
    expect(inside(east[0]!.geometry, 1.75)).toBe(false);
  });

  it('[DAT-12] reports a sliver it leaves with the losing row', () => {
    const moved = applyTerritoryMoves(
      countries(),
      rows,
      disputed(rect(0.995, -0.5, 2, 1.5)),
      MOVE_D1,
    );
    expect(moved.slivers.map((s) => [s.row, s.part, Number(s.share.toFixed(3))])).toEqual([
      ['AAA-1 West', 'in-territory', 0.005],
    ]);
    expect(moved.slivers[0]!.km2).toBeCloseTo(0.005 * 111.195 ** 2, -1);
  });

  it('[DAT-12] reports the sliver of a moved row left outside the territory', () => {
    const moved = applyTerritoryMoves(
      countries(),
      rows,
      disputed(rect(1.005, -0.5, 2, 1.5)),
      MOVE_D1,
    );
    expect(moved.slivers.map((s) => [s.row, s.part, Number(s.share.toFixed(3))])).toEqual([
      ['AAA-2 East', 'outside', 0.005],
    ]);
    expect(moved.admin1.map((r) => r.code)).toEqual(['AAA-1', 'BBB-1', 'AAA-2>bbb']);
  });

  it("[DAT-11] clips the gaining country's own row by the moved territory, so its rows tile", () => {
    const moved = applyTerritoryMoves(
      countries(),
      rows,
      disputed(rect(1.5, -0.5, 2.5, 1.5)),
      MOVE_D1,
    );
    const row = (code: string) => moved.admin1.find((r) => r.code === code)!.geometry;
    expect([inside(row('BBB-1'), 2.25), inside(row('BBB-1'), 2.75)]).toEqual([false, true]);
    expect([inside(row('AAA-2>bbb'), 1.75), inside(row('AAA-2>bbb'), 2.25)]).toEqual([true, false]);
    expect(moved.slivers).toEqual([]);
  });

  it("[DAT-12] drops a gaining country's row the territory covers, and reports it", () => {
    const moved = applyTerritoryMoves(
      countries(),
      rows,
      disputed(rect(1.5, -0.5, 3.5, 1.5)),
      MOVE_D1,
    );
    expect(moved.admin1.some((r) => r.code === 'BBB-1')).toBe(false);
    expect(moved.slivers.map((s) => [s.row, s.part, s.share])).toEqual([
      ['BBB-1 Home', 'gaining-covered', 1],
    ]);
  });

  it('[DAT-12] labels a clipped row inside its rest, never on the cut, so the country keeps it', () => {
    // AAA-2's rest is an L whose box centre (1.5, 0.5), turf's point-on-feature, is the cut corner.
    const moved = applyTerritoryMoves(countries(), rows, disputed(rect(1.5, 0.5, 2, 1.5)), MOVE_D1);
    const east = moved.admin1.find((r) => r.code === 'AAA-2')!;
    expect(east.label).not.toEqual([1.5, 0.5]);
    expect(areaContains(east.geometry, bboxOf(east.geometry), ...east.label)).toBe(true);
    const kept = admin1Rows(moved.countries[0]!, moved.admin1, moved.countries);
    expect([kept.rows.map((r) => r.code), kept.dropped]).toEqual([['AAA-1', 'AAA-2'], []]);
  });

  it('[DAT-13] fails on a territory that names no row', () => {
    expect(() =>
      applyTerritoryMoves(countries(), rows, new Map(), [
        { from: 'aaa', to: 'bbb', territory: { admin1: ['AAA-9'] } },
      ]),
    ).toThrow('move aaa → bbb: no admin-1 row AAA-9');
  });
});
