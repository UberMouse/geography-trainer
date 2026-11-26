import { expect, type Page } from './test';

export type LngLat = [number, number];

/** A marker as the hook reports it (see `MarkerReading` in `src/maps/Globe.tsx`). */
export interface MarkerReading {
  kind: 'pin' | 'name' | 'reveal';
  text: string;
  lngLat: LngLat;
}

/** `window.__globe`, the dev-only hook the app's globe exposes. */
interface GlobeHook {
  project(at: LngLat): { x: number; y: number };
  center(): LngLat;
  zoom(): number;
  layerIds(): string[];
  instanceId(): number;
  markers(): MarkerReading[];
}

/** The page's `window.__globe` (the e2e specs have no DOM types, so no `window`). */
type HookWindow = { __globe: GlobeHook };

/** Calls on the page's `window.__globe`. */
export const hook = {
  project: (page: Page, at: LngLat) =>
    page.evaluate((p) => (globalThis as unknown as HookWindow).__globe.project(p), at),
  center: (page: Page) =>
    page.evaluate(() => (globalThis as unknown as HookWindow).__globe.center()),
  zoom: (page: Page) => page.evaluate(() => (globalThis as unknown as HookWindow).__globe.zoom()),
  layerIds: (page: Page) =>
    page.evaluate(() => (globalThis as unknown as HookWindow).__globe.layerIds()),
  instanceId: (page: Page) =>
    page.evaluate(() => (globalThis as unknown as HookWindow).__globe.instanceId()),
  markers: (page: Page) =>
    page.evaluate(() => (globalThis as unknown as HookWindow).__globe.markers()),
};

/** The page's size and how far it scrolls. */
export const viewport = (page: Page) =>
  page.locator('html').evaluate((el) => ({
    width: el.clientWidth,
    height: el.clientHeight,
    scrollWidth: el.scrollWidth,
    scrollHeight: el.scrollHeight,
  }));

/** The app's globe once its map has loaded its style and first gone idle. */
export const globeReady = (page: Page) =>
  page.locator('[data-ready="true"]').waitFor({ state: 'attached', timeout: 20_000 });

/** The app's globe once its style has loaded and the hook is there (the imagery may not be). */
export const globeHooked = (page: Page) =>
  expect
    .poll(
      () =>
        page.evaluate(
          () => (globalThis as unknown as Partial<HookWindow>).__globe?.instanceId() ?? null,
        ),
      { timeout: 20_000 },
    )
    .not.toBeNull();
