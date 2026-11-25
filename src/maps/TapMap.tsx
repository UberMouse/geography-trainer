import { geoPath } from 'd3-geo';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  targetPoint,
  type AreaFeature,
  type IdentifiedFeature,
  type LngLat,
  type TapTarget,
} from './geo';
import type { GestureEvent } from './gestures';
import { Dot, Rings } from './marks';
import { usePointerGestures } from './usePointerGestures';
import {
  IDENTITY,
  FLAT_MAX_ZOOM,
  FLAT_MIN_ZOOM,
  MAP_SIZE,
  RING_RADIUS_PX,
  SMALL_TARGET_PX,
  SVG_UNITS_PER_PX,
  fitFlat,
  panFlat,
  revealFlat,
  smallTargetRings,
  unapply,
  wheelAtLimit,
  wheelFactor,
  zoomFlat,
  type FlatTransform,
} from './view';

/**
 * A flat bordered map fitted to `frame` when given (such as a country's main part), else to
 * `features`, to tap on. Wheel or pinch zooms (1–16×), drag pans (never beyond the fitted frame),
 * and a tap calls `onPin` with the tapped lng/lat. `reveal` shades the target feature and its
 * `alsoInside` twins (or draws its point) under the pin, with ring markers when it is drawn too
 * small to see at the current zoom (`smallTargetRings`).
 */
export default function TapMap({
  features,
  highlightId,
  pin,
  onPin,
  reveal,
  frame,
}: {
  features: IdentifiedFeature[];
  highlightId?: string;
  pin: LngLat | null;
  onPin: (at: LngLat) => void;
  reveal?: TapTarget;
  frame?: AreaFeature;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState<FlatTransform>(IDENTITY);
  const transformRef = useRef(transform);
  // The fit follows `frame` alone when there is one, so a fresh `features` array over the same
  // frame neither refits nor resets the view.
  const fit = frame ?? features;
  const projection = useMemo(() => fitFlat(Array.isArray(fit) ? fit : [fit]), [fit]);
  const paths = useMemo(() => {
    const path = geoPath(projection);
    return features.map((f) => ({ id: f.id, d: path(f) ?? '' }));
  }, [projection, features]);
  // The target and its same-named twins, shaded together.
  const revealD = useMemo(() => {
    if (!reveal || !('feature' in reveal)) return null;
    const path = geoPath(projection);
    return [reveal.feature, ...(reveal.alsoInside ?? [])].map((f) => path(f) ?? '').join('');
  }, [projection, reveal]);

  // In map units, so they follow the zoom; drawn through `toScreen` at a fixed size.
  const rings = useMemo(
    () =>
      reveal && 'feature' in reveal
        ? [reveal.feature, ...(reveal.alsoInside ?? [])].flatMap((f) =>
            smallTargetRings(
              geoPath(projection),
              f,
              (SMALL_TARGET_PX * SVG_UNITS_PER_PX) / transform.k,
              (RING_RADIUS_PX * SVG_UNITS_PER_PX) / transform.k,
            ),
          )
        : [],
    [projection, reveal, transform.k],
  );

  const update = (next: FlatTransform) => {
    transformRef.current = next;
    setTransform(next);
  };

  // A new projection (new features or frame) is a new map: back to the whole view, and any reveal
  // frames afresh. The state resets during render; the effect, declared before the reveal effect,
  // brings the ref and the reveal in step, so a reveal frames on the reset view.
  const [shownProjection, setShownProjection] = useState({ projection });
  if (shownProjection.projection !== projection) {
    setShownProjection({ projection });
    setTransform(IDENTITY);
  }
  const revealedFor = useRef<typeof reveal>(undefined);
  useEffect(() => {
    transformRef.current = IDENTITY;
    revealedFor.current = undefined;
  }, [projection]);

  // Once per reveal: bring the pin and the answer on screen. The user's later pans and zooms
  // stand, but a switch straight to another reveal frames again. A reveal that arrives without a
  // pin is spent without reframing, so a pin dropped later does not jump the view.
  useEffect(() => {
    if (!reveal) revealedFor.current = undefined;
    if (!reveal || revealedFor.current === reveal) return;
    revealedFor.current = reveal;
    if (!pin) return;
    const a = projection(pin);
    const b = projection(targetPoint(reveal));
    if (a && b && [...a, ...b].every(Number.isFinite)) {
      update(revealFlat(transformRef.current, a, b));
    }
  });
  /** CSS px relative to the svg to viewBox units. */
  const toViewBox = (x: number, y: number): [number, number] => {
    const scale = MAP_SIZE / (svgRef.current?.getBoundingClientRect().width || MAP_SIZE);
    return [x * scale, y * scale];
  };

  usePointerGestures(svgRef, {
    onGesture: (e: GestureEvent) => {
      const t = transformRef.current;
      if (e.type === 'tap') {
        const at = projection.invert?.(unapply(t, toViewBox(e.x, e.y)));
        if (at && at.every(Number.isFinite)) onPin([at[0], at[1]]);
      } else if (e.type === 'drag') {
        update(panFlat(t, ...toViewBox(e.dx, e.dy)));
      } else {
        const panned = panFlat(t, ...toViewBox(e.dx, e.dy));
        update(zoomFlat(panned, e.factor, ...toViewBox(e.cx, e.cy)));
      }
    },
    onWheel: (deltaY, x, y) => {
      if (wheelAtLimit(transformRef.current.k, deltaY, FLAT_MIN_ZOOM, FLAT_MAX_ZOOM)) return false;
      update(zoomFlat(transformRef.current, wheelFactor(deltaY), ...toViewBox(x, y)));
      return true;
    },
  });

  const toScreen = ([x, y]: [number, number]): [number, number] => [
    x * transform.k + transform.x,
    y * transform.k + transform.y,
  ];
  return (
    <svg
      ref={svgRef}
      className="map map-interactive"
      viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
      role="img"
      aria-label="Tap map"
      data-zoom={transform.k.toFixed(3)}
    >
      <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}>
        {paths.map(({ id, d }) => (
          <path
            key={id}
            className={id === highlightId ? 'map-land map-highlight' : 'map-land'}
            d={d}
          />
        ))}
        {revealD !== null && <path className="map-land map-reveal" d={revealD} />}
      </g>
      <Rings at={rings.map(toScreen)} reveal />
      {reveal && 'point' in reveal && (
        <Dot projection={projection} at={reveal.point} transform={toScreen} />
      )}
      {pin && <Dot projection={projection} at={pin} pin transform={toScreen} />}
    </svg>
  );
}
