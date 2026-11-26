import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';
import { DEPENDENCY_CREDITS } from './credits';

describe('[SCR-28, SCR-C12] DEPENDENCY_CREDITS', () => {
  it('lists every runtime dependency in package.json', () => {
    const listed = DEPENDENCY_CREDITS.map((c) => c.name);
    expect(Object.keys(pkg.dependencies).filter((name) => !listed.includes(name))).toEqual([]);
  });

  it('gives each entry a licence and an https link', () => {
    for (const c of DEPENDENCY_CREDITS) {
      expect(c.licence, c.name).not.toBe('');
      expect(c.url, c.name).toMatch(/^https:\/\//);
    }
  });
});
