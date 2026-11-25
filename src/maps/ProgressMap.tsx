import { geoEqualEarth, geoPath } from 'd3-geo';
import { useMemo } from 'react';
import type { IdentifiedFeature } from './geo';

export const PROGRESS_MAP_WIDTH = 960;
export const PROGRESS_MAP_HEIGHT = 500;
const PADDING = 8;
/** A point-only country's marker radius in viewBox units: 3 px on a 358 px wide (phone) map. */
const POINT_RADIUS = 8;

export interface ProgressLook {
  state: string;
  /** A CSS colour. */
  fill: string;
}

export type ProgressFeature = IdentifiedFeature & {
  properties: { name: string; pointOnly?: boolean };
};

interface Shape {
  id: string;
  name: string;
  d: string;
  /** The projected centre of a point-only country, drawn as a disc so it can be tapped. */
  centre: [number, number] | null;
}

/**
 * A flat world map (`geoEqualEarth`) with each feature filled by `look(id)`. With `onSelect` a tap
 * or click on a feature selects its id; without it the map is decoration: no handlers, no tab
 * stop, hidden from assistive technology. Each shape carries `data-item-id` and `data-state`.
 */
export default function ProgressMap({
  features,
  look,
  onSelect,
}: {
  features: ProgressFeature[];
  look: (id: string) => ProgressLook;
  onSelect?: (id: string) => void;
}) {
  const { sphere, shapes } = useMemo(() => {
    const projection = geoEqualEarth().fitExtent(
      [
        [PADDING, PADDING],
        [PROGRESS_MAP_WIDTH - PADDING, PROGRESS_MAP_HEIGHT - PADDING],
      ],
      { type: 'Sphere' },
    );
    const path = geoPath(projection);
    return {
      sphere: path({ type: 'Sphere' }) ?? '',
      shapes: features.map(
        (f): Shape => ({
          id: f.id,
          name: f.properties.name,
          d: path(f) ?? '',
          centre: f.properties.pointOnly ? path.centroid(f) : null,
        }),
      ),
    };
  }, [features]);

  return (
    <svg
      className="map progress-map"
      viewBox={`0 0 ${PROGRESS_MAP_WIDTH} ${PROGRESS_MAP_HEIGHT}`}
      data-testid="progress-map"
      {...(onSelect ? { role: 'group', 'aria-label': 'World progress map' } : { 'aria-hidden': true })}
    >
      <path className="map-ocean" d={sphere} />
      {shapes.map((s) => {
        const { state, fill } = look(s.id);
        const common = {
          className: `map-land${onSelect ? ' progress-tappable' : ''}`,
          style: { fill },
          'data-item-id': s.id,
          'data-state': state,
          onClick: onSelect && (() => onSelect(s.id)),
        };
        const title = onSelect && <title>{s.name}</title>;
        return s.centre ? (
          <circle key={s.id} cx={s.centre[0]} cy={s.centre[1]} r={POINT_RADIUS} {...common}>
            {title}
          </circle>
        ) : (
          <path key={s.id} d={s.d} {...common}>
            {title}
          </path>
        );
      })}
    </svg>
  );
}
