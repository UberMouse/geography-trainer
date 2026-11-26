// Adaptive placement test as a pure state machine. State is plain JSON.
//
// The learner has an ability on the difficulty scale; an item of `level` is known with
// probability `logistic(PLACEMENT_SLOPE * (ability - level))`. A posterior over ability, on a grid,
// is updated after every answer, with partial credit for a close miss. Each question aims at the
// estimate and goes to the world area asked least so far, so the test measures breadth as well as
// depth. Untested items are then placed by how likely the learner is to know them.

import type { Grade } from 'ts-fsrs';
import {
  PLACEMENT_CLOSE_KM,
  PLACEMENT_CONFIRM_PER_DAY,
  PLACEMENT_CONFIRM_START_DAYS,
  PLACEMENT_LIKELY_KNOWN,
  PLACEMENT_MAX_LEVEL,
  PLACEMENT_MAX_QUESTIONS,
  PLACEMENT_MIN_LEVEL,
  PLACEMENT_MIN_QUESTIONS,
  PLACEMENT_MIN_TO_PLACE,
  PLACEMENT_NO_ESTIMATE,
  PLACEMENT_PRIOR_SD,
  PLACEMENT_PROBABLY_KNOWN,
  PLACEMENT_SLOPE,
  PLACEMENT_START_LEVEL,
  PLACEMENT_STOP_SD,
} from './config';
import { unlockedBy, type Curriculum, type Tier } from './curriculum';
import { isPass } from './grading';
import { isMastered, seedFromPlacement, type ItemProgress, type PlacementOutcome } from './srs';

export interface PlacementItem {
  itemId: string;
  /** The curriculum item's difficulty. Items with a non-finite level are never asked. */
  level: number;
  /** A coarse world area (`worldArea`); questions spread across areas. */
  area: string;
}

/** How much an answer shows: 1 right, 0.5 a close miss (`placementCredit`), 0 a miss. */
export type PlacementCredit = 0 | 0.5 | 1;

export interface PlacementAnswer {
  itemId: string;
  level: number;
  credit: PlacementCredit;
}

export interface PlacementState {
  /** The askable items: those with a finite level. */
  items: PlacementItem[];
  /** Ids of items with a non-finite level (kept out of `items`, as JSON turns Infinity into
   * null); they are never asked and always finish as above the estimate. */
  unaskable: string[];
  answers: PlacementAnswer[];
  /** The question handed out by `nextQuestion` and not yet answered; null otherwise. */
  pending: PlacementQuestion | null;
}

export interface PlacementQuestion {
  itemId: string;
  level: number;
}

export interface PlacementResult {
  /** 0-8: the level the learner showed (the rounded ability); 0 means none. */
  estimate: number;
  outcomes: Record<string, PlacementOutcome>;
  /** For each `likelyKnown` item, the probability the learner knows it (orders its review). */
  confidence: Record<string, number>;
}

/** A coarse world area for a `[lng, lat]` point, to spread questions; 'unknown' for null. */
export function worldArea(center: readonly [number, number] | null): string {
  if (!center) return 'unknown';
  const [lng, lat] = center;
  if (lat < -60 || lng < -150 || lng > 150 || (lng > 110 && lat < -10)) return 'oceania';
  if (lng < -30) return lat >= 13 ? 'north-america' : 'south-america';
  if (lng < 45 && lat >= 35) return 'europe';
  if (lng < 35 && lat < 35) return 'africa';
  if (lng < 43 && lat < 20) return 'africa';
  if (lng < 52 && lat < 12) return 'africa';
  if (lng < 75) return 'west-central-asia';
  return 'east-south-asia';
}

// The ability grid: 0 (knows nothing) to PLACEMENT_MAX_LEVEL + 1 (knows everything).
const GRID_STEP = 0.25;
const GRID: readonly number[] = Array.from(
  { length: Math.round((PLACEMENT_MAX_LEVEL + 1) / GRID_STEP) + 1 },
  (_, i) => i * GRID_STEP,
);

