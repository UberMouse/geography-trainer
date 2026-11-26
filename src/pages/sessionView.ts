// Plain helpers for the Session page, kept out of the component so they can be unit-tested.

import { unlockedBy, type Curriculum } from '../engine/curriculum';
import { itemsDone, type SessionRun } from '../engine/sessionRun';
import type { SessionQuestion } from '../engine/session';
import { applyAnswer, createProgress, localDayKey, type ItemProgress } from '../engine/srs';
import type { ExerciseResult } from '../exercises/types';
import type { AnswerEntry } from '../storage/repo';

/** A small deterministic 32-bit string hash (FNV-1a). */
function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * The exercise seed for the question at `position` in the session: the item, position and the
 * session's `salt` (chosen once per visit) hashed, so a revisit varies the distractors.
 */
export function questionSeed(itemId: string, position: number, salt: number): number {
  return hashOf(`${salt}:${itemId}:${position}`);
}

/**
 * The item's progress after the learner's answer, and the entry to save for it. A first answer
 * starts from `createProgress`; `tzOffsetMinutes` is minutes east of UTC. The card is scheduled
 * from the later of `now` and its last review; the day key and the answer's `at` use `now`.
 */
export function answerEntry(
  before: ItemProgress | undefined,
  question: SessionQuestion,
  result: ExerciseResult,
  now: Date,
  tzOffsetMinutes: number,
): { after: ItemProgress; entry: AnswerEntry } {
  const dayKey = localDayKey(now, tzOffsetMinutes);
  // ts-fsrs throws when `now` is before the card's last review (a clock that ran ahead), so schedule from the later time.
  const lastReview = before?.cards[question.rung]?.last_review;
  const scheduledAt = lastReview !== undefined && lastReview > now.getTime() ? new Date(lastReview) : now;
  const after = applyAnswer(
    before ?? createProgress(question.itemId, now),
    question.rung,
    result.rating,
    scheduledAt,
    dayKey,
  );
  return {
    after,
    entry: {
      progress: after,
      answer: {
        itemId: question.itemId,
        rung: question.rung,
        rating: result.rating,
        correct: result.correct,
        timeMs: result.timeMs,
        km: result.km,
        maptapScore: result.maptapScore,
        at: now.getTime(),
        dayKey,
      },
    },
  };
}

/**
 * "Question 3 · 4 of 15 done": the current question's number within its round, and the session's
 * items finished out of those it started with. A count of questions would grow as items come back
 * at a higher rung; the items never do.
 */
export function questionHeader(run: SessionRun): string {
  return `Question ${run.answeredInRound + 1} · ${itemsDone(run)} of ${run.itemTotal} done`;
}

/**
 * The countries whose regions the questions need drawn: the owner of every region question and of
 * every place question under a region, in first-seen order. Ids are the bare country ids
 * (`loadRegions`' argument).
 */
export function countriesNeedingRegions(
  curriculum: Curriculum,
  questions: readonly SessionQuestion[],
): string[] {
  const needed = new Set<string>();
  for (const { itemId } of questions) {
    const item = curriculum.items.get(itemId);
    if (!item) throw new Error(`Unknown item "${itemId}"`);
    if (item.tier === 'region' || item.parent?.startsWith('region:')) {
      needed.add(item.countryId.replace(/^country:/, ''));
    }
  }
  return [...needed];
}

/** What the current round has mastered: the unlock lines' ids, and those with a Test out link. */
export interface RoundMastery {
  mastered: readonly string[];
  testable: readonly string[];
}

/** `round` with `itemId` added as mastered, and as testable when `testOut` (answer order kept). */
export function withMastered(round: RoundMastery, itemId: string, testOut: boolean): RoundMastery {
  return {
    mastered: [...round.mastered, itemId],
    testable: testOut ? [...round.testable, itemId] : round.testable,
  };
}

/**
 * The round summary's lines for the items mastered in the round, each with the mastered item's
 * id: "Unlocked: France's regions", "Unlocked: Brittany's places (France)". A region's line names
 * its country, so a region and a country of the same name stay apart. An item listed twice counts
 * once; one that unlocks nothing is left out. `nameOf` gives the display name of an item id.
 */
export function unlockLines(
  curriculum: Curriculum,
  masteredIds: readonly string[],
  nameOf: (itemId: string) => string,
): { id: string; text: string }[] {
  const lines: { id: string; text: string }[] = [];
  for (const id of new Set(masteredIds)) {
    const unlocked = unlockedBy(curriculum, id);
    if (!unlocked) continue;
    const item = curriculum.items.get(id);
    const owner = item?.tier === 'region' ? ` (${nameOf(item.countryId)})` : '';
    lines.push({ id, text: `Unlocked: ${nameOf(id)}'s ${unlocked.tier}s${owner}` });
  }
  return lines;
}
