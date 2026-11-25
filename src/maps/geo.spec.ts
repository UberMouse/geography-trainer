import { describe, expect, it } from 'vitest';
import {
  geoArea,
  geoAzimuthalEqualArea,
  geoCentroid,
  geoContains,
  geoEquirectangular,
  geoMercator,
  geoOrthographic,
} from 'd3-geo';
import {
  POINT_FEATURE_RADIUS_KM,
  answerPoint,
  clusterAt,
  ensureArea,
  isOnFarSide,
  mainPart,
  measureTap,
  type AreaFeature,
  type LngLat,
} from './geo';

/** A polygon feature from rings (exterior clockwise, holes counter-clockwise, as d3-geo wants). */
const poly = (...rings: LngLat[][]): AreaFeature => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: rings },
});

const KM_PER_DEG = (Math.PI * 6371) / 180; // ~111.19

// 10 x 10 degrees at the equator, clockwise.
const square = poly([
  [-5, -5],
  [-5, 5],
  [5, 5],
  [5, -5],
  [-5, -5],
]);

describe('measureTap on a polygon', () => {
  const target = { feature: square, answer: answerPoint(square) };

  it('has an answer point at the centroid', () => {
    const [lng, lat] = answerPoint(square);
    expect(lng).toBeCloseTo(0, 6);
    expect(lat).toBeCloseTo(0, 6);
  });

  it('puts a tap at the centre inside, 0 km outside the border', () => {
    const m = measureTap(target, [0, 0]);
    expect(m.inside).toBe(true);
    expect(m.kmOutsideBorder).toBe(0);
    expect(m.kmFromAnswer).toBeCloseTo(0, 6);
  });

  it('measures a tap east of the east edge to the edge, not a vertex', () => {
    const m = measureTap(target, [6, 0]);
    expect(m.inside).toBe(false);
    expect(m.kmOutsideBorder).toBeGreaterThan(109);
    expect(m.kmOutsideBorder).toBeLessThan(113);
    expect(m.kmFromAnswer).toBeCloseTo(6 * KM_PER_DEG, 0);
    // The nearest vertex is (5, 5): about 5 degrees away, far more than the edge distance.
    expect(m.kmOutsideBorder).toBeLessThan(2 * KM_PER_DEG);
  });

  it('measures featureSizeKm as sqrt(area) times the Earth radius', () => {
    const m = measureTap(target, [0, 0]);
    expect(m.featureSizeKm).toBeGreaterThan(1110 * 0.97);
    expect(m.featureSizeKm).toBeLessThan(1110 * 1.03);
    expect(m.featureSizeKm).toBeCloseTo(Math.sqrt(geoArea(square)) * 6371, 6);
  });

  it('measures to the nearest edge beyond a corner', () => {
    // Diagonal from the corner (5, 5): the corner itself is the nearest point.
    const m = measureTap(target, [6, 6]);
    expect(m.kmOutsideBorder).toBeGreaterThan(150);
    expect(m.kmOutsideBorder).toBeLessThan(160);
  });

  it('measures a tap in a hole to the hole ring', () => {
    const holed = poly(
      [
        [-5, -5],
        [-5, 5],
        [5, 5],
        [5, -5],
        [-5, -5],
      ],
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
      ],
    );
    const m = measureTap({ feature: holed, answer: [0, 0] }, [0.5, 0]);
    expect(m.inside).toBe(false);
    expect(m.kmOutsideBorder).toBeGreaterThan(0.5 * KM_PER_DEG * 0.98);
    expect(m.kmOutsideBorder).toBeLessThan(0.5 * KM_PER_DEG * 1.02);
  });

  it('handles a feature spanning the antimeridian', () => {
    const wrap = poly([
      [175, -5],
      [175, 5],
      [-175, 5],
      [-175, -5],
      [175, -5],
    ]);
    const t = { feature: wrap, answer: [180, 0] as LngLat };
    expect(measureTap(t, [180, 0]).inside).toBe(true);
    const m = measureTap(t, [-174, 0]);
    expect(m.inside).toBe(false);
    expect(m.kmOutsideBorder).toBeGreaterThan(109);
    expect(m.kmOutsideBorder).toBeLessThan(113);
  });

  it('handles a MultiPolygon', () => {
    const multi: AreaFeature = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [-5, -5],
              [-5, 5],
              [5, 5],
              [5, -5],
              [-5, -5],
            ],
          ],
          [
            [
              [20, -5],
              [20, 5],
              [30, 5],
              [30, -5],
              [20, -5],
            ],
          ],
        ],
      },
    };
    const m = measureTap({ feature: multi, answer: [0, 0] }, [19, 0]);
    expect(m.inside).toBe(false);
    expect(m.kmOutsideBorder).toBeGreaterThan(109);
    expect(m.kmOutsideBorder).toBeLessThan(113);
  });
});

