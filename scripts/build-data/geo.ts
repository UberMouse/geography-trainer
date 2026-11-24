// Small geometry helpers over GeoJSON polygons in [lng, lat] degrees.
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { MultiPolygon, Polygon, Position } from 'geojson';

export type Area = Polygon | MultiPolygon;
export type BBox = [minLng: number, minLat: number, maxLng: number, maxLat: number];

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEGREE = (Math.PI * EARTH_RADIUS_KM) / 180;

function polygonsOf(area: Area): Position[][][] {
  return area.type === 'Polygon' ? [area.coordinates] : area.coordinates;
}

export function bboxOf(area: Area): BBox {
  const box: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of polygonsOf(area)) {
    for (const [lng, lat] of polygon[0] ?? []) {
      box[0] = Math.min(box[0], lng!);
      box[1] = Math.min(box[1], lat!);
      box[2] = Math.max(box[2], lng!);
      box[3] = Math.max(box[3], lat!);
    }
  }
  return box;
}

/** Point-in-polygon with a bounding-box shortcut; `box` is `bboxOf(area)`, passed in to reuse it. */
export function areaContains(area: Area, box: BBox, lng: number, lat: number): boolean {
  if (lng < box[0] || lng > box[2] || lat < box[1] || lat > box[3]) return false;
  return booleanPointInPolygon([lng, lat], area);
}

export function haversineKm(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function wrapLng(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

/**
 * Distance in km from a point to the nearest edge of an area (every ring, holes included).
 * Each edge is measured in an equirectangular projection centred on the point, which is accurate
 * near the point and only approximate for far-away edges: good enough to pick the nearest area.
 */
export function distanceToEdgeKm(area: Area, lng: number, lat: number): number {
  const kmPerLngDegree = Math.cos((lat * Math.PI) / 180) * KM_PER_DEGREE;
  let best = Infinity;
  for (const polygon of polygonsOf(area)) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const [aLng, aLat] = ring[i - 1]!;
        const [bLng, bLat] = ring[i]!;
        // Unwrap b relative to a so an edge never jumps across the point's antimeridian.
        const aDLng = wrapLng(aLng! - lng);
        const bDLng = aDLng + wrapLng(bLng! - aLng!);
        const ax = aDLng * kmPerLngDegree;
        const ay = (aLat! - lat) * KM_PER_DEGREE;
        const dx = bDLng * kmPerLngDegree - ax;
        const dy = (bLat! - lat) * KM_PER_DEGREE - ay;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq));
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
  }
  return best;
}
