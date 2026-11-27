import { writeFile } from 'node:fs/promises';
import { appBar, expect, test, type Page } from './test';
import {
  answer,
  current,
  importProgress,
  next,
  question,
  summary,
  WAIT,
  writeMasteredUnitedStates,
  writeUnitedStatesOnePassFromMastery,
} from './sessionHelpers';

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

test('[SCR-01, SCR-03] a fresh Home shows empty numbers and Start', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Geography Trainer' })).toBeVisible();
  await expect(newToday(page)).toHaveText('0 of 15 new today', WAIT);
  await expect(learning(page)).toHaveText('0');
  await expect(page.getByRole('link', { name: /^Start/ })).toHaveAttribute('href', '/session');
});

test('[SCR-01] a session round shows up in Home after a reload', async ({ page, isMobile }) => {
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

test('[SCR-20, SCR-21] exported progress imports into a fresh browser', async ({ page, browser, isMobile }) => {
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
    await appBar(fresh).getByRole('link', { name: 'Geography Trainer' }).click();
    await expect(newToday(fresh)).toHaveText(before.newToday, WAIT);
    expect(await numbers(fresh)).toEqual(before);
  } finally {
    await context.close();
  }
});

test('[SCR-21] a file that is not JSON shows an alert and changes nothing', async ({ page }, testInfo) => {
  await page.goto('/');
  const before = await numbers(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  const bad = testInfo.outputPath('bad.json');
  await writeFile(bad, 'this is not json');
  await page.getByLabel('Import progress').setInputFiles(bad);
  await expect(page.getByRole('alert')).toContainText('not valid JSON');
  await expect(page.getByRole('button', { name: 'Replace' })).toHaveCount(0);
  await appBar(page).getByRole('link', { name: 'Geography Trainer' }).click();
  expect(await numbers(page)).toEqual(before);
});

test('[SCR-05, SCR-07, SCR-08, SCR-C03] a fresh Home offers the placement test, shows its legend and links on', async ({
  page,
}) => {
  await page.goto('/');
  const offer = page.getByRole('link', { name: 'Take the placement test' });
  await expect(offer).toHaveAttribute('href', '/placement', WAIT);
  await expect(page.getByText(/12–20 questions/)).toBeVisible();

  // Home's world has no locked countries: new, learning, mastered, and the complete colour.
  const legend = page.getByRole('list', { name: 'Legend' }).getByRole('listitem');
  await expect(legend).toHaveCount(4);
  await expect(legend.first()).toHaveText('New');
  await expect(legend.filter({ hasText: 'Locked' })).toHaveCount(0);

  const bar = appBar(page);
  await expect(bar.getByRole('link', { name: 'Progress' })).toHaveAttribute('href', '/progress');
  await expect(bar.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  await expect(bar.getByRole('link', { name: 'Geography Trainer' })).toHaveAttribute('aria-current', 'page');
  // Home's own column has no second link to either.
  await expect(page.getByRole('main').getByRole('link', { name: /Progress|Settings/ })).toHaveCount(0);
});

test('[SCR-03, SCR-05] once the only question is answered, Home has nothing to study', async ({
  page,
  isMobile,
}, testInfo) => {
  const file = testInfo.outputPath('one-question.json');
  await writeUnitedStatesOnePassFromMastery(file);
  await importProgress(page, file);
  await expect(page.getByRole('link', { name: 'Start (1 to study)' })).toBeVisible(WAIT);
  // Items studied in a session: the placement offer is gone.
  await expect(page.getByRole('link', { name: 'Take the placement test' })).toHaveCount(0);

  await page.getByRole('link', { name: /^Start/ }).click();
  await answer(page, isMobile, await current(page));
  await next(page);
  await expect(summary(page)).toBeVisible(WAIT);
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);

  await page.goto('/');
  await expect(page.getByText('There is nothing to study right now.')).toBeVisible(WAIT);
  await expect(page.getByRole('link', { name: /^Start/ })).toHaveCount(0);
});

const DAY = 24 * 60 * 60 * 1000;

test("[SCR-04] Home's numbers follow the clock when the tab gains focus", async ({ page }, testInfo) => {
  // The United States mastered, its review due in 30 days.
  const file = testInfo.outputPath('mastered-us.json');
  await writeMasteredUnitedStates(file);
  await importProgress(page, file);
  const due = page.getByTestId('today-due');
  await expect(due).toHaveText('0');

  await page.clock.setFixedTime(Date.now() + 31 * DAY);
  // The e2e specs have no DOM types, so no `window`.
  await page.evaluate(() =>
    (globalThis as unknown as { dispatchEvent(e: Event): boolean }).dispatchEvent(new Event('focus')),
  );
  await expect(due).toHaveText('1', WAIT);
});

test("[SCR-04, SCR-C03] Home's numbers refresh within a minute", async ({ page }, testInfo) => {
  const file = testInfo.outputPath('mastered-us.json');
  await writeMasteredUnitedStates(file);
  await page.clock.install();
  await importProgress(page, file);
  const due = page.getByTestId('today-due');
  await expect(due).toHaveText('0');

  // Paused, then a month on: the page's clock moves, but no timer has fired yet.
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1_000);
  await page.clock.setSystemTime(now + 31 * DAY);
  await expect(due).toHaveText('0');
  await page.clock.runFor(60_000);
  await expect(due).toHaveText('1', WAIT);
});

test('[SCR-25, SCR-C11] a Home that fails to load offers Retry', async ({ page }) => {
  let fail = true;
  await page.route('**/data/countries.topo.json', (route) =>
    fail ? route.fulfill({ status: 500, body: '' }) : route.continue(),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('HTTP 500', WAIT);
  fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(newToday(page)).toHaveText('0 of 15 new today', WAIT);
});

test('[SCR-26] Home does not scroll horizontally on a phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone width only');
  await page.goto('/');
  await numbers(page);
  const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
});
