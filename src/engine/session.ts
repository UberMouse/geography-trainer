// Builds the study queue: due reviews first, then new items, interleaved by rung.

import { DAILY_NEW_CAP, SESSION_MAX_RUN } from './config';
import { newItems, unlockedItems, type Curriculum } from './curriculum';
import { dueRung, nextDue, type ItemProgress, type Rung } from './srs';

export interface SessionQuestion {
  itemId: string;
  rung: Rung;
}

export interface SessionInput {
  curriculum: Curriculum;
  progress: Readonly<Record<string, ItemProgress>>;
  now: Date;
  /** New items already introduced today. */
  introducedToday: number;
  /** Defaults to DAILY_NEW_CAP. */
  dailyCap?: number;
  /** Undefined means every place type. */
  placeTypes?: ReadonlySet<string>;
  /** Accepted for future use; the queue is currently fully deterministic. */
  rng?: () => number;
}

/** Due reviews (most overdue first, ties by item id), then new items in curriculum order as L1
 * questions, reordered so no `SESSION_MAX_RUN + 1` questions in a row share a rung when avoidable. */
export function buildSession(input: SessionInput): SessionQuestion[] {
  const { curriculum, progress, now, introducedToday, placeTypes } = input;
  const dailyCap = input.dailyCap ?? DAILY_NEW_CAP;
  const nowMs = now.getTime();

  const due = unlockedItems(curriculum, progress, { placeTypes })
    .flatMap((item) => {
      const p = progress[item.id];
      return p && nextDue(p) <= nowMs ? [{ p, at: nextDue(p) }] : [];
    })
    .sort((a, b) => a.at - b.at || (a.p.itemId < b.p.itemId ? -1 : a.p.itemId > b.p.itemId ? 1 : 0))
    .map(({ p }): SessionQuestion => ({ itemId: p.itemId, rung: dueRung(p) }));

  const slots = Math.max(0, dailyCap - introducedToday);
  const fresh = newItems(curriculum, progress, { placeTypes })
    .slice(0, slots)
    .map((item): SessionQuestion => ({ itemId: item.id, rung: 1 }));

  return interleave([...due, ...fresh]);
}

/** Greedy: take the highest-priority item, unless the last SESSION_MAX_RUN questions share a
 * rung, in which case take the highest-priority item at a different rung (if any). */
function interleave(priority: SessionQuestion[]): SessionQuestion[] {
  const remaining = [...priority];
  const out: SessionQuestion[] = [];
  while (remaining.length > 0) {
    let pick = 0;
    const tail = out.slice(-SESSION_MAX_RUN);
    const runRung = tail[0]?.rung;
    if (tail.length === SESSION_MAX_RUN && tail.every((q) => q.rung === runRung)) {
      const found = remaining.findIndex((q) => q.rung !== runRung);
      if (found > 0) pick = found;
    }
    out.push(...remaining.splice(pick, 1));
  }
  return out;
}