/** The probability that a learner of `ability` knows an item of `level`. */
export function knowProbability(ability: number, level: number): number {
  return 1 / (1 + Math.exp(-PLACEMENT_SLOPE * (ability - level)));
}

/** The normalised posterior over GRID after `answers`, from a normal prior. A half credit
 * weighs the answer as half a pass and half a miss. */
function posterior(answers: readonly PlacementAnswer[]): number[] {
  const logs = GRID.map((a) => {
    let log = -(((a - PLACEMENT_START_LEVEL) / PLACEMENT_PRIOR_SD) ** 2) / 2;
    for (const { level, credit } of answers) {
      const p = knowProbability(a, level);
      log += credit * Math.log(p) + (1 - credit) * Math.log(1 - p);
    }
    return log;
  });
  const max = Math.max(...logs);
  const weights = logs.map((l) => Math.exp(l - max));
  const total = weights.reduce((x, y) => x + y, 0);
  return weights.map((w) => w / total);
}

/** The ability's posterior mean and standard deviation after `answers`. */
export function abilityOf(answers: readonly PlacementAnswer[]): { mean: number; sd: number } {
  const post = posterior(answers);
  const mean = post.reduce((sum, w, i) => sum + w * GRID[i]!, 0);
  const variance = post.reduce((sum, w, i) => sum + w * (GRID[i]! - mean) ** 2, 0);
  return { mean, sd: Math.sqrt(variance) };
}

/** The probability the learner knows an item of `level`, averaged over the posterior. */
function predictive(post: readonly number[], level: number): number {
  return post.reduce((sum, w, i) => sum + w * knowProbability(GRID[i]!, level), 0);
}

/**
 * The credit a placement answer earns: 1 for a pass (Good or Easy), 0.5 for a miss within
 * PLACEMENT_CLOSE_KM of the target (outside a country's or region's border, or from a place's
 * point), else 0. `km` undefined counts as far.
 */
export function placementCredit(tier: Tier, rating: Grade, km: number | undefined): PlacementCredit {
  if (isPass(rating)) return 1;
  return km !== undefined && km <= PLACEMENT_CLOSE_KM[tier] ? 0.5 : 0;
}

/** `rng` is unused here (randomness is spent in `nextQuestion`); it keeps the API uniform. */
export function startPlacement(items: readonly PlacementItem[], rng: () => number): PlacementState {
  void rng;
  return {
    items: items
      .filter((i) => Number.isFinite(i.level))
      .map((i) => ({ itemId: i.itemId, level: i.level, area: i.area })),
    unaskable: items.filter((i) => !Number.isFinite(i.level)).map((i) => i.itemId),
    answers: [],
    pending: null,
  };
}

/** Finished after PLACEMENT_MAX_QUESTIONS answers, or after PLACEMENT_MIN_QUESTIONS once the
 * ability's spread is below PLACEMENT_STOP_SD. */
export function isFinished(state: PlacementState): boolean {
  const n = state.answers.length;
  if (n >= PLACEMENT_MAX_QUESTIONS) return true;
  return n >= PLACEMENT_MIN_QUESTIONS && abilityOf(state.answers).sd < PLACEMENT_STOP_SD;
}

/** The next question with the state that now holds it as `pending`, or null when the test is
 * finished or no askable item is left. While a question is pending it returns that question and
 * the same state without calling `rng`, so repeated calls are safe. Otherwise it aims at the
 * ability estimate (clamped to 1-8): the unasked items whose level is within half a level of the
 * nearest unasked level, then among those the world areas asked least so far, then uniformly with
 * `rng`. Throws a RangeError when `rng` returns a value outside [0, 1). */
