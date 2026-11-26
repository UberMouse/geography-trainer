import { geoDistance } from 'd3-geo';
import type { Feature, MultiLineString, Position } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import realCountries from '../../public/data/countries.topo.json';
import realRussianRegions from '../../public/data/regions/russia.topo.json';
import type { CountryFeature, RegionFeature } from '../data/loaders';
import type { Place } from '../engine/types';
import { ensureArea, type LngLat } from './geo';
import {
  borderLines,
  EOX_ATTRIBUTION,
  EOX_TILES,
  featureAt,
  featureBounds,
  fittedZoom,
  FOV_DEG,
  greatCircle,
  imageryStyle,
  LOWEST_ZOOM,
  MAX_ZOOM,
  modeLayers,
  OUR_PREFIX,
  PROGRESS_DOT_RADIUS,
  PROGRESS_DOTS_LAYER,
  revealLayers,
  SPACE_COLOUR,
  SPHERE_COLOUR,
  type GlobeMode,
  type LayerSet,
} from './globeLayers';

const topo = realCountries as unknown as Topology;
const countries = feature(topo, topo.objects.countries as GeometryCollection)
  .features as CountryFeature[];
const country = (id: string) => countries.find((c) => c.id === id)!;
const russianRegionsTopo = realRussianRegions as unknown as Topology;
const chukotka = feature(
  russianRegionsTopo,
  russianRegionsTopo.objects.regions as GeometryCollection,
).features.find((r) => r.id === 'russia.chukchi-autonomous-okrug') as RegionFeature;

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

describe('[GLB-02, GLB-C07] imageryStyle', () => {
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

  it('[GLB-03] credits EOX with a link to s2maps.eu', () => {
    expect(EOX_ATTRIBUTION.replace(/<[^>]+>/g, '')).toBe(
      'Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)',
    );
    expect(EOX_ATTRIBUTION).toContain('<a href="https://s2maps.eu">');
  });
});

