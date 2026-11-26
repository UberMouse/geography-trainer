// The committed public/data/ files against the formats in spec/contracts/data-files.md.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Manifest, PlaceOut, Topology } from './emit';
import { MAPTAP_URL } from './fetch-maptap';
import { NE_FILES, NE_VERSION } from './natural-earth';
import { compareStrings } from './normalize';
import { BOUNDARY_NOTE } from './overrides';

const dir = new URL('../../public/data/', import.meta.url);
const text = (path: string) => readFileSync(new URL(path, dir), 'utf8');
const regionFiles = readdirSync(new URL('regions/', dir)).sort();
const places: PlaceOut[] = JSON.parse(text('places.json'));
const countriesTopo: Topology = JSON.parse(text('countries.topo.json'));
const countries = countriesTopo.objects.countries!.geometries;
const manifest: Manifest = JSON.parse(text('manifest.json'));
const regionTopos = new Map<string, Topology>(
  regionFiles.map((f) => [f.replace(/\.topo\.json$/, ''), JSON.parse(text(`regions/${f}`))]),
);

const isSorted = (ids: string[]) =>
  ids.every((id, i) => i === 0 || compareStrings(ids[i - 1]!, id) < 0);
const countBy = (keys: Array<string | null>) => {
  const counts = new Map<string, number>();
  for (const k of keys) if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
  return counts;
};
const placesPerCountry = countBy(places.map((p) => p.country));
const placesPerRegion = countBy(places.map((p) => p.region));
const fourDecimals = (x: number) => Math.round(x * 1e4) / 1e4 === x;

describe('[DAT-C14] the committed data directory', () => {
  it('holds exactly the five outputs, one region file per regions-tier country', () => {
    expect(readdirSync(dir).sort()).toEqual([
      'SOURCE.md',
      'countries.topo.json',
      'manifest.json',
      'places.json',
      'regions',
    ]);
    expect(regionFiles.every((f) => f.endsWith('.topo.json'))).toBe(true);
  });

  it('writes compact JSON with a final newline, and the manifest indented by 2', () => {
    for (const path of [
      'places.json',
      'countries.topo.json',
      ...regionFiles.map((f) => `regions/${f}`),
    ]) {
      const body = text(path);
      expect(body === `${JSON.stringify(JSON.parse(body))}\n`, path).toBe(true);
    }
    const body = text('manifest.json');
    expect(body).toBe(`${JSON.stringify(JSON.parse(body), null, 2)}\n`);
  });
});

describe('[DAT-C15] places.json', () => {
  const TYPES = new Set([
    'city',
    'capital',
    'state_capital',
    'monument',
    'ancient_monument',
    'religious_site',
    'mountain',
    'island',
    'natural_wonder',
    'national_park',
  ]);
  const KEYS = ['id', 'name', 'country', 'region', 'lat', 'lng', 'type', 'level'];

  it('gives every place exactly the contract fields, in order, with their types', () => {
    const bad = places.filter((p) => {
      const keys = Object.keys(p);
      const ok =
        (keys.join() === KEYS.join() || keys.join() === [...KEYS, 'pop'].join()) &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        typeof p.country === 'string' &&
        (p.region === null || p.region.startsWith(`${p.country}.`)) &&
        fourDecimals(p.lat) &&
        fourDecimals(p.lng) &&
        TYPES.has(p.type) &&
        Number.isInteger(p.level) &&
        p.level >= 1 &&
        p.level <= 8 &&
        (p.pop === undefined || typeof p.pop === 'number');
      return !ok;
    });
    expect(bad).toEqual([]);
  });
});

