import { GATE_WAVE1_MASTERED_COUNTRIES } from '../src/engine/config';
import { hook, viewport } from './globeHook';
import {
  answer,
  current,
  importProgress,
  next,
  question,
  seedSummarySavedRun,
  summary,
  WAIT,
  writeMasteredUnitedStatesWithFewDue,
  writeTexasOnePassFromMastery,
  writeUnitedStatesOnePassFromMastery,
  writeUnitedStatesThenGateOpener,
} from './sessionHelpers';
import { expect, test, type Page } from './test';

// A session loads the world's map data and draws on the globe: slow on a loaded machine.
test.describe.configure({ timeout: 240_000 });

const MODE = { 1: 'highlight', 3: 'bare' } as const;
const mode = (page: Page) => page.locator('[data-mode]');
const options = (page: Page) => page.getByRole('group', { name: 'Options' }).getByRole('button');

test('[SES-10] from Home, a session asks L1, L2 and L3 on the globe, with the reveal’s km and score', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: /^Start/ }).click();
  const seen = new Set<number>();
  for (let i = 0; i < 20 && seen.size < 3; i++) {
    const q = await current(page);
    if (q.rung === 1 || q.rung === 3) await expect(mode(page)).toHaveAttribute('data-mode', MODE[q.rung]);
    else await expect(mode(page)).toHaveAttribute('data-mode', /^(countryBorders|regionBorders)$/);
    // The target is not named on the globe before the answer.
    expect((await hook.markers(page)).filter((m) => m.kind === 'name')).toEqual([]);
    // Unhurried, so an L1 pass climbs to L2 rather than skipping it.
    await answer(page, isMobile, q, { slow: true });
    await expect(page.getByRole('status')).toHaveText(/^Correct/);
    if (q.rung > 1) {
      // A tap at the answer point is inside the target's polygon (or on the place).
      await expect(page.getByTestId('reveal-km')).toHaveText(/^(inside the border|\d[\d.,]* km (away|outside the border))$/);
      await expect(page.getByTestId('reveal-score')).toHaveText(/^\d+$/);
      if (q.itemId.startsWith('country:')) {
        await expect(page.getByTestId('reveal-km')).toHaveText('inside the border');
        await expect(page.getByTestId('reveal-score')).toHaveText('100');
      }
    }
    await expect
      .poll(() => hook.markers(page))
      .toContainEqual(expect.objectContaining({ kind: 'name', text: q.name }));
    await expect(page.getByRole('button', { name: 'Next' })).toBeFocused();
    seen.add(q.rung);
    await next(page);
    await expect(question(page).or(summary(page))).toBeVisible(WAIT);
    // The next question starts without the last one's name or pin.
    await expect.poll(async () => (await hook.markers(page)).length).toBe(0);
  }
  expect([...seen].sort()).toEqual([1, 2, 3]);
});

