import { globeHooked, hook, viewport } from './globeHook';
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

test('client-side links between pages keep the same globe', async ({ page }) => {
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
  test(`${path}: the column sits beside the globe, or below it at phone width, and nothing scrolls sideways`, async ({
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

test('the globe hidden on Settings at phone width is the same map, resized when it shows again', async ({
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

test('the attribution is the compact ⓘ button at phone width, in full on wide screens', async ({
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

test('without WebGL the globe says so in its area and the column still works', async ({ page }) => {
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
