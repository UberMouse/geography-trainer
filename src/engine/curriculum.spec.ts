import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import {
  bandDifficulty,
  buildCurriculum,
  itemState,
  masteredShare,
  newItems,
  regionsFromPlaces,
  subtreeProgress,
  tierCounts,
  unlockedBy,
  unlockedItems,
  type Curriculum,
} from './curriculum';
import realPlaces from '../../public/data/places.json';
import realCountries from '../../public/data/countries.topo.json';
import { applyAnswer, createProgress, localDayKey, seedFromPlacement, type ItemProgress } from './srs';
import type { Country, Place, Region } from './types';

const T0 = new Date('2026-03-01T00:00:00Z');
const DAY = 86_400_000;

/** An item that has passed L3 on two different days. */
function mastered(itemId: string): ItemProgress {
  let p = createProgress(itemId, T0);
  for (let day = 0; day < 40 && p.l3PassDays.length < 2; day++) {
    const now = new Date(T0.getTime() + day * DAY);
    p = applyAnswer(p, p.rung, Rating.Good, now, localDayKey(now, 0));
  }
  expect(p.l3PassDays.length).toBeGreaterThanOrEqual(2);
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

  it("bands countries among countries and regions among their country's, and counts places per country", () => {
    const c = fixture();
    expect(c.items.get('place:brest')!.difficulty).toBe(3);
    // germany (2 places, mean 1.5), france (3, mean 3), tuvalu (1, mean 3): bands 1, 3, 6 of 8.
    expect(c.items.get('country:germany')!.difficulty).toBe(1);
    expect(c.items.get('country:france')!.difficulty).toBe(3);
    expect(c.items.get('country:tuvalu')!.difficulty).toBe(6);
    // bretagne (2, mean 2.5) before corse (1, mean 4) within france; bayern alone in germany.
    expect(c.items.get('region:france.bretagne')!.difficulty).toBe(1);
    expect(c.items.get('region:france.corse')!.difficulty).toBe(5);
    expect(c.items.get('region:germany.bayern')!.difficulty).toBe(1);
    expect(c.countryPlaceCount.get('country:france')).toBe(3);
  });

  it('gives a country and a region the spherical mean of its places as its centre', () => {
    const c = buildCurriculum(
      [country('fiji', 2, false)],
      [],
      [
        { ...place('a', 'fiji', null, 1), lng: 179, lat: -17 },
        { ...place('b', 'fiji', null, 1), lng: -179, lat: -17 },
      ],
    );
    const [lng, lat] = c.items.get('country:fiji')!.center!;
    // Across the antimeridian: 180, not 0.
    expect(Math.abs(Math.abs(lng) - 180)).toBeLessThan(1e-6);
    expect(lat).toBeCloseTo(-17, 1);
    expect(c.items.get('place:a')!.center).toEqual([179, -17]);
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
    expect(p.inL3Lapse).toBe(true);
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
    // b and c (3 places, mean 4) rank before a (1 place, mean 2), b before c by id (c is inserted
    // first, so only the id key can put b ahead).
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
    // Difficulties: bretagne 1 (france has 3 places), germany 1 (2 places), corse 5, tuvalu 6
    // (the empty crozet is not an item).
    expect(got).toEqual([
      'region:france.bretagne',
      'country:germany',
      'region:france.corse',
      'country:tuvalu',
    ]);
  });
});

describe('bandDifficulty', () => {
  it('cuts the ranking into 8 equal bands, easiest first, and gives an item with no places Infinity', () => {
    const stats = new Map<string, { count: number; meanLevel: number }>(
      Array.from({ length: 16 }, (_, i) => [`c${String(i).padStart(2, '0')}`, { count: 16 - i, meanLevel: 3 }] as const),
    );
    stats.set('empty', { count: 0, meanLevel: 0 });
    const bands = bandDifficulty(stats);
    expect(bands.get('c00')).toBe(1);
    expect(bands.get('c01')).toBe(1);
    expect(bands.get('c02')).toBe(2);
    expect(bands.get('c15')).toBe(8);
    expect(bands.get('empty')).toBe(Infinity);
  });

  it('weighs place levels too: fewer, harder places rank harder', () => {
    const bands = bandDifficulty(
      new Map([
        ['famous', { count: 10, meanLevel: 3 }],
        ['obscure', { count: 10, meanLevel: 7 }],
      ]),
    );
    expect(bands.get('famous')!).toBeLessThan(bands.get('obscure')!);
  });
});

