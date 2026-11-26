/**
 * `npm run spec:check`: every spec entry is linked up a tier and tested (or marked Verified:),
 * and every test cites a spec ID that exists. Exits 1 on any error. See spec/README.md.
 *
 * `--quiet` prints only the summary and the error count by kind.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from './check';
import { parseSpecFile, tierOfFile, type SpecEntry } from './spec';
import { findTests, type TestCase } from './tests';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../..');

function walk(dir: string): string[] {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(root, join(d.parentPath, d.name)).split('\\').join('/'));
}

const entries: SpecEntry[] = [];
for (const file of walk('spec')) {
  const tier = tierOfFile(file);
  if (tier !== null) entries.push(...parseSpecFile(file, readFileSync(join(root, file), 'utf8'), tier));
}

const tests: TestCase[] = [];
for (const dir of ['src', 'scripts', 'e2e'])
  for (const file of walk(dir))
    if (/\.spec\.tsx?$/.test(file) && !file.includes('node_modules/'))
      tests.push(...findTests(file, readFileSync(join(root, file), 'utf8')));

const { errors, stats } = check(entries, tests);
const quiet = process.argv.includes('--quiet');
if (!quiet) for (const e of errors) console.log(`✗ ${e}`);
const [l0, l1, l2] = stats.entries;
console.log(
  `spec: ${l0} product, ${l1} scenarios, ${l2} contract entries · ${stats.tested} tested, ` +
    `${stats.verified} Verified: · ${stats.tests} tests · ${errors.length} error(s)`,
);
if (quiet && errors.length) {
  const kinds = new Map<string, number>();
  for (const e of errors) {
    const kind = e
      .replace(/^\S+ /, '')
      .replace(/\b[A-Z]{2,4}-C?\d{2,3}\b/g, 'ID')
      .replace(/:.*$/, '');
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  for (const [kind, n] of kinds) console.log(`  ${n} × ${kind}`);
}
process.exit(errors.length ? 1 : 0);
