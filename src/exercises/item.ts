import { countryItemId, placeItemId, regionItemId } from '../engine/curriculum';
import type { Place } from '../engine/types';
import type { CountriesData, CountryFeature, RegionsData } from '../data/loaders';
import {
  answerPoint,
  distanceKm,
  mainPart,
  nearPoint,
  type AreaFeature,
  type IdentifiedFeature,
  type LngLat,
} from '../maps/geo';
import { inFlatFrame } from '../maps/view';
import type { Candidate, ExerciseItem } from './types';

/** The loaded data an item is built from: `regions` is the item's country's, when it has them. */
export interface ExerciseData {
  countries: CountriesData;
  places: Place[];
  regions?: RegionsData;
}

/** A multiple-choice question offers up to this many wrong options. */
export const DISTRACTORS = 3;

const pointCandidate = (id: string, name: string, [lng, lat]: LngLat): Candidate => ({
  id,
  name,
  lng,
  lat,
});

/**
 * `candidates` without any named `name` (the target's own), and with one candidate per name, the
 * nearest to `from`, so no two options of a question read the same.
 */
export function distinctCandidates(
  candidates: Candidate[],
  name: string,
  from: LngLat,
): Candidate[] {
  const nearest = new Map<string, { candidate: Candidate; km: number }>();
  for (const candidate of candidates) {
    if (candidate.name === name) continue;
    const km = distanceKm(from, [candidate.lng, candidate.lat]);
    const best = nearest.get(candidate.name);
    if (!best || km < best.km) nearest.set(candidate.name, { candidate, km });
  }
  return [...nearest.values()].map((n) => n.candidate);
}

function splitId(itemId: string): [string, string] {
  const at = itemId.indexOf(':');
  if (at < 0) throw new Error(`Unknown item "${itemId}"`);
  return [itemId.slice(0, at), itemId.slice(at + 1)];
}

/**
 * A place's wrong options come from its region's other places; with fewer than `DISTRACTORS`
 * distinctly named ones (see `distinctCandidates`), from its country's, then from every place. A
 * place with no region starts at its country.
 */
function placeCandidates(place: Place, places: Place[]): Candidate[] {
  const others = places.filter((p) => p.id !== place.id);
  const from: LngLat = [place.lng, place.lat];
  const distinct = (pool: Place[]) =>
    distinctCandidates(
      pool.map((p) => pointCandidate(placeItemId(p.id), p.name, [p.lng, p.lat])),
      place.name,
      from,
    );
  const pools = [
    place.region === null ? [] : others.filter((p) => p.region === place.region),
    others.filter((p) => p.country === place.country),
  ].map(distinct);
  return pools.find((p) => p.length >= DISTRACTORS) ?? distinct(others);
}

/**
 * Build the exercise item for a namespaced item id from loaded data (it fetches nothing). Wrong
 * options are drawn from: every other country; the country's other regions that have places; or
 * a place's neighbours (see `placeCandidates`). Throws for an unknown id, for a region or a
 * regions-tier place when `regions` is missing or another country's, and for a place whose region is not in it.
 */
export function buildExerciseItem(itemId: string, data: ExerciseData): ExerciseItem {
  const [tier, id] = splitId(itemId);
  const { features } = data.countries;
  const countryFeature = (countryId: string): CountryFeature => {
    const f = features.find((c) => c.id === countryId);
    if (!f) throw new Error(`Unknown country "${countryId}" for item "${itemId}"`);
    return f;
  };
  const regionsOf = (country: CountryFeature) => {
    const { regions } = data;
    if (!regions || !regions.regions.every((r) => r.country === country.id)) {
      throw new Error(`Item "${itemId}" needs ${country.id}'s regions`);
    }
    return regions;
  };
  /** Every country, with `country` swapped for its regions when given. */
  const worldWith = (country: CountryFeature, regions: IdentifiedFeature[]): IdentifiedFeature[] =>
    regions.length === 0 ? features : [...features.filter((f) => f !== country), ...regions];

  if (tier === 'country') {
    const country = features.find((f) => f.id === id);
    if (!country) throw new Error(`Unknown item "${itemId}"`);
    return {
      id: itemId,
      tier,
      name: country.properties.name,
      countryId: itemId,
      target: { feature: country, answer: answerPoint(country) },
      context: features,
      candidates: distinctCandidates(
        features
          .filter((f) => f !== country)
          .map((f) => pointCandidate(countryItemId(f.id), f.properties.name, nearPoint(f))),
        country.properties.name,
        nearPoint(country),
      ),
      outline: country,
      frame: mainPart(country),
      world: features,
      onGlobe: false,
    };
  }

  if (tier === 'region') {
    const dot = id.indexOf('.');
    if (dot < 0) throw new Error(`Unknown item "${itemId}"`);
    const countryId = id.slice(0, dot);
    const country = countryFeature(countryId);
    const regions = regionsOf(country);
    const region = regions.features.find((f) => f.id === id);
    if (!region) throw new Error(`Unknown item "${itemId}"`);
    const answer = answerPoint(region);
    const frame = mainPart(country);
    const twins = regions.features.filter(
      (f) => f !== region && f.properties.name === region.properties.name,
    );
    return {
      id: itemId,
      tier,
      name: region.properties.name,
      countryId: countryItemId(countryId),
      target: {
        feature: region,
        answer,
        ...(twins.length > 0 && { alsoInside: twins }),
      },
      context: regions.features,
      candidates: distinctCandidates(
        regions.features
          .filter((f) => f !== region && f.properties.places > 0)
          .map((f) => pointCandidate(regionItemId(f.id), f.properties.name, nearPoint(f))),
        region.properties.name,
        answer,
      ),
      outline: region,
      frame,
      world: worldWith(country, regions.features),
      onGlobe: !inFlatFrame(frame, answer),
    };
  }

  if (tier === 'place') {
    const place = data.places.find((p) => p.id === id);
    if (!place) throw new Error(`Unknown item "${itemId}"`);
    const country = countryFeature(place.country);
    const regionFeatures = country.properties.hasRegions ? regionsOf(country).features : [];
    const region = regionFeatures.find((f) => f.id === place.region);
    if (regionFeatures.length > 0 && !region) {
      throw new Error(`Place "${itemId}" has no known region in ${country.id}`);
    }
    const point: LngLat = [place.lng, place.lat];
    const frame = mainPart(country);
    const outline: AreaFeature = region ?? country;
    return {
      id: itemId,
      tier,
      name: place.name,
      countryId: countryItemId(country.id),
      target: { point },
      context: regionFeatures.length > 0 ? regionFeatures : [country],
      candidates: placeCandidates(place, data.places),
      outline,
      frame,
      world: worldWith(country, regionFeatures),
      onGlobe: !inFlatFrame(frame, point),
    };
  }

  throw new Error(`Unknown item "${itemId}"`);
}
