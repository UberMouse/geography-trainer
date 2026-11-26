import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { NEIGHBOURHOOD_VIEW_KM, pairBounds, spanZoom } from './camera';
import type { AreaFeature, LngLat } from './geo';
import classes from './Globe.module.css';
import {
  featureAt,
  featureBounds,
  fittedZoom,
  imageryStyle,
  MAX_ZOOM,
  modeLayers,
  OUR_PREFIX,
  PROGRESS_DOT_RADIUS,
  PROGRESS_DOTS_LAYER,
  revealLayers,
  SPACE_COLOUR,
  type GlobeMode,
  type LayerSet,
  type ProgressDot,
  type Reveal,
} from './globeLayers';

export interface GlobeHandle {
  /** Fly to frame the feature's main part. */
  fitFeature(feature: AreaFeature): void;
  flyTo(at: LngLat, zoom: number): void;
  /** Fly to centre `at`, showing about `km` of ground across the globe's shorter side. */
  flyToSpan(at: LngLat, km: number): void;
  /** Fly to frame both points, never closer than `NEIGHBOURHOOD_VIEW_KM` across. */
  fitPoints(a: LngLat, b: LngLat): void;
  /** Fly to the opening view: the whole sphere, centred where it starts. */
  worldView(): void;
  /** Stop a camera flight where it has reached (and drop one held for the opening jump). */
  stop(): void;
}

/** An HTML marker on the globe: MapLibre's default pin, or a name as text. */
export type GlobeMarker = { kind: 'pin'; at: LngLat } | { kind: 'name'; at: LngLat; text: string };

/** What the test hook reports of a marker: `reveal` for the reveal's tap and answer pins. */
export interface MarkerReading {
  kind: GlobeMarker['kind'] | 'reveal';
  text: string;
  lngLat: LngLat;
}

/** Dev builds only: what e2e specs read off the mounted globe. */
export interface GlobeTestHook {
  /** A point's position in viewport CSS pixels. */
  project(at: LngLat): { x: number; y: number };
  center(): LngLat;
  zoom(): number;
  /** Move the camera at once, stopping any flight: to bring a target into view before a tap. */
  jumpTo(at: LngLat, zoom: number): void;
  /** Our layers now in the style, bottom to top (the imagery's excluded). */
  layerIds(): string[];
  /** A number of its own for each map instance created, so a spec can tell it is the same map. */
  instanceId(): number;
  /** The HTML markers now on the globe, in the order they were added. */
  markers(): MarkerReading[];
  /** In progress mode, its fills (id → colour) and dots; null in any other mode. */
  progress(): { fills: Record<string, string>; dots: ProgressDot[] } | null;
}

declare global {
  interface Window {
    __globe?: GlobeTestHook;
  }
}

export interface GlobeProps {
  mode: GlobeMode;
  /** Shown over any mode; absent or null shows none. Pass a memoised object: a new one redraws. */
  reveal?: Reveal | null;
  /** HTML markers over any mode. Pass a memoised array: a new one re-adds them. */
  markers?: GlobeMarker[];
  /** A tap on the globe (not a drag, not the space around it), lng in [-180, 180]. Not in progress mode. */
  onTap?: (at: LngLat) => void;
  /** Progress mode: a tap on one of its dots, else inside one of its features, by id. */
  onSelect?: (id: string) => void;
  ref?: Ref<GlobeHandle>;
}

// MapLibre looks for its worker next to its own module, which Vite's bundling moves: point it at
// the worker file as Vite serves (and, in a build, emits) it.
maplibregl.setWorkerUrl(workerUrl);

const START: LngLat = [0, 20];
/** A tap whose point, unprojected and projected back, moves more than this is off the globe. */
const OFF_GLOBE_PX = 2;
const FIT_PADDING = 40;
/** How far from a progress dot's centre, in CSS px, a tap still lands on it: a fingertip's slack. */
const DOT_HIT_PX = PROGRESS_DOT_RADIUS + 8;
/** Zoom slack when telling a view at the fitted zoom from one the user zoomed in. */
const FITTED_EPSILON = 0.01;

/** MapLibre's globe lets the zoom go this far below minZoom at `lat` (see the opening jump). */
const latAllowance = (lat: number) => Math.log2(Math.cos((lat * Math.PI) / 180));

/**
 * Wide screens, as `GlobeLayout.module.css` has them (Mantine's `sm`, 768px): the attribution is
 * written out in full there, and compact (the ⓘ button) at phone width.
 */
const WIDE_SCREEN = '(min-width: 48em)';

/** Map instances created so far, for the test hook's `instanceId`. */
let instancesCreated = 0;

