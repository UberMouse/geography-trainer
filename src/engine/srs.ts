// Spaced repetition: one FSRS card per (item, rung), and the L1 -> L4 exercise ladder.
// Progress is plain JSON-serialisable data; every function returns new data and never mutates.

import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';
import { MASTERY_DISTINCT_DAYS, PLACEMENT_SEED_STABILITY_DAYS } from './config';

export type Rung = 1 | 2 | 3 | 4;

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
  /** Sorted, distinct local days (`YYYY-MM-DD`) on which the item passed L4. */
  l4PassDays: string[];
  /** True from an Again at L4 until the item passes L3 and returns to L4. */
  inL4Lapse: boolean;
  /** Epoch ms. */
  introducedAt: number;
}

/**
 * How a placement test left an item: `passed` (answered correctly), `failed` (tested and missed),
 * `aboveEstimate` (above the estimated level, untested) or `untestedAtOrBelow` (at or below the
 * estimate but never tested). Only `untestedAtOrBelow` skips ahead to L3.
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
    l4PassDays: [],
    inL4Lapse: false,
    introducedAt: now.getTime(),
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
  const passed = rating === Rating.Good || rating === Rating.Easy;

  let l4PassDays = progress.l4PassDays;
  if (rung === 4 && passed && !l4PassDays.includes(dayKey)) {
    l4PassDays = [...l4PassDays, dayKey].sort();
  }

  let { rung: current, highestRung, inL4Lapse } = progress;
  if (rung === current) {
    if (passed && current < 4) {
      current = (current + 1) as Rung;
      if (current === 4) inL4Lapse = false;
    } else if (rating === Rating.Again && current > 1) {
      if (current === 4) inL4Lapse = true;
      current = (current - 1) as Rung;
    }
    if (current > highestRung) highestRung = current;
    const target = cards[current];
    // Stepping down to a rung with an old card: ask it again now, keeping its FSRS state.
    cards[current] = target ? (current < rung ? { ...target, due: now.getTime() } : target) : newCard(now);
  }

  return { ...progress, rung: current, highestRung, cards, l4PassDays, inL4Lapse };
}

/**
 * True once the item has been answered at least once (some stored card has `reps > 0`). A
 * "not introduced" item (fresh, or seeded by placement without a pass) is still new: the session
 * caps how many arrive per day and asks them at `dueRung`.
 */
export function isIntroduced(progress: ItemProgress): boolean {
  return Object.values(progress.cards).some((card) => card.reps > 0);
}

/** True once L4 has been passed on enough different days; a later lapse never undoes it. */
export function isMastered(progress: ItemProgress): boolean {
  return progress.l4PassDays.length >= MASTERY_DISTINCT_DAYS;
}

/** The rung the item should be asked at next: always the current rung (L3 during an L4 lapse). */
export function dueRung(progress: ItemProgress): Rung {
  return progress.rung;
}

/** When the item is next due, in epoch ms: the current rung's card. */
export function nextDue(progress: ItemProgress): number {
  const card = progress.cards[progress.rung];
  if (!card) throw new Error(`No card for rung ${progress.rung}`);
  return card.due;
}

/** Progress for an item as a placement test leaves it. Never counts as an L4 pass day. */
export function seedFromPlacement(itemId: string, outcome: PlacementOutcome, now: Date): ItemProgress {
  const base = createProgress(itemId, now);
  switch (outcome) {
    case 'aboveEstimate':
    case 'failed':
      return base;
    case 'untestedAtOrBelow':
      return { ...base, rung: 3, highestRung: 3, cards: { 3: newCard(now) } };
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
      return { ...base, rung: 4, highestRung: 4, cards: { 4: seeded } };
    }
  }
}
