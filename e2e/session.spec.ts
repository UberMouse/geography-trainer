import { expect, test, type Page } from '@playwright/test';

// A session loads the world's map data and draws globes: slow on a loaded machine.
test.describe.configure({ timeout: 240_000 });

const WAIT = { timeout: 30_000 };

const question = (page: Page) => page.getByTestId('session-question');
const summary = (page: Page) => page.getByRole('heading', { name: /^Round done:/ });

async function tap(page: Page, isMobile: boolean, x: number, y: number) {
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** What the current question is, once it has rendered. */
async function current(page: Page) {
  await expect(question(page)).toBeVisible(WAIT);
  return {
    itemId: (await question(page).getAttribute('data-item-id'))!,
    name: (await question(page).getAttribute('data-item-name'))!,
    rung: Number(await question(page).getAttribute('data-rung')),
  };
}

/**
 * Answers the current question: the named option for a choice question (L1, L2), the globe's centre
 * plus Confirm for a tap (L3, L4); then waits for the reveal.
 */
async function answer(page: Page, isMobile: boolean, q: { name: string; rung: number }) {
  if (q.rung <= 2) {
    await page
      .getByRole('group', { name: 'Options' })
      .getByRole('button', { name: q.name, exact: true })
      .click();
  } else {
    const canvas = page.getByRole('img', {
      name: q.rung === 3 ? 'Bordered globe' : 'Bare globe',
      exact: true,
    });
    await expect(canvas).toHaveAttribute('data-rotation', /.+/, WAIT);
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await tap(page, isMobile, box.x + box.width / 2, box.y + box.height / 2);
    await page.getByRole('button', { name: 'Confirm' }).click();
  }
  await expect(page.getByRole('status')).toContainText(/Correct|Incorrect/);
}

const next = (page: Page) => page.getByRole('button', { name: 'Next' }).click();

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
  while (!(await summary(page).isVisible())) {
    const q = await current(page);
    await answer(page, isMobile, q);
    await next(page);
    await expect(question(page).or(summary(page))).toBeVisible(WAIT);
  }
  await expect(summary(page)).toHaveText(/ of 20 right$/);
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
