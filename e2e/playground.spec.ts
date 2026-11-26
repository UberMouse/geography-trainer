import { globeHooked, viewport } from './globeHook';
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

test('the playground opens on the Exercises tab, at France on L1', async ({ page }) => {
  await openExercises(page);
  await expect(exercisesTab(page)).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('item-id')).toHaveText('country:france');
  await expect(page.getByRole('combobox', { name: 'Rung' })).toHaveValue('1');
  await expect(page.getByRole('group', { name: 'Options' })).toBeVisible();
  await expect(page.locator('[data-mode]')).toHaveAttribute('data-mode', 'highlight');
});

test('a rung other than 1, 2 or 3 falls back to L1', async ({ page }) => {
  for (const rung of ['7', 'two', '']) {
    await openExercises(page, `?item=country:france&rung=${rung}`);
    await expect(page.getByRole('combobox', { name: 'Rung' })).toHaveValue('1');
    await expect(page.getByRole('group', { name: 'Options' })).toBeVisible();
  }
});

test('the Exercises tab has no horizontal scroll at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openExercises(page, '?item=place:honolulu_hawaii&rung=2');
  const vp = await viewport(page);
  expect(vp.scrollWidth).toBeLessThanOrEqual(vp.width);
});

test('a failed load shows an error whose Retry loads again', async ({ page }) => {
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
