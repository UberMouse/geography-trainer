// The session in progress, kept in this tab's sessionStorage so a reload resumes the round where it
// was (its counter, its re-asks) instead of building a new one. Per tab and short-lived: progress
// itself lives in IndexedDB; this only remembers the run's place. Storage can be missing or throw
// (private windows, blocked site data): every access is guarded, and a failure means a fresh run.

import type { SessionQuestion } from '../engine/session';
import type { SessionRun } from '../engine/sessionRun';
import type { ItemProgress } from '../engine/srs';

const KEY = 'geography-trainer:session-run';

interface SavedRun {
  dayKey: string;
  run: SessionRun;
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

function isQuestion(q: unknown): q is SessionQuestion {
  if (typeof q !== 'object' || q === null) return false;
  const { itemId, rung } = q as Record<string, unknown>;
  return typeof itemId === 'string' && (rung === 1 || rung === 2 || rung === 3);
}

function isRun(r: unknown): r is SessionRun {
  if (typeof r !== 'object' || r === null) return false;
  const run = r as Record<string, unknown>;
  const asks = run['asks'];
  return (
    Array.isArray(run['queue']) &&
    run['queue'].every(isQuestion) &&
    ['answered', 'answeredInRound', 'correctInRound', 'roundTotal', 'itemTotal'].every((k) => isCount(run[k])) &&
    typeof asks === 'object' &&
    asks !== null &&
    Object.values(asks).every(isCount)
  );
}

/**
 * The run saved as `text` for `dayKey`, or null: for another day, malformed, with nothing left to
 * ask, or with a question the progress can no longer answer (an item `isKnown` rejects, or a rung
 * with no card: progress was reset or imported since). An item with no progress row can only be
 * asked at L1.
 */
export function parseSavedRun(
  text: string | null,
  dayKey: string,
  progress: Readonly<Record<string, ItemProgress>>,
  isKnown: (itemId: string) => boolean,
): SessionRun | null {
  if (text === null) return null;
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof saved !== 'object' || saved === null) return null;
  const { dayKey: savedDay, run } = saved as Partial<SavedRun>;
  if (savedDay !== dayKey || !isRun(run) || run.queue.length === 0) return null;
  const answerable = run.queue.every(({ itemId, rung }) => {
    if (!isKnown(itemId)) return false;
    const p = progress[itemId];
    return p ? p.cards[rung] !== undefined && rung <= p.highestRung : rung === 1;
  });
  return answerable ? run : null;
}

/** The saved run for today, if it can still be resumed (see `parseSavedRun`). */
export function loadSessionRun(
  dayKey: string,
  progress: Readonly<Record<string, ItemProgress>>,
  isKnown: (itemId: string) => boolean,
): SessionRun | null {
  try {
    return parseSavedRun(sessionStorage.getItem(KEY), dayKey, progress, isKnown);
  } catch {
    return null;
  }
}

export function saveSessionRun(dayKey: string, run: SessionRun): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ dayKey, run } satisfies SavedRun));
  } catch {
    // A run that cannot be saved just starts afresh after a reload.
  }
}

export function clearSessionRun(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing saved, or nothing to clear.
  }
}
