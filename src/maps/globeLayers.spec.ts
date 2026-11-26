import { geoDistance } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import realCountries from '../../public/data/countries.topo.json';
import type { CountryFeature, RegionFeature } from '../data/loaders';
import type { Place } from '../engine/types';
import { ensureArea, type LngLat } from './geo';
import {
  EOX_ATTRIBUTION,
  EOX_TILES,
  featureAt,
  featureBounds,
  fittedZoom,
  greatCircle,
  imageryStyle,
  modeLayers,
  revealLayers,
  type GlobeMode,
  type LayerSet,
} from './globeLayers';

const topo = realCountries as unknown as Topology;
const countries = feature(topo, topo.objects.countries as GeometryCollection)
  .features as CountryFeature[];
const country = (id: string) => countries.find((c) => c.id === id)!;

/** A square region feature, clockwise as d3-geo wants. */
const square = (id: string, [x, y]: LngLat, size = 2): RegionFeature => ({
  type: 'Feature',
  id,
  properties: { name: id, places: 1 },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x, y + size],
        [x + size, y + size],
        [x + size, y],
        [x, y],
      ],
    ],
  },
});

const france = country('france');
const frRegions = [square('france.a', [0, 45]), square('france.b', [2, 45])];
const place: Place = {
  id: 'paris',
  name: 'Paris',
  country: 'france',
  region: null,
  lat: 48.85,
  lng: 2.35,
  type: 'capital',
  level: 1,
};

const layerIds = (set: LayerSet) => set.layers.map((l) => l.id);
const sourceOf = (set: LayerSet, layerId: string) => {
  const layer = set.layers.find((l) => l.id === layerId)!;
  return 'source' in layer ? (layer.source as string) : undefined;
};
const dataOf = (set: LayerSet, id: string) => set.sources[id]!.data.features;

describe('imageryStyle', () => {
  it('is EOX Sentinel-2 2025 imagery on a globe, with no glyphs, sprite or vector source', () => {
    const style = imageryStyle();
    expect(style.projection).toEqual({ type: 'globe' });
    expect(style.glyphs).toBeUndefined();
    expect(style.sprite).toBeUndefined();
    expect(Object.keys(style.sources)).toEqual(['imagery']);
    expect(style.sources.imagery).toEqual({
      type: 'raster',
      tiles: [
        'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg',
      ],
      tileSize: 256,
      maxzoom: 14,
      attribution: EOX_ATTRIBUTION,
    });
    expect(EOX_TILES).toContain('{z}/{y}/{x}.jpg');
    expect(style.layers.map((l) => l.type)).toEqual(['background', 'raster']);
  });

  it('credits EOX with a link to s2maps.eu', () => {
    expect(EOX_ATTRIBUTION.replace(/<[^>]+>/g, '')).toBe(
      'Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)',
    );
    expect(EOX_ATTRIBUTION).toContain('<a href="https://s2maps.eu">');
  });
});

