import { globeHooked, globeReady, hook, viewport } from './globeHook';
import { answer, current } from './sessionHelpers';
import { expect, test, type Page } from './test';

// The app shell: one globe for every page, beside (or below) the page's column.

const column = (page: Page) => page.getByTestId('column');
const globeSlot = (page: Page) => page.getByTestId('globe-slot');

/** Every page, with something on it that shows it has rendered. */
const PAGES = [
  { path: '/', heading: 'Geography Trainer' },
  { path: '/progress', heading: 'Progress' },
  { path: '/progress/france', heading: 'France' },
  { path: '/placement', heading: 'Placement test' },
  { path: '/session', heading: undefined },
  { path: '/settings', heading: 'Settings' },
  { path: '/credits', heading: 'Credits' },
];

/** Pages whose globe is hidden at phone width. */
const NO_PHONE_GLOBE = ['/settings', '/credits'];

test('[GLB-01] client-side links between pages keep the same globe', async ({ page }) => {
  // Five pages, each loading its data and drawing on the globe: slow on a loaded machine.
  test.setTimeout(120_000);
  await page.goto('/');
  await globeHooked(page);
  const instance = await hook.instanceId(page);
  await page.getByRole('link', { name: /^Start/ }).click();
  await page.getByRole('link', { name: 'Quit' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Geography Trainer' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await page.getByRole('link', { name: 'See your progress' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Geography Trainer' })).toBeVisible();
  expect(await hook.instanceId(page)).toBe(instance);
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(1);
});

for (const { path, heading } of PAGES) {
  test(`[GLB-29, GLB-30, GLB-31, GLB-C16] ${path}: the column sits beside the globe, or below it at phone width, and nothing scrolls sideways`, async ({
    page,
    isMobile,
  }) => {
    await page.goto(path);
    if (heading) await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    const vp = await viewport(page);
    const columnBox = (await column(page).boundingBox())!;
    expect(vp.scrollWidth).toBeLessThanOrEqual(vp.width);
    expect(vp.scrollHeight).toBeLessThanOrEqual(vp.height);
    if (!isMobile) {
      const slotBox = (await globeSlot(page).boundingBox())!;
      expect(columnBox.x).toBe(0);
      expect(Math.abs(columnBox.width - 320)).toBeLessThanOrEqual(2);
      expect(columnBox.height).toBeCloseTo(vp.height, 0);
      expect(slotBox.x).toBeGreaterThanOrEqual(columnBox.x + columnBox.width);
      expect(slotBox.x + slotBox.width).toBeCloseTo(vp.width, 0);
    } else if (NO_PHONE_GLOBE.includes(path)) {
      await expect(globeSlot(page)).toBeHidden();
      expect(columnBox.y).toBe(0);
      expect(columnBox.height).toBeCloseTo(vp.height, 0);
    } else {
      const slotBox = (await globeSlot(page).boundingBox())!;
      expect(slotBox.y).toBeCloseTo(0, 0);
      expect(slotBox.height).toBeGreaterThanOrEqual(vp.height / 2 - 1);
      expect(slotBox.y + slotBox.height).toBeLessThanOrEqual(columnBox.y);
      expect(columnBox.y + columnBox.height).toBeCloseTo(vp.height, 0);
    }
  });
}

test('[GLB-31, GLB-04] the globe hidden on Settings at phone width is the same map, resized when it shows again', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'phone width only');
  await page.goto('/');
  await globeHooked(page);
  const instance = await hook.instanceId(page);
  const homeLoaded = () => expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await homeLoaded();
  // The camera once Home's column has its full height (the globe's size follows it).
  const camera = async () => ({ zoom: await hook.zoom(page), center: await hook.center(page) });
  let before = await camera();
  await expect
    .poll(async () => {
      const last = before;
      before = await camera();
      return JSON.stringify(before) === JSON.stringify(last);
    })
    .toBe(true);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(globeSlot(page)).toBeHidden();
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await homeLoaded();
  expect(await hook.instanceId(page)).toBe(instance);
  const canvas = page.locator('canvas.maplibregl-canvas');
  const sizeOff = async () => {
    const box = (await canvas.boundingBox())!;
    const slot = (await globeSlot(page).boundingBox())!;
    return Math.max(Math.abs(box.width - slot.width), Math.abs(box.height - slot.height));
  };
  await expect.poll(sizeOff).toBeLessThanOrEqual(1);
  // Hidden and shown again, the camera is where it was.
  await expect.poll(camera).toEqual(before);
});