describe('measureTap on a place', () => {
  it('measures great-circle km to the point, London to Paris about 344 km', () => {
    const london: LngLat = [-0.1278, 51.5074];
    const paris: LngLat = [2.3522, 48.8566];
    const m = measureTap({ point: paris }, london);
    expect(m.kmFromAnswer).toBeGreaterThan(339);
    expect(m.kmFromAnswer).toBeLessThan(349);
    expect(m.inside).toBe(false);
    expect(m.kmOutsideBorder).toBe(0);
    expect(m.featureSizeKm).toBe(0);
  });
});

/** A clockwise box ring from west, south, east, north. */
const ring = (w: number, s: number, e: number, n: number): LngLat[] => [
  [w, s],
  [w, n],
  [e, n],
  [e, s],
  [w, s],
];

/** A MultiPolygon feature with an id and properties, one polygon per box. */
const parts = (...boxes: [number, number, number, number][]) =>
  ({
    type: 'Feature',
    id: 'x',
    properties: { name: 'X' },
    geometry: { type: 'MultiPolygon', coordinates: boxes.map((b) => [ring(...b)]) },
  }) as AreaFeature & { id: string };

describe('measureTap with a far part', () => {
  it('sizes the target by its main part but counts the far part as inside', () => {
    const f = parts([0, -5, 10, 5], [40, 0, 41, 1]);
    const main = measureTap({ feature: mainPart(f), answer: [5, 0] }, [5, 0]);
    const m = measureTap({ feature: f, answer: [5, 0] }, [40.5, 0.5]);
    expect(m.featureSizeKm).toBeCloseTo(main.featureSizeKm, 6);
    expect(m.featureSizeKm).toBeLessThan(11 * KM_PER_DEG);
    expect(m.inside).toBe(true);
  });
});

describe('mainPart', () => {
  it('returns a single polygon feature itself', () => {
    expect(mainPart(square)).toBe(square);
  });

  it('keeps parts closer than the gap together (about 220 km apart)', () => {
    const f = parts([0, -5, 10, 5], [12, 0, 13, 1]);
    expect(mainPart(f)).toBe(f);
  });

  it('drops a far small part, keeping id and properties', () => {
    const f = parts([0, -5, 10, 5], [40, 0, 41, 1]);
    const main = mainPart(f);
    expect(main.id).toBe('x');
    expect(main.properties).toBe(f.properties);
    expect(main.geometry).toEqual({ type: 'MultiPolygon', coordinates: [[ring(0, -5, 10, 5)]] });
  });

  it('keeps an evenly spread archipelago whole', () => {
    const f = parts([0, 0, 1, 1], [20, 0, 21, 1], [40, 0, 41, 1]);
    expect(mainPart(f)).toBe(f);
  });

  it('ignores polygons with no rings (collapsed by quantization)', () => {
    const f = parts([0, -5, 10, 5]);
    (f.geometry.coordinates as LngLat[][][]).push([]);
    expect(mainPart(f)).toBe(f);
  });

  it('is cached per feature object', () => {
    const f = parts([0, -5, 10, 5], [40, 0, 41, 1]);
    expect(mainPart(f)).toBe(mainPart(f));
  });
});

