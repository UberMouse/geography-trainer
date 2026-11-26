import { writeFile } from 'node:fs/promises';
import { MC_FAST_MS } from '../src/engine/config';
import { globeHooked, hook, type LngLat } from './globeHook';
import { expect, type Page } from './test';

// Shared by the Session and Home specs: answering questions the way a learner would.

export const WAIT = { timeout: 30_000 };

export const question = (page: Page, testId = 'session-question') => page.getByTestId(testId);
export const summary = (page: Page) => page.getByRole('heading', { name: /^Round done:/ });

export async function tap(page: Page, isMobile: boolean, x: number, y: number) {
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

export interface Question {
  itemId: string;
  name: string;
  rung: number;
  /** The target's answer point (a place's point), from the dev build's `data-answer`. */
  answer: LngLat;
}

/** What the current question is, once it has rendered. */
export async function current(page: Page, testId = 'session-question'): Promise<Question> {
  const el = question(page, testId);
  await expect(el).toBeVisible(WAIT);
  const [lng, lat] = (await el.getAttribute('data-answer'))!.split(',').map(Number);
  return {
    itemId: (await el.getAttribute('data-item-id'))!,
    name: (await el.getAttribute('data-item-name'))!,
    rung: Number(await el.getAttribute('data-rung')),
    answer: [lng!, lat!],
  };
}

/** The zoom a tap is aimed at: about a km a pixel, so a tap lands inside a small target. */
const AIM_ZOOM = 6;

/**
 * Taps `at` on the app's globe, aimed with the test hook: the camera first jumps there (stopping
 * any flight), so the point faces the viewer, then the tap lands where the hook projects it.
 */
export async function tapGlobe(page: Page, isMobile: boolean, at: LngLat) {
  await globeHooked(page);
  await hook.jumpTo(page, at, AIM_ZOOM);
  const { x, y } = await hook.project(page, at);
  await tap(page, isMobile, x, y);
}

/** The point opposite `at` on the Earth: as far off as a tap can be. */
export const antipode = ([lng, lat]: LngLat): LngLat => [lng > 0 ? lng - 180 : lng + 180, -lat];

/**
 * Answers the current question correctly: the named option for the choice question (L1), a tap
 * on the answer point plus Confirm (L2, L3), or with `miss` a tap at its antipode. Then waits for
 * the reveal. With `slow`, an L1 answer waits out MC_FAST_MS first, so it is Good and climbs one
 * rung (a faster one is Easy and skips to L3).
 */
export async function answer(page: Page, isMobile: boolean, q: Question, { miss = false, slow = false } = {}) {
  if (q.rung === 1) {
    // A learner thinking it over: deliberate time, not a wait for the app.
    if (slow) await page.waitForTimeout(MC_FAST_MS + 250);
    await page
      .getByRole('group', { name: 'Options' })
      .getByRole('button', { name: q.name, exact: true })
      .click();
  } else {
    await tapGlobe(page, isMobile, miss ? antipode(q.answer) : q.answer);
    await page.getByRole('button', { name: 'Confirm' }).click();
  }
  await expect(page.getByRole('status')).toContainText(/Correct|Incorrect/);
}

export const next = (page: Page) => page.getByRole('button', { name: 'Next' }).click();

/** Imports the progress file at `path` from Settings, replacing what is there, then goes Home. */
export async function importProgress(page: Page, path: string) {
  await page.goto('/settings');
  await expect(page.getByLabel('New items per day')).toBeVisible(WAIT);
  await page.getByLabel('Import progress').setInputFiles(path);
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByRole('status')).toHaveText('Progress imported.', WAIT);
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page.getByTestId('today-new')).toBeVisible(WAIT);
}

const DAY = 24 * 60 * 60 * 1000;

/** A progress row at `rung` with one card, last reviewed 5 days ago and due `dueInDays` from now. */
export function progressRow(
  itemId: string,
  rung: number,
  {
    dueInDays,
    l3PassDays = [],
    introducedAt,
  }: { dueInDays: number; l3PassDays?: string[]; introducedAt: number },
) {
  const now = Date.now();
  const card = {
    due: now + dueInDays * DAY,
    stability: 30,
    difficulty: 5,
    scheduled_days: 30,
    learning_steps: 0,
    reps: 4,
    lapses: 0,
    state: 2,
    last_review: now - 5 * DAY,
  };
  return {
    itemId,
    rung,
    highestRung: rung,
    cards: { [rung]: card },
    l3PassDays,
    inL3Lapse: false,
    introducedAt,
  };
}

/** A progress file in the export format Settings imports, holding `progress` and nothing else. */
export async function writeProgressFile(path: string, progress: ReturnType<typeof progressRow>[]) {
  const file = {
    format: 'geography-trainer-progress',
    version: 3,
    exportedAt: new Date().toISOString(),
    progress,
    answers: [],
    placementsDone: [],
  };
  await writeFile(path, JSON.stringify(file));
}

/** A progress file in which `country:united-states` is mastered (L3 passed on two different days). */
export async function writeMasteredUnitedStates(path: string) {
  await writeProgressFile(path, [
    progressRow('country:united-states', 3, {
      dueInDays: 30,
      l3PassDays: ['2026-01-10', '2026-01-20'],
      introducedAt: Date.now() - 60 * DAY,
    }),
  ]);
}

/** Countries introduced today in `writeUnitedStatesOnePassFromMastery`, so no new item is due. */
const INTRODUCED_TODAY = [
  'germany',
  'france',
  'spain',
  'italy',
  'japan',
  'china',
  'india',
  'brazil',
  'canada',
  'mexico',
  'australia',
  'egypt',
  'kenya',
  'peru',
  'chile',
];

/**
 * A progress file whose session is one question: `country:united-states` due at L3, one pass on
 * another day from mastery. Today's 15 new items are used up by countries that are not yet due.
 */
export async function writeUnitedStatesOnePassFromMastery(path: string) {
  await writeProgressFile(path, [
    progressRow('country:united-states', 3, {
      dueInDays: -1,
      l3PassDays: ['2026-01-10'],
      introducedAt: Date.now() - 60 * DAY,
    }),
    ...INTRODUCED_TODAY.map((id) =>
      progressRow(`country:${id}`, 1, { dueInDays: 30, introducedAt: Date.now() }),
    ),
  ]);
}