describe('modeLayers', () => {
  it('bare draws nothing of ours', () => {
    expect(modeLayers({ kind: 'bare' })).toEqual({ sources: {}, layers: [] });
  });

  it('countryBorders draws every country as a line', () => {
    const set = modeLayers({ kind: 'countryBorders', countries });
    expect(layerIds(set)).toEqual(['gt-country-borders']);
    expect(set.layers[0]!.type).toBe('line');
    expect(dataOf(set, sourceOf(set, 'gt-country-borders')!)).toHaveLength(countries.length);
  });

  it("regionBorders draws the country's regions and its outline, nothing else", () => {
    const set = modeLayers({ kind: 'regionBorders', country: france, regions: frRegions });
    expect(layerIds(set)).toEqual(['gt-region-borders', 'gt-country-outline']);
    expect(dataOf(set, sourceOf(set, 'gt-region-borders')!)).toEqual(frRegions);
    expect(dataOf(set, sourceOf(set, 'gt-country-outline')!)).toEqual([france]);
  });

  it('regionBorders of a country without a regions tier draws its outline only', () => {
    const set = modeLayers({ kind: 'regionBorders', country: country('fiji') });
    expect(layerIds(set)).toEqual(['gt-country-outline']);
    expect(Object.keys(set.sources)).toEqual(['gt-country-outline']);
  });

  it("highlight of a country shades it over every country's border", () => {
    const set = modeLayers({
      kind: 'highlight',
      target: { kind: 'country', feature: france, countries },
    });
    expect(layerIds(set)).toEqual(['gt-country-borders', 'gt-highlight-fill', 'gt-highlight-line']);
    expect(dataOf(set, 'gt-highlight')).toEqual([france]);
  });

  it("highlight of a region shades it over its country's region borders", () => {
    const set = modeLayers({
      kind: 'highlight',
      target: { kind: 'region', feature: frRegions[1]!, country: france, regions: frRegions },
    });
    expect(layerIds(set)).toEqual([
      'gt-region-borders',
      'gt-country-outline',
      'gt-highlight-fill',
      'gt-highlight-line',
    ]);
    expect(dataOf(set, 'gt-highlight')).toEqual([frRegions[1]]);
  });

  it("highlight of a place is a dot at its lng/lat, over its country's region borders", () => {
    // Paris has no region, but France has a regions tier: its region borders are the context.
    const set = modeLayers({
      kind: 'highlight',
      target: { kind: 'place', place, country: france, regions: frRegions },
    });
    expect(layerIds(set)).toEqual(['gt-region-borders', 'gt-country-outline', 'gt-highlight-dot']);
    expect(set.layers.at(-1)!.type).toBe('circle');
    expect(dataOf(set, 'gt-highlight')[0]!.geometry).toEqual({
      type: 'Point',
      coordinates: [2.35, 48.85],
    });
  });

  it('highlight of a place in a country without regions has its outline as context', () => {
    const set = modeLayers({
      kind: 'highlight',
      target: { kind: 'place', place: { ...place, country: 'fiji' }, country: country('fiji') },
    });
    expect(layerIds(set)).toEqual(['gt-country-outline', 'gt-highlight-dot']);
  });

  it('progress fills each feature with its colour, leaves one missing from fills unfilled, and borders all', () => {
    const set = modeLayers({
      kind: 'progress',
      features: frRegions,
      fills: { 'france.a': '#ff0000' },
    });
    expect(layerIds(set)).toEqual(['gt-progress-fill', 'gt-progress-borders']);
    const fill = set.layers[0]!;
    expect(fill).toMatchObject({ type: 'fill', filter: ['has', 'fill'] });
    const data = dataOf(set, 'gt-progress');
    expect(data.map((f) => f.properties?.fill)).toEqual(['#ff0000', undefined]);
    expect(data.map((f) => f.id)).toEqual(['france.a', 'france.b']);
  });

  it('every layer of every mode uses only its own sources', () => {
    const modes: GlobeMode[] = [
      { kind: 'countryBorders', countries },
      { kind: 'regionBorders', country: france, regions: frRegions },
      { kind: 'highlight', target: { kind: 'place', place, country: france } },
      { kind: 'progress', features: countries, fills: {} },
    ];
    for (const mode of modes) {
      const set = modeLayers(mode);
      for (const layer of set.layers) expect(set.sources).toHaveProperty(sourceOf(set, layer.id)!);
      for (const id of [...Object.keys(set.sources), ...layerIds(set)]) expect(id).toMatch(/^gt-/);
    }
  });

  it("switching modes leaves none of the previous mode's layers or sources", () => {
    const before = modeLayers({ kind: 'countryBorders', countries });
    const after = modeLayers({ kind: 'regionBorders', country: france, regions: frRegions });
    for (const id of layerIds(before)) expect(layerIds(after)).not.toContain(id);
    for (const id of Object.keys(before.sources)) expect(after.sources).not.toHaveProperty(id);
    expect(modeLayers({ kind: 'bare' }).layers).toEqual([]);
  });

  it('gives the same data object for the same features in another mode, so it is not re-sent', () => {
    const borders = modeLayers({ kind: 'countryBorders', countries });
    const highlighted = modeLayers({
      kind: 'highlight',
      target: { kind: 'country', feature: france, countries },
    });
    expect(highlighted.sources['gt-countries']!.data).toBe(borders.sources['gt-countries']!.data);
  });
});

describe('revealLayers', () => {
  it('outlines an area target and draws the path from tap to answer', () => {
    const set = revealLayers({
      target: { kind: 'area', feature: france },
      tap: [-1.5, 44],
      answer: [2.5, 46.5],
    });
    expect(layerIds(set)).toEqual(['gt-reveal-target-line', 'gt-reveal-path']);
    expect(dataOf(set, 'gt-reveal-target')).toEqual([france]);
    const path = dataOf(set, 'gt-reveal-path')[0]!.geometry;
    expect(path.type).toBe('LineString');
  });

  it('marks a point target with a dot', () => {
    const set = revealLayers({
      target: { kind: 'point', at: [2.35, 48.85] },
      tap: [0, 0],
      answer: [2.35, 48.85],
    });
    expect(layerIds(set)).toEqual(['gt-reveal-target-dot', 'gt-reveal-path']);
  });
});

