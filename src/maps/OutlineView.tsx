import { geoPath } from 'd3-geo';
import { useMemo } from 'react';
import type { AreaFeature, LngLat } from './geo';
import { Dot } from './marks';
import { MAP_SIZE, fitFlat } from './view';

/** One feature alone, fitted with padding into a square: no labels, no other borders. */
export default function OutlineView({ feature, point }: { feature: AreaFeature; point?: LngLat }) {
  const projection = useMemo(() => fitFlat([feature]), [feature]);
  const d = useMemo(() => geoPath(projection)(feature) ?? '', [projection, feature]);
  return (
    <svg className="map" viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`} role="img" aria-label="Outline">
      <path className="map-land" d={d} />
      {point && <Dot projection={projection} at={point} />}
    </svg>
  );
}
