import { geoPath } from 'd3-geo';
import { useMemo } from 'react';
import { answerPoint, type AreaFeature, type LngLat } from './geo';
import { Dot } from './marks';
import { MAP_SIZE, NEUTRAL_VIEW, fitFlat, fitGlobe } from './view';

export type IdentifiedFeature = AreaFeature & { id: string };

/**
 * A static map with one feature shaded and an optional dot. `fit` fits the projection to
 * `features` (a country with its region borders); `globe` draws an orthographic globe of
 * `features` (every country) rotated to centre the highlighted one.
 */
export default function HighlightMap({
  features,
  highlightId,
  point,
  mode,
}: {
  features: IdentifiedFeature[];
  highlightId?: string;
  point?: LngLat;
  mode: 'fit' | 'globe';
}) {
  const highlight = features.find((f) => f.id === highlightId);
  const projection = useMemo(() => {
    if (mode === 'fit') return fitFlat(features);
    return fitGlobe(highlight ? answerPoint(highlight) : [NEUTRAL_VIEW.lng, NEUTRAL_VIEW.lat]);
  }, [mode, features, highlight]);
  const path = useMemo(() => geoPath(projection), [projection]);
  return (
    <svg
      className="map"
      viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
      role="img"
      aria-label="Highlight map"
    >
      {mode === 'globe' && <path className="map-ocean" d={path({ type: 'Sphere' }) ?? ''} />}
      {features.map(
        (f) => f !== highlight && <path key={f.id} className="map-land" d={path(f) ?? ''} />,
      )}
      {/* Drawn last so its neighbours' borders do not paint over it. */}
      {highlight && <path className="map-land map-highlight" d={path(highlight) ?? ''} />}
      {point && <Dot projection={projection} at={point} />}
    </svg>
  );
}
