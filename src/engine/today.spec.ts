import { Rating } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { DAILY_NEW_CAP } from './config';
import { buildCountryCurriculum } from './curriculum';
import { buildSession } from './session';
import { applyAnswer, createProgress, localDayKey, type ItemProgress } from './srs';
import { introducedToday, todayNumbers } from './today';
import type { Country, Place } from './types';

const DAY = 86_400_000;

const countries: Country[] = Array.from({ length: 20 }, (_, i) => ({
  id: `c${i}`,
  name: `c${i}`,
  places: 1,
  hasRegions: false,
}));
const places: Place[] = countries.map((c) => ({
  id: `p${c.id}`,
  name: c.id,
  country: c.id,
  region: null,
  lat: 0,
  lng: 0,
  type: 'city',
  level: 1,
}));
const cur = buildCountryCurriculum(countries, places);
const cid = (i: number) => `country:c${i}`;

/** `itemId` answered Good once at `at`. */
function answered(itemId: string, at: Date): ItemProgress {
  return applyAnswer(createProgress(itemId, at), 1, Rating.Good, at, localDayKey(at, 0));
}

/** Passed L4 on two different days: mastered. */
function mastered(itemId: string, start: Date): ItemProgress {
  let p = createProgress(itemId, start);
  for (let day = 0; day < 40 && p.l4PassDays.length < 2; day++) {
    const now = new Date(start.getTime() + day * DAY);
    p = applyAnswer(p, p.rung, Rating.Good, now, localDayKey(now, 0));
  }
  expect(p.l4PassDays.length).toBe(2);
  return p;
}

describe('today', () => {
  const NOW = new Date('2026-03-10T12:00:00Z');

  it('has nothing done and a full-cap session on a fresh state', () => {
    expect(introducedToday(cur, {}, NOW, 0)).toBe(0);
    expect(todayNumbers(cur, {}, NOW, 0)).toEqual({
      due: 0,
      newToday: 0,
      dailyCap: DAILY_NEW_CAP,
      learning: 0,
      learned: 0,
      sessionLength: DAILY_NEW_CAP,
    });
  });

  it('counts newToday by local day: a non-zero offset moves the day boundary', () => {
    const at = new Date('2026-03-10T20:00:00Z');
    const progress = { [cid(0)]: answered(cid(0), at), [cid(1)]: answered(cid(1), at) };
    // UTC: 23:00Z on the 10th is the same day as 20:00Z.
    expect(introducedToday(cur, progress, new Date('2026-03-10T23:00:00Z'), 0)).toBe(2);
    // +720: the answers were 08:00 on the 11th. 23:00Z is 11:00 on the 11th (same day); 11:59Z is
    // 23:59 on the 10th (the day before).
    expect(introducedToday(cur, progress, new Date('2026-03-10T23:00:00Z'), 720)).toBe(2);
    expect(introducedToday(cur, progress, new Date('2026-03-10T11:59:00Z'), 720)).toBe(0);
    // -720: the answers were 08:00 on the 10th. 03:00Z on the 11th is 15:00 on the 10th (same day);
    // 13:00Z on the 11th is 01:00 on the 11th (the next day).
    expect(introducedToday(cur, progress, new Date('2026-03-11T03:00:00Z'), -720)).toBe(2);
    expect(introducedToday(cur, progress, new Date('2026-03-11T13:00:00Z'), -720)).toBe(0);
  });

  it('feeds the same introducedToday into the session length', () => {
    const progress: Record<string, ItemProgress> = {};
    for (let i = 0; i < 4; i++) progress[cid(i)] = answered(cid(i), new Date(NOW.getTime() - 60_000));
    const t = todayNumbers(cur, progress, NOW, 0);
    expect(t.newToday).toBe(4);
    expect(t.due).toBe(4); // a climb gives the next rung a card due at once
    expect(t.sessionLength).toBe(
      buildSession({ curriculum: cur, progress, now: NOW, introducedToday: 4 }).length,
    );
    expect(t.sessionLength).toBe(DAILY_NEW_CAP);
  });

  it('counts due reviews, and learning versus learned', () => {
    const later = new Date(NOW.getTime() + 2 * DAY);
    const progress = {
      [cid(0)]: answered(cid(0), NOW),
      [cid(1)]: mastered(cid(1), new Date(NOW.getTime() - 30 * DAY)),
      [cid(2)]: createProgress(cid(2), NOW),
    };
    const t = todayNumbers(cur, progress, later, 0, 5);
    expect(t.learning).toBe(1);
    expect(t.learned).toBe(1);
    expect(t.dailyCap).toBe(5);
    expect(t.due).toBeGreaterThanOrEqual(1);
    expect(t.newToday).toBe(0);
  });

  it('ignores progress rows for ids outside the curriculum', () => {
    const progress = { 'region:gone': answered('region:gone', NOW), 'place:x': mastered('place:x', NOW) };
    expect(introducedToday(cur, progress, NOW, 0)).toBe(0);
    expect(todayNumbers(cur, progress, NOW, 0)).toMatchObject({
      due: 0,
      newToday: 0,
      learning: 0,
      learned: 0,
    });
  });
});
