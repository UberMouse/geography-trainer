import { existsSync } from 'node:fs';
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
