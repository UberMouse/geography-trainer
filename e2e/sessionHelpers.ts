import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { GATE_WAVE1_MASTERED_COUNTRIES, MC_FAST_MS } from '../src/engine/config';
import { globeHooked, hook, type LngLat } from './globeHook';
import { appBar, expect, type Page } from './test';

// Shared by the Session and Home specs: answering questions the way a learner would.

export const WAIT = { timeout: 30_000 };

export const question = (page: Page, testId = 'session-question') => page.getByTestId(testId);
export const summary = (page: Page) => page.getByRole('heading', { name: /^Round done:/ });

export async function tap(page: Page, isMobile: boolean, x: number, y: number) {
  if (isMobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

export interface Question {
  itemId: string;
  name: string;
  rung: number;
  /** The target's answer point (a place's point), from the dev build's `data-answer`. */
  answer: LngLat;
}

/** What the current question is, once it has rendered. */
export async function current(page: Page, testId = 'session-question'): Promise<Question> {
  const el = question(page, testId);
  await expect(el).toBeVisible(WAIT);
  const [lng, lat] = (await el.getAttribute('data-answer'))!.split(',').map(Number);
  return {
    itemId: (await el.getAttribute('data-item-id'))!,
    name: (await el.getAttribute('data-item-name'))!,
    rung: Number(await el.getAttribute('data-rung')),
    answer: [lng!, lat!],
  };
}

/** The zoom a tap is aimed at: about a km a pixel, so a tap lands inside a small target. */
const AIM_ZOOM = 6;

/**
 * Taps `at` on the app's globe, aimed with the test hook: the camera first jumps there (stopping
 * any flight), so the point faces the viewer, then the tap lands where the hook projects it.
 */
export async function tapGlobe(page: Page, isMobile: boolean, at: LngLat) {
  await globeHooked(page);
  await hook.jumpTo(page, at, AIM_ZOOM);
  const { x, y } = await hook.project(page, at);
  await tap(page, isMobile, x, y);
}

/** The point opposite `at` on the Earth: as far off as a tap can be. */
export const antipode = ([lng, lat]: LngLat): LngLat => [lng > 0 ? lng - 180 : lng + 180, -lat];

/**
 * Answers the current question correctly: the named option for the choice question (L1), a tap
 * on the answer point plus Confirm (L2, L3), or with `miss` a tap at its antipode. Then waits for
 * the reveal. With `slow`, an L1 answer waits out MC_FAST_MS first, so it is Good and climbs one
 * rung (a faster one is Easy and skips to L3).
 */
export async function answer(page: Page, isMobile: boolean, q: Question, { miss = false, slow = false } = {}) {
  if (q.rung === 1) {
    // A learner thinking it over: deliberate time, not a wait for the app.
    if (slow) await page.waitForTimeout(MC_FAST_MS + 250);
    await page
      .getByRole('group', { name: 'Options' })
      .getByRole('button', { name: q.name, exact: true })
      .click();
  } else {
    await tapGlobe(page, isMobile, miss ? antipode(q.answer) : q.answer);
    await page.getByRole('button', { name: 'Confirm' }).click();
  }
  await expect(page.getByRole('status')).toContainText(/Correct|Incorrect/);
}

export const next = (page: Page) => page.getByRole('button', { name: 'Next' }).click();

/** Imports the progress file at `path` from Settings, replacing what is there, then goes Home. */
export async function importProgress(page: Page, path: string) {
  await page.goto('/settings');
  await expect(page.getByLabel('New items per day')).toBeVisible(WAIT);
  await page.getByLabel('Import progress').setInputFiles(path);
  await page.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByRole('status')).toHaveText('Progress imported.', WAIT);
  await appBar(page).getByRole('link', { name: 'Geography Trainer' }).click();
  await expect(page.getByTestId('today-new')).toBeVisible(WAIT);
}

const DAY = 24 * 60 * 60 * 1000;

/** A progress row at `rung` with one card, last reviewed 5 days ago and due `dueInDays` from now. */
export function progressRow(
  itemId: string,
  rung: number,
  {
    dueInDays,
    l3PassDays = [],
    introducedAt,
  }: { dueInDays: number; l3PassDays?: string[]; introducedAt: number | null },
) {
  const now = Date.now();
  const card = {
    due: now + dueInDays * DAY,
    stability: 30,
    difficulty: 5,
    scheduled_days: 30,
    learning_steps: 0,
    reps: 4,
    lapses: 0,
    state: 2,
    last_review: now - 5 * DAY,
  };
  return {
    itemId,
    rung,
    highestRung: rung,
    cards: { [rung]: card },
    l3PassDays,
    inL3Lapse: false,
    introducedAt,
  };
}

/** A progress file in the export format Settings imports, holding `progress` and nothing else. */
export async function writeProgressFile(path: string, progress: ReturnType<typeof progressRow>[]) {
  const file = {
    format: 'geography-trainer-progress',
    version: 3,
    exportedAt: new Date().toISOString(),
    progress,
    answers: [],
    placementsDone: [],
  };
  await writeFile(path, JSON.stringify(file));
}

/** A mastered row: L3 passed on two different days, introduced long ago, next due in 30 days. */
const masteredRow = (itemId: string) =>
  progressRow(itemId, 3, {
    dueInDays: 30,
    l3PassDays: ['2026-01-10', '2026-01-20'],
    introducedAt: Date.now() - 60 * DAY,
  });

/** The committed countries' ids, fewest places first (ties by id). */
const COUNTRIES_BY_PLACES: string[] = (
  JSON.parse(readFileSync(new URL('../public/data/countries.topo.json', import.meta.url), 'utf8')) as {
    objects: { countries: { geometries: { id: string; properties: { places: number } }[] } };
  }
).objects.countries.geometries
  .map((g) => ({ id: g.id, places: g.properties.places }))
  .sort((a, b) => a.places - b.places || (a.id < b.id ? -1 : 1))
  .map((c) => c.id);

/**
 * Mastered rows, not due, for the `n` countries with the fewest places (none of them the United
 * States). They have far fewer than GATE_WAVE1_MIN_PLACES places, so their own gate (CUR-21)
 * stays shut, and with the United States mastered too, `n` of GATE_WAVE1_MASTERED_COUNTRIES - 1
 * or more opens the United States'.
 */
function gateOpeningRows(n: number) {
  return COUNTRIES_BY_PLACES.filter((id) => id !== 'united-states')
    .slice(0, n)
    .map((id) => masteredRow(`country:${id}`));
}

/** A progress file in which `country:united-states` is mastered (L3 passed on two different days):
 * the only mastered country, so its regions wait for the gate (CUR-21). */
export async function writeMasteredUnitedStates(path: string) {
  await writeProgressFile(path, [masteredRow('country:united-states')]);
}

/** `writeMasteredUnitedStates` with GATE_WAVE1_MASTERED_COUNTRIES countries mastered in all, so
 * the United States' gate (CUR-21) is open. */
export async function writeMasteredUnitedStatesGateOpen(path: string) {
  await writeProgressFile(path, [
    masteredRow('country:united-states'),
    ...gateOpeningRows(GATE_WAVE1_MASTERED_COUNTRIES - 1),
  ]);
}

/**
 * A progress file with the United States' gate open (as `writeMasteredUnitedStatesGateOpen`) and
 * every other country introduced long ago and not due: no new country is left, so the new items
 * are the United States' regions.
 */
export async function writeMasteredUnitedStatesNoNewCountry(path: string) {
  const mastered = [masteredRow('country:united-states'), ...gateOpeningRows(GATE_WAVE1_MASTERED_COUNTRIES - 1)];
  const done = new Set(mastered.map((r) => r.itemId));
  const introduced = COUNTRIES_BY_PLACES.map((id) => `country:${id}`)
    .filter((itemId) => !done.has(itemId))
    .map((itemId) => progressRow(itemId, 1, { dueInDays: 30, introducedAt: Date.now() - 60 * DAY }));
  await writeProgressFile(path, [...mastered, ...introduced]);
}

/** Countries introduced today in `writeUnitedStatesOnePassFromMastery`, so no new item is due. */
const INTRODUCED_TODAY = [
  'germany',
  'france',
  'spain',
  'italy',
  'japan',
  'china',
  'india',
  'brazil',
  'canada',
  'mexico',
  'australia',
  'egypt',
  'kenya',
  'peru',
  'chile',
];

/**
 * A progress file whose session is one question: `country:united-states` due at L3, one pass on
 * another day from mastery. Today's 15 new items are used up by countries that are not yet due.
 * GATE_WAVE1_MASTERED_COUNTRIES other countries are mastered and not due, so the United States'
 * gate (CUR-21) is already open when it is mastered.
 */
export async function writeUnitedStatesOnePassFromMastery(path: string) {
  await writeProgressFile(path, [
    progressRow('country:united-states', 3, {
      dueInDays: -1,
      l3PassDays: ['2026-01-10'],
      introducedAt: Date.now() - 60 * DAY,
    }),
    ...gateOpeningRows(GATE_WAVE1_MASTERED_COUNTRIES),
    ...INTRODUCED_TODAY.map((id) =>
      progressRow(`country:${id}`, 1, { dueInDays: 30, introducedAt: Date.now() }),
    ),
  ]);
}

/**
 * A progress file whose session is two questions: `region:united-states.texas` due at L3, one pass
 * from mastery, then `country:argentina` due at L3 (a country elsewhere). The United States is
 * mastered with its gate (CUR-21) shut, so of its regions only Texas, already answered, is
 * unlocked (CUR-22). Today's 15 new items are used up by other countries.
 */
export async function writeTexasOnePassFromMastery(path: string) {
  await writeProgressFile(path, [
    progressRow('country:united-states', 3, {
      dueInDays: 30,
      l3PassDays: ['2026-01-10', '2026-01-20'],
      introducedAt: Date.now() - 60 * DAY,
    }),
    progressRow('region:united-states.texas', 3, {
      dueInDays: -2,
      l3PassDays: ['2026-01-10'],
      introducedAt: Date.now() - 60 * DAY,
    }),
    progressRow('country:argentina', 3, {
      dueInDays: -1,
      l3PassDays: ['2026-01-10'],
      introducedAt: Date.now() - 60 * DAY,
    }),
    ...INTRODUCED_TODAY.map((id) =>
      progressRow(`country:${id}`, 1, { dueInDays: 30, introducedAt: Date.now() }),
    ),
  ]);
}

/**
 * A progress file whose session is two questions, both due at L3 and one pass from mastery:
 * `country:united-states`, due 2 days ago so asked first, then `secondId`, the country with the
 * (GATE_WAVE1_MASTERED_COUNTRIES - 1)th fewest places, due 1 day ago.
 * GATE_WAVE1_MASTERED_COUNTRIES - 2 other countries are mastered and not due, so the United
 * States' gate (CUR-21) is still shut when it is mastered and opens with the second answer.
 * Today's 15 new items are used up by countries that are not yet due.
 */
export async function writeUnitedStatesThenGateOpener(path: string): Promise<{ secondId: string }> {
  const onePass = (itemId: string, dueInDays: number) =>
    progressRow(itemId, 3, { dueInDays, l3PassDays: ['2026-01-10'], introducedAt: Date.now() - 60 * DAY });
  const rows = gateOpeningRows(GATE_WAVE1_MASTERED_COUNTRIES - 1);
  const secondId = rows.pop()!.itemId;
  await writeProgressFile(path, [
    onePass('country:united-states', -2),
    onePass(secondId, -1),
    ...rows,
    ...INTRODUCED_TODAY.map((id) =>
      progressRow(`country:${id}`, 1, { dueInDays: 30, introducedAt: Date.now() }),
    ),
  ]);
  return { secondId };
}

/** The countries `writeMasteredUnitedStatesWithFewDue` leaves due, with the rung each is due at. */
const FEW_DUE = [
  { id: 'afghanistan', rung: 2 },
  { id: 'algeria', rung: 3 },
  { id: 'angola', rung: 2 },
] as const;

/**
 * A progress file with `country:united-states` mastered and three other countries due now, the
 * state `seedSummarySavedRun` saves a summary for. Today's 15 new items are used up by countries
 * that are not yet due. GATE_WAVE1_MASTERED_COUNTRIES other countries are mastered and not due,
 * so the United States' gate (CUR-21) was open before the saved round.
 */
export async function writeMasteredUnitedStatesWithFewDue(path: string) {
  await writeProgressFile(path, [
    masteredRow('country:united-states'),
    ...gateOpeningRows(GATE_WAVE1_MASTERED_COUNTRIES),
    ...FEW_DUE.map(({ id, rung }) =>
      progressRow(`country:${id}`, rung, { dueInDays: -1, introducedAt: Date.now() - 60 * DAY }),
    ),
    ...INTRODUCED_TODAY.map((id) =>
      progressRow(`country:${id}`, 1, { dueInDays: 30, introducedAt: Date.now() }),
    ),
  ]);
}

/**
 * Saves (SES-C05) the run of a session whose first round just ended at its summary, 20 of 20
 * right, with the `FEW_DUE` countries still queued and the United States unlocked by it. The page
 * must already be on the app's origin, and the session not yet open: the Session page reads this
 * once, as it mounts. The local day is worked out in the page, as the app does.
 */
export async function seedSummarySavedRun(page: Page) {
  const run = {
    queue: FEW_DUE.map(({ id, rung }) => ({ itemId: `country:${id}`, rung })),
    answered: 20,
    answeredInRound: 20,
    correctInRound: 20,
    asks: Object.fromEntries(
      ['united-states', ...FEW_DUE.map(({ id }) => id)].map((id) => [`country:${id}`, 1]),
    ),
    roundTotal: 20,
    itemTotal: FEW_DUE.length + 1,
  };
  await page.evaluate(
    (saved) => {
      const now = new Date();
      const dayKey = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 10);
      sessionStorage.setItem('geography-trainer:session-run', JSON.stringify({ dayKey, ...saved }));
    },
    { run, mastered: ['country:united-states'], testable: ['country:united-states'] },
  );
}
