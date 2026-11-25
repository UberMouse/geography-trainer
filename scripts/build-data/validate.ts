// Checks the files under public/data/ against each other. Offline: it reads only that directory.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { checkContainment } from './containment';
import type { Manifest, PlaceOut, Topology } from './emit';
import { CONTAINMENT_ALLOW_LIST } from './overrides';

export const MAX_COUNTRIES_BYTES = 1_500_000;
export const MAX_REGION_FILE_BYTES = 600_000;

export interface DataFiles {
  places: PlaceOut[];
  countries: Topology;
  /** Region topologies by country id. */
  regions: Record<string, Topology>;
  manifest: Manifest;
  /** File sizes in bytes by path relative to the data directory. */
  sizes: Record<string, number>;
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

function geometries(topology: Topology, name: string) {
  return topology.objects[name]?.geometries ?? [];
}

/** Every problem found, as one line each; empty when the data is consistent. */
export function validateData(
  files: DataFiles,
  allowList: Record<string, string> = CONTAINMENT_ALLOW_LIST,
): string[] {
  const problems: string[] = [];
  const countries = geometries(files.countries, 'countries');
  const countryIds = new Set(countries.map((g) => g.id));
  const tier = new Set(countries.filter((g) => g.properties.hasRegions === true).map((g) => g.id));

  for (const id of duplicates(files.places.map((p) => p.id)))
    problems.push(`duplicate place id ${id}`);
  for (const id of duplicates(countries.map((g) => g.id)))
    problems.push(`duplicate country id ${id}`);

  const regionIds = new Map<string, Set<string>>();
  const allRegionIds: string[] = [];
  for (const [countryId, topology] of Object.entries(files.regions)) {
    const ids = geometries(topology, 'regions').map((g) => g.id);
    regionIds.set(countryId, new Set(ids));
    allRegionIds.push(...ids);
  }
  for (const id of duplicates(allRegionIds)) problems.push(`duplicate region id ${id}`);
  for (const countryId of tier) {
    if (!regionIds.has(countryId))
      problems.push(`regions-tier country ${countryId} has no region file`);
  }
  for (const countryId of regionIds.keys()) {
    if (!tier.has(countryId))
      problems.push(`regions/${countryId}.topo.json: ${countryId} is not a regions-tier country`);
  }

  for (const place of files.places) {
    if (!countryIds.has(place.country)) {
      problems.push(`place ${place.id}: country ${place.country} is not in countries.topo.json`);
    } else if (tier.has(place.country)) {
      if (place.region === null) {
        problems.push(`place ${place.id}: regions-tier country ${place.country} but no region`);
      } else if (regionIds.has(place.country) && !regionIds.get(place.country)!.has(place.region)) {
        problems.push(
          `place ${place.id}: region ${place.region} is not in regions/${place.country}.topo.json`,
        );
      }
    } else if (place.region !== null) {
      problems.push(
        `place ${place.id}: country ${place.country} has no regions tier but region ${place.region}`,
      );
    }
  }

  const { total, active, kept, excluded } = files.manifest.counts;
  if (kept + excluded !== active) {
    problems.push(`kept (${kept}) + excluded (${excluded}) != active (${active}) of ${total}`);
  }
  if (files.places.length !== kept) {
    problems.push(`places.json has ${files.places.length} places, manifest says ${kept} kept`);
  }

  for (const [path, bytes] of Object.entries(files.sizes)) {
    const limit =
      path === 'countries.topo.json'
        ? MAX_COUNTRIES_BYTES
        : path.startsWith('regions/')
          ? MAX_REGION_FILE_BYTES
          : Infinity;
    if (bytes > limit) problems.push(`${path} is ${bytes} bytes, over the ${limit} byte limit`);
  }

  const containment = checkContainment(files.places, files.countries, files.regions, allowList);
  problems.push(...containment.problems);
  if (JSON.stringify(containment.outside) !== JSON.stringify(files.manifest.outsideTolerance)) {
    problems.push('manifest.json outsideTolerance does not match the containment check');
  }
  return problems;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

/** Reads the generated files from a data directory (public/data/ layout). */
export async function readDataDir(dir: string): Promise<DataFiles> {
  const regionFiles = (await readdir(join(dir, 'regions')))
    .filter((f) => f.endsWith('.topo.json'))
    .sort();
  const paths = ['places.json', 'countries.topo.json', ...regionFiles.map((f) => `regions/${f}`)];
  const sizes: Record<string, number> = {};
  for (const path of paths) sizes[path] = (await stat(join(dir, path))).size;

  const regions: Record<string, Topology> = {};
  for (const file of regionFiles) {
    regions[file.replace(/\.topo\.json$/, '')] = await readJson(join(dir, 'regions', file));
  }
  return {
    places: await readJson(join(dir, 'places.json')),
    countries: await readJson(join(dir, 'countries.topo.json')),
    regions,
    manifest: await readJson(join(dir, 'manifest.json')),
    sizes,
  };
}

export async function validateDataDir(
  dir: string,
  allowList: Record<string, string> = CONTAINMENT_ALLOW_LIST,
): Promise<string[]> {
  return validateData(await readDataDir(dir), allowList);
}
