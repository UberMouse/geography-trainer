// What Home, Progress and the drill-down pages show on the shared globe, and where they move its
// camera, as plain data.
import type { CountryFeature } from '../data/loaders';
import { NEIGHBOURHOOD_VIEW_KM, type CameraMove } from '../maps/camera';
import { answerPoint, type AreaFeature, type IdentifiedFeature, type LngLat } from '../maps/geo';
import type { GlobeMode, ProgressDot } from '../maps/globeLayers';
import type { CountryLook } from './progressView';

/** A dot for a place that is not in the curriculum: drawn, in no state's colour. */
export const NEUTRAL_DOT = '#3b3a35';

/**
 * The world by country: each filled by `look(id)`. A point-only country (a disc a few km across,
 * too small to see filled) is also drawn as a dot in its colour, which a tap can land on.
 */
export function countriesMode(
  features: CountryFeature[],
  look: (id: string) => CountryLook,
): GlobeMode {
  const fills: Record<string, string> = {};
  const dots: ProgressDot[] = [];
  for (const f of features) {
    const { fill } = look(f.id);
    fills[f.id] = fill;
    if (f.properties.pointOnly) dots.push({ id: f.id, at: answerPoint(f), colour: fill });
  }
  return { kind: 'progress', features, fills, dots };
}

/**
 * A drill-down page's globe: `features` (a country's regions, or one region or country outline),
 * each filled by `fill(id)` or, when that is null, left unfilled; and a dot per place, coloured by
 * `dotColour(id)` or, when that is null, `NEUTRAL_DOT`.
 */
export function drillMode(
  features: IdentifiedFeature[],
  fill: (id: string) => string | null,
  places: readonly { id: string; at: LngLat }[],
  dotColour: (id: string) => string | null,
): GlobeMode {
  const fills: Record<string, string> = {};
  for (const f of features) {
    const colour = fill(f.id);
    if (colour !== null) fills[f.id] = colour;
  }
  const dots = places.map(({ id, at }) => ({ id, at, colour: dotColour(id) ?? NEUTRAL_DOT }));
  return { kind: 'progress', features, fills, dots };
}

/**
 * Where a drill-down page moves the camera: to fit the region on a region page; on a country
 * page, to fit the country, or to the neighbourhood of a point-only one.
 */
export function drillCamera(country: CountryFeature, region?: AreaFeature): CameraMove {
  if (region) return { kind: 'fit', feature: region };
  if (country.properties.pointOnly) {
    return { kind: 'span', at: answerPoint(country), km: NEIGHBOURHOOD_VIEW_KM };
  }
  return { kind: 'fit', feature: country };
}
