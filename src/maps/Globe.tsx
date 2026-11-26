import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapMouseEvent } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { AreaFeature, LngLat } from './geo';
import {
  featureAt,
  featureBounds,
  fittedZoom,
  imageryStyle,
  modeLayers,
  OUR_PREFIX,
  revealLayers,
  SPACE_COLOUR,
  type GlobeMode,
  type LayerSet,
  type Reveal,
} from './globeLayers';

export interface GlobeHandle {
  /** Fly to frame the feature's main part. */
  fitFeature(feature: AreaFeature): void;
  flyTo(at: LngLat, zoom: number): void;
}

/** Dev builds only: what e2e specs read off the mounted globe. */
export interface GlobeTestHook {
  /** A point's position in viewport CSS pixels. */
  project(at: LngLat): { x: number; y: number };
  center(): LngLat;
  zoom(): number;
  /** Our layers now in the style, bottom to top (the imagery's excluded). */
  layerIds(): string[];
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
  /** A tap on the globe (not a drag, not the space around it), lng in [-180, 180]. Not in progress mode. */
  onTap?: (at: LngLat) => void;
  /** Progress mode: a tap inside one of the tier's features, by id. */
  onSelect?: (id: string) => void;
  ref?: Ref<GlobeHandle>;
}

// MapLibre looks for its worker next to its own module, which Vite's bundling moves: point it at
// the worker file as Vite serves (and, in a build, emits) it.
maplibregl.setWorkerUrl(workerUrl);

const START: LngLat = [0, 20];
const MAX_ZOOM = 14;
/** A tap whose point, unprojected and projected back, moves more than this is off the globe. */
const OFF_GLOBE_PX = 2;
const FIT_PADDING = 40;

export const NO_WEBGL = "This browser can't draw the globe: WebGL is off or unsupported.";

const EMPTY: LayerSet = { sources: {}, layers: [] };

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
export default function Globe({ mode, reveal, onTap, onSelect, ref }: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [failed, setFailed] = useState(false);
  const [styleReady, setStyleReady] = useState(false);
  // The latest props, for the map's event handlers, which are bound once.
  const latest = useRef({ mode, onTap, onSelect });
  useEffect(() => {
    latest.current = { mode, onTap, onSelect };
  });
  const applied = useRef({ mode: EMPTY, reveal: EMPTY });

  useEffect(() => {
    const container = containerRef.current!;
    const fit = () => {
      const { width, height } = container.getBoundingClientRect();
      return fittedZoom(width, height);
    };
    const minZoom = fit();
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style: imageryStyle(),
        center: START,
        zoom: minZoom,
        minZoom,
        maxZoom: MAX_ZOOM,
        maxPitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        pixelRatio: Math.min(window.devicePixelRatio, 2),
        attributionControl: { compact: false },
      });
    } catch {
      // Deferred, so the effect itself does not set state.
      queueMicrotask(() => setFailed(true));
      return;
    }
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    mapRef.current = map;

    map.on('webglcontextlost', () => setFailed(true));
    map.on('click', (e: MapMouseEvent) => {
      const back = map.project(e.lngLat);
      if (Math.hypot(back.x - e.point.x, back.y - e.point.y) > OFF_GLOBE_PX) return;
      const { lng, lat } = e.lngLat.wrap();
      const { mode: current, onTap: tap, onSelect: select } = latest.current;
      if (current.kind === 'progress') {
        const id = featureAt(current.features, [lng, lat]);
        if (id !== undefined) select?.(id);
      } else {
        tap?.([lng, lat]);
      }
    });
    // MapLibre watches the container's size and fires `resize`: refit the zoom-out limit to it.
    // A view zoomed out past the new limit is pulled in to it; the centre stays.
    map.on('resize', () => map.setMinZoom(fit()));
    // The style, not `load`, which also waits for the first imagery tiles.
    map.once('style.load', () => {
      // MapLibre's globe grows by 1 / cos(lat) at a zoom, and its minZoom is the zoom at the
      // equator (it clamps to minZoom + log2(cos lat)): this zoom, below minZoom, fits the whole
      // sphere at the starting latitude. Only now, in globe projection: before the style loads,
      // the zoom is clamped to minZoom without that allowance.
      map.jumpTo({ zoom: minZoom + Math.log2(Math.cos((START[1] * Math.PI) / 180)) });
      setStyleReady(true);
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
          layerIds: () =>
            map
              .getStyle()
              .layers.map((l) => l.id)
              .filter((id) => id.startsWith(OUR_PREFIX)),
        };
      }
    });

    return () => {
      if (import.meta.env.DEV) delete window.__globe;
      map.remove();
      mapRef.current = null;
      applied.current = { mode: EMPTY, reveal: EMPTY };
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const next = modeLayers(mode);
    // Below the reveal, which stays on top.
    applyLayers(map, applied.current.mode, next, applied.current.reveal.layers[0]?.id);
    applied.current.mode = next;
  }, [mode, styleReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
    const next = reveal ? revealLayers(reveal) : EMPTY;
    applyLayers(map, applied.current.reveal, next);
    applied.current.reveal = next;
    if (!reveal) return;
    const markers = [
      new maplibregl.Marker({ color: '#fa5252' }).setLngLat(reveal.tap).addTo(map),
      new maplibregl.Marker({ color: '#40c057' }).setLngLat(reveal.answer).addTo(map),
    ];
    return () => markers.forEach((m) => m.remove());
  }, [reveal, styleReady]);

  useImperativeHandle(
    ref,
    () => ({
      fitFeature: (feature) =>
        mapRef.current?.fitBounds(featureBounds(feature), { padding: FIT_PADDING }),
      flyTo: (at, zoom) => mapRef.current?.flyTo({ center: at, zoom }),
    }),
    [],
  );

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
