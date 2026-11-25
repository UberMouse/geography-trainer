import { geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { type AreaFeature, type LngLat, type TapTarget } from './geo';
import { usePointerGestures } from './usePointerGestures';
import {
  NEUTRAL_VIEW,
  globeRadius,
  revealView,
  rotateGlobe,
  wheelFactor,
  zoomGlobe,
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
const targetAnswer = (t: TapTarget): LngLat => ('point' in t ? t.point : t.answer);

/**
 * An orthographic globe on a canvas: ocean and land only, with country borders when `borders`.
 * Drag rotates, wheel or pinch zooms (1–64×), a tap calls `onPin`. On `reveal` it turns to the
 * target (see `revealView`) and draws the target, the pin and the great circle between them. The
 * canvas carries its view as `data-rotation="<lng>,<lat>"` and `data-zoom`.
 */
export default function BareGlobe(props: Props) {
  const { features, borders, initialView, reveal } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<GlobeView>(initialView ?? NEUTRAL_VIEW);
  const sizeRef = useRef({ width: 0, height: 0 });
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
    const { width, height } = sizeRef.current;
    const dpr = window.devicePixelRatio || 1;
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
        fill(target.feature, colour('--map-reveal'));
        stroke(target.feature, colour('--map-border'), 1);
      }
      if (pin) {
        stroke(
          { type: 'LineString', coordinates: [targetAnswer(target), pin] },
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

  const schedule = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  useLayoutEffect(() => {
    propsRef.current = props;
  });

  // Size the canvas to its container in device pixels.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { width, height };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      draw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  // Turn to the answer when it is revealed (once per reveal, with the pin as it is then).
  useEffect(() => {
    if (!reveal) return;
    viewRef.current = revealView(viewRef.current, targetAnswer(reveal), propsRef.current.pin);
    schedule();
  }, [reveal, schedule]);

  // Anything else drawn from props.
  useEffect(schedule, [schedule, props.pin, borders, reveal]);

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
          : zoomGlobe(rotateGlobe(view, e.dx, e.dy, radius), e.factor);
      schedule();
    },
    onWheel: (deltaY) => {
      viewRef.current = zoomGlobe(viewRef.current, wheelFactor(deltaY));
      schedule();
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
