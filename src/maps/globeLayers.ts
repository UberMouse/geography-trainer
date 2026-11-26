// The globe's style and each mode's sources and layers, as plain data. Only types come from
// MapLibre, so this runs (and is tested) without a browser.
import { geoBounds, geoContains, geoDistance, geoInterpolate } from 'd3-geo';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { AddLayerObject, CustomLayerInterface, MapOptions } from 'maplibre-gl';
import type { CountryFeature, RegionFeature } from '../data/loaders';
import type { Place } from '../engine/types';
import { mainPart, type AreaFeature, type IdentifiedFeature, type LngLat } from './geo';

export type GlobeStyle = Exclude<MapOptions['style'], string | undefined>;
export type GlobeLayer = Exclude<AddLayerObject, CustomLayerInterface>;
export interface GeoJsonSource {
  type: 'geojson';
  data: FeatureCollection;
}

/** A group of our sources and layers, added and removed together. */
export interface LayerSet {
  sources: Record<string, GeoJsonSource>;
  layers: GlobeLayer[];
}

export const EOX_TILES =
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg';
export const EOX_ATTRIBUTION =
  'Sentinel-2 cloudless – <a href="https://s2maps.eu">https://s2maps.eu</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)';

/** Every layer and source of ours has an id with this prefix; the imagery's do not. */
export const OUR_PREFIX = 'gt-';

/** The colour of the sphere under the imagery, so a missing tile shows dark blue. */
export const SPHERE_COLOUR = '#0b2545';
/** The space behind the globe. */
export const SPACE_COLOUR = '#05070d';

const BORDER = '#ffffff';
const REGION_BORDER = '#ffd43b';
const HIGHLIGHT = '#ffd43b';
const PLACE_DOT = '#ff922b';
const REVEAL_TARGET = '#40c057';
const REVEAL_PATH = '#ffffff';

/** Imagery only: no vector basemap, labels, glyphs or sprite. */
export function imageryStyle(): GlobeStyle {
  return {
    version: 8,
    projection: { type: 'globe' },
    sources: {
      imagery: {
        type: 'raster',
        tiles: [EOX_TILES],
        tileSize: 256,
        maxzoom: 14,
        attribution: EOX_ATTRIBUTION,
      },
    },
    layers: [
      { id: 'sphere', type: 'background', paint: { 'background-color': SPHERE_COLOUR } },
      { id: 'imagery', type: 'raster', source: 'imagery' },
    ],
    sky: { 'atmosphere-blend': 0 },
  };
}

/** What the globe draws on top of the imagery. Pass a memoised object: a new one redraws. */
export type GlobeMode =
  | { kind: 'bare' }
  | { kind: 'countryBorders'; countries: CountryFeature[] }
  /** `regions` absent: the country has no regions tier (or they failed to load), so its outline only. */
  | { kind: 'regionBorders'; country: CountryFeature; regions?: RegionFeature[] }
  | { kind: 'highlight'; target: HighlightTarget }
  /** One tier's features, each filled with its colour in `fills` (id → CSS colour) or left unfilled. */
  | { kind: 'progress'; features: IdentifiedFeature[]; fills: Record<string, string> };

export type GlobeModeKind = GlobeMode['kind'];

/** The highlighted item with the data for its tier's context borders. */
export type HighlightTarget =
  | { kind: 'country'; feature: CountryFeature; countries: CountryFeature[] }
  | { kind: 'region'; feature: RegionFeature; country: CountryFeature; regions: RegionFeature[] }
  | { kind: 'place'; place: Place; country: CountryFeature; regions?: RegionFeature[] };

/** The answer shown after a tap: the target, the tap and the answer point. */
export interface Reveal {
  target: { kind: 'area'; feature: AreaFeature } | { kind: 'point'; at: LngLat };
  tap: LngLat;
  answer: LngLat;
}

const collections = new WeakMap<Feature[], GeoJsonSource>();

