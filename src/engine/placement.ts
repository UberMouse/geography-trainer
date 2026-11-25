// Adaptive staircase placement test as a pure state machine. State is plain JSON.

import { Rating, type Grade } from 'ts-fsrs';
import {
  PLACEMENT_ESTIMATE_REVERSALS,
  PLACEMENT_MAX_LEVEL,
  PLACEMENT_MAX_QUESTIONS,
  PLACEMENT_MIN_LEVEL,
  PLACEMENT_NO_ESTIMATE,
  PLACEMENT_REVERSALS,
  PLACEMENT_START_LEVEL,
} from './config';
import type { PlacementOutcome } from './srs';

export interface PlacementItem {
  itemId: string;
  /** The curriculum item's difficulty. Items with a non-finite level are never asked. */
  level: number;
}

export interface PlacementAnswer {
  itemId: string;
  level: number;
  passed: boolean;
}

export interface PlacementState {
  /** The askable items: those with a finite level. */
  items: PlacementItem[];
  /** Ids of items with a non-finite level (kept out of `items`, as JSON turns Infinity into
   * null); they are never asked and always finish as above the estimate. */
  unaskable: string[];
  /** The level the next question aims at: the level of the last question asked, moved one. */
  target: number;
  answers: PlacementAnswer[];
  /** Direction of the last move: 1 harder, -1 easier, 0 before the first answer. */
  direction: -1 | 0 | 1;
  /** Levels of the questions at which the direction changed, in order. */
  reversals: number[];
  /** The question handed out by `nextQuestion` and not yet answered; null otherwise. */
  pending: PlacementQuestion | null;
}

export interface PlacementQuestion {
  itemId: string;
  level: number;
}

export interface PlacementResult {
  /** 0-8: the level the learner showed; 0 means none (nothing passed). */
  estimate: number;
  outcomes: Record<string, PlacementOutcome>;
}

const clampLevel = (n: number) => Math.min(PLACEMENT_MAX_LEVEL, Math.max(PLACEMENT_MIN_LEVEL, n));

/** `rng` is unused here (randomness is spent in `nextQuestion`); it keeps the API uniform. */
export function startPlacement(items: readonly PlacementItem[], rng: () => number): PlacementState {
  void rng;
  return {
    items: items.filter((i) => Number.isFinite(i.level)).map((i) => ({ itemId: i.itemId, level: i.level })),
    unaskable: items.filter((i) => !Number.isFinite(i.level)).map((i) => i.itemId),
    target: PLACEMENT_START_LEVEL,
    answers: [],
    direction: 0,
    reversals: [],
    pending: null,
  };
}

function isFinished(state: PlacementState): boolean {
  return state.answers.length >= PLACEMENT_MAX_QUESTIONS || state.reversals.length >= PLACEMENT_REVERSALS;
}

function unaskedItems(state: PlacementState): PlacementItem[] {
  const asked = new Set(state.answers.map((a) => a.itemId));
  return state.items.filter((i) => !asked.has(i.itemId));
}

/** The next question with the state that now holds it as `pending`, or null when the test is
 * finished or no askable item is left. While a question is pending it returns that question and
 * the same state without calling `rng`, so repeated calls are safe. Otherwise, at the target
 * level it picks uniformly with `rng`; with none left there, it keeps to the direction of travel:
 * after a pass the nearest level above the target that has unasked items (else the nearest below),
 * after a fail the nearest level below (else above), and before the first answer the nearest
 * level, the easier one on a tie. So a run of passes climbs past a level with no items. Throws a
 * RangeError when `rng` returns a value outside [0, 1). */
