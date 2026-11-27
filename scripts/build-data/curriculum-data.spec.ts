import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { GATE_WAVE1_MASTERED_COUNTRIES, GATE_WAVE2_MASTERED_COUNTRIES } from '../../src/engine/config';
import { buildCurriculum, countryGate, newItems } from '../../src/engine/curriculum';
import { applyAnswer, createProgress, localDayKey, type ItemProgress } from '../../src/engine/srs';
import type { Country, Place, Region } from '../../src/engine/types';

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

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe('[DAT-32, CUR-03, CUR-19] curriculum on the committed data', () => {
  const dir = new URL('../../public/data/', import.meta.url);
  const read = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const places: Place[] = read('places.json');
  const countryGeoms = read('countries.topo.json').objects.countries.geometries as {
    id: string;
    properties: { name: string; places: number; hasRegions: boolean };
  }[];
  const countries: Country[] = countryGeoms.map((g) => ({ id: g.id, ...g.properties }));
  const regions: Region[] = countries
    .filter((c) => c.hasRegions)
    .flatMap((c) => {
      const topo = read(`regions/${c.id}.topo.json`);
      const obj = Object.values(topo.objects)[0] as {
        geometries: { id: string; properties: { name: string; places: number } }[];
      };
      return obj.geometries.map((g) => ({ id: g.id, country: c.id, ...g.properties }));
    });

  it('builds, and puts London before Akron and the US before Tuvalu', () => {
    const c = buildCurriculum(countries, regions, places);
    const regionItems = [...c.items.values()].filter((i) => i.tier === 'region');
    expect(regionItems.length).toBeGreaterThan(0);
    expect(regionItems.length).toBeLessThan(regions.length);
    expect(regionItems.every((r) => r.children.length > 0)).toBe(true);
    expect(c.items.size).toBe(countries.length + regionItems.length + places.length);
    const progress: Record<string, ItemProgress> = {};
    for (const item of c.items.values()) {
      if (item.tier !== 'place') progress[item.id] = mastered(item.id);
    }
    const order = ids(newItems(c, progress));
    expect(order.indexOf('place:london')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('place:london')).toBeLessThan(order.indexOf('place:akron_ohio'));

    const fresh = ids(newItems(c, {}));
    expect(fresh.indexOf('country:united-states')).toBeGreaterThanOrEqual(0);
    expect(fresh.indexOf('country:united-states')).toBeLessThan(fresh.indexOf('country:tuvalu'));
  });

  it('[CUR-21] puts the 28 countries with 50 or more places in the first wave, the rest in the second', () => {
    const c = buildCurriculum(countries, regions, places);
    const byPlaces = [...c.countryPlaceCount].sort((a, b) => b[1] - a[1]);
    const first = byPlaces.filter(([id]) => countryGate(c, id) === GATE_WAVE1_MASTERED_COUNTRIES);
    expect(first).toHaveLength(28);
    expect(first[0]).toEqual(['country:united-states', 629]);
    expect(first.at(-1)).toEqual(['country:south-africa', 52]);
    expect(byPlaces.slice(0, 28)).toEqual(first);
    for (const [id] of byPlaces.slice(28)) expect(countryGate(c, id), id).toBe(GATE_WAVE2_MASTERED_COUNTRIES);
  });
});