/** A source of `features`: the same object for the same array, so the globe can skip `setData`. */
function collection(features: Feature[]): GeoJsonSource {
  let source = collections.get(features);
  if (!source) {
    source = { type: 'geojson', data: { type: 'FeatureCollection', features } };
    collections.set(features, source);
  }
  return source;
}

const line = (id: string, source: string, colour: string, width: number): GlobeLayer => ({
  id,
  type: 'line',
  source,
  paint: { 'line-color': colour, 'line-width': width, 'line-opacity': 0.85 },
});

const dot = (id: string, source: string, colour: string): GlobeLayer => ({
  id,
  type: 'circle',
  source,
  paint: {
    'circle-color': colour,
    'circle-radius': 6,
    'circle-stroke-color': '#ffffff',
    'circle-stroke-width': 2,
  },
});

const point = (at: LngLat): Feature<Point> => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'Point', coordinates: at },
});

const countryBorders = (countries: CountryFeature[]): LayerSet => ({
  sources: { 'gt-countries': collection(countries) },
  layers: [line('gt-country-borders', 'gt-countries', BORDER, 1)],
});

/** A country's region borders (when it has them) and its outline. */
function regionBorders(country: CountryFeature, regions?: RegionFeature[]): LayerSet {
  const outline: LayerSet = {
    sources: { 'gt-country-outline': collection([country]) },
    layers: [line('gt-country-outline', 'gt-country-outline', BORDER, 1.5)],
  };
  if (!regions) return outline;
  return {
    sources: { 'gt-regions': collection(regions), ...outline.sources },
    layers: [line('gt-region-borders', 'gt-regions', REGION_BORDER, 1), ...outline.layers],
  };
}

function highlight(target: HighlightTarget): LayerSet {
  const context =
    target.kind === 'country'
      ? countryBorders(target.countries)
      : regionBorders(target.country, target.regions);
  const shown: LayerSet =
    target.kind === 'place'
      ? {
          sources: { 'gt-highlight': collection([point([target.place.lng, target.place.lat])]) },
          layers: [dot('gt-highlight-dot', 'gt-highlight', PLACE_DOT)],
        }
      : {
          sources: { 'gt-highlight': collection([target.feature]) },
          layers: [
            {
              id: 'gt-highlight-fill',
              type: 'fill',
              source: 'gt-highlight',
              paint: { 'fill-color': HIGHLIGHT, 'fill-opacity': 0.35 },
            },
            line('gt-highlight-line', 'gt-highlight', HIGHLIGHT, 2),
          ],
        };
  return {
    sources: { ...context.sources, ...shown.sources },
    layers: [...context.layers, ...shown.layers],
  };
}

function progress(features: IdentifiedFeature[], fills: Record<string, string>): LayerSet {
  // The colour rides on each feature as a property, so one fill layer draws every one of them.
  const coloured = features.map((f) => {
    const fill = fills[f.id];
    return { ...f, properties: fill ? { ...f.properties, fill } : f.properties };
  });
  return {
    sources: { 'gt-progress': collection(coloured) },
    layers: [
      {
        id: 'gt-progress-fill',
        type: 'fill',
        source: 'gt-progress',
        filter: ['has', 'fill'],
        paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.55 },
      },
      line('gt-progress-borders', 'gt-progress', BORDER, 1),
    ],
  };
}

/** The sources and layers a mode draws. */
export function modeLayers(mode: GlobeMode): LayerSet {
  switch (mode.kind) {
    case 'bare':
      return { sources: {}, layers: [] };
    case 'countryBorders':
      return countryBorders(mode.countries);
    case 'regionBorders':
      return regionBorders(mode.country, mode.regions);
    case 'highlight':
      return highlight(mode.target);
    case 'progress':
      return progress(mode.features, mode.fills);
  }
}

