// Small hand-made data for the exercise specs: boxes for countries and regions.

import type { MultiPolygon, Polygon } from 'geojson';
import type { CountriesData, CountryFeature, RegionFeature, RegionsData } from '../data/loaders';
import type { Place } from '../engine/types';
import type { LngLat } from '../maps/geo';
import type { ExerciseData } from './item';

/** A clockwise ring (as d3-geo wants) around a lng/lat box. */
const ring = (w: number, s: number, e: number, n: number): LngLat[] => [
  [w, s],
  [w, n],
  [e, n],
  [e, s],
  [w, s],
];

const polygon = (w: number, s: number, e: number, n: number): Polygon => ({
  type: 'Polygon',
  coordinates: [ring(w, s, e, n)],
});

const country = (
  id: string,
  name: string,
  geometry: Polygon | MultiPolygon,
  places: number,
  hasRegions: boolean,
): CountryFeature => ({
  type: 'Feature',
  id,
  properties: { name, places, hasRegions },
  geometry,
});

const region = (id: string, name: string, geometry: Polygon, places: number): RegionFeature => ({
  type: 'Feature',
  id,
  properties: { name, places },
  geometry,
});

/** Alpha: a 10° box at 0–10°E 40–50°N with regions, plus an isle 6,000 km away (its far part). */
const alpha = country(
  'alpha',
  'Alpha',
  { type: 'MultiPolygon', coordinates: [[ring(0, 40, 10, 50)], [ring(55, -21.5, 56, -20.5)]] },
  9,
  true,
);
const beta = country('beta', 'Beta', polygon(20, 40, 30, 50), 2, false);
const gamma = country('gamma', 'Gamma', polygon(-60, -10, -50, 0), 0, false);

const regionFeatures = [
  region('alpha.north', 'North', polygon(0, 45, 10, 50), 4),
  region('alpha.south', 'South', polygon(0, 40, 10, 45), 1),
  region('alpha.empty', 'Empty', polygon(0, 40, 1, 41), 0),
  region('alpha.isle', 'Isle', polygon(55, -21.5, 56, -20.5), 1),
];

const place = (
  id: string,
  countryId: string,
  regionId: string | null,
  lng: number,
  lat: number,
): Place => ({
  id,
  name: id.toUpperCase(),
  country: countryId,
  region: regionId,
  lat,
  lng,
  type: 'city',
  level: 1,
});

export const PLACES: Place[] = [
  place('n1', 'alpha', 'alpha.north', 2, 47),
  place('n2', 'alpha', 'alpha.north', 4, 47),
  place('n3', 'alpha', 'alpha.north', 6, 47),
  place('n4', 'alpha', 'alpha.north', 8, 47),
  place('s1', 'alpha', 'alpha.south', 5, 42),
  place('i1', 'alpha', 'alpha.isle', 55.5, -21),
  place('b1', 'beta', null, 22, 45),
  place('b2', 'beta', null, 28, 45),
];

const features = [alpha, beta, gamma];
export const COUNTRIES: CountriesData = {
  features,
  countries: features.map((f) => ({ id: f.id, ...f.properties })),
};

export const ALPHA_REGIONS: RegionsData = {
  features: regionFeatures,
  regions: regionFeatures.map((f) => ({
    id: f.id,
    name: f.properties.name,
    country: 'alpha',
    places: f.properties.places,
  })),
};

/** The data for an item in Alpha (with its regions) or elsewhere (without). */
export const DATA_WITH_ALPHA: ExerciseData = {
  countries: COUNTRIES,
  places: PLACES,
  regions: ALPHA_REGIONS,
};
export const DATA: ExerciseData = { countries: COUNTRIES, places: PLACES };
