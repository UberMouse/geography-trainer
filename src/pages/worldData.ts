import { buildCurriculum, regionsFromPlaces, type Curriculum } from '../engine/curriculum';
import type { ItemProgress } from '../engine/srs';
import type { Place } from '../engine/types';
import { loadCountries, loadPlaces, type CountriesData } from '../data/loaders';
import { progressStore } from '../storage/progressStore';

/**
 * What Home and the Progress pages load: the countries, the places, the saved progress and the
 * curriculum built from them. Building it here means inconsistent data fails the load (the
 * `Status` error with Retry) instead of throwing during a render.
 */
export interface WorldData {
  countries: CountriesData;
  places: Place[];
  progress: Record<string, ItemProgress>;
  curriculum: Curriculum;
  /** Marker keys of the finished placement tests (see `placementKey`). */
  finishedTests: ReadonlySet<string>;
}

export const loadWorldData = async (): Promise<WorldData> => {
  const [countries, places, progress, finishedTests] = await Promise.all([
    loadCountries(),
    loadPlaces(),
    progressStore.loadProgress(),
    progressStore.loadFinishedTests(),
  ]);
  const curriculum = buildCurriculum(
    countries.countries,
    regionsFromPlaces(countries.countries, places),
    places,
  );
  return { countries, places, progress, curriculum, finishedTests };
};
