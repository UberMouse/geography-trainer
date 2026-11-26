import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const EOX_TILE = /\/s2cloudless-2025_3857\/default\/GoogleMapsCompatible\/\d+\/\d+\/\d+\.jpg/;
const FIXTURE_TILE = fileURLToPath(new URL('./fixtures/eox-tile.jpg', import.meta.url));

/** Tile URLs the page asked EOX for, all answered with the fixture tile. */
let eoxRequests: string[] = [];

// No test touches EOX: every request to it gets the local fixture tile.
test.beforeEach(async ({ page }) => {
  eoxRequests = [];
  await page.route('https://tiles.maps.eox.at/**', (route) => {
    eoxRequests.push(route.request().url());
    return route.fulfill({ path: FIXTURE_TILE, contentType: 'image/jpeg' });
  });
});

/** The Globe tab, once its lazily loaded module has rendered. */
async function globeTab(page: Page) {
  await page.goto('/playground?mode=globe');
  const slot = page.getByTestId('globe-slot');
  await expect(slot).toBeVisible();
  const heading = page.getByRole('heading', { name: 'Globe playground' });
  return { slot, panel: page.locator('section', { has: heading }) };
}

const viewport = (page: Page) =>
  page.locator('html').evaluate((el) => ({
    width: el.clientWidth,
    height: el.clientHeight,
    scrollWidth: el.scrollWidth,
    scrollHeight: el.scrollHeight,
  }));

test('wide screens put a 320px panel left of the globe, and the page does not scroll', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'wide screens only');
  const { slot, panel } = await globeTab(page);
  const panelBox = (await panel.boundingBox())!;
  const slotBox = (await slot.boundingBox())!;
  const vp = await viewport(page);
  expect(panelBox.x).toBe(0);
  expect(Math.abs(panelBox.width - 320)).toBeLessThanOrEqual(2);
  expect(panelBox.height).toBeCloseTo(vp.height, 0);
  expect(slotBox.x).toBeGreaterThanOrEqual(panelBox.x + panelBox.width);
  expect(slotBox.x + slotBox.width).toBeCloseTo(vp.width, 0);
  expect(slotBox.height).toBeCloseTo(vp.height, 0);
  expect(vp.scrollHeight).toBeLessThanOrEqual(vp.height);
  expect(vp.scrollWidth).toBeLessThanOrEqual(vp.width);
});

test('phone width puts the globe above the panel, all inside the viewport', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'phone width only');
  const { slot, panel } = await globeTab(page);
  const panelBox = (await panel.boundingBox())!;
  const slotBox = (await slot.boundingBox())!;
  const vp = await viewport(page);
  expect(slotBox.y).toBeCloseTo(0, 0);
  expect(slotBox.y + slotBox.height).toBeLessThanOrEqual(panelBox.y);
  expect(slotBox.height).toBeGreaterThanOrEqual(vp.height / 2);
  expect(vp.scrollWidth).toBeLessThanOrEqual(vp.width);
  const choices = page.getByTestId('demo-choice');
  await expect(choices).toHaveCount(4);
  for (const choice of await choices.all()) {
    const box = (await choice.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width - 16);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  }
});

/** A tab's link in the playground's own nav, which the Globe tab covers. */
const playgroundTab = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Playground', exact: true }).getByRole('link', { name });

test('the panel links back to the Maps and Exercises tabs', async ({ page }) => {
  for (const [name, url] of [
    ['Maps', /\/playground$/],
    ['Exercises', /\/playground\?mode=exercises$/],
  ] as const) {
    await globeTab(page);
    const panelNav = page.getByRole('navigation', { name: 'Playground tabs' });
    await panelNav.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByTestId('globe-slot')).toHaveCount(0);
    await expect(playgroundTab(page, name)).toHaveAttribute('aria-current', 'page');
  }
});

