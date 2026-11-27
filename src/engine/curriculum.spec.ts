import { describe, expect, it } from 'vitest';
import { Rating, type Grade } from 'ts-fsrs';
import {
  bandDifficulty,
  buildCurriculum,
  countryGate,
  gateOpen,
  itemState,
  masteredCountryCount,
  masteredShare,
  newItems,
  regionsFromPlaces,
  subtreeProgress,
  tierCounts,
  unlockedBy,
  unlockedItems,
  type Curriculum,
  type CurriculumItem,
} from './curriculum';
import realPlaces from '../../public/data/places.json';
import realCountries from '../../public/data/countries.topo.json';
import {
  DEEPER_TIER_ORDER_OFFSET,
  DIFFICULTY_LEVELS,
  DIFFICULTY_MEAN_LEVEL_WEIGHT,
  GATE_WAVE1_MASTERED_COUNTRIES,
  GATE_WAVE1_MIN_PLACES,
  GATE_WAVE2_MASTERED_COUNTRIES,
  REGIONS_TIER_MIN_PLACES,
  REGIONS_TIER_MIN_REGIONS,
} from './config';
import { applyAnswer, createProgress, isMastered, localDayKey, seedFromPlacement, type ItemProgress } from './srs';
import type { Country, Place, Region } from './types';
import { gateFillers, withFillersMastered } from './gateFixtures';

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

