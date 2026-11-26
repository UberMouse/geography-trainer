import { answer, current, next, question, summary, WAIT } from './sessionHelpers';
import { expect, test, type Page } from './test';

// A session loads the world's map data and draws on the globe: slow on a loaded machine.
test.describe.configure({ timeout: 240_000 });

/** The page's globals this spec touches (the e2e tsconfig has no DOM types). */
interface PageGlobals {
  /** While true, every IndexedDB `add` throws, so saving an answer fails. */
  __failSaves?: boolean;
  IDBObjectStore: { prototype: { add(this: unknown, ...args: unknown[]): unknown } };
}

/** Makes IndexedDB writes fail while `__failSaves` is true (an answer save adds its log row). */
async function breakSaves(page: Page) {
  await page.addInitScript(() => {
    const g = globalThis as unknown as PageGlobals;
    g.__failSaves = true;
    const store = g.IDBObjectStore.prototype;
    const add = store.add;
    store.add = function (this: unknown, ...args: unknown[]) {
      if (g.__failSaves) throw new Error('Simulated full disk');
      return add.apply(this, args);
    };
  });
}

const allowSaves = (page: Page) =>
  page.evaluate(() => {
    (globalThis as unknown as PageGlobals).__failSaves = false;
  });

const banner = (page: Page) => page.getByRole('alert').filter({ hasText: 'could not be saved' });

test('[STO-03, STO-04] a failed save shows the banner and prompts on close until Retry saves it', async ({
  page,
  isMobile,
}) => {
  await breakSaves(page);
  await page.goto('/');
  await page.getByRole('link', { name: /^Start/ }).click();

  const first = await current(page);
  await expect(banner(page)).toHaveCount(0);
  await answer(page, isMobile, first);
  await expect(banner(page)).toBeVisible(WAIT);
  await expect(banner(page)).toContainText(/last answer could not be saved/);

  // The learner keeps going; the next answer waits behind the failed one.
  await next(page);
  await expect(question(page).or(summary(page))).toBeVisible(WAIT);
  await answer(page, isMobile, await current(page));
  await expect(banner(page)).toContainText(/last 2 answers could not be saved/);

  // Closing now would lose them: the browser asks first.
  const asked = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const dialog = await asked;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  expect(page.isClosed()).toBe(false);

  await allowSaves(page);
  await banner(page).getByRole('button', { name: 'Retry' }).click();
  await expect(banner(page)).toHaveCount(0);
  // The banner goes once the failed answer saves; the one behind it may still be saving.
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0');

  // Everything saved: the tab closes without a prompt.
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => ({ dialogs, closed: page.isClosed() })).toEqual({ dialogs: [], closed: true });
});
