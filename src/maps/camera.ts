// The globe's camera framing, as plain numbers: no MapLibre, so it runs (and is tested) in node.
import { EARTH_RADIUS_KM, type AreaFeature, type LngLat } from './geo';
import { MAX_ZOOM } from './globeLayers';

/**
 * How much ground (km, edge to edge) the camera shows around a point-only country or a place. The
 * target's near neighbours (Sint Eustatius 28 km from Saba) are the wrong options, so the view
 * must separate them: at this span a dot sits clear of land 28 km away, while the neighbouring
 * islands (Saint Kitts, Saint Barthelemy, Sint Maarten) still show as separate land.
 */
export const NEIGHBOURHOOD_VIEW_KM = 600;

/** A camera move: what an exercise asks of the globe when a question starts or is answered. */
export type CameraMove =
  /** Fly to frame the feature's main part, with padding, so the context around it shows. */
  | { kind: 'fit'; feature: AreaFeature }
  /** Fly to centre `at`, showing about `km` across. */
  | { kind: 'span'; at: LngLat; km: number }
  /** Fly to frame both points together, and `feature`'s main part too when given. */
  | { kind: 'pair'; a: LngLat; b: LngLat; feature?: AreaFeature }
  /** Fly to the whole sphere at the opening view's zoom, centred on `at` (else where it starts). */
  | { kind: 'world'; at?: LngLat }
  /** Stop any flight where it has reached, and stay there. */
  | { kind: 'stay' };

/** MapLibre's world is this many CSS px around at zoom 0. */
export const TILE_PX = 512;
/** Below this cos(lat) (about 89.4°) the span is measured as if at that latitude. */
export const MIN_COS_LAT = 0.01;

/**
 * The zoom at which MapLibre's globe shows about `km` of ground across `sizePx` CSS px, centred at
 * latitude `lat`. The globe's radius is `512 · 2^zoom / (2π · cos lat)` px (it grows by 1 / cos lat
 * at a zoom, to match Mercator at the centre), so a km at the centre is `radius / R` px. The
 * perspective is ignored: for a span this small next to the Earth the difference is slight. Capped
 * at `MAX_ZOOM`; a span or size that is not a positive finite number gets `MAX_ZOOM`.
 */
export function spanZoom(km: number, sizePx: number, lat: number): number {
  if (!(km > 0 && sizePx > 0 && Number.isFinite(km) && Number.isFinite(sizePx))) return MAX_ZOOM;
  const cosLat = Math.max(MIN_COS_LAT, Math.cos((lat * Math.PI) / 180));
  const zoom = Math.log2((sizePx * 2 * Math.PI * EARTH_RADIUS_KM * cosLat) / (TILE_PX * km));
  return Math.min(MAX_ZOOM, zoom);
}

/**
 * The [[west, south], [east, north]] bounds of two points, the shorter way round in longitude:
 * across the antimeridian east goes above 180 (as in `featureBounds`), so the bounds span the gap
 * between them and not the rest of the world.
 */
export function pairBounds(a: LngLat, b: LngLat): [LngLat, LngLat] {
  const [west, east] = a[0] <= b[0] ? [a[0], b[0]] : [b[0], a[0]];
  const south = Math.min(a[1], b[1]);
  const north = Math.max(a[1], b[1]);
  return east - west > 180
    ? [
        [east, south],
        [west + 360, north],
      ]
    : [
        [west, south],
        [east, north],
      ];
}

/**
 * The smallest [[west, south], [east, north]] bounds holding both `a` and `b` (each in the
 * east-above-180 form of `pairBounds` and `featureBounds`): `b` is tried shifted a turn either
 * way, so bounds either side of the antimeridian join across it, not round the world.
 */
export function unionBounds(a: [LngLat, LngLat], b: [LngLat, LngLat]): [LngLat, LngLat] {
  let best: [LngLat, LngLat] | null = null;
  for (const shift of [0, -360, 360]) {
    const west = Math.min(a[0][0], b[0][0] + shift);
    const east = Math.max(a[1][0], b[1][0] + shift);
    if (!best || east - west < best[1][0] - best[0][0]) {
      best = [
        [west, Math.min(a[0][1], b[0][1])],
        [east, Math.max(a[1][1], b[1][1])],
      ];
    }
  }
  return best!;
}
