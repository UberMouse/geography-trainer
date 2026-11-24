import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMaptap, sliceArrayLiteral } from './fetch-maptap';

const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id,
  country: 'France',
  lat: 48.8,
  lng: 2.3,
  type: 'city',
  difficultyLevel: 1,
  ...extra,
});

const FIXTURE = [
  '// Master location pool — V2',
  `const masterLocationsV2 = ${JSON.stringify([
    entry('bracket', { name: 'Odd ] name [with "quotes\\" and ]] brackets' }),
    entry('gone', { disabled: true }),
    entry('kept', { disabled: false }),
  ])};`,
  `const masterLocationsV2Shapes = ${JSON.stringify([entry('river', { type: 'river' })])};`,
].join('\n');

describe('sliceArrayLiteral', () => {
  it('stops at the matching bracket, ignoring brackets and escaped quotes in strings', () => {
    const slice = sliceArrayLiteral('const a = ["x]\\"]", ["y"]]; const b = [1];', 'const a = ');
    expect(slice).toBe('["x]\\"]", ["y"]]');
  });

  it('throws when the marker is missing', () => {
    expect(() => sliceArrayLiteral('const other = [];', 'const a = ')).toThrow(/not found/);
  });

  it('throws when the array never closes', () => {
    expect(() => sliceArrayLiteral('const a = [1, "]', 'const a = ')).toThrow(/never closes/);
  });
});

describe('parseMaptap', () => {
  it('reads masterLocationsV2 only, drops disabled: true and keeps disabled: false', () => {
    const list = parseMaptap(FIXTURE);
    expect(list.total).toBe(3);
    expect(list.active.map((e) => e.id)).toEqual(['bracket', 'kept']);
    expect(list.active[0]!.name).toBe('Odd ] name [with "quotes\\" and ]] brackets');
  });

  it('throws a clear error when the marker is missing', () => {
    expect(() => parseMaptap('const masterLocationsV2Shapes = [];')).toThrow(
      /marker "const masterLocationsV2 =" not found/,
    );
  });

  it('throws a clear error when the slice is not JSON', () => {
    expect(() => parseMaptap("const masterLocationsV2 = [{id: 'x'}];")).toThrow(/not valid JSON/);
  });

  it('throws when an active entry lacks a required field', () => {
    const source = `const masterLocationsV2 = ${JSON.stringify([{ id: 'x', name: 'x' }])};`;
    expect(() => parseMaptap(source)).toThrow(/lack a required field/);
  });

  it('never executes maptap code', () => {
    const code = readFileSync(new URL('./fetch-maptap.ts', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/\beval\s*\(|new Function|node:vm|\brequire\s*\(|\bimport\s*\(/);
  });
});
