import { geoDistance, geoPath } from 'd3-geo';
import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { mainPart, type AreaFeature, type LngLat } from './geo';
import {
  GLOBE_FILL,
  IDENTITY,
  MAP_PADDING,
  MAP_SIZE,
  NEUTRAL_VIEW,
  fitFlat,
  fitGlobe,
  inFlatFrame,
  outlineFrame,
  panFlat,
  parseView,
  revealFlat,
  revealView,
  rotateGlobe,
  smallTargetRings,
  unapply,
  wheelFactor,
  wrapLng,
  zoomFlat,
  zoomGlobe,
} from './view';

const box = (w: number, s: number, e: number, n: number): AreaFeature => ({
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [w, s],
        [w, n],
        [e, n],
        [e, s],
        [w, s],
      ],
    ],
  },
});

describe('globe view', () => {
  it('wraps longitude into [-180, 180)', () => {
    expect(wrapLng(190)).toBe(-170);
    expect(wrapLng(-190)).toBe(170);
    expect(wrapLng(180)).toBe(-180);
    expect(wrapLng(45)).toBe(45);
  });

  it('drags the surface with the pointer: right moves the centre west, down moves it north', () => {
    const radius = 180 / Math.PI; // 1 degree per px
    const v = rotateGlobe(NEUTRAL_VIEW, 10, 5, radius);
    expect(v.lng).toBeCloseTo(-10);
    expect(v.lat).toBeCloseTo(25);
    expect(v.zoom).toBe(1);
  });

  it('clamps latitude to ±90', () => {
    const radius = 180 / Math.PI;
    expect(rotateGlobe(NEUTRAL_VIEW, 0, 500, radius).lat).toBe(90);
    expect(rotateGlobe(NEUTRAL_VIEW, 0, -500, radius).lat).toBe(-90);
  });

  it('clamps zoom to 1–64', () => {
    expect(zoomGlobe(NEUTRAL_VIEW, 0.5).zoom).toBe(1);
    expect(zoomGlobe({ ...NEUTRAL_VIEW, zoom: 40 }, 2).zoom).toBe(64);
    expect(zoomGlobe(NEUTRAL_VIEW, 3).zoom).toBe(3);
  });

  it('wheels in on a negative delta and out on a positive one', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(0)).toBe(1);
  });
});

describe('parseView', () => {
  it('reads lng,lat,zoom', () => {
    expect(parseView('10,30,2')).toEqual({ lng: 10, lat: 30, zoom: 2 });
  });

  it('clamps out-of-range values', () => {
    expect(parseView('190,100,999')).toEqual({ lng: -170, lat: 90, zoom: 64 });
  });

  it('rejects anything but three numbers', () => {
    for (const bad of [null, '', '1,2', '1,2,3,4', 'a,b,c', '1,,2']) {
      expect(parseView(bad)).toBeUndefined();
    }
  });
});

describe('revealView', () => {
  const answer: LngLat = [10, 40];

  it('centres on the answer and keeps the zoom when the pin shows', () => {
    expect(revealView({ lng: -50, lat: 0, zoom: 2 }, answer, [12, 41])).toEqual({
      lng: 10,
      lat: 40,
      zoom: 2,
    });
  });

  it('centres on the answer when there is no pin', () => {
    expect(revealView({ lng: 0, lat: 0, zoom: 5 }, answer, null)).toEqual({
      lng: 10,
      lat: 40,
      zoom: 5,
    });
  });

  it('zooms out until a far pin is on screen', () => {
    const pin: LngLat = [40, 40];
    const v = revealView({ lng: 0, lat: 0, zoom: 30 }, answer, pin);
    expect([v.lng, v.lat]).toEqual(answer);
    expect(v.zoom).toBeLessThan(30);
    // The pin projects inside the canvas's half-side.
    const theta = geoDistance(answer, pin);
    expect(GLOBE_FILL * v.zoom * Math.sin(theta)).toBeLessThanOrEqual(1);
  });

  it('centres between answer and pin when they are too far apart to share a view otherwise', () => {
    const pin: LngLat = [-160, -35]; // nearly antipodal
    const v = revealView({ lng: 0, lat: 0, zoom: 8 }, answer, pin);
    expect(v.zoom).toBe(1);
    const centre: LngLat = [v.lng, v.lat];
    expect(geoDistance(centre, answer)).toBeLessThan(Math.PI / 2);
    expect(geoDistance(centre, pin)).toBeLessThan(Math.PI / 2);
  });

  it('centres on the answer, zoomed out, when the pin is exactly antipodal', () => {
    const pin: LngLat = [-170, -40]; // the antipode of [10, 40]
    expect(revealView({ lng: 0, lat: 0, zoom: 8 }, answer, pin)).toEqual({
      lng: 10,
      lat: 40,
      zoom: 1,
    });
  });
});