/** France, Germany and Tuvalu, plus `fillers` (placeless countries, see `gateFillers`). */
function fixture(fillers: readonly Country[] = []): Curriculum {
  return buildCurriculum(
    [country('france', 3, true), country('germany', 2, true), country('tuvalu', 1, false), ...fillers],
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

/** Enough placeless countries to open every gate (CUR-21) once they are all mastered. */
const FILLERS = gateFillers();
/** The fixture with FILLERS in it, so that `opened` can open every gate. */
const gated = () => fixture(FILLERS);
/** `progress` with every filler country mastered: every gate of `gated()` is open. */
const opened = (progress: Readonly<Record<string, ItemProgress>>) =>
  withFillersMastered(progress, mastered('country:filler'), FILLERS);

describe('buildCurriculum', () => {
  it('[CUR-03, CUR-C04] namespaces ids and wires country -> region -> place, or country -> place', () => {
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

  it('[CUR-05, CUR-C04] keeps ids of different tiers from colliding', () => {
    const c = buildCurriculum([country('x', 1, false)], [], [place('x', 'x', null, 1)]);
    expect(c.items.size).toBe(2);
  });

  it("[CUR-20, CUR-C03] bands countries among countries and regions among their country's, and counts places per country", () => {
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

  it('[CUR-07] gives a country and a region the spherical mean of its places as its centre', () => {
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

  it('[CUR-03, CUR-C05] leaves out regions with no places, including those of a country without a regions tier', () => {
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

  it('[CUR-06, CUR-C05] throws on a place with an unknown country or a missing region', () => {
    const cs = [country('france', 1, true)];
    const rs = [region('france.a', 'france', 1)];
    expect(() => buildCurriculum(cs, rs, [place('p', 'spain', null, 1)])).toThrow(/unknown country/);
    expect(() => buildCurriculum(cs, rs, [place('p', 'france', null, 1)])).toThrow(/region/);
    expect(() => buildCurriculum(cs, rs, [place('p', 'france', 'france.zzz', 1)])).toThrow(/region/);
  });

  it('[CUR-06] throws on a place whose region belongs to another country', () => {
    const cs = [country('france', 1, true), country('germany', 1, true)];
    const rs = [region('france.a', 'france', 1), region('germany.bayern', 'germany', 1)];
    expect(() => buildCurriculum(cs, rs, [place('p', 'france', 'germany.bayern', 1)])).toThrow(
      /p.*germany\.bayern.*france/,
    );
  });
});

describe('[CUR-06] buildCurriculum duplicates', () => {
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
  it('[CUR-01, CUR-C06] unlocks every country and nothing else at the start', () => {
    expect(ids(unlockedItems(fixture(), {}))).toEqual(['country:france', 'country:germany', 'country:tuvalu']);
  });

  it("[CUR-08] mastering France unlocks its regions but not Germany's", () => {
    const got = ids(unlockedItems(gated(), opened({ 'country:france': mastered('country:france') })));
    expect(got).toContain('region:france.bretagne');
    expect(got).toContain('region:france.corse');
    expect(got).not.toContain('region:france.crozet');
    expect(got).not.toContain('region:germany.bayern');
    expect(got).not.toContain('place:rennes');
  });

  it('[CUR-10] does not unlock children of an item that is in progress but not mastered', () => {
    const got = ids(unlockedItems(fixture(), { 'country:france': createProgress('country:france', T0) }));
    expect(got).not.toContain('region:france.bretagne');
  });

  it('[CUR-08] mastering a country with no regions tier unlocks its places', () => {
    const got = ids(unlockedItems(gated(), opened({ 'country:tuvalu': mastered('country:tuvalu') })));
    expect(got).toContain('place:funafuti');
  });

  it('[CUR-09] mastering a region unlocks its places', () => {
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

  it('[CUR-11] keeps children unlocked after a lapse on the mastered parent', () => {
    let p = mastered('country:tuvalu');
    p = applyAnswer(p, p.rung, Rating.Again, new Date(T0.getTime() + 50 * DAY), 'later');
    expect(p.inL3Lapse).toBe(true);
    expect(ids(unlockedItems(gated(), opened({ 'country:tuvalu': p })))).toContain('place:funafuti');
  });

  it('[CUR-12] filters places by type but never countries or regions', () => {
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

describe('[CUR-12] place-type filter and regions', () => {
  const cur = buildCurriculum(
    [country('france', 3, true), ...FILLERS],
    [region('france.isles', 'france', 1), region('france.towns', 'france', 2)],
    [
      place('i1', 'france', 'france.isles', 2, 'island'),
      place('t1', 'france', 'france.towns', 2, 'island'),
      place('t2', 'france', 'france.towns', 3, 'city'),
    ],
  );
  const progress = opened({ 'country:france': mastered('country:france') });
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
  it('[CUR-18] excludes items that have been answered', () => {
    const progress = {
      'country:france': applyAnswer(createProgress('country:france', T0), 1, Rating.Good, T0, localDayKey(T0, 0)),
    };
    expect(ids(newItems(fixture(), progress))).not.toContain('country:france');
  });

  it('[CUR-18, CUR-C06] keeps unanswered progress as new: a placement seed without a pass', () => {
    const progress = {
      'country:france': seedFromPlacement('country:france', 'untestedAtOrBelow', T0, '2026-03-01'),
      'country:germany': seedFromPlacement('country:germany', 'passed', T0, '2026-03-01'),
    };
    const got = ids(newItems(fixture(), progress));
    expect(got).toContain('country:france');
    expect(got).not.toContain('country:germany');
  });

  it('[CUR-19, CUR-C06] orders by difficulty, then country place count descending, then id', () => {
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

  it('[CUR-12] applies the place-type filter to unlocked places', () => {
    const progress = {
      'country:france': mastered('country:france'),
      'region:france.bretagne': mastered('region:france.bretagne'),
    };
    const got = ids(newItems(fixture(), progress, { placeTypes: new Set(['monument']) }));
    expect(got).toContain('place:brest');
    expect(got).not.toContain('place:rennes');
  });

  it('[CUR-19] sorts across tiers and ignores the place-type filter for difficulty and counts', () => {
    const progress = opened({ 'country:france': mastered('country:france') });
    const got = ids(newItems(gated(), progress, { placeTypes: new Set(['city', 'monument', 'capital']) }));
    // Difficulties: germany 1, tuvalu 6; bretagne 1 and corse 5, each counting 3 more as a region
    // (the empty crozet is not an item).
    expect(got).toEqual([
      'country:germany',
      'region:france.bretagne',
      'country:tuvalu',
      'region:france.corse',
    ]);
  });
});

describe('bandDifficulty', () => {
  it('[CUR-20, CUR-C03] cuts the ranking into 8 equal bands, easiest first, and gives an item with no places Infinity', () => {
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

  it('[CUR-20] weighs place levels too: fewer, harder places rank harder', () => {
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
  it('[CUR-03, CUR-C05] lists each region once in first-seen order, skipping null regions and regionless countries', () => {
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
  it('[CUR-20] builds a curriculum', () => {
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
  it('[CUR-14, CUR-C07] is locked until the parent is mastered, then new, learning or mastered', () => {
    const c = gated();
    const franceDone = opened({ 'country:france': mastered('country:france') });
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

  it("[CUR-14] unlocks a regionless country's places directly, and a region's places once it is mastered", () => {
    const c = gated();
    expect(itemState(c, {}, 'place:funafuti')).toBe('locked');
    expect(itemState(c, opened({ 'country:tuvalu': mastered('country:tuvalu') }), 'place:funafuti')).toBe('new');
    const p = { 'region:france.bretagne': mastered('region:france.bretagne') };
    expect(itemState(c, p, 'place:rennes')).toBe('new');
    expect(itemState(c, p, 'place:ajaccio')).toBe('locked');
  });

  it('[CUR-C07] throws for an unknown id', () => {
    expect(() => itemState(fixture(), {}, 'country:nowhere')).toThrow(Error);
  });
});

describe('subtreeProgress and masteredShare', () => {
  it('[CUR-15, CUR-C07] counts every descendant, with unlocked meaning not locked', () => {
    const c = gated();
    const p = opened({
      'country:france': mastered('country:france'),
      'region:france.bretagne': mastered('region:france.bretagne'),
      'place:rennes': mastered('place:rennes'),
    });
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

  it('[CUR-15] is empty for a place, with a share of 0, and throws for an unknown id', () => {
    const s = subtreeProgress(fixture(), {}, 'place:rennes');
    expect(s).toEqual({ total: 0, mastered: 0, learning: 0, unlocked: 0 });
    expect(masteredShare(s)).toBe(0);
    expect(() => subtreeProgress(fixture(), {}, 'region:x.y')).toThrow(Error);
  });
});

describe('tierCounts', () => {
  it('[CUR-16, CUR-C07] counts per tier, learning apart from learned, and ignores ids outside the curriculum', () => {
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
  it('[CUR-17, CUR-C07] gives the children and their tier, null without children', () => {
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

  it("[CUR-08, CUR-14] master France: its regions are new, Germany's stay locked", () => {
    const c = gated();
    const p = opened({ 'country:france': mastered('country:france') });
    for (const id of unlockedBy(c, 'country:france')!.childIds) expect(itemState(c, p, id)).toBe('new');
    for (const id of unlockedBy(c, 'country:germany')!.childIds) expect(itemState(c, p, id)).toBe('locked');
  });
});

/** The committed countries, with each country's `hasRegions` as generated. */
function committedCountries(): Country[] {
  const geoms = (
    realCountries as unknown as {
      objects: { countries: { geometries: { id: string; properties: { hasRegions: boolean } }[] } };
    }
  ).objects.countries.geometries;
  return geoms.map((g) => country(g.id, 0, g.properties.hasRegions));
}

describe('[DAT-21, CUR-C01] the regions tier', () => {
  it('needs 4 regions holding a place and 15 places', () => {
    expect(REGIONS_TIER_MIN_REGIONS).toBe(4);
    expect(REGIONS_TIER_MIN_PLACES).toBe(15);
  });

  it('is given in the committed data to exactly the countries that meet both thresholds', () => {
    const ps = realPlaces as unknown as Place[];
    const regionsOf = new Map<string, Set<string>>();
    const placesOf = new Map<string, number>();
    for (const p of ps) {
      placesOf.set(p.country, (placesOf.get(p.country) ?? 0) + 1);
      if (p.region !== null) regionsOf.set(p.country, (regionsOf.get(p.country) ?? new Set()).add(p.region));
    }
    const all = committedCountries();
    const tier = all.filter((c) => c.hasRegions).map((c) => c.id);
    const meets = all
      .filter(
        (c) =>
          (regionsOf.get(c.id)?.size ?? 0) >= REGIONS_TIER_MIN_REGIONS &&
          (placesOf.get(c.id) ?? 0) >= REGIONS_TIER_MIN_PLACES,
      )
      .map((c) => c.id);
    expect(tier.length).toBeGreaterThan(0);
    expect(tier.length).toBeLessThan(all.length);
    expect(tier).toEqual(meets);
  });
});

describe('[CUR-04] landmarks on the committed data', () => {
  it('makes every place type a place item under its region or country, as a city is', { timeout: 30_000 }, () => {
    const all = committedCountries();
    const ps = realPlaces as unknown as Place[];
    const c = buildCurriculum(all, regionsFromPlaces(all, ps), ps);
    const tiered = new Set(all.filter((x) => x.hasRegions).map((x) => x.id));
    const types = new Set<string>();
    for (const p of ps) {
      types.add(p.type);
      const item = c.items.get(`place:${p.id}`)!;
      expect(item.tier).toBe('place');
      expect(item.parent).toBe(tiered.has(p.country) ? `region:${p.region}` : `country:${p.country}`);
      expect(c.items.get(item.parent!)!.children).toContain(item.id);
    }
    for (const t of ['city', 'capital', 'monument', 'mountain', 'island', 'natural_wonder', 'national_park']) {
      expect(types, t).toContain(t);
    }
  });
});

describe('[GRD-15, CUR-14] mastery', () => {
  const ID = 'country:tuvalu';
  const answerOn = (p: ItemProgress, day: number, rating: Grade = Rating.Good) => {
    const now = new Date(T0.getTime() + day * DAY);
    return applyAnswer(p, p.rung, rating, now, localDayKey(now, 0));
  };
  /** Climbed to the top rung on day 0, with no pass there yet. */
  const atTopRung = () => {
    const p = answerOn(answerOn(createProgress(ID, T0), 0), 0);
    expect(p.rung).toBe(3);
    expect(p.l3PassDays).toEqual([]);
    return p;
  };
  const stateOf = (p: ItemProgress) => itemState(fixture(), { [ID]: p }, ID);

  it.each([
    [1, 'learning'],
    [2, 'mastered'],
  ] as const)('an item that passed the top rung on %d day(s) is %s', (days, state) => {
    let p = atTopRung();
    for (let d = 0; d < days; d++) p = answerOn(p, d * 3);
    expect(p.l3PassDays).toHaveLength(days);
    expect(stateOf(p)).toBe(state);
  });

  it('counts two passes on one day once', () => {
    const p = answerOn(answerOn(atTopRung(), 0), 0);
    expect(p.l3PassDays).toHaveLength(1);
    expect(isMastered(p)).toBe(false);
    expect(stateOf(p)).toBe('learning');
  });

  it('keeps mastery through a later miss', () => {
    const p = answerOn(answerOn(answerOn(atTopRung(), 0), 3), 30, Rating.Again);
    expect(p.rung).toBe(2);
    expect(isMastered(p)).toBe(true);
    expect(stateOf(p)).toBe('mastered');
  });
});

/** The United States (629 places over 4 regions), Poland (41 places over 4 regions), Tuvalu (1
 * place, no regions tier) and FILLERS. */
function gateWorld(): Curriculum {
  const regionsOf = (c: string) => Array.from({ length: 4 }, (_, r) => region(`${c}.r${r}`, c, 0));
  const placesOf = (c: string, n: number, withRegions: boolean) =>
    Array.from({ length: n }, (_, i) => place(`${c}-${i}`, c, withRegions ? `${c}.r${i % 4}` : null, 1 + (i % 5)));
  return buildCurriculum(
    [country('united-states', 629, true), country('poland', 41, true), country('tuvalu', 1, false), ...FILLERS],
    [...regionsOf('united-states'), ...regionsOf('poland')],
    [...placesOf('united-states', 629, true), ...placesOf('poland', 41, true), ...placesOf('tuvalu', 1, false)],
  );
}

/** `countryId` mastered, and fillers so that `total` countries are mastered in all; then `extra`. */
function masteredWith(
  countryId: string,
  total: number,
  extra: Readonly<Record<string, ItemProgress>> = {},
): Record<string, ItemProgress> {
  const own = { [countryId]: mastered(countryId), ...extra };
  return withFillersMastered(own, mastered('country:filler'), FILLERS.slice(0, total - 1));
}

const answeredOnce = (itemId: string) =>
  applyAnswer(createProgress(itemId, T0), 1, Rating.Good, T0, localDayKey(T0, 0));

describe('[CUR-21, CUR-C06, CUR-C08] the deeper-tier gate', () => {
  const c = gateWorld();

  it.each([
    ['united-states', 59, 'locked'],
    ['united-states', 60, 'unlocked'],
    ['poland', 60, 'locked'],
    ['poland', 149, 'locked'],
    ['poland', 150, 'unlocked'],
    ['tuvalu', 149, 'locked'],
    ['tuvalu', 150, 'unlocked'],
  ] as const)("%s with %i countries mastered: its children are %s", (id, total, state) => {
    const progress = masteredWith(`country:${id}`, total);
    expect(masteredCountryCount(c, progress)).toBe(total);
    const unlocked = new Set(ids(unlockedItems(c, progress)));
    const children = unlockedBy(c, `country:${id}`)!.childIds;
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(unlocked.has(child), child).toBe(state === 'unlocked');
      expect(itemState(c, progress, child) === 'locked', child).toBe(state === 'locked');
    }
  });

  it('is on the country\'s own children only: a mastered region unlocks its places as CUR-09 says', () => {
    const region = 'region:united-states.r0';
    const places = unlockedBy(c, region)!.childIds;
    const open = masteredWith('country:united-states', 60, { [region]: mastered(region) });
    expect(places.every((p) => ids(unlockedItems(c, open)).includes(p))).toBe(true);
    // A region answered behind a shut gate (CUR-22) and then mastered: its places have no gate.
    const shut = masteredWith('country:united-states', 1, { [region]: mastered(region) });
    const unlocked = ids(unlockedItems(c, shut));
    expect(unlocked).toContain(region);
    expect(places.every((p) => unlocked.includes(p))).toBe(true);
    expect(unlocked).not.toContain('region:united-states.r1');
  });

  it('stays open: a mastered country lapsing at the top rung is still mastered', () => {
    let us = mastered('country:united-states');
    us = applyAnswer(us, us.rung, Rating.Again, new Date(T0.getTime() + 50 * DAY), 'later');
    expect(us.inL3Lapse).toBe(true);
    const progress = { ...masteredWith('country:united-states', 60), 'country:united-states': us };
    expect(masteredCountryCount(c, progress)).toBe(60);
    expect(gateOpen(c, progress, 'country:united-states')).toBe(true);
    expect(ids(unlockedItems(c, progress))).toContain('region:united-states.r0');
  });
});

describe('[CUR-22, CUR-C06] the gate never locks an item already answered', () => {
  const c = gateWorld();
  const california = 'region:united-states.r0';

  it('keeps a region answered before the gate unlocked, in its state; the unanswered stay locked', () => {
    const progress = masteredWith('country:united-states', 10, { [california]: answeredOnce(california) });
    const unlocked = ids(unlockedItems(c, progress));
    expect(unlocked).toContain(california);
    expect(itemState(c, progress, california)).toBe('learning');
    for (const r of ['r1', 'r2', 'r3']) expect(unlocked).not.toContain(`region:united-states.${r}`);
  });

  it('counts a test-out pass as answered', () => {
    const progress = masteredWith('country:united-states', 10, {
      [california]: seedFromPlacement(california, 'passed', T0, '2026-03-01'),
    });
    expect(ids(unlockedItems(c, progress))).toContain(california);
  });

  it.each(['close', 'failed'] as const)('holds a region with only a %s seed', (outcome) => {
    const progress = masteredWith('country:united-states', 10, {
      [california]: seedFromPlacement(california, outcome, T0, '2026-03-01'),
    });
    expect(ids(unlockedItems(c, progress))).not.toContain(california);
    expect(itemState(c, progress, california)).toBe('locked');
  });
});

describe('[CUR-14, CUR-C07] a country\'s child while its gate is shut', () => {
  const c = gateWorld();

  it('is locked when never answered', () => {
    const progress = masteredWith('country:united-states', 1);
    expect(itemState(c, progress, 'region:united-states.r1')).toBe('locked');
    expect(subtreeProgress(c, progress, 'country:united-states').unlocked).toBe(0);
  });

  it('has the state it would have with the gate open once answered', () => {
    const r0 = 'region:united-states.r0';
    const extra = { [r0]: answeredOnce(r0) };
    const shut = masteredWith('country:united-states', 1, extra);
    const open = masteredWith('country:united-states', 60, extra);
    expect(itemState(c, shut, r0)).toBe('learning');
    expect(itemState(c, shut, r0)).toBe(itemState(c, open, r0));
  });
});

describe('[CUR-19, CUR-C06] a band-1 region sorts among band-4 countries', () => {
  it('orders a band-3 country, then the band-1 United States region, then a band-4 country', () => {
    const item = (id: string, parent: string | null, countryId: string, difficulty: number): CurriculumItem => ({
      id,
      tier: parent === null ? 'country' : 'region',
      parent,
      children: [],
      countryId,
      difficulty,
      center: null,
    });
    const us = 'country:united-states';
    const fillers = gateFillers(GATE_WAVE1_MASTERED_COUNTRIES - 1).map((f) => item(`country:${f.id}`, null, `country:${f.id}`, Infinity));
    const c: Curriculum = {
      items: new Map(
        [
          item('country:three', null, 'country:three', 3),
          item('country:four', null, 'country:four', 4),
          item(us, null, us, 1),
          item('region:united-states.ca', us, us, 1),
          ...fillers,
        ].map((i) => [i.id, i]),
      ),
      countryPlaceCount: new Map([
        ['country:three', 5],
        ['country:four', 10],
        [us, 629],
      ]),
    };
    const progress = withFillersMastered({ [us]: mastered(us) }, mastered('country:filler'), gateFillers(GATE_WAVE1_MASTERED_COUNTRIES - 1));
    expect(ids(newItems(c, progress))).toEqual(['country:three', 'region:united-states.ca', 'country:four']);
    expect(c.items.get('region:united-states.ca')!.difficulty).toBe(1);
  });
});

describe('[CUR-C08] gate constants and functions', () => {
  it('has the contract values', () => {
    expect(GATE_WAVE1_MIN_PLACES).toBe(50);
    expect(GATE_WAVE1_MASTERED_COUNTRIES).toBe(60);
    expect(GATE_WAVE2_MASTERED_COUNTRIES).toBe(150);
    expect(DEEPER_TIER_ORDER_OFFSET).toBe(3);
  });

  it('masteredCountryCount counts mastered country items only, ignoring ids not in items', () => {
    const c = fixture();
    const started = answeredOnce('country:germany');
    expect(
      masteredCountryCount(c, {
        'country:france': mastered('country:france'),
        'country:germany': started,
        'region:france.corse': mastered('region:france.corse'),
        'country:ghost': mastered('country:ghost'),
      }),
    ).toBe(1);
    expect(masteredCountryCount(c, {})).toBe(0);
  });

  it('countryGate is 60 from 50 places, else 150; gateOpen compares the count to it', () => {
    const c = buildCurriculum(
      [country('fifty', 50, false), country('fortynine', 49, false), ...FILLERS],
      [],
      [
        ...Array.from({ length: 50 }, (_, i) => place(`f${i}`, 'fifty', null, 1)),
        ...Array.from({ length: 49 }, (_, i) => place(`g${i}`, 'fortynine', null, 1)),
      ],
    );
    expect(countryGate(c, 'country:fifty')).toBe(60);
    expect(countryGate(c, 'country:fortynine')).toBe(150);
    expect(countryGate(c, 'country:filler-000')).toBe(150);
    const at = (n: number) => withFillersMastered({}, mastered('country:filler'), FILLERS.slice(0, n));
    expect(gateOpen(c, at(59), 'country:fifty')).toBe(false);
    expect(gateOpen(c, at(60), 'country:fifty')).toBe(true);
    expect(gateOpen(c, at(149), 'country:fortynine')).toBe(false);
    expect(gateOpen(c, at(150), 'country:fortynine')).toBe(true);
  });

  it('countryGate and gateOpen throw for an id that is not a country item', () => {
    const c = fixture();
    for (const id of ['region:france.corse', 'place:rennes', 'country:nowhere']) {
      expect(() => countryGate(c, id)).toThrow(Error);
      expect(() => gateOpen(c, {}, id)).toThrow(Error);
    }
  });
});

describe('[CUR-C03] difficulty constants', () => {
  it('bands into 8 levels, weighing the mean place level by 0.4', () => {
    expect(DIFFICULTY_LEVELS).toBe(8);
    expect(DIFFICULTY_MEAN_LEVEL_WEIGHT).toBe(0.4);
  });
});
