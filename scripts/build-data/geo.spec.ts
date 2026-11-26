import { describe, expect, it } from 'vitest';
import { square } from './fixtures/geometry';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { MultiPolygon, Polygon } from 'geojson';
import { areaContains, bboxOf, distanceToEdgeKm, haversineKm, interiorPoint } from './geo';

// An island spanning lng 179..-179 (lat 0..1), split at ±180 as Natural Earth splits it.
const SPLIT: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [square(179, 0).coordinates, square(-180, 0).coordinates],
};
// The same island as one ring whose edges cross ±180.
const UNSPLIT: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [179, 0],
      [-179, 0],
      [-179, 1],
      [179, 1],
      [179, 0],
    ],
  ],
};

describe('[DAT-C12] areaContains', () => {
  it('finds a point on either side of ±180 in a split polygon', () => {
    const box = bboxOf(SPLIT);
    expect(areaContains(SPLIT, box, 179.5, 0.5)).toBe(true);
    expect(areaContains(SPLIT, box, -179.5, 0.5)).toBe(true);
    expect(areaContains(SPLIT, box, 0, 0.5)).toBe(false);
  });
});

describe('[DAT-C12] distanceToEdgeKm', () => {
  it('measures across ±180 to a split polygon', () => {
    expect(distanceToEdgeKm(SPLIT, -178.5, 0.5)).toBeCloseTo(55.6, 0);
    expect(distanceToEdgeKm(SPLIT, 178.5, 0.5)).toBeCloseTo(55.6, 0);
    expect(distanceToEdgeKm(SPLIT, 180, 1.5)).toBeCloseTo(55.6, 0);
  });

  it('ignores the ±180 cut edges of a split ring, measuring to the real coast', () => {
    // A Fiji-like island cut at 180: its part west of the cut spans lng 177..180, lat -18..-16.
    const west: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [177, -18],
          [180, -18],
          [180, -16],
          [177, -16],
          [177, -18],
        ],
      ],
    };
    // Just east of the cut, 2.7° of latitude (about 300 km) south of the coast at lat -18.
    expect(distanceToEdgeKm(west, -179.95, -20.7)).toBeCloseTo(300, -1);
    expect(distanceToEdgeKm(west, -179.95, -17)).toBeGreaterThan(100);
  });

  it('measures to an edge that crosses ±180 as the short edge', () => {
    expect(distanceToEdgeKm(UNSPLIT, 180, 1.5)).toBeCloseTo(55.6, 0);
    expect(distanceToEdgeKm(UNSPLIT, -179.5, -0.5)).toBeCloseTo(55.6, 0);
  });

  it('measures to the nearest edge', () => {
    // 0.5° of latitude north of a square's top edge.
    expect(distanceToEdgeKm(square(0, 0), 0.5, 1.5)).toBeCloseTo(55.6, 0);
  });

  it('does not shortcut through an edge on the far side of the globe', () => {
    // A square straddling the meridian 180° away from the point is about half the globe away.
    expect(distanceToEdgeKm(square(104.5, 18), -75, 18.5)).toBeGreaterThan(5000);
  });
});

describe('[DAT-C12] haversineKm', () => {
  it('gives great-circle km', () => {
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.2, 0);
  });
});

describe('[DAT-C12] interiorPoint', () => {
  const inStrictly = (area: Polygon | MultiPolygon, p: [number, number]) =>
    booleanPointInPolygon(p, area, { ignoreBoundary: true });

  it("keeps turf's point-on-feature when it is inside", () => {
    expect(interiorPoint(square(0, 0))).toEqual([0.5, 0.5]);
  });

  it('moves off an outline vertex turf falls back to', () => {
    // An L whose box centre (1, 1) is its inner corner.
    const ell: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 1],
          [1, 1],
          [1, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    };
    const p = interiorPoint(ell);
    expect(p).not.toEqual([1, 1]);
    expect(inStrictly(ell, p)).toBe(true);
  });

  it('finds a point when the centre of the box lies outside every polygon', () => {
    const islands: MultiPolygon = {
      type: 'MultiPolygon',
      coordinates: [square(0, 0, 0.5).coordinates, square(2, 2, 1).coordinates],
    };
    const p = interiorPoint(islands);
    expect(inStrictly(islands, p)).toBe(true);
  });
});