export function nextQuestion(
  state: PlacementState,
  rng: () => number,
): { state: PlacementState; question: PlacementQuestion } | null {
  if (state.pending) return { state, question: state.pending };
  if (isFinished(state)) return null;
  const asked = new Set(state.answers.map((a) => a.itemId));
  const pool = state.items.filter((i) => !asked.has(i.itemId));
  if (pool.length === 0) return null;
  const target = Math.min(PLACEMENT_MAX_LEVEL, Math.max(PLACEMENT_MIN_LEVEL, abilityOf(state.answers).mean));
  const nearest = Math.min(...pool.map((i) => Math.abs(i.level - target)));
  const near = pool.filter((i) => Math.abs(i.level - target) <= nearest + 0.5);
  const areaOf = new Map(state.items.map((i) => [i.itemId, i.area]));
  const areaCount = new Map<string, number>();
  for (const a of state.answers) {
    const area = areaOf.get(a.itemId)!;
    areaCount.set(area, (areaCount.get(area) ?? 0) + 1);
  }
  const fewest = Math.min(...near.map((i) => areaCount.get(i.area) ?? 0));
  const candidates = near.filter((i) => (areaCount.get(i.area) ?? 0) === fewest);
  const r = rng();
  if (!(r >= 0 && r < 1)) throw new RangeError(`rng() must return a value in [0, 1), got ${r}`);
  const pick = candidates[Math.floor(r * candidates.length)]!;
  const question = { itemId: pick.itemId, level: pick.level };
  return { state: { ...state, pending: question }, question };
}

/** Records the answer's credit for `itemId`, which must be the pending question from
 * `nextQuestion`; throws for anything else (never asked, already answered, another item). */
export function answerPlacement(state: PlacementState, itemId: string, credit: PlacementCredit): PlacementState {
  const item = state.pending;
  if (!item || item.itemId !== itemId) throw new Error(`not the pending placement question: ${itemId}`);
  return { ...state, answers: [...state.answers, { itemId, level: item.level, credit }], pending: null };
}

/**
 * The estimate and an outcome for every item given to `startPlacement`; callable early. Answered
 * items are `passed` (credit 1), `close` (0.5) or `failed` (0). An item never answered (a pending
 * question included) is placed by the probability the learner knows it, averaged over the
 * posterior: `likelyKnown` at PLACEMENT_LIKELY_KNOWN or more, `untestedAtOrBelow` at
 * PLACEMENT_PROBABLY_KNOWN or more, else `aboveEstimate`. Until PLACEMENT_MIN_TO_PLACE answers
 * (a test finished early) the estimate is mostly the prior, so nothing untested is placed: every
 * untested item is `aboveEstimate` and the estimate 0. Items with a non-finite level are always
 * `aboveEstimate`. The estimate is the posterior mean rounded and clamped to 0-8, and 0 when no
 * answer earned credit.
 */
export function finishPlacement(state: PlacementState): PlacementResult {
  const anyCredit = state.answers.some((a) => a.credit > 0);
  const enough = state.answers.length >= PLACEMENT_MIN_TO_PLACE;
  const { mean } = abilityOf(state.answers);
  const estimate = anyCredit && enough
    ? Math.min(PLACEMENT_MAX_LEVEL, Math.max(PLACEMENT_NO_ESTIMATE, Math.round(mean)))
    : PLACEMENT_NO_ESTIMATE;
  const post = posterior(state.answers);
  const answered = new Map(state.answers.map((a) => [a.itemId, a.credit]));
  const outcomes: Record<string, PlacementOutcome> = {};
  const confidence: Record<string, number> = {};
  for (const id of state.unaskable) outcomes[id] = 'aboveEstimate';
  for (const { itemId, level } of state.items) {
    const credit = answered.get(itemId);
    if (credit !== undefined) {
      outcomes[itemId] = credit === 1 ? 'passed' : credit === 0.5 ? 'close' : 'failed';
      continue;
    }
    const p = enough ? predictive(post, level) : 0;
    if (p >= PLACEMENT_LIKELY_KNOWN) {
      outcomes[itemId] = 'likelyKnown';
      confidence[itemId] = p;
    } else {
      outcomes[itemId] = p >= PLACEMENT_PROBABLY_KNOWN ? 'untestedAtOrBelow' : 'aboveEstimate';
    }
  }
  return { estimate, outcomes, confidence };
}

type ProgressMap = Readonly<Record<string, ItemProgress>>;

