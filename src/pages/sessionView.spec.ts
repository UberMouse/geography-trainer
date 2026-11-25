import { describe, expect, it } from 'vitest';
import { startRun } from '../engine/sessionRun';
import { createProgress } from '../engine/srs';
import { Rating } from 'ts-fsrs';
import type { ExerciseResult } from '../exercises/types';
import { answerEntry, questionHeader, questionSeed } from './sessionView';

describe('questionSeed', () => {
  it('is stable, and differs by item, by position and by salt', () => {
    expect(questionSeed('country:france', 3, 7)).toBe(questionSeed('country:france', 3, 7));
    expect(questionSeed('country:france', 3, 7)).not.toBe(questionSeed('country:france', 4, 7));
    expect(questionSeed('country:france', 3, 7)).not.toBe(questionSeed('country:spain', 3, 7));
    expect(questionSeed('country:france', 3, 7)).not.toBe(questionSeed('country:france', 3, 8));
  });
});

describe('questionHeader', () => {
  const questions = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ itemId: `country:c${i}`, rung: 1 as const }));

  it('counts within a full round', () => {
    expect(questionHeader(startRun(questions(50)))).toBe('Question 1 of 20');
  });

  it('uses the remaining count when fewer than a round remain', () => {
    expect(questionHeader(startRun(questions(7)))).toBe('Question 1 of 7');
  });
});

describe('answerEntry', () => {
  const question = { itemId: 'country:france', rung: 1 as const };
  const result: ExerciseResult = { rating: Rating.Good, correct: true, timeMs: 1234 };
  const now = new Date('2026-03-10T23:30:00Z');

  it('starts a fresh item from createProgress and stamps the answer with now', () => {
    const { after, entry } = answerEntry(undefined, question, result, now, 0);
    expect(after.itemId).toBe('country:france');
    expect(entry.progress).toBe(after);
    expect(entry.answer).toMatchObject({
      itemId: 'country:france',
      rung: 1,
      rating: Rating.Good,
      correct: true,
      timeMs: 1234,
      at: now.getTime(),
    });
  });

  it('builds on existing progress', () => {
    const before = createProgress('country:france', new Date('2026-03-01T00:00:00Z'));
    const { after } = answerEntry(before, question, result, now, 0);
    expect(after).not.toBe(before);
    expect(after.itemId).toBe(before.itemId);
  });

  it('takes the day key from the timezone offset', () => {
    expect(answerEntry(undefined, question, result, now, 0).entry.answer.dayKey).toBe('2026-03-10');
    expect(answerEntry(undefined, question, result, now, 120).entry.answer.dayKey).toBe(
      '2026-03-11',
    );
  });

  it('carries km and maptapScore only when the result has them', () => {
    const plain = answerEntry(undefined, question, result, now, 0).entry.answer;
    expect(plain.km).toBeUndefined();
    expect(plain.maptapScore).toBeUndefined();
    const tap = answerEntry(undefined, question, { ...result, km: 12, maptapScore: 99 }, now, 0)
      .entry.answer;
    expect(tap.km).toBe(12);
    expect(tap.maptapScore).toBe(99);
  });
});