describe('greatCircle', () => {
  it('is densified along the great circle, from tap to answer', () => {
    const a: LngLat = [-74, 40.7]; // New York
    const b: LngLat = [2.35, 48.85]; // Paris
    const path = greatCircle(a, b);
    expect(path.length).toBeGreaterThan(50);
    expect(path[0]).toEqual(a);
    expect(path.at(-1)).toEqual(b);
    // The great circle bows north of both ends, unlike a straight line in lng/lat.
    expect(Math.max(...path.map(([, lat]) => lat))).toBeGreaterThan(51);
    // Every point is on the circle: the legs through it add up to the whole.
    const whole = geoDistance(a, b);
    for (const p of path) expect(geoDistance(a, p) + geoDistance(p, b)).toBeCloseTo(whole, 9);
  });

  it('crosses the antimeridian without jumping across the world', () => {
    const path = greatCircle([170, -10], [-170, -15]);
    for (let i = 1; i < path.length; i++) {
      expect(Math.abs(path[i]![0] - path[i - 1]![0])).toBeLessThan(5);
    }
    // It runs east past 180 rather than back through 0.
    expect(path.at(-1)).toEqual([190, -15]);
    expect(path.every(([lng]) => lng >= 170)).toBe(true);
  });

  it('is just its two ends when they coincide', () => {
    expect(greatCircle([10, 10], [10, 10])).toHaveLength(2);
  });

  it('stays finite between exact antipodes', () => {
    const path = greatCircle([10, 20], [-170, -20]);
    expect(path.flat().every(Number.isFinite)).toBe(true);
  });
});

describe('featureBounds', () => {
  it("frames an ordinary country's main part", () => {
    const [[w, s], [e, n]] = featureBounds(france);
    // Metropolitan France, not French Guiana or the islands of the Indian Ocean.
    expect(w).toBeGreaterThan(-6);
    expect(e).toBeLessThan(10);
    expect(s).toBeGreaterThan(41);
    expect(n).toBeLessThan(52);
  });

  it('spans Fiji across the antimeridian, not the whole world', () => {
    const [[w], [e]] = featureBounds(country('fiji'));
    expect(w).toBeGreaterThan(170);
    expect(e).toBeGreaterThan(180);
    expect(e - w).toBeLessThan(10);
  });

  it('spans Russia east past 180, not the whole world', () => {
    const [[w], [e]] = featureBounds(country('russia'));
    expect(w).toBeGreaterThan(18);
    expect(w).toBeLessThan(30);
    expect(e).toBeGreaterThan(185);
    expect(e).toBeLessThan(195);
  });

  it("frames a point-only country's disc", () => {
    // As `loadCountries` makes it: Saba is stored as a point and drawn as a disc.
    const saba = ensureArea(country('saba'));
    expect(saba.geometry.type).toBe('Polygon');
    const [[w, s], [e, n]] = featureBounds(saba);
    for (const v of [w, s, e, n]) expect(Number.isFinite(v)).toBe(true);
    // Around its point (-63.24, 17.63), a few km across.
    expect(w).toBeLessThan(-63.24);
    expect(e).toBeGreaterThan(-63.24);
    expect(e - w).toBeLessThan(0.2);
    expect(s).toBeLessThan(17.63);
    expect(n).toBeGreaterThan(17.63);
  });
});

describe('featureAt', () => {
  it('finds the feature holding the point on the sphere, or none', () => {
    expect(featureAt(frRegions, [1, 46])).toBe('france.a');
    expect(featureAt(frRegions, [3, 46])).toBe('france.b');
    expect(featureAt(frRegions, [50, 46])).toBeUndefined();
  });
});

describe('fittedZoom', () => {
  it('fits the sphere in the smaller side and grows by one zoom per doubling', () => {
    const z = fittedZoom(800, 600);
    expect(fittedZoom(600, 800)).toBeLessThan(z);
    expect(fittedZoom(1600, 1200)).toBeCloseTo(z + 1, 9);
  });

  it("gives an ordinary container a zoom inside MapLibre's range", () => {
    const z = fittedZoom(800, 600);
    expect(z).toBeGreaterThan(-2);
    expect(z).toBeLessThan(14);
  });

  it('gives a container with no width or height the lowest zoom MapLibre accepts', () => {
    expect(fittedZoom(0, 0)).toBe(-2);
    expect(fittedZoom(0, 600)).toBe(-2);
    expect(fittedZoom(800, 0)).toBe(-2);
    expect(fittedZoom(Number.NaN, 600)).toBe(-2);
  });

  it('clamps a tiny container up to the lowest zoom MapLibre accepts', () => {
    expect(fittedZoom(10, 10)).toBe(-2);
  });
});
