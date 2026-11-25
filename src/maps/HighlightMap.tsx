import { geoPath } from 'd3-geo';
import { useMemo } from 'react';
import { answerPoint, type AreaFeature, type IdentifiedFeature, type LngLat } from './geo';
import { Dot, Rings } from './marks';
import {
  MAP_PADDING,
  MAP_SIZE,
  NEUTRAL_VIEW,
  RING_RADIUS_PX,
  SMALL_TARGET_PX,
  SVG_UNITS_PER_PX,
  fitFlat,
  fitGlobe,
  smallTargetRings,
} from './view';

/**
 * A static map with one feature shaded and an optional dot. `fit` fits the projection to `frame`
 * when given (such as a country's main part), else to `features` (a country with its region
 * borders); features outside the frame are cut off. `globe` draws an orthographic globe of
 * `features` (every country) rotated to centre the highlighted one, else the dot. A highlight too
 * small to see gets ring markers (`smallTargetRings`). `spanKm` zooms the globe to that much
 * ground across the map, centred on the target.
 */
export default function HighlightMap({
  features,
  highlightId,
  point,
  mode,
  frame,
  spanKm,
}: {
  features: IdentifiedFeature[];
  highlightId?: string;
  point?: LngLat;
  mode: 'fit' | 'globe';
  frame?: AreaFeature;
  spanKm?: number;
}) {
  const highlight = features.find((f) => f.id === highlightId);
  const projection = useMemo(() => {
    if (mode === 'fit') return fitFlat(frame ? [frame] : features);
    const centre = highlight ? answerPoint(highlight) : point;
    return fitGlobe(centre ?? [NEUTRAL_VIEW.lng, NEUTRAL_VIEW.lat], MAP_SIZE, MAP_PADDING, spanKm);
  }, [mode, features, frame, highlight, point, spanKm]);
  const path = useMemo(() => geoPath(projection), [projection]);
  const rings = highlight
    ? smallTargetRings(
        path,
        highlight,
        SMALL_TARGET_PX * SVG_UNITS_PER_PX,
        RING_RADIUS_PX * SVG_UNITS_PER_PX,
      )
    : [];
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
      <Rings at={rings} />
      {point && <Dot projection={projection} at={point} />}
    </svg>
  );
}
