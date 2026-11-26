// Spaced repetition: one FSRS card per (item, rung), and the L1 -> L3 exercise ladder: L1
// highlighted -> name (multiple choice), L2 name -> tap with borders, L3 name -> tap with no borders.
// Progress is plain JSON-serialisable data; every function returns new data and never mutates.

import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';
import { MASTERY_DISTINCT_DAYS, PLACEMENT_SEED_STABILITY_DAYS } from './config';
import { isPass } from './grading';

export type Rung = 1 | 2 | 3;

/** A ts-fsrs `Card` with its dates as epoch milliseconds, so it survives JSON. */
export interface StoredCard {
  due: number;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review?: number;
}

export interface ItemProgress {
  itemId: string;
  /** The rung the item is asked at next. */
  rung: Rung;
  /** The highest rung ever reached. */
  highestRung: Rung;
  /** One card per rung the item has reached. */
  cards: Partial<Record<Rung, StoredCard>>;
  /** Sorted, distinct local days (`YYYY-MM-DD`) on which the item passed L3. */
  l3PassDays: string[];
  /** True from an Again at L3 until the item passes L2 and returns to L3. */
  inL3Lapse: boolean;
  /**
   * Epoch ms of the item's first answer as a new item (an answer while `!isIntroduced`), else null.
   * A placement seed is null until then, and a `passed` seed (already introduced) stays null forever.
   * A caller computes `introducedToday` as the number of progress records whose `introducedAt` falls
   * on today's local day.
   */
  introducedAt: number | null;
}

/**
 * How a placement test left an item: `passed` (answered correctly), `failed` (tested and missed),
 * `aboveEstimate` (above the estimated level, untested) or `untestedAtOrBelow` (at or below the
 * estimate but never tested). Only `untestedAtOrBelow` skips ahead to L2.
 */
export type PlacementOutcome = 'passed' | 'failed' | 'aboveEstimate' | 'untestedAtOrBelow';

const MS_PER_DAY = 86_400_000;

// Fuzz is off so scheduling is deterministic and nothing calls Math.random.
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

function toStored(card: Card): StoredCard {
  const { last_review, due, ...rest } = card;
  return { ...rest, due: due.getTime(), ...(last_review ? { last_review: last_review.getTime() } : {}) };
}

function fromStored(card: StoredCard): Card {
  const { last_review, due, ...rest } = card;
  return { ...rest, due: new Date(due), ...(last_review === undefined ? {} : { last_review: new Date(last_review) }) };
}

function newCard(now: Date): StoredCard {
  return toStored(createEmptyCard(now));
}

/**
 * The learner's local calendar date as `YYYY-MM-DD`.
 * `tzOffsetMinutes` is minutes EAST of UTC (NZ summer is +780): the negation of JS `getTimezoneOffset()`.
 */
export function localDayKey(now: Date, tzOffsetMinutes: number): string {
  return new Date(now.getTime() + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function createProgress(itemId: string, now: Date): ItemProgress {
  return {
    itemId,
    rung: 1,
    highestRung: 1,
    cards: { 1: newCard(now) },
    l3PassDays: [],
    inL3Lapse: false,
    introducedAt: null,
  };
}

export function applyAnswer(
  progress: ItemProgress,
  rung: Rung,
  rating: Grade,
  now: Date,
  dayKey: string,
): ItemProgress {
  if (rung > progress.highestRung) {
    throw new Error(`Rung ${rung} is above the highest rung reached (${progress.highestRung})`);
  }
  const card = progress.cards[rung];
  if (!card) throw new Error(`No card for rung ${rung}`);

  const cards = { ...progress.cards, [rung]: toStored(scheduler.next(fromStored(card), now, rating).card) };
  const passed = isPass(rating);
  // On L1, the only multiple-choice rung, a slow but correct answer is Hard, so it climbs too. On
  // L2 and L3 Hard is a near-miss tap and keeps the item on its rung.
  const climbs = passed || (rating === Rating.Hard && progress.rung === 1);

  let l3PassDays = progress.l3PassDays;
  if (rung === 3 && progress.rung === 3 && passed && !l3PassDays.includes(dayKey)) {
    l3PassDays = [...l3PassDays, dayKey].sort();
  }

  let { rung: current, highestRung, inL3Lapse } = progress;
  if (rung === current) {
    if (climbs && current < 3) {
      current = (current + 1) as Rung;
      if (current === 3) inL3Lapse = false;
    } else if (rating === Rating.Again && current > 1) {
      if (current === 3) inL3Lapse = true;
      current = (current - 1) as Rung;
    }
    if (current > highestRung) highestRung = current;
    const target = cards[current];
    // Stepping down to a rung with an old card: ask it again now, keeping its FSRS state.
    cards[current] = target ? (current < rung ? { ...target, due: now.getTime() } : target) : newCard(now);
  }

  const introducedAt = isIntroduced(progress) ? progress.introducedAt : now.getTime();

  return { ...progress, rung: current, highestRung, cards, l3PassDays, inL3Lapse, introducedAt };
}

/**
 * True once the item has been answered at least once (some stored card has `reps > 0`). A
 * "not introduced" item (fresh, or seeded by placement without a pass) is still new: the session
 * caps how many arrive per day and asks them at `dueRung`.
 */
export function isIntroduced(progress: ItemProgress): boolean {
  return Object.values(progress.cards).some((card) => card.reps > 0);
}

/** True once L3 has been passed on enough different days; a later lapse never undoes it. */
export function isMastered(progress: ItemProgress): boolean {
  return progress.l3PassDays.length >= MASTERY_DISTINCT_DAYS;
}

/** The rung the item should be asked at next: always the current rung (L2 during an L3 lapse). */
export function dueRung(progress: ItemProgress): Rung {
  return progress.rung;
}

/** When the item is next due, in epoch ms: the current rung's card. */
export function nextDue(progress: ItemProgress): number {
  const card = progress.cards[progress.rung];
  if (!card) throw new Error(`No card for rung ${progress.rung}`);
  return card.due;
}

/**
 * Progress for an item as a placement test leaves it. `dayKey` is the learner's local day (see
 * `localDayKey`): a `passed` seed counts as the first L3 pass day, so one later L3 pass on a
 * different day masters the item. Other outcomes ignore it. A passed seed is not yet mastered.
 * It builds fresh progress, so use it only for items that have no progress yet: storing a seed
 * replaces the record. A caller re-running placement (testing out of a newly unlocked tier) must
 * skip items that already have progress.
 */
export function seedFromPlacement(
  itemId: string,
  outcome: PlacementOutcome,
  now: Date,
  dayKey: string,
): ItemProgress {
  const base = createProgress(itemId, now);
  switch (outcome) {
    case 'aboveEstimate':
    case 'failed':
      return base;
    case 'untestedAtOrBelow':
      return { ...base, rung: 2, highestRung: 2, cards: { 2: newCard(now) } };
    case 'passed': {
      // ts-fsrs's initial difficulty for a first Good.
      const initial = scheduler.next(createEmptyCard(now), now, Rating.Good).card;
      const seeded: StoredCard = {
        due: now.getTime() + PLACEMENT_SEED_STABILITY_DAYS * MS_PER_DAY,
        stability: PLACEMENT_SEED_STABILITY_DAYS,
        difficulty: initial.difficulty,
        scheduled_days: PLACEMENT_SEED_STABILITY_DAYS,
        learning_steps: 0,
        reps: 1,
        lapses: 0,
        state: State.Review,
        last_review: now.getTime(),
      };
      return { ...base, rung: 3, highestRung: 3, cards: { 3: seeded }, l3PassDays: [dayKey] };
    }
  }
}
