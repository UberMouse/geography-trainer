import { globeHooked, hook, viewport, type LngLat } from './globeHook';
import { antipode, tap, tapGlobe } from './sessionHelpers';
import { expect, test, type Locator, type Page } from './test';

// Each test loads the world's map data and draws on the globe: slow on a loaded machine.
test.describe.configure({ timeout: 90_000 });

/** Open one exercise in the playground and wait until its item is built and the globe is up. */
async function openExercise(page: Page, query: string) {
  await page.goto(`/playground?${query}`);
  await expect(page.getByTestId('item-id')).toBeVisible({ timeout: 30_000 });
  await globeHooked(page);
}

const options = (page: Page) => page.getByRole('group', { name: 'Options' }).getByRole('button');
const option = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Options' }).getByRole('button', { name, exact: true });
const verdict = (page: Page) => page.getByRole('status');
const confirm = (page: Page) => page.getByRole('button', { name: 'Confirm' });
const mode = (page: Page) => page.locator('[data-mode]');

/** The item's answer point, as the playground shows it. */
async function itemAnswer(page: Page): Promise<LngLat> {
  const [lng, lat] = (await page.getByTestId('item-answer').innerText()).split(',').map(Number);
  return [lng!, lat!];
}

/** The camera once it has stopped moving: the same centre and zoom twice, 300 ms apart. */
async function settled(page: Page) {
  const read = async () => ({ center: await hook.center(page), zoom: await hook.zoom(page) });
  let last = await read();
  await expect
    .poll(
      async () => {
        const before = last;
        last = await read();
        return JSON.stringify(last) === JSON.stringify(before);
      },
      { intervals: [300], timeout: 30_000 },
    )
    .toBe(true);
  return last;
}

const near = (a: LngLat, b: LngLat, degrees: number) =>
  Math.abs(a[0] - b[0]) <= degrees && Math.abs(a[1] - b[1]) <= degrees;

