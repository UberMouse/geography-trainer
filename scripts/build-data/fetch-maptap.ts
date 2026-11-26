// Downloads maptap's V2 place list and reads its array literal as JSON. maptap's file is never
// executed (no eval, Function, vm, import or require): we slice out the literal and JSON.parse it.

import { fetchWithin } from './http';

export const MAPTAP_URL = 'https://maptap.gg/data/master_locations_v2.js';
export const FETCH_TIMEOUT_MS = 60_000;
export const MARKER = 'const masterLocationsV2 = ';

export interface MaptapEntry {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  type: string;
  difficultyLevel: number;
  population?: number;
  admin?: string;
  disabled?: boolean;
}

/**
 * Returns the text of the JSON array that starts right after `marker`, ending at its matching `]`.
 * Brackets inside JSON strings (escapes included) are not counted.
 */
export function sliceArrayLiteral(source: string, marker: string): string {
  const markerAt = source.indexOf(marker);
  if (markerAt === -1) throw new Error(`maptap file: marker "${marker.trim()}" not found`);
  const start = markerAt + marker.length;
  if (source[start] !== '[') throw new Error(`maptap file: no "[" right after "${marker.trim()}"`);

  let depth = 0;
  let inString = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`maptap file: the array after "${marker.trim()}" never closes`);
}

const OPTIONAL: Array<[keyof MaptapEntry, 'string' | 'number' | 'boolean']> = [
  ['population', 'number'],
  ['admin', 'string'],
  ['disabled', 'boolean'],
];

const REQUIRED: Array<[keyof MaptapEntry, 'string' | 'number']> = [
  ['id', 'string'],
  ['name', 'string'],
  ['country', 'string'],
  ['lat', 'number'],
  ['lng', 'number'],
  ['type', 'string'],
  ['difficultyLevel', 'number'],
];

export interface MaptapList {
  /** Every entry in the array, disabled ones included. */
  total: number;
  /** Entries without `disabled: true`. */
  active: MaptapEntry[];
}

/** Parses the `masterLocationsV2` array out of maptap's JS file and drops disabled entries. */
export function parseMaptap(source: string): MaptapList {
  const literal = sliceArrayLiteral(source, MARKER);
  let parsed: unknown;
  try {
    parsed = JSON.parse(literal);
  } catch (error) {
    throw new Error(
      `maptap file: masterLocationsV2 is not valid JSON (${(error as Error).message})`,
    );
  }
  if (!Array.isArray(parsed)) throw new Error('maptap file: masterLocationsV2 is not an array');

  const isObject = (e: unknown): e is Record<string, unknown> =>
    typeof e === 'object' && e !== null && !Array.isArray(e);
  const notObjects = parsed.flatMap((e, i) => (isObject(e) ? [] : [`#${i} ${JSON.stringify(e)}`]));
  const entries = parsed.filter(isObject);
  const badOptional = entries.flatMap((entry) =>
    OPTIONAL.filter(
      ([field, type]) => entry[field] !== undefined && typeof entry[field] !== type,
    ).map(([field]) => `${JSON.stringify(entry.id ?? entry.name)}.${field}`),
  );
  const active = entries.filter((entry) => entry.disabled !== true);
  const malformed = active.filter((entry) =>
    REQUIRED.some(([field, type]) => typeof entry[field] !== type),
  );
  const problems: string[] = [];
  if (notObjects.length > 0) {
    problems.push(
      `${notObjects.length} elements are not objects, e.g. ${notObjects.slice(0, 5).join(', ')}`,
    );
  }
  if (malformed.length > 0) {
    const ids = malformed.slice(0, 5).map((entry) => JSON.stringify(entry.id ?? entry.name));
    problems.push(
      `${malformed.length} active entries lack a required field (${REQUIRED.map(([f]) => f).join(', ')}), e.g. ${ids.join(', ')}`,
    );
  }
  if (badOptional.length > 0) {
    problems.push(
      `${badOptional.length} optional fields have the wrong type, e.g. ${badOptional.slice(0, 5).join(', ')}`,
    );
  }
  if (problems.length > 0) throw new Error(`maptap file: ${problems.join('; ')}`);
  return { total: parsed.length, active: active as unknown as MaptapEntry[] };
}

/** Fetches maptap's file fresh (never cached) and parses it. */
export async function fetchMaptap(url = MAPTAP_URL): Promise<MaptapList> {
  return parseMaptap(await fetchWithin(url, FETCH_TIMEOUT_MS, (r) => r.text()));
}
