import type { Rng } from './rng';

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

/**
 * Pick `count` distinct distractor ids for a multiple-choice question: drawn with `rng` from the
 * `2 * count` candidates nearest the target by great-circle distance (ties by id). The target is
 * never picked. With fewer than `count` candidates, all of them are returned.
 */
export function pickDistractors(
  target: Located,
  candidates: Located[],
  rng: Rng,
  count = 3,
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
