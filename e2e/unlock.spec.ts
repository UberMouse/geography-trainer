import { expect, test, type Page } from '@playwright/test';
import { answer, current, next, question, summary, WAIT, writeMasteredUnitedStates } from './sessionHelpers';

// Sessions load the world's map data and draw maps: slow on a loaded machine.
test.describe.configure({ timeout: 240_000 });

async function importMastered(page: Page, path: string) {
  await page.goto('/settings');
  await expect(page.getByLabel('New items per day')).toBeVisible(WAIT);
  await page.getByLabel('Import progress').setInputFiles(path);
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByRole('status')).toHaveText('Progress imported.', WAIT);
  await page.getByRole('link', { name: 'Back to Home' }).click();
  await expect(page.getByTestId('today-new')).toBeVisible(WAIT);
}

test("a mastered country's regions are asked in the next session", async ({ page, isMobile }, testInfo) => {
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

  await started.getByRole('link', { name: 'United States' }).click();
  await expect(page).toHaveURL(/\/progress\/united-states$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('United States', WAIT);
});

test('tapping a country on the map goes to its page', async ({ page }) => {
  await page.goto('/progress');
  const shape = page.getByTestId('progress-map').locator('[data-item-id="germany"]');
  await expect(shape).toBeAttached(WAIT);
  await shape.dispatchEvent('click');
  await expect(page).toHaveURL(/\/progress\/germany$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Germany', WAIT);
});

test('a country can be opened from the Go to a country control using only the keyboard', async ({
  page,
}) => {
  await page.goto('/progress');
  const select = page.getByLabel('Go to a country');
  await expect(select.locator('option[value="germany"]')).toBeAttached(WAIT);
  await select.focus();
  await select.selectOption({ label: 'Germany' });
  await page.getByRole('button', { name: 'Go' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/progress\/germany$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Germany', WAIT);
});

test('the United States page shows it mastered and its regions as new', async ({ page }, testInfo) => {
  const file = testInfo.outputPath('mastered-us.json');
  await writeMasteredUnitedStates(file);
  await importMastered(page, file);

  await page.goto('/progress/united-states');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('United States', WAIT);
  await expect(page.getByTestId('drill-state')).toHaveText('(Mastered)');
  const list = page.getByTestId('drill-list');
  const texas = list.locator('li[data-item-id="region:united-states.texas"]');
  await expect(texas).toHaveAttribute('data-state', 'new', WAIT);
  await expect(texas).toContainText('Texas: New');
  await expect(list.locator('li[data-state="new"]')).toHaveCount(await list.locator('li').count());
});

test('the mastered United States page links to test out of its regions', async ({ page }, testInfo) => {
  const file = testInfo.outputPath('mastered-us.json');
  await writeMasteredUnitedStates(file);
  await importMastered(page, file);

  await page.goto('/progress/united-states');
  await page.getByRole('link', { name: "Test out of United States's regions" }).click();
  await expect(page).toHaveURL(/\/placement\/united-states$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    "Test out of United States's regions",
    WAIT,
  );
  await expect(page.getByTestId('placement-question')).toBeVisible(WAIT);

  // A region that is not mastered offers no test-out.
  await page.goto('/progress/united-states/united-states.texas');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Texas', WAIT);
  await expect(page.getByRole('link', { name: /Test out of/ })).toHaveCount(0);
});

test('a country whose parent is not mastered lists its regions as locked', async ({ page }) => {
  await page.goto('/progress/germany');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Germany', WAIT);
  const rows = page.getByTestId('drill-list').locator('li');
  await expect(rows.first()).toBeVisible(WAIT);
  for (const row of await rows.all()) {
    await expect(row).toHaveAttribute('data-state', 'locked');
    await expect(row).toContainText('Master Germany to unlock');
  }
});

test('the drill-down goes from the world to a country to a region and back', async ({ page }) => {
  await page.goto('/progress');
  const started = page.getByTestId('progress-map').locator('[data-item-id="germany"]');
  await expect(started).toBeAttached(WAIT);
  await started.dispatchEvent('click');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Germany', WAIT);

  // The regions map: tapping a region opens its page.
  const bayern = page.getByTestId('drill-map').locator('[data-item-id="germany.bayern"]');
  await expect(bayern).toBeAttached(WAIT);
  await bayern.dispatchEvent('click');
  await expect(page).toHaveURL(/\/progress\/germany\/germany\.bayern$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bayern', WAIT);
  const places = page.getByTestId('drill-list').locator('li');
  await expect(places.first()).toContainText('Master Bayern to unlock', WAIT);
  await expect(page.getByTestId('drill-map').locator('circle[data-item-id]').first()).toBeAttached();

  await page.getByRole('link', { name: 'Back to Germany' }).click();
  await expect(page).toHaveURL(/\/progress\/germany$/);
  // The list links to a region too.
  await page.getByTestId('drill-list').getByRole('link', { name: 'Bayern' }).click();
  await expect(page).toHaveURL(/\/progress\/germany\/germany\.bayern$/);
  await page.getByRole('link', { name: 'Back to Germany' }).click();
  await page.getByRole('link', { name: 'Back to the world' }).click();
  await expect(page).toHaveURL(/\/progress$/);
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible(WAIT);
});

test('a country without regions draws its places as dots', async ({ page }) => {
  await page.goto('/progress/singapore');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Singapore', WAIT);
  const expected = await page.getByTestId('drill-list').locator('li').count();
  expect(expected).toBeGreaterThan(0);
  await expect(page.getByTestId('drill-map').locator('circle[data-item-id]')).toHaveCount(expected);
});

test('outlying regions and places are named under the map', async ({ page }) => {
  await page.goto('/progress/united-states');
  const off = page.getByTestId('off-map');
  await expect(off).toContainText('Not on this map', WAIT);
  await expect(off.getByRole('link', { name: 'Hawaii' })).toBeVisible();
  await off.getByRole('link', { name: 'Alaska' }).click();
  await expect(page).toHaveURL(/\/progress\/united-states\/united-states\.alaska$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Alaska', WAIT);

  await page.goto('/progress/united-kingdom');
  await expect(page.getByTestId('off-map')).toContainText('Gibraltar', WAIT);
  await expect(page.getByTestId('off-map').getByRole('link')).toHaveCount(0);
});

test('a country outline stays neutral when a place shares the country id', async ({ page }) => {
  await page.goto('/progress/cyprus');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Cyprus', WAIT);
  const map = page.getByTestId('drill-map');
  await expect(map.locator('circle[data-item-id="cyprus"]')).toHaveAttribute('data-state', /.+/);
  await expect(map.locator('path[data-item-id]')).toHaveCount(0);
});

test('an unknown country or region shows not found with a link back', async ({ page }) => {
  await page.goto('/progress/atlantis');
  await expect(page.getByText('There is nothing to show at this address.')).toBeVisible(WAIT);
  await page.getByRole('link', { name: 'Back to the world' }).click();
  await expect(page).toHaveURL(/\/progress$/);

  await page.goto('/progress/germany/france.paris');
  await expect(page.getByText('There is nothing to show at this address.')).toBeVisible(WAIT);
  await page.getByRole('link', { name: 'Back to the country' }).click();
  await expect(page).toHaveURL(/\/progress\/germany$/);
});

test('the drill-down pages do not scroll sideways', async ({ page }) => {
  for (const path of ['/progress/united-states', '/progress/united-states/united-states.texas']) {
    await page.goto(path);
    await expect(page.getByTestId('drill-map')).toBeVisible(WAIT);
    const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits, `${path} has no horizontal scroll`).toBe(true);
  }
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
