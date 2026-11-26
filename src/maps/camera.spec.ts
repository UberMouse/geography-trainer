import { describe, expect, it } from 'vitest';
import { pairBounds, spanZoom } from './camera';
import { EARTH_RADIUS_KM } from './geo';
import { MAX_ZOOM } from './globeLayers';

const CIRCUMFERENCE_KM = 2 * Math.PI * EARTH_RADIUS_KM;

describe('spanZoom', () => {
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

describe('pairBounds', () => {
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