test('[SES-11] a correct, unhurried L1 answer brings the same item back at L2 within the next 4 questions', async ({
  page,
  isMobile,
}) => {
  await page.goto('/session');
  const first = await current(page);
  expect(first.rung).toBe(1);
  await answer(page, isMobile, first, { slow: true });
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

test('[SES-13, SES-22, SES-25] a round ends in a summary, and progress survives a reload', async ({ page, isMobile }) => {
  await page.goto('/session');
  const first = await current(page);
  for (let i = 0; i < 25 && !(await summary(page).isVisible()); i++) {
    const q = await current(page);
    // Some taps miss, so the round has wrong answers too.
    await answer(page, isMobile, q, { miss: i % 3 === 2 });
    await next(page);
    await expect(question(page).or(summary(page))).toBeVisible(WAIT);
  }
  await expect(summary(page)).toHaveText(/ of 20 right$/);
  // Every answer is written to IndexedDB before the reload.
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);
  await expect(page.getByRole('button', { name: 'Keep going' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Home' })).toBeVisible();

  // The tab resumes its run: the same summary, then the rest of the queue.
  await page.reload();
  await expect(summary(page)).toHaveText(/ of 20 right$/, WAIT);
  await page.getByRole('button', { name: 'Keep going' }).click();
  const again = await current(page);
  expect(again.rung === 1 && again.itemId === first.itemId).toBe(false);
});

test('[SES-25] a reload mid-round carries on at the next question, with the round counted as before', async ({
  page,
  isMobile,
}) => {
  await page.goto('/session');
  for (let i = 0; i < 3; i++) {
    await answer(page, isMobile, await current(page), { miss: i === 1 });
    await next(page);
  }
  const header = page.getByText(/^Question \d+ · \d+ of \d+ done$/);
  await expect(header).toHaveText(/^Question 4 · /, WAIT);
  const before = await current(page);
  const counted = await header.innerText();
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);

  await page.reload();
  await expect(header).toHaveText(counted, WAIT);
  expect(await current(page)).toEqual(before);
});

test('[SES-25, SES-C05] a reload on a summary with questions left keeps its unlock line, and Keep going starts the next round afresh', async ({
  page,
  isMobile,
}, testInfo) => {
  const file = testInfo.outputPath('us-mastered-with-few-due.json');
  await writeMasteredUnitedStatesWithFewDue(file);
  await importProgress(page, file);
  // Round one ended at its summary with three questions left: seeded, not played through.
  await seedSummarySavedRun(page);
  await page.getByRole('link', { name: /^Start/ }).click();

  const unlock = page.getByText("Unlocked: United States's regions");
  const testOut = page.getByRole('link', { name: 'Test out' });
  const keepGoing = page.getByRole('button', { name: 'Keep going' });
  // Answers every question correctly until a summary shows, then waits for the answers to be saved.
  const answerToSummary = async () => {
    for (let i = 0; i < 60 && !(await summary(page).isVisible()); i++) {
      await answer(page, isMobile, await current(page));
      await next(page);
      await expect(question(page).or(summary(page))).toBeVisible(WAIT);
    }
    await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);
  };

  await expect(summary(page)).toHaveText('Round done: 20 of 20 right', WAIT);
  await expect(unlock).toBeVisible();
  await expect(testOut).toBeVisible();
  await expect(keepGoing).toBeVisible();

  await page.reload();
  await expect(summary(page)).toHaveText('Round done: 20 of 20 right', WAIT);
  await expect(unlock).toBeVisible();
  await expect(testOut).toBeVisible();

  // The next round lists only what it mastered: a reload in it resumes it, and its summary has no line.
  await keepGoing.click();
  await current(page);
  await page.reload();
  await answerToSummary();
  await expect(page.getByText('That is everything for today.')).toBeVisible();
  await expect(unlock).toHaveCount(0);
});

test('[SES-10] a missed tap is incorrect, with its km and a low score', async ({ page, isMobile }) => {
  await page.goto('/session');
  let q = await current(page);
  await answer(page, isMobile, q);
  await next(page);
  for (let i = 0; i < 6 && q.rung === 1; i++) {
    q = await current(page);
    if (q.rung === 1) {
      await answer(page, isMobile, q);
      await next(page);
    }
  }
  // L2, or L3 when the L1 answer was fast enough to skip a rung.
  expect(q.rung).toBeGreaterThan(1);
  await answer(page, isMobile, q, { miss: true });
  await expect(page.getByRole('status')).toHaveText(/^Incorrect · it is /);
  expect(Number((await page.getByTestId('reveal-km').innerText()).replace(/[^\d.]/g, ''))).toBeGreaterThan(
    10_000,
  );
  await expect(page.getByTestId('reveal-score')).toHaveText(/^\d$/);
});

test('[SES-24, SES-18] test-out opens from the link on a round summary', async ({ page, isMobile }, testInfo) => {
  const file = testInfo.outputPath('us-one-pass-from-mastery.json');
  await writeUnitedStatesOnePassFromMastery(file);
  await importProgress(page, file);

  await page.getByRole('link', { name: /^Start/ }).click();
  const q = await current(page);
  expect(q).toMatchObject({ itemId: 'country:united-states', rung: 3 });
  await answer(page, isMobile, q);
  await next(page);
  await expect(summary(page)).toHaveText('Round done: 1 of 1 right', WAIT);
  await expect(summary(page)).toBeFocused();
  await page.getByRole('link', { name: 'Test out' }).click();
  await expect(page).toHaveURL(/\/placement\/united-states$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    "Test out of United States's regions",
    WAIT,
  );
  const first = await current(page, 'placement-question');
  expect(first.rung).toBe(3);
  await expect(mode(page)).toHaveAttribute('data-mode', 'bare');
});

test('[SES-23, SES-C05, SES-C07] a country mastered behind a shut gate gets its Test out link once a later answer opens the gate', async ({
  page,
  isMobile,
}, testInfo) => {
  const file = testInfo.outputPath('us-then-gate-opener.json');
  const { secondId } = await writeUnitedStatesThenGateOpener(file);
  await importProgress(page, file);

  await page.getByRole('link', { name: /^Start/ }).click();
  const first = await current(page);
  expect(first).toMatchObject({ itemId: 'country:united-states', rung: 3 });
  await answer(page, isMobile, first);
  await next(page);
  const second = await current(page);
  expect(second).toMatchObject({ itemId: secondId, rung: 3 });
  await answer(page, isMobile, second);
  await next(page);

  await expect(summary(page)).toHaveText('Round done: 2 of 2 right', WAIT);
  // The United States was mastered one country short of its gate; the second answer opened it.
  const unlocked = page.getByText(/^Unlocked: United States's regions/);
  await expect(unlocked).toBeVisible();
  await expect(unlocked.getByRole('link', { name: 'Test out' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Test out' })).toHaveCount(1);
  await expect(
    page.getByText(
      `You've mastered ${GATE_WAVE1_MASTERED_COUNTRIES} countries: regions and places are open for 1 of them`,
    ),
  ).toBeVisible();
});

test('[SES-19] at phone width, all 4 options of an L1 question show without scrolling', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'phone width only');
  await page.goto('/session');
  const q = await current(page);
  expect(q.rung).toBe(1);
  await expect(options(page)).toHaveCount(4);
  const vp = await viewport(page);
  expect(vp.scrollWidth).toBeLessThanOrEqual(vp.width);
  const column = page.getByTestId('column');
  expect(await column.evaluate((el) => el.scrollTop)).toBe(0);
  const columnBox = (await column.boundingBox())!;
  for (const option of await options(page).all()) {
    const box = (await option.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(columnBox.y);
    expect(box.y + box.height).toBeLessThanOrEqual(Math.min(vp.height, columnBox.y + columnBox.height));
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  }
});

test('[SES-20] without WebGL an L1 question can still be answered', async ({ page }) => {
  await page.addInitScript(() => {
    const canvas = (
      globalThis as unknown as {
        HTMLCanvasElement: { prototype: { getContext(kind: string): unknown } };
      }
    ).HTMLCanvasElement.prototype;
    const getContext = canvas.getContext;
    canvas.getContext = function (this: unknown, kind: string, ...rest: unknown[]) {
      return kind.startsWith('webgl') || kind === 'experimental-webgl'
        ? null
        : getContext.call(this, kind, ...(rest as []));
    };
  });
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  await page.goto('/session');
  await expect(page.getByTestId('globe-slot').getByRole('alert')).toBeVisible(WAIT);
  const q = await current(page);
  expect(q.rung).toBe(1);
  await page
    .getByRole('group', { name: 'Options' })
    .getByRole('button', { name: q.name, exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText(/^Correct/);
  await next(page);
  await expect(question(page)).toBeVisible();
  expect(errors).toEqual([]);
});

const counter = (page: Page) => page.getByText(/^Question \d+ · \d+ of \d+ done$/);

test('[SES-18, SES-27] Next moves focus to the new question, and leaving the session ends it', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: /^Start/ }).click();
  await answer(page, isMobile, await current(page));
  await next(page);
  await expect(question(page)).toBeFocused();
  await expect(counter(page)).toHaveText(/^Question 2 · /, WAIT);
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);

  await page.getByRole('link', { name: 'Quit' }).click();
  await page.getByRole('link', { name: /^Start/ }).click();
  await expect(counter(page)).toHaveText(/^Question 1 · 0 of /, WAIT);
});

test('[SES-25] a reload after answering, before Next, carries on at the next question', async ({
  page,
  isMobile,
}) => {
  await page.goto('/session');
  const first = await current(page);
  await answer(page, isMobile, first);
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);

  await page.reload();
  await expect(counter(page)).toHaveText(/^Question 2 · /, WAIT);
  expect((await current(page)).itemId).not.toBe(first.itemId);
});

test('[SES-21, SES-22, SES-23] the last round waits for the next session, then nothing is left to study', async ({
  page,
  isMobile,
}, testInfo) => {
  const file = testInfo.outputPath('us-one-pass-from-mastery.json');
  await writeUnitedStatesOnePassFromMastery(file);
  await importProgress(page, file);

  await page.getByRole('link', { name: /^Start/ }).click();
  await answer(page, isMobile, await current(page));
  await next(page);
  await expect(summary(page)).toHaveText('Round done: 1 of 1 right', WAIT);
  // The round mastered the United States, which unlocks its regions for a later session.
  await expect(page.getByText(/^Unlocked: United States's regions/)).toBeVisible();
  await expect(page.getByText(/next session/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep going' })).toHaveCount(0);
  await expect(page.getByText(/everything for today/)).toBeVisible();
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);

  // Today's new items are used up by the imported countries, and nothing else is due.
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await page.goto('/session');
  await expect(page.getByText(/nothing to study right now/)).toBeVisible(WAIT);
  await expect(page.getByRole('link', { name: 'Back to Home' })).toBeVisible();
  await expect(question(page)).toHaveCount(0);
});

test('[SES-21] a session whose data fails to load offers Retry, which starts it', async ({ page }) => {
  const route = '**/data/places.json';
  await page.route(route, (r) => r.fulfill({ status: 500, body: '' }));
  await page.goto('/session');
  const alert = page.getByRole('alert').filter({ hasText: /Could not load/ });
  await expect(alert).toBeVisible(WAIT);
  await page.unroute(route);
  await alert.getByRole('button', { name: 'Retry' }).click();
  await expect(question(page)).toBeVisible(WAIT);
});

test('[SES-25, SES-C05] a reload on the last summary of the day keeps its unlock line and Test out link, reload after reload', async ({
  page,
  isMobile,
}, testInfo) => {
  const file = testInfo.outputPath('us-one-pass-from-mastery.json');
  await writeUnitedStatesOnePassFromMastery(file);
  await importProgress(page, file);

  await page.getByRole('link', { name: /^Start/ }).click();
  await answer(page, isMobile, await current(page));
  await next(page);
  const unlocked = page.getByText(/^Unlocked: United States's regions/);
  await expect(summary(page)).toHaveText('Round done: 1 of 1 right', WAIT);
  await expect(unlocked).toBeVisible();
  await expect(page.getByRole('link', { name: 'Test out' })).toBeVisible();
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);

  await page.reload();
  await expect(summary(page)).toHaveText('Round done: 1 of 1 right', WAIT);
  await expect(unlocked).toBeVisible();
  await expect(page.getByRole('link', { name: 'Test out' })).toBeVisible();
  await expect(page.getByText(/everything for today/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep going' })).toHaveCount(0);
  await expect(page.getByText(/nothing to study right now/)).toHaveCount(0);

  // The write on mount keeps the run through StrictMode's remount, so it survives a second reload.
  await page.reload();
  await expect(summary(page)).toHaveText('Round done: 1 of 1 right', WAIT);
  await expect(unlocked).toBeVisible();
  await expect(page.getByRole('link', { name: 'Test out' })).toBeVisible();
  await expect(page.getByText(/everything for today/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Keep going' })).toHaveCount(0);
});

test('[SES-25, SES-C05, SES-C07] a reload mid-round keeps what the round has mastered, a region naming its country', async ({
  page,
  isMobile,
}, testInfo) => {
  const file = testInfo.outputPath('texas-one-pass-from-mastery.json');
  await writeTexasOnePassFromMastery(file);
  await importProgress(page, file);

  await page.getByRole('link', { name: /^Start/ }).click();
  const first = await current(page);
  expect(first.itemId).toBe('region:united-states.texas');
  await answer(page, isMobile, first);
  await next(page);
  const second = await current(page);
  expect(second.itemId).toBe('country:argentina');
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);

  await page.reload();
  expect(await current(page)).toEqual(second);
  await answer(page, isMobile, second);
  await next(page);
  await expect(summary(page)).toHaveText('Round done: 2 of 2 right', WAIT);
  await expect(page.getByText("Unlocked: Texas's places (United States)")).toBeVisible();
});
