import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FETCH_TIMEOUT_MS,
  MAPTAP_URL,
  MARKER,
  fetchMaptap,
  parseMaptap,
  sliceArrayLiteral,
} from './fetch-maptap';

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
  it('[DAT-01] stops at the matching bracket, ignoring brackets and escaped quotes in strings', () => {
    const slice = sliceArrayLiteral('const a = ["x]\\"]", ["y"]]; const b = [1];', 'const a = ');
    expect(slice).toBe('["x]\\"]", ["y"]]');
  });

  it('[DAT-03] throws when the marker is missing', () => {
    expect(() => sliceArrayLiteral('const other = [];', 'const a = ')).toThrow(/not found/);
  });

  it('[DAT-03] throws when the array never closes', () => {
    expect(() => sliceArrayLiteral('const a = [1, "]', 'const a = ')).toThrow(/never closes/);
  });
});

describe('parseMaptap', () => {
  it('[DAT-01, DAT-02] reads masterLocationsV2 only, drops disabled: true and keeps disabled: false', () => {
    const list = parseMaptap(FIXTURE);
    expect(list.total).toBe(3);
    expect(list.active.map((e) => e.id)).toEqual(['bracket', 'kept']);
    expect(list.active[0]!.name).toBe('Odd ] name [with "quotes\\" and ]] brackets');
  });

  it('[DAT-03] throws a clear error when the marker is missing', () => {
    expect(() => parseMaptap('const masterLocationsV2Shapes = [];')).toThrow(
      /marker "const masterLocationsV2 =" not found/,
    );
  });

  it('[DAT-03] throws a clear error when the slice is not JSON', () => {
    expect(() => parseMaptap("const masterLocationsV2 = [{id: 'x'}];")).toThrow(/not valid JSON/);
  });

  it('[DAT-03, DAT-C02] throws when an active entry lacks a required field', () => {
    const source = `const masterLocationsV2 = ${JSON.stringify([{ id: 'x', name: 'x' }])};`;
    expect(() => parseMaptap(source)).toThrow(/lack a required field/);
  });

  it('[DAT-03, DAT-C02] names the entry and field of a wrongly typed optional field', () => {
    const entry = {
      id: 'x',
      name: 'x',
      country: 'c',
      lat: 0,
      lng: 0,
      type: 't',
      difficultyLevel: 1,
    };
    const source = `const masterLocationsV2 = ${JSON.stringify([
      { ...entry, admin: 5 },
      { ...entry, id: 'y', disabled: 'true' },
    ])};`;
    expect(() => parseMaptap(source)).toThrow(
      '2 optional fields have the wrong type, e.g. "x".admin, "y".disabled',
    );
  });

  it('[DAT-03] reports non-object elements alongside malformed entries', () => {
    const source = `const masterLocationsV2 = ${JSON.stringify([null, 7, { id: 'x', name: 'x' }])};`;
    expect(() => parseMaptap(source)).toThrow(
      'maptap file: 2 elements are not objects, e.g. #0 null, #1 7; 1 active entries lack a required field',
    );
  });

  it('[DAT-01] never executes maptap code', () => {
    const code = readFileSync(new URL('./fetch-maptap.ts', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/\beval\s*\(|new Function|node:vm|\brequire\s*\(|\bimport\s*\(/);
  });
});

describe('[DAT-C01] maptap source', () => {
  it('reads the V2 list after its masterLocationsV2 marker, within 60 s', () => {
    expect(MAPTAP_URL).toBe('https://maptap.gg/data/master_locations_v2.js');
    expect(MARKER).toBe('const masterLocationsV2 = ');
    expect(FETCH_TIMEOUT_MS).toBe(60_000);
  });
});

describe('[DAT-03] a malformed maptap file', () => {
  it('throws when no [ follows the marker', () => {
    expect(() => parseMaptap('const masterLocationsV2 = {};')).toThrow(
      'maptap file: no "[" right after "const masterLocationsV2 ="',
    );
  });
});

describe('[DAT-04] fetchMaptap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the list with a deadline and parses it', async () => {
    const fetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(FIXTURE)),
    );
    vi.stubGlobal('fetch', fetch);
    expect((await fetchMaptap()).active.map((e) => e.id)).toEqual(['bracket', 'kept']);
    expect(fetch.mock.calls[0]![0]).toBe(MAPTAP_URL);
    expect(fetch.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('fails naming the URL and the status on a non-2xx answer', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 503 })));
    await expect(fetchMaptap()).rejects.toThrow(`fetching ${MAPTAP_URL}: HTTP 503`);
  });

  it('fails naming the URL and the time limit when no complete response comes', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.reject(new DOMException('The operation timed out.', 'TimeoutError')),
    );
    await expect(fetchMaptap()).rejects.toThrow(
      `fetching ${MAPTAP_URL}: no complete response within 60 s`,
    );
  });
});
