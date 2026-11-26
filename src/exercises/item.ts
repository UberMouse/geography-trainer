import { countryItemId } from '../engine/curriculum';
import {
  countryCandidates,
  placeCandidates,
  type PointRecord,
  regionCandidates,
} from '../engine/distractors';
import type { Place } from '../engine/types';
import type { CountriesData, CountryFeature, RegionsData } from '../data/loaders';
import {
  answerPoint,
  frameTest,
  mainPart,
  nearPoint,
  type AreaFeature,
  type LngLat,
} from '../maps/geo';
import type { ExerciseItem } from './types';

export { distinctCandidates } from '../engine/distractors';

/** The loaded data an item is built from: `regions` is the item's country's, when it has them. */
export interface ExerciseData {
  countries: CountriesData;
  places: Place[];
  regions?: RegionsData;
}

const pointRecord = (
  f: { id: string; properties: { name: string } },
  [lng, lat]: LngLat,
): PointRecord => ({ id: f.id, name: f.properties.name, lng, lat });

const outside = (frame: AreaFeature, at: LngLat): boolean => !frameTest(frame)(at);

function splitId(itemId: string): [string, string] {
  const at = itemId.indexOf(':');
  if (at < 0) throw new Error(`Unknown item "${itemId}"`);
  return [itemId.slice(0, at), itemId.slice(at + 1)];
}

/**
 * Build the exercise item for a namespaced item id from loaded data (it fetches nothing). Wrong
 * options are drawn from: every other country; the country's other regions that have places; or
 * a place's neighbours (see `src/engine/distractors.ts`). Throws for an unknown id, for a region or a
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
    if (
      !regions ||
      regions.regions.length === 0 ||
      !regions.regions.every((r) => r.country === country.id)
    ) {
      throw new Error(`Item "${itemId}" needs ${country.id}'s regions`);
    }
    return regions;
  };
  if (tier === 'country') {
    const country = features.find((f) => f.id === id);
    if (!country) throw new Error(`Unknown item "${itemId}"`);
    return {
      id: itemId,
      tier,
      name: country.properties.name,
      countryId: itemId,
      target: { feature: country, answer: answerPoint(country) },
      candidates: countryCandidates(
        pointRecord(country, nearPoint(country)),
        features.map((f) => pointRecord(f, nearPoint(f))),
      ),
      frame: mainPart(country),
      outsideFrame: false,
      highlightMode: {
        kind: 'highlight',
        target: { kind: 'country', feature: country, countries: features },
      },
      bordersMode: { kind: 'countryBorders', countries: features },
      pointOnly: country.properties.pointOnly === true,
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
      candidates: regionCandidates(
        pointRecord(region, answer),
        regions.features.map((f) => ({
          ...pointRecord(f, nearPoint(f)),
          places: f.properties.places,
        })),
      ),
      frame,
      outsideFrame: outside(frame, answer),
      highlightMode: {
        kind: 'highlight',
        target: { kind: 'region', feature: region, country, regions: regions.features },
      },
      bordersMode: { kind: 'regionBorders', country, regions: regions.features },
      pointOnly: false,
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
    const pointOnly = country.properties.pointOnly === true;
    // A country without a regions tier draws its outline alone.
    const regions = regionFeatures.length > 0 ? regionFeatures : undefined;
    return {
      id: itemId,
      tier,
      name: place.name,
      countryId: countryItemId(country.id),
      target: { point },
      candidates: placeCandidates(place, data.places),
      frame,
      outsideFrame: outside(frame, point),
      highlightMode: { kind: 'highlight', target: { kind: 'place', place, country, regions } },
      bordersMode: { kind: 'regionBorders', country, regions },
      pointOnly,
    };
  }

  throw new Error(`Unknown item "${itemId}"`);
}