/** The great-circle angle between two points, in degrees. */
function arcDegrees([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const rad = Math.PI / 180;
  const cos =
    Math.sin(lat1 * rad) * Math.sin(lat2 * rad) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.cos((lng2 - lng1) * rad);
  return Math.acos(Math.min(1, Math.max(-1, cos))) / rad;
}

/** The point halfway along the great circle between two points (not antipodes). */
function arcMidpoint(a: LngLat, b: LngLat): LngLat {
  const rad = Math.PI / 180;
  const vector = ([lng, lat]: LngLat) => [
    Math.cos(lat * rad) * Math.cos(lng * rad),
    Math.cos(lat * rad) * Math.sin(lng * rad),
    Math.sin(lat * rad),
  ];
  const [x, y, z] = vector(a).map((v, i) => v + vector(b)[i]!) as [number, number, number];
  return [Math.atan2(y, x) / rad, Math.atan2(z, Math.hypot(x, y)) / rad];
}

test.describe('L1 highlighted → name', () => {
  test('[EXR-01, EXR-06, EXR-08, EXR-15, EXR-16] choosing the item is correct, and the globe then names it without moving', async ({
    page,
  }) => {
    await openExercise(page, 'item=country:france&rung=1');
    await expect(page.getByText('Which country is highlighted?')).toBeVisible();
    await expect(mode(page)).toHaveAttribute('data-mode', 'highlight');
    await expect(options(page)).toHaveCount(4);
    // The one status region is there, empty, before the answer, so the verdict is announced.
    await expect(verdict(page)).toHaveCount(1);
    await expect(verdict(page)).toBeEmpty();
    // The camera fits France.
    const before = await settled(page);
    expect(near(before.center, await itemAnswer(page), 5)).toBe(true);
    expect(await hook.markers(page)).toEqual([]);

    await option(page, 'France').click();
    await expect(verdict(page)).toHaveText(/^Correct/);
    await expect(option(page, 'France')).toHaveAttribute('data-mark', 'correct');
    await expect(page.getByTestId('last-correct')).toHaveText('true');
    await expect
      .poll(() => hook.markers(page))
      .toEqual([expect.objectContaining({ kind: 'name', text: 'France' })]);
    await expect.poll(() => hook.layerIds(page)).toContain('gt-reveal-target-line');
    expect(await hook.layerIds(page)).toContain('gt-highlight-fill');
    expect(await hook.layerIds(page)).not.toContain('gt-reveal-path');
    expect(await settled(page)).toEqual(before);
  });

  test('[EXR-06, EXR-13] choosing another option is incorrect and marks the item', async ({ page }) => {
    await openExercise(page, 'item=country:france&rung=1');
    const wrong: Locator = options(page)
      .filter({ hasNotText: /^France$/ })
      .first();
    await wrong.click();
    await expect(verdict(page)).toHaveText(/^Incorrect · it is France/);
    await expect(wrong).toHaveAttribute('data-mark', 'wrong');
    await expect(option(page, 'France')).toHaveAttribute('data-mark', 'correct');
    await expect(page.getByTestId('last-rating')).toHaveText('Again');
    await expect(page.getByTestId('last-km')).toHaveText('–');
  });

  test('[EXR-06, EXR-C07] a click after the answer changes nothing', async ({ page }) => {
    await openExercise(page, 'item=country:france&rung=1');
    await option(page, 'France').click();
    await expect(verdict(page)).toHaveText(/^Correct/);
    const wrong = options(page)
      .filter({ hasNotText: /^France$/ })
      .first();
    await expect(wrong).toHaveAttribute('aria-disabled', 'true');
    // Playwright will not click an aria-disabled button; force it, as a user still can.
    await wrong.click({ force: true });
    await expect(verdict(page)).toHaveText(/^Correct/);
    await expect(wrong).not.toHaveAttribute('data-mark');
    await expect(page.getByTestId('last-correct')).toHaveText('true');
  });

  test('[EXR-17, EXR-C07] Next starts a fresh question, without the last one’s name on the globe', async ({
    page,
  }) => {
    await openExercise(page, 'item=country:france&rung=1');
    await option(page, 'France').click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByTestId('item-id')).not.toHaveText('country:france');
    await expect(verdict(page)).toBeEmpty();
    await expect(page.locator('[data-mark]')).toHaveCount(0);
    await expect(page.locator('[aria-disabled]')).toHaveCount(0);
    await expect(options(page)).toHaveCount(4);
    await expect.poll(() => hook.markers(page)).toEqual([]);
    expect((await hook.layerIds(page)).filter((id) => id.startsWith('gt-reveal'))).toEqual([]);
  });

  test('[EXR-03, EXR-09] a place: the camera flies to its neighbourhood', async ({ page }) => {
    await openExercise(page, 'item=place:honolulu_hawaii&rung=1');
    await expect(page.getByText('Which place is marked?')).toBeVisible();
    await expect.poll(() => hook.layerIds(page)).toContain('gt-highlight-dot');
    const view = await settled(page);
    expect(near(view.center, await itemAnswer(page), 0.5)).toBe(true);
    expect(view.zoom).toBeGreaterThan(4);
  });

  for (const item of ['country:saba', 'country:vatican-city', 'place:the_bottom_netherlands']) {
    test(`[EXR-09] a point-only item (${item}): the camera flies to its neighbourhood`, async ({ page }) => {
      await openExercise(page, `item=${item}&rung=1`);
      await expect(options(page).first()).toBeVisible();
      const view = await settled(page);
      expect(near(view.center, await itemAnswer(page), 0.5)).toBe(true);
      expect(view.zoom).toBeGreaterThan(4);
    });
  }
});

