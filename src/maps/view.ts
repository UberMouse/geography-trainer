import type { Feature } from 'geojson';
import {
  geoAzimuthalEqualArea,
  geoCentroid,
  geoDistance,
  geoInterpolate,
  geoOrthographic,
  type GeoPath,
} from 'd3-geo';
import {
  EARTH_RADIUS_KM,
  clusterAt,
  ensureArea,
  mainPart,
  type AreaFeature,
  type LngLat,
} from './geo';

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

/** The smallest cos(lat) a drag divides by: bounds the longitude step near the poles. */
const MIN_COS_LAT = 0.1;

/**
 * The view after dragging by `dx`, `dy` px on a globe of `radiusPx`: the surface follows the
 * pointer near the centre at any latitude (a parallel is shorter by cos(lat), so a pixel is more
 * longitude the nearer a pole: capped at 1 / `MIN_COS_LAT`, to stay bounded there). Latitude is
 * clamped to ±90°, longitude wrapped.
 */
export function rotateGlobe(view: GlobeView, dx: number, dy: number, radiusPx: number): GlobeView {
  const degPerPx = 180 / (Math.PI * radiusPx);
  const cosLat = Math.max(MIN_COS_LAT, Math.cos((view.lat * Math.PI) / 180));
  return {
    ...view,
    lng: wrapLng(view.lng - (dx * degPerPx) / cosLat),
    lat: clamp(view.lat + dy * degPerPx, -90, 90),
  };
}

export function zoomGlobe(view: GlobeView, factor: number): GlobeView {
  return { ...view, zoom: clamp(view.zoom * factor, GLOBE_MIN_ZOOM, GLOBE_MAX_ZOOM) };
}

/** How many times `zoomGlobeAt` re-aims after a zoom (each step shrinks the miss near the limb). */
const ZOOM_AT_STEPS = 4;

/**
 * `zoomGlobe`, keeping the lng/lat under the pixel `focal` (canvas CSS px) under it: the point
 * is found before the zoom, then the surface is dragged until it sits back under `focal`. The
 * drag is exact only near the centre (`rotateGlobe`'s approximation), so it repeats a few times;
 * near the limb the miss is small but not zero. A `focal` off the disc zooms about the centre.
 */
export function zoomGlobeAt(
  view: GlobeView,
  factor: number,
  focal: [number, number],
  width: number,
  height: number,
): GlobeView {
  const project = (v: GlobeView) =>
    geoOrthographic()
      .rotate([-v.lng, -v.lat])
      .scale(globeRadius(width, height, v.zoom))
      .translate([width / 2, height / 2]);
  const at = project(view).invert?.(focal);
  const zoomed = zoomGlobe(view, factor);
  const onDisc =
    Math.hypot(focal[0] - width / 2, focal[1] - height / 2) <=
    globeRadius(width, height, view.zoom);
  if (!at || !onDisc || !at.every(Number.isFinite) || zoomed.zoom === view.zoom) return zoomed;
  const radius = globeRadius(width, height, zoomed.zoom);
  let next = zoomed;
  for (let i = 0; i < ZOOM_AT_STEPS; i++) {
    const now = project(next)(at as LngLat);
    if (!now || !now.every(Number.isFinite)) break;
    next = rotateGlobe(next, focal[0] - now[0], focal[1] - now[1], radius);
  }
  return next;
}

/**
 * Whether a wheel of `deltaY` (positive scrolls out) cannot zoom: `zoom` is already at the
 * minimum and it scrolls out, or at the maximum and it scrolls in. Then the page may scroll.
 */
