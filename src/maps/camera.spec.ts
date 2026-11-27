import { describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import {
  boundsCentre,
  featureSpanKm,
  MIN_COS_LAT,
  NEIGHBOURHOOD_VIEW_KM,
  pairBounds,
  spanZoom,
  TILE_PX,
  unionBounds,
} from './camera';
import { EARTH_RADIUS_KM, type AreaFeature } from './geo';
import { MAX_ZOOM } from './globeLayers';

const CIRCUMFERENCE_KM = 2 * Math.PI * EARTH_RADIUS_KM;

describe('[GLB-20, GLB-C13] spanZoom', () => {
  it('is zoom 0 when 512 px show the equator’s whole circumference', () => {
    expect(spanZoom(CIRCUMFERENCE_KM, 512, 0)).toBeCloseTo(0, 9);
  });

  it('goes up one level for half the span or twice the pixels', () => {
    const base = spanZoom(600, 400, 0);
    expect(spanZoom(300, 400, 0)).toBeCloseTo(base + 1, 9);
    expect(spanZoom(600, 800, 0)).toBeCloseTo(base + 1, 9);
  });

  it('is one level lower at 60°, where the globe is drawn twice as big at a zoom', () => {
    expect(spanZoom(600, 400, 60)).toBeCloseTo(spanZoom(600, 400, 0) - 1, 9);
    expect(spanZoom(600, 400, -60)).toBeCloseTo(spanZoom(600, 400, 60), 9);
  });

  it('shows about 600 km across a phone-sized globe at a city-scale zoom', () => {
    const zoom = spanZoom(600, 390, 48.85);
    expect(zoom).toBeGreaterThan(4);
    expect(zoom).toBeLessThan(6);
  });

  it('stays finite at the pole', () => {
    expect(Number.isFinite(spanZoom(600, 400, 90))).toBe(true);
  });

  it('caps at the map’s zoom-in limit, and gives it for a span or size it cannot use', () => {
    expect(spanZoom(0.001, 400, 0)).toBe(MAX_ZOOM);
    for (const [km, px] of [
      [0, 400],
      [-5, 400],
      [600, 0],
      [Number.NaN, 400],
      [600, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(spanZoom(km, px, 0)).toBe(MAX_ZOOM);
    }
  });
});

describe('[GLB-20, GLB-C13] pairBounds', () => {
  it('bounds two points whichever comes first', () => {
    const expected = [
      [-74, 40.7],
      [2.35, 48.85],
    ];
    expect(pairBounds([-74, 40.7], [2.35, 48.85])).toEqual(expected);
    expect(pairBounds([2.35, 48.85], [-74, 40.7])).toEqual(expected);
  });

  it('crosses the antimeridian the short way, east above 180', () => {
    expect(pairBounds([179, -16], [-179, -18])).toEqual([
      [179, -18],
      [181, -16],
    ]);
  });

  it('is a single point for the same point twice', () => {
    expect(pairBounds([10, 20], [10, 20])).toEqual([
      [10, 20],
      [10, 20],
    ]);
  });
});

describe('[GLB-20, GLB-C13] unionBounds', () => {
  it('holds both boxes', () => {
    expect(
      unionBounds(
        [
          [0, 40],
          [10, 50],
        ],
        [
          [5, 30],
          [20, 45],
        ],
      ),
    ).toEqual([
      [0, 30],
      [20, 50],
    ]);
  });

  it('joins boxes either side of the antimeridian across it, not round the world', () => {
    // Fiji-like bounds (east above 180) and a tap just west of the line in the -180 form.
    const [[w], [e]] = unionBounds(
      [
        [177, -20],
        [181, -16],
      ],
      [
        [-178, -18],
        [-178, -18],
      ],
    );
    expect(w).toBe(177);
    expect(e).toBe(182);
  });
});

describe('[GLB-C13] camera constants', () => {
  it('has the neighbourhood span, the tile size and the polar floor the spec states', () => {
    expect(NEIGHBOURHOOD_VIEW_KM).toBe(600);
    expect(TILE_PX).toBe(512);
    expect(MIN_COS_LAT).toBe(0.01);
    // Past about 89.4° the span is measured as if at cos(lat) = 0.01.
    const floorLat = (Math.acos(MIN_COS_LAT) * 180) / Math.PI;
    expect(spanZoom(600, 400, 90)).toBeCloseTo(spanZoom(600, 400, floorLat), 9);
  });
});

/** A clockwise lng/lat box as a feature. */
function box(w: number, s: number, e: number, n: number): AreaFeature {
  const ring = [
    [w, s],
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ];
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [ring] } as Polygon,
  };
}

const kmPerDegree = (Math.PI / 180) * EARTH_RADIUS_KM;

describe('[GLB-C13] boundsCentre', () => {
  it('is the middle of the bounds in longitude and latitude', () => {
    expect(
      boundsCentre([
        [10, 40],
        [20, 50],
      ]),
    ).toEqual([15, 45]);
  });

  it('wraps a centre of bounds across 180° (east above 180) into [-180, 180)', () => {
    expect(
      boundsCentre([
        [170, -10],
        [200, 10],
      ]),
    ).toEqual([-175, 0]);
    expect(
      boundsCentre([
        [160, 0],
        [190, 20],
      ]),
    ).toEqual([175, 10]);
    expect(
      boundsCentre([
        [170, 0],
        [190, 0],
      ]),
    ).toEqual([-180, 0]);
  });
});

describe('[GLB-C13] featureSpanKm', () => {
  // A box's edges are great circles, so its bounds bulge a little toward the pole: compare loosely.
  it('is the height for a tall feature', () => {
    expect(featureSpanKm(box(0, 0, 2, 10)) / (10 * kmPerDegree)).toBeCloseTo(1, 2);
  });

  it('is the width along the middle latitude for a wide feature', () => {
    const cosMid = Math.cos((41 * Math.PI) / 180);
    expect(featureSpanKm(box(0, 40, 20, 42)) / (20 * cosMid * kmPerDegree)).toBeCloseTo(1, 1);
  });

  it('measures a feature across the antimeridian by its own width, not the world’s', () => {
    expect(featureSpanKm(box(170, -5, 190, 5)) / (20 * kmPerDegree)).toBeCloseTo(1, 1);
  });
});
