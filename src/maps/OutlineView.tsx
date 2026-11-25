import { geoPath } from 'd3-geo';
import { useMemo } from 'react';
import type { AreaFeature, LngLat } from './geo';
import { Dot } from './marks';
import { MAP_SIZE, fitFlat, outlineFrame } from './view';

/**
 * One feature alone, its main part (see `mainPart`) fitted with padding into a square: no labels,
 * no other borders. When `point` is not inside that frame, the frame moves to the part of the
 * feature nearest to it, widened to the point if need be (see `outlineFrame`), so the dot shows.
 * Far parts are drawn only where they fall inside the frame.
 */
export default function OutlineView({ feature, point }: { feature: AreaFeature; point?: LngLat }) {
  const projection = useMemo(() => fitFlat(outlineFrame(feature, point)), [feature, point]);
  const d = useMemo(() => geoPath(projection)(feature) ?? '', [projection, feature]);
  return (
    <svg className="map" viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`} role="img" aria-label="Outline">
      <path className="map-land" d={d} />
      {point && <Dot projection={projection} at={point} />}
    </svg>
  );
}
