import { describe, expect, it } from 'vitest';
import { DAILY_NEW_CAP } from './config';
import {
  buildCurriculum,
  countryItemId,
  placeItemId,
  unlockedItems,
  type Curriculum,
} from './curriculum';
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

/** Answered (introduced) progress on `rung` whose current card fell due `daysAgo` days before NOW
 * (negative: in the future). */
function dueProgress(itemId: string, rung: 1 | 3 | 4, daysAgo: number): ItemProgress {
  const base: ItemProgress =
    rung === 4
      ? seedFromPlacement(itemId, 'passed', NOW)
      : rung === 3
        ? seedFromPlacement(itemId, 'untestedAtOrBelow', NOW)
        : createProgress(itemId, NOW);
  const card = base.cards[base.rung]!;
  const due = NOW.getTime() - daysAgo * DAY;
  return { ...base, cards: { ...base.cards, [base.rung]: { ...card, reps: Math.max(card.reps, 1), due } } };
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

  it('includes an item due exactly now and excludes one due a millisecond later', () => {
    const at = (id: string, offsetMs: number): ItemProgress => {
      const p = dueProgress(id, 1, 0);
      const card = p.cards[p.rung]!;
      return { ...p, cards: { ...p.cards, [p.rung]: { ...card, due: NOW.getTime() + offsetMs } } };
    };
    const progress = { [cid(1)]: at(cid(1), 0), [cid(2)]: at(cid(2), 1) };
    const q = buildSession({ curriculum: cur, progress, now: NOW, introducedToday: DAILY_NEW_CAP, rng });
    expect(q).toEqual([{ itemId: cid(1), rung: 1 }]);
  });

  it('orders items with equal due times by item id, not curriculum order', () => {
    // The easier countries come first in the curriculum but have the larger ids.
    const countries = ['z', 'y', 'x'].map((id) => ({ id, name: id, places: 1, hasRegions: false }));
    const rev = buildCurriculum(
      countries,
      [],
      countries.map((c, i) => place(`p${c.id}`, c.id, 'city', i + 1)),
    );
    const ids = countries.map((c) => countryItemId(c.id));
    expect([...unlockedItems(rev, {}).map((i) => i.id)]).toEqual(ids);
    const progress = Object.fromEntries(ids.map((id) => [id, dueProgress(id, 1, 2)]));
    const q = buildSession({ curriculum: rev, progress, now: NOW, introducedToday: DAILY_NEW_CAP, rng });
    expect(q.map((x) => x.itemId)).toEqual([...ids].sort());
  });

  it('leaves out a locked item that has due progress', () => {
    const locked = buildCurriculum(
      [{ id: 'big', name: 'big', places: 20, hasRegions: false }],
      [],
      Array.from({ length: 20 }, (_, i) => place(`x${i}`, 'big', 'city', 1)),
    );
    const progress = { [placeItemId('x0')]: dueProgress(placeItemId('x0'), 1, 3) };
    const q = buildSession({
      curriculum: locked,
      progress,
      now: NOW,
      introducedToday: DAILY_NEW_CAP,
      rng,
    });
    expect(q).toEqual([]);
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

  it('caps placement-seeded items as new, asked at L3, and asks nothing twice', () => {
    const progress: Record<string, ItemProgress> = {};
    for (let i = 0; i < 30; i++) progress[cid(i)] = seedFromPlacement(cid(i), 'untestedAtOrBelow', NOW);
    const q = buildSession({ curriculum: cur, progress, now: NOW, introducedToday: 0, rng });
    expect(q).toHaveLength(15);
    expect(q.every((x) => x.rung === 3)).toBe(true);
    expect(new Set(q.map((x) => x.itemId)).size).toBe(15);
  });

  it('leaves a passed seed out until it is due, then reviews it at L4', () => {
    const progress = { [cid(1)]: seedFromPlacement(cid(1), 'passed', NOW) };
    const at = (days: number) =>
      buildSession({
        curriculum: cur,
        progress,
        now: new Date(NOW.getTime() + days * DAY),
        introducedToday: DAILY_NEW_CAP,
        rng,
      });
    expect(nextDue(progress[cid(1)]!)).toBe(NOW.getTime() + 2 * DAY);
    expect(at(0)).toEqual([]);
    expect(at(2)).toEqual([{ itemId: cid(1), rung: 4 }]);
  });

  it('avoids a long run when a better order exists', () => {
    // Two due L3 reviews ahead of four new L1 items: a greedy order gave 3,3,1,1,1,1.
    const progress = { [cid(0)]: dueProgress(cid(0), 3, 2), [cid(1)]: dueProgress(cid(1), 3, 1) };
    const q = buildSession({ curriculum: cur, progress, now: NOW, introducedToday: 0, dailyCap: 4, rng });
    expect(q.map((x) => x.rung).sort()).toEqual([1, 1, 1, 1, 3, 3]);
    expect(longestRun(q.map((x) => x.rung))).toBeLessThanOrEqual(2);
  });

  it('reaches a longest run of 2 whenever some order of the same questions does', () => {
    // Shortest longest-run over all distinct orderings of a multiset of rungs.
    const best = (left: number[], last = 0, run = 0): number => {
      if (left.length === 0) return run;
      let min = Infinity;
      for (const r of new Set(left)) {
        const rest = [...left];
        rest.splice(rest.indexOf(r), 1);
        const next = r === last ? run + 1 : 1;
        min = Math.min(min, Math.max(next, best(rest, r, next)));
      }
      return min;
    };
    const rungOf = [1, 3, 4] as const;
    for (let len = 1; len <= 7; len++) {
      for (let code = 0; code < 3 ** len; code++) {
        const mix = Array.from({ length: len }, (_, i) => Math.floor(code / 3 ** i) % 3);
        const progress: Record<string, ItemProgress> = {};
        mix.forEach((d, i) => (progress[cid(i)] = dueProgress(cid(i), rungOf[d]!, 20 - i)));
        const q = buildSession({ curriculum: cur, progress, now: NOW, introducedToday: DAILY_NEW_CAP, rng });
        const rungs = q.map((x) => x.rung);
        expect(rungs, mix.join('')).toHaveLength(len);
        if (best(rungs) <= 2) expect(longestRun(rungs), mix.join('')).toBeLessThanOrEqual(2);
      }
    }
    // Brute force: ~0.5 s alone, but it timed out at the 5 s default on a heavily loaded machine.
  }, 30_000);

  it('keeps a single-rung queue intact when there is nothing to interleave with', () => {
    const q = buildSession({ curriculum: cur, progress: {}, now: NOW, introducedToday: 0, rng });
    expect(longestRun(q.map((x) => x.rung))).toBe(DAILY_NEW_CAP);
  });
});