export const NO_WEBGL = "This browser can't draw the globe: WebGL is off or unsupported.";

const EMPTY: LayerSet = { sources: {}, layers: [] };

/** The id of the progress dot drawn nearest `point` and within `DOT_HIT_PX` of it, if any. */
function dotAt(map: maplibregl.Map, point: maplibregl.Point): string | undefined {
  if (!map.getLayer(PROGRESS_DOTS_LAYER)) return undefined;
  const r = DOT_HIT_PX;
  let nearest: { id: string; px: number } | undefined;
  const hits = map.queryRenderedFeatures(
    [
      [point.x - r, point.y - r],
      [point.x + r, point.y + r],
    ],
    { layers: [PROGRESS_DOTS_LAYER] },
  );
  for (const hit of hits) {
    if (hit.geometry.type !== 'Point') continue;
    const at = map.project(hit.geometry.coordinates as LngLat);
    const px = Math.hypot(at.x - point.x, at.y - point.y);
    if (px <= r && (!nearest || px < nearest.px)) nearest = { id: String(hit.properties.id), px };
  }
  return nearest?.id;
}

/**
 * Replace the `prev` group of our layers and sources with `next`: sources that stay get their
 * new data (unless it is the same object), the rest are removed or added. Layers go below
 * `beforeId` when it is in the style.
 */
function applyLayers(map: maplibregl.Map, prev: LayerSet, next: LayerSet, beforeId?: string) {
  for (const layer of prev.layers) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
  for (const id of Object.keys(prev.sources)) {
    if (!(id in next.sources) && map.getSource(id)) map.removeSource(id);
  }
  for (const [id, source] of Object.entries(next.sources)) {
    const existing = map.getSource<GeoJSONSource>(id);
    if (existing) {
      if (prev.sources[id]?.data !== source.data) existing.setData(source.data);
    } else map.addSource(id, source);
  }
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined;
  for (const layer of next.layers) map.addLayer(layer, before);
}

/**
 * The MapLibre globe: EOX imagery in globe projection, north up, with our layers for `mode` and
 * `reveal` on top. One map per mount; props update its layers in place. Map movement never
 * re-renders it.
 */
