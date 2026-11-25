import { describe, expect, it } from 'vitest';
import { admin1Rows, buildRegions } from './assign-regions';
import { admin1, polygonCountry, square } from './fixtures/geometry';
import { type Area, areaContains, bboxOf } from './geo';
import { applyTerritoryMoves } from './territory';

// aaa spans lng 0..2 with rows AAA-1 (0..1) and AAA-2 (1..2); bbb spans 2..3 with row BBB-1.
const countries = () => [polygonCountry('aaa', [0, 0], 2), polygonCountry('bbb', [2, 0])];
const rows = [
  admin1('AAA-1', 'West', [0, 0]),
  admin1('AAA-2', 'East', [1, 0]),
  admin1('BBB-1', 'Home', [2, 0], { adm0: 'BBB' }),
];
const inside = (area: Area | null | undefined, lng: number) =>
  !!area && areaContains(area, bboxOf(area), lng, 0.5);

describe('applyTerritoryMoves', () => {
  it('moves an admin-1 row from A to B: its geometry and its region land in B', () => {
    const moved = applyTerritoryMoves(countries(), rows, new Map(), [
      { from: 'aaa', to: 'bbb', territory: { admin1: ['AAA-2'] }, region: 'Moved' },
    ]);
    const [a, b] = moved.countries.map((c) => c.area);
    expect([inside(a, 1.5), inside(b, 1.5)]).toEqual([false, true]);
    expect([inside(a, 0.5), inside(b, 2.5)]).toEqual([true, true]);

    const regionIds = (i: number) =>
      buildRegions(
        moved.countries[i]!.id,
        admin1Rows(moved.countries[i]!, moved.admin1, moved.countries),
        false,
      ).map((r) => r.id);
    expect(regionIds(0)).toEqual(['aaa.west']);
    expect(regionIds(1)).toEqual(['bbb.home', 'bbb.moved']);
  });

  it('clips a row a disputed area straddles, giving B the clipped-off piece', () => {
    const moved = applyTerritoryMoves(countries(), rows, new Map([['D1', square(1.5, -0.5, 2)]]), [
      { from: 'aaa', to: 'bbb', territory: { disputedArea: 'D1' } },
    ]);
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

  it('reports a sliver it leaves with the losing row', () => {
    const moved = applyTerritoryMoves(
      countries(),
      rows,
      new Map([['D1', square(0.995, -0.5, 2)]]),
      [{ from: 'aaa', to: 'bbb', territory: { disputedArea: 'D1' } }],
    );
    expect(moved.slivers.map((s) => [s.row, s.part, Number(s.share.toFixed(3))])).toEqual([
      ['AAA-1 West', 'in-territory', 0.005],
    ]);
    expect(moved.slivers[0]!.km2).toBeCloseTo(0.005 * 111.195 ** 2, -1);
  });

  it('fails on a territory that names no row', () => {
    expect(() =>
      applyTerritoryMoves(countries(), rows, new Map(), [
        { from: 'aaa', to: 'bbb', territory: { admin1: ['AAA-9'] } },
      ]),
    ).toThrow('move aaa → bbb: no admin-1 row AAA-9');
  });
});