export const wheelAtLimit = (zoom: number, deltaY: number, min: number, max: number) =>
  (deltaY > 0 && zoom <= min) || (deltaY < 0 && zoom >= max);

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
 * with the answer centred, the view centres on the great-circle midpoint between them instead
 * (the `REVEAL_MARGIN` holds only while the zoom is above the minimum: at `GLOBE_MIN_ZOOM` the
 * points can sit near the limb); an antipodal pin (no midpoint) gets the answer centred at zoom 1.
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
export function fitFlat(features: Feature[], size = MAP_SIZE, padding = MAP_PADDING) {
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

/**
 * An orthographic globe rotated to `centre`, fitted into the square viewBox with padding. With
 * `spanKm`, it is instead zoomed so that much ground, centred on `centre`, spans the padded
 * extent (the sphere then reaches past the viewBox: the SVG clips it). A `spanKm` that is not a
 * finite number between 0 and half the Earth's circumference (a half-span past 90 degrees) is
 * treated as absent.
 */
export function fitGlobe(centre: LngLat, size = MAP_SIZE, padding = MAP_PADDING, spanKm?: number) {
  const globe = geoOrthographic().rotate([-centre[0], -centre[1]]);
  if (!(Number.isFinite(spanKm) && spanKm! > 0 && spanKm! < Math.PI * EARTH_RADIUS_KM)) {
    return globe.fitExtent(
      [
        [padding, padding],
        [size - padding, size - padding],
      ],
      { type: 'Sphere' },
    );
  }
  // A point `theta` from the centre projects at `radius * sin(theta)`; the span's edge is at
  // `theta = spanKm / 2 / R` and must land half the padded extent from the centre.
  const radius = (size / 2 - padding) / Math.sin(spanKm! / 2 / EARTH_RADIUS_KM);
  return globe.scale(radius).translate([size / 2, size / 2]);
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

/** Keep revealed points this far (viewBox units) from the edge of the viewBox. */
const REVEAL_FLAT_MARGIN = 32;

/**
 * The transform that reveals an answer: `t` itself when the pin `a` and the answer `b` (viewBox
 * points, before the transform) are both on screen with a margin; else the largest zoom up to
 * `t.k` (and down to `FLAT_MIN_ZOOM`) that shows both with it, centred on their midpoint and
 * clamped like a pan (so at minimum zoom a point near the edge may sit inside the margin).
 */
export function revealFlat(
  t: FlatTransform,
  a: [number, number],
  b: [number, number],
  size = MAP_SIZE,
): FlatTransform {
  const shown = ([x, y]: [number, number]) =>
    [x * t.k + t.x, y * t.k + t.y].every(
      (v) => v >= REVEAL_FLAT_MARGIN && v <= size - REVEAL_FLAT_MARGIN,
    );
  if (shown(a) && shown(b)) return t;
  const span = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  const fits = span > 0 ? (size - 2 * REVEAL_FLAT_MARGIN) / span : Infinity;
  const k = clamp(Math.min(t.k, fits), FLAT_MIN_ZOOM, FLAT_MAX_ZOOM);
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  return clampPan({ k, x: size / 2 - k * mid[0], y: size / 2 - k * mid[1] }, size);
}

/** The map (pre-transform) point under a viewBox point. */
export const unapply = (t: FlatTransform, [x, y]: [number, number]): [number, number] => [
  (x - t.x) / t.k,
  (y - t.y) / t.k,
];

/** Wheel delta (px) to a zoom factor: one notch (100 px) is about 1.2×. */
export const wheelFactor = (deltaY: number) => Math.exp(-deltaY * 0.0018);

/**
 * Whether `point` falls inside the square viewBox of a flat map fitted to `frame` (`fitFlat`):
 * reachable on that map, whose pan never leaves the fitted frame.
 */
export function inFlatFrame(frame: AreaFeature, point: LngLat, size = MAP_SIZE): boolean {
  const p = fitFlat([frame], size)(point);
  return !!p && p.every(Number.isFinite) && p.every((v) => v >= 0 && v <= size);
}

/**
 * What an outline view fits (`fitFlat`): the main part of `feature`; or, when `point` is not
 * inside that frame, the part of the feature nearest to it (see `clusterAt`); and, when the point
 * still is not (a place the data puts off its feature's land), a small disc at the point too, so
 * the point shows.
 */
export function outlineFrame(feature: AreaFeature, point?: LngLat): AreaFeature[] {
  const main = mainPart(feature);
  if (!point || inFlatFrame(main, point)) return [main];
  const part = clusterAt(feature, point);
  if (inFlatFrame(part, point)) return [part];
  return [
    part,
    ensureArea({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: point },
    }),
  ];
}

// ---------------------------------------------------------------------------------------------
// Small targets

/** A target that covers less area than a square this many CSS px across gets ring markers. */
export const SMALL_TARGET_PX = 12;
/** A ring marker's radius in CSS px. */
export const RING_RADIUS_PX = 12;
/**
 * viewBox units per CSS px on an SVG map at phone width, where the 480-unit viewBox is drawn about
 * 360 px wide. Wider maps draw a unit nearer a px, so their rings come a little early.
 */
export const SVG_UNITS_PER_PX = MAP_SIZE / 360;

/**
 * Where to draw ring markers around a target that `path` would draw too small to see: none when
 * the feature covers at least a `minSize` square (in `path`'s units); else one at the centre of
 * each drawn polygon (so a spread archipelago gets one per island group), skipping a polygon whose
 * ring would overlap one already placed (centres within `2 * radius`). Polygons `path` does not
 * draw (behind a globe) get none.
 */
export function smallTargetRings(
  path: GeoPath,
  feature: AreaFeature,
  minSize: number,
  radius: number,
): [number, number][] {
  if (path.area(feature) >= minSize * minSize) return [];
  const g = feature.geometry;
  const polygons = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  const rings: [number, number][] = [];
  for (const coordinates of polygons) {
    const [[x0, y0], [x1, y1]] = path.bounds({ type: 'Polygon', coordinates });
    const centre: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
    if (!centre.every(Number.isFinite)) continue;
    if (rings.some(([x, y]) => Math.hypot(x - centre[0], y - centre[1]) < 2 * radius)) continue;
    rings.push(centre);
  }
  return rings;
}
