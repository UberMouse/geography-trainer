import { hook } from './globeHook';
import { writeMasteredTexas } from './placementHelpers';
import { answer, current, importProgress, next, question, tapGlobe, WAIT } from './sessionHelpers';
import { expect, test, type Page } from './test';

// Placement loads the world's map data and draws up to 20 globes: slow on a loaded machine.
test.describe.configure({ timeout: 240_000 });

const TEST_ID = 'placement-question';
const done = (page: Page) => page.getByRole('heading', { name: 'Placement done' });

/** Answers the current placement question and waits for the reveal. */
async function answerCurrent(page: Page, isMobile: boolean) {
  const q = await current(page, TEST_ID);
  expect(q.rung).toBe(3);
  await answer(page, isMobile, q);
}

async function noHorizontalScroll(page: Page) {
  const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
}

test('[PLC-01, PLC-03, PLC-18, PLC-20] from a fresh profile, Home offers the placement test and the test ends in a result', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /^Start/ })).toBeVisible(WAIT);
  await page.getByRole('link', { name: 'Take the placement test' }).click();
  await expect(page).toHaveURL(/\/placement$/);

  await expect(question(page, TEST_ID)).toBeVisible(WAIT);
  await expect(page.getByText('Placement: question 1 of up to 20')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Quit' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('button', { name: 'Finish now' })).toHaveCount(0);
  // Every placement question is an L3 tap on the bare globe.
  await expect(page.locator('[data-mode]')).toHaveAttribute('data-mode', 'bare');
  if (isMobile) await noHorizontalScroll(page);

  for (let i = 0; i < 20 && !(await done(page).isVisible()); i++) {
    await answerCurrent(page, isMobile);
    if (i === 0) await expect(page.getByRole('button', { name: 'Finish now' })).toBeVisible();
    await next(page);
    await expect(question(page, TEST_ID).or(done(page))).toBeVisible(WAIT);
  }
  await expect(done(page)).toBeVisible(WAIT);
  await expect(page.getByText(/^(Your level: \d of 8\.|No level placed yet)/)).toBeVisible();
  if (isMobile) await noHorizontalScroll(page);
  await expect(page.getByRole('link', { name: 'Back to Home' })).toBeVisible();

  await page.getByRole('link', { name: 'Start studying' }).click(WAIT);
  await expect(page).toHaveURL(/\/session$/);
  await expect(question(page)).toBeVisible(WAIT);
});

test('[PLC-18, PLC-20] Finish now ends the test after one answer, at 390 px without horizontal scroll', async ({
  page,
  isMobile,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/placement');
  await answerCurrent(page, isMobile);
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Finish now' }).click();
  await expect(done(page)).toBeVisible(WAIT);
  await expect(page.getByRole('link', { name: 'Start studying' })).toBeVisible(WAIT);
  await noHorizontalScroll(page);
});

test('[PLC-23] a test-out page for an item that is not mastered is not available', async ({ page, isMobile }) => {
  await page.goto('/placement/germany');
  await expect(page.getByText('This test is not available.')).toBeVisible(WAIT);
  await expect(page.getByRole('link', { name: 'Back to the country' })).toHaveAttribute(
    'href',
    '/progress/germany',
  );
  await expect(question(page, TEST_ID)).toHaveCount(0);
  if (isMobile) await noHorizontalScroll(page);
});

test('[PLC-22, PLC-19] Markers: Finish now hides the Home offer; Quit keeps it', async ({ page, isMobile }) => {
  const offer = page.getByRole('link', { name: 'Take the placement test' });
  await page.goto('/');
  await expect(offer).toBeVisible(WAIT);

  await offer.click();
  await answerCurrent(page, isMobile);
  await page.getByRole('link', { name: 'Quit' }).click();
  await expect(page.getByRole('link', { name: /^Start/ })).toBeVisible(WAIT);
  await expect(offer).toBeVisible();

  await offer.click();
  await answerCurrent(page, isMobile);
  await page.getByRole('button', { name: 'Finish now' }).click();
  await expect(done(page)).toBeVisible(WAIT);
  await expect(page.getByRole('link', { name: 'Back to Home' })).toBeVisible(WAIT);
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page.getByRole('link', { name: /^Start/ })).toBeVisible(WAIT);
  await expect(offer).toHaveCount(0);
});

test('[PLC-19] Quit in the middle of a question leaves Home with no pin, and taps there drop none', async ({
  page,
  isMobile,
}) => {
  await page.goto('/placement');
  const q = await current(page, TEST_ID);
  await tapGlobe(page, isMobile, q.answer);
  await expect.poll(() => hook.markers(page)).toEqual([expect.objectContaining({ kind: 'pin' })]);
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeEnabled();

  await page.getByRole('link', { name: 'Quit' }).click();
  await expect(page.getByRole('link', { name: /^Start/ })).toBeVisible(WAIT);
  await expect.poll(() => hook.markers(page)).toEqual([]);
  expect((await hook.layerIds(page)).filter((id) => id.startsWith('gt-reveal'))).toEqual([]);
  // The question's tap handler went with it.
  await tapGlobe(page, isMobile, q.answer);
  await page.waitForTimeout(500);
  expect((await hook.markers(page)).filter((m) => m.kind === 'pin')).toEqual([]);
});

test("[PLC-02, PLC-06, PLC-18, PLC-20, PLC-22] a test-out of Texas's places: a close miss is noted, focus follows, and the finished test hides its link", async ({
  page,
  isMobile,
}, testInfo) => {
  const file = testInfo.outputPath('mastered-texas.json');
  await writeMasteredTexas(file);
  await importProgress(page, file);

  const drill = '/progress/united-states/united-states.texas';
  const link = page.getByRole('link', { name: "Test out of Texas's places" });
  await page.goto(drill);
  await link.click(WAIT);
  await expect(page).toHaveURL(/\/placement\/united-states\/united-states\.texas$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Test out of Texas's places", WAIT);

  // One degree of latitude north of the place: about 111 km, a miss within the 200 km close distance.
  const first = await current(page, TEST_ID);
  expect(first.itemId).toMatch(/^place:/);
  await tapGlobe(page, isMobile, [first.answer[0], first.answer[1] + 1]);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('placement-close')).toBeVisible(WAIT);
  await next(page);

  const second = await current(page, TEST_ID);
  await expect(question(page, TEST_ID)).toBeFocused();
  await answer(page, isMobile, second);
  await expect(page.getByTestId('placement-close')).toHaveCount(0);

  await page.getByRole('button', { name: 'Finish now' }).click();
  await expect(done(page)).toBeVisible(WAIT);
  await expect(done(page)).toBeFocused();
  await expect(page.getByText(/^1 place you got right /)).toBeVisible();
  await expect(page.getByText(/^1 place you were close on /)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start studying' })).toBeVisible(WAIT);
  if (isMobile) await noHorizontalScroll(page);

  await page.goto(drill);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Texas', WAIT);
  await expect(page.getByTestId('drill-list').locator('li').first()).toBeVisible(WAIT);
  await expect(page.getByRole('link', { name: /Test out of/ })).toHaveCount(0);
});