test('the playground nav opens the Globe tab', async ({ page }) => {
  await page.goto('/playground');
  await playgroundTab(page, 'Globe').click();
  await expect(page.getByTestId('globe-slot')).toBeVisible();
  await expect(playgroundTab(page, 'Globe')).toHaveAttribute('aria-current', 'page');
});

type LngLat = [number, number];

/** `window.__globe`, the dev-only hook the mounted globe exposes. */
interface GlobeHook {
  project(at: LngLat): { x: number; y: number };
  center(): LngLat;
  zoom(): number;
  layerIds(): string[];
}

/** Calls on the page's `window.__globe` (the e2e specs have no DOM types, so no `window`). */
const hook = {
  project: (page: Page, at: LngLat) =>
    page.evaluate((p) => (globalThis as unknown as { __globe: GlobeHook }).__globe.project(p), at),
  center: (page: Page) =>
    page.evaluate(() => (globalThis as unknown as { __globe: GlobeHook }).__globe.center()),
  zoom: (page: Page) =>
    page.evaluate(() => (globalThis as unknown as { __globe: GlobeHook }).__globe.zoom()),
  layerIds: (page: Page) =>
    page.evaluate(() => (globalThis as unknown as { __globe: GlobeHook }).__globe.layerIds()),
};

/** The Globe tab once the map has loaded its style and first gone idle. */
async function readyGlobe(page: Page) {
  const tab = await globeTab(page);
  await expect(page.locator('[data-ready="true"]')).toHaveCount(1, { timeout: 20_000 });
  const box = (await tab.slot.boundingBox())!;
  return { ...tab, box, lastTap: page.getByTestId('globe-last-tap') };
}

/** Touch through CDP, so two fingers can move at once (Playwright's touchscreen only taps). */
async function touchSession(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return (type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number][]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    });
}

const tapAt = (page: Page, isMobile: boolean, { x, y }: { x: number; y: number }) =>
  isMobile ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);

/** Wait for the next frame, so a tap's handlers have run and React has rendered. */
const nextFrame = (page: Page) =>
  page.evaluate(() => {
    const { requestAnimationFrame } = globalThis as unknown as {
      requestAnimationFrame(callback: () => void): number;
    };
    return new Promise((done) => requestAnimationFrame(() => done(null)));
  });

async function pickMode(page: Page, mode: string) {
  await page.getByRole('combobox', { name: 'Mode' }).click();
  await page.getByRole('option', { name: mode, exact: true }).click();
}

test('the globe loads stubbed EOX imagery and credits EOX', async ({ page }) => {
  await readyGlobe(page);
  expect(eoxRequests.some((url) => EOX_TILE.test(url))).toBe(true);
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('EOX');
});

test('a tap on Paris puts Paris in the last-tap readout', async ({ page, isMobile }) => {
  const { lastTap } = await readyGlobe(page);
  await expect(lastTap).toHaveText('none');
  await tapAt(page, isMobile, await hook.project(page, [2.35, 48.85]));
  await expect(lastTap).not.toHaveText('none');
  const [lng, lat] = (await lastTap.textContent())!.split(',').map(Number);
  expect(Math.abs(lng! - 2.35)).toBeLessThan(0.5);
  expect(Math.abs(lat! - 48.85)).toBeLessThan(0.5);
});

test('with EOX never answering, the borders still draw and a tap still registers', async ({
  page,
  isMobile,
}) => {
  await page.unroute('https://tiles.maps.eox.at/**');
  // Left hanging: the imagery never arrives.
  await page.route('https://tiles.maps.eox.at/**', () => {});
  await globeTab(page);
  const layerIds = () =>
    page.evaluate(
      () => (globalThis as unknown as { __globe?: GlobeHook }).__globe?.layerIds() ?? [],
    );
  await expect.poll(layerIds).toContain('gt-country-borders');
  const lastTap = page.getByTestId('globe-last-tap');
  await tapAt(page, isMobile, await hook.project(page, [2.35, 48.85]));
  await expect(lastTap).not.toHaveText('none');
  await expect(page.locator('[data-ready="true"]')).toHaveCount(0);
});

