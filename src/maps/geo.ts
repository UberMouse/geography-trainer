import {
  geoArea,
  geoBounds,
  geoCentroid,
  geoCircle,
  geoContains,
  geoDistance,
  type GeoProjection,
} from 'd3-geo';
import type { Feature, Geometry, MultiPoint, MultiPolygon, Point, Polygon } from 'geojson';
import type { TapInput } from '../engine/grading';

/** [longitude, latitude] in degrees. */
export type LngLat = [number, number];

export type AreaFeature = Feature<Polygon | MultiPolygon>;

export const EARTH_RADIUS_KM = 6371;

export type TapTarget = { feature: AreaFeature; answer: LngLat } | { point: LngLat };

/**
 * The radius in km of the disc `ensureArea` gives a feature with no area: small enough that the
 * ring marker shows it, big enough to tap once zoomed in.
 */
export const POINT_FEATURE_RADIUS_KM = 2;

/** Below this many steradians (about 40 m²) a polygon counts as having no area. */
const MIN_AREA_SR = 1e-12;

/**
 * The feature with an area to draw, tap and measure: a Point or MultiPoint, or a (Multi)Polygon
 * with no area (the data stores a few tiny countries that way), becomes a disc of
 * `POINT_FEATURE_RADIUS_KM` around its centroid (else its first coordinate), with the same id and
 * properties. Any other feature comes back as it is.
 */
export function ensureArea<P>(
  feature: Feature<Geometry | null, P>,
): Feature<Polygon | MultiPolygon, P> {
  const g = feature.geometry;
  const areal = g?.type === 'Polygon' || g?.type === 'MultiPolygon';
  if (areal && geoArea(g) >= MIN_AREA_SR) return feature as Feature<Polygon | MultiPolygon, P>;
  if (!g || !(areal || g.type === 'Point' || g.type === 'MultiPoint')) {
    throw new Error(`Feature ${feature.id} has no area and no point (${g?.type ?? 'null'})`);
  }
  const centroid = geoCentroid(g);
  const centre = centroid.every(Number.isFinite) ? centroid : firstCoordinate(g, feature.id);
  const disc = geoCircle()
    .center(centre)
    .radius((POINT_FEATURE_RADIUS_KM / EARTH_RADIUS_KM) * (180 / Math.PI))();
  return { ...feature, geometry: disc };
}

function firstCoordinate(
  g: Point | MultiPoint | Polygon | MultiPolygon,
  id?: string | number,
): LngLat {
  // Nesting depth of the coordinates: Point 1, MultiPoint 2, Polygon 3, MultiPolygon 4.
  const depth = { Point: 1, MultiPoint: 2, Polygon: 3, MultiPolygon: 4 }[g.type];
  const flat = (g.coordinates as unknown[]).flat(depth - 1) as number[];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const lng = flat[i]!;
    const lat = flat[i + 1]!;
    if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
  }
  throw new Error(`Feature ${id} has no finite coordinate`);
}

/** A tap target's point: a feature's answer point, or the place's point. */
export const targetPoint = (t: TapTarget): LngLat => ('point' in t ? t.point : t.answer);

export type TapMeasurement = Omit<TapInput, 'tier'>;

type Vec = [number, number, number];

const rad = (deg: number) => (deg * Math.PI) / 180;

function toVec([lng, lat]: LngLat | number[]): Vec {
  const phi = rad(lat!);
  const lambda = rad(lng!);
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const angle = (a: Vec, b: Vec) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));

/** Angle in radians from point p to the great-circle arc a-b (the shorter arc). */
function angleToArc(p: Vec, a: Vec, b: Vec): number {
  const endpoints = Math.min(angle(p, a), angle(p, b));
  const n = cross(a, b);
  const nLen = Math.hypot(...n);
  if (nLen < 1e-12) return endpoints; // degenerate: a and b coincide
  const nn: Vec = [n[0] / nLen, n[1] / nLen, n[2] / nLen];
  // The foot of the perpendicular from p onto the arc's great circle.
  const pn = dot(p, nn);
  const foot: Vec = [p[0] - pn * nn[0], p[1] - pn * nn[1], p[2] - pn * nn[2]];
  if (Math.hypot(...foot) < 1e-12) return endpoints; // p is the circle's pole: all points equal
  const within = dot(cross(a, foot), nn) >= 0 && dot(cross(foot, b), nn) >= 0;
  return within ? Math.min(endpoints, Math.asin(Math.min(1, Math.abs(pn)))) : endpoints;
}

function rings(feature: AreaFeature): number[][][] {
  const g = feature.geometry;
  return g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
}

/** Parts of a feature closer than this (boundary to boundary) belong to the same cluster. */
export const MAIN_PART_GAP_KM = 500;
/** The biggest cluster is the main part only when it holds at least this share of the area. */
export const MAIN_PART_MIN_SHARE = 0.8;

