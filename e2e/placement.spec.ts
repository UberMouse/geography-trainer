import { hook } from './globeHook';
import { writeMasteredTexas, writeTexasPlacesPlaced } from './placementHelpers';
import {
  answer,
  current,
  importProgress,
  next,
  question,
  tapGlobe,
  WAIT,
  writeMasteredUnitedStatesGateOpen,
} from './sessionHelpers';
import { appBar, expect, test, type Page } from './test';

// Placement loads the world's map data and draws up to 20 globes: slow on a loaded machine.
test.describe.configure({ timeout: 240_000 });

const TEST_ID = 'placement-question';
const done = (page: Page) => page.getByRole('heading', { name: 'Placement done' });

/** Answers the current placement question and waits for the reveal. */
async function answerCurrent(page: Page, isMobile: boolean) {
  const q = await current(page, TEST_ID);
  expect(q.rung).toBe(3);
  await answer(page, isMobile, q);
}

async function noHorizontalScroll(page: Page) {
  const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
}

test('[PLC-01, PLC-03, PLC-18, PLC-20] from a fresh profile, Home offers the placement test and the test ends in a result', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /^Start/ })).toBeVisible(WAIT);
  await page.getByRole('link', { name: 'Take the placement test' }).click();
  await expect(page).toHaveURL(/\/placement$/);

  await expect(question(page, TEST_ID)).toBeVisible(WAIT);
  await expect(page.getByText('Placement: question 1 of up to 20')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Quit to Home' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('button', { name: 'Finish now' })).toHaveCount(0);
  // Every placement question is an L3 tap on the bare globe.
  await expect(page.locator('[data-mode]')).toHaveAttribute('data-mode', 'bare');
  if (isMobile) await noHorizontalScroll(page);

  for (let i = 0; i < 20 && !(await done(page).isVisible()); i++) {
    await answerCurrent(page, isMobile);
    if (i === 0) await expect(page.getByRole('button', { name: 'Finish now' })).toBeVisible();
    await next(page);
    await expect(question(page, TEST_ID).or(done(page))).toBeVisible(WAIT);
  }
  await expect(done(page)).toBeVisible(WAIT);
  await expect(page.getByText(/^(Your level: \d of 8\.|No level placed yet)/)).toBeVisible();
  if (isMobile) await noHorizontalScroll(page);
  await expect(page.getByRole('link', { name: 'Back to Home' })).toHaveAttribute('href', '/');

  await page.getByRole('link', { name: 'Start studying' }).click(WAIT);
  await expect(page).toHaveURL(/\/session$/);
  await expect(question(page)).toBeVisible(WAIT);
});

test('[PLC-18, PLC-20] Finish now ends the test after one answer, at 390 px without horizontal scroll', async ({
  page,
  isMobile,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/placement');
  await answerCurrent(page, isMobile);
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Finish now' }).click();
  await expect(done(page)).toBeVisible(WAIT);
  await expect(page.getByRole('link', { name: 'Start studying' })).toBeVisible(WAIT);
  await noHorizontalScroll(page);
});

test('[PLC-23] a test-out page for an item that is not mastered is not available', async ({ page, isMobile }) => {
  await page.goto('/placement/germany');
  await expect(page.getByText('This test is not available.')).toBeVisible(WAIT);
  await expect(page.getByRole('link', { name: 'Back to the country' })).toHaveAttribute(
    'href',
    '/progress/germany',
  );
  await expect(question(page, TEST_ID)).toHaveCount(0);
  if (isMobile) await noHorizontalScroll(page);
});

test('[PLC-22, PLC-19, SCR-05] Markers: Finish now hides the Home offer; Quit keeps it', async ({ page, isMobile }) => {
  const offer = page.getByRole('link', { name: 'Take the placement test' });
  await page.goto('/');
  await expect(offer).toBeVisible(WAIT);

  await offer.click();
  await answerCurrent(page, isMobile);
  await page.getByRole('link', { name: 'Quit to Home' }).click();
  await expect(page.getByRole('link', { name: /^Start/ })).toBeVisible(WAIT);
  await expect(offer).toBeVisible();

  await offer.click();
  await answerCurrent(page, isMobile);
  await page.getByRole('button', { name: 'Finish now' }).click();
  await expect(done(page)).toBeVisible(WAIT);
  await expect(page.getByRole('link', { name: 'Back to Home' })).toBeVisible(WAIT);
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page.getByRole('link', { name: /^Start/ })).toBeVisible(WAIT);
  await expect(offer).toHaveCount(0);
});

test('[PLC-19] Quit in the middle of a question leaves Home with no pin, and taps there drop none', async ({
  page,
  isMobile,
}) => {
  await page.goto('/placement');
  const q = await current(page, TEST_ID);
  await tapGlobe(page, isMobile, q.answer);
  await expect.poll(() => hook.markers(page)).toEqual([expect.objectContaining({ kind: 'pin' })]);
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeEnabled();

  await page.getByRole('link', { name: 'Quit to Home' }).click();
  await expect(page.getByRole('link', { name: /^Start/ })).toBeVisible(WAIT);
  await expect.poll(() => hook.markers(page)).toEqual([]);
  expect((await hook.layerIds(page)).filter((id) => id.startsWith('gt-reveal'))).toEqual([]);
  // The question's tap handler went with it.
  await tapGlobe(page, isMobile, q.answer);
  await page.waitForTimeout(500);
  expect((await hook.markers(page)).filter((m) => m.kind === 'pin')).toEqual([]);
});

