import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { check } from './check';
import { parseSpecFile, tierOfFile, tierOfId } from './spec';
import { citedIds, findTests } from './tests';

const PRODUCT = `# Product
## PRD-01 Learners train taps
Prose.
`;

const FEATURE = `# Session
### SES-01 Due reviews come first
Up: PRD-01

\`\`\`gherkin
Scenario: due reviews come first
  Given 3 reviews are due
  Then they come first
\`\`\`

### SES-02 The globe stays smooth
Up: PRD-01
Verified: manual — checked by hand on a phone

\`\`\`gherkin
Scenario: dragging
  When the learner drags
  Then it stays smooth
\`\`\`
`;

const CONTRACT = `# Session contract
### SES-C01 Daily cap default
Up: SES-01
The cap is 15.
`;

const entries = () => [
  ...parseSpecFile('spec/00-product.md', PRODUCT, 0),
  ...parseSpecFile('spec/features/session.md', FEATURE, 1),
  ...parseSpecFile('spec/contracts/session.md', CONTRACT, 2),
];

const TESTS = `
describe('[SES-01] session', () => {
  it('orders reviews', () => {});
  it.each([1, 2])('[SES-C01] cap %d', () => {});
  beforeEach(() => {});
});
test('[SES-01, SES-C01] e2e', async ({ page }) => {
  test.skip(isMobile, 'desktop only');
  await test.step('inner', async () => {});
});
`;

describe('[TLG-01] spec:check reads the spec tiers', () => {
  it('maps files and ID shapes to tiers', () => {
    expect(tierOfFile('spec/00-product.md')).toBe(0);
    expect(tierOfFile('spec/features/session.md')).toBe(1);
    expect(tierOfFile('spec/contracts/engine-srs.md')).toBe(2);
    expect(tierOfFile('spec/README.md')).toBeNull();
    expect([tierOfId('PRD-01'), tierOfId('SES-03'), tierOfId('SES-C03')]).toEqual([0, 1, 2]);
  });

  it('reads each entry’s ID, Up: links, Verified: line and gherkin block', () => {
    const [prd, ses1, ses2, c1] = entries();
    expect(prd).toMatchObject({ id: 'PRD-01', tier: 0, title: 'Learners train taps', line: 2 });
    expect(ses1).toMatchObject({ id: 'SES-01', up: ['PRD-01'], hasScenario: true });
    expect(ses1!.verified).toBeUndefined();
    expect(ses2!.verified).toEqual({ kind: 'manual', reason: 'checked by hand on a phone' });
    expect(c1).toMatchObject({ id: 'SES-C01', tier: 2, up: ['SES-01'], hasScenario: false });
  });
});

describe('[TLG-01] spec:check reads markdown robustly', () => {
  const parse = (body: string) => parseSpecFile('spec/features/s.md', body, 1);

  it('keeps reading an entry under a deeper non-ID heading, and ends it at the same level', () => {
    const [a, b] = parse(
      '### SES-01 A\n#### Notes\nUp: PRD-01\n```gherkin\nScenario: a\n```\n### Other\nUp: PRD-02\n### SES-02 B\n',
    );
    expect(a).toMatchObject({ id: 'SES-01', up: ['PRD-01'], hasScenario: true });
    expect(b).toMatchObject({ id: 'SES-02', up: [] });
  });

  it('closes a fence only on a matching marker, so a sample inside it is not an entry', () => {
    const entries = parse('### SES-01 A\nUp: PRD-01\n~~~markdown\n```\n### SES-99 Sample\n```\n~~~\n````\n```\n````\n');
    expect(entries.map((e) => e.id)).toEqual(['SES-01']);
  });

  it('accepts a colon between the Verified: kind and its reason, and build:data as a kind', () => {
    const [a, b] = parse(
      '### SES-01 A\nVerified: typecheck: the types enforce it\n### SES-02 B\nVerified: build:data — console output\n',
    );
    expect(a!.verified).toEqual({ kind: 'typecheck', reason: 'the types enforce it' });
    expect(b!.verified).toEqual({ kind: 'build:data', reason: 'console output' });
  });
});

