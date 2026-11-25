import {
  geoAzimuthalEqualArea,
  geoCentroid,
  geoDistance,
  geoInterpolate,
  geoOrthographic,
} from 'd3-geo';
import type { AreaFeature, LngLat } from './geo';

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Wrap a longitude into [-180, 180). */
export const wrapLng = (lng: number) => ((((lng + 180) % 360) + 360) % 360) - 180;

// ---------------------------------------------------------------------------------------------
// Globe

/** The globe's view: the lng/lat at the centre of the disc and the zoom (1 = whole globe). */
export interface GlobeView {
  lng: number;
  lat: number;
  zoom: number;
}

export const GLOBE_MIN_ZOOM = 1;
export const GLOBE_MAX_ZOOM = 64;
/** Where a globe starts: a fixed neutral view, never centred on the answer. */
export const NEUTRAL_VIEW: GlobeView = { lng: 0, lat: 20, zoom: 1 };
/** The globe's radius at zoom 1, as a fraction of half the canvas's shorter side. */
export const GLOBE_FILL = 0.95;

/** Globe radius in px for a canvas of `width` × `height` at `zoom`. */
export const globeRadius = (width: number, height: number, zoom: number) =>
  (Math.min(width, height) / 2) * GLOBE_FILL * zoom;

/**
 * The view after dragging by `dx`, `dy` px on a globe of `radiusPx`: the surface follows the
 * pointer near the centre. Latitude is clamped to ±90°, longitude wrapped.
 */
export function rotateGlobe(view: GlobeView, dx: number, dy: number, radiusPx: number): GlobeView {
  const degPerPx = 180 / (Math.PI * radiusPx);
  return {
    ...view,
    lng: wrapLng(view.lng - dx * degPerPx),
    lat: clamp(view.lat + dy * degPerPx, -90, 90),
  };
}

export function zoomGlobe(view: GlobeView, factor: number): GlobeView {
  return { ...view, zoom: clamp(view.zoom * factor, GLOBE_MIN_ZOOM, GLOBE_MAX_ZOOM) };
}

/** Parse `lng,lat,zoom` (the playground's `?view=`). Undefined unless all three are numbers. */
export function parseView(text: string | null | undefined): GlobeView | undefined {
  if (!text) return undefined;
  const parts = text.split(',').map((s) => (s.trim() === '' ? NaN : Number(s)));
  if (parts.length !== 3 || !parts.every(Number.isFinite)) return undefined;
  const [lng, lat, zoom] = parts as [number, number, number];
  return {
    lng: wrapLng(lng),
    lat: clamp(lat, -90, 90),
    zoom: clamp(zoom, GLOBE_MIN_ZOOM, GLOBE_MAX_ZOOM),
  };
}

/**
 * A point at angle `theta` (radians) from the centre projects at `radius · sin(theta)`; keep it
 * inside this fraction of the half-side, so the pin and target are not drawn on the very edge.
 */
const REVEAL_MARGIN = 0.85;
/** Beyond this angle from the target, the pin cannot share the view with the target centred. */
const MAX_CENTRED_ANGLE = (80 * Math.PI) / 180;
/** Points closer than this (radians) to opposite sides of the globe count as antipodal. */
const ANTIPODAL_EPSILON = 1e-6;

/**
 * The view that reveals an answer: centred on `answer`, keeping the zoom unless `pin` would be
 * off-screen, then zoomed out until both show. When the pin is too far round the globe to show
 * with the answer centred, the view centres on the great-circle midpoint between them instead;
 * an antipodal pin (no midpoint) gets the answer centred at zoom 1.
 */
