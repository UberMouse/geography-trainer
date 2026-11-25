import { expect, test, type Page } from '@playwright/test';

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
