import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import {
  buildCountryCurriculum,
  buildCurriculum,
  newItems,
  unlockedItems,
  type Curriculum,
} from './curriculum';
import { applyAnswer, createProgress, localDayKey, seedFromPlacement, type ItemProgress } from './srs';
import type { Country, Place, Region } from './types';

const T0 = new Date('2026-03-01T00:00:00Z');
const DAY = 86_400_000;

/** An item that has passed L4 on two different days. */
function mastered(itemId: string): ItemProgress {
  let p = createProgress(itemId, T0);
  for (let day = 0; day < 40 && p.l4PassDays.length < 2; day++) {
    const now = new Date(T0.getTime() + day * DAY);
    p = applyAnswer(p, p.rung, Rating.Good, now, localDayKey(now, 0));
  }
  expect(p.l4PassDays.length).toBeGreaterThanOrEqual(2);
  return p;
}

const country = (id: string, places: number, hasRegions: boolean): Country => ({
  id,
  name: id,
  places,
  hasRegions,
});
const region = (id: string, c: string, places: number): Region => ({ id, name: id, country: c, places });
const place = (id: string, c: string, r: string | null, level: number, type = 'city'): Place => ({
  id,
  name: id,
  country: c,
  region: r,
  lat: 0,
  lng: 0,
  type,
  level,
});

function fixture(): Curriculum {
  return buildCurriculum(
    [country('france', 3, true), country('germany', 2, true), country('tuvalu', 1, false)],
    [
      region('france.bretagne', 'france', 2),
      region('france.crozet', 'france', 0),
      region('france.corse', 'france', 1),
      region('germany.bayern', 'germany', 2),
    ],
    [
      place('rennes', 'france', 'france.bretagne', 2, 'city'),
      place('brest', 'france', 'france.bretagne', 3, 'monument'),
      place('ajaccio', 'france', 'france.corse', 4, 'capital'),
      place('munich', 'germany', 'germany.bayern', 1, 'city'),
      place('nuremberg', 'germany', 'germany.bayern', 2, 'city'),
      place('funafuti', 'tuvalu', null, 3, 'capital'),
    ],
  );
}

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe('buildCurriculum', () => {
  it('namespaces ids and wires country -> region -> place, or country -> place', () => {
    const c = fixture();
    expect(c.items.get('country:france')!.children).toEqual([
      'region:france.bretagne',
      'region:france.corse',
    ]);
    expect(c.items.get('region:france.bretagne')!.children).toEqual(['place:rennes', 'place:brest']);
    expect(c.items.get('country:tuvalu')!.children).toEqual(['place:funafuti']);
    expect(c.items.get('place:funafuti')!.parent).toBe('country:tuvalu');
    expect(c.items.get('place:rennes')!.parent).toBe('region:france.bretagne');
    expect(c.items.get('country:france')!.parent).toBeNull();
  });

  it('keeps ids of different tiers from colliding', () => {
    const c = buildCurriculum([country('x', 1, false)], [], [place('x', 'x', null, 1)]);
    expect(c.items.size).toBe(2);
  });

  it('derives difficulty from the minimum place level and counts places per country', () => {
    const c = fixture();
    expect(c.items.get('place:brest')!.difficulty).toBe(3);
    expect(c.items.get('region:france.bretagne')!.difficulty).toBe(2);
    expect(c.items.get('country:france')!.difficulty).toBe(2);
    expect(c.items.get('region:france.corse')!.difficulty).toBe(4);
    expect(c.countryPlaceCount.get('country:france')).toBe(3);
  });

  it('leaves out regions with no places, including those of a country without a regions tier', () => {
    const c = buildCurriculum(
      [country('france', 1, true), country('tuvalu', 1, false)],
      [region('france.a', 'france', 1), region('france.empty', 'france', 0), region('tuvalu.x', 'tuvalu', 0)],
      [place('p', 'france', 'france.a', 1), place('q', 'tuvalu', null, 2)],
    );
    expect(c.items.has('region:france.empty')).toBe(false);
    expect(c.items.has('region:tuvalu.x')).toBe(false);
    expect(c.items.get('country:france')!.children).toEqual(['region:france.a']);
    expect(c.items.get('country:tuvalu')!.children).toEqual(['place:q']);
    expect(c.items.size).toBe(5);
  });

  it('throws on a place with an unknown country or a missing region', () => {
    const cs = [country('france', 1, true)];
    const rs = [region('france.a', 'france', 1)];
    expect(() => buildCurriculum(cs, rs, [place('p', 'spain', null, 1)])).toThrow(/unknown country/);
    expect(() => buildCurriculum(cs, rs, [place('p', 'france', null, 1)])).toThrow(/region/);
    expect(() => buildCurriculum(cs, rs, [place('p', 'france', 'france.zzz', 1)])).toThrow(/region/);
  });

  it('throws on a place whose region belongs to another country', () => {
    const cs = [country('france', 1, true), country('germany', 1, true)];
    const rs = [region('france.a', 'france', 1), region('germany.bayern', 'germany', 1)];
    expect(() => buildCurriculum(cs, rs, [place('p', 'france', 'germany.bayern', 1)])).toThrow(
      /p.*germany\.bayern.*france/,
    );
  });
});

