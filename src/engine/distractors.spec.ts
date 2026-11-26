import { describe, expect, it } from 'vitest';
import {
  countryCandidates,
  distinctCandidates,
  multipleChoice,
  pickDistractors,
  placeCandidates,
  regionCandidates,
} from './distractors';
import { mulberry32 } from './rng';
import type { Place } from './types';

// Points along the equator: distance from the target (id "t", lng 0) grows with lng.
const target = { id: 't', lat: 0, lng: 0 };
const line = Array.from({ length: 12 }, (_, i) => ({
  id: `c${String(i).padStart(2, '0')}`,
  lat: 0,
  lng: i + 1,
}));
const nearest6 = line.slice(0, 6).map((c) => c.id);

describe('pickDistractors', () => {
  it('[GRD-23, GRD-C10] returns 3 distinct ids from the 6 nearest, never the target', () => {
    for (let seed = 0; seed < 50; seed++) {
      const out = pickDistractors(target, [{ ...target }, ...line], mulberry32(seed));
      expect(out).toHaveLength(3);
      expect(new Set(out).size).toBe(3);
      expect(out).not.toContain('t');
      for (const id of out) expect(nearest6).toContain(id);
    }
  });

  it('[GRD-22] is deterministic for a seed and varies across seeds', () => {
    const run = (seed: number) => pickDistractors(target, line, mulberry32(seed));
    expect(run(5)).toEqual(run(5));
    expect(new Set(Array.from({ length: 30 }, (_, s) => run(s).join())).size).toBeGreaterThan(1);
  });

  it('[GRD-23] breaks distance ties by id', () => {
    const tied = ['b', 'a', 'd', 'c'].map((id) => ({ id, lat: 0, lng: 1 }));
    // With count 1 the pool is the two lowest ids.
    for (let seed = 0; seed < 20; seed++) {
      expect(['a', 'b']).toContain(pickDistractors(target, tied, mulberry32(seed), 1)[0]);
    }
  });

  it('[GRD-C11] honours count', () => {
    expect(pickDistractors(target, line, mulberry32(1), 5)).toHaveLength(5);
  });

  it('[GRD-23] returns all candidates when there are fewer than count', () => {
    expect(pickDistractors(target, line.slice(0, 2), mulberry32(1)).sort()).toEqual(['c00', 'c01']);
    expect(pickDistractors(target, [], mulberry32(1))).toEqual([]);
  });
});

describe('[GRD-22] multipleChoice', () => {
  it('contains the target and distractors exactly once, deterministic per seed', () => {
    const out = multipleChoice('t', ['a', 'b', 'c'], mulberry32(9));
    expect([...out].sort()).toEqual(['a', 'b', 'c', 't']);
    expect(multipleChoice('t', ['a', 'b', 'c'], mulberry32(9))).toEqual(out);
  });

  it('puts the target in every position across seeds', () => {
    const positions = new Set<number>();
    for (let s = 0; s < 100; s++) {
      positions.add(multipleChoice('t', ['a', 'b', 'c'], mulberry32(s)).indexOf('t'));
    }
    expect(positions.size).toBe(4);
  });
});

const cand = (id: string, name: string, lng: number) => ({ id, name, lat: 0, lng });

describe('[GRD-24] distinctCandidates', () => {
  it('drops the target name and keeps the nearest candidate of each name', () => {
    const out = distinctCandidates(
      [
        cand('far', 'Twin', 9),
        cand('self', 'Me', 1),
        cand('near', 'Twin', 2),
        cand('o', 'Other', 5),
      ],
      'Me',
      [0, 0],
    );
    expect(out.map((c) => c.id)).toEqual(['near', 'o']);
  });
});