test.describe('L2 and L3 name → tap', () => {
  test('[EXR-01, EXR-07, EXR-14, EXR-15] L3: a tap on the answer point, confirmed, is correct with maptap 100', async ({
    page,
    isMobile,
  }) => {
    await openExercise(page, 'item=country:france&rung=3');
    await expect(mode(page)).toHaveAttribute('data-mode', 'bare');
    await expect(confirm(page)).toBeDisabled();
    const answer = await itemAnswer(page);
    await tapGlobe(page, isMobile, answer);
    await expect(confirm(page)).toBeEnabled();
    await confirm(page).click();
    await expect(verdict(page)).toHaveText(/^Correct/);
    await expect(page.getByTestId('reveal-km')).toHaveText('inside the border');
    await expect(page.getByTestId('reveal-score')).toHaveText('100');
    await expect(page.getByTestId('last-score')).toHaveText('100');
    // The reveal: the tap and answer pins, the target's name, and the outline and path.
    await expect
      .poll(async () => (await hook.markers(page)).map((m) => `${m.kind}:${m.text}`).sort())
      .toEqual(['name:France', 'reveal:', 'reveal:']);
    expect(await hook.layerIds(page)).toEqual(
      expect.arrayContaining(['gt-reveal-target-line', 'gt-reveal-path']),
    );
  });

  test('[EXR-01, EXR-13, EXR-16] L2: a far tap on the bordered globe, confirmed, is incorrect; the reveal shows the whole globe on the answer', async ({
    page,
    isMobile,
  }) => {
    await openExercise(page, 'item=country:france&rung=2');
    await expect(mode(page)).toHaveAttribute('data-mode', 'countryBorders');
    const far: LngLat = [-150, -40];
    await tapGlobe(page, isMobile, far);
    await confirm(page).click();
    await expect(verdict(page)).toHaveText(/^Incorrect · it is /);
    await expect(page.getByTestId('last-correct')).toHaveText('false');
    const score = Number(await page.getByTestId('reveal-score').textContent());
    expect(score).toBeLessThan(50);
    // Nearly opposite France: both cannot sit on the near side, so the whole globe, on the answer.
    const view = await settled(page);
    expect(near(view.center, await itemAnswer(page), 1)).toBe(true);
    expect(view.zoom).toBeLessThan(2);
  });

  test('[EXR-16] L2: a miss a few thousand km off frames the tap and the whole country together', async ({
    page,
    isMobile,
  }) => {
    await openExercise(page, 'item=country:france&rung=2');
    const moscow: LngLat = [37.6, 55.75];
    await tapGlobe(page, isMobile, moscow);
    await confirm(page).click();
    await expect(verdict(page)).toHaveText(/^Incorrect · it is /);
    // The camera ends between the tap and France, with both on screen.
    const view = await settled(page);
    expect(near(view.center, moscow, 10)).toBe(false);
    expect(near(view.center, await itemAnswer(page), 10)).toBe(false);
    const slot = (await page.getByTestId('globe-slot').boundingBox())!;
    for (const at of [moscow, await itemAnswer(page)]) {
      const { x, y } = await hook.project(page, at);
      expect(x).toBeGreaterThan(slot.x);
      expect(x).toBeLessThan(slot.x + slot.width);
      expect(y).toBeGreaterThan(slot.y);
      expect(y).toBeLessThan(slot.y + slot.height);
    }
  });

  test('[EXR-07, EXR-C07] a tap after the answer changes nothing', async ({ page, isMobile }) => {
    await openExercise(page, 'item=country:france&rung=2');
    await tapGlobe(page, isMobile, [-150, -40]);
    await confirm(page).click();
    await expect(verdict(page)).toHaveText(/^Incorrect/);
    const km = await page.getByTestId('last-km').textContent();
    await tapGlobe(page, isMobile, await itemAnswer(page));
    await expect(confirm(page)).toBeDisabled();
    await expect(page.getByTestId('last-km')).toHaveText(km!);
    await expect(verdict(page)).toHaveText(/^Incorrect/);
    expect((await hook.markers(page)).filter((m) => m.kind === 'pin')).toEqual([]);
  });

  test('[EXR-07] a tap moves the pin, even one that lands on the pin itself', async ({ page, isMobile }) => {
    await openExercise(page, 'item=country:france&rung=3');
    const pins = async () => (await hook.markers(page)).filter((m) => m.kind === 'pin');
    await tapGlobe(page, isMobile, [10, 50]);
    await expect.poll(pins).toHaveLength(1);
    const first = (await pins())[0]!.lngLat;
    // The pin's head stands about 25 px above its point.
    const at = await hook.project(page, first);
    await tap(page, isMobile, at.x, at.y - 25);
    await expect.poll(async () => (await pins())[0]!.lngLat).not.toEqual(first);
    expect(await pins()).toHaveLength(1);
  });

  test('[EXR-17, EXR-C07] Next starts a fresh question with no pin', async ({ page, isMobile }) => {
    await openExercise(page, 'item=country:france&rung=3');
    await tapGlobe(page, isMobile, [-150, -40]);
    await confirm(page).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByTestId('item-id')).not.toHaveText('country:france');
    await expect(verdict(page)).toBeEmpty();
    await expect(confirm(page)).toBeDisabled();
    await expect.poll(() => hook.markers(page)).toEqual([]);
  });

  test('[EXR-02, EXR-09] L2 region: the camera fits its country, whose region borders show', async ({ page }) => {
    await openExercise(page, 'item=region:france.bretagne&rung=2');
    await expect(mode(page)).toHaveAttribute('data-mode', 'regionBorders');
    await expect.poll(() => hook.layerIds(page)).toContain('gt-region-borders');
    const view = await settled(page);
    // France's main part spans about 5°W–8°E, 42–51°N.
    expect(near(view.center, [2, 46.5], 3)).toBe(true);
  });

  // Each with about where its country's main part centres: the contiguous US, mainland France.
  const outlying: [string, LngLat][] = [
    ['region:united-states.hawaii', [-98, 39]],
    ['place:honolulu_hawaii', [-98, 39]],
    ['region:france.reunion', [2.5, 46.5]],
    ['place:saint_denis_reunion', [2.5, 46.5]],
  ];
  for (const [item, mainland] of outlying) {
    test(`[EXR-09, EXR-12] L2 outside its country’s main part (${item}): the whole world, with it in view`, async ({
      page,
    }) => {
      await openExercise(page, `item=${item}&rung=2`);
      await expect(mode(page)).toHaveAttribute('data-mode', 'regionBorders');
      const view = await settled(page);
      const answer = await itemAnswer(page);
      // The whole sphere, as the opening view zooms (`worldView`), centred halfway between the
      // main part and the answer.
      expect(near(view.center, arcMidpoint(mainland, answer), 3)).toBe(true);
      const worldZoom =
        (await hook.minZoom(page)) + Math.log2(Math.cos((view.center[1] * Math.PI) / 180));
      expect(view.zoom).toBeCloseTo(worldZoom, 1);
      // Well on the near side of the globe (`project` does not cull the far side), and in the slot.
      expect(arcDegrees(view.center, answer)).toBeLessThan(80);
      const at = await hook.project(page, answer);
      const slot = await page.getByTestId('globe-slot').boundingBox();
      expect(slot).not.toBeNull();
      expect(at.x).toBeGreaterThanOrEqual(slot!.x);
      expect(at.x).toBeLessThanOrEqual(slot!.x + slot!.width);
      expect(at.y).toBeGreaterThanOrEqual(slot!.y);
      expect(at.y).toBeLessThanOrEqual(slot!.y + slot!.height);
    });
  }

  test('[EXR-09] L2 country: the camera goes to the whole world', async ({ page }) => {
    await openExercise(page, 'item=region:france.bretagne&rung=1');
    await settled(page);
    await page.getByRole('combobox', { name: 'Tier' }).selectOption('country');
    await page.getByRole('combobox', { name: 'Rung' }).selectOption('2');
    await expect(mode(page)).toHaveAttribute('data-mode', 'countryBorders');
    const view = await settled(page);
    expect(near(view.center, [0, 20], 0.5)).toBe(true);
  });

  test('[EXR-11] Next during the reveal’s flight starts the next question’s own camera move', async ({
    page,
    isMobile,
  }) => {
    await openExercise(page, 'item=country:france&rung=2');
    await tapGlobe(page, isMobile, antipode(await itemAnswer(page)));
    await confirm(page).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByTestId('item-id')).not.toHaveText('country:france');
    // The next country question's whole-world view, not where the reveal was flying.
    const view = await settled(page);
    expect(near(view.center, [0, 20], 0.5)).toBe(true);
  });

  test('[EXR-10] L3: the camera stays where the last question left it', async ({ page }) => {
    await openExercise(page, 'item=region:france.bretagne&rung=1');
    const before = await settled(page);
    await page.getByRole('combobox', { name: 'Rung' }).selectOption('3');
    await expect(mode(page)).toHaveAttribute('data-mode', 'bare');
    expect(await settled(page)).toEqual(before);
  });
});

test.describe('phone width', () => {
  for (const rung of [1, 2, 3]) {
    test(`[EXR-23] L${rung}: no horizontal scroll for a country, a region and a place`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      for (const item of ['country:france', 'region:france.bretagne', 'place:honolulu_hawaii']) {
        await openExercise(page, `item=${item}&rung=${rung}`);
        await expect(
          rung === 1 ? options(page).first() : page.getByRole('button', { name: 'Confirm' }),
        ).toBeVisible();
        const vp = await viewport(page);
        expect(vp.scrollWidth, item).toBeLessThanOrEqual(vp.width);
      }
    });
  }
});