export default function Globe({ mode, reveal, markers, onTap, onSelect, ref }: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [failed, setFailed] = useState(false);
  // The mounted map once its style has loaded; null before that and after it is removed.
  const [readyMap, setReadyMap] = useState<maplibregl.Map | null>(null);
  // The latest props, for the map's event handlers, which are bound once.
  const latest = useRef({ mode, onTap, onSelect });
  useEffect(() => {
    latest.current = { mode, onTap, onSelect };
  });
  const applied = useRef({ mode: EMPTY, reveal: EMPTY });
  // The HTML markers now on the map, for the test hook.
  const shownMarkers = useRef(new Map<maplibregl.Marker, Omit<MarkerReading, 'lngLat'>>());
  // Camera calls through the handle before the opening jump, which would undo them: the last one
  // is held and runs right after it.
  const camera = useRef<{ opened: boolean; held: ((map: maplibregl.Map) => void) | null }>({
    opened: false,
    held: null,
  });

  useEffect(() => {
    const container = containerRef.current!;
    const fit = () => {
      const { width, height } = container.getBoundingClientRect();
      return fittedZoom(width, height);
    };
    const mountZoom = fit();
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: imageryStyle(),
        center: START,
        zoom: mountZoom,
        minZoom: mountZoom,
        maxZoom: MAX_ZOOM,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        // A tap is an answer, so two quick taps are two answers, not a zoom (mouse and touch).
        doubleClickZoom: false,
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        // Added below, compact or not by screen width.
        attributionControl: false,
      });
    } catch (error) {
      console.error(error);
      // Deferred, so the effect itself does not set state.
      queueMicrotask(() => setFailed(true));
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    mapRef.current = map;
    const instanceId = ++instancesCreated;

    // In full on wide screens; at phone width, compact and collapsed to the ⓘ button, so the text
    // does not cover the sphere (MapLibre's compact control starts expanded until a drag).
    const wide = window.matchMedia(WIDE_SCREEN);
    let attribution: maplibregl.AttributionControl | null = null;
    const collapseAttribution = () => {
      const el = container.querySelector('.maplibregl-ctrl-attrib');
      // The control turns compact once it has text, after the imagery source has loaded.
      if (!el?.classList.contains('maplibregl-compact')) return;
      el.classList.remove('maplibregl-compact-show');
      map.off('styledata', collapseAttribution);
      map.off('sourcedata', collapseAttribution);
    };
    const placeAttribution = () => {
      map.off('styledata', collapseAttribution);
      map.off('sourcedata', collapseAttribution);
      if (attribution) map.removeControl(attribution);
      attribution = new maplibregl.AttributionControl({ compact: !wide.matches });
      map.addControl(attribution);
      if (wide.matches) return;
      map.on('styledata', collapseAttribution);
      map.on('sourcedata', collapseAttribution);
      collapseAttribution();
    };
    placeAttribution();
    wide.addEventListener('change', placeAttribution);

    // Follow the screen's pixel ratio when it changes (another monitor, browser zoom). A media
    // query matches one ratio, so each change re-arms it for the new one.
    let ratioQuery: MediaQueryList;
    const watchRatio = () => {
      ratioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      ratioQuery.addEventListener('change', onRatioChange, { once: true });
    };
    const onRatioChange = () => {
      map.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      watchRatio();
    };
    watchRatio();

    // A lost context drops the style (MapLibre keeps a snapshot of it): stop applying layers
    // until the snapshot, restored with the context, has loaded. The layer effects then diff
    // the current props against `applied`, which describes what the snapshot holds.
    map.on('webglcontextlost', () => {
      setFailed(true);
      setReadyMap(null);
    });
    map.on('webglcontextrestored', () => {
      setFailed(false);
      map.once('style.load', () => setReadyMap(map));
    });
    map.on('click', (e: MapMouseEvent) => {
      // A tap on a reveal marker is not a tap on the globe.
      const target = e.originalEvent.target;
      if (target instanceof Element && target.closest('.maplibregl-marker')) return;
      const back = map.project(e.lngLat);
      if (Math.hypot(back.x - e.point.x, back.y - e.point.y) > OFF_GLOBE_PX) return;
      const { lng, lat } = e.lngLat.wrap();
      const { mode: current, onTap: tap, onSelect: select } = latest.current;
      if (current.kind === 'progress') {
        // A dot sits over the features, so a tap on it is the dot's.
        const id = dotAt(map, e.point) ?? featureAt(current.features, [lng, lat]);
        if (id !== undefined) select?.(id);
      } else {
        tap?.([lng, lat]);
      }
    });
    // MapLibre watches the container's size and fires `resize`: refit the zoom-out limit to it.
    // A view the user had not zoomed in follows the new fit, so a shrunk container still shows
    // the whole sphere; a zoomed-in view keeps its zoom, unless it is now past the limit, when
    // MapLibre pulls it in to it. The centre stays. A camera flight is left to finish: `jumpTo`
    // would stop it (a page's column often changes height just as its first question flies).
    let fitted = mountZoom;
    map.on('resize', () => {
      // Hidden (a page hides the globe at phone width): nothing to fit until it shows again.
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      const zoom = fit();
      if (!Number.isFinite(zoom)) return;
      const allowance = latAllowance(map.getCenter().lat);
      const atFit =
        camera.current.opened &&
        !map.isMoving() &&
        map.getZoom() <= fitted + allowance + FITTED_EPSILON;
      fitted = zoom;
      map.setMinZoom(zoom);
      if (atFit) map.jumpTo({ zoom: zoom + allowance });
    });
    // The style, not `load`, which also waits for the first imagery tiles.
    map.once('style.load', () => {
      // The container may have changed size since the map was made: fit to it as it is now.
      const minZoom = fit();
      fitted = minZoom;
      map.setMinZoom(minZoom);
      // MapLibre's globe grows by 1 / cos(lat) at a zoom, and its minZoom is the zoom at the
      // equator (it clamps to minZoom + log2(cos lat)): this zoom, below minZoom, fits the whole
      // sphere at the starting latitude. Only now, in globe projection: before the style loads,
      // the zoom is clamped to minZoom without that allowance.
      map.jumpTo({ zoom: minZoom + latAllowance(START[1]) });
      camera.current.opened = true;
      camera.current.held?.(map);
      camera.current.held = null;
      setReadyMap(map);
      if (import.meta.env.DEV) {
        // Ready once the camera has settled after that jump and the first tiles are in.
        const markReady = () => {
          if (map.isMoving()) map.once('idle', markReady);
          else container.dataset.ready = 'true';
        };
        map.once('idle', markReady);
        window.__globe = {
          project: (at) => {
            const p = map.project(at);
            const box = container.getBoundingClientRect();
            return { x: box.left + p.x, y: box.top + p.y };
          },
          center: () => map.getCenter().toArray() as LngLat,
          zoom: () => map.getZoom(),
          jumpTo: (at, zoom) => map.jumpTo({ center: at, zoom }),
          layerIds: () =>
            map
              .getStyle()
              .layers.map((l) => l.id)
              .filter((id) => id.startsWith(OUR_PREFIX)),
          instanceId: () => instanceId,
          markers: () =>
            [...shownMarkers.current].map(([marker, reading]) => ({
              ...reading,
              lngLat: marker.getLngLat().toArray() as LngLat,
            })),
          progress: () => {
            const current = latest.current.mode;
            return current.kind === 'progress'
              ? { fills: current.fills, dots: current.dots ?? [] }
              : null;
          },
        };
      }
    });

    return () => {
      ratioQuery.removeEventListener('change', onRatioChange);
      wide.removeEventListener('change', placeAttribution);
      if (import.meta.env.DEV) delete window.__globe;
      map.remove();
      mapRef.current = null;
      applied.current = { mode: EMPTY, reveal: EMPTY };
      camera.current = { opened: false, held: null };
      setReadyMap(null);
    };
  }, []);

  useEffect(() => {
    const map = readyMap;
    if (!map) return;
    const next = modeLayers(mode);
    // Below the reveal, which stays on top.
    applyLayers(map, applied.current.mode, next, applied.current.reveal.layers[0]?.id);
    applied.current.mode = next;
  }, [mode, readyMap]);

  useEffect(() => {
    const map = readyMap;
    if (!map) return;
    const next = reveal ? revealLayers(reveal) : EMPTY;
    applyLayers(map, applied.current.reveal, next);
    applied.current.reveal = next;
    if (!reveal?.tap) return;
    const shown = shownMarkers.current;
    const added = [
      new maplibregl.Marker({ color: '#fa5252' }).setLngLat(reveal.tap.at).addTo(map),
      new maplibregl.Marker({ color: '#40c057' }).setLngLat(reveal.tap.answer).addTo(map),
    ];
    for (const m of added) shown.set(m, { kind: 'reveal', text: '' });
    return () =>
      added.forEach((m) => {
        m.remove();
        shown.delete(m);
      });
  }, [reveal, readyMap]);

  useEffect(() => {
    const map = readyMap;
    if (!map || !markers?.length) return;
    const shown = shownMarkers.current;
    const added = markers.map((m) => {
      let marker: maplibregl.Marker;
      if (m.kind === 'pin') {
        marker = new maplibregl.Marker();
        // A tap on the pin is a tap on the globe beneath it, so the pin can be moved by a tap
        // that lands on it.
        marker.getElement().style.pointerEvents = 'none';
        shown.set(marker, { kind: 'pin', text: '' });
      } else {
        const element = document.createElement('div');
        element.className = classes.name!;
        element.textContent = m.text;
        marker = new maplibregl.Marker({ element, anchor: 'top', offset: [0, 6] });
        shown.set(marker, { kind: 'name', text: m.text });
      }
      return marker.setLngLat(m.at).addTo(map);
    });
    return () =>
      added.forEach((m) => {
        m.remove();
        shown.delete(m);
      });
  }, [markers, readyMap]);

  useImperativeHandle(ref, () => {
    const shortSide = () => {
      const { width, height } = containerRef.current!.getBoundingClientRect();
      return Math.min(width, height);
    };
    const move = (call: (map: maplibregl.Map) => void) => {
      const map = mapRef.current;
      if (!map) return;
      if (camera.current.opened) call(map);
      else camera.current.held = call;
    };
    return {
      fitFeature: (feature) =>
        move((map) => map.fitBounds(featureBounds(feature), { padding: FIT_PADDING })),
      flyTo: (at, zoom) => move((map) => map.flyTo({ center: at, zoom })),
      flyToSpan: (at, km) =>
        move((map) => map.flyTo({ center: at, zoom: spanZoom(km, shortSide(), at[1]) })),
      fitPoints: (a, b) =>
        move((map) =>
          map.fitBounds(pairBounds(a, b), {
            padding: FIT_PADDING,
            maxZoom: spanZoom(NEIGHBOURHOOD_VIEW_KM, shortSide(), (a[1] + b[1]) / 2),
          }),
        ),
      // minZoom is the fitted zoom at the equator; the same allowance below it as the opening jump.
      worldView: () =>
        move((map) =>
          map.flyTo({ center: START, zoom: map.getMinZoom() + latAllowance(START[1]) }),
        ),
      stop: () => {
        camera.current.held = null;
        mapRef.current?.stop();
      },
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: SPACE_COLOUR }}>
      {failed ? (
        <p role="alert" style={{ padding: 16, margin: 0 }}>
          {NO_WEBGL}
        </p>
      ) : null}
      <div
        ref={containerRef}
        data-mode={import.meta.env.DEV ? mode.kind : undefined}
        style={{ position: 'absolute', inset: 0, visibility: failed ? 'hidden' : undefined }}
      />
    </div>
  );
}
