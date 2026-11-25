import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { geoArea, geoContains } from 'd3-geo';
import { buildExerciseItem } from '../../src/exercises/item';
import { loadCountries, loadPlaces, loadRegions } from '../../src/data/loaders';
import {
  answerPoint,
  mainPart,
  measureTap,
  type AreaFeature,
  type LngLat,
} from '../../src/maps/geo';
import { MAP_SIZE, fitFlat, outlineFrame } from '../../src/maps/view';

const dir = new URL('../../public/data/', import.meta.url);

// Serve the committed files to the loaders, as the browser would fetch them.
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    try {
      const body = readFileSync(new URL(url.replace(/^\/data\//, ''), dir), 'utf8');
      return new Response(body, { status: 200 });
    } catch {
      return new Response('', { status: 404 });
    }
  });
});

describe('committed map data, as the loaders return it', () => {
  it(
    'has no feature that covers more than a hemisphere (d3 winding)',
    { timeout: 120_000 },
    async () => {
      const { features, countries } = await loadCountries();
      const all: { id: string | number | undefined; f: AreaFeature }[] = features.map((f) => ({
        id: f.id,
        f,
      }));
      for (const c of countries.filter((x) => x.hasRegions)) {
        for (const f of (await loadRegions(c.id)).features) all.push({ id: f.id, f });
      }
      expect(all.length).toBeGreaterThan(2000);
      const inverted = all.filter(({ f }) => geoArea(f) >= 2 * Math.PI).map(({ id }) => id);
      expect(inverted).toEqual([]);
      // Every feature has an area: the points and zero-area polygons in the data become discs.
      const notAreal = all
        .filter(
          ({ f }) => !['Polygon', 'MultiPolygon'].includes(f.geometry.type) || !(geoArea(f) > 0),
        )
        .map(({ id }) => id);
      expect(notAreal).toEqual([]);
    },
  );

  it('gives the point and zero-area countries a tappable disc', async () => {
    const { features } = await loadCountries();
    const bonaire = features.find((f) => f.id === 'bonaire')!;
    // The committed point, dequantized.
    const point: LngLat = [-68.258, 12.2];
    const m = measureTap({ feature: bonaire, answer: answerPoint(bonaire) }, point);
    expect(m.inside).toBe(true);
    expect(m.kmOutsideBorder).toBe(0);
    expect(m.kmFromAnswer).toBeLessThan(0.5);
    const vatican = features.find((f) => f.id === 'vatican-city')!;
    expect(geoContains(vatican, answerPoint(vatican))).toBe(true);
  });

  it('measures taps against France', async () => {
    const { features } = await loadCountries();
    const france = features.find((f) => f.id === 'france')!;
    const target = { feature: france, answer: answerPoint(france) };
    expect(measureTap(target, [2.3522, 48.8566]).inside).toBe(true);
    // 100 km due west of Brest would be only about 55 km from Ouessant (Ushant), which is part of
    // France, so measure from Ouessant's westernmost point instead (about 5.15 W, 48.46 N).
    const ushant: LngLat = [-5.15, 48.46];
    const west: LngLat = [
      ushant[0] - 100 / (111.19 * Math.cos((ushant[1] * Math.PI) / 180)),
      ushant[1],
    ];
    const m = measureTap(target, west);
    expect(m.inside).toBe(false);
    expect(m.kmOutsideBorder).toBeGreaterThan(70);
    expect(m.kmOutsideBorder).toBeLessThan(130);
  });
});

describe('main parts of the committed countries', () => {
  const country = async (id: string) => (await loadCountries()).features.find((f) => f.id === id)!;

  // A point on each island, checked against the whole country first so a miss is the main part's.
  const kept: [string, string, LngLat][] = [
    ['france', 'Corsica', [9.1, 42.1]],
    ['chile', 'Tierra del Fuego', [-69.5, -54]],
    ['japan', 'Hokkaido', [142.8, 43.4]],
    ['italy', 'Sicily', [14.2, 37.5]],
  ];
  const dropped: [string, string, LngLat][] = [
    ['france', 'French Guiana', [-53, 4]],
    ['france', 'Réunion', [55.5, -21.1]],
    ['chile', 'Easter Island', [-109.35, -27.12]],
    ['portugal', 'the Azores (São Miguel)', [-25.5, 37.78]],
    ['portugal', 'the Azores (Pico)', [-28.4, 38.45]],
  ];

  it.each(kept)('%s keeps %s', async (id, _island, at) => {
    const f = await country(id);
    expect(geoContains(f, at)).toBe(true);
    expect(geoContains(mainPart(f), at)).toBe(true);
  });

  it.each(dropped)('%s leaves out %s', async (id, _island, at) => {
    const f = await country(id);
    expect(geoContains(f, at)).toBe(true);
    expect(geoContains(mainPart(f), at)).toBe(false);
  });

  it('keeps all of Kiribati, which has no dominant part', async () => {
    const kiribati = await country('kiribati');
    expect(mainPart(kiribati)).toBe(kiribati);
  });

  it("puts France's answer point inside France", async () => {
    const france = await country('france');
    expect(geoContains(france, answerPoint(france))).toBe(true);
  });

  it('computes every country', { timeout: 60_000 }, async () => {
    const { features } = await loadCountries();
    for (const f of features) {
      const main = mainPart(f);
      expect(main.id).toBe(f.id);
      expect(geoArea(main)).toBeGreaterThanOrEqual(0.8 * geoArea(f) - 1e-12);
    }
  });
});

describe('answer points of the committed countries and regions', () => {
  it('lie inside the main part of every feature', { timeout: 600_000 }, async () => {
    const { features, countries } = await loadCountries();
    const all: AreaFeature[] = [...features];
    for (const c of countries.filter((x) => x.hasRegions)) {
      all.push(...(await loadRegions(c.id)).features);
    }
    const outside = all.filter((f) => !geoContains(mainPart(f), answerPoint(f))).map((f) => f.id);
    expect(outside).toEqual([]);
  });
});

describe('outline of every place', () => {
  it('frames every place inside its outline view', { timeout: 300_000 }, async () => {
    const { features } = await loadCountries();
    const places = await loadPlaces();
    const outsideFrame: string[] = [];
    for (const place of places) {
      const country = features.find((f) => f.id === place.country)!;
      // As `src/exercises/item.ts` picks a place item's outline: its region when it has one.
      const region = place.region
        ? (await loadRegions(country.id)).features.find((f) => f.id === place.region)
        : undefined;
      const point: LngLat = [place.lng, place.lat];
      const at = fitFlat(outlineFrame(region ?? country, point))(point);
      if (!at || !at.every((v) => v >= 0 && v <= MAP_SIZE)) outsideFrame.push(place.id);
    }
    expect(outsideFrame).toEqual([]);
  });
});

describe('city/county pairs are distinct items', () => {
  it('have their own names, no twins, and unique candidate names without their own', async () => {
    const regions = await loadRegions('ireland');
    const data = { countries: await loadCountries(), places: await loadPlaces(), regions };
    for (const [id, name] of [
      ['ireland.galway-city', 'Galway (city)'],
      ['ireland.galway-county', 'Galway (county)'],
    ]) {
      const item = buildExerciseItem(`region:${id}`, data);
      expect(item.name).toBe(name);
      expect('alsoInside' in item.target).toBe(false);
      const names = item.candidates.map((c) => c.name);
      expect(names).not.toContain(name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