test('a drag spins the globe and is not a tap', async ({ page, isMobile }) => {
  const { box, lastTap } = await readyGlobe(page);
  const before = await hook.center(page);
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  if (isMobile) {
    const touch = await touchSession(page);
    await touch('touchStart', [[cx, cy]]);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [[cx + 12 * i, cy + 6 * i]]);
    await touch('touchEnd', []);
  } else {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 30, { steps: 5 });
    await page.mouse.up();
  }
  await expect.poll(() => hook.center(page)).not.toEqual(before);
  await nextFrame(page);
  await expect(lastTap).toHaveText('none');
});

test('wheel zooms the globe in', async ({ page, isMobile }) => {
  test.skip(isMobile, 'no wheel on a phone; the pinch test covers zoom there');
  const { box } = await readyGlobe(page);
  const before = await hook.zoom(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => hook.zoom(page)).toBeGreaterThan(before);
});

test('a two-finger pinch zooms the globe in', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch only');
  const { box, lastTap } = await readyGlobe(page);
  const before = await hook.zoom(page);
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  const touch = await touchSession(page);
  await touch('touchStart', [
    [cx - 20, cy],
    [cx + 20, cy],
  ]);
  for (let i = 1; i <= 5; i++) {
    await touch('touchMove', [
      [cx - 20 - 10 * i, cy],
      [cx + 20 + 10 * i, cy],
    ]);
  }
  await touch('touchEnd', []);
  await expect.poll(() => hook.zoom(page)).toBeGreaterThan(before);
  await expect(lastTap).toHaveText('none');
});

test('each mode draws its own layers', async ({ page }) => {
  await readyGlobe(page);
  const map = page.locator('[data-mode]');
  await expect(map).toHaveAttribute('data-mode', 'countryBorders');
  await expect.poll(() => hook.layerIds(page)).toContain('gt-country-borders');

  await pickMode(page, 'Bare');
  await expect(map).toHaveAttribute('data-mode', 'bare');
  await expect.poll(() => hook.layerIds(page)).toEqual([]);

  await pickMode(page, 'Highlight');
  await expect(page.getByRole('combobox', { name: 'Country' })).toHaveValue('France');
  await expect(map).toHaveAttribute('data-mode', 'highlight');
  await expect.poll(() => hook.layerIds(page)).toContain('gt-highlight-fill');
});

test('a tap in the space beside the globe is not a tap', async ({ page, isMobile }) => {
  const { box, lastTap } = await readyGlobe(page);
  // The slot's top-left corner: the sphere is a disc in the middle, with a margin around it.
  await tapAt(page, isMobile, { x: box.x + 8, y: box.y + 8 });
  await nextFrame(page);
  await expect(lastTap).toHaveText('none');
});

test('a lost WebGL context shows the message until the context comes back', async ({ page }) => {
  await readyGlobe(page);
  const canvas = page.locator('canvas.maplibregl-canvas');
  // Through the canvas's own context's WEBGL_lose_context extension (no DOM types here). A lost
  // context hands out no extensions, so the one fetched before the loss is kept on the canvas.
  const context = (call: 'loseContext' | 'restoreContext') =>
    canvas.evaluate((el, name) => {
      type LoseContext = Record<'loseContext' | 'restoreContext', () => void>;
      const canvasEl = el as unknown as {
        loseContextExt?: LoseContext;
        getContext(kind: string): { getExtension(ext: string): LoseContext | null } | null;
      };
      canvasEl.loseContextExt ??= canvasEl
        .getContext('webgl2')!
        .getExtension('WEBGL_lose_context')!;
      canvasEl.loseContextExt[name]();
    }, call);
  const message = page.getByRole('alert').filter({ hasText: "This browser can't draw the globe" });
  await context('loseContext');
  await expect(message).toBeVisible();
  await context('restoreContext');
  await expect(message).toHaveCount(0);
  await expect(canvas).toBeVisible();
});
