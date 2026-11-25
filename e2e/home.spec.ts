import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { answer, current, next, question, summary, WAIT } from './sessionHelpers';

// Sessions load the world's map data and draw globes: slow on a loaded machine.
test.describe.configure({ timeout: 240_000 });

const newToday = (page: Page) => page.getByTestId('today-new');
const learning = (page: Page) => page.getByTestId('today-learning');

async function numbers(page: Page) {
  await expect(newToday(page)).toBeVisible(WAIT);
  return {
    due: await page.getByTestId('today-due').innerText(),
    newToday: await newToday(page).innerText(),
    learning: await learning(page).innerText(),
    learned: await page.getByTestId('today-learned').innerText(),
  };
}

/** Answers `count` questions of a session, or up to the round summary, then waits for the saves. */
async function answerQuestions(page: Page, isMobile: boolean, count: number) {
  const ids = new Set<string>();
  await page.goto('/session');
  for (let i = 0; i < count && !(await summary(page).isVisible()); i++) {
    const q = await current(page);
    ids.add(q.itemId);
    await answer(page, isMobile, q);
    await next(page);
    await expect(question(page).or(summary(page))).toBeVisible(WAIT);
  }
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);
  return ids;
}

test('a fresh Home shows empty numbers and Start', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Geography Trainer' })).toBeVisible();
  await expect(newToday(page)).toHaveText('0 of 15 new today', WAIT);
  await expect(learning(page)).toHaveText('0');
  await expect(page.getByRole('link', { name: /^Start/ })).toHaveAttribute('href', '/session');
});

test('a session round shows up in Home after a reload', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(newToday(page)).toHaveText('0 of 15 new today', WAIT);
  await expect(learning(page)).toHaveText('0');

  const ids = await answerQuestions(page, isMobile, 25);
  await expect(summary(page)).toHaveText(/ of 20 right$/);
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await page.reload();

  await expect(newToday(page)).toHaveText(`${ids.size} of 15 new today`, WAIT);
  expect(Number(await learning(page).innerText())).toBeGreaterThan(0);
});

test('exported progress imports into a fresh browser', async ({ page, browser, isMobile }) => {
  await answerQuestions(page, isMobile, 3);
  await page.goto('/');
  const before = await numbers(page);
  expect(before.newToday).not.toBe('0 of 15 new today');

  await page.getByRole('link', { name: 'Settings' }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export progress' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^geography-trainer-progress-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();

  const context = await browser.newContext(test.info().project.use);
  try {
    const fresh = await context.newPage();
    await fresh.goto('/');
    expect((await numbers(fresh)).newToday).toBe('0 of 15 new today');
    await fresh.getByRole('link', { name: 'Settings' }).click();
    await fresh.getByLabel('Import progress').setInputFiles(path);
    await expect(fresh.getByText(/^This browser: nothing started\. File: \d+ countries started, exported /)).toBeVisible();
    await fresh.getByRole('button', { name: 'Replace' }).click();
    await expect(fresh.getByRole('status')).toHaveText('Progress imported.', WAIT);
    await expect(fresh.getByRole('status')).toBeFocused();
    await fresh.getByRole('link', { name: 'Back to Home' }).click();
    await expect(newToday(fresh)).toHaveText(before.newToday, WAIT);
    expect(await numbers(fresh)).toEqual(before);
  } finally {
    await context.close();
  }
});

test('a file that is not JSON shows an alert and changes nothing', async ({ page }, testInfo) => {
  await page.goto('/');
  const before = await numbers(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  const bad = testInfo.outputPath('bad.json');
  await writeFile(bad, 'this is not json');
  await page.getByLabel('Import progress').setInputFiles(bad);
  await expect(page.getByRole('alert')).toContainText('not valid JSON');
  await expect(page.getByRole('button', { name: 'Replace' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to Home' }).click();
  expect(await numbers(page)).toEqual(before);
});

test('Home does not scroll horizontally on a phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone width only');
  await page.goto('/');
  await numbers(page);
  const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
});
