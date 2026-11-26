import { expect, test, type Page } from './test';
import { answer, current, next, question, WAIT } from './sessionHelpers';

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

test('from a fresh profile, Home offers the placement test and the test ends in a result', async ({
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

test('Finish now ends the test after one answer, at 390 px without horizontal scroll', async ({
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

test('a test-out page for an item that is not mastered is not available', async ({ page, isMobile }) => {
  await page.goto('/placement/germany');
  await expect(page.getByText('This test is not available.')).toBeVisible(WAIT);
  await expect(page.getByRole('link', { name: 'Back to the country' })).toHaveAttribute(
    'href',
    '/progress/germany',
  );
  await expect(question(page, TEST_ID)).toHaveCount(0);
  if (isMobile) await noHorizontalScroll(page);
});

test('Markers: Finish now hides the Home offer; Quit keeps it', async ({ page, isMobile }) => {
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
