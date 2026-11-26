/** The rules `npm run spec:check` enforces over the spec entries and the tests. */
import { tierOfId, VERIFIED_KINDS, type SpecEntry } from './spec';
import type { TestCase } from './tests';

export interface CheckResult {
  errors: string[];
  stats: { entries: [number, number, number]; tested: number; verified: number; tests: number };
}

const at = (e: { file: string; line: number }) => `${e.file}:${e.line}`;

export function check(entries: SpecEntry[], tests: TestCase[]): CheckResult {
  const errors: string[] = [];
  const byId = new Map<string, SpecEntry>();

  for (const e of entries) {
    const prior = byId.get(e.id);
    if (prior) errors.push(`${at(e)} ${e.id} is a duplicate (first at ${at(prior)})`);
    else byId.set(e.id, e);
    if (tierOfId(e.id) !== e.tier)
      errors.push(`${at(e)} ${e.id} has the wrong shape for an L${e.tier} file`);
  }

  const children = new Map<string, number>();
  for (const e of entries) {
    if (e.tier === 0) continue;
    if (e.up.length === 0) errors.push(`${at(e)} ${e.id} has no Up: line naming its L${e.tier - 1} parent`);
    for (const up of e.up) {
      const parent = byId.get(up);
      if (!parent) errors.push(`${at(e)} ${e.id} names an unknown parent ${up}`);
      else if (parent.tier !== e.tier - 1)
        errors.push(`${at(e)} ${e.id} names ${up}, which is L${parent.tier}, not L${e.tier - 1}`);
      else children.set(up, (children.get(up) ?? 0) + 1);
    }
    if (e.tier === 1 && !e.hasScenario)
      errors.push(`${at(e)} ${e.id} has no \`\`\`gherkin block with a Scenario`);
  }
  for (const e of entries)
    if (e.tier === 0 && !children.has(e.id)) errors.push(`${at(e)} ${e.id} has no L1 scenario under it`);

  const cited = new Map<string, number>();
  for (const t of tests) {
    if (t.ids.length === 0) {
      errors.push(`${t.file}:${t.line} test cites no spec ID: ${JSON.stringify(t.titles.join(' › '))}`);
      continue;
    }
    for (const id of new Set(t.ids)) {
      const e = byId.get(id);
      if (!e) errors.push(`${t.file}:${t.line} test cites unknown ID ${id}`);
      else if (e.tier === 0) errors.push(`${t.file}:${t.line} test cites ${id}; tests cite L1 or L2 IDs, not L0`);
      else cited.set(id, (cited.get(id) ?? 0) + 1);
    }
  }

  let tested = 0;
  let verified = 0;
  for (const e of byId.values()) {
    if (e.tier === 0) continue;
    if (e.verified) {
      if (!(VERIFIED_KINDS as readonly string[]).includes(e.verified.kind))
        errors.push(`${at(e)} ${e.id} Verified: kind must be one of ${VERIFIED_KINDS.join(', ')}`);
      else if (!e.verified.reason) errors.push(`${at(e)} ${e.id} Verified: needs a reason after the kind`);
    }
    if (cited.has(e.id)) tested++;
    else if (e.verified) verified++;
    else errors.push(`${at(e)} ${e.id} is not cited by any test and has no Verified: line`);
  }

  const count = (tier: number) => entries.filter((e) => e.tier === tier).length;
  return { errors, stats: { entries: [count(0), count(1), count(2)], tested, verified, tests: tests.length } };
}
