// The export/import file format and the validation of a parsed file. Pure, no storage.

import { isIntroduced, type ItemProgress } from '../engine/srs';
import type { AnswerRow } from './db';

export const FILE_FORMAT = 'geography-trainer-progress';
export const FILE_VERSION = 1;

export interface ProgressFile {
  format: typeof FILE_FORMAT;
  version: typeof FILE_VERSION;
  /** ISO 8601 timestamp. */
  exportedAt: string;
  progress: ItemProgress[];
  answers: AnswerRow[];
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRung = (value: unknown): boolean => isNum(value) && Number.isInteger(value) && value >= 1 && value <= 4;

const isCount = (value: unknown): boolean => isNum(value) && Number.isInteger(value) && value >= 0;

/** A real calendar day as `localDayKey` writes it: `YYYY-MM-DD` that survives a round trip through Date. */
function isDayKey(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const CARD_NUMBERS = ['due', 'stability', 'difficulty'] as const;
// Whole-number fields: ts-fsrs rounds scheduled_days, and `state` is its State enum (0 New .. 3 Relearning).
const CARD_COUNTS = ['scheduled_days', 'learning_steps', 'reps', 'lapses'] as const;

function checkCard(card: unknown, where: string) {
  if (!isObj(card)) throw new Error(`${where} is not an object`);
  for (const key of CARD_NUMBERS) {
    if (!isNum(card[key])) throw new Error(`${where}.${key} is not a number`);
  }
  for (const key of CARD_COUNTS) {
    if (!isCount(card[key])) throw new Error(`${where}.${key} is not a non-negative integer`);
  }
  if (!isCount(card.state) || (card.state as number) > 3) throw new Error(`${where}.state is not an integer 0-3`);
  if (card.last_review !== undefined && !isNum(card.last_review)) {
    throw new Error(`${where}.last_review is not a number`);
  }
}

function checkProgress(row: unknown, index: number) {
  const where = `progress[${index}]`;
  if (!isObj(row)) throw new Error(`${where} is not an object`);
  if (typeof row.itemId !== 'string') throw new Error(`${where}.itemId is not a string`);
  if (!isRung(row.rung)) throw new Error(`${where}.rung is not 1-4`);
  if (!isRung(row.highestRung)) throw new Error(`${where}.highestRung is not 1-4`);
  if ((row.rung as number) > (row.highestRung as number)) {
    throw new Error(`${where}.rung is above its highestRung`);
  }
  if (!isObj(row.cards)) throw new Error(`${where}.cards is not an object`);
  for (const [key, card] of Object.entries(row.cards)) {
    if (String(Number(key)) !== key || !isRung(Number(key)))
      throw new Error(`${where}.cards has the key "${key}", not 1-4`);
    checkCard(card, `${where}.cards.${key}`);
  }
  if (!(String(row.rung) in row.cards)) throw new Error(`${where}.cards has no card for its rung`);
  if (!Array.isArray(row.l4PassDays) || !row.l4PassDays.every(isDayKey)) {
    throw new Error(`${where}.l4PassDays is not an array of YYYY-MM-DD strings`);
  }
  if (new Set(row.l4PassDays).size !== row.l4PassDays.length) {
    throw new Error(`${where}.l4PassDays has a repeated day`);
  }
  if (row.l4PassDays.length > 0 && row.highestRung !== 4) {
    throw new Error(`${where}.l4PassDays has days but highestRung is not 4`);
  }
  if (typeof row.inL4Lapse !== 'boolean') throw new Error(`${where}.inL4Lapse is not a boolean`);
  if (row.introducedAt !== null && !isNum(row.introducedAt)) {
    throw new Error(`${where}.introducedAt is not a number or null`);
  }
}

function checkAnswer(row: unknown, index: number) {
  const where = `answers[${index}]`;
  if (!isObj(row)) throw new Error(`${where} is not an object`);
  if (!isCount(row.id) || row.id === 0) throw new Error(`${where}.id is not a positive integer`);
  if (typeof row.itemId !== 'string') throw new Error(`${where}.itemId is not a string`);
  if (!isRung(row.rung)) throw new Error(`${where}.rung is not 1-4`);
  if (!isRung(row.rating)) throw new Error(`${where}.rating is not 1-4`);
  if (typeof row.correct !== 'boolean') throw new Error(`${where}.correct is not a boolean`);
  if (!isNum(row.timeMs)) throw new Error(`${where}.timeMs is not a number`);
  if (!isNum(row.at)) throw new Error(`${where}.at is not a number`);
  if (!isDayKey(row.dayKey)) throw new Error(`${where}.dayKey is not a YYYY-MM-DD day`);
  for (const key of ['km', 'maptapScore']) {
    if (row[key] !== undefined && !isNum(row[key])) throw new Error(`${where}.${key} is not a number`);
  }
}

function checkUnique(keys: (string | number)[], what: string) {
  const seen = new Set<string | number>();
  for (const key of keys) {
    if (seen.has(key)) throw new Error(`Two ${what} share the value ${String(key)}`);
    seen.add(key);
  }
}

/** Checks a parsed progress file and returns the same object, typed (not a copy). Throws an `Error` naming the first problem. */
export function validateProgressFile(parsed: unknown): ProgressFile {
  if (!isObj(parsed)) throw new Error('The file is not a progress export');
  if (parsed.format !== FILE_FORMAT) throw new Error(`Wrong format: expected "${FILE_FORMAT}"`);
  if (parsed.version !== FILE_VERSION) throw new Error(`Unsupported version: ${String(parsed.version)}`);
  if (typeof parsed.exportedAt !== 'string' || !Number.isFinite(Date.parse(parsed.exportedAt))) {
    throw new Error('exportedAt is not a date string');
  }
  if (!Array.isArray(parsed.progress)) throw new Error('progress is not an array');
  if (!Array.isArray(parsed.answers)) throw new Error('answers is not an array');
  parsed.progress.forEach(checkProgress);
  parsed.answers.forEach(checkAnswer);
  const file = parsed as unknown as ProgressFile;
  checkUnique(
    file.progress.map((row) => row.itemId),
    'progress rows (itemId)',
  );
  checkUnique(
    file.answers.map((row) => row.id),
    'answer rows (id)',
  );
  return file;
}

/** How many countries have been started (answered at least once) among these progress rows. */
export function countriesStarted(progress: Iterable<ItemProgress>): number {
  let count = 0;
  for (const row of progress) {
    if (row.itemId.startsWith('country:') && isIntroduced(row)) count += 1;
  }
  return count;
}
