import { describe, expect, it } from 'vitest';
import { geoArea, geoCentroid } from 'd3-geo';
import { answerPoint, mainPart, measureTap, type AreaFeature, type LngLat } from './geo';

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

describe('answerPoint', () => {
  it('is the centroid of the main part, not of the far parts too', () => {
    const f = parts([0, -5, 10, 5], [40, 0, 41, 1]);
    const [lng, lat] = answerPoint(f);
    expect(lng).toBeCloseTo(5, 6);
    expect(lat).toBeCloseTo(0, 6);
    expect(geoCentroid(f)[0]).toBeGreaterThan(5.1);
  });
});
