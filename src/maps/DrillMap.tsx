import { geoPath } from 'd3-geo';
import { useMemo } from 'react';
import type { IdentifiedFeature, LngLat } from './geo';
import type { ProgressLook } from './ProgressMap';
import { MAP_SIZE, fitFlat } from './view';

/** A dot's radius in viewBox units: 3.7 px on a 358 px wide (phone) map, 5 px at full size. */
const DOT_RADIUS = 5;

export interface DrillFeature extends IdentifiedFeature {
  properties: { name: string };
}

export interface DrillDot {
  id: string;
  name: string;
  at: LngLat;
}

/**
 * A fitted flat map of `features` (a country's regions, or one region or country outline) with
 * each place in `dots` drawn as a dot, all filled by `look(id)`. A `null` look draws a feature
 * neutral and inert. With `onSelect`, a feature with a look is tappable. Every shape and dot
 * carries `data-item-id` and `data-state`. The projection fits the features and the dots.
 */
export default function DrillMap({
  features,
  dots,
  look,
  onSelect,
  label,
}: {
  features: DrillFeature[];
  dots: DrillDot[];
  look: (id: string) => ProgressLook | null;
  onSelect?: (id: string) => void;
  label: string;
}) {
  const { shapes, points } = useMemo(() => {
    const frame: Parameters<typeof fitFlat>[0] = [...features];
    if (dots.length > 0) {
      frame.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiPoint', coordinates: dots.map((d) => d.at) },
      });
    }
    const projection = fitFlat(frame);
    const path = geoPath(projection);
    return {
      shapes: features.map((f) => ({ id: f.id, name: f.properties.name, d: path(f) ?? '' })),
      points: dots.flatMap((d) => {
        const xy = projection(d.at);
        return xy ? [{ ...d, x: xy[0], y: xy[1] }] : [];
      }),
    };
  }, [features, dots]);

  return (
    <svg
      className="map drill-map"
      viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
      role="group"
      aria-label={label}
      data-testid="drill-map"
    >
      {shapes.map((s) => {
        const l = look(s.id);
        if (!l) return <path key={s.id} className="map-land" d={s.d} />;
        return (
          <path
            key={s.id}
            className={`map-land${onSelect ? ' progress-tappable' : ''}`}
            d={s.d}
            style={{ fill: l.fill }}
            data-item-id={s.id}
            data-state={l.state}
            onClick={onSelect && (() => onSelect(s.id))}
          >
            <title>{s.name}</title>
          </path>
        );
      })}
      {points.map((p) => {
        const l = look(p.id);
        return (
          <circle
            key={p.id}
            className="map-land drill-dot"
            cx={p.x}
            cy={p.y}
            r={DOT_RADIUS}
            style={{ fill: l?.fill }}
            data-item-id={p.id}
            data-state={l?.state}
          >
            <title>{p.name}</title>
          </circle>
        );
      })}
    </svg>
  );
}
