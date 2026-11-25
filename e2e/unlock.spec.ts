import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { answer, current, next, question, summary, WAIT } from './sessionHelpers';

// Sessions load the world's map data and draw maps: slow on a loaded machine.
test.describe.configure({ timeout: 240_000 });

const DAY = 24 * 60 * 60 * 1000;

/** A progress file in which `country:united-states` is mastered (L4 passed on two different days). */
async function writeMasteredUnitedStates(path: string) {
  const now = Date.now();
  const card = {
    due: now + 30 * DAY,
    stability: 30,
    difficulty: 5,
    scheduled_days: 30,
    learning_steps: 0,
    reps: 4,
    lapses: 0,
    state: 2,
    last_review: now - 5 * DAY,
  };
  const progress = {
    itemId: 'country:united-states',
    rung: 4,
    highestRung: 4,
    cards: { 4: card },
    l4PassDays: ['2026-01-10', '2026-01-20'],
    inL4Lapse: false,
    introducedAt: now - 60 * DAY,
  };
  const file = {
    format: 'geography-trainer-progress',
    version: 1,
    exportedAt: new Date(now).toISOString(),
    progress: [progress],
    answers: [],
  };
  await writeFile(path, JSON.stringify(file));
}

async function importMastered(page: Page, path: string) {
  await page.goto('/');
  await expect(page.getByTestId('today-new')).toBeVisible(WAIT);
  await page.getByLabel('Import progress').setInputFiles(path);
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByRole('status')).toHaveText('Progress imported.', WAIT);
}

test('mastering a country unlocks its regions in the next session', async ({ page, isMobile }, testInfo) => {
  const file = testInfo.outputPath('mastered-us.json');
  await writeMasteredUnitedStates(file);
  await importMastered(page, file);

  await page.getByRole('link', { name: /^Start/ }).click();
  let region: Awaited<ReturnType<typeof current>> | null = null;
  for (let i = 0; i < 20 && !(await summary(page).isVisible()); i++) {
    const q = await current(page);
    if (q.itemId.startsWith('region:united-states.')) {
      region = q;
      break;
    }
    await answer(page, isMobile, q);
    await next(page);
    await expect(question(page).or(summary(page))).toBeVisible(WAIT);
  }
  expect(region, 'a United States region question within the first round').not.toBeNull();

  // The region's map is drawn from the country's region topology.
  await expect(page.locator('[data-testid="session-question"] svg').first()).toBeVisible(WAIT);
  await answer(page, isMobile, region!);
  await next(page);
  await expect(question(page).or(summary(page))).toBeVisible(WAIT);
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);
});

test('the Progress page shows the mastered country and its map shape', async ({ page }, testInfo) => {
  const file = testInfo.outputPath('mastered-us.json');
  await writeMasteredUnitedStates(file);
  await importMastered(page, file);

  await page.getByRole('link', { name: 'See your progress' }).click();
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible(WAIT);
  await expect(page.getByTestId('tier-country')).toContainText('1 learned', WAIT);

  const started = page.getByTestId('started-countries');
  await expect(started.getByRole('link', { name: 'United States' })).toBeVisible(WAIT);
  await expect(started).toContainText('United States: Mastered');

  const map = page.getByTestId('progress-map');
  await expect(map.locator('[data-item-id="united-states"]')).toHaveAttribute(
    'data-state',
    'mastered',
    WAIT,
  );
  // Germany is a country: new, as it has no parent to lock it.
  await expect(map.locator('[data-item-id="germany"]')).toHaveAttribute('data-state', 'new');

  await recordNavigations(page);
  await started.getByRole('link', { name: 'United States' }).click();
  expect(await navigations(page)).toContain('/progress/united-states');
});

// The drill-down pages are a later step, so their URLs fall through to Home: watch the history
// pushes rather than the final URL.
const recordNavigations = (page: Page) =>
  page.evaluate(
    `window.__navs = []; const push = history.pushState.bind(history);
     history.pushState = (s, t, url) => { window.__navs.push(String(url)); push(s, t, url); };`,
  );
const navigations = (page: Page) => page.evaluate<string[]>('window.__navs');

test('tapping a country on the map goes to its page', async ({ page }) => {
  await page.goto('/progress');
  const shape = page.getByTestId('progress-map').locator('[data-item-id="germany"]');
  await expect(shape).toBeAttached(WAIT);
  await recordNavigations(page);
  await shape.dispatchEvent('click');
  expect(await navigations(page)).toContain('/progress/germany');
});

test('Home shows the small progress map and a link to Progress', async ({ page }) => {
  await page.goto('/');
  const map = page.getByTestId('progress-map');
  await expect(map).toBeVisible(WAIT);
  await expect(map).toHaveAttribute('aria-hidden', 'true');
  await page.getByRole('link', { name: 'See your progress' }).click();
  await expect(page).toHaveURL(/\/progress$/);
});

test('Home and Progress do not scroll sideways', async ({ page }) => {
  for (const path of ['/', '/progress']) {
    await page.goto(path);
    await expect(page.getByTestId('progress-map')).toBeVisible(WAIT);
    const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits, `${path} has no horizontal scroll`).toBe(true);
  }
});