describe('regionsFromPlaces', () => {
  const cs = [country('france', 0, true), country('tuvalu', 0, false)];
  it('lists each region once in first-seen order, skipping null regions and regionless countries', () => {
    const ps = [
      place('a', 'france', 'france.corse', 1),
      place('b', 'france', null, 1),
      place('c', 'tuvalu', 'tuvalu.x', 1),
      place('d', 'france', 'france.bretagne', 1),
      place('e', 'france', 'france.corse', 1),
    ];
    expect(regionsFromPlaces(cs, ps)).toEqual([
      { id: 'france.corse', country: 'france' },
      { id: 'france.bretagne', country: 'france' },
    ]);
  });
});

describe('the committed data', () => {
  it('builds a curriculum', () => {
    const geoms = (
      realCountries as unknown as {
        objects: { countries: { geometries: { id: string; properties: { hasRegions: boolean } }[] } };
      }
    ).objects.countries.geometries;
    const all = geoms.map((g) => country(g.id, 0, g.properties.hasRegions));
    const ps = realPlaces as unknown as Place[];
    const regions = regionsFromPlaces(all, ps);
    expect(regions.length).toBeGreaterThan(0);
    const c = buildCurriculum(all, regions, ps);
    expect(c.items.size).toBeGreaterThan(ps.length);

    // Countries spread evenly over the 8 bands, famous ones at the easy end.
    const countries = [...c.items.values()].filter((i) => i.tier === 'country' && Number.isFinite(i.difficulty));
    for (let band = 1; band <= 8; band++) {
      const n = countries.filter((i) => i.difficulty === band).length;
      expect(n, `band ${band}`).toBeGreaterThanOrEqual(Math.floor(countries.length / 8));
      expect(n, `band ${band}`).toBeLessThanOrEqual(Math.ceil(countries.length / 8));
    }
    const level = (id: string) => c.items.get(`country:${id}`)!.difficulty;
    for (const id of ['united-states', 'china', 'brazil', 'japan', 'france']) expect(level(id), id).toBe(1);
    for (const id of ['djibouti', 'lithuania', 'paraguay']) expect(level(id), id).toBeGreaterThanOrEqual(4);
    expect(level('tuvalu')).toBeGreaterThanOrEqual(7);
  }, 30_000);
});

describe('itemState', () => {
  it('is locked until the parent is mastered, then new, learning or mastered', () => {
    const c = fixture();
    const franceDone = { 'country:france': mastered('country:france') };
    expect(itemState(c, {}, 'country:france')).toBe('new');
    expect(itemState(c, {}, 'region:france.corse')).toBe('locked');
    expect(itemState(c, franceDone, 'country:france')).toBe('mastered');
    expect(itemState(c, franceDone, 'region:france.corse')).toBe('new');
    expect(itemState(c, franceDone, 'region:germany.bayern')).toBe('locked');
    expect(itemState(c, franceDone, 'place:rennes')).toBe('locked');
    const fresh = createProgress('country:germany', T0);
    const answered = applyAnswer(fresh, fresh.rung, Rating.Good, T0, localDayKey(T0, 0));
    expect(itemState(c, { 'country:germany': answered }, 'country:germany')).toBe('learning');
    expect(itemState(c, { 'country:germany': fresh }, 'country:germany')).toBe('new');
  });

  it("unlocks a regionless country's places directly, and a region's places once it is mastered", () => {
    const c = fixture();
    expect(itemState(c, {}, 'place:funafuti')).toBe('locked');
    expect(itemState(c, { 'country:tuvalu': mastered('country:tuvalu') }, 'place:funafuti')).toBe('new');
    const p = { 'region:france.bretagne': mastered('region:france.bretagne') };
    expect(itemState(c, p, 'place:rennes')).toBe('new');
    expect(itemState(c, p, 'place:ajaccio')).toBe('locked');
  });

  it('throws for an unknown id', () => {
    expect(() => itemState(fixture(), {}, 'country:nowhere')).toThrow(Error);
  });
});