describe('[DAT-C16] countries.topo.json', () => {
  it('is a quantized topology with one countries object', () => {
    expect(countriesTopo.type).toBe('Topology');
    expect(Object.keys(countriesTopo.objects)).toEqual(['countries']);
    expect(countriesTopo.transform).toBeDefined();
    expect(Array.isArray(countriesTopo.arcs)).toBe(true);
  });

  it('gives every country the contract properties, with its place count', () => {
    const bad = countries.filter((g) => {
      const p = g.properties as {
        name: unknown;
        ne: string[];
        places: number;
        hasRegions: unknown;
        radiusKm?: unknown;
      };
      const point = g.type === 'Point';
      const keys = ['name', 'ne', 'places', 'hasRegions', ...(point ? ['radiusKm'] : [])];
      return !(
        ['Polygon', 'MultiPolygon', 'Point'].includes(g.type!) &&
        Object.keys(p).join() === keys.join() &&
        typeof p.name === 'string' &&
        Array.isArray(p.ne) &&
        p.ne.join() === [...p.ne].sort(compareStrings).join() &&
        (point ? p.ne.length === 0 && typeof p.radiusKm === 'number' : p.ne.length > 0) &&
        p.places >= 1 &&
        p.places === placesPerCountry.get(g.id) &&
        typeof p.hasRegions === 'boolean'
      );
    });
    expect(bad).toEqual([]);
    expect(countries.length).toBe(new Set(places.map((p) => p.country)).size);
  });
});

