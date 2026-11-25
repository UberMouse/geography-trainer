import { describe, expect, it } from 'vitest';
import { startRun } from '../engine/sessionRun';
import { questionHeader, questionSeed } from './sessionView';

describe('questionSeed', () => {
  it('is stable, and differs by item and by position', () => {
    expect(questionSeed('country:france', 3)).toBe(questionSeed('country:france', 3));
    expect(questionSeed('country:france', 3)).not.toBe(questionSeed('country:france', 4));
    expect(questionSeed('country:france', 3)).not.toBe(questionSeed('country:spain', 3));
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