describe('subtreeProgress and masteredShare', () => {
  it('counts every descendant, with unlocked meaning not locked', () => {
    const c = fixture();
    const p = {
      'country:france': mastered('country:france'),
      'region:france.bretagne': mastered('region:france.bretagne'),
      'place:rennes': mastered('place:rennes'),
    };
    const s = subtreeProgress(c, p, 'country:france');
    // regions: bretagne (mastered), corse (new); places: rennes (mastered), brest (new), ajaccio (locked)
    expect(s).toEqual({ total: 5, mastered: 2, learning: 0, unlocked: 4 });
    expect(masteredShare(s)).toBeCloseTo(0.4);
    expect(subtreeProgress(c, {}, 'country:germany')).toEqual({
      total: 3,
      mastered: 0,
      learning: 0,
      unlocked: 0,
    });
  });

  it('is empty for a place, with a share of 0, and throws for an unknown id', () => {
    const s = subtreeProgress(fixture(), {}, 'place:rennes');
    expect(s).toEqual({ total: 0, mastered: 0, learning: 0, unlocked: 0 });
    expect(masteredShare(s)).toBe(0);
    expect(() => subtreeProgress(fixture(), {}, 'region:x.y')).toThrow(Error);
  });
});

describe('tierCounts', () => {
  it('counts per tier, learning apart from learned, and ignores ids outside the curriculum', () => {
    const c = fixture();
    const started = createProgress('region:france.corse', T0);
    const learning = applyAnswer(started, started.rung, Rating.Good, T0, localDayKey(T0, 0));
    const t = tierCounts(c, {
      'country:france': mastered('country:france'),
      'region:france.corse': learning,
      'place:rennes': mastered('place:rennes'),
      'place:ghost': mastered('place:ghost'),
      'country:ghost': mastered('country:ghost'),
    });
    expect(t.country).toEqual({ total: 3, learning: 0, learned: 1 });
    expect(t.region).toEqual({ total: 3, learning: 1, learned: 0 });
    expect(t.place).toEqual({ total: 6, learning: 0, learned: 1 });
  });
});

describe('unlockedBy', () => {
  it('gives the children and their tier, null without children', () => {
    const c = fixture();
    expect(unlockedBy(c, 'country:france')).toEqual({
      tier: 'region',
      childIds: ['region:france.bretagne', 'region:france.corse'],
    });
    expect(unlockedBy(c, 'country:tuvalu')).toEqual({ tier: 'place', childIds: ['place:funafuti'] });
    expect(unlockedBy(c, 'region:france.corse')).toEqual({ tier: 'place', childIds: ['place:ajaccio'] });
    expect(unlockedBy(c, 'place:rennes')).toBeNull();
    expect(unlockedBy(buildCurriculum([country('x', 0, false)], [], []), 'country:x')).toBeNull();
    expect(() => unlockedBy(c, 'country:nowhere')).toThrow(Error);
  });

  it("master France: its regions are new, Germany's stay locked", () => {
    const c = fixture();
    const p = { 'country:france': mastered('country:france') };
    for (const id of unlockedBy(c, 'country:france')!.childIds) expect(itemState(c, p, id)).toBe('new');
    for (const id of unlockedBy(c, 'country:germany')!.childIds) expect(itemState(c, p, id)).toBe('locked');
  });
});
