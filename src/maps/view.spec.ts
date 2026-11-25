import { geoDistance } from 'd3-geo';
import { describe, expect, it } from 'vitest';
import type { AreaFeature, LngLat } from './geo';
import {
  GLOBE_FILL,
  IDENTITY,
  MAP_PADDING,
  MAP_SIZE,
  NEUTRAL_VIEW,
  fitFlat,
  globeProjection,
  panFlat,
  parseView,
  revealView,
  rotateGlobe,
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

  it('projects the view centre to the canvas centre and inverts it back', () => {
    const p = globeProjection({ lng: 30, lat: -10, zoom: 2 }, 400, 300);
    const [x, y] = p([30, -10])!;
    expect(x).toBeCloseTo(200);
    expect(y).toBeCloseTo(150);
    const [lng, lat] = p.invert!([200, 150])!;
    expect(lng).toBeCloseTo(30);
    expect(lat).toBeCloseTo(-10);
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
