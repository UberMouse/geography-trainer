import { describe, expect, it } from 'vitest';
import { geoArea, geoCentroid, geoContains } from 'd3-geo';
import {
  POINT_FEATURE_RADIUS_KM,
  answerPoint,
  ensureArea,
  frameTest,
  mainPart,
  measureTap,
  midpoint,
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

  it('counts a tap in an alsoInside feature as inside, 0 km outside the border', () => {
    const twin = poly([
      [20, -5],
      [20, 5],
      [30, 5],
      [30, -5],
      [20, -5],
    ]);
    const m = measureTap({ ...target, alsoInside: [twin] }, [25, 0]);
    expect(m.inside).toBe(true);
    expect(m.kmOutsideBorder).toBe(0);
    expect(m.kmFromAnswer).toBeGreaterThan(2700);
    expect(measureTap({ ...target, alsoInside: [twin] }, [15, 0]).inside).toBe(false);
  });

  it('measures a tap outside everything to the nearest of the target and its alsoInside', () => {
    const twin = poly([
      [20, -5],
      [20, 5],
      [30, 5],
      [30, -5],
      [20, -5],
    ]);
    const alone = measureTap(target, [15, 0]);
    const withTwin = measureTap({ ...target, alsoInside: [twin] }, [15, 0]);
    // 5 degrees from the twin's west edge, 10 from the target's east edge.
    expect(withTwin.kmOutsideBorder).toBeCloseTo(5 * KM_PER_DEG, -1);
    expect(withTwin.kmOutsideBorder).toBeLessThan(alone.kmOutsideBorder);
    expect(withTwin.kmFromAnswer).toBeCloseTo(alone.kmFromAnswer, 6);
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

describe('frameTest', () => {
  // 10 x 10 degrees, clockwise.
  const frame = poly([
    [0, 40],
    [0, 50],
    [10, 50],
    [10, 40],
    [0, 40],
  ]);
  const inside = frameTest(frame);

  it('is true for a point inside the frame and one just off its coast', () => {
    expect(inside([5, 45])).toBe(true);
    expect(inside([10.2, 45])).toBe(true);
  });

  it('is false for a point far outside the frame, or round the back of the globe', () => {
    expect(inside([55, -21])).toBe(false);
    expect(inside([-175, -45])).toBe(false);
  });

  it('gives the same answers however many points one test is asked about, in any order', () => {
    const points: LngLat[] = [
      [-175, -45],
      [5, 45],
      [55, -21],
      [10.2, 45],
    ];
    expect(points.map(inside)).toEqual(points.map((p) => frameTest(frame)(p)));
    expect(points.map(inside)).toEqual([false, true, false, true]);
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

  it('is inside a C whose centroid is in its mouth', () => {
    // A C opening east: spine at the west, arms along the north and south, hollow in the middle.
    const c = poly([
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 8],
      [2, 8],
      [2, 2],
      [10, 2],
      [10, 0],
      [0, 0],
    ]);
    expect(geoContains(c, geoCentroid(c))).toBe(false);
    const at = answerPoint(c);
    expect(geoContains(c, at)).toBe(true);
    expect(answerPoint(c)).toBe(at);
  });

  it('is inside a sliver thinner than a grid cell whose centroid is outside it', () => {
    // A V, 0.00001 degrees wide and 0.1 degrees across: the centroid is in the notch, and the
    // search grid (0.005 degrees) steps over the arms.
    const v = poly([
      [0, 0.1],
      [0.00001, 0.1],
      [0.0513, 0.0002],
      [0.10299, 0.1],
      [0.103, 0.1],
      [0.0513, 0],
      [0, 0.1],
    ]);
    expect(geoContains(v, geoCentroid(v))).toBe(false);
    expect(geoContains(v, answerPoint(v))).toBe(true);
  });

  it('is inside a feature that crosses the antimeridian', () => {
    // The same C shape, spanning 175E to 175W.
    const c = poly([
      [175, 0],
      [175, 10],
      [-175, 10],
      [-175, 8],
      [177, 8],
      [177, 2],
      [-175, 2],
      [-175, 0],
      [175, 0],
    ]);
    expect(geoContains(c, geoCentroid(c))).toBe(false);
    expect(geoContains(c, answerPoint(c))).toBe(true);
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

  it('gives a point its own radiusKm, and the fallback when that is not a positive number', () => {
    const dot = (radiusKm?: unknown) =>
      ensureArea({
        type: 'Feature',
        id: 'dot',
        properties: { radiusKm },
        geometry: { type: 'Point', coordinates: [-63.237, 17.633] },
      });
    // Feature size is sqrt(area) in km: a disc of radius r is sqrt(pi) * r.
    const sizeKm = (f: AreaFeature) => Math.sqrt(geoArea(f)) * 6371;
    expect(sizeKm(dot(5))).toBeGreaterThan(0.95 * Math.sqrt(Math.PI) * 5);
    expect(sizeKm(dot(5))).toBeLessThan(1.05 * Math.sqrt(Math.PI) * 5);
    const fallback = sizeKm(dot());
    expect(fallback).toBeCloseTo(Math.sqrt(Math.PI) * POINT_FEATURE_RADIUS_KM, 1);
    for (const bad of [0, -3, NaN, Infinity, '5'])
      expect(sizeKm(dot(bad))).toBeCloseTo(fallback, 6);
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

  it('finds a centre for a zero-area MultiPolygon whose centroid is not finite', () => {
    // A NaN vertex makes d3's centroid NaN; the one finite vertex is the fallback centre.
    const line: LngLat[] = [
      [NaN, NaN],
      [12.45, 41.9],
      [NaN, NaN],
    ];
    const f: AreaFeature = {
      type: 'Feature',
      id: 'dot',
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [[line]] },
    };
    expect(geoCentroid(f).every(Number.isFinite)).toBe(false);
    const out = ensureArea(f);
    expect(geoArea(out)).toBeGreaterThan(0.9 * disc);
    expect(geoContains(out, [12.45, 41.9])).toBe(true);
  });

  it('names a feature with no finite coordinate', () => {
    const f: AreaFeature = {
      type: 'Feature',
      id: 'nowhere',
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: [[[[NaN, NaN]]]] },
    };
    expect(() => ensureArea(f)).toThrow(/nowhere/);
  });
});

describe('midpoint', () => {
  it('is halfway along the great circle', () => {
    const [lng, lat] = midpoint([0, 0], [90, 0]);
    expect(lng).toBeCloseTo(45, 6);
    expect(lat).toBeCloseTo(0, 6);
    // Along a meridian through the pole, not along the parallel.
    expect(midpoint([0, 60], [180, 60])[1]).toBeCloseTo(90, 6);
  });

  it('crosses the antimeridian the short way, its longitude in [-180, 180]', () => {
    const [lng, lat] = midpoint([170, 10], [-170, 10]);
    expect(Math.abs(lng)).toBeCloseTo(180, 6);
    expect(lng).toBeGreaterThanOrEqual(-180);
    expect(lng).toBeLessThanOrEqual(180);
    expect(lat).toBeGreaterThan(10);
    const [west] = midpoint([175, 0], [-165, 0]);
    expect(west).toBeCloseTo(-175, 6);
  });
});