/** The reveal's target outline (a dot for a point) and the great-circle path from tap to answer. */
export function revealLayers(reveal: Reveal): LayerSet {
  const { target } = reveal;
  const path: Feature<LineString> = {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: greatCircle(reveal.tap, reveal.answer) },
  };
  return {
    sources: {
      'gt-reveal-target': collection([target.kind === 'area' ? target.feature : point(target.at)]),
      'gt-reveal-path': collection([path]),
    },
    layers: [
      target.kind === 'area'
        ? line('gt-reveal-target-line', 'gt-reveal-target', REVEAL_TARGET, 2.5)
        : dot('gt-reveal-target-dot', 'gt-reveal-target', REVEAL_TARGET),
      {
        id: 'gt-reveal-path',
        type: 'line',
        source: 'gt-reveal-path',
        paint: { 'line-color': REVEAL_PATH, 'line-width': 2, 'line-dasharray': [2, 1] },
      },
    ],
  };
}

/**
 * The great circle from `a` to `b` as points about a degree apart, with longitudes unwrapped so
 * that consecutive points never differ by more than 180°: a path over the antimeridian runs past
 * ±180 instead of jumping back across the world.
 */
export function greatCircle(a: LngLat, b: LngLat): LngLat[] {
  const steps = Math.max(1, Math.ceil((geoDistance(a, b) * 180) / Math.PI));
  // Between exact antipodes every great circle joins them, so geoInterpolate's points are rounding
  // noise: finite, but with no one direction (the path zigzags).
  const at = geoInterpolate(a, b);
  const points: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    // The ends exactly as given; interpolation drifts them by a rounding error.
    const [lng, lat] = i === 0 ? a : i === steps ? b : at(i / steps);
    const prev = points[i - 1];
    const unwrapped = prev ? lng + 360 * Math.round((prev[0] - lng) / 360) : lng;
    points.push([unwrapped, lat]);
  }
  return points;
}

/**
 * The [[west, south], [east, north]] bounds of a feature's main part (see `mainPart`). Bounds
 * across the antimeridian keep east above 180, so they span the feature and not the whole world.
 */
export function featureBounds(feature: AreaFeature): [LngLat, LngLat] {
  const [[west, south], [east, north]] = geoBounds(mainPart(feature));
  return [
    [west, south],
    [east < west ? east + 360 : east, north],
  ];
}

/** The id of the first feature that holds `at` on the sphere, if any. */
export function featureAt(features: IdentifiedFeature[], at: LngLat): string | undefined {
  return features.find((f) => geoContains(f, at))?.id;
}

/** The map's zoom-in limit; `setMinZoom` throws above it. */
export const MAX_ZOOM = 14;
/** The lowest zoom MapLibre accepts for `minZoom`; `setMinZoom` throws below it. */
const LOWEST_ZOOM = -2;

/** MapLibre's default vertical field of view, in degrees. */
const FOV_DEG = (Math.atan(0.75) * 180) / Math.PI;

/**
 * The zoom (at the equator) at which the whole sphere fits a `width` × `height` container with a
 * 5% margin on each side. At the equator the sphere's radius is `512 · 2^zoom / (2π)` CSS px, but
 * MapLibre views it through a perspective camera `d` px from its near surface (`d` set by the
 * container's height and the field of view), so its outline on screen is the smaller
 * `d · R / √(d² + 2dR)`. Solved for R. Clamped to [LOWEST_ZOOM, MAX_ZOOM], the range `setMinZoom`
 * accepts on our map; a container with no size (or a non-finite one) gets LOWEST_ZOOM.
 */
export function fittedZoom(width: number, height: number): number {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
    return LOWEST_ZOOM;
  }
  const visible = (0.9 * Math.min(width, height)) / 2;
  const d = height / 2 / Math.tan((FOV_DEG * Math.PI) / 360);
  const radius = (visible * visible + visible * Math.hypot(visible, d)) / d;
  const zoom = Math.log2((radius * 2 * Math.PI) / 512);
  return Math.min(MAX_ZOOM, Math.max(LOWEST_ZOOM, zoom));
}
