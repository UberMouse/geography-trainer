import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DataOut,
  type Manifest,
  QUANTIZATION,
  SIMPLIFY,
  publishData,
  toTopology,
} from './emit';
import { square } from './fixtures/geometry';

describe('[DAT-22] toTopology', () => {
  it('merges point-only shapes into the object, sorted by id, with their properties', async () => {
    const topology = await toTopology('countries', [
      { id: 'zed', areas: [square(0, 0)], properties: { name: 'Zed' } },
      { id: 'dot', areas: [], point: [5, 5], properties: { radiusKm: 4 } },
      { id: 'amy', areas: [square(2, 0), square(4, 0)], properties: { name: 'Amy' } },
    ]);
    expect(Object.keys(topology.objects)).toEqual(['countries']);
    const geometries = topology.objects.countries!.geometries;
    expect(geometries.map((g) => [g.id, g.type, g.properties])).toEqual([
      ['amy', 'MultiPolygon', { name: 'Amy' }],
      ['dot', 'Point', { radiusKm: 4 }],
      ['zed', 'Polygon', { name: 'Zed' }],
    ]);
  });

  it('fails naming a shape that comes out empty', async () => {
    await expect(
      toTopology('regions', [
        { id: 'kept', areas: [square(0, 0)], properties: {} },
        { id: 'lost', areas: [], properties: {} },
      ]),
    ).rejects.toThrow('regions: simplification lost lost');
  });
});

describe('[DAT-24] publishData', () => {
  let root: string;
  let target: string;
  let staging: string;
  const data = (marker: string): DataOut => ({
    places: [],
    countries: { type: 'Topology', objects: {} },
    regions: new Map(),
    manifest: { source: marker } as unknown as Manifest,
    sourceMd: marker,
  });
  const leftovers = async () => [
    ...(await readdir(root)).filter((f) => f !== 'data' && f !== 'staging'),
    ...(existsSync(staging) ? await readdir(staging) : []),
  ];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'publish-'));
    target = join(root, 'data');
    staging = join(root, 'staging');
    await mkdir(target);
    await writeFile(join(target, 'SOURCE.md'), 'committed');
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('leaves the target byte-unchanged when validation reports problems', async () => {
    let validated = '';
    const problems = await publishData(target, staging, data('new'), async (dir) => {
      validated = await readFile(join(dir, 'SOURCE.md'), 'utf8');
      return ['bad'];
    });
    expect([problems, validated]).toEqual([['bad'], 'new']);
    expect(await readdir(target)).toEqual(['SOURCE.md']);
    expect(await readFile(join(target, 'SOURCE.md'), 'utf8')).toBe('committed');
    expect(await leftovers()).toEqual([]);
  });

  it('leaves the target unchanged and cleans up when validation throws', async () => {
    await expect(
      publishData(target, staging, data('new'), () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(await readFile(join(target, 'SOURCE.md'), 'utf8')).toBe('committed');
    expect(await leftovers()).toEqual([]);
  });

  it('replaces the target when validation passes', async () => {
    expect(await publishData(target, staging, data('new'), async () => [])).toEqual([]);
    expect(await readFile(join(target, 'SOURCE.md'), 'utf8')).toBe('new');
    expect(existsSync(join(target, 'places.json'))).toBe(true);
    expect(await leftovers()).toEqual([]);
  });

  it('creates the target when there was none', async () => {
    await rm(target, { recursive: true });
    expect(await publishData(target, staging, data('new'), async () => [])).toEqual([]);
    expect(await readFile(join(target, 'SOURCE.md'), 'utf8')).toBe('new');
    expect(await leftovers()).toEqual([]);
  });
});

describe('[DAT-C10] simplification settings', () => {
  it('keeps 27% of points and quantizes at 1e5', async () => {
    expect(SIMPLIFY).toBe('27%');
    expect(QUANTIZATION).toBe('1e5');
    const topology = await toTopology('countries', [
      { id: 'one', areas: [square(0, 0)], properties: {} },
    ]);
    const { scale } = topology.transform as { scale: [number, number] };
    expect(scale[0]).toBeCloseTo(1 / (1e5 - 1), 12);
  });
});

describe('[DAT-22] simplification keeps every part', () => {
  it('keeps a tiny island beside a detailed coastline', async () => {
    const ring: [number, number][] = [];
    for (let i = 0; i < 400; i++) {
      const a = (2 * Math.PI * i) / 400;
      ring.push([5 * Math.cos(a) + 0.05 * Math.sin(37 * a), 5 * Math.sin(a)]);
    }
    ring.push(ring[0]!);
    const topology = await toTopology('countries', [
      {
        id: 'isles',
        areas: [{ type: 'Polygon', coordinates: [ring] }, square(20, 0, 0.001)],
        properties: {},
      },
    ]);
    const [isles] = topology.objects.countries!.geometries;
    expect(isles!.type).toBe('MultiPolygon');
    expect((isles!.arcs as unknown[]).length).toBe(2);
  });
});

describe('[DAT-C14] the written files', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'write-'));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('writes the five outputs: compact JSON with a final newline, the manifest indented', async () => {
    const target = join(root, 'data');
    const regions = await toTopology('regions', [
      { id: 'aland.north', areas: [square(0, 0)], properties: { name: 'North', places: 1 } },
    ]);
    const manifest = { source: 'x', counts: { kept: 1 } } as unknown as Manifest;
    const places = [
      {
        id: 'p',
        name: 'P',
        country: 'aland',
        region: 'aland.north',
        lat: 0.5,
        lng: 0.5,
        type: 'city',
        level: 1,
      },
    ];
    const data: DataOut = {
      places,
      countries: { type: 'Topology', objects: {} },
      regions: new Map([['aland', regions]]),
      manifest,
      sourceMd: '# Data source\n',
    };
    expect(await publishData(target, join(root, 'staging'), data, async () => [])).toEqual([]);
    expect((await readdir(target)).sort()).toEqual([
      'SOURCE.md',
      'countries.topo.json',
      'manifest.json',
      'places.json',
      'regions',
    ]);
    expect(await readdir(join(target, 'regions'))).toEqual(['aland.topo.json']);
    const read = (path: string) => readFile(join(target, path), 'utf8');
    expect(await read('places.json')).toBe(`${JSON.stringify(places)}\n`);
    expect(await read('regions/aland.topo.json')).toBe(`${JSON.stringify(regions)}\n`);
    expect(await read('manifest.json')).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
    expect(await read('SOURCE.md')).toBe('# Data source\n');
  });
});
