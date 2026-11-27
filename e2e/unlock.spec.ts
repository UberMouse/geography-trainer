import { GATE_WAVE1_MASTERED_COUNTRIES } from '../src/engine/config';
import { expect, test, type Page } from './test';
import { globeReady, hook, type LngLat } from './globeHook';
import {
  answer,
  current,
  importProgress,
  next,
  question,
  summary,
  tap,
  tapGlobe,
  WAIT,
  writeMasteredUnitedStates,
  writeMasteredUnitedStatesGateOpen,
  writeMasteredUnitedStatesNoNewCountry,
} from './sessionHelpers';

/** The progress colours (`PROGRESS_COLOURS` in `src/pages/progressView.ts`). */
const NEW = '#7d8fbf';
const MASTERED = '#4d8f63';
/** A place dot's colour when the place is not in the curriculum (`NEUTRAL_DOT`). */
const NEUTRAL_DOT = '#3b3a35';

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

// Sessions load the world's map data and draw maps: slow on a loaded machine.
test.describe.configure({ timeout: 240_000 });

test("[CUR-08] a mastered country's regions are asked in the next session", async ({ page, isMobile }, testInfo) => {
  const file = testInfo.outputPath('mastered-us.json');
  await writeMasteredUnitedStatesNoNewCountry(file);
  await importProgress(page, file);

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

  // The region is drawn on the globe from the country's region topology: highlighted at L1, its
  // country's region borders at L2.
  expect(region!.rung).toBeLessThanOrEqual(2);
  await expect
    .poll(() => hook.layerIds(page), WAIT)
    .toContain(region!.rung === 1 ? 'gt-highlight-fill' : 'gt-region-borders');
  await answer(page, isMobile, region!);
  await next(page);
  await expect(question(page).or(summary(page))).toBeVisible(WAIT);
  await expect(page.locator('[data-unsaved]')).toHaveAttribute('data-unsaved', '0', WAIT);
});

