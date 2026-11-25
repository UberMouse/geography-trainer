import { describe, expect, it } from 'vitest';
import { DAILY_NEW_CAP } from './config';
import { buildCurriculum, countryItemId, placeItemId, type Curriculum } from './curriculum';
import { buildSession } from './session';
import { createProgress, nextDue, seedFromPlacement, type ItemProgress } from './srs';
import type { Place } from './types';

const NOW = new Date('2026-03-10T12:00:00Z');
const DAY = 86_400_000;
const rng = () => 0.5;

const place = (id: string, country: string, type: string, level: number): Place => ({
  id,
  name: id,
  country,
  region: null,
  lat: 0,
  lng: 0,
  type,
  level,
});

/** `n` countries c00.. with one place each; country i has a place of level (i % 8) + 1. */
function fixture(n: number): Curriculum {
  const countries = Array.from({ length: n }, (_, i) => ({
    id: `c${String(i).padStart(2, '0')}`,
    name: `c${i}`,
    places: 1,
    hasRegions: false,
  }));
  return buildCurriculum(
    countries,
    [],
    countries.map((c, i) => place(`p${c.id}`, c.id, 'city', (i % 8) + 1)),
  );
}

const cid = (n: number) => countryItemId(`c${String(n).padStart(2, '0')}`);

/** Progress on `rung` whose current card fell due `daysAgo` days before NOW (negative: in the future). */
function dueProgress(itemId: string, rung: 1 | 3 | 4, daysAgo: number): ItemProgress {
  const base: ItemProgress =
    rung === 4
      ? seedFromPlacement(itemId, 'passed', NOW)
      : rung === 3
        ? seedFromPlacement(itemId, 'untestedAtOrBelow', NOW)
        : createProgress(itemId, NOW);
  const card = base.cards[base.rung]!;
  return { ...base, cards: { ...base.cards, [base.rung]: { ...card, due: NOW.getTime() - daysAgo * DAY } } };
}

function longestRun(rungs: number[]): number {
  let best = 0;
  let run = 0;
  rungs.forEach((r, i) => {
    run = i > 0 && rungs[i - 1] === r ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

describe('buildSession', () => {
  const cur = fixture(30);

  it('puts due reviews first, most overdue first, then new items at L1 in curriculum order', () => {
    const progress = {
      [cid(5)]: dueProgress(cid(5), 1, 1),
      [cid(6)]: dueProgress(cid(6), 1, 5),
      [cid(7)]: dueProgress(cid(7), 1, 3),
    };
    expect(nextDue(progress[cid(6)]!)).toBeLessThan(nextDue(progress[cid(7)]!));
    const q = buildSession({ curriculum: cur, progress, now: NOW, introducedToday: 0, rng });
    expect(q.slice(0, 3).map((x) => x.itemId)).toEqual([cid(6), cid(7), cid(5)]);
    const fresh = q.slice(3);
    expect(fresh).toHaveLength(DAILY_NEW_CAP);
    expect(fresh.every((x) => x.rung === 1)).toBe(true);
    // Lowest difficulty first, so c00 (level 1) leads.
    expect(fresh[0]?.itemId).toBe(cid(0));
  });

  it('asks a due item at its current rung and skips items not yet due', () => {
    const progress = {
      [cid(1)]: dueProgress(cid(1), 3, 1),
      [cid(2)]: dueProgress(cid(2), 4, -2),
    };
    const q = buildSession({ curriculum: cur, progress, now: NOW, introducedToday: DAILY_NEW_CAP, rng });
    expect(q).toEqual([{ itemId: cid(1), rung: 3 }]);
  });

  it('caps new items at dailyCap minus introducedToday', () => {
    const count = (introducedToday: number, dailyCap?: number) =>
      buildSession({ curriculum: cur, progress: {}, now: NOW, introducedToday, dailyCap, rng }).length;
    expect(count(0)).toBe(15);
    expect(count(10)).toBe(5);
    expect(count(2, 4)).toBe(2);
    expect(count(0, 0)).toBe(0);
  });

  it('returns an empty queue when nothing is due and the cap is reached or exceeded', () => {
    const run = (introducedToday: number) =>
      buildSession({ curriculum: cur, progress: {}, now: NOW, introducedToday, rng });
    expect(run(15)).toEqual([]);
    expect(run(40)).toEqual([]);
  });

  it('never includes locked items', () => {
    const locked = buildCurriculum(
      [{ id: 'big', name: 'big', places: 20, hasRegions: false }],
      [],
      Array.from({ length: 20 }, (_, i) => place(`x${i}`, 'big', 'city', 1)),
    );
    const q = buildSession({ curriculum: locked, progress: {}, now: NOW, introducedToday: 0, rng });
    expect(q.map((x) => x.itemId)).toEqual([countryItemId('big')]);
    expect(q.some((x) => x.itemId === placeItemId('x0'))).toBe(false);
  });

  it('leaves out filtered place types, due and new', () => {
    const c = buildCurriculum(
      [{ id: 'a', name: 'a', places: 3, hasRegions: false }],
      [],
      [place('m', 'a', 'mountain', 1), place('c', 'a', 'city', 1), place('d', 'a', 'city', 2)],
    );
    const country = countryItemId('a');
    const mastered: ItemProgress = {
      ...dueProgress(country, 1, -9),
      l4PassDays: ['2026-03-01', '2026-03-02'],
    };
    const progress = {
      [country]: mastered,
      [placeItemId('m')]: dueProgress(placeItemId('m'), 1, 1),
      [placeItemId('c')]: dueProgress(placeItemId('c'), 1, 1),
    };
    const input = { curriculum: c, progress, now: NOW, introducedToday: 0, rng };
    const all = buildSession(input).map((x) => x.itemId);
    expect(all).toEqual([placeItemId('c'), placeItemId('m'), placeItemId('d')]);
    const cities = buildSession({ ...input, placeTypes: new Set(['city']) }).map((x) => x.itemId);
    expect(cities).toEqual([placeItemId('c'), placeItemId('d')]);
  });

  it('breaks up runs of one rung when the mix allows, deterministically', () => {
    const progress: Record<string, ItemProgress> = {};
    for (let i = 0; i < 6; i++) progress[cid(i)] = dueProgress(cid(i), i < 3 ? 4 : 3, 1 + i);
    const input = { curriculum: cur, progress, now: NOW, introducedToday: 0, rng };
    const q = buildSession({ ...input, dailyCap: 2 });
    expect(q).toHaveLength(8);
    expect(longestRun(q.map((x) => x.rung))).toBeLessThanOrEqual(2);
    expect(buildSession({ ...input, dailyCap: 2 })).toEqual(q);
  });

  it('keeps a single-rung queue intact when there is nothing to interleave with', () => {
    const q = buildSession({ curriculum: cur, progress: {}, now: NOW, introducedToday: 0, rng });
    expect(longestRun(q.map((x) => x.rung))).toBe(DAILY_NEW_CAP);
  });
});
