import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDataCache } from './fetchJson';
import { loadCountries, loadPlaces, loadRegions } from './loaders';

/** A one-polygon topology whose single geometry is a clockwise 2 x 2 degree square. */
function topology(objectName: string, id: string, properties: object) {
  return {
    type: 'Topology',
    arcs: [
      [
        [0, 0],
        [0, 2],
        [2, 2],
        [2, 0],
        [0, 0],
      ],
    ],
    objects: {
      [objectName]: {
        type: 'GeometryCollection',
        geometries: [{ type: 'Polygon', id, properties, arcs: [[0]] }],
      },
    },
  };
}

const files: Record<string, unknown> = {
  '/data/countries.topo.json': topology('countries', 'france', {
    name: 'France',
    ne: ['FRA'],
    places: 5,
    hasRegions: true,
  }),
  '/data/places.json': [
    {
      id: 'paris',
      name: 'Paris',
      country: 'france',
      region: null,
      lat: 48.8,
      lng: 2.3,
      type: 'capital',
      level: 1,
    },
  ],
  '/data/regions/france.topo.json': topology('regions', 'france.brittany', {
    name: 'Brittany',
    places: 2,
  }),
};

let fetchMock: ReturnType<typeof vi.fn>;
const failing = new Set<string>();

beforeEach(() => {
  clearDataCache();
  failing.clear();
  fetchMock = vi.fn(async (url: string) => {
    if (failing.has(url)) return new Response('boom', { status: 503 });
    const body = files[url];
    return body === undefined ? new Response('', { status: 404 }) : Response.json(body);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loaders', () => {
  it('loadCountries returns features and engine Countries, fetching once', async () => {
    const [a, b] = await Promise.all([loadCountries(), loadCountries()]);
    expect(a).toBe(b);
    expect(a.features[0]).toMatchObject({
      id: 'france',
      properties: { name: 'France', places: 5 },
    });
    expect(a.countries).toEqual([{ id: 'france', name: 'France', places: 5, hasRegions: true }]);
    await loadCountries();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/data/countries.topo.json');
  });

  it('loadPlaces returns the flat list', async () => {
    const places = await loadPlaces();
    expect(places.map((p) => p.id)).toEqual(['paris']);
    expect(fetchMock).toHaveBeenCalledWith('/data/places.json');
  });

  it('loadRegions returns features and engine Regions for a country', async () => {
    const { features, regions } = await loadRegions('france');
    expect(features[0]).toMatchObject({
      id: 'france.brittany',
      properties: { name: 'Brittany', places: 2 },
    });
    expect(regions).toEqual([
      { id: 'france.brittany', name: 'Brittany', country: 'france', places: 2 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/data/regions/france.topo.json');
  });

  it('loadRegions rejects for a country without regions or unknown, without fetching its file', async () => {
    files['/data/countries.topo.json'] = topology('countries', 'monaco', {
      name: 'Monaco',
      ne: ['MCO'],
      places: 1,
      hasRegions: false,
    });
    await expect(loadRegions('monaco')).rejects.toThrow(/no regions tier/);
    await expect(loadRegions('nowhere')).rejects.toThrow(/Unknown country/);
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/data/countries.topo.json']);
  });

  it('rejects with the URL and status, and a failed fetch is not cached', async () => {
    failing.add('/data/places.json');
    await expect(loadPlaces()).rejects.toThrow('/data/places.json: HTTP 503');
    failing.clear();
    await expect(loadPlaces()).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