describe('[TLG-02] spec:check reads test titles', () => {
  it('finds tests with their describe chain, skipping hooks, steps and in-body skips', () => {
    const found = findTests('x.spec.ts', TESTS);
    expect(found.map((t) => t.titles)).toEqual([
      ['[SES-01] session', 'orders reviews'],
      ['[SES-01] session', '[SES-C01] cap %d'],
      ['[SES-01, SES-C01] e2e'],
    ]);
    expect(found.map((t) => t.ids)).toEqual([['SES-01'], ['SES-01', 'SES-C01'], ['SES-01', 'SES-C01']]);
  });

  it('finds a test whose callback comes before a timeout or after options', () => {
    const found = findTests(
      'x.spec.ts',
      `it('[SES-01] slow', () => {}, 30_000);\nit('[SES-02] opts', { timeout: 5 }, () => {});\nit('untagged', async () => {}, 9);`,
    );
    expect(found.map((t) => t.titles[0])).toEqual(['[SES-01] slow', '[SES-02] opts', 'untagged']);
  });

  it('finds a test with a named callback or a tagged-template table', () => {
    const found = findTests(
      'x.spec.ts',
      'it(\'named\', runCase);\nit.each`\n  a | b\n  ${1} | ${2}\n`(\'table $a\', ({ a }) => {});\ntest.skip(isMobile, \'phone only\');',
    );
    expect(found.map((t) => t.titles[0])).toEqual(['named', 'table $a']);
  });

  it('parses a .ts file as TypeScript, so a generic arrow does not hide the tests after it', () => {
    const text = 'const byId = <T extends { id: string }>(a: T, b: T) => a.id < b.id;\nit(\'[SES-01] after\', () => {});';
    expect(findTests('x.spec.ts', text).map((t) => t.titles[0])).toEqual(['[SES-01] after']);
  });

  it('cites only bracketed IDs', () => {
    expect(citedIds('[SES-01] and SES-02 and [GRD-C04, GEO-12]')).toEqual(['SES-01', 'GRD-C04', 'GEO-12']);
  });
});

describe('[TLG-03] spec:check fails on broken tracing', () => {
  it('passes a spec whose entries are all linked and tested or verified', () => {
    const { errors, stats } = check(entries(), findTests('x.spec.ts', TESTS));
    expect(errors).toEqual([]);
    expect(stats).toEqual({ entries: [1, 2, 1], tested: 2, verified: 1, tests: 3 });
  });

  it('reports untested entries, unknown and untagged tests, bad links, duplicates and missing scenarios', () => {
    const extra = parseSpecFile(
      'spec/features/more.md',
      `### SES-01 Dup\nUp: PRD-01\n\`\`\`gherkin\nScenario: x\n\`\`\`\n### SES-09 Orphan\nUp: PRD-99\n### SES-C09 Misplaced\nUp: PRD-01\n`,
      1,
    );
    const tests = findTests('y.spec.ts', `it('[SES-77] ghost', () => {});\nit('untagged', () => {});`);
    const { errors } = check([...entries(), ...extra], tests);
    const text = errors.join('\n');
    expect(text).toMatch(/SES-01 is a duplicate/);
    expect(text).toMatch(/SES-09 names an unknown parent PRD-99/);
    expect(text).toMatch(/SES-09 has no ```gherkin block/);
    expect(text).toMatch(/SES-C09 has the wrong shape for an L1 file/);
    expect(text).toMatch(/test cites unknown ID SES-77/);
    expect(text).toMatch(/test cites no spec ID: "untagged"/);
    expect(text).toMatch(/SES-01 is not cited by any test/);
  });

  it('rejects a Verified: line with an unknown kind or no reason', () => {
    const bad = parseSpecFile(
      'spec/features/s.md',
      `### SES-01 A\nUp: PRD-01\nVerified: vibes — trust me\n\`\`\`gherkin\nScenario: a\n\`\`\`\n### SES-02 B\nUp: PRD-01\nVerified: manual\n\`\`\`gherkin\nScenario: b\n\`\`\`\n`,
      1,
    );
    const text = check([...parseSpecFile('spec/00-product.md', PRODUCT, 0), ...bad], []).errors.join('\n');
    expect(text).toMatch(/SES-01 Verified: kind must be one of/);
    expect(text).toMatch(/SES-02 Verified: needs a reason/);
  });
});

describe('[TLG-04] verify runs spec:check first', () => {
  it('starts npm run verify with spec:check, before the typecheck', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      scripts: Record<string, string>;
    };
    // Only the await-setup wrapper (it waits for a worktree's node_modules install) may come before the checker.
    expect(pkg.scripts['spec:check']).toMatch(/^(scripts\/await-setup\.sh )?tsx scripts\/spec-check\/index\.ts$/);
    expect(pkg.scripts.verify).toMatch(/^npm run spec:check && npm run typecheck && /);
  });
});
