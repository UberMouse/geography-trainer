// The device settings and the rules for their values. Pure: no Dexie.

import { DAILY_NEW_CAP } from '../engine/config';

export const DAILY_NEW_CAP_MIN = 5;
export const DAILY_NEW_CAP_MAX = 50;

/** Key of the daily-limit row in the key-value table. */
export const DAILY_NEW_CAP_KEY = 'setting:dailyNewCap';

export interface Settings {
  /** New items introduced per day. */
  dailyNewCap: number;
}

/** An integer from 5 to 50. */
export function isValidDailyNewCap(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= DAILY_NEW_CAP_MIN && value <= DAILY_NEW_CAP_MAX
  );
}

/** The limit to use for a stored value: the value when valid, else the default. */
export function dailyNewCapOrDefault(stored: unknown): number {
  return isValidDailyNewCap(stored) ? stored : DAILY_NEW_CAP;
}
