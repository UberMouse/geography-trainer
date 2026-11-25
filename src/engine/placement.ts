// Adaptive staircase placement test as a pure state machine. State is plain JSON.

import { Rating, type Grade } from 'ts-fsrs';
import {
  PLACEMENT_ESTIMATE_REVERSALS,
  PLACEMENT_MAX_LEVEL,
  PLACEMENT_MAX_QUESTIONS,
  PLACEMENT_MIN_LEVEL,
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
 * level it picks uniformly with `rng`; with none left there, it uses the nearest level that has
 * some (the easier one on a tie). */
export function nextQuestion(
  state: PlacementState,
  rng: () => number,
): { state: PlacementState; question: PlacementQuestion } | null {
  if (state.pending) return { state, question: state.pending };
  if (isFinished(state)) return null;
  const pool = unaskedItems(state);
  if (pool.length === 0) return null;
  let best = Infinity;
  let bestLevel = 0;
  for (const { level } of pool) {
    const d = Math.abs(level - state.target);
    if (d < best || (d === best && level < bestLevel)) {
      best = d;
      bestLevel = level;
    }
  }
  const atLevel = pool.filter((i) => i.level === bestLevel);
  const pick = atLevel[Math.min(atLevel.length - 1, Math.floor(rng() * atLevel.length))]!;
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

/** Mean of the last PLACEMENT_ESTIMATE_REVERSALS reversal levels (all of them when fewer), else
 * the last asked level, else the start level; rounded half up and clamped to 1-8. */
function estimateOf(state: PlacementState): number {
  const recent = state.reversals.slice(-PLACEMENT_ESTIMATE_REVERSALS);
  const raw =
    recent.length > 0
      ? recent.reduce((a, b) => a + b, 0) / recent.length
      : (state.answers.at(-1)?.level ?? PLACEMENT_START_LEVEL);
  return clampLevel(Math.floor(raw + 0.5));
}

/** The estimate and an outcome for every item given to `startPlacement`; callable early. Passed
 * items are `passed` and answered-but-failed items `failed`. Items never answered (a pending
 * question included) are `aboveEstimate` when above the estimate and `untestedAtOrBelow`
 * otherwise; items with a non-finite level are always `aboveEstimate`. */
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
