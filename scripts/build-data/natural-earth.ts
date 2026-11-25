// Natural Earth boundaries from pinned URLs, downloaded once into a local cache and reused.
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Feature, FeatureCollection } from 'geojson';
import type { Area } from './geo';
import { fetchWithin } from './http';

export const NE_VERSION = 'v5.1.2';
/** The admin-1 file is about 40 MB. */
const DOWNLOAD_TIMEOUT_MS = 120_000;
export const NE_FILES = {
  mapUnits: 'ne_10m_admin_0_map_units',
  mapSubunits: 'ne_10m_admin_0_map_subunits',
  admin1: 'ne_10m_admin_1_states_provinces',
  disputedAreas: 'ne_10m_admin_0_disputed_areas',
} as const;

export function naturalEarthUrl(file: string): string {
  return `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NE_VERSION}/geojson/${file}.geojson`;
}

/** An admin-0 map unit or map subunit. `code` is its SU_A3. */
export interface NeUnit {
  code: string;
  /** Map-unit fields the name match runs against. */
  names: { NAME: string; NAME_LONG: string; ADMIN: string; GEOUNIT: string };
  adm0: string;
  guA3: string;
  geometry: Area;
}

/** An admin-1 row with the fields region building reads. */
export interface NeAdmin1 {
  code: string;
  name: string;
  nameEn: string | null;
  nameAlt: string | null;
  region: string | null;
  adm0: string;
  guA3: string | null;
  label: [lng: number, lat: number];
  geometry: Area;
}

export interface NaturalEarth {
  mapUnits: NeUnit[];
  mapSubunits: NeUnit[];
  admin1: NeAdmin1[];
  /** Disputed-area polygons by BRK_A3. */
  disputedAreas: Map<string, Area>;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Reads `<cacheDir>/<NE_VERSION>/<file>.geojson`, downloading it first when absent. */
async function loadCached(cacheDir: string, file: string): Promise<FeatureCollection> {
  const versionDir = join(cacheDir, NE_VERSION);
  const path = join(versionDir, `${file}.geojson`);
  if (!(await exists(path))) {
    const url = naturalEarthUrl(file);
    console.log(`downloading ${url}`);
    const body = await fetchWithin(url, DOWNLOAD_TIMEOUT_MS, (r) => r.arrayBuffer());
    await mkdir(versionDir, { recursive: true });
    await writeFile(`${path}.part`, Buffer.from(body));
    await rename(`${path}.part`, path);
  }
  return JSON.parse(await readFile(path, 'utf8')) as FeatureCollection;
}

function areaOf(feature: Feature, file: string): Area {
  const geometry = feature.geometry;
  if (geometry?.type !== 'Polygon' && geometry?.type !== 'MultiPolygon') {
    throw new Error(`${file}: feature without a polygon geometry`);
  }
  return geometry;
}

function toUnit(feature: Feature, file: string): NeUnit {
  const p = feature.properties ?? {};
  return {
    code: p.SU_A3,
    names: { NAME: p.NAME, NAME_LONG: p.NAME_LONG, ADMIN: p.ADMIN, GEOUNIT: p.GEOUNIT },
    adm0: p.ADM0_A3,
    guA3: p.GU_A3,
    geometry: areaOf(feature, file),
  };
}

function toAdmin1(feature: Feature, file: string): NeAdmin1 {
  const p = feature.properties ?? {};
  return {
    code: p.adm1_code,
    name: p.name,
    nameEn: p.name_en ?? null,
    nameAlt: p.name_alt ?? null,
    region: p.region || null,
    adm0: p.adm0_a3,
    guA3: p.gu_a3 ?? null,
    label: [p.longitude, p.latitude],
    geometry: areaOf(feature, file),
  };
}

export async function loadNaturalEarth(cacheDir: string): Promise<NaturalEarth> {
  const [mapUnits, mapSubunits, admin1, disputedAreas] = await Promise.all([
    loadCached(cacheDir, NE_FILES.mapUnits),
    loadCached(cacheDir, NE_FILES.mapSubunits),
    loadCached(cacheDir, NE_FILES.admin1),
    loadCached(cacheDir, NE_FILES.disputedAreas),
  ]);
  return {
    mapUnits: mapUnits.features.map((f) => toUnit(f, NE_FILES.mapUnits)),
    mapSubunits: mapSubunits.features.map((f) => toUnit(f, NE_FILES.mapSubunits)),
    // Rows without a name are unnamed NE fragments (adm1_code "XXX+99?"): skipped, so a place in
    // one snaps to the nearest named region.
    admin1: admin1.features
      .filter((f) => f.properties?.name)
      .map((f) => toAdmin1(f, NE_FILES.admin1)),
    disputedAreas: new Map(
      disputedAreas.features.map((f) => [
        f.properties?.BRK_A3 as string,
        areaOf(f, NE_FILES.disputedAreas),
      ]),
    ),
  };
}
