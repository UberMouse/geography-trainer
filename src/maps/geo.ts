import { geoArea, geoCentroid, geoContains, geoDistance } from 'd3-geo';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { TapInput } from '../engine/grading';

/** [longitude, latitude] in degrees. */
export type LngLat = [number, number];

export type AreaFeature = Feature<Polygon | MultiPolygon>;

export const EARTH_RADIUS_KM = 6371;

export type TapTarget = { feature: AreaFeature; answer: LngLat } | { point: LngLat };

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

/** A country's or region's answer point: the centroid of its feature. */
export function answerPoint(feature: AreaFeature): LngLat {
  return geoCentroid(feature);
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
    featureSizeKm: Math.sqrt(geoArea(target.feature)) * EARTH_RADIUS_KM,
  };
}