describe('clusterAt', () => {
  const f = parts([0, -5, 10, 5], [40, 0, 41, 1]);

  it('returns the cluster holding the point, with id and properties', () => {
    const far = clusterAt(f, [40.5, 0.5]);
    expect(far.id).toBe('x');
    expect(far.properties).toBe(f.properties);
    expect(far.geometry).toEqual({ type: 'MultiPolygon', coordinates: [[ring(40, 0, 41, 1)]] });
    expect(clusterAt(f, [5, 0]).geometry).toEqual({
      type: 'MultiPolygon',
      coordinates: [[ring(0, -5, 10, 5)]],
    });
  });

  it('falls back to the nearest cluster for a point in none', () => {
    expect(clusterAt(f, [45, 0]).geometry).toEqual(clusterAt(f, [40.5, 0.5]).geometry);
    expect(clusterAt(f, [-3, 0]).geometry).toEqual(clusterAt(f, [5, 0]).geometry);
  });

  it('returns a single-cluster feature itself', () => {
    expect(clusterAt(square, [50, 50])).toBe(square);
  });
});

describe('answerPoint', () => {
  it('is the centroid of the main part, not of the far parts too', () => {
    const f = parts([0, -5, 10, 5], [40, 0, 41, 1]);
    const [lng, lat] = answerPoint(f);
    expect(lng).toBeCloseTo(5, 6);
    expect(lat).toBeCloseTo(0, 6);
    expect(geoCentroid(f)[0]).toBeGreaterThan(5.1);
  });
});

describe('ensureArea', () => {
  const disc = Math.PI * (POINT_FEATURE_RADIUS_KM / 6371) ** 2; // steradians, near enough flat

  it('turns a point into a small disc around it, keeping id and properties', () => {
    const f = ensureArea({
      type: 'Feature',
      id: 'dot',
      properties: { name: 'Dot' },
      geometry: { type: 'Point', coordinates: [-68.26, 12.2] },
    });
    expect(f.id).toBe('dot');
    expect(f.properties).toEqual({ name: 'Dot' });
    expect(f.geometry.type).toBe('Polygon');
    expect(geoArea(f)).toBeGreaterThan(0.9 * disc);
    expect(geoArea(f)).toBeLessThan(1.1 * disc);
    expect(geoContains(f, [-68.26, 12.2])).toBe(true);
  });

  it('turns a polygon with no area into a disc at its centre', () => {
    const f = ensureArea(
      poly([
        [12.45, 41.9],
        [12.46, 41.9],
        [12.45, 41.9],
      ]),
    );
    expect(geoArea(f)).toBeGreaterThan(0.9 * disc);
    expect(geoArea(f)).toBeLessThan(1.1 * disc);
    expect(geoContains(f, [12.455, 41.9])).toBe(true);
  });

  it('returns a feature with an area as it is', () => {
    expect(ensureArea(square)).toBe(square);
  });
});

describe('isOnFarSide', () => {
  it('hides points beyond 90 degrees of the globe centre, not flat-map points', () => {
    const globe = geoOrthographic().rotate([-2, -46]);
    expect(isOnFarSide(globe, [2, 46])).toBe(false);
    expect(isOnFarSide(globe, [140, -30])).toBe(true);
    expect(isOnFarSide(geoAzimuthalEqualArea(), [140, -30])).toBe(false);
  });

  it('treats a projection with no clipping (clip angle 0) as flat', () => {
    expect(geoMercator().clipAngle()).toBe(0);
    expect(isOnFarSide(geoMercator().rotate([-2, -46]), [140, -30])).toBe(false);
    expect(isOnFarSide(geoEquirectangular().rotate([-2, -46]), [140, -30])).toBe(false);
  });
});
