import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { moveCamera, useGlobe } from '../maps/globeContext';
import { countriesMode } from './progressGlobe';
import { lookOrLocked, type CountryLook } from './progressView';
import type { WorldData } from './worldData';

/**
 * Home's and Progress's globe: every country filled by its look, a tap on one opening its
 * drill-down page. The camera goes to the whole world once the page has loaded its data.
 */
export function useCountriesGlobe(data: WorldData, looks: ReadonlyMap<string, CountryLook>) {
  const navigate = useNavigate();
  const mode = useMemo(
    () => countriesMode(data.countries.features, lookOrLocked(looks)),
    [data.countries, looks],
  );
  const camera = useGlobe({ mode, onSelect: (id) => navigate(`/progress/${id}`) });
  useEffect(() => {
    moveCamera(camera, { kind: 'world' });
  }, [camera]);
}