test('[GLB-36, PLC-19] leaving a test by a bar link keeps its saved answers, stores no marker and leaves no pin', async ({
  page,
  isMobile,
}) => {
  await page.goto('/placement');
  await answerCurrent(page, isMobile);
  await next(page);
  const q = await current(page, TEST_ID);
  await tapGlobe(page, isMobile, q.answer);
  await expect.poll(() => hook.markers(page)).toEqual([expect.objectContaining({ kind: 'pin' })]);

  await appBar(page).getByRole('link', { name: 'Progress' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible(WAIT);
  await expect.poll(() => hook.markers(page)).toEqual([]);
  expect((await hook.layerIds(page)).filter((id) => id.startsWith('gt-reveal'))).toEqual([]);
  // No finished-test marker: Home still offers the test. The answered question's progress is kept.
  await appBar(page).getByRole('link', { name: 'Geography Trainer' }).click();
  await expect(page.getByRole('link', { name: 'Take the placement test' })).toBeVisible(WAIT);
  const saved = () =>
    page.evaluate(
      () =>
        new Promise<{ progress: number; meta: number }>((resolve, reject) => {
          // The node tsconfig has no DOM types, so the few IndexedDB members used are typed here.
          interface Req<T> {
            result: T;
            error: unknown;
            onsuccess: (() => void) | null;
            onerror: (() => void) | null;
          }
          interface Count {
            result: number;
          }
          interface Tx {
            objectStore(name: string): { count(): Count };
            oncomplete: (() => void) | null;
            onerror: (() => void) | null;
            error: unknown;
          }
          const idb = (globalThis as unknown as { indexedDB: { open(name: string): Req<{ transaction(names: string[]): Tx }> } })
            .indexedDB;
          const open = idb.open('geography-trainer');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction(['progress', 'meta']);
            const progress = tx.objectStore('progress').count();
            const meta = tx.objectStore('meta').count();
            tx.oncomplete = () => resolve({ progress: progress.result, meta: meta.result });
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
  // The answer's save is asynchronous: wait for it before counting.
  await expect.poll(async () => (await saved()).progress).toBeGreaterThan(0);
  expect((await saved()).meta).toBe(0);
});

test("[PLC-02, PLC-06, PLC-18, PLC-20, PLC-22, SCR-18] a test-out of Texas's places: a close miss is noted, focus follows, and the finished test hides its link", async ({
  page,
  isMobile,
}, testInfo) => {
  const file = testInfo.outputPath('mastered-texas.json');
  await writeMasteredTexas(file);
  await importProgress(page, file);

  const drill = '/progress/united-states/united-states.texas';
  const link = page.getByRole('link', { name: "Test out of Texas's places" });
  await page.goto(drill);
  await link.click(WAIT);
  await expect(page).toHaveURL(/\/placement\/united-states\/united-states\.texas$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText("Test out of Texas's places", WAIT);
  await expect(page.getByRole('link', { name: 'Quit to Texas' })).toHaveAttribute('href', drill);

  // One degree of latitude north of the place: about 111 km, a miss within the 200 km close distance.
  const first = await current(page, TEST_ID);
  expect(first.itemId).toMatch(/^place:/);
  await tapGlobe(page, isMobile, [first.answer[0], first.answer[1] + 1]);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('placement-close')).toBeVisible(WAIT);
  await next(page);

  const second = await current(page, TEST_ID);
  await expect(question(page, TEST_ID)).toBeFocused();
  await answer(page, isMobile, second);
  await expect(page.getByTestId('placement-close')).toHaveCount(0);

  await page.getByRole('button', { name: 'Finish now' }).click();
  await expect(done(page)).toBeVisible(WAIT);
  await expect(done(page)).toBeFocused();
  await expect(page.getByText(/^1 place you got right /)).toBeVisible();
  await expect(page.getByText(/^1 place you were close on /)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start studying' })).toBeVisible(WAIT);
  await expect(page.getByRole('link', { name: 'Back to Texas' })).toHaveAttribute('href', drill);
  if (isMobile) await noHorizontalScroll(page);

  await page.goto(drill);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Texas', WAIT);
  await expect(page.getByTestId('drill-list').locator('li').first()).toBeVisible(WAIT);
  await expect(page.getByRole('link', { name: /Test out of/ })).toHaveCount(0);
});

test("[PLC-18, PLC-20] a country's test-out quits and finishes back to the country's page", async ({
  page,
  isMobile,
}, testInfo) => {
  const file = testInfo.outputPath('mastered-us.json');
  await writeMasteredUnitedStatesGateOpen(file);
  await importProgress(page, file);

  await page.goto('/placement/united-states');
  await expect(question(page, TEST_ID)).toBeVisible(WAIT);
  await expect(page.getByRole('link', { name: 'Quit to United States' })).toHaveAttribute(
    'href',
    '/progress/united-states',
  );
  await answerCurrent(page, isMobile);
  await page.getByRole('button', { name: 'Finish now' }).click();
  await expect(done(page)).toBeVisible(WAIT);
  await page.getByRole('link', { name: 'Back to United States' }).click();
  await expect(page).toHaveURL(/\/progress\/united-states$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('United States', WAIT);
});

test("[PLC-21] a region's test-out with nothing left to test links back to the region's page", async ({
  page,
}, testInfo) => {
  const file = testInfo.outputPath('placed-texas.json');
  await writeTexasPlacesPlaced(file);
  await importProgress(page, file);

  await page.goto('/placement/united-states/united-states.texas');
  await expect(page.getByText(/^There is nothing left to test: all of Texas's places/)).toBeVisible(WAIT);
  await expect(question(page, TEST_ID)).toHaveCount(0);
  const back = page.getByRole('link', { name: 'Back to Texas' });
  await expect(back).toHaveAttribute('href', '/progress/united-states/united-states.texas');
  await back.click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Texas', WAIT);
});
