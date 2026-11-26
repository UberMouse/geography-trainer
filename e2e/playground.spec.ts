import { expect, test, type Locator, type Page } from './test';

/** The bare globe's canvas, scrolled into view, once it has drawn (its view attributes are set). */
async function bareGlobe(page: Page, query = '') {
  await page.goto(`/playground${query}`);
  const canvas = page.getByRole('img', { name: 'Bare globe', exact: true });
  await expect(canvas).toHaveAttribute('data-rotation', /.+/, { timeout: 30_000 });
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  return { canvas, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

const scrollTop = (page: Page) => page.locator('html').evaluate((el) => el.scrollTop);

const zoomOf = async (canvas: Locator) => Number(await canvas.getAttribute('data-zoom'));

/** Touch through CDP, so two fingers can move at once (Playwright's touchscreen only taps). */
async function touchSession(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return (type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number][]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], id) => ({ x, y, id })),
    });
}

test('dragging the bare globe rotates it', async ({ page, isMobile }) => {
  const { canvas, cx, cy } = await bareGlobe(page);
  const before = await canvas.getAttribute('data-rotation');
  const scrollBefore = await scrollTop(page);
  if (isMobile) {
    const touch = await touchSession(page);
    await touch('touchStart', [[cx, cy]]);
    for (let i = 1; i <= 5; i++) await touch('touchMove', [[cx + 8 * i, cy + 4 * i]]);
    await touch('touchEnd', []);
  } else {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 30, { steps: 5 });
    await page.mouse.up();
  }
  await expect(canvas).not.toHaveAttribute('data-rotation', before!);
  // The drag moved the globe, not the page, and was not a tap.
  expect(await scrollTop(page)).toBe(scrollBefore);
  await expect(page.getByTestId('last-pin')).toHaveText('none');
});

test('wheel zooms the bare globe in', async ({ page, isMobile }) => {
  test.skip(isMobile, 'no wheel on a phone; the pinch test covers zoom there');
  const { canvas, cx, cy } = await bareGlobe(page);
  const before = await zoomOf(canvas);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -300);
  await expect.poll(() => zoomOf(canvas)).toBeGreaterThan(before);
});

test('a two-finger pinch zooms the bare globe in', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch only');
  const { canvas, cx, cy } = await bareGlobe(page);
  const before = await zoomOf(canvas);
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
  await expect.poll(() => zoomOf(canvas)).toBeGreaterThan(before);
  await expect(page.getByTestId('last-pin')).toHaveText('none');
});

test('tapping the centre of the bare globe pins the view centre', async ({ page, isMobile }) => {
  const { canvas, cx, cy } = await bareGlobe(page, '?view=10,30,2');
  await expect(canvas).toHaveAttribute('data-rotation', '10.00,30.00');
  await expect(canvas).toHaveAttribute('data-zoom', '2.000');
  if (isMobile) await page.touchscreen.tap(cx, cy);
  else await page.mouse.click(cx, cy);
  const pin = page.getByTestId('last-pin');
  await expect(pin).not.toHaveText('none');
  const [lng, lat] = (await pin.textContent())!.split(',').map(Number);
  expect(Math.abs(lng! - 10)).toBeLessThan(1);
  expect(Math.abs(lat! - 30)).toBeLessThan(1);
});

test('the playground has no horizontal scroll at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await bareGlobe(page);
  const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
});

test('a failed load shows an error whose Retry loads again', async ({ page }) => {
  let fail = true;
  await page.route('**/data/countries.topo.json', (route) =>
    fail ? route.fulfill({ status: 500, body: '' }) : route.continue(),
  );
  await page.goto('/playground');
  await expect(page.getByRole('alert')).toContainText('HTTP 500');
  fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('combobox', { name: 'Country' })).toBeVisible({ timeout: 30_000 });
});

test('a tap on a country without regions keeps the tap map zoom', async ({ page, isMobile }) => {
  test.skip(isMobile, 'wheel zoom needs a mouse');
  await page.goto('/playground');
  await page.getByRole('combobox', { name: 'Country' }).selectOption({ label: 'Japan' });
  const map = page.getByRole('img', { name: 'Tap map', exact: true });
  await map.scrollIntoViewIfNeeded();
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect(map).not.toHaveAttribute('data-zoom', '1.000');
  const zoomed = await map.getAttribute('data-zoom');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('last-pin')).not.toHaveText('none');
  await expect(map).toHaveAttribute('data-zoom', zoomed!);
});
