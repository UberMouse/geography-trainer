import { describe, expect, it } from 'vitest';
import * as config from './config';
import { DAILY_NEW_CAP } from './config';
import {
  buildCurriculum,
  countryItemId,
  placeItemId,
  unlockedItems,
  type Curriculum,
} from './curriculum';
import { buildSession, dueQuestions } from './session';
import { createProgress, localDayKey, nextDue, seedFromPlacement, type ItemProgress } from './srs';
import type { Place } from './types';
import { gateFillers, withFillersMastered } from './gateFixtures';

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
function dueProgress(itemId: string, rung: 1 | 2 | 3, daysAgo: number): ItemProgress {
  const base: ItemProgress =
    rung === 3
      ? seedFromPlacement(itemId, 'passed', NOW, localDayKey(NOW, 0))
      : rung === 2
        ? seedFromPlacement(itemId, 'untestedAtOrBelow', NOW, localDayKey(NOW, 0))
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

  it('[SES-01, SES-04] puts due reviews first, most overdue first, then new items at L1 in curriculum order', () => {
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

  it('[SES-02, SES-03] asks a due item at its current rung and skips items not yet due', () => {
    const progress = {
      [cid(1)]: dueProgress(cid(1), 2, 1),
      [cid(2)]: dueProgress(cid(2), 3, -2),
    };
    const q = buildSession({ curriculum: cur, progress, now: NOW, introducedToday: DAILY_NEW_CAP, rng });
    expect(q).toEqual([{ itemId: cid(1), rung: 2 }]);
  });

  it('[SES-02] includes an item due exactly now and excludes one due a millisecond later', () => {
    const at = (id: string, offsetMs: number): ItemProgress => {
      const p = dueProgress(id, 1, 0);
      const card = p.cards[p.rung]!;
      return { ...p, cards: { ...p.cards, [p.rung]: { ...card, due: NOW.getTime() + offsetMs } } };
    };
    const progress = { [cid(1)]: at(cid(1), 0), [cid(2)]: at(cid(2), 1) };
    const q = buildSession({ curriculum: cur, progress, now: NOW, introducedToday: DAILY_NEW_CAP, rng });
    expect(q).toEqual([{ itemId: cid(1), rung: 1 }]);
  });

  it('[SES-01] orders items with equal due times by item id, not curriculum order', () => {
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

  it('[SES-05] leaves out a locked item that has due progress', () => {
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

  it('[SES-02, SES-05, CUR-22] behind a shut gate, asks an answered child that is due, not a due seed', () => {
    const c = buildCurriculum(
      [{ id: 'small', name: 'small', places: 3, hasRegions: false }],
      [],
      [place('p0', 'small', 'city', 1), place('p1', 'small', 'city', 1), place('p2', 'small', 'city', 1)],
    );
    const close = seedFromPlacement(placeItemId('p1'), 'close', NOW, localDayKey(NOW, 0));
    const closeDue = {
      ...close,
      cards: Object.fromEntries(Object.entries(close.cards).map(([r, card]) => [r, { ...card, due: NOW.getTime() - DAY }])),
    };
    const progress = {
      [countryItemId('small')]: { ...dueProgress(countryItemId('small'), 1, -9), l3PassDays: ['2026-03-01', '2026-03-02'] },
      [placeItemId('p0')]: dueProgress(placeItemId('p0'), 1, 1),
      [placeItemId('p1')]: closeDue,
    };
    const q = buildSession({ curriculum: c, progress, now: NOW, introducedToday: 0, rng }).map((x) => x.itemId);
    expect(q).toEqual([placeItemId('p0')]);
  });

  it('[SES-03] caps new items at dailyCap minus introducedToday', () => {
    const count = (introducedToday: number, dailyCap?: number) =>
      buildSession({ curriculum: cur, progress: {}, now: NOW, introducedToday, dailyCap, rng }).length;
    expect(count(0)).toBe(15);
    expect(count(10)).toBe(5);
    expect(count(2, 4)).toBe(2);
    expect(count(0, 0)).toBe(0);
  });

  it('[SES-03] returns an empty queue when nothing is due and the cap is reached or exceeded', () => {
    const run = (introducedToday: number) =>
      buildSession({ curriculum: cur, progress: {}, now: NOW, introducedToday, rng });
    expect(run(15)).toEqual([]);
    expect(run(40)).toEqual([]);
  });

  it('[SES-05] never includes locked items', () => {
    const locked = buildCurriculum(
      [{ id: 'big', name: 'big', places: 20, hasRegions: false }],
      [],
      Array.from({ length: 20 }, (_, i) => place(`x${i}`, 'big', 'city', 1)),
    );
    const q = buildSession({ curriculum: locked, progress: {}, now: NOW, introducedToday: 0, rng });
    expect(q.map((x) => x.itemId)).toEqual([countryItemId('big')]);
    expect(q.some((x) => x.itemId === placeItemId('x0'))).toBe(false);
  });

  it('[SES-06] leaves out filtered place types, due and new', () => {
    // With every filler country mastered too (not due, as `mastered`), a's gate (CUR-21) is open.
    const fillers = gateFillers();
    const c = buildCurriculum(
      [{ id: 'a', name: 'a', places: 3, hasRegions: false }, ...fillers],
      [],
      [place('m', 'a', 'mountain', 1), place('c', 'a', 'city', 1), place('d', 'a', 'city', 2)],
    );
    const country = countryItemId('a');
    const mastered: ItemProgress = {
      ...dueProgress(country, 1, -9),
      l3PassDays: ['2026-03-01', '2026-03-02'],
    };
    const progress = withFillersMastered(
      {
        [country]: mastered,
        [placeItemId('m')]: dueProgress(placeItemId('m'), 1, 1),
        [placeItemId('c')]: dueProgress(placeItemId('c'), 1, 1),
      },
      mastered,
      fillers,
    );
    const input = { curriculum: c, progress, now: NOW, introducedToday: 0, rng };
    const all = buildSession(input).map((x) => x.itemId);
    expect(all).toEqual([placeItemId('c'), placeItemId('m'), placeItemId('d')]);
    const cities = buildSession({ ...input, placeTypes: new Set(['city']) }).map((x) => x.itemId);
    expect(cities).toEqual([placeItemId('c'), placeItemId('d')]);
  });

  it('[SES-07, SES-C02] breaks up runs of one rung when the mix allows, deterministically', () => {
    const progress: Record<string, ItemProgress> = {};
    for (let i = 0; i < 6; i++) progress[cid(i)] = dueProgress(cid(i), i < 3 ? 3 : 2, 1 + i);
    const input = { curriculum: cur, progress, now: NOW, introducedToday: 0, rng };
    const q = buildSession({ ...input, dailyCap: 2 });
    expect(q).toHaveLength(8);
    expect(longestRun(q.map((x) => x.rung))).toBeLessThanOrEqual(2);
    expect(buildSession({ ...input, dailyCap: 2 })).toEqual(q);
  });

  it('[SES-04, SES-05] caps placement-seeded items as new, asked at L2, and asks nothing twice', () => {
    const progress: Record<string, ItemProgress> = {};
    for (let i = 0; i < 30; i++) progress[cid(i)] = seedFromPlacement(cid(i), 'untestedAtOrBelow', NOW, localDayKey(NOW, 0));
    const q = buildSession({ curriculum: cur, progress, now: NOW, introducedToday: 0, rng });
    expect(q).toHaveLength(15);
    expect(q.every((x) => x.rung === 2)).toBe(true);
    expect(new Set(q.map((x) => x.itemId)).size).toBe(15);
  });

  it('[SES-04] leaves a passed seed out until it is due, then reviews it at L3', () => {
    const progress = { [cid(1)]: seedFromPlacement(cid(1), 'passed', NOW, localDayKey(NOW, 0)) };
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
    expect(at(2)).toEqual([{ itemId: cid(1), rung: 3 }]);
  });

  it('[SES-07] avoids a long run when a better order exists', () => {
    // Two due L2 reviews ahead of four new L1 items: a greedy order gave 2,2,1,1,1,1.
    const progress = { [cid(0)]: dueProgress(cid(0), 2, 2), [cid(1)]: dueProgress(cid(1), 2, 1) };
    const q = buildSession({ curriculum: cur, progress, now: NOW, introducedToday: 0, dailyCap: 4, rng });
    expect(q.map((x) => x.rung).sort()).toEqual([1, 1, 1, 1, 2, 2]);
    expect(longestRun(q.map((x) => x.rung))).toBeLessThanOrEqual(2);
  });

  it('[SES-07] spreads the minority rung when a run of 2 is impossible', () => {
    // 3 due L2 reviews ahead of 15 new L1 items: the best longest run is ceil(15 / 4) = 4.
    const progress: Record<string, ItemProgress> = {};
    for (let i = 0; i < 3; i++) {
      const p = dueProgress(cid(i), 1, 5 - i);
      progress[cid(i)] = { ...p, rung: 2, highestRung: 2, cards: { 2: p.cards[1]! } };
    }
    const q = buildSession({ curriculum: cur, progress, now: NOW, introducedToday: 0, dailyCap: 15, rng });
    const rungs = q.map((x) => x.rung);
    expect(rungs).toHaveLength(18);
    expect(longestRun(rungs)).toBe(4);
    expect(rungs.slice(0, 4)).not.toEqual([2, 2, 2, 1]);
    expect(rungs.lastIndexOf(2)).toBeGreaterThan(8);
  });

  it('[SES-07, SES-C02] reaches the smallest achievable longest run (at least 2) for every mix', () => {
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
    const rungOf = [1, 2, 3] as const;
    for (let len = 1; len <= 7; len++) {
      for (let code = 0; code < 3 ** len; code++) {
        const mix = Array.from({ length: len }, (_, i) => Math.floor(code / 3 ** i) % 3);
        const progress: Record<string, ItemProgress> = {};
        mix.forEach((d, i) => (progress[cid(i)] = dueProgress(cid(i), rungOf[d]!, 20 - i)));
        const q = buildSession({ curriculum: cur, progress, now: NOW, introducedToday: DAILY_NEW_CAP, rng });
        const rungs = q.map((x) => x.rung);
        expect(rungs, mix.join('')).toHaveLength(len);
        // The target is max(2, best); a mix whose best is 1 (a single item, strict alternation) may
        // also come out below 2, so only a best above 2 must be matched exactly.
        const want = best(rungs);
        expect(longestRun(rungs), mix.join('')).toBeLessThanOrEqual(Math.max(2, want));
        if (want > 2) expect(longestRun(rungs), mix.join('')).toBe(want);
      }
    }
    // Brute force: ~0.5 s alone, but it timed out at the 5 s default on a heavily loaded machine.
  }, 30_000);

  it('[SES-07] keeps a single-rung queue intact when there is nothing to interleave with', () => {
    const q = buildSession({ curriculum: cur, progress: {}, now: NOW, introducedToday: 0, rng });
    expect(longestRun(q.map((x) => x.rung))).toBe(DAILY_NEW_CAP);
  });
});

describe('[SES-C02] dueQuestions', () => {
  const cur = fixture(10);

  it('lists due reviews only, most overdue first, ties by id, without new items', () => {
    const progress = {
      [cid(3)]: dueProgress(cid(3), 1, 1),
      [cid(1)]: dueProgress(cid(1), 2, 5),
      [cid(2)]: dueProgress(cid(2), 3, 1),
      [cid(4)]: dueProgress(cid(4), 1, -2),
    };
    expect(dueQuestions({ curriculum: cur, progress, now: NOW })).toEqual([
      { itemId: cid(1), rung: 2 },
      { itemId: cid(2), rung: 3 },
      { itemId: cid(3), rung: 1 },
    ]);
  });

  it('is what buildSession puts first', () => {
    const progress = { [cid(1)]: dueProgress(cid(1), 2, 5) };
    const due = dueQuestions({ curriculum: cur, progress, now: NOW });
    const session = buildSession({ curriculum: cur, progress, now: NOW, introducedToday: 0 });
    expect(session).toContainEqual(due[0]);
    expect(session.length).toBeGreaterThan(due.length);
  });
});

describe('[SES-C01] session constants', () => {
  it('match the spec', () => {
    expect({
      DAILY_NEW_CAP: config.DAILY_NEW_CAP,
      SESSION_MAX_RUN: config.SESSION_MAX_RUN,
      SESSION_ROUND_SIZE: config.SESSION_ROUND_SIZE,
      SESSION_REQUEUE_GAP: config.SESSION_REQUEUE_GAP,
      SESSION_MAX_ASKS_PER_ITEM: config.SESSION_MAX_ASKS_PER_ITEM,
    }).toEqual({
      DAILY_NEW_CAP: 15,
      SESSION_MAX_RUN: 2,
      SESSION_ROUND_SIZE: 20,
      SESSION_REQUEUE_GAP: 3,
      SESSION_MAX_ASKS_PER_ITEM: 6,
    });
  });
});
