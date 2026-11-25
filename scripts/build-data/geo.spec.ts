import { describe, expect, it } from 'vitest';
import { square } from './fixtures/geometry';
import type { MultiPolygon, Polygon } from 'geojson';
import { areaContains, bboxOf, distanceToEdgeKm, haversineKm } from './geo';

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

describe('areaContains', () => {
  it('finds a point on either side of ±180 in a split polygon', () => {
    const box = bboxOf(SPLIT);
    expect(areaContains(SPLIT, box, 179.5, 0.5)).toBe(true);
    expect(areaContains(SPLIT, box, -179.5, 0.5)).toBe(true);
    expect(areaContains(SPLIT, box, 0, 0.5)).toBe(false);
  });
});

describe('distanceToEdgeKm', () => {
  it('measures across ±180 to a split polygon', () => {
    expect(distanceToEdgeKm(SPLIT, -178.5, 0.5)).toBeCloseTo(55.6, 0);
    expect(distanceToEdgeKm(SPLIT, 178.5, 0.5)).toBeCloseTo(55.6, 0);
    expect(distanceToEdgeKm(SPLIT, 180, 1.5)).toBeCloseTo(55.6, 0);
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

describe('haversineKm', () => {
  it('gives great-circle km', () => {
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.2, 0);
  });
});
