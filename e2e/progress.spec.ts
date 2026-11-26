import { hook, type LngLat } from './globeHook';
import { tapGlobe, WAIT } from './sessionHelpers';
import { expect, test, type Page } from './test';

// The Progress pages load the world's map data and draw on the globe: slow on a loaded machine.
test.describe.configure({ timeout: 120_000 });

/** The locked colour (`PROGRESS_COLOURS.locked` in `src/pages/progressView.ts`). */
const LOCKED = '#404040';

const GERMANY: LngLat = [10.4, 51.1];
const BAYERN: LngLat = [11.4, 48.9];

/** The globe's progress mode once it fills or dots `id`: the page showing it has mounted. */
async function progressShowing(page: Page, id: string) {
  const shows = async () => {
    const shown = await hook.progress(page);
    return !!shown && (id in shown.fills || shown.dots.some((d) => d.id === id));
  };
  await expect.poll(shows, WAIT).toBe(true);
  return (await hook.progress(page))!;
}

test('[SCR-07, SCR-09, SCR-11, SCR-12] a fresh Progress page: counts, legend, the country picker, nothing started', async ({
  page,
}) => {
  await page.goto('/progress');
  for (const tier of ['country', 'region', 'place']) {
    await expect(page.getByTestId(`tier-${tier}`)).toContainText('0 learned', WAIT);
  }

  // Progress's legend has the locked state too.
  const legend = page.getByRole('list', { name: 'Legend' }).getByRole('listitem');
  await expect(legend).toHaveCount(5);
  await expect(legend.first()).toHaveText('Locked');

  // Nothing started: the page says so and links to a session.
  await expect(page.getByTestId('started-countries')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('link', { name: 'Start', exact: true })).toHaveAttribute(
    'href',
    '/session',
  );

  const go = page.getByRole('button', { name: 'Go' });
  await expect(go).toBeDisabled();
  await page.getByLabel('Go to a country').selectOption({ label: 'Germany' });
  await expect(go).toBeEnabled();
  await go.click();
  await expect(page).toHaveURL(/\/progress\/germany$/);
});

test('[SCR-06, SCR-15, SCR-17] a tap on Home opens a country, a tap there its region, and a region page takes no tap', async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  await progressShowing(page, 'germany');
  await tapGlobe(page, isMobile, GERMANY);
  await expect(page).toHaveURL(/\/progress\/germany$/);

  // Germany's regions, each filled: locked, as Germany is not mastered.
  const { fills } = await progressShowing(page, 'germany.bayern');
  expect(fills['germany.bayern']).toBe(LOCKED);
  await tapGlobe(page, isMobile, BAYERN);
  await expect(page).toHaveURL(/\/progress\/germany\/germany\.bayern$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bayern', WAIT);

  // Bayern alone. A tap on it opens nothing.
  await expect
    .poll(async () => Object.keys((await hook.progress(page))?.fills ?? {}), WAIT)
    .toEqual(['germany.bayern']);
  await tapGlobe(page, isMobile, BAYERN);
  // Give a wrong selection time to navigate before checking it did not.
  await page.waitForTimeout(1_000);
  await expect(page).toHaveURL(/\/progress\/germany\/germany\.bayern$/);
});
