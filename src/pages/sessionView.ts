// Plain helpers for the Session page, kept out of the component so they can be unit-tested.

import type { SessionRun } from '../engine/sessionRun';

/** A small deterministic 32-bit string hash (FNV-1a). */
function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The exercise seed for the question at `position` in the session: the item and position hashed. */
export function questionSeed(itemId: string, position: number): number {
  return hashOf(`${itemId}:${position}`);
}

/** "Question 3 of 20": the current question's number within its round. */
export function questionHeader(run: SessionRun): string {
  return `Question ${run.answeredInRound + 1} of ${run.roundTotal}`;
}
