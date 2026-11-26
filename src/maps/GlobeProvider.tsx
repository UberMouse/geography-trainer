import { useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import Globe, { type GlobeHandle } from './Globe';
import {
  GlobeApiContext,
  GlobeHandleContext,
  GlobeSettingsContext,
  type GlobeApi,
  type GlobeSettings,
} from './globeContext';
import type { GlobeMode } from './globeLayers';

const BARE: GlobeMode = { kind: 'bare' };

interface Shown {
  owner: string;
  settings: GlobeSettings;
}

/**
 * Holds the settings for the app's one globe (see `useGlobe`) and the camera calls, which reach
 * the `SharedGlobe` rendered inside it.
 */
export function GlobeProvider({ children }: { children: ReactNode }) {
  const handle = useRef<GlobeHandle | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const show = useCallback((owner: string, settings: GlobeSettings) => {
    setShown({ owner, settings });
  }, []);
  const clear = useCallback((owner: string) => {
    setShown((current) => (current?.owner === owner ? null : current));
  }, []);
  const api = useMemo(
    (): GlobeApi => ({
      camera: {
        fitFeature: (feature) => handle.current?.fitFeature(feature),
        flyTo: (at, zoom) => handle.current?.flyTo(at, zoom),
        flyToSpan: (at, km) => handle.current?.flyToSpan(at, km),
        fitPoints: (a, b) => handle.current?.fitPoints(a, b),
        worldView: () => handle.current?.worldView(),
        stop: () => handle.current?.stop(),
      },
      show,
      clear,
    }),
    [show, clear],
  );
  return (
    <GlobeApiContext.Provider value={api}>
      <GlobeHandleContext.Provider value={handle}>
        <GlobeSettingsContext.Provider value={shown?.settings ?? null}>
          {children}
        </GlobeSettingsContext.Provider>
      </GlobeHandleContext.Provider>
    </GlobeApiContext.Provider>
  );
}

/** The one globe, showing the current settings; mounted once, in the app shell. */
export function SharedGlobe() {
  const handle = useContext(GlobeHandleContext);
  if (!handle) throw new Error('SharedGlobe needs a GlobeProvider');
  const settings = useContext(GlobeSettingsContext);
  return (
    <Globe
      ref={handle}
      mode={settings?.mode ?? BARE}
      reveal={settings?.reveal}
      markers={settings?.markers}
      onTap={settings?.onTap}
      onSelect={settings?.onSelect}
    />
  );
}
