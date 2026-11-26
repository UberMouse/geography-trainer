import { globeHooked, hook, viewport } from './globeHook';
import { expect, test, type Page } from './test';

// Each test loads the world's map data and draws on the globe: slow on a loaded machine.
test.describe.configure({ timeout: 90_000 });

const exercisesTab = (page: Page) =>
  page.getByRole('navigation', { name: 'Playground', exact: true }).getByRole('link', {
    name: 'Exercises',
  });

/** The Exercises tab at `query`, once its item is built and the globe is up. */
async function openExercises(page: Page, query = '') {
  await page.goto(`/playground${query}`);
  await expect(page.getByTestId('item-id')).toBeVisible({ timeout: 30_000 });
  await globeHooked(page);
}

test('[SCR-30, SCR-C13] the playground opens on the Exercises tab, at France on L1', async ({ page }) => {
  await openExercises(page);
  await expect(exercisesTab(page)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('item-id')).toHaveText('country:france');
  await expect(page.getByRole('combobox', { name: 'Rung' })).toHaveValue('1');
  await expect(page.getByRole('group', { name: 'Options' })).toBeVisible();
  await expect(page.locator('[data-mode]')).toHaveAttribute('data-mode', 'highlight');
});

test('[SCR-30, SCR-C13] a rung other than 1, 2 or 3 falls back to L1', async ({ page }) => {
  for (const rung of ['7', 'two', '']) {
    await openExercises(page, `?item=country:france&rung=${rung}`);
    await expect(page.getByRole('combobox', { name: 'Rung' })).toHaveValue('1');
    await expect(page.getByRole('group', { name: 'Options' })).toBeVisible();
  }
});

test('[SCR-30, SCR-C13] an unknown item is named, with a way back to France', async ({ page }) => {
  await page.goto('/playground?item=country:atlantis');
  await expect(page.getByRole('alert')).toContainText('country:atlantis', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Show country:france' }).click();
  await expect(page.getByTestId('item-id')).toHaveText('country:france', { timeout: 30_000 });
});

test('[SCR-30] an answer fills the last result', async ({ page }) => {
  await openExercises(page);
  await expect(page.getByTestId('last-rating')).toHaveText('–');
  await page.getByRole('group', { name: 'Options' }).getByRole('button').first().click();
  await expect(page.getByTestId('last-rating')).not.toHaveText('–');
  await expect(page.getByTestId('last-correct')).toHaveText(/^(true|false)$/);
});

test('[SCR-31, SCR-C13] the Globe tab puts the globe in each mode it picks', async ({ page }) => {
  await page.goto('/playground?mode=globe');
  await expect(page.getByRole('heading', { name: 'Globe playground' })).toBeVisible({ timeout: 30_000 });
  await globeHooked(page);
  const mode = page.locator('[data-mode]');
  await expect(mode).toHaveAttribute('data-mode', 'countryBorders');

  const pick = async (label: string) => {
    await page.getByRole('combobox', { name: 'Mode', exact: true }).click();
    await page.getByRole('option', { name: label, exact: true }).click();
  };
  await pick('Bare');
  await expect(mode).toHaveAttribute('data-mode', 'bare');
  await pick('Highlight');
  await expect(mode).toHaveAttribute('data-mode', 'highlight');
  await expect(page.getByRole('radiogroup', { name: 'Highlight target' })).toBeVisible();
  await pick('Progress');
  await expect(mode).toHaveAttribute('data-mode', 'progress');
  // Demo fills on the world's countries.
  await expect
    .poll(async () => Object.keys((await hook.progress(page))?.fills ?? {}).length)
    .toBeGreaterThan(0);

  await page.getByRole('link', { name: 'Exercises' }).click();
  await expect(page).toHaveURL(/mode=exercises/);
  await expect(page.getByTestId('item-id')).toBeVisible({ timeout: 30_000 });
});

test('[SCR-26] the Exercises tab has no horizontal scroll at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openExercises(page, '?item=place:honolulu_hawaii&rung=2');
  const vp = await viewport(page);
  expect(vp.scrollWidth).toBeLessThanOrEqual(vp.width);
});

test('[SCR-25, SCR-C11] a failed load shows an error whose Retry loads again', async ({ page }) => {
  let fail = true;
  await page.route('**/data/countries.topo.json', (route) =>
    fail ? route.fulfill({ status: 500, body: '' }) : route.continue(),
  );
  await page.goto('/playground');
  await expect(page.getByRole('alert')).toContainText('HTTP 500');
  fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('item-id')).toBeVisible({ timeout: 30_000 });
});
