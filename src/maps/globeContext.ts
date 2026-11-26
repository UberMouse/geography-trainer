import { createContext, useContext, useEffect, useId, useRef, type RefObject } from 'react';
import type { CameraMove } from './camera';
import type { LngLat } from './geo';
import type { GlobeHandle, GlobeMarker } from './Globe';
import type { GlobeMode, Reveal } from './globeLayers';

/** The camera calls on the app's one globe. They do nothing while it has no map (no WebGL). */
export type GlobeCamera = GlobeHandle;

/** Make `move` on the globe. */
export function moveCamera(camera: GlobeCamera, move: CameraMove): void {
  switch (move.kind) {
    case 'fit':
      return camera.fitFeature(move.feature);
    case 'span':
      return camera.flyToSpan(move.at, move.km);
    case 'pair':
      return camera.fitPoints(move.a, move.b);
    case 'world':
      return camera.worldView();
    case 'stay':
      return camera.stop();
  }
}

/**
 * What a page or exercise shows on the globe and how taps reach it. Each field left out is off:
 * the bare globe, no reveal, no markers, taps ignored. Pass memoised `mode`, `reveal` and
 * `markers`: a new object redraws. The handlers may be new on every render.
 */
export interface GlobeSettings {
  mode?: GlobeMode;
  reveal?: Reveal | null;
  markers?: GlobeMarker[];
  /** A tap on the globe (not a drag, not the space around it). Not in progress mode. */
  onTap?: (at: LngLat) => void;
  /** Progress mode: a tap on one of its dots, else inside one of its features, by id. */
  onSelect?: (id: string) => void;
}

/** The provider's side of the globe; pages and exercises go through `useGlobe`. */
export interface GlobeApi {
  camera: GlobeCamera;
  /** Show `settings` for `owner`, replacing whatever was shown. */
  show(owner: string, settings: GlobeSettings): void;
  /** Stop showing `owner`'s settings, if they are still the ones shown. */
  clear(owner: string): void;
}

export const GlobeApiContext = createContext<GlobeApi | null>(null);

/** The mounted globe's handle, which `SharedGlobe` fills and the camera calls. */
export const GlobeHandleContext = createContext<RefObject<GlobeHandle | null> | null>(null);

/** The settings now shown on the globe; null shows the bare globe. */
export const GlobeSettingsContext = createContext<GlobeSettings | null>(null);

/**
 * The app's one globe, from a page or exercise: shows `settings` while the caller is mounted (and
 * until it shows other ones), and returns the camera. On unmount the caller's mode, reveal,
 * markers and handlers all stop applying together; the camera stays where it is. Without
 * `settings` the caller only uses the camera and leaves the globe's settings alone.
 *
 * One caller sets the globe at a time: the latest to show its settings wins.
 */
export function useGlobe(settings?: GlobeSettings): GlobeCamera {
  const api = useContext(GlobeApiContext);
  if (!api) throw new Error('useGlobe needs a GlobeProvider');
  const owner = useId();
  // The latest handlers, so a new function each render does not re-show the settings.
  const latest = useRef(settings);
  useEffect(() => {
    latest.current = settings;
  });
  const shows = settings !== undefined;
  const { mode, reveal, markers } = settings ?? {};
  const taps = settings?.onTap !== undefined;
  const selects = settings?.onSelect !== undefined;
  const { show, clear } = api;
  useEffect(() => {
    if (!shows) return;
    show(owner, {
      mode,
      reveal,
      markers,
      onTap: taps ? (at) => latest.current?.onTap?.(at) : undefined,
      onSelect: selects ? (id) => latest.current?.onSelect?.(id) : undefined,
    });
    return () => clear(owner);
  }, [show, clear, owner, shows, mode, reveal, markers, taps, selects]);
  return api.camera;
}