describe('[DAT-C17] regions/<country id>.topo.json', () => {
  it('has one file per regions-tier country, each a topology with one regions object', () => {
    const tier = countries.filter((g) => g.properties.hasRegions === true).map((g) => g.id);
    expect([...regionTopos.keys()]).toEqual(tier);
    for (const [id, topo] of regionTopos) {
      expect([id, topo.type, Object.keys(topo.objects), !!topo.transform]).toEqual([
        id,
        'Topology',
        ['regions'],
        true,
      ]);
    }
  });

  it('gives every region a prefixed id, a name and its place count', () => {
    const bad: string[] = [];
    for (const [countryId, topo] of regionTopos) {
      for (const g of topo.objects.regions!.geometries) {
        const ok =
          ['Polygon', 'MultiPolygon'].includes(g.type!) &&
          g.id.startsWith(`${countryId}.`) &&
          Object.keys(g.properties).join() === 'name,places' &&
          typeof g.properties.name === 'string' &&
          g.properties.places === (placesPerRegion.get(g.id) ?? 0);
        if (!ok) bad.push(g.id);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('[DAT-21] regions without places', () => {
  it('still ship in their country’s region file', () => {
    const empty = [...regionTopos.values()].flatMap((t) =>
      t.objects.regions!.geometries.filter((g) => g.properties.places === 0).map((g) => g.id),
    );
    expect(empty).toContain('france.archipel-des-crozet');
  });
});

describe('[DAT-27] the committed data is in a fixed order', () => {
  it('lists places, countries and each region file in id order', () => {
    expect(isSorted(places.map((p) => p.id))).toBe(true);
    expect(isSorted(countries.map((g) => g.id))).toBe(true);
    for (const [id, topo] of regionTopos) {
      expect(isSorted(topo.objects.regions!.geometries.map((g) => g.id)), id).toBe(true);
    }
  });
});

describe('[DAT-C18] manifest.json', () => {
  it('has the contract fields, consistent with the other files', () => {
    expect(Object.keys(manifest)).toEqual([
      'source',
      'naturalEarth',
      'counts',
      'excluded',
      'countries',
      'regionsTierCountries',
      'outsideTolerance',
      'droppedAdmin1',
    ]);
    expect(manifest.source).toBe(MAPTAP_URL);
    expect(manifest.naturalEarth).toEqual({
      version: NE_VERSION,
      files: [NE_FILES.mapUnits, NE_FILES.mapSubunits, NE_FILES.admin1, NE_FILES.disputedAreas].map(
        (f) => `${f}.geojson`,
      ),
    });
    expect(manifest.counts.kept).toBe(places.length);
    expect(manifest.counts.excluded).toBe(manifest.excluded.length);
    expect(isSorted(manifest.excluded.map((e) => e.id))).toBe(true);
    const { byName, byOverride, pointOnly, excludedNames } = manifest.countries;
    expect(byName + byOverride + pointOnly).toBe(countries.length);
    expect(pointOnly).toBe(countries.filter((g) => g.type === 'Point').length);
    expect(excludedNames).toEqual([...excludedNames].sort(compareStrings));
    expect(manifest.regionsTierCountries).toEqual([...regionTopos.keys()]);
    const placeOrder = new Map(places.map((p, i) => [p.id, i]));
    const outsideAt = manifest.outsideTolerance.map((o) => placeOrder.get(o.id)!);
    expect(outsideAt).toEqual([...outsideAt].sort((a, b) => a - b));
    const dropped = manifest.droppedAdmin1.map((d) => [d.code, d.country]);
    expect(dropped).toEqual(
      [...dropped].sort((a, b) => compareStrings(a[0]!, b[0]!) || compareStrings(a[1]!, b[1]!)),
    );
  });
});

describe('[DAT-26, DAT-C19] SOURCE.md', () => {
  const lines = text('SOURCE.md').split('\n');
  const at = (line: string) => lines.indexOf(line);

  it('names its source and release, credits MapTap.gg and Natural Earth, and states the boundary decisions', () => {
    expect(lines[0]).toBe('# Data source');
    expect(lines).toContain(`- Place list: ${MAPTAP_URL}`);
    expect(lines).toContain(
      `- Boundaries: Natural Earth ${NE_VERSION}, ${manifest.naturalEarth.files.join(', ')}`,
    );
    expect(lines.some((l) => /^- Fetched: \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(l))).toBe(
      true,
    );
    expect(at('Place list courtesy of MapTap.gg')).toBeGreaterThan(0);
    expect(at('Boundaries: Natural Earth (public domain)')).toBeGreaterThan(
      at('Place list courtesy of MapTap.gg'),
    );
    expect(lines).toContain(`Boundary decisions: ${BOUNDARY_NOTE}.`);
  });

  it('gives the manifest’s counts and lists every excluded place', () => {
    const { counts, countries: c } = manifest;
    const countsAt = at('## Counts');
    const excludedAt = at('## Excluded places');
    expect(countsAt).toBeGreaterThan(0);
    expect(excludedAt).toBeGreaterThan(countsAt);
    const reasons = countBy(manifest.excluded.map((e) => e.reason));
    expect(lines.slice(countsAt + 2, excludedAt - 1)).toEqual([
      `- Entries: ${counts.total}`,
      `- Active: ${counts.active}`,
      `- Kept: ${counts.kept}`,
      `- Excluded: ${counts.excluded}`,
      ...[...reasons].map(([reason, n]) => `  - ${reason}: ${n}`),
      `- Countries: ${countries.length} (by name ${c.byName}, by override ${c.byOverride}, point-only ${c.pointOnly})`,
      `- Regions-tier countries: ${manifest.regionsTierCountries.length}`,
    ]);
    expect(lines.slice(excludedAt + 2).filter(Boolean)).toEqual(
      manifest.excluded.map((e) => `- \`${e.id}\` ${e.name} (${e.country}): ${e.reason}`),
    );
  });
});

describe('[DAT-29, DAT-C20] the committed counts', () => {
  it('are the ones the contract gives', () => {
    expect(manifest.counts).toEqual({ total: 9462, active: 6612, kept: 6607, excluded: 5 });
    expect(new Set(manifest.excluded.map((e) => e.reason))).toEqual(
      new Set(['open ocean: no country polygon']),
    );
    expect(manifest.countries).toEqual({
      byName: 217,
      byOverride: 23,
      pointOnly: 3,
      excludedNames: ['Arctic Ocean', 'North Atlantic', 'North Sea', 'Pacific Ocean'],
    });
    expect(countries.length).toBe(243);
    expect(regionTopos.size).toBe(93);
    expect(places.filter((p) => p.region === null).length).toBe(817);
  });
});

describe('[DAT-14] boundary decisions in the committed data', () => {
  it('puts the Crimea places in Ukraine, in one region named Crimea', () => {
    const crimea = [
      'bakhchysarai_ukraine',
      'feodosia_ukraine',
      'kerch_ukraine',
      'sevastopol_crimea',
      'simferopol_ukraine',
      'yalta_crimea_ukraine',
      'yevpatoria_ukraine',
    ];
    const found = places
      .filter((p) => crimea.includes(p.id))
      .map((p) => [p.id, p.country, p.region]);
    expect(found).toEqual(crimea.map((id) => [id, 'ukraine', 'ukraine.crimea']));
    const region = regionTopos
      .get('ukraine')!
      .objects.regions!.geometries.find((g) => g.id === 'ukraine.crimea');
    expect(region?.properties.name).toBe('Crimea');
  });

  it('keeps Western Sahara whole, Smara included', () => {
    const ids = places.filter((p) => p.country === 'western-sahara').map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['laayoune_western_sahara', 'smara_morocco']));
    expect(places.find((p) => p.id === 'dakhla_western_sahara')!.country).toBe('western-sahara');
  });
});
