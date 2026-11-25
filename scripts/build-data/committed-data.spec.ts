import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateDataDir } from './validate';

const dataDir = fileURLToPath(new URL('../../public/data', import.meta.url));

// The committed data, against the current allow-list: a hand-edited or stale entry fails here,
// and so does a missing data directory (no skip).
describe('public/data', () => {
  it('passes validation', async () => {
    expect(
      existsSync(`${dataDir}/manifest.json`),
      `${dataDir}/manifest.json is missing: run npm run build:data and commit public/data`,
    ).toBe(true);
    expect(await validateDataDir(dataDir)).toEqual([]);
  }, 60_000);
});

describe('public/data/regions', () => {
  it("no country's regions share a name", () => {
    const dir = `${dataDir}/regions`;
    const files = readdirSync(dir).filter((f) => f.endsWith('.topo.json'));
    expect(files.length).toBeGreaterThan(0);
    const shared: string[] = [];
    for (const file of files) {
      const topo = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')) as {
        objects: Record<string, { geometries: { properties: { name: string } }[] }>;
      };
      const seen = new Set<string>();
      for (const object of Object.values(topo.objects)) {
        for (const g of object.geometries) {
          const { name } = g.properties;
          if (seen.has(name)) shared.push(`${file}: ${name}`);
          seen.add(name);
        }
      }
    }
    expect(shared).toEqual([]);
  });
});
