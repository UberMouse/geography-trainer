import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Feature, FeatureCollection } from 'geojson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { square } from './fixtures/geometry';
import {
  DOWNLOAD_TIMEOUT_MS,
  NE_FILES,
  NE_VERSION,
  loadNaturalEarth,
  naturalEarthUrl,
} from './natural-earth';

const collection = (features: Feature[]): FeatureCollection => ({
  type: 'FeatureCollection',
  features,
});
const unitFeature = (code: string): Feature => ({
  type: 'Feature',
  properties: {
    SU_A3: code,
    NAME: 'Aland',
    NAME_LONG: 'Aland Republic',
    ADMIN: 'Aland',
    GEOUNIT: 'Aland',
    ADM0_A3: 'AAA',
    GU_A3: 'AAA',
  },
  geometry: square(0, 0),
});
const admin1Feature = (code: string, name: string | null): Feature => ({
  type: 'Feature',
  properties: {
    adm1_code: code,
    name,
    name_en: 'North',
    name_alt: null,
    region: '',
    adm0_a3: 'AAA',
    gu_a3: 'AAA',
    longitude: 0.5,
    latitude: 0.25,
  },
  geometry: square(0, 0),
});

/** The four files of a tiny release, by NE file name. */
const RELEASE: Record<string, FeatureCollection> = {
  [NE_FILES.mapUnits]: collection([unitFeature('AAA')]),
  [NE_FILES.mapSubunits]: collection([unitFeature('AAS')]),
  [NE_FILES.admin1]: collection([admin1Feature('AAA-1', 'North'), admin1Feature('AAA+99?', null)]),
  [NE_FILES.disputedAreas]: collection([
    { type: 'Feature', properties: { BRK_A3: 'B19' }, geometry: square(1, 0) },
  ]),
};

describe('[DAT-C01] Natural Earth source', () => {
  it('pins release v5.1.2, its four 10m files, their URL and a 120 s download limit', () => {
    expect(NE_VERSION).toBe('v5.1.2');
    expect(NE_FILES).toEqual({
      mapUnits: 'ne_10m_admin_0_map_units',
      mapSubunits: 'ne_10m_admin_0_map_subunits',
      admin1: 'ne_10m_admin_1_states_provinces',
      disputedAreas: 'ne_10m_admin_0_disputed_areas',
    });
    expect(naturalEarthUrl('ne_10m_admin_0_map_units')).toBe(
      'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_map_units.geojson',
    );
    expect(DOWNLOAD_TIMEOUT_MS).toBe(120_000);
  });
});

describe('[DAT-05] loadNaturalEarth', () => {
  let cache: string;
  const versionDir = () => join(cache, NE_VERSION);

  beforeEach(async () => {
    cache = await mkdtemp(join(tmpdir(), 'ne-cache-'));
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await rm(cache, { recursive: true, force: true });
  });

  it('reads a cached release without downloading, leaving out unnamed admin-1 rows', async () => {
    await mkdir(versionDir(), { recursive: true });
    for (const [file, fc] of Object.entries(RELEASE)) {
      await writeFile(join(versionDir(), `${file}.geojson`), JSON.stringify(fc));
    }
    const fetch = vi.fn(() => Promise.reject(new Error('no network in this test')));
    vi.stubGlobal('fetch', fetch);

    const ne = await loadNaturalEarth(cache);
    expect(fetch).not.toHaveBeenCalled();
    expect(ne.mapUnits).toMatchObject([
      {
        code: 'AAA',
        names: { NAME: 'Aland', NAME_LONG: 'Aland Republic', ADMIN: 'Aland', GEOUNIT: 'Aland' },
        adm0: 'AAA',
        guA3: 'AAA',
      },
    ]);
    expect(ne.mapSubunits.map((u) => u.code)).toEqual(['AAS']);
    expect(ne.admin1).toMatchObject([
      { code: 'AAA-1', name: 'North', nameEn: 'North', region: null, label: [0.5, 0.25] },
    ]);
    expect([...ne.disputedAreas.keys()]).toEqual(['B19']);
  });

  it('downloads a missing file from the pinned release into the cache, once', async () => {
    const fetch = vi.fn((url: string) => {
      const file = Object.keys(RELEASE).find((f) => url === naturalEarthUrl(f))!;
      return Promise.resolve(new Response(JSON.stringify(RELEASE[file])));
    });
    vi.stubGlobal('fetch', fetch);

    await loadNaturalEarth(cache);
    expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual(
      Object.values(NE_FILES)
        .map((f) => naturalEarthUrl(f))
        .sort(),
    );
    expect((await readdir(versionDir())).sort()).toEqual(
      Object.values(NE_FILES)
        .map((f) => `${f}.geojson`)
        .sort(),
    );

    fetch.mockClear();
    expect((await loadNaturalEarth(cache)).admin1.map((r) => r.code)).toEqual(['AAA-1']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails naming the time limit, and caches nothing, when a download stalls', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    );
    await expect(loadNaturalEarth(cache)).rejects.toThrow(
      /^fetching https:\/\/raw\.githubusercontent\.com\/.*: no complete response within 120 s$/,
    );
    expect(existsSync(versionDir()) ? await readdir(versionDir()) : []).toEqual([]);
  });
});