describe('flat maps', () => {
  it('fits features inside the padded square', () => {
    const f = box(-10, -5, 30, 20);
    const p = fitFlat([f]);
    for (const corner of [
      [-10, -5],
      [30, 20],
      [-10, 20],
      [30, -5],
    ] as LngLat[]) {
      const [x, y] = p(corner)!;
      for (const v of [x, y]) {
        expect(v).toBeGreaterThanOrEqual(MAP_PADDING - 1e-6);
        expect(v).toBeLessThanOrEqual(MAP_SIZE - MAP_PADDING + 1e-6);
      }
    }
  });

  it('keeps a feature across the antimeridian in one piece', () => {
    const p = fitFlat([box(170, -20, -170 + 360, -10)].map((f) => f)); // 170..190
    const [x1] = p([171, -15])!;
    const [x2] = p([-171, -15])!;
    expect(Math.abs(x2 - x1)).toBeLessThan(MAP_SIZE);
    expect(x2).toBeGreaterThan(x1);
  });

  it('zooms about a point that stays put, clamped to 1–16', () => {
    const t = zoomFlat(IDENTITY, 4, 100, 200);
    expect(t.k).toBe(4);
    expect(unapply(t, [100, 200])).toEqual([100, 200]);
    expect(zoomFlat(t, 100, 0, 0).k).toBe(16);
    expect(zoomFlat(t, 0.01, 0, 0)).toEqual(IDENTITY);
  });

  it('pans only as far as keeps the map covering the view', () => {
    expect(panFlat(IDENTITY, 50, 50)).toEqual(IDENTITY);
    const zoomed = zoomFlat(IDENTITY, 2, 0, 0);
    expect(panFlat(zoomed, -100, 0).x).toBe(-100);
    expect(panFlat(zoomed, -10_000, 0).x).toBe(MAP_SIZE - 2 * MAP_SIZE);
  });
});

describe('inFlatFrame', () => {
  const frame = box(0, 40, 10, 50);

  it('is true for a point inside the frame and one just off its coast', () => {
    expect(inFlatFrame(frame, [5, 45])).toBe(true);
    expect(inFlatFrame(frame, [10.2, 45])).toBe(true);
  });

  it('is false for a point far outside the frame, or round the back of the globe', () => {
    expect(inFlatFrame(frame, [55, -21])).toBe(false);
    expect(inFlatFrame(frame, [-175, -45])).toBe(false);
  });
});

describe('outlineFrame', () => {
  const ring = (w: number, s: number, e: number, n: number): LngLat[][] => [
    [
      [w, s],
      [w, n],
      [e, n],
      [e, s],
      [w, s],
    ],
  ];
  const island: AreaFeature = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPolygon', coordinates: [ring(0, 40, 10, 50), ring(60, -21, 61, -20)] },
  };

  it('is the main part with no point, or a point inside its frame', () => {
    const main = mainPart(island);
    expect(main).not.toBe(island);
    expect(outlineFrame(island)).toEqual([main]);
    expect(outlineFrame(island, [5, 45])).toEqual([main]);
  });

  it('is the far part holding a point outside the main frame', () => {
    const [far, ...rest] = outlineFrame(island, [60.5, -20.5]);
    expect(rest).toEqual([]);
    expect(far!.geometry).toEqual({ type: 'MultiPolygon', coordinates: [ring(60, -21, 61, -20)] });
  });

  it('adds a disc at a point that is off every part of the feature', () => {
    const at: LngLat = [30, 0];
    const frame = outlineFrame(island, at);
    expect(frame).toHaveLength(2);
    const p = fitFlat(frame)(at)!;
    expect(p.every((v) => v >= 0 && v <= MAP_SIZE)).toBe(true);
  });
});

