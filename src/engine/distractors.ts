import { countryItemId, placeItemId, regionItemId } from './curriculum';
import type { Rng } from './rng';
import type { Place } from './types';

export interface Located {
  id: string;
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km (haversine). */
function distanceKm(a: Located, b: Located): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A multiple-choice question offers up to this many wrong options. */
export const DISTRACTORS = 3;

/** A same-tier item a multiple-choice question can offer as a wrong option. */
export interface Candidate {
  /** Namespaced item id. */
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/** A country or region as the pool rules see it: its raw (un-namespaced) id, name and point. */
export interface PointRecord {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/**
 * `candidates` without any named `name` (the target's own), and with one candidate per name, the
 * nearest to `from` (`[lng, lat]`), so no two options of a question read the same.
 */
export function distinctCandidates(
  candidates: Candidate[],
  name: string,
  from: [number, number],
): Candidate[] {
  const origin: Located = { id: '', lng: from[0], lat: from[1] };
  const nearest = new Map<string, { candidate: Candidate; km: number }>();
  for (const candidate of candidates) {
    if (candidate.name === name) continue;
    const km = distanceKm(origin, candidate);
    const best = nearest.get(candidate.name);
    if (!best || km < best.km) nearest.set(candidate.name, { candidate, km });
  }
  return [...nearest.values()].map((n) => n.candidate);
}

/** A country's wrong options: every other country, distinctly named (see `distinctCandidates`). */
export function countryCandidates(country: PointRecord, countries: PointRecord[]): Candidate[] {
  return distinctCandidates(
    countries.filter((c) => c.id !== country.id).map((c) => ({ ...c, id: countryItemId(c.id) })),
    country.name,
    [country.lng, country.lat],
  );
}

/**
 * A region's wrong options: its country's other regions that have places, distinctly named. The
 * target's `lat`/`lng` is the point it is answered at.
 */
export function regionCandidates(
  region: PointRecord,
  regions: (PointRecord & { places: number })[],
): Candidate[] {
  return distinctCandidates(
    regions
      .filter((r) => r.id !== region.id && r.places > 0)
      .map(({ id, name, lat, lng }) => ({ id: regionItemId(id), name, lat, lng })),
    region.name,
    [region.lng, region.lat],
  );
}

/**
 * A place's wrong options come from its region's other places; with fewer than `DISTRACTORS`
 * distinctly named ones (see `distinctCandidates`), from its country's, then from every place. A
 * place with no region starts at its country.
 */
export function placeCandidates(place: Place, places: Place[]): Candidate[] {
  const others = places.filter((p) => p.id !== place.id);
  const distinct = (pool: Place[]) =>
    distinctCandidates(
      pool.map((p) => ({ id: placeItemId(p.id), name: p.name, lat: p.lat, lng: p.lng })),
      place.name,
      [place.lng, place.lat],
    );
  const pools = [
    place.region === null ? [] : others.filter((p) => p.region === place.region),
    others.filter((p) => p.country === place.country),
  ].map(distinct);
  return pools.find((p) => p.length >= DISTRACTORS) ?? distinct(others);
}

/**
 * Pick `count` distinct distractor ids for a multiple-choice question: drawn with `rng` from the
 * `2 * count` candidates nearest the target by great-circle distance (ties by id). The target is
 * never picked. With fewer than `count` candidates, all of them are returned.
 */
export function pickDistractors(
  target: Located,
  candidates: Located[],
  rng: Rng,
  count = DISTRACTORS,
): string[] {
  const pool = candidates
    .filter((c) => c.id !== target.id)
    .map((c) => ({ id: c.id, km: distanceKm(target, c) }))
    .sort((a, b) => a.km - b.km || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 2 * count)
    .map((c) => c.id);
  if (pool.length <= count) return pool;
  // Partial Fisher-Yates: the first `count` slots end up a uniform draw without replacement.
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}

/** The options (target plus distractors) in an order shuffled with `rng`. */
export function multipleChoice(targetId: string, distractorIds: string[], rng: Rng): string[] {
  const options = [targetId, ...distractorIds];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [options[i], options[j]] = [options[j]!, options[i]!];
  }
  return options;
}
