// Builds the study queue: due reviews first, then new items, interleaved by rung.

import { DAILY_NEW_CAP, SESSION_MAX_RUN } from './config';
import { newItems, unlockedItems, type Curriculum } from './curriculum';
import { dueRung, isIntroduced, nextDue, type ItemProgress, type Rung } from './srs';

export interface SessionQuestion {
  itemId: string;
  rung: Rung;
}

export interface SessionInput {
  curriculum: Curriculum;
  progress: Readonly<Record<string, ItemProgress>>;
  now: Date;
  /**
   * New items already introduced today: the number of progress records whose `introducedAt` falls on
   * today's local day. The new-item slots are `dailyCap - introducedToday`.
   */
  introducedToday: number;
  /** Defaults to DAILY_NEW_CAP. Caps new items only, never due reviews. */
  dailyCap?: number;
  /**
   * maptap `type` values to keep; undefined means every type. Places of other types are left out,
   * and so are regions with no place of a kept type (their due reviews pause too, until the filter
   * changes). Countries are always kept.
   */
  placeTypes?: ReadonlySet<string>;
  /** Accepted for future use; the queue is currently fully deterministic. */
  rng?: () => number;
}

/**
 * Due reviews first: unlocked items that have been answered (`isIntroduced`) and are due at or
 * before `now`, at `dueRung`, most overdue first, ties by item id. Then new items (`newItems`: no
 * progress, or progress never answered, such as a placement seed) in curriculum order, at most
 * `dailyCap - introducedToday`; each is asked at `dueRung` when it has progress (a seed at L3) and
 * at L1 otherwise. No item appears twice. The result is then interleaved so no `SESSION_MAX_RUN + 1`
 * questions in a row share a rung whenever some ordering avoids that; otherwise its longest run is
 * the smallest any ordering can reach. Known trade-off: when the due
 * reviews alone cannot avoid a long same-rung run, new items are pulled forward to break it, so they
 * can precede overdue reviews.
 */
export function buildSession(input: SessionInput): SessionQuestion[] {
  const { curriculum, progress, now, introducedToday, placeTypes } = input;
  const dailyCap = input.dailyCap ?? DAILY_NEW_CAP;
  const nowMs = now.getTime();

  const due = unlockedItems(curriculum, progress, { placeTypes })
    .flatMap((item) => {
      const p = progress[item.id];
      return p && isIntroduced(p) && nextDue(p) <= nowMs ? [{ p, at: nextDue(p) }] : [];
    })
    .sort((a, b) => a.at - b.at || (a.p.itemId < b.p.itemId ? -1 : a.p.itemId > b.p.itemId ? 1 : 0))
    .map(({ p }): SessionQuestion => ({ itemId: p.itemId, rung: dueRung(p) }));

  const slots = Math.max(0, dailyCap - introducedToday);
  const fresh = newItems(curriculum, progress, { placeTypes })
    .slice(0, slots)
    .map((item): SessionQuestion => {
      const p = progress[item.id];
      return { itemId: item.id, rung: p ? dueRung(p) : 1 };
    });

  return interleave([...due, ...fresh]);
}

/**
 * Keeps priority order as the preference. Each pick is the highest-priority remaining question
 * that (a) does not extend the current run past the target run and (b) leaves a remainder that
 * can still be arranged without a longer run. The target is SESSION_MAX_RUN, or the smallest
 * longest run any order can reach when that is larger (so minority rungs are spread, not spent
 * early). Failing that, the highest-priority one satisfying (a); failing that, the
 * highest-priority one (an unavoidable run).
 */
function interleave(priority: SessionQuestion[]): SessionQuestion[] {
  const remaining = [...priority];
  const counts = new Map<Rung, number>();
  for (const q of remaining) counts.set(q.rung, (counts.get(q.rung) ?? 0) + 1);
  if (remaining.length === 0) return [];

  // The target longest run: SESSION_MAX_RUN when some order achieves it, else the smallest run any
  // order can achieve (the biggest rung split by the other questions into at most n - cMax + 1 runs).
  const cMax = Math.max(...counts.values());
  const maxRun = Math.max(SESSION_MAX_RUN, Math.ceil(cMax / (remaining.length - cMax + 1)));

  // Can `n` questions with per-rung `counts` follow a tail of `runLength` questions at `tail`?
  // Rung r needs a separator between runs of maxRun, and may use up the tail's run first.
  const feasible = (n: number, tail: Rung, runLength: number): boolean => {
    for (const [r, c] of counts) {
      if (c > maxRun * (n - c + 1) - (r === tail ? runLength : 0)) return false;
    }
    return true;
  };

  const out: SessionQuestion[] = [];
  let runRung: Rung | undefined;
  let runLength = 0;
  while (remaining.length > 0) {
    let withinRun = -1;
    let pick = -1;
    for (let i = 0; i < remaining.length && pick < 0; i++) {
      const q = remaining[i]!;
      const length = q.rung === runRung ? runLength + 1 : 1;
      if (length > maxRun) continue;
      if (withinRun < 0) withinRun = i;
      counts.set(q.rung, counts.get(q.rung)! - 1);
      if (feasible(remaining.length - 1, q.rung, length)) pick = i;
      counts.set(q.rung, counts.get(q.rung)! + 1);
    }
    if (pick < 0) pick = withinRun >= 0 ? withinRun : 0;

    const [q] = remaining.splice(pick, 1);
    counts.set(q!.rung, counts.get(q!.rung)! - 1);
    runLength = q!.rung === runRung ? runLength + 1 : 1;
    runRung = q!.rung;
    out.push(q!);
  }
  return out;
}
