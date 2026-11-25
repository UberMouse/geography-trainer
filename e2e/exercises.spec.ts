import { expect, test, type Locator, type Page } from '@playwright/test';

// Each test loads the world's map data and draws globes: slow on a loaded machine.
test.describe.configure({ timeout: 90_000 });

/** Open one exercise in the playground and wait until its item is built. */
async function openExercise(page: Page, query: string) {
  await page.goto(`/playground?${query}`);
  await expect(page.getByTestId('item-id')).toBeVisible({ timeout: 30_000 });
}

const options = (page: Page) => page.getByRole('group', { name: 'Options' }).getByRole('button');
const option = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Options' }).getByRole('button', { name, exact: true });
const verdict = (page: Page) => page.getByRole('status');

/** A globe's canvas, scrolled into view, once it has drawn; and its centre. */
async function globe(page: Page, name: 'Bare globe' | 'Bordered globe') {
  const canvas = page.getByRole('img', { name, exact: true });
  await expect(canvas).toHaveAttribute('data-rotation', /.+/, { timeout: 30_000 });
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  return { canvas, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

async function tap(page: Page, isMobile: boolean, x: number, y: number) {
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

const confirm = (page: Page) => page.getByRole('button', { name: 'Confirm' });

test.describe('L1 outline → name', () => {
  test('choosing the item is correct', async ({ page }) => {
    await openExercise(page, 'item=country:france&rung=1');
    await expect(options(page)).toHaveCount(4);
    await option(page, 'France').click();
    await expect(verdict(page)).toHaveText(/^Correct/);
    await expect(option(page, 'France')).toHaveAttribute('data-mark', 'correct');
    await expect(page.getByTestId('last-correct')).toHaveText('true');
  });

  test('choosing another option is incorrect and marks the item', async ({ page }) => {
    await openExercise(page, 'item=country:france&rung=1');
    const wrong: Locator = options(page)
      .filter({ hasNotText: /^France$/ })
      .first();
    await wrong.click();
    await expect(verdict(page)).toHaveText(/^Incorrect · Again · it is France/);
    await expect(wrong).toHaveAttribute('data-mark', 'wrong');
    await expect(option(page, 'France')).toHaveAttribute('data-mark', 'correct');
    await expect(page.getByTestId('last-rating')).toHaveText('Again');
    await expect(page.getByTestId('last-km')).toHaveText('–');
  });

  test('a click after the answer changes nothing', async ({ page }) => {
    await openExercise(page, 'item=country:france&rung=1');
    await option(page, 'France').click();
    await expect(verdict(page)).toHaveText(/^Correct/);
    const wrong = options(page)
      .filter({ hasNotText: /^France$/ })
      .first();
    await wrong.click();
    await expect(verdict(page)).toHaveText(/^Correct/);
    await expect(wrong).not.toHaveAttribute('data-mark');
    await expect(page.getByTestId('last-correct')).toHaveText('true');
  });

  test('Next starts a fresh question', async ({ page }) => {
    await openExercise(page, 'item=country:france&rung=1');
    await option(page, 'France').click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByTestId('item-id')).not.toHaveText('country:france');
    await expect(verdict(page)).toHaveCount(0);
    await expect(page.locator('[data-mark]')).toHaveCount(0);
    await expect(options(page)).toHaveCount(4);
  });
});

test.describe('L3 and L4 name → tap', () => {
  test('L4: a tap on the answer point, confirmed, is correct with maptap 100', async ({
    page,
    isMobile,
  }) => {
    await openExercise(page, 'item=country:france&rung=4');
    const answer = await page.getByTestId('item-answer').textContent();
    await openExercise(page, `item=country:france&rung=4&view=${answer},4`);
    const { cx, cy } = await globe(page, 'Bare globe');
    await expect(confirm(page)).toBeDisabled();
    await tap(page, isMobile, cx, cy);
    await expect(confirm(page)).toBeEnabled();
    await confirm(page).click();
    await expect(verdict(page)).toHaveText(/^Correct/);
    await expect(page.getByTestId('reveal-km')).toHaveText('0.0 km');
    await expect(page.getByTestId('reveal-score')).toHaveText('100');
    await expect(page.getByTestId('last-score')).toHaveText('100');
  });

  test('L3: a tap far from the country, confirmed, is incorrect', async ({ page, isMobile }) => {
    await openExercise(page, 'item=country:france&rung=3&view=-150,-40,1');
    const { cx, cy } = await globe(page, 'Bordered globe');
    await tap(page, isMobile, cx, cy);
    await confirm(page).click();
    await expect(verdict(page)).toHaveText(/^Incorrect · Again/);
    await expect(page.getByTestId('last-correct')).toHaveText('false');
    const score = Number(await page.getByTestId('reveal-score').textContent());
    expect(score).toBeLessThan(50);
  });

  test('a tap after the answer changes nothing', async ({ page, isMobile }) => {
    await openExercise(page, 'item=country:france&rung=3&view=-150,-40,1');
    const { cx, cy } = await globe(page, 'Bordered globe');
    await tap(page, isMobile, cx, cy);
    await confirm(page).click();
    await expect(verdict(page)).toHaveText(/^Incorrect/);
    const km = await page.getByTestId('last-km').textContent();
    // The reveal turns the globe, so a tap now lands somewhere else: still ignored.
    await tap(page, isMobile, cx + 20, cy + 20);
    await expect(confirm(page)).toBeDisabled();
    await expect(page.getByTestId('last-km')).toHaveText(km!);
    await expect(verdict(page)).toHaveText(/^Incorrect/);
  });

  test('Next starts a fresh question with no pin', async ({ page, isMobile }) => {
    await openExercise(page, 'item=country:france&rung=4&view=-150,-40,1');
    const { cx, cy } = await globe(page, 'Bare globe');
    await tap(page, isMobile, cx, cy);
    await confirm(page).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByTestId('item-id')).not.toHaveText('country:france');
    await expect(verdict(page)).toHaveCount(0);
    await expect(confirm(page)).toBeDisabled();
  });
});

test.describe('phone width', () => {
  for (const rung of [1, 2, 3, 4]) {
    for (const item of ['country:france', 'region:france.bretagne', 'place:honolulu_hawaii']) {
      test(`L${rung} ${item} has no horizontal scroll`, async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        await openExercise(page, `item=${item}&rung=${rung}`);
        await expect(page.locator('.exercise-map > *')).toBeVisible();
        const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
        expect(fits).toBe(true);
      });
    }
  }
});