export function revealView(view: GlobeView, answer: LngLat, pin: LngLat | null): GlobeView {
  if (!pin) return { ...view, lng: answer[0], lat: answer[1] };
  const apart = geoDistance(answer, pin);
  // Antipodes have no midpoint and cannot share a view: show the answer, zoomed all the way out.
  if (Math.PI - apart < ANTIPODAL_EPSILON) {
    return { lng: wrapLng(answer[0]), lat: answer[1], zoom: GLOBE_MIN_ZOOM };
  }
  const centre = apart <= MAX_CENTRED_ANGLE ? answer : geoInterpolate(answer, pin)(0.5);
  const farthest = Math.max(geoDistance(centre, answer), geoDistance(centre, pin));
  const fits =
    Math.sin(farthest) > 0 ? REVEAL_MARGIN / (GLOBE_FILL * Math.sin(farthest)) : Infinity;
  return {
    lng: wrapLng(centre[0]),
    lat: clamp(centre[1], -90, 90),
    zoom: clamp(Math.min(view.zoom, fits), GLOBE_MIN_ZOOM, GLOBE_MAX_ZOOM),
  };
}

// ---------------------------------------------------------------------------------------------
// Flat maps (SVG): a fitted projection plus a zoom/pan transform on top

/** Every SVG map draws into this square viewBox; CSS scales it to the container. */
export const MAP_SIZE = 480;
export const MAP_PADDING = 16;

/**
 * An azimuthal equal-area projection centred on the features' centroid, fitted into the square
 * viewBox with padding. Centring on the features keeps maps that cross the antimeridian (Russia,
 * Fiji) in one piece.
 */
export function fitFlat(features: AreaFeature[], size = MAP_SIZE, padding = MAP_PADDING) {
  const collection = { type: 'FeatureCollection' as const, features };
  const [lng, lat] = geoCentroid(collection);
  return geoAzimuthalEqualArea()
    .rotate([-lng, -lat])
    .fitExtent(
      [
        [padding, padding],
        [size - padding, size - padding],
      ],
      collection,
    );
}

/** An orthographic globe rotated to `centre`, fitted into the square viewBox with padding. */
export function fitGlobe(centre: LngLat, size = MAP_SIZE, padding = MAP_PADDING) {
  return geoOrthographic()
    .rotate([-centre[0], -centre[1]])
    .fitExtent(
      [
        [padding, padding],
        [size - padding, size - padding],
      ],
      { type: 'Sphere' },
    );
}

/** Screen = k · map + (x, y), in viewBox units. */
export interface FlatTransform {
  k: number;
  x: number;
  y: number;
}

export const FLAT_MIN_ZOOM = 1;
export const FLAT_MAX_ZOOM = 16;
export const IDENTITY: FlatTransform = { k: 1, x: 0, y: 0 };

/** Keep the zoomed map covering the viewBox: no panning the map away into empty space. */
function clampPan(t: FlatTransform, size: number): FlatTransform {
  return { k: t.k, x: clamp(t.x, size - size * t.k, 0), y: clamp(t.y, size - size * t.k, 0) };
}

/** Zoom by `factor` about the viewBox point (`cx`, `cy`), which stays put. k stays in 1–16. */
export function zoomFlat(
  t: FlatTransform,
  factor: number,
  cx: number,
  cy: number,
  size = MAP_SIZE,
): FlatTransform {
  const k = clamp(t.k * factor, FLAT_MIN_ZOOM, FLAT_MAX_ZOOM);
  const s = k / t.k;
  return clampPan({ k, x: cx - (cx - t.x) * s, y: cy - (cy - t.y) * s }, size);
}

export function panFlat(t: FlatTransform, dx: number, dy: number, size = MAP_SIZE): FlatTransform {
  return clampPan({ k: t.k, x: t.x + dx, y: t.y + dy }, size);
}

/** The map (pre-transform) point under a viewBox point. */
export const unapply = (t: FlatTransform, [x, y]: [number, number]): [number, number] => [
  (x - t.x) / t.k,
  (y - t.y) / t.k,
];

/** Wheel delta (px) to a zoom factor: one notch (100 px) is about 1.2×. */
export const wheelFactor = (deltaY: number) => Math.exp(-deltaY * 0.0018);
