import { hook, viewport } from './globeHook';
import {
  answer,
  current,
  importProgress,
  next,
  question,
  summary,
  WAIT,
  writeUnitedStatesOnePassFromMastery,
} from './sessionHelpers';
import { expect, test, type Page } from './test';

// A session loads the world's map data and draws on the globe: slow on a loaded machine.
test.describe.configure({ timeout: 240_000 });

const MODE = { 1: 'highlight', 3: 'bare' } as const;
const mode = (page: Page) => page.locator('[data-mode]');
const options = (page: Page) => page.getByRole('group', { name: 'Options' }).getByRole('button');

test('from Home, a session asks L1, L2 and L3 on the globe, with the reveal’s km and score', async ({
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
    await answer(page, isMobile, q);
    await expect(page.getByRole('status')).toHaveText(/^Correct/);
    if (q.rung > 1) {
      // A tap at the answer point is inside the target's polygon (or on the place).
      await expect(page.getByTestId('reveal-km')).toHaveText(/^\d[\d.,]* km$/);
      await expect(page.getByTestId('reveal-score')).toHaveText(/^\d+$/);
      if (q.itemId.startsWith('country:')) {
        await expect(page.getByTestId('reveal-km')).toHaveText('0.0 km');
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

  await page.reload();
  const again = await current(page);
  expect(again.rung === 1 && again.itemId === first.itemId).toBe(false);
});

test('a missed tap is incorrect, with its km and a low score', async ({ page, isMobile }) => {
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
  expect(q.rung).toBe(2);
  await answer(page, isMobile, q, { miss: true });
  await expect(page.getByRole('status')).toHaveText(/^Incorrect · Again · it is /);
  expect(Number((await page.getByTestId('reveal-km').innerText()).replace(/[^\d.]/g, ''))).toBeGreaterThan(
    10_000,
  );
  await expect(page.getByTestId('reveal-score')).toHaveText(/^\d$/);
});

test('test-out opens from the link on a round summary', async ({ page, isMobile }, testInfo) => {
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

test('at phone width, all 4 options of an L1 question show without scrolling', async ({
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

test('without WebGL an L1 question can still be answered', async ({ page }) => {
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
