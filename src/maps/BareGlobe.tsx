import { geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { targetPoint, type AreaFeature, type LngLat, type TapTarget } from './geo';
import { usePointerGestures } from './usePointerGestures';
import {
  GLOBE_MAX_ZOOM,
  GLOBE_MIN_ZOOM,
  NEUTRAL_VIEW,
  RING_RADIUS_PX,
  SMALL_TARGET_PX,
  globeRadius,
  revealView,
  rotateGlobe,
  smallTargetRings,
  wheelAtLimit,
  wheelFactor,
  zoomGlobeAt,
  type GlobeView,
} from './view';

interface Props {
  /** Every country: filled as land, and stroked as borders when `borders`. */
  features: AreaFeature[];
  pin: LngLat | null;
  onPin: (at: LngLat) => void;
  borders?: boolean;
  /** Where the globe starts (default `NEUTRAL_VIEW`); later changes are ignored. */
  initialView?: GlobeView;
  reveal?: TapTarget;
}

const SPHERE: GeoPermissibleObjects = { type: 'Sphere' };

/**
 * An orthographic globe on a canvas: ocean and land only, with country borders when `borders`.
 * Drag rotates, wheel or pinch zooms (1–64×), a tap calls `onPin`. On `reveal` it turns to the
 * target (see `revealView`) and draws the target (ringed when too small to see, see
 * `smallTargetRings`), the pin and the great circle between them. The
 * canvas carries its view as `data-rotation="<lng>,<lat>"` and `data-zoom`.
 */
export default function BareGlobe(props: Props) {
  const { features, borders, initialView, reveal } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<GlobeView>(initialView ?? NEUTRAL_VIEW);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const propsRef = useRef(props);
  const frameRef = useRef(0);

  // Built once per data change; each frame only re-aims the projection.
  const projection = useMemo(() => geoOrthographic(), []);
  const land = useMemo(
    (): GeoPermissibleObjects => ({ type: 'FeatureCollection', features }),
    [features],
  );

  /** Aim the projection at the current view and size. */
  const aim = useCallback(() => {
    const { lng, lat, zoom } = viewRef.current;
    const { width, height } = sizeRef.current;
    return projection
      .rotate([-lng, -lat])
      .scale(globeRadius(width, height, zoom))
      .translate([width / 2, height / 2]);
  }, [projection]);

  const draw = useCallback(() => {
    frameRef.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { lng, lat, zoom } = viewRef.current;
    canvas.dataset.rotation = `${lng.toFixed(2)},${lat.toFixed(2)}`;
    canvas.dataset.zoom = zoom.toFixed(3);
    const { width, height, dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (width === 0 || height === 0) return;

    const css = getComputedStyle(canvas);
    const colour = (name: string) => css.getPropertyValue(name).trim();
    const path = geoPath(aim(), ctx);
    const fill = (object: GeoPermissibleObjects, style: string) => {
      ctx.beginPath();
      path(object);
      ctx.fillStyle = style;
      ctx.fill();
    };
    const stroke = (object: GeoPermissibleObjects, style: string, lineWidth: number) => {
      ctx.beginPath();
      path(object);
      ctx.strokeStyle = style;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    };

    fill(SPHERE, colour('--map-ocean'));
    fill(land, colour('--map-land'));
    const { pin, borders: withBorders, reveal: target } = propsRef.current;
    if (withBorders) stroke(land, colour('--map-border'), 0.6);
    if (target) {
      if ('feature' in target) {
        for (const f of [target.feature, ...(target.alsoInside ?? [])]) {
          fill(f, colour('--map-reveal'));
          stroke(f, colour('--map-border'), 1);
        }
        const rings = smallTargetRings(path, target.feature, SMALL_TARGET_PX, RING_RADIUS_PX);
        ctx.beginPath();
        for (const [x, y] of rings) {
          ctx.moveTo(x + RING_RADIUS_PX, y);
          ctx.arc(x, y, RING_RADIUS_PX, 0, 2 * Math.PI);
        }
        ctx.strokeStyle = colour('--map-reveal');
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (pin) {
        stroke(
          { type: 'LineString', coordinates: [targetPoint(target), pin] },
          colour('--map-pin'),
          2,
        );
      }
      if ('point' in target) {
        path.pointRadius(5);
        fill({ type: 'Point', coordinates: target.point }, colour('--map-point'));
      }
    }
    if (pin) {
      path.pointRadius(6);
      fill({ type: 'Point', coordinates: pin }, colour('--map-pin'));
      stroke({ type: 'Point', coordinates: pin }, colour('--bg'), 1.5);
    }
    stroke(SPHERE, colour('--map-border'), 1);
  }, [aim, land]);

  // `schedule` stays the same function for the component's life, drawing with the latest `draw`,
  // so effects that depend on it re-run only for their own inputs.
  const drawRef = useRef(draw);
  const schedule = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(() => drawRef.current());
  }, []);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  useLayoutEffect(() => {
    propsRef.current = props;
    drawRef.current = draw;
  });

  // Size the canvas to its container in device pixels.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width, height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      drawRef.current();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    // Browser zoom or a move to another screen changes the ratio without resizing the container:
    // watch for the current ratio to stop matching, resize, and watch for the new one.
    let ratioQuery: MediaQueryList;
    const onRatioChange = () => {
      resize();
      watchRatio();
    };
    const watchRatio = () => {
      ratioQuery = window.matchMedia(`(resolution: ${sizeRef.current.dpr}dppx)`);
      ratioQuery.addEventListener('change', onRatioChange, { once: true });
    };
    watchRatio();
    return () => {
      observer.disconnect();
      ratioQuery.removeEventListener('change', onRatioChange);
    };
  }, []);

  // Redraw with the new `--map-*` tokens when the colour scheme changes.
  useEffect(() => {
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', schedule);
    return () => scheme.removeEventListener('change', schedule);
  }, [schedule]);

  // Turn to the answer when it is revealed: only when `reveal` itself changes, with the pin as it
  // is then, so a pan after the reveal is kept.
  useEffect(() => {
    if (!reveal) return;
    viewRef.current = revealView(viewRef.current, targetPoint(reveal), propsRef.current.pin);
    schedule();
  }, [reveal, schedule]);

  // Redraw for new data or anything else drawn from props.
  useEffect(schedule, [schedule, draw, props.pin, borders, reveal]);

  usePointerGestures(canvasRef, {
    onGesture: (e) => {
      const view = viewRef.current;
      const { width, height } = sizeRef.current;
      if (e.type === 'tap') {
        const p = aim();
        const at = p.invert?.([e.x, e.y]);
        const onDisc =
          Math.hypot(e.x - width / 2, e.y - height / 2) <= globeRadius(width, height, view.zoom);
        if (at && onDisc && at.every(Number.isFinite)) propsRef.current.onPin([at[0], at[1]]);
        return;
      }
      const radius = globeRadius(width, height, view.zoom);
      viewRef.current =
        e.type === 'drag'
          ? rotateGlobe(view, e.dx, e.dy, radius)
          : zoomGlobeAt(
              rotateGlobe(view, e.dx, e.dy, radius),
              e.factor,
              [e.cx, e.cy],
              width,
              height,
            );
      schedule();
    },
    onWheel: (deltaY, x, y) => {
      const { width, height } = sizeRef.current;
      if (wheelAtLimit(viewRef.current.zoom, deltaY, GLOBE_MIN_ZOOM, GLOBE_MAX_ZOOM)) return false;
      viewRef.current = zoomGlobeAt(viewRef.current, wheelFactor(deltaY), [x, y], width, height);
      schedule();
      return true;
    },
  });

  return (
    <div ref={containerRef} className="globe">
      <canvas
        ref={canvasRef}
        className="map-interactive"
        role="img"
        aria-label={borders ? 'Bordered globe' : 'Bare globe'}
      />
    </div>
  );
}
