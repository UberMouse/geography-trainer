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
