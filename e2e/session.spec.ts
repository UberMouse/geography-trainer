import { expect, test } from './test';
import { answer, current, next, question, summary, WAIT } from './sessionHelpers';

// A session loads the world's map data and draws globes: slow on a loaded machine.
test.describe.configure({ timeout: 240_000 });

test('a correct L1 answer brings the same item back at L2 within the next 4 questions', async ({
  page,
  isMobile,
}) => {
  await page.goto('/session');
  const first = await current(page);
  expect(first.rung).toBe(1);
  await answer(page, isMobile, first);
  await next(page);
  let seenAtL2 = false;
  for (let i = 0; i < 4 && !seenAtL2; i++) {
    const q = await current(page);
    seenAtL2 = q.itemId === first.itemId && q.rung === 2;
    if (!seenAtL2) {
      await answer(page, isMobile, q);
      await next(page);
    }
  }
  expect(seenAtL2).toBe(true);
});

test('a round ends in a summary, and progress survives a reload', async ({ page, isMobile }) => {
  await page.goto('/session');
  const first = await current(page);
  for (let i = 0; i < 25 && !(await summary(page).isVisible()); i++) {
    const q = await current(page);
    await answer(page, isMobile, q);
    await next(page);
    await expect(question(page).or(summary(page))).toBeVisible(WAIT);
  }
  await expect(summary(page)).toHaveText(/ of 20 right$/);
  // Every answer is written to IndexedDB before the reload.
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);
  await expect(page.getByRole('button', { name: 'Keep going' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Home' })).toBeVisible();

  await page.reload();
  const again = await current(page);
  expect(again.rung === 1 && again.itemId === first.itemId).toBe(false);
});

test('a session question does not scroll horizontally', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone width only');
  await page.goto('/session');
  await current(page);
  const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
});
