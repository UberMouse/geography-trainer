// Plain helpers for the Session page, kept out of the component so they can be unit-tested.

import type { SessionRun } from '../engine/sessionRun';
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

/** "Question 3 of 20": the current question's number within its round. */
export function questionHeader(run: SessionRun): string {
  return `Question ${run.answeredInRound + 1} of ${run.roundTotal}`;
}