describe('[GRD-24, GRD-25] countryCandidates', () => {
  const rec = (id: string, name: string, lng: number) => ({ id, name, lat: 0, lng });

  it('offers every other country, namespaced, without the target or its name', () => {
    const out = countryCandidates(rec('a', 'A', 0), [
      rec('a', 'A', 0),
      rec('b', 'B', 1),
      rec('a2', 'A', 2),
      rec('c', 'C', 3),
    ]);
    expect(out.map((c) => c.id)).toEqual(['country:b', 'country:c']);
  });
});

describe('[GRD-25] regionCandidates', () => {
  const rec = (id: string, name: string, lng: number, places: number) => ({
    id,
    name,
    lat: 0,
    lng,
    places,
  });

  it('leaves out the target and regions without places', () => {
    const out = regionCandidates(rec('x.a', 'A', 0, 2), [
      rec('x.a', 'A', 0, 2),
      rec('x.b', 'B', 1, 0),
      rec('x.c', 'C', 2, 1),
      rec('x.d', 'D', 3, 4),
    ]);
    expect(out.map((c) => c.id)).toEqual(['region:x.c', 'region:x.d']);
  });
});

describe('[GRD-25] placeCandidates', () => {
  const place = (id: string, country: string, region: string | null, name = id): Place => ({
    id,
    name,
    country,
    region,
    lat: 0,
    lng: Number(id.replace(/\D/g, '')) || 0,
    type: 'city',
    level: 1,
  });
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

  const target = place('p0', 'c1', 'r1');
  const regionMates = [place('p1', 'c1', 'r1'), place('p2', 'c1', 'r1'), place('p3', 'c1', 'r1')];
  const countryMates = [place('p4', 'c1', 'r2'), place('p5', 'c1', null)];
  const elsewhere = [place('p6', 'c2', 'r3'), place('p7', 'c2', null)];

  it('uses the region when it has enough other places', () => {
    const out = placeCandidates(target, [target, ...regionMates, ...countryMates, ...elsewhere]);
    expect(ids(out)).toEqual(['place:p1', 'place:p2', 'place:p3']);
  });

  it('widens to the country, then to every place', () => {
    expect(
      ids(placeCandidates(target, [target, regionMates[0]!, ...countryMates, ...elsewhere])),
    ).toEqual(['place:p1', 'place:p4', 'place:p5']);
    expect(
      ids(placeCandidates(target, [target, regionMates[0]!, countryMates[0]!, ...elsewhere])),
    ).toEqual(['place:p1', 'place:p4', 'place:p6', 'place:p7']);
  });

  it('starts at the country when the place has no region', () => {
    const lone = place('p0', 'c1', null);
    const out = placeCandidates(lone, [lone, ...regionMates, ...countryMates, ...elsewhere]);
    expect(ids(out)).toEqual(['place:p1', 'place:p2', 'place:p3', 'place:p4', 'place:p5']);
  });

  it('[GRD-C10] drops places within PLACE_EASY_KM of the target before widening', () => {
    // One degree of latitude is about 111 km: 0.09 degrees is 10 km, 0.27 degrees is 30 km.
    const at = (id: string, lat: number, region: string | null = 'r1', country = 'c1'): Place => ({
      ...place(id, country, region),
      lat,
      lng: 0,
    });
    const t = at('p0', 0);
    const near = at('p1', 0.09);
    const far = at('p2', 0.27);
    const out = placeCandidates(t, [t, near, far, ...countryMates, ...elsewhere]);
    expect(ids(out)).not.toContain('place:p1');
    // The region keeps only one far-enough place, so it widens to the country (near stays out).
    expect(ids(out)).toEqual(['place:p2', 'place:p4', 'place:p5']);
  });

  it('[GRD-24] dedupes a pool by name before testing its size', () => {
    const twins = ['p1', 'p2', 'p3'].map((id) => place(id, 'c1', 'r1', 'Twin'));
    const out = placeCandidates(target, [target, ...twins, ...countryMates, ...elsewhere]);
    expect(ids(out)).toEqual(['place:p1', 'place:p4', 'place:p5']);
  });
});