/** The smallest cap (centre, angular radius) around a ring's vertices, roughly. */
function cap(vs: Vec[]): { centre: Vec; radius: number } {
  const sum = vs.reduce<Vec>((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
  const len = Math.hypot(...sum);
  if (len < 1e-9) return { centre: [0, 0, 1], radius: Math.PI };
  const centre: Vec = [sum[0] / len, sum[1] / len, sum[2] / len];
  return { centre, radius: Math.max(...vs.map((v) => angle(centre, v))) };
}

/**
 * Whether two parts are within `maxAngle` of each other. Measured vertex to vertex, which
 * overstates the gap by at most half an edge: close enough at a gap of hundreds of km.
 */
function near(a: Vec[], b: Vec[], maxAngle: number): boolean {
  const minDot = Math.cos(maxAngle);
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  for (const p of small) for (const q of big) if (dot(p, q) > minDot) return true;
  return false;
}

interface Cluster {
  /** The cluster's polygons as a feature with the original's id and properties. */
  feature: AreaFeature;
  area: number;
}

/** The feature's polygons grouped into clusters: parts less than `MAIN_PART_GAP_KM` apart share one. */
function computeClusters(feature: AreaFeature): Cluster[] {
  const g = feature.geometry;
  if (g.type === 'Polygon') return [{ feature, area: geoArea(feature) }];
  // Quantization can collapse a tiny island to a polygon with no rings: it has no place to be.
  const polygons = g.coordinates.filter((p) => (p[0]?.length ?? 0) > 0);
  if (polygons.length < 2) return [{ feature, area: geoArea(feature) }];
  const areas = polygons.map((coordinates) => geoArea({ type: 'Polygon', coordinates }));
  const vertices = polygons.map((p) => (p[0] ?? []).map(toVec));
  const caps = vertices.map(cap);
  const gap = MAIN_PART_GAP_KM / EARTH_RADIUS_KM;

  const parent = polygons.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < polygons.length; i++) {
    for (let j = i + 1; j < polygons.length; j++) {
      if (find(i) === find(j)) continue;
      const ci = caps[i]!;
      const cj = caps[j]!;
      // The caps alone prove most pairs far apart without visiting a vertex.
      if (angle(ci.centre, cj.centre) - ci.radius - cj.radius >= gap) continue;
      if (near(vertices[i]!, vertices[j]!, gap)) parent[find(j)] = find(i);
    }
  }

  const byRoot = new Map<number, { coordinates: Polygon['coordinates'][]; area: number }>();
  polygons.forEach((coordinates, i) => {
    const c = byRoot.get(find(i)) ?? { coordinates: [], area: 0 };
    c.coordinates.push(coordinates);
    c.area += areas[i]!;
    byRoot.set(find(i), c);
  });
  return [...byRoot.values()].map(({ coordinates, area }) => ({
    feature: { ...feature, geometry: { type: 'MultiPolygon', coordinates } },
    area,
  }));
}

const clusterCache = new WeakMap<AreaFeature, Cluster[]>();

function clustersOf(feature: AreaFeature): Cluster[] {
  const cached = clusterCache.get(feature);
  if (cached) return cached;
  const clusters = computeClusters(feature);
  clusterCache.set(feature, clusters);
  return clusters;
}

function computeMainPart<F extends AreaFeature>(feature: F): F {
  const clusters = clustersOf(feature);
  const best = clusters.reduce((m, c) => (c.area > m.area ? c : m));
  const total = clusters.reduce((s, c) => s + c.area, 0);
  if (clusters.length === 1 || !(total > 0) || best.area < MAIN_PART_MIN_SHARE * total) {
    return feature;
  }
  return best.feature as F;
}

const mainParts = new WeakMap<AreaFeature, AreaFeature>();

/**
 * The feature without its far-flung parts: its polygons are clustered (parts less than
 * `MAIN_PART_GAP_KM` apart share a cluster) and only the cluster with the most area is kept, as a
 * feature with the same id and properties. When that cluster holds under `MAIN_PART_MIN_SHARE` of
 * the area (a spread-out island nation), or there is only one cluster, the feature itself comes
 * back. Cached per feature object.
 */
export function mainPart<F extends AreaFeature>(feature: F): F {
  const cached = mainParts.get(feature);
  if (cached) return cached as F;
  const part = computeMainPart(feature);
  mainParts.set(feature, part);
  return part;
}

/**
 * The cluster of the feature (see `mainPart`) that holds `point`, else the one nearest to it, as a
 * feature with the same id and properties. The feature itself when it has one cluster.
 */
export function clusterAt<F extends AreaFeature>(feature: F, point: LngLat): F {
  const clusters = clustersOf(feature);
  if (clusters.length === 1) return feature;
  const holding = clusters.find((c) => geoContains(c.feature, point));
  if (holding) return holding.feature as F;
  const km = (c: Cluster) => kmToBoundary(c.feature, point);
  return clusters.reduce((m, c) => (km(c) < km(m) ? c : m)).feature as F;
}

const answerPoints = new WeakMap<AreaFeature, LngLat>();
const nearPoints = new WeakMap<AreaFeature, LngLat>();

/** Grid cells per side of the coarse and of each refining search for an interior point. */
const INTERIOR_GRID = 20;
const INTERIOR_REFINES = 3;
/** The boundary is measured against about this many vertices: the search only needs it roughly. */
const INTERIOR_BOUNDARY_VERTICES = 250;

/** A ring as flat x, y pairs (longitude unwrapped) with its bounding box. */
interface PlanarRing {
  xy: Float64Array;
  box: [number, number, number, number];
}

/**
 * Whether the planar point (x, y) is inside the rings, by ray casting in lng/lat (even-odd over
 * every ring, so holes are respected). Cheap, and only as right as lng/lat are planar: callers
 * confirm with `geoContains`.
 */
function planarContains(planar: PlanarRing[], x: number, y: number) {
  let inside = false;
  for (const { xy, box } of planar) {
    // Outside the ring's box the ray crosses it an even number of times: skip it.
    if (y < box[1] || y > box[3] || x < box[0] || x > box[2]) continue;
    let px = xy[xy.length - 2]!;
    let py = xy[xy.length - 1]!;
    for (let i = 0; i < xy.length; i += 2) {
      const qx = xy[i]!;
      const qy = xy[i + 1]!;
      if (py > y !== qy > y && x < ((qx - px) * (y - py)) / (qy - py) + px) inside = !inside;
      px = qx;
      py = qy;
    }
  }
  return inside;
}

/**
 * An approximate pole of inaccessibility of an areal feature: a point inside it, roughly the
 * farthest from its boundary. A grid over its bounds is tested with a cheap planar point in
 * polygon and scored by distance to a thinned copy of the boundary, then a finer grid around the
 * best point repeats that. The best-scoring candidate that `geoContains` confirms is returned, so
 * the result is inside whatever the planar test says. When no candidate is (islands smaller than a
 * grid cell), the search moves to the feature's biggest polygon, and failing that the centroid
 * comes back.
 */
function interiorPoint(feature: AreaFeature): LngLat {
  const [[w, s], [e0, n]] = geoBounds(feature);
  const crosses = e0 < w; // bounds that cross the antimeridian
  const e = crosses ? e0 + 360 : e0;
  const unwrap = (lng: number) => (crosses && lng < 0 ? lng + 360 : lng);
  const all = rings(feature);
  const planar = all.map((ring): PlanarRing => {
    const xy = new Float64Array(ring.length * 2);
    ring.forEach(([lng, lat], i) => ([xy[2 * i], xy[2 * i + 1]] = [unwrap(lng!), lat!]));
    const xs = ring.map(([lng]) => unwrap(lng!));
    const ys = ring.map(([, lat]) => lat!);
    return { xy, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  const total = all.reduce((sum, r) => sum + r.length, 0);
  const step = Math.max(1, Math.ceil(total / INTERIOR_BOUNDARY_VERTICES));
  // The boundary in unwrapped lng/lat, thinned: distance to it is measured in a flat approximation
  // (longitude scaled by the candidate's cos(lat)), which ranks interior points well enough.
  const edges: [number, number, number, number][] = [];
  for (const ring of all) {
    const vs = ring.filter((_, i) => i % step === 0 || i === ring.length - 1);
    for (let i = 0; i + 1 < vs.length; i++) {
      edges.push([unwrap(vs[i]![0]!), vs[i]![1]!, unwrap(vs[i + 1]![0]!), vs[i + 1]![1]!]);
    }
  }
  const score = ([x, y]: LngLat) => {
    const k = Math.cos(rad(y));
    let best = Infinity;
    for (const [ax, ay, bx, by] of edges) {
      const [ex, ey] = [(bx - ax) * k, by - ay];
      const [fx, fy] = [(x - ax) * k, y - ay];
      const len2 = ex * ex + ey * ey;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (fx * ex + fy * ey) / len2)) : 0;
      best = Math.min(best, (fx - t * ex) ** 2 + (fy - t * ey) ** 2);
    }
    return best;
  };
  const found: { at: LngLat; score: number }[] = [];
  let [x0, x1, y0, y1] = [w, e, s, n];
  for (let pass = 0; pass <= INTERIOR_REFINES; pass++) {
    const dx = (x1 - x0) / INTERIOR_GRID;
    const dy = (y1 - y0) / INTERIOR_GRID;
    let best: { at: LngLat; score: number; x: number } | undefined;
    for (let i = 0; i <= INTERIOR_GRID; i++) {
      for (let j = 0; j <= INTERIOR_GRID; j++) {
        const lng = x0 + i * dx;
        const at: LngLat = [lng > 180 ? lng - 360 : lng, y0 + j * dy];
        if (!planarContains(planar, lng, at[1])) continue;
        const sc = score([lng, at[1]]);
        found.push({ at, score: sc });
        if (!best || sc > best.score) best = { at, score: sc, x: lng };
      }
    }
    if (!best) break;
    [x0, x1, y0, y1] = [
      best.x - dx,
      best.x + dx,
      Math.max(-90, best.at[1] - dy),
      Math.min(90, best.at[1] + dy),
    ];
  }
  found.sort((a, b) => b.score - a.score);
  const sure = found.find((c) => geoContains(feature, c.at));
  if (sure) return sure.at;
  const g = feature.geometry;
  if (g.type === 'MultiPolygon' && g.coordinates.length > 1) {
    const polygons = g.coordinates.map(
      (coordinates): AreaFeature => ({
        ...feature,
        geometry: { type: 'Polygon', coordinates },
      }),
    );
    const biggest = polygons.reduce((m, p) => (geoArea(p) > geoArea(m) ? p : m));
    const centroid = geoCentroid(biggest);
    return geoContains(biggest, centroid) ? centroid : interiorPoint(biggest);
  }
  return geoCentroid(feature);
}

/**
 * A point to rank features by distance from, not to tap: the centroid of the feature's main part,
 * which may lie outside it. Much cheaper than `answerPoint`. Cached per feature object.
 */
export function nearPoint(feature: AreaFeature): LngLat {
  const cached = nearPoints.get(feature);
  if (cached) return cached;
  const point = geoCentroid(mainPart(feature));
  nearPoints.set(feature, point);
  return point;
}

/**
 * A country's or region's answer point: the centroid of its main part (see `mainPart`) when that
 * is inside it, else an interior point of the main part (see `interiorPoint`), since the centroid
 * of a crescent or an archipelago can fall in the sea or the next country. Cached per feature
 * object.
 */
export function answerPoint(feature: AreaFeature): LngLat {
  const cached = answerPoints.get(feature);
  if (cached) return cached;
  const main = mainPart(feature);
  const centroid = geoCentroid(main);
  const point = geoContains(main, centroid) ? centroid : interiorPoint(main);
  answerPoints.set(feature, point);
  return point;
}

/** Great-circle distance between two points in km. */
export function distanceKm(a: LngLat, b: LngLat): number {
  return geoDistance(a, b) * EARTH_RADIUS_KM;
}

/** Great-circle km from a point to the nearest point of any ring of the feature (holes included). */
function kmToBoundary(feature: AreaFeature, tap: LngLat): number {
  const p = toVec(tap);
  let best = Infinity;
  for (const ring of rings(feature)) {
    for (let i = 0; i + 1 < ring.length; i++) {
      best = Math.min(best, angleToArc(p, toVec(ring[i]!), toVec(ring[i + 1]!)));
    }
  }
  return best * EARTH_RADIUS_KM;
}

/**
 * Measure a tap against its target, in the quantities `gradeTap` takes. A place target has no
 * polygon: `inside` is false and the border and size distances are 0.
 */
export function measureTap(target: TapTarget, tap: LngLat): TapMeasurement {
  if ('point' in target) {
    return {
      inside: false,
      kmFromAnswer: distanceKm(tap, target.point),
      kmOutsideBorder: 0,
      featureSizeKm: 0,
    };
  }
  const inside = geoContains(target.feature, tap);
  return {
    inside,
    kmFromAnswer: distanceKm(tap, target.answer),
    kmOutsideBorder: inside ? 0 : kmToBoundary(target.feature, tap),
    // The main part, like the answer point: a far part (Alaska) is not the country's size.
    featureSizeKm: Math.sqrt(geoArea(mainPart(target.feature))) * EARTH_RADIUS_KM,
  };
}

/**
 * Whether `at` is on the hidden side of an orthographic projection (one clipped to a hemisphere), where
 * drawing it would show it through the globe. Flat projections never hide a point.
 */
export function isOnFarSide(projection: GeoProjection, at: LngLat): boolean {
  // Only a projection clipped to a hemisphere (clip angle about 90 degrees or less) hides the far
  // side; d3 reports no clipping (Mercator, equirectangular) as a clip angle of 0.
  const clip = projection.clipAngle?.();
  if (!clip || clip > 90.001) return false;
  const [lambda, phi] = projection.rotate();
  return geoDistance(at, [-lambda, -phi]) > Math.PI / 2;
}