describe('buildCurriculum duplicates', () => {
  it('throws on a duplicate country id', () => {
    expect(() => buildCurriculum([country('x', 0, false), country('x', 0, false)], [], [])).toThrow(
      /Duplicate country/,
    );
  });

  it('throws on a duplicate region id', () => {
    const cs = [country('x', 0, true)];
    expect(() => buildCurriculum(cs, [region('x.a', 'x', 0), region('x.a', 'x', 0)], [])).toThrow(
      /Duplicate region/,
    );
  });

  it('throws on a duplicate place id', () => {
    const cs = [country('x', 2, false)];
    expect(() => buildCurriculum(cs, [], [place('p', 'x', null, 1), place('p', 'x', null, 2)])).toThrow(
      /Duplicate place/,
    );
  });
});

describe('unlockedItems', () => {
  it('unlocks every country and nothing else at the start', () => {
    expect(ids(unlockedItems(fixture(), {}))).toEqual(['country:france', 'country:germany', 'country:tuvalu']);
  });

  it("mastering France unlocks its regions but not Germany's", () => {
    const got = ids(unlockedItems(fixture(), { 'country:france': mastered('country:france') }));
    expect(got).toContain('region:france.bretagne');
    expect(got).toContain('region:france.corse');
    expect(got).not.toContain('region:france.crozet');
    expect(got).not.toContain('region:germany.bayern');
    expect(got).not.toContain('place:rennes');
  });

  it('does not unlock children of an item that is in progress but not mastered', () => {
    const got = ids(unlockedItems(fixture(), { 'country:france': createProgress('country:france', T0) }));
    expect(got).not.toContain('region:france.bretagne');
  });

  it('mastering a country with no regions tier unlocks its places', () => {
    const got = ids(unlockedItems(fixture(), { 'country:tuvalu': mastered('country:tuvalu') }));
    expect(got).toContain('place:funafuti');
  });

  it('mastering a region unlocks its places', () => {
    const got = ids(
      unlockedItems(fixture(), {
        'country:france': mastered('country:france'),
        'region:france.bretagne': mastered('region:france.bretagne'),
      }),
    );
    expect(got).toContain('place:rennes');
    expect(got).toContain('place:brest');
    expect(got).not.toContain('place:ajaccio');
  });

  it('keeps children unlocked after a lapse on the mastered parent', () => {
    let p = mastered('country:tuvalu');
    p = applyAnswer(p, p.rung, Rating.Again, new Date(T0.getTime() + 50 * DAY), 'later');
    expect(p.inL4Lapse).toBe(true);
    expect(ids(unlockedItems(fixture(), { 'country:tuvalu': p }))).toContain('place:funafuti');
  });

  it('filters places by type but never countries or regions', () => {
    const progress = {
      'country:france': mastered('country:france'),
      'region:france.bretagne': mastered('region:france.bretagne'),
    };
    const got = ids(unlockedItems(fixture(), progress, { placeTypes: new Set(['monument']) }));
    expect(got).toContain('place:brest');
    expect(got).not.toContain('place:rennes');
    expect(got).toContain('country:germany');
    expect(got).toContain('region:france.bretagne');
    expect(ids(unlockedItems(fixture(), progress, { placeTypes: new Set() }))).not.toContain('place:brest');
  });
});

describe('place-type filter and regions', () => {
  const cur = buildCurriculum(
    [country('france', 3, true)],
    [region('france.isles', 'france', 1), region('france.towns', 'france', 2)],
    [
      place('i1', 'france', 'france.isles', 2, 'island'),
      place('t1', 'france', 'france.towns', 2, 'island'),
      place('t2', 'france', 'france.towns', 3, 'city'),
    ],
  );
  const progress = { 'country:france': mastered('country:france') };
  const city = { placeTypes: new Set(['city']) };

  it('hides a region with no place of the chosen types, keeps one with a match', () => {
    for (const got of [ids(unlockedItems(cur, progress, city)), ids(newItems(cur, progress, city))]) {
      expect(got).not.toContain('region:france.isles');
      expect(got).toContain('region:france.towns');
    }
  });

  it('shows both regions with no filter', () => {
    const got = ids(unlockedItems(cur, progress));
    expect(got).toContain('region:france.isles');
    expect(got).toContain('region:france.towns');
  });
});

