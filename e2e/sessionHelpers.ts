import { writeFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

// Shared by the Session and Home specs: answering questions the way a learner would.

export const WAIT = { timeout: 30_000 };

export const question = (page: Page, testId = 'session-question') => page.getByTestId(testId);
export const summary = (page: Page) => page.getByRole('heading', { name: /^Round done:/ });

export async function tap(page: Page, isMobile: boolean, x: number, y: number) {
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

/** What the current question is, once it has rendered. */
export async function current(page: Page, testId = 'session-question') {
  await expect(question(page, testId)).toBeVisible(WAIT);
  return {
    itemId: (await question(page, testId).getAttribute('data-item-id'))!,
    name: (await question(page, testId).getAttribute('data-item-name'))!,
    rung: Number(await question(page, testId).getAttribute('data-rung')),
  };
}

/**
 * Answers the current question: the named option for a choice question (L1, L2), the globe's centre
 * plus Confirm for a tap (L3, L4); then waits for the reveal.
 */
export async function answer(page: Page, isMobile: boolean, q: { name: string; rung: number }) {
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

export const next = (page: Page) => page.getByRole('button', { name: 'Next' }).click();

const DAY = 24 * 60 * 60 * 1000;

/** A progress file in which `country:united-states` is mastered (L4 passed on two different days). */
export async function writeMasteredUnitedStates(path: string) {
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
