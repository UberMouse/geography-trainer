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
  /** The curriculum item's difficulty. Non-finite levels are never asked. */
  level: number;
}

export interface PlacementAnswer {
  itemId: string;
  level: number;
  passed: boolean;
}

export interface PlacementState {
  items: PlacementItem[];
  /** The level the next question aims at. */
  target: number;
  answers: PlacementAnswer[];
  /** Direction of the last move: 1 harder, -1 easier, 0 before the first answer. */
  direction: -1 | 0 | 1;
  /** Target levels at which the direction changed, in order. */
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
    items: items.map((i) => ({ itemId: i.itemId, level: i.level })),
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

function unaskedAskable(state: PlacementState): PlacementItem[] {
  const asked = new Set(state.answers.map((a) => a.itemId));
  return state.items.filter((i) => Number.isFinite(i.level) && !asked.has(i.itemId));
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
  const pool = unaskedAskable(state);
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
 * for anything else (never asked, already answered, another item, or the test finished). A pass is Good or
 * Easy. The target moves one level harder on a pass and easier on a fail (clamped to 1-8). A
 * reversal is an answer whose move is opposite to the previous move; the level recorded is the
 * target level the answer was given at, where the direction turned. A clamped repeat of the
 * same direction is not a reversal. */
export function answerPlacement(state: PlacementState, itemId: string, rating: Grade): PlacementState {
  const item = state.pending;
  if (!item || item.itemId !== itemId) throw new Error(`not the pending placement question: ${itemId}`);
  const passed = rating === Rating.Good || rating === Rating.Easy;
  const direction = passed ? 1 : -1;
  const reversed = state.direction !== 0 && state.direction !== direction;
  return {
    items: state.items,
    target: clampLevel(state.target + direction),
    answers: [...state.answers, { itemId, level: item.level, passed }],
    direction,
    reversals: reversed ? [...state.reversals, state.target] : state.reversals,
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

/** The estimate and an outcome for every item given to `startPlacement`; callable early. A
 * pending unanswered question counts as untested. */
export function finishPlacement(state: PlacementState): PlacementResult {
  const estimate = estimateOf(state);
  const passed = new Set(state.answers.filter((a) => a.passed).map((a) => a.itemId));
  const outcomes: Record<string, PlacementOutcome> = {};
  for (const { itemId, level } of state.items) {
    outcomes[itemId] = passed.has(itemId) ? 'passed' : level > estimate ? 'aboveEstimate' : 'untestedAtOrBelow';
  }
  return { estimate, outcomes };
}
