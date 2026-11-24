import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Manifest, PlaceOut, TopoGeometry, Topology } from './emit';
import {
  type DataFiles,
  MAX_COUNTRIES_BYTES,
  MAX_REGION_FILE_BYTES,
  validateData,
  validateDataDir,
} from './validate';

const topo = (name: string, geometries: TopoGeometry[]): Topology => ({
  type: 'Topology',
  objects: { [name]: { type: 'GeometryCollection', geometries } },
});
const geometry = (id: string, properties: Record<string, unknown> = {}): TopoGeometry => ({
  type: 'Polygon',
  id,
  properties,
  arcs: [[0]],
});
const place = (id: string, country: string, region: string | null): PlaceOut => ({
  id,
  name: id,
  country,
  region,
  lat: 0,
  lng: 0,
  type: 'city',
  level: 1,
});

function valid(): DataFiles {
  const manifest: Manifest = {
    source: 'https://maptap.gg/data/master_locations_v2.js',
    naturalEarth: { version: 'v5.1.2', files: [] },
    counts: { total: 4, active: 3, kept: 2, excluded: 1 },
    excluded: [{ id: 'nemo', name: 'Point Nemo', country: 'Pacific Ocean', reason: 'ocean' }],
    countries: { byName: 2, byOverride: 0, pointOnly: 0, excludedNames: ['Pacific Ocean'] },
    regionsTierCountries: ['aland'],
  };
  return {
    places: [place('p1', 'aland', 'aland.north'), place('p2', 'bland', null)],
    countries: topo('countries', [
      geometry('aland', { hasRegions: true }),
      geometry('bland', { hasRegions: false }),
    ]),
    regions: { aland: topo('regions', [geometry('aland.north'), geometry('aland.south')]) },
    manifest,
    sizes: { 'places.json': 100, 'countries.topo.json': 100, 'regions/aland.topo.json': 100 },
  };
}

function problemsAfter(change: (files: DataFiles) => void): string[] {
  const files = valid();
  change(files);
  return validateData(files);
}

describe('validateData', () => {
  it('passes consistent data', () => {
    expect(validateData(valid())).toEqual([]);
  });

  it('fails on a place whose country is not in countries.topo.json', () => {
    expect(problemsAfter((f) => (f.places[1]!.country = 'atlantis'))).toEqual([
      'place p2: country atlantis is not in countries.topo.json',
    ]);
  });

  it('fails on a place in a regions-tier country with no region', () => {
    expect(problemsAfter((f) => (f.places[0]!.region = null))).toEqual([
      'place p1: regions-tier country aland but no region',
    ]);
  });

  it("fails on a region id not in that country's region file", () => {
    expect(problemsAfter((f) => (f.places[0]!.region = 'aland.west'))).toEqual([
      'place p1: region aland.west is not in regions/aland.topo.json',
    ]);
  });

  it('fails on a regions-tier country with no region file', () => {
    expect(problemsAfter((f) => delete f.regions.aland)).toEqual([
      'regions-tier country aland has no region file',
    ]);
  });

  it('fails on a region for a country without a regions tier', () => {
    expect(problemsAfter((f) => (f.places[1]!.region = 'bland.x'))).toEqual([
      'place p2: country bland has no regions tier but region bland.x',
    ]);
  });

  it('fails on duplicate place, country and region ids', () => {
    expect(problemsAfter((f) => f.places.push(place('p1', 'bland', null)))).toContain(
      'duplicate place id p1',
    );
    expect(
      problemsAfter((f) => f.countries.objects.countries!.geometries.push(geometry('bland'))),
    ).toEqual(['duplicate country id bland']);
    expect(
      problemsAfter((f) =>
        f.regions.aland!.objects.regions!.geometries.push(geometry('aland.south')),
      ),
    ).toEqual(['duplicate region id aland.south']);
  });

  it('fails when kept + excluded is not active', () => {
    expect(problemsAfter((f) => (f.manifest.counts.active = 4))).toEqual([
      'kept (2) + excluded (1) != active (4) of 4',
    ]);
  });

  it('fails when places.json does not hold the kept count', () => {
    expect(problemsAfter((f) => f.places.pop())).toEqual([
      'places.json has 1 places, manifest says 2 kept',
    ]);
  });

  it('fails when a file is over its size bound', () => {
    expect(problemsAfter((f) => (f.sizes['countries.topo.json'] = MAX_COUNTRIES_BYTES))).toEqual(
      [],
    );
    expect(
      problemsAfter((f) => (f.sizes['countries.topo.json'] = MAX_COUNTRIES_BYTES + 1)),
    ).toEqual([
      `countries.topo.json is ${MAX_COUNTRIES_BYTES + 1} bytes, over the ${MAX_COUNTRIES_BYTES} byte limit`,
    ]);
    expect(
      problemsAfter((f) => (f.sizes['regions/aland.topo.json'] = MAX_REGION_FILE_BYTES + 1)),
    ).toEqual([
      `regions/aland.topo.json is ${MAX_REGION_FILE_BYTES + 1} bytes, over the ${MAX_REGION_FILE_BYTES} byte limit`,
    ]);
  });
});

describe('validateDataDir', () => {
  it('reads a public/data layout from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'build-data-'));
    try {
      const files = valid();
      await mkdir(join(dir, 'regions'));
      await writeFile(join(dir, 'places.json'), JSON.stringify(files.places));
      await writeFile(join(dir, 'countries.topo.json'), JSON.stringify(files.countries));
      await writeFile(join(dir, 'regions', 'aland.topo.json'), JSON.stringify(files.regions.aland));
      await writeFile(join(dir, 'manifest.json'), JSON.stringify(files.manifest));
      expect(await validateDataDir(dir)).toEqual([]);

      await writeFile(
        join(dir, 'places.json'),
        JSON.stringify([...files.places, place('p1', 'bland', null)]),
      );
      expect(await validateDataDir(dir)).toContain('duplicate place id p1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
