import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DataOut, type Manifest, publishData, toTopology } from './emit';
import { square } from './fixtures/geometry';

describe('toTopology', () => {
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

describe('publishData', () => {
  let root: string;
  let target: string;
  const data = (marker: string): DataOut => ({
    places: [],
    countries: { type: 'Topology', objects: {} },
    regions: new Map(),
    manifest: { source: marker } as unknown as Manifest,
    sourceMd: marker,
  });
  const leftovers = async () => (await readdir(root)).filter((f) => f !== 'data');

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'publish-'));
    target = join(root, 'data');
    await mkdir(target);
    await writeFile(join(target, 'SOURCE.md'), 'committed');
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('leaves the target byte-unchanged when validation reports problems', async () => {
    let validated = '';
    const problems = await publishData(target, data('new'), async (dir) => {
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
      publishData(target, data('new'), () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(await readFile(join(target, 'SOURCE.md'), 'utf8')).toBe('committed');
    expect(await leftovers()).toEqual([]);
  });

  it('replaces the target when validation passes', async () => {
    expect(await publishData(target, data('new'), async () => [])).toEqual([]);
    expect(await readFile(join(target, 'SOURCE.md'), 'utf8')).toBe('new');
    expect(existsSync(join(target, 'places.json'))).toBe(true);
    expect(await leftovers()).toEqual([]);
  });

  it('creates the target when there was none', async () => {
    await rm(target, { recursive: true });
    expect(await publishData(target, data('new'), async () => [])).toEqual([]);
    expect(await readFile(join(target, 'SOURCE.md'), 'utf8')).toBe('new');
    expect(await leftovers()).toEqual([]);
  });
});
