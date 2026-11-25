import { feature } from 'topojson-client';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Country, Place, Region } from '../engine/types';
import { ensureArea } from '../maps/geo';
import { dataUrl, fetchJsonOnce, once } from './fetchJson';

export type CountryProps = {
  name: string;
  places: number;
  hasRegions: boolean;
  /** Stored as a Point (outline is just a disc): set by `loadCountries`, absent on the rest. */
  pointOnly?: boolean;
};
export type RegionProps = { name: string; places: number };

export type CountryFeature = Feature<Polygon | MultiPolygon, CountryProps> & { id: string };
export type RegionFeature = Feature<Polygon | MultiPolygon, RegionProps> & { id: string };

export interface CountriesData {
  features: CountryFeature[];
  countries: Country[];
}

export interface RegionsData {
  features: RegionFeature[];
  regions: Region[];
}

/** The object's features, each with an area (`ensureArea`): a few tiny ones are stored as points. */
function featuresOf<F>(topo: Topology, objectName: string, markPoints = false): F[] {
  const object = topo.objects[objectName] as GeometryCollection;
  return feature(topo, object).features.map((f) => {
    // Recorded before `ensureArea` replaces the geometry.
    const pointOnly = markPoints && f.geometry?.type === 'Point';
    const withArea = ensureArea(f);
    return pointOnly ? { ...withArea, properties: { ...withArea.properties, pointOnly } } : withArea;
  }) as F[];
}

/** Every country's feature (id = maptap country id) and engine `Country`, from the countries topology. */
export function loadCountries(): Promise<CountriesData> {
  return once('countries', async () => {
    const topo = await fetchJsonOnce<Topology>(dataUrl('data/countries.topo.json'));
    const features = featuresOf<CountryFeature>(topo, 'countries', true);
    const countries = features.map((f) => ({
      id: f.id,
      name: f.properties.name,
      places: f.properties.places,
      hasRegions: f.properties.hasRegions,
    }));
    return { features, countries };
  });
}

/** The flat place list. */
export function loadPlaces(): Promise<Place[]> {
  return fetchJsonOnce<Place[]>(dataUrl('data/places.json'));
}

/**
 * One country's region features (id `<country>.<region>`) and engine `Region`s, fetched on demand.
 * Rejects without fetching when the country has no regions tier.
 */
export async function loadRegions(countryId: string): Promise<RegionsData> {
  const { countries } = await loadCountries();
  const country = countries.find((c) => c.id === countryId);
  if (!country) throw new Error(`Unknown country "${countryId}"`);
  if (!country.hasRegions) throw new Error(`Country "${countryId}" has no regions tier`);
  return once(`regions:${countryId}`, async () => {
    const topo = await fetchJsonOnce<Topology>(dataUrl(`data/regions/${countryId}.topo.json`));
    const features = featuresOf<RegionFeature>(topo, 'regions');
    const regions = features.map((f) => ({
      id: f.id,
      name: f.properties.name,
      country: countryId,
      places: f.properties.places,
    }));
    return { features, regions };
  });
}
