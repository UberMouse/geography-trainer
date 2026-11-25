// Small geometry helpers over GeoJSON polygons in [lng, lat] degrees.
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import pointOnFeature from '@turf/point-on-feature';
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

/**
 * Point-in-polygon with a bounding-box shortcut; `box` is `bboxOf(area)`, passed in to reuse it.
 * Rings must be split at ±180° (as Natural Earth's are): a ring crossing it is not understood.
 */
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

/** Natural Earth splits rings at ±180°; an edge along that cut is not a real outline. */
const onAntimeridian = (lng: number) => Math.abs(Math.abs(lng) - 180) < 1e-6;

/**
 * Distance in km from a point to the nearest edge of an area (every ring, holes included),
 * leaving out edges along ±180° (`onAntimeridian`). Each edge is measured in an equirectangular
 * projection centred on the point, which is accurate near the point and only approximate for
 * far-away edges: good enough to pick the nearest area.
 */
export function distanceToEdgeKm(area: Area, lng: number, lat: number): number {
  const kmPerLngDegree = Math.cos((lat * Math.PI) / 180) * KM_PER_DEGREE;
  let best = Infinity;
  for (const polygon of polygonsOf(area)) {
    for (const ring of polygon) {
      for (let i = 1; i < ring.length; i++) {
        const [aLng, aLat] = ring[i - 1]!;
        const [bLng, bLat] = ring[i]!;
        if (onAntimeridian(aLng!) && onAntimeridian(bLng!)) continue;
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

/**
 * A point strictly inside `area`, never on its outline: turf's point-on-feature when that is
 * interior (it can fall back to an outline vertex), else the middle of the widest span a
 * horizontal line cuts through the largest polygon, trying several latitudes.
 */
export function interiorPoint(area: Area): [number, number] {
  const interior = (p: Position) => booleanPointInPolygon(p, area, { ignoreBoundary: true });
  const [lng, lat] = pointOnFeature(area).geometry.coordinates;
  if (interior([lng!, lat!])) return [lng!, lat!];

  const largest = polygonsOf(area).reduce((a, b) =>
    planarArea({ type: 'Polygon', coordinates: b }) >
    planarArea({ type: 'Polygon', coordinates: a })
      ? b
      : a,
  );
  const [, south, , north] = bboxOf({ type: 'Polygon', coordinates: largest });
  for (const share of [0.5, 0.25, 0.75, 0.375, 0.625, 0.125, 0.875]) {
    const y = south + share * (north - south);
    const xs: number[] = [];
    for (const ring of largest) {
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1]!;
        const [bx, by] = ring[i]!;
        if (ay! > y !== by! > y) xs.push(ax! + ((y - ay!) * (bx! - ax!)) / (by! - ay!));
      }
    }
    xs.sort((a, b) => a - b);
    let best: Position | null = null;
    let width = 0;
    for (let i = 1; i < xs.length; i += 2) {
      if (xs[i]! - xs[i - 1]! > width)
        [best, width] = [[(xs[i - 1]! + xs[i]!) / 2, y], xs[i]! - xs[i - 1]!];
    }
    if (best && interior(best)) return [best[0]!, best[1]!];
  }
  throw new Error('no interior point found for an area');
}

/** Planar area in square degrees (holes subtracted): only for comparing nearby shapes. */
export function planarArea(area: Area): number {
  const ringArea = (ring: Position[]) => {
    let sum = 0;
    for (let i = 1; i < ring.length; i++) {
      sum += ring[i - 1]![0]! * ring[i]![1]! - ring[i]![0]! * ring[i - 1]![1]!;
    }
    return Math.abs(sum) / 2;
  };
  let total = 0;
  for (const [outer, ...holes] of polygonsOf(area)) {
    total += ringArea(outer ?? []) - holes.reduce((s, hole) => s + ringArea(hole), 0);
  }
  return total;
}

/** Approximate area in km² (planar, scaled at the middle latitude of its box): for reports. */
export function approxAreaKm2(area: Area): number {
  const [, south, , north] = bboxOf(area);
  const midLat = ((south + north) / 2) * (Math.PI / 180);
  return planarArea(area) * KM_PER_DEGREE * KM_PER_DEGREE * Math.cos(midLat);
}
