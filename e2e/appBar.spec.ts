import { writeMasteredTexas } from './placementHelpers';
import { importProgress } from './sessionHelpers';
import { appBar, expect, test, type Page } from './test';

const WAIT = { timeout: 30_000 };

const link = (page: Page, name: string) => appBar(page).getByRole('link', { name });

/** Which of the bar's links are marked as the current page. */
const currentLinks = async (page: Page) => {
  const current: (string | null)[] = [];
  for (const a of await appBar(page).getByRole('link').all()) {
    if ((await a.getAttribute('aria-current')) === 'page') current.push(await a.textContent());
  }
  return current;
};

test.describe('[GLB-36, GLB-C17] the app bar', () => {
  const pages: [string, string[]][] = [
    ['/', ['Geography Trainer']],
    ['/progress', ['Progress']],
    ['/progress/united-states', ['Progress']],
    ['/settings', ['Settings']],
    ['/credits', []],
    ['/session', []],
    ['/placement', []],
  ];
  for (const [path, current] of pages) {
    test(`${path} shows the bar with ${current[0] ?? 'no link'} current`, async ({ page }) => {
      await page.goto(path);
      await expect(link(page, 'Geography Trainer')).toHaveAttribute('href', '/');
      await expect(link(page, 'Progress')).toHaveAttribute('href', '/progress');
      await expect(link(page, 'Settings')).toHaveAttribute('href', '/settings');
      expect(await currentLinks(page)).toEqual(current);
    });
  }

  test('a failed load still shows the bar, and its links work', async ({ page }) => {
    await page.route('**/data/countries.topo.json', (route) => route.fulfill({ status: 500, body: '' }));
    for (const path of ['/progress', '/progress/united-states', '/session']) {
      await page.goto(path);
      await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible(WAIT);
      await expect(link(page, 'Settings')).toBeVisible();
    }
    await link(page, 'Settings').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  });

  test('the bar stays in view while the column scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 400 });
    await page.goto('/credits');
    const column = page.getByTestId('column');
    await expect(column).toBeVisible();
    await column.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await column.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const bar = (await appBar(page).boundingBox())!;
    const box = (await column.boundingBox())!;
    expect(bar.y).toBeCloseTo(box.y, 0);
  });

  test('at phone width the bar fits on one line, and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/', '/progress', '/settings']) {
      await page.goto(path);
      await expect(link(page, 'Settings')).toBeVisible();
      const tops: number[] = [];
      for (const a of await appBar(page).getByRole('link').all()) tops.push((await a.boundingBox())!.y);
      expect(Math.max(...tops) - Math.min(...tops), `${path} bar on one line`).toBeLessThan(2);
      const column = (await page.getByTestId('column').boundingBox())!;
      const last = (await link(page, 'Settings').boundingBox())!;
      expect(last.x + last.width).toBeLessThanOrEqual(column.x + column.width - 16 + 0.5);
      const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
      expect(fits, `${path} has no horizontal scroll`).toBe(true);
    }
  });
});

test.describe('[GLB-37] a new page starts at its top, with focus on it', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 400 });
  });

  test("following a bar link from a scrolled column shows the new page's top with focus on its heading", async ({
    page,
  }) => {
    await page.goto('/credits');
    const column = page.getByTestId('column');
    await expect(column).toBeVisible();
    await column.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await column.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await link(page, 'Settings').click();
    const heading = page.getByRole('heading', { level: 1, name: 'Settings' });
    await expect(heading).toBeFocused();
    expect(await column.evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('a page with no heading gets focus on the column instead', async ({ page }) => {
    await page.goto('/');
    const start = page.getByRole('link', { name: /^Start/ });
    await expect(start).toBeVisible(WAIT);
    // Stalling the map data from here keeps the session page on its loading state, which has no heading.
    await page.route('**/data/countries.topo.json', () => {});
    const column = page.getByTestId('column');
    await column.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    expect(await column.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await start.click();
    await expect(page).toHaveURL(/\/session$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(0);
    await expect(column).toBeFocused();
    expect(await column.evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('the bar link to the page already shown moves nothing', async ({ page }) => {
    await page.goto('/settings');
    const input = page.getByLabel('New items per day');
    await expect(input).toHaveValue('15', WAIT);
    await input.fill('7');
    const column = page.getByTestId('column');
    expect(await column.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await column.evaluate((el) => {
      el.scrollTop = 40;
    });
    // The router keeps a key for each navigation in the history state, a replace one included.
    const historyState = () => page.locator('html').evaluate((el) => JSON.stringify(el.ownerDocument.defaultView?.history.state));
    const before = await historyState();
    await link(page, 'Settings').click();
    expect(await historyState()).toBe(before);
    await expect(input).toHaveValue('7');
    expect(await column.evaluate((el) => el.scrollTop)).toBe(40);
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).not.toBeFocused();
  });

  test('opening the app does not move focus', async ({ page }) => {
    await page.goto('/progress');
    await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).not.toBeFocused();
    await expect(page.getByTestId('column')).not.toBeFocused();
  });
});

test.describe('[GLB-38, GLB-C18] the tab title names the page', () => {
  const titles: [string, string][] = [
    ['/', 'Geography Trainer'],
    ['/progress', 'Progress · Geography Trainer'],
    ['/settings', 'Settings · Geography Trainer'],
    ['/credits', 'Credits · Geography Trainer'],
    ['/session', 'Study · Geography Trainer'],
    ['/placement', 'Placement test · Geography Trainer'],
    ['/placement/united-states', 'Test out · Geography Trainer'],
    ['/progress/united-states', 'United States · Geography Trainer'],
    ['/progress/no-such-country', 'Not found · Geography Trainer'],
  ];
  for (const [path, title] of titles) {
    test(`${path} is titled ${title}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(title, WAIT);
    });
  }

  test('a drill-down is titled Progress after its load fails', async ({ page }) => {
    await page.route('**/data/countries.topo.json', (route) => route.fulfill({ status: 500, body: '' }));
    await page.goto('/progress/united-states');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible(WAIT);
    await expect(page).toHaveTitle('Progress · Geography Trainer');
  });

  test('a test-out is titled with its heading, and Test out after its load fails', async ({ page }, testInfo) => {
    const file = testInfo.outputPath('mastered-texas.json');
    await writeMasteredTexas(file);
    await importProgress(page, file);
    await page.goto('/placement/united-states/united-states.texas');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText("Test out of Texas's places", WAIT);
    await expect(page).toHaveTitle("Test out of Texas's places · Geography Trainer");

    await page.route('**/data/countries.topo.json', (route) => route.fulfill({ status: 500, body: '' }));
    await page.goto('/placement/united-states/united-states.texas');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible(WAIT);
    await expect(page).toHaveTitle('Test out · Geography Trainer');
  });

  test('following a link to another page changes the title', async ({ page }) => {
    await page.goto('/');
    await link(page, 'Settings').click();
    await expect(page).toHaveTitle('Settings · Geography Trainer');
    await link(page, 'Geography Trainer').click();
    await expect(page).toHaveTitle('Geography Trainer');
  });
});