export function nextQuestion(
  state: PlacementState,
  rng: () => number,
): { state: PlacementState; question: PlacementQuestion } | null {
  if (state.pending) return { state, question: state.pending };
  if (isFinished(state)) return null;
  const pool = unaskedItems(state);
  if (pool.length === 0) return null;
  const levels = [...new Set(pool.map((i) => i.level))];
  const nearest = (candidates: number[]) =>
    candidates.reduce((a, b) => {
      const da = Math.abs(a - state.target);
      const db = Math.abs(b - state.target);
      return db < da || (db === da && b < a) ? b : a;
    });
  const harder = levels.filter((l) => l >= state.target);
  const easier = levels.filter((l) => l <= state.target);
  const ahead = state.direction === 1 ? harder : state.direction === -1 ? easier : levels;
  const bestLevel = nearest(ahead.length > 0 ? ahead : levels);
  const atLevel = pool.filter((i) => i.level === bestLevel);
  const r = rng();
  if (!(r >= 0 && r < 1)) throw new RangeError(`rng() must return a value in [0, 1), got ${r}`);
  const pick = atLevel[Math.floor(r * atLevel.length)]!;
  const question = { itemId: pick.itemId, level: pick.level };
  return { state: { ...state, pending: question }, question };
}

/** Records the tap for `itemId`, which must be the pending question from `nextQuestion`; throws
 * for anything else (never asked, already answered, another item, or the test finished). A pass
 * is Good or Easy. The staircase moves from the level actually asked, which can differ from the
 * target when that level had no items left: the next target is one level harder on a pass and
 * easier on a fail (clamped to 1-8). A reversal is an answer whose move is opposite to the
 * previous move; the level recorded is the asked level where the direction turned. A clamped
 * repeat of the same direction is not a reversal. */
export function answerPlacement(state: PlacementState, itemId: string, rating: Grade): PlacementState {
  const item = state.pending;
  if (!item || item.itemId !== itemId) throw new Error(`not the pending placement question: ${itemId}`);
  const passed = rating === Rating.Good || rating === Rating.Easy;
  const direction = passed ? 1 : -1;
  const reversed = state.direction !== 0 && state.direction !== direction;
  return {
    items: state.items,
    unaskable: state.unaskable,
    target: clampLevel(item.level + direction),
    answers: [...state.answers, { itemId, level: item.level, passed }],
    direction,
    reversals: reversed ? [...state.reversals, item.level] : state.reversals,
    pending: null,
  };
}

/** With at least one reversal, the mean of the last PLACEMENT_ESTIMATE_REVERSALS reversal levels
 * (all of them when fewer), rounded half down (reversals alternate a failed peak and a passed
 * trough, so a half is the trough) and clamped to 1-8, but never above the highest passed level
 * (a window that starts at a peak skews the mean up). With none, every answer moved the same
 * way, so it is the highest passed level. With nothing passed (no answers, or all failed) it is
 * PLACEMENT_NO_ESTIMATE (0), so every untested item is above the estimate. */
function estimateOf(state: PlacementState): number {
  const highestPassed = Math.max(PLACEMENT_NO_ESTIMATE, ...state.answers.filter((a) => a.passed).map((a) => a.level));
  const recent = state.reversals.slice(-PLACEMENT_ESTIMATE_REVERSALS);
  if (recent.length > 0) {
    return Math.min(clampLevel(Math.ceil(recent.reduce((a, b) => a + b, 0) / recent.length - 0.5)), highestPassed);
  }
  return highestPassed;
}

/** The estimate (0-8; 0 means no level was shown) and an outcome for every item given to
 * `startPlacement`; callable early. Passed items are `passed` and answered-but-failed items
 * `failed`. Items never answered (a pending question included) are `aboveEstimate` when above
 * the estimate and `untestedAtOrBelow` otherwise; items with a non-finite level are always
 * `aboveEstimate`. */
export function finishPlacement(state: PlacementState): PlacementResult {
  const estimate = estimateOf(state);
  const answered = new Map(state.answers.map((a) => [a.itemId, a.passed]));
  const outcomes: Record<string, PlacementOutcome> = {};
  for (const id of state.unaskable) outcomes[id] = 'aboveEstimate';
  for (const { itemId, level } of state.items) {
    const passed = answered.get(itemId);
    outcomes[itemId] =
      passed === undefined ? (level > estimate ? 'aboveEstimate' : 'untestedAtOrBelow') : passed ? 'passed' : 'failed';
  }
  return { estimate, outcomes };
}