/**
 * The items to test, in curriculum order, `level` being the item's difficulty and `area` the
 * world area of its centre. `'countries'`: every country with no progress row. An item id: its
 * children with no progress row (none for an item with no children). Throws for an id not in the
 * curriculum.
 */
export function placementPool(curriculum: Curriculum, progress: ProgressMap, scope: string): PlacementItem[] {
  let ids: string[];
  if (scope === 'countries') {
    ids = [...curriculum.items.values()].filter((item) => item.tier === 'country').map((item) => item.id);
  } else {
    if (!curriculum.items.has(scope)) throw new Error(`Unknown item ${scope}`);
    ids = unlockedBy(curriculum, scope)?.childIds ?? [];
  }
  return ids
    .filter((id) => !progress[id])
    .map((id) => {
      const item = curriculum.items.get(id)!;
      return { itemId: id, level: item.difficulty, area: worldArea(item.center) };
    });
}

const MS_PER_DAY = 86_400_000;

/**
 * The progress rows to store for a finished test: a seed for each `passed`, `close`,
 * `untestedAtOrBelow` and `likelyKnown` item, in the order of `result.outcomes` except that
 * `likelyKnown` seeds come last, least certain first. Those are L3 reviews to confirm, due from
 * PLACEMENT_CONFIRM_START_DAYS days on, PLACEMENT_CONFIRM_PER_DAY a day, so the least certain
 * are checked first and no day is flooded. `failed` and `aboveEstimate` items store nothing (a
 * fresh record equals no record), and an item that already has a row is never seeded.
 */
export function placementSeeds(
  result: PlacementResult,
  progress: ProgressMap,
  now: Date,
  dayKey: string,
): ItemProgress[] {
  const seeds: ItemProgress[] = [];
  const confirm: string[] = [];
  for (const [itemId, outcome] of Object.entries(result.outcomes)) {
    if (progress[itemId]) continue;
    if (outcome === 'likelyKnown') confirm.push(itemId);
    else if (outcome === 'passed' || outcome === 'close' || outcome === 'untestedAtOrBelow') {
      seeds.push(seedFromPlacement(itemId, outcome, now, dayKey));
    }
  }
  const sureness = (id: string) => result.confidence[id] ?? 0;
  confirm.sort((a, b) => sureness(a) - sureness(b) || (a < b ? -1 : a > b ? 1 : 0));
  confirm.forEach((itemId, i) => {
    const days = PLACEMENT_CONFIRM_START_DAYS + Math.floor(i / PLACEMENT_CONFIRM_PER_DAY);
    seeds.push(seedFromPlacement(itemId, 'likelyKnown', now, dayKey, new Date(now.getTime() + days * MS_PER_DAY)));
  });
  return seeds;
}

/**
 * Whether the item has been studied: answered in a study session. That is `introducedAt` set, or
 * a card past one rep. A passed or likely-known placement seed is built at L3 with one rep and
 * keeps `introducedAt` null (setting it would count the seed against the daily new-item cap), so
 * its first answer in a session shows only as a second rep. A placement seed alone is not studied.
 */
export function isStudied(progress: ItemProgress): boolean {
  return progress.introducedAt !== null || Object.values(progress.cards).some((c) => c.reps > 1);
}

/**
 * Whether the item can be tested out of: mastered, with children, at least one of which has no
 * progress row, and none of which has been studied (`isStudied`). Rows a placement left (seeds)
 * do not hide it, so quitting a test-out partway keeps the link. Throws for an id not in the
 * curriculum.
 */
export function canTestOut(curriculum: Curriculum, progress: ProgressMap, itemId: string): boolean {
  if (!curriculum.items.has(itemId)) throw new Error(`Unknown item ${itemId}`);
  const own = progress[itemId];
  const unlocked = unlockedBy(curriculum, itemId);
  if (!own || !isMastered(own) || !unlocked) return false;
  const { childIds } = unlocked;
  return (
    childIds.some((id) => !progress[id]) &&
    childIds.every((id) => !progress[id] || !isStudied(progress[id]))
  );
}
