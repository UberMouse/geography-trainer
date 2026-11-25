import type { GeoProjection } from 'd3-geo';
import type { LngLat } from './geo';

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