test('[SCR-09, SCR-10, SCR-12] the Progress page shows the mastered country and its map shape', async ({ page }, testInfo) => {
  const file = testInfo.outputPath('mastered-us.json');
  await writeMasteredUnitedStates(file);
  await importProgress(page, file);

  await page.getByRole('link', { name: 'See your progress' }).click();
  await expect(page.getByRole('heading', { name: 'Progress', level: 1 })).toBeVisible(WAIT);
  await expect(page.getByTestId('tier-country')).toContainText('1 learned', WAIT);

  const started = page.getByTestId('started-countries');
  await expect(started.getByRole('link', { name: 'United States' })).toBeVisible(WAIT);
  await expect(started).toContainText('United States: Mastered');

  // The globe fills each country by its state: the United States mastered (none of its regions
  // yet, so not deepened), Germany new, as it has no parent to lock it.
  const { fills } = await progressShowing(page, 'united-states');
  expect(fills['united-states']).toBe(MASTERED);
  expect(fills.germany).toBe(NEW);

  await started.getByRole('link', { name: 'United States' }).click();
  await expect(page).toHaveURL(/\/progress\/united-states$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('United States', WAIT);
});

for (const path of ['/', '/progress']) {
  test(`[SCR-06] tapping a country on the globe on ${path} goes to its page`, async ({ page, isMobile }) => {
    await page.goto(path);
    await progressShowing(page, 'germany');
    await tapGlobe(page, isMobile, GERMANY);
    await expect(page).toHaveURL(/\/progress\/germany$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Germany', WAIT);
  });
}

/** Two frames, so the globe has drawn its dots where the camera now is (taps are hit-tested on them). */
const twoFrames = (page: Page) =>
  page.evaluate(() => {
    const frame = (globalThis as unknown as { requestAnimationFrame(cb: () => void): void })
      .requestAnimationFrame;
    return new Promise<void>((done) => frame(() => frame(done)));
  });

// Bonaire, in open sea: 6 px off is on the dot as drawn; 11 px off is beside it, in no country.
for (const px of [6, 11]) {
  test(`[GLB-18, SCR-06] a tap ${px}px off a point-only country's dot, beside its few-km disc, goes to its page`, async ({
    page,
    isMobile,
  }) => {
    await page.goto('/progress');
    const { dots } = await progressShowing(page, 'germany');
    const dot = dots.find((d) => d.id === 'bonaire')!;
    // Zoomed out, the country's own disc is under a pixel across: the tap lands on the dot only.
    await hook.jumpTo(page, dot.at, 4);
    await twoFrames(page);
    const { x, y } = await hook.project(page, dot.at);
    await tap(page, isMobile, x + px, y);
    await expect(page).toHaveURL(new RegExp(`/progress/${dot.id}$`), WAIT);
  });
}

test("[GLB-18] a tap on Italy beside Vatican City's dot, at the world view, goes to Italy's page", async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  const { dots } = await progressShowing(page, 'italy');
  await globeReady(page);
  const vatican = dots.find((d) => d.id === 'vatican-city')!;
  const at = await hook.project(page, vatican.at);
  const px = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    Math.hypot(p.x - q.x, p.y - q.y);
  // Along an inland line from Rome to Basilicata, the first point 10 px from the dot: off the
  // dot as drawn (6 px), but within the 14 px slack a tap in no country gets.
  const [lng, lat] = vatican.at;
  const [toLng, toLat] = [16.3, 40.45];
  let aim: { x: number; y: number } | undefined;
  for (let t = 0.02; t <= 1 && !aim; t += 0.02) {
    const p = await hook.project(page, [lng + (toLng - lng) * t, lat + (toLat - lat) * t]);
    if (px(p, at) >= 10) aim = p;
  }
  expect(aim, 'a point 10 px from the dot').toBeDefined();
  expect(px(aim!, at)).toBeLessThan(14);
  for (const d of dots) expect(px(aim!, await hook.project(page, d.at))).toBeGreaterThan(8);
  await tap(page, isMobile, aim!.x, aim!.y);
  await expect(page).toHaveURL(/\/progress\/italy$/, WAIT);
});

test("[GLB-18] a tap where a dot on the far side projects to does not open the dot's country", async ({
  page,
  isMobile,
}) => {
  await page.goto('/');
  const { dots } = await progressShowing(page, 'germany');
  const dot = dots[0]!;
  // Zoomed out, centred 120° of longitude from the dot: the dot is on the hidden hemisphere, and
  // `project` still puts it inside the disc, mirrored onto the near side.
  const [lng, lat] = dot.at;
  await hook.jumpTo(page, [lng > 0 ? lng - 120 : lng + 120, lat], 0);
  await twoFrames(page);
  const { x, y } = await hook.project(page, dot.at);
  const slot = (await page.getByTestId('globe-slot').boundingBox())!;
  expect(x > slot.x && x < slot.x + slot.width && y > slot.y && y < slot.y + slot.height).toBe(true);
  await tap(page, isMobile, x, y);
  // Give a wrong selection time to navigate before checking it did not.
  await page.waitForTimeout(1_000);
  await expect(page).not.toHaveURL(new RegExp(`/progress/${dot.id}$`));
});

test('[SCR-11] a country can be opened from the Go to a country control using only the keyboard', async ({
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

test('[SCR-14] the United States page shows it mastered and its regions as new', async ({ page }, testInfo) => {
  const file = testInfo.outputPath('mastered-us.json');
  await writeMasteredUnitedStatesGateOpen(file);
  await importProgress(page, file);

  await page.goto('/progress/united-states');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('United States', WAIT);
  await expect(page.getByTestId('drill-state')).toHaveText('(Mastered)');
  const list = page.getByTestId('drill-list');
  const texas = list.locator('li[data-item-id="region:united-states.texas"]');
  await expect(texas).toHaveAttribute('data-state', 'new', WAIT);
  await expect(texas).toContainText('Texas: New');
  await expect(list.locator('li[data-state="new"]')).toHaveCount(await list.locator('li').count());
});

test("[SCR-14] a mastered country's regions wait for the gate", async ({ page }, testInfo) => {
  const file = testInfo.outputPath('mastered-us.json');
  await writeMasteredUnitedStates(file);
  await importProgress(page, file);

  await page.goto('/progress/united-states');
  await expect(page.getByTestId('drill-state')).toHaveText('(Mastered)', WAIT);
  const rows = page.getByTestId('drill-list').locator('li');
  await expect(rows.first()).toBeVisible(WAIT);
  for (const row of await rows.all()) {
    await expect(row).toHaveAttribute('data-state', 'locked');
    await expect(row).toContainText(
      `Opens once you've mastered ${GATE_WAVE1_MASTERED_COUNTRIES} countries (1 so far)`,
    );
  }
  // SCR-18: the gate also hides the test-out link.
  await expect(page.getByRole('link', { name: /Test out of/ })).toHaveCount(0);
});

test('[SCR-18] the mastered United States page links to test out of its regions', async ({ page }, testInfo) => {
  const file = testInfo.outputPath('mastered-us.json');
  await writeMasteredUnitedStatesGateOpen(file);
  await importProgress(page, file);

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

test('[SCR-14] a country whose parent is not mastered lists its regions as locked', async ({ page }) => {
  await page.goto('/progress/germany');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Germany', WAIT);
  const rows = page.getByTestId('drill-list').locator('li');
  await expect(rows.first()).toBeVisible(WAIT);
  for (const row of await rows.all()) {
    await expect(row).toHaveAttribute('data-state', 'locked');
    await expect(row).toContainText('Master Germany to unlock');
  }
});

test('[SCR-14, SCR-15, SCR-17] the drill-down goes from the world to a country to a region and back', async ({
  page,
  isMobile,
}) => {
  await page.goto('/progress');
  await progressShowing(page, 'germany');
  await tapGlobe(page, isMobile, GERMANY);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Germany', WAIT);

  // The globe shows Germany's regions: tapping one opens its page.
  await progressShowing(page, 'germany.bayern');
  await tapGlobe(page, isMobile, BAYERN);
  await expect(page).toHaveURL(/\/progress\/germany\/germany\.bayern$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Bayern', WAIT);
  const places = page.getByTestId('drill-list').locator('li');
  await expect(places.first()).toContainText('Master Bayern to unlock', WAIT);
  // Bayern alone, with its places as dots.
  const placeCount = await places.count();
  await expect
    .poll(async () => {
      const shown = await hook.progress(page);
      return shown && { fills: Object.keys(shown.fills), dots: shown.dots.length };
    }, WAIT)
    .toEqual({ fills: ['germany.bayern'], dots: placeCount });
  await expect.poll(() => hook.layerIds(page)).toContain('gt-progress-dots');

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

test('[SCR-15] a country without regions draws its places as dots', async ({ page }) => {
  await page.goto('/progress/singapore');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Singapore', WAIT);
  const expected = await page.getByTestId('drill-list').locator('li').count();
  expect(expected).toBeGreaterThan(0);
  await expect.poll(async () => (await hook.progress(page))?.dots.length, WAIT).toBe(expected);
});

test('[SCR-16] outlying regions and places are named under the map', async ({ page }) => {
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

test('[CUR-05, SCR-15] a country outline stays neutral when a place shares the country id', async ({ page }) => {
  await page.goto('/progress/cyprus');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Cyprus', WAIT);
  // The place Cyprus is a dot in its state's colour; the outline Cyprus is not filled.
  const { fills, dots } = await progressShowing(page, 'cyprus');
  expect(fills).toEqual({});
  const cyprus = dots.find((d) => d.id === 'cyprus');
  expect(cyprus?.colour).toBeDefined();
  expect(cyprus?.colour).not.toBe(NEUTRAL_DOT);
});

test('[SCR-13] an unknown country or region shows not found with a link back', async ({ page }) => {
  await page.goto('/progress/atlantis');
  await expect(page.getByText('There is nothing to show at this address.')).toBeVisible(WAIT);
  await page.getByRole('link', { name: 'Back to the world' }).click();
  await expect(page).toHaveURL(/\/progress$/);

  await page.goto('/progress/germany/france.paris');
  await expect(page.getByText('There is nothing to show at this address.')).toBeVisible(WAIT);
  await page.getByRole('link', { name: 'Back to the country' }).click();
  await expect(page).toHaveURL(/\/progress\/germany$/);
});

test('[SCR-26] the drill-down pages do not scroll sideways', async ({ page }) => {
  for (const path of ['/progress/united-states', '/progress/united-states/united-states.texas']) {
    await page.goto(path);
    await expect(page.getByTestId('drill-list')).toBeVisible(WAIT);
    const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits, `${path} has no horizontal scroll`).toBe(true);
  }
});

test("[SCR-06, SCR-08] Home's globe shows progress by country, and Home links to Progress", async ({ page }) => {
  await page.goto('/');
  const { fills } = await progressShowing(page, 'germany');
  expect(fills.germany).toBe(NEW);
  await expect.poll(() => hook.layerIds(page)).toContain('gt-progress-fill');
  await page.getByRole('link', { name: 'See your progress' }).click();
  await expect(page).toHaveURL(/\/progress$/);
});

test('[GLB-04, SCR-06] a world view whose globe shrinks mid-flight lands with the whole sphere in view', async ({
  page,
}) => {
  await page.goto('/');
  await progressShowing(page, 'germany');
  await globeReady(page);
  await hook.jumpTo(page, GERMANY, 5);
  // Progress flies to the world view on entry; the globe shrinks while it flies.
  await page.getByRole('link', { name: 'See your progress' }).click();
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.width, height: size.height - 200 });
  // Settled: the camera reads the same twice, 300 ms apart.
  const camera = () => Promise.all([hook.zoom(page), hook.center(page)]).then(String);
  await expect
    .poll(async () => {
      const before = await camera();
      await page.waitForTimeout(300);
      return before === (await camera());
    }, WAIT)
    .toBe(true);
  // At the fit (minZoom is the fit at the equator; MapLibre allows log2 cos lat below it).
  const lat = (await hook.center(page))[1];
  const fit = (await hook.minZoom(page)) + Math.log2(Math.cos((lat * Math.PI) / 180));
  expect(await hook.zoom(page)).toBeCloseTo(fit, 2);
});

test('[SCR-26] Home and Progress do not scroll sideways', async ({ page }) => {
  for (const path of ['/', '/progress']) {
    await page.goto(path);
    await progressShowing(page, 'germany');
    const fits = await page.locator('html').evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits, `${path} has no horizontal scroll`).toBe(true);
  }
});