describe('newItems', () => {
  it('excludes items that have been answered', () => {
    const progress = {
      'country:france': applyAnswer(createProgress('country:france', T0), 1, Rating.Good, T0, localDayKey(T0, 0)),
    };
    expect(ids(newItems(fixture(), progress))).not.toContain('country:france');
  });

  it('keeps unanswered progress as new: a placement seed without a pass', () => {
    const progress = {
      'country:france': seedFromPlacement('country:france', 'untestedAtOrBelow', T0, '2026-03-01'),
      'country:germany': seedFromPlacement('country:germany', 'passed', T0, '2026-03-01'),
    };
    const got = ids(newItems(fixture(), progress));
    expect(got).toContain('country:france');
    expect(got).not.toContain('country:germany');
  });

  it('orders by difficulty, then country place count descending, then id', () => {
    const c = buildCurriculum(
      [country('a', 1, false), country('c', 3, false), country('b', 3, false)],
      [],
      [
        place('pa', 'a', null, 2),
        place('pb1', 'b', null, 2),
        place('pb2', 'b', null, 5),
        place('pb3', 'b', null, 5),
        place('pc1', 'c', null, 2),
        place('pc2', 'c', null, 5),
        place('pc3', 'c', null, 5),
      ],
    );
    // All three countries have difficulty 2: b and c (3 places) before a (1), b before c by id
    // (c is inserted first, so only the id key can put b ahead).
    expect(ids(newItems(c, {}))).toEqual(['country:b', 'country:c', 'country:a']);
  });

  it('applies the place-type filter to unlocked places', () => {
    const progress = {
      'country:france': mastered('country:france'),
      'region:france.bretagne': mastered('region:france.bretagne'),
    };
    const got = ids(newItems(fixture(), progress, { placeTypes: new Set(['monument']) }));
    expect(got).toContain('place:brest');
    expect(got).not.toContain('place:rennes');
  });

  it('sorts across tiers and ignores the place-type filter for difficulty and counts', () => {
    const progress = { 'country:france': mastered('country:france') };
    const got = ids(newItems(fixture(), progress, { placeTypes: new Set(['city', 'monument', 'capital']) }));
    // Difficulties: germany 1, bretagne 2, tuvalu 3, corse 4 (the empty crozet is not an item).
    expect(got).toEqual([
      'country:germany',
      'region:france.bretagne',
      'country:tuvalu',
      'region:france.corse',
    ]);
  });
});

describe('buildCountryCurriculum', () => {
  const countries = [country('france', 3, true), country('germany', 2, true), country('tuvalu', 1, false)];
  const places = [
    place('rennes', 'france', 'france.bretagne', 2, 'city'),
    place('brest', 'france', 'france.bretagne', 3, 'monument'),
    place('ajaccio', 'france', 'france.corse', 4, 'capital'),
    place('munich', 'germany', 'germany.bayern', 1, 'city'),
    place('nuremberg', 'germany', 'germany.bayern', 2, 'city'),
    place('funafuti', 'tuvalu', null, 3, 'capital'),
  ];

  it('holds only childless country items, with difficulty and place counts equal to buildCurriculum', () => {
    const full = fixture();
    const c = buildCountryCurriculum(countries, places);
    expect([...c.items.keys()]).toEqual(['country:france', 'country:germany', 'country:tuvalu']);
    for (const item of c.items.values()) {
      expect(item.tier).toBe('country');
      expect(item.parent).toBeNull();
      expect(item.children).toEqual([]);
      expect(item.difficulty).toBe(full.items.get(item.id)!.difficulty);
    }
    expect(c.countryPlaceCount).toEqual(full.countryPlaceCount);
  });

  it('keeps the new-item order buildCurriculum gives the countries', () => {
    const order = ids(newItems(fixture(), {})).filter((id) => id.startsWith('country:'));
    expect(ids(newItems(buildCountryCurriculum(countries, places), {}))).toEqual(order);
  });

  it('gives a country with no places difficulty Infinity, and throws on bad input', () => {
    expect(buildCountryCurriculum([country('x', 0, false)], []).items.get('country:x')!.difficulty).toBe(
      Infinity,
    );
    expect(() => buildCountryCurriculum(countries, [place('p', 'nowhere', null, 1)])).toThrow();
    expect(() => buildCountryCurriculum([countries[0]!, countries[0]!], [])).toThrow();
  });
});
