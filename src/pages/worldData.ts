import { useMemo } from 'react';
import { buildCurriculum, regionsFromPlaces, type Curriculum } from '../engine/curriculum';
import type { ItemProgress } from '../engine/srs';
import type { Place } from '../engine/types';
import { loadCountries, loadPlaces, type CountriesData } from '../data/loaders';
import { progressStore } from '../storage/progressStore';

/** What Home and the Progress page both load: the countries, the places and the saved progress. */
export interface WorldData {
  countries: CountriesData;
  places: Place[];
  progress: Record<string, ItemProgress>;
}

export const loadWorldData = async (): Promise<WorldData> => {
  const [countries, places, progress] = await Promise.all([
    loadCountries(),
    loadPlaces(),
    progressStore.loadProgress(),
  ]);
  return { countries, places, progress };
};

/** The full curriculum, rebuilt only when the countries or places change. */
export function useCurriculum(data: WorldData): Curriculum {
  return useMemo(
    () =>
      buildCurriculum(
        data.countries.countries,
        regionsFromPlaces(data.countries.countries, data.places),
        data.places,
      ),
    [data.countries, data.places],
  );
}
