// Simplifies geometry with mapshaper and writes public/data/*.
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Feature, FeatureCollection } from 'geojson';
import mapshaper from 'mapshaper';
import type { DroppedRow } from './assign-regions';
import type { OutsidePlace } from './containment';
import type { Area } from './geo';
import { compareStrings } from './normalize';

/** mapshaper -simplify retained-point share, and TopoJSON quantization. */
const SIMPLIFY = '27%';
const QUANTIZATION = '1e5';

export interface PlaceOut {
  id: string;
  name: string;
  country: string;
  region: string | null;
  lat: number;
  lng: number;
  type: string;
  level: number;
  pop?: number;
}

export interface TopoGeometry {
  type: string | null;
  id: string;
  properties: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Topology {
  type: 'Topology';
  objects: Record<string, { type: 'GeometryCollection'; geometries: TopoGeometry[] }>;
  [key: string]: unknown;
}

export interface Manifest {
  source: string;
  naturalEarth: { version: string; files: string[] };
  counts: { total: number; active: number; kept: number; excluded: number };
  excluded: Array<{ id: string; name: string; country: string; reason: string }>;
  countries: { byName: number; byOverride: number; pointOnly: number; excludedNames: string[] };
  regionsTierCountries: string[];
  /** Places beyond the containment tolerance, each allow-listed with a reason. */
  outsideTolerance: OutsidePlace[];
  /** Admin-1 rows left out of their country because their label point is in another country. */
  droppedAdmin1: DroppedRow[];
}

/** A feature to write: polygons (several get dissolved into one) or a point, plus properties. */
export interface ShapeOut {
  id: string;
  areas: Area[];
  point?: [lng: number, lat: number];
  properties: Record<string, unknown>;
}

/**
 * One TopoJSON object named `name` holding one geometry per shape, sorted by id: polygons are
 * exploded into parts, simplified keeping every part (so no island vanishes), then dissolved by
 * id; points pass through. Fails when a shape comes out empty.
 */
export async function toTopology(name: string, shapes: ShapeOut[]): Promise<Topology> {
  const feature = (id: string, geometry: Feature['geometry']): Feature => ({
    type: 'Feature',
    properties: { id },
    geometry,
  });
  const polygons: FeatureCollection = {
    type: 'FeatureCollection',
    features: shapes.flatMap((s) => s.areas.map((area) => feature(s.id, area))),
  };
  const points: FeatureCollection = {
    type: 'FeatureCollection',
    features: shapes
      .filter((s) => s.point)
      .map((s) => feature(s.id, { type: 'Point', coordinates: s.point! })),
  };
  const inputs: Record<string, FeatureCollection> = { [`${name}.json`]: polygons };
  if (points.features.length > 0) inputs['points.json'] = points;

  const output = await mapshaper.applyCommands(
    [
      `-i ${Object.keys(inputs).join(' ')} combine-files`,
      `-explode target=${name}`,
      `-simplify ${SIMPLIFY} keep-shapes target=${name}`,
      `-dissolve id target=${name}`,
      `-o format=topojson quantization=${QUANTIZATION} id-field=id target=* out.json`,
    ].join(' '),
    inputs,
  );
  const topology = JSON.parse(String(output['out.json'])) as Topology;

  // Points share the polygons' quantization transform, so their geometries can join the object.
  const object = topology.objects[name]!;
  object.geometries.push(...(topology.objects.points?.geometries ?? []));
  delete topology.objects.points;

  const byId = new Map(shapes.map((s) => [s.id, s]));
  const missing = shapes.filter((s) => !object.geometries.some((g) => g.id === s.id && g.type));
  if (missing.length > 0) {
    throw new Error(`${name}: simplification lost ${missing.map((s) => s.id).join(', ')}`);
  }
  for (const geometry of object.geometries) geometry.properties = byId.get(geometry.id)!.properties;
  object.geometries.sort((a, b) => compareStrings(a.id, b.id));
  return topology;
}

export interface DataOut {
  places: PlaceOut[];
  countries: Topology;
  regions: Map<string, Topology>;
  manifest: Manifest;
  sourceMd: string;
}

/** Replaces `dir` with the generated files. */
export async function writeData(dir: string, data: DataOut): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, 'regions'), { recursive: true });
  const json = (value: unknown) => `${JSON.stringify(value)}\n`;
  await writeFile(join(dir, 'places.json'), json(data.places));
  await writeFile(join(dir, 'countries.topo.json'), json(data.countries));
  for (const [countryId, topology] of [...data.regions].sort(([a], [b]) => compareStrings(a, b))) {
    await writeFile(join(dir, 'regions', `${countryId}.topo.json`), json(topology));
  }
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(data.manifest, null, 2)}\n`);
  await writeFile(join(dir, 'SOURCE.md'), data.sourceMd);
}

/**
 * Writes the files into a temporary sibling of `dir` (`.<name>-tmp-<pid>`, gitignored), runs
 * `validate` on it, and only when it reports no problems swaps it in for `dir`. On problems or
 * an error `dir` is left as it was, and no temporary directory is left behind.
 */
export async function publishData(
  dir: string,
  data: DataOut,
  validate: (dir: string) => Promise<string[]>,
): Promise<string[]> {
  const sibling = (kind: string) => join(dirname(dir), `.${basename(dir)}-${kind}-${process.pid}`);
  const staged = sibling('tmp');
  const previous = sibling('old');
  try {
    await writeData(staged, data);
    const problems = await validate(staged);
    if (problems.length > 0) return problems;
    const hadPrevious = await stat(dir).then(
      () => true,
      () => false,
    );
    if (hadPrevious) await rename(dir, previous);
    try {
      await rename(staged, dir);
    } catch (error) {
      if (hadPrevious) await rename(previous, dir);
      throw error;
    }
    return [];
  } finally {
    await rm(staged, { recursive: true, force: true });
    await rm(previous, { recursive: true, force: true });
  }
}