describe('[GLB-09, GLB-C09] modeLayers', () => {
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
    expect(dataOf(set, sourceOf(set, 'gt-region-borders')!)).toEqual(borderLines(frRegions));
    expect(dataOf(set, sourceOf(set, 'gt-country-outline')!)).toEqual(borderLines([france]));
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
    expect(dataOf(set, sourceOf(set, 'gt-highlight-fill')!)).toEqual([france]);
    expect(dataOf(set, sourceOf(set, 'gt-highlight-line')!)).toEqual(borderLines([france]));
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
    expect(dataOf(set, sourceOf(set, 'gt-progress-borders')!)).toEqual(borderLines(frRegions));
  });

  it('progress draws its dots as circles over the fills, each its colour, with its id as a property', () => {
    const set = modeLayers({
      kind: 'progress',
      features: frRegions,
      fills: {},
      dots: [
        { id: 'paris', at: [2.35, 48.85], colour: '#ff0000' },
        { id: 'lyon', at: [4.83, 45.76], colour: '#00ff00' },
      ],
    });
    expect(layerIds(set)).toEqual(['gt-progress-fill', 'gt-progress-borders', PROGRESS_DOTS_LAYER]);
    expect(set.layers[2]).toMatchObject({
      type: 'circle',
      source: PROGRESS_DOTS_LAYER,
      paint: { 'circle-color': ['get', 'colour'], 'circle-radius': PROGRESS_DOT_RADIUS },
    });
    const dots = dataOf(set, PROGRESS_DOTS_LAYER);
    expect(dots.map((f) => f.geometry)).toEqual([
      { type: 'Point', coordinates: [2.35, 48.85] },
      { type: 'Point', coordinates: [4.83, 45.76] },
    ]);
    expect(dots.map((f) => f.properties)).toEqual([
      { id: 'paris', colour: '#ff0000' },
      { id: 'lyon', colour: '#00ff00' },
    ]);
  });

  it('progress without dots, or with none, has no dot layer or source', () => {
    for (const dots of [undefined, []]) {
      const set = modeLayers({ kind: 'progress', features: frRegions, fills: {}, dots });
      expect(layerIds(set)).not.toContain(PROGRESS_DOTS_LAYER);
      expect(set.sources).not.toHaveProperty(PROGRESS_DOTS_LAYER);
    }
  });

  it('every layer of every mode uses only its own sources', () => {
    const modes: GlobeMode[] = [
      { kind: 'countryBorders', countries },
      { kind: 'regionBorders', country: france, regions: frRegions },
      { kind: 'highlight', target: { kind: 'place', place, country: france } },
      { kind: 'progress', features: countries, fills: {} },
      { kind: 'progress', features: countries, fills: {}, dots: [{ id: 'a', at: [0, 0], colour: '#fff' }] },
    ];
    for (const mode of modes) {
      const set = modeLayers(mode);
      for (const layer of set.layers) expect(set.sources).toHaveProperty(sourceOf(set, layer.id)!);
      for (const id of [...Object.keys(set.sources), ...layerIds(set)]) expect(id).toMatch(/^gt-/);
    }
  });

  it("[GLB-10] switching modes leaves none of the previous mode's layers or sources", () => {
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

describe('[GLB-11, GLB-C09] borderLines', () => {
  const segments = (f: Feature<MultiLineString>) =>
    f.geometry.coordinates.flatMap((l) => l.slice(1).map((b, i) => [l[i]!, b] as const));
  const onAntimeridian = ([a, b]: readonly [Position, Position]) =>
    Math.abs(a[0]!) === 180 && Math.abs(b[0]!) === 180;

  it('drops the edge of a square cut at 180, and only that edge', () => {
    const [cut] = borderLines([square('cut', [178, 10])]);
    // The square's ring runs (178,10) (178,12) (180,12) (180,10) (178,10): the edge along 180 goes.
    expect(cut!.geometry.coordinates).toEqual([
      [
        [178, 10],
        [178, 12],
        [180, 12],
      ],
      [
        [180, 10],
        [178, 10],
      ],
    ]);
  });

  it('keeps every edge of a ring with no cut, and the id', () => {
    const [kept] = borderLines([frRegions[0]!]);
    expect(kept!.id).toBe('france.a');
    expect(kept!.geometry.coordinates).toEqual(frRegions[0]!.geometry.coordinates);
  });

  it('leaves Russia, Fiji, Antarctica and Chukotka no segment along 180 or the pole', () => {
    for (const area of [country('russia'), country('fiji'), country('antarctica'), chukotka]) {
      const [lines] = borderLines([area]);
      const all = segments(lines!);
      expect(all.length).toBeGreaterThan(0);
      expect(all.filter(onAntimeridian)).toEqual([]);
      expect(all.filter(([a, b]) => a[1] === -90 && b[1] === -90)).toEqual([]);
    }
  });

  it('gives the same array for the same features', () => {
    expect(borderLines(countries)).toBe(borderLines(countries));
  });
});

describe('[GLB-12, GLB-C10] revealLayers', () => {
  it('outlines an area target and draws the path from tap to answer', () => {
    const set = revealLayers({
      target: { kind: 'area', feature: france },
      tap: { at: [-1.5, 44], answer: [2.5, 46.5] },
    });
    expect(layerIds(set)).toEqual(['gt-reveal-target-line', 'gt-reveal-path']);
    expect(dataOf(set, 'gt-reveal-target')).toEqual(borderLines([france]));
    const path = dataOf(set, 'gt-reveal-path')[0]!.geometry;
    expect(path.type).toBe('LineString');
    expect(path.type === 'LineString' && path.coordinates[0]).toEqual([-1.5, 44]);
  });

  it('marks a point target with a dot', () => {
    const set = revealLayers({
      target: { kind: 'point', at: [2.35, 48.85] },
      tap: { at: [0, 0], answer: [2.35, 48.85] },
    });
    expect(layerIds(set)).toEqual(['gt-reveal-target-dot', 'gt-reveal-path']);
  });

  it('draws no path without a tap (a multiple-choice answer)', () => {
    const set = revealLayers({ target: { kind: 'area', feature: france } });
    expect(layerIds(set)).toEqual(['gt-reveal-target-line']);
    expect(Object.keys(set.sources)).toEqual(['gt-reveal-target']);
  });
});

describe('[GLB-12, GLB-C10] greatCircle', () => {
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

describe('[GLB-20, GLB-C13] featureBounds', () => {
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

describe('[GLB-18, GLB-C11] featureAt', () => {
  it('finds the feature holding the point on the sphere, or none', () => {
    expect(featureAt(frRegions, [1, 46])).toBe('france.a');
    expect(featureAt(frRegions, [3, 46])).toBe('france.b');
    expect(featureAt(frRegions, [50, 46])).toBeUndefined();
  });
});

describe('[GLB-04, GLB-C14] fittedZoom', () => {
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

describe('[GLB-C14] the fitted zoom formula', () => {
  it("fits the sphere's outline with a 5% margin through MapLibre's default field of view", () => {
    expect(LOWEST_ZOOM).toBe(-2);
    expect(MAX_ZOOM).toBe(14);
    expect(FOV_DEG).toBeCloseTo((Math.atan(0.75) * 180) / Math.PI, 12);
    expect(FOV_DEG).toBeCloseTo(36.87, 2);
    const [w, h] = [1000, 700];
    const v = (0.9 * Math.min(w, h)) / 2;
    const d = h / 2 / Math.tan((FOV_DEG * Math.PI) / 360);
    const r = (v * v + v * Math.sqrt(v * v + d * d)) / d;
    expect(fittedZoom(w, h)).toBeCloseTo(Math.log2((2 * Math.PI * r) / 512), 9);
  });
});

describe('[GLB-C07, GLB-02] the imagery style around the tiles', () => {
  it('has a dark blue sphere under the imagery, no atmosphere, and near-black space', () => {
    const style = imageryStyle();
    expect(style.layers[0]).toEqual({
      id: 'sphere',
      type: 'background',
      paint: { 'background-color': '#0b2545' },
    });
    expect(SPHERE_COLOUR).toBe('#0b2545');
    expect(SPACE_COLOUR).toBe('#05070d');
    expect(style.sky).toEqual({ 'atmosphere-blend': 0 });
    expect(style.version).toBe(8);
  });
});

describe('[GLB-C09, GLB-C10] layer paint', () => {
  it('draws each layer in the colour, width and opacity the spec states', () => {
    const sets = [
      modeLayers({ kind: 'highlight', target: { kind: 'country', feature: france, countries } }),
      modeLayers({
        kind: 'highlight',
        target: { kind: 'region', feature: frRegions[0]!, country: france, regions: frRegions },
      }),
      modeLayers({ kind: 'highlight', target: { kind: 'place', place, country: france } }),
      modeLayers({
        kind: 'progress',
        features: frRegions,
        fills: {},
        dots: [{ id: 'paris', at: [2.35, 48.85], colour: '#123456' }],
      }),
      revealLayers({ target: { kind: 'area', feature: france }, tap: { at: [0, 0], answer: [1, 1] } }),
      revealLayers({ target: { kind: 'point', at: [2.35, 48.85] } }),
    ];
    const paint = Object.fromEntries(
      sets.flatMap((s) => s.layers).map((l) => [l.id, { type: l.type, ...('paint' in l ? l.paint : {}) }]),
    );
    const line = (colour: string, width: number) => ({
      type: 'line',
      'line-color': colour,
      'line-width': width,
      'line-opacity': 0.85,
    });
    const circle = (colour: unknown) => ({
      type: 'circle',
      'circle-color': colour,
      'circle-radius': 6,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    });
    expect(paint).toEqual({
      'gt-country-borders': line('#ffffff', 1),
      'gt-progress-borders': line('#ffffff', 1),
      'gt-country-outline': line('#ffffff', 1.5),
      'gt-region-borders': line('#ffd43b', 1),
      'gt-highlight-fill': { type: 'fill', 'fill-color': '#ffd43b', 'fill-opacity': 0.35 },
      'gt-highlight-line': line('#ffd43b', 2),
      'gt-highlight-dot': circle('#ff922b'),
      'gt-progress-fill': { type: 'fill', 'fill-color': ['get', 'fill'], 'fill-opacity': 0.55 },
      'gt-progress-dots': circle(['get', 'colour']),
      'gt-reveal-target-line': line('#40c057', 2.5),
      'gt-reveal-target-dot': circle('#40c057'),
      'gt-reveal-path': {
        type: 'line',
        'line-color': '#ffffff',
        'line-width': 2,
        'line-dasharray': [2, 1],
      },
    });
    expect(OUR_PREFIX).toBe('gt-');
  });

  it('steps the great circle about a degree at a time, ends exact', () => {
    // 90° apart: 90 steps, 91 points.
    const path = greatCircle([0, 0], [90, 0]);
    expect(path).toHaveLength(91);
    expect(path[0]).toEqual([0, 0]);
    expect(path.at(-1)).toEqual([90, 0]);
    expect(greatCircle([0, 0], [0.5, 0])).toHaveLength(2);
  });
});