describe('revealFlat', () => {
  const screen = (t: { k: number; x: number; y: number }, [x, y]: [number, number]) => [
    x * t.k + t.x,
    y * t.k + t.y,
  ];
  const onScreen = (p: number[]) => p.every((v) => v >= 0 && v <= MAP_SIZE);

  it('keeps the transform when both points are on screen with a margin', () => {
    const t = { k: 2, x: -100, y: -100 };
    expect(revealFlat(t, [150, 150], [200, 220])).toBe(t);
  });

  it('keeps the zoom and centres on the midpoint when both fit but one is off screen', () => {
    const t = { k: 4, x: 0, y: 0 };
    const r = revealFlat(t, [300, 300], [330, 310]);
    expect(r.k).toBe(4);
    expect(screen(r, [315, 305])).toEqual([MAP_SIZE / 2, MAP_SIZE / 2]);
  });

  it('zooms out until both points show', () => {
    const a: [number, number] = [200, 200];
    const b: [number, number] = [400, 300];
    const r = revealFlat({ k: 16, x: -3000, y: -3000 }, a, b);
    expect(r.k).toBeLessThan(16);
    expect(r.k).toBeGreaterThanOrEqual(1);
    expect(onScreen(screen(r, a))).toBe(true);
    expect(onScreen(screen(r, b))).toBe(true);
  });

  it('never zooms in, and clamps the pan to the map', () => {
    expect(revealFlat({ k: 1, x: 0, y: 0 }, [5, 5], [5, 5])).toEqual({ k: 1, x: 0, y: 0 });
    const z = revealFlat({ k: 8, x: -3000, y: -3000 }, [10, 10], [12, 12]);
    expect(z.x).toBeLessThanOrEqual(0);
    expect(z.x).toBeGreaterThanOrEqual(MAP_SIZE - MAP_SIZE * z.k);
    expect(onScreen(screen(z, [10, 10]))).toBe(true);
  });
});

describe('smallTargetRings', () => {
  const multi = (...parts: AreaFeature[]): AreaFeature => ({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiPolygon',
      coordinates: parts.map((p) => (p.geometry as Polygon).coordinates),
    },
  });
  // About 11 viewBox units per degree at this fit: a 0.1° island is about 1 unit across.
  const path = geoPath(fitFlat([box(0, 0, 40, 40)]));

  it('gives no ring for a target big enough to see', () => {
    expect(smallTargetRings(path, box(10, 10, 20, 20), 16, 16)).toEqual([]);
  });

  it('rings a tiny target at its centre', () => {
    const island = box(20, 20, 20.1, 20.1);
    const rings = smallTargetRings(path, island, 16, 16);
    expect(rings).toHaveLength(1);
    const [x, y] = path.centroid(island);
    expect(rings[0]![0]).toBeCloseTo(x, 0);
    expect(rings[0]![1]).toBeCloseTo(y, 0);
  });

  it('rings each far-apart island of a spread archipelago once, merging near ones', () => {
    const atolls = multi(
      box(2, 2, 2.1, 2.1),
      box(2.2, 2.2, 2.3, 2.3), // its ring would overlap the first's: merged
      box(35, 35, 35.1, 35.1),
    );
    expect(smallTargetRings(path, atolls, 16, 16)).toHaveLength(2);
  });

  it('skips parts the path does not draw (behind the globe)', () => {
    const globe = geoPath(fitGlobe([0, 0]));
    const both = multi(box(0, 0, 0.1, 0.1), box(179.9, 0, 180, 0.1));
    expect(smallTargetRings(globe, both, 16, 16)).toHaveLength(1);
  });
});