test('[GLB-03, GLB-C08] the attribution is the compact ⓘ button at phone width, in full on wide screens', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await globeHooked(page);
  const attribution = page.locator('.maplibregl-ctrl-attrib');
  const text = attribution.getByText(/EOX IT Services/);
  if (!isMobile) {
    await expect(attribution).not.toHaveClass(/maplibregl-compact/);
    await expect(text).toBeVisible();
    return;
  }
  await expect(attribution).toHaveClass(/maplibregl-compact/);
  await expect(text).toBeHidden();
  await attribution.locator('.maplibregl-ctrl-attrib-button').tap();
  await expect(text).toBeVisible();
});

test('[GLB-05] without WebGL the globe says so in its area and the column still works', async ({ page }) => {
  await page.addInitScript(() => {
    const canvas = (
      globalThis as unknown as {
        HTMLCanvasElement: { prototype: { getContext(kind: string): unknown } };
      }
    ).HTMLCanvasElement.prototype;
    const getContext = canvas.getContext;
    canvas.getContext = function (this: unknown, kind: string, ...rest: unknown[]) {
      return kind.startsWith('webgl') || kind === 'experimental-webgl'
        ? null
        : getContext.call(this, kind, ...(rest as []));
    };
  });
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto('/');
  const message = globeSlot(page).getByRole('alert');
  await expect(message).toHaveText(
    "This browser can't draw the globe: WebGL is off or unsupported.",
  );
  await expect(page.getByRole('heading', { level: 1, name: 'Geography Trainer' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  expect(errors).toEqual([]);
});

const REGION_FILE = /\/data\/regions\/([^/]+)\.topo\.json$/;

test('[GLB-08] region files load only when a page needs one, and only its country’s', async ({
  page,
}) => {
  const fetched: string[] = [];
  page.on('request', (request) => {
    const match = REGION_FILE.exec(new URL(request.url()).pathname);
    if (match) fetched.push(match[1]!);
  });
  await page.goto('/');
  await globeHooked(page);
  // Home has drawn the countries: everything it needs has loaded.
  await expect.poll(() => hook.progress(page)).not.toBeNull();
  expect(fetched).toEqual([]);
  await page.goto('/progress/france');
  await expect(page.getByRole('heading', { level: 1, name: 'France' })).toBeVisible();
  await expect.poll(() => fetched).toContain('france');
  expect(new Set(fetched)).toEqual(new Set(['france']));
});

test('[GLB-13, GLB-C12] leaving a page for one that sets nothing leaves the globe bare, the camera where it was', async ({
  page,
  isMobile,
}) => {
  await page.goto('/playground?mode=globe');
  await globeReady(page);
  await expect.poll(() => hook.layerIds(page)).toContain('gt-country-borders');
  const at = await hook.project(page, [2.35, 48.85]);
  await (isMobile ? page.touchscreen.tap(at.x, at.y) : page.mouse.click(at.x, at.y));
  await expect(page.getByTestId('globe-last-tap')).not.toHaveText('none');
  await page.getByRole('switch', { name: 'Show reveal' }).check();
  await expect.poll(async () => (await hook.markers(page)).length).toBe(3);
  const camera = async () => ({ zoom: await hook.zoom(page), center: await hook.center(page) });
  const before = await camera();
  await column(page).getByRole('link', { name: 'Credits' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Credits' })).toBeVisible();
  await expect(page.locator('[data-mode]')).toHaveAttribute('data-mode', 'bare');
  await expect.poll(() => hook.layerIds(page)).toEqual([]);
  expect(await hook.markers(page)).toEqual([]);
  expect(await camera()).toEqual(before);
});

const FRANCE = { west: -5, east: 9, south: 42, north: 51.5 };

test('[GLB-21, GLB-20] a deep link frames its country once the globe opens, and Progress flies back to the world', async ({
  page,
}) => {
  await page.goto('/progress/france');
  await globeHooked(page);
  await expect
    .poll(async () => {
      const [lng, lat] = await hook.center(page);
      const inFrance =
        lng > FRANCE.west && lng < FRANCE.east && lat > FRANCE.south && lat < FRANCE.north;
      // Well past the whole sphere's zoom.
      return inFrance && (await hook.zoom(page)) > (await hook.minZoom(page)) + 1.5;
    })
    .toBe(true);
  await page.getByRole('link', { name: 'Back to the world' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible();
  // The world view: the opening centre at the zoom that fits the whole sphere.
  await expect
    .poll(async () => {
      const [lng, lat] = await hook.center(page);
      const fit = (await hook.minZoom(page)) + Math.log2(Math.cos((lat * Math.PI) / 180));
      return Math.abs(lng) < 0.01 && Math.abs(lat - 20) < 0.01 && Math.abs((await hook.zoom(page)) - fit) < 0.02;
    })
    .toBe(true);
});

/** Saba: stored as a point, so Home's globe shows it as a dot. */
const SABA: [number, number] = [-63.237, 17.633];

test('[GLB-18, GLB-C11] on Home a tap on a dot, or a fingertip from it at sea, selects it; one well clear does not', async ({
  page,
  isMobile,
}) => {
  const tapNear = async (dx: number) => {
    await page.goto('/');
    await globeHooked(page);
    await expect
      .poll(async () => (await hook.progress(page))?.dots.some((d) => d.id === 'saba') ?? false)
      .toBe(true);
    // Stops Home's flight to the world, if one is under way.
    await hook.jumpTo(page, SABA, 6);
    const { x, y } = await hook.project(page, SABA);
    await (isMobile ? page.touchscreen.tap(x + dx, y) : page.mouse.click(x + dx, y));
  };
  await tapNear(0);
  await expect(page).toHaveURL(/\/progress\/saba$/);
  // 11 px west, about 13 km out to sea: outside the dot as drawn, within the fingertip's slack.
  await tapNear(-11);
  await expect(page).toHaveURL(/\/progress\/saba$/);
  // 30 px west: clear of the dot.
  await tapNear(-30);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/$/);
});

test('[GLB-34] a failed save shows on every page with Retry, and leaving asks first until it is saved', async ({
  page,
  isMobile,
}) => {
  // Answers fail to save while the flag is up: their table's add throws.
  await page.addInitScript(() => {
    const g = globalThis as unknown as {
      __failAnswers?: boolean;
      IDBObjectStore: { prototype: { add(...args: unknown[]): unknown; name: string } };
    };
    g.__failAnswers = true;
    const store = g.IDBObjectStore.prototype;
    const add = store.add;
    store.add = function (this: { name: string }, ...args: unknown[]) {
      if (g.__failAnswers && this.name === 'answers') {
        throw new Error('Writes are failing');
      }
      return add.apply(this, args);
    };
  });
  /** Whether leaving now would make the browser ask: a beforeunload listener cancelled it. */
  const asksBeforeLeaving = () =>
    page.evaluate(() => {
      const g = globalThis as unknown as {
        dispatchEvent(e: unknown): boolean;
        Event: new (type: string, init: { cancelable: boolean }) => unknown;
      };
      return !g.dispatchEvent(new g.Event('beforeunload', { cancelable: true }));
    });
  await page.goto('/session');
  expect(await asksBeforeLeaving()).toBe(false);
  await answer(page, isMobile, await current(page));
  const banner = page.getByRole('alert').filter({ hasText: 'could not be saved' });
  await expect(banner).toBeVisible();
  expect(await asksBeforeLeaving()).toBe(true);
  await page.getByRole('link', { name: 'Quit' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Geography Trainer' })).toBeVisible();
  await expect(banner).toBeVisible();
  await page.evaluate(() => {
    (globalThis as unknown as { __failAnswers: boolean }).__failAnswers = false;
  });
  await banner.getByRole('button', { name: 'Retry' }).click();
  await expect(banner).toHaveCount(0);
  expect(await asksBeforeLeaving()).toBe(false);
});
