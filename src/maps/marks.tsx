import type { GeoProjection } from 'd3-geo';
import type { LngLat } from './geo';
import { RING_RADIUS_PX, SVG_UNITS_PER_PX } from './view';

/**
 * A dot at `at`: a place (`map-point`) or a tapped pin (`map-pin`). `transform` maps the projected
 * point to the drawn one (a zoomed map's pan/zoom), so the dot keeps its size at any zoom.
 */
export function Dot({
  projection,
  at,
  pin = false,
  transform = (p) => p,
}: {
  projection: GeoProjection;
  at: LngLat;
  pin?: boolean;
  transform?: (p: [number, number]) => [number, number];
}) {
  const projected = projection(at);
  if (!projected) return null;
  const [x, y] = transform(projected);
  return <circle className={pin ? 'map-pin' : 'map-point'} cx={x} cy={y} r={pin ? 6 : 5} />;
}

/**
 * Ring markers (see `smallTargetRings`) at viewBox points, around a highlighted target or, with
 * `reveal`, a revealed one.
 */
export function Rings({ at, reveal = false }: { at: [number, number][]; reveal?: boolean }) {
  return at.map(([x, y], i) => (
    <circle
      key={i}
      className={reveal ? 'map-ring map-ring-reveal' : 'map-ring'}
      cx={x}
      cy={y}
      r={RING_RADIUS_PX * SVG_UNITS_PER_PX}
    />
  ));
}
