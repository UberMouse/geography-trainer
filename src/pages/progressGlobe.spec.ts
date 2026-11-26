import { describe, expect, it } from 'vitest';
import type { CountryFeature, RegionFeature } from '../data/loaders';
import { NEIGHBOURHOOD_VIEW_KM } from '../maps/camera';
import { answerPoint, type LngLat } from '../maps/geo';
import { countriesMode, drillCamera, drillMode, NEUTRAL_DOT } from './progressGlobe';
import { PROGRESS_COLOURS, type CountryLook } from './progressView';

/** A square feature, clockwise as d3-geo wants. */
const square = ([x, y]: LngLat, size: number) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [x, y],
      [x, y + size],
      [x + size, y + size],
      [x + size, y],
      [x, y],
    ],
  ],
});

const country = (id: string, at: LngLat, pointOnly = false): CountryFeature => ({
  type: 'Feature',
  id,
  properties: { name: id, places: 1, hasRegions: false, ...(pointOnly && { pointOnly }) },
  geometry: square(at, pointOnly ? 0.01 : 4),
});

const region = (id: string, at: LngLat): RegionFeature => ({
  type: 'Feature',
  id,
  properties: { name: id, places: 1 },
  geometry: square(at, 2),
});

const looks: Record<string, CountryLook> = {
  big: { state: 'learning', fill: PROGRESS_COLOURS.learning },
  tiny: { state: 'mastered', fill: PROGRESS_COLOURS.complete },
};
const look = (id: string) => looks[id] ?? { state: 'locked', fill: PROGRESS_COLOURS.locked };

describe('[SCR-06, SCR-C08] countriesMode', () => {
  const features = [country('big', [0, 0]), country('tiny', [20, 20], true), country('other', [40, 0])];

  it('fills every country by its look', () => {
    const mode = countriesMode(features, look);
    expect(mode).toMatchObject({
      kind: 'progress',
      features,
      fills: {
        big: PROGRESS_COLOURS.learning,
        tiny: PROGRESS_COLOURS.complete,
        other: PROGRESS_COLOURS.locked,
      },
    });
  });

  it('draws a point-only country as a dot in its colour, at its answer point', () => {
    const mode = countriesMode(features, look);
    expect(mode.kind === 'progress' && mode.dots).toEqual([
      { id: 'tiny', at: answerPoint(features[1]!), colour: PROGRESS_COLOURS.complete },
    ]);
  });
});

describe('[SCR-15, SCR-17, SCR-C08] drillMode', () => {
  const regions = [region('r.a', [0, 0]), region('r.b', [2, 0])];

  it('fills the features with a colour and leaves the rest unfilled', () => {
    const mode = drillMode(regions, (id) => (id === 'r.a' ? '#123456' : null), [], () => null);
    expect(mode).toEqual({ kind: 'progress', features: regions, fills: { 'r.a': '#123456' }, dots: [] });
  });

  it('colours each place dot by its state, or neutral when it has none', () => {
    const places = [
      { id: 'p1', at: [1, 1] as LngLat },
      { id: 'p2', at: [3, 1] as LngLat },
    ];
    const mode = drillMode([], () => null, places, (id) => (id === 'p1' ? PROGRESS_COLOURS.new : null));
    expect(mode.kind === 'progress' && mode.dots).toEqual([
      { id: 'p1', at: [1, 1], colour: PROGRESS_COLOURS.new },
      { id: 'p2', at: [3, 1], colour: NEUTRAL_DOT },
    ]);
  });
});

describe('[SCR-15, SCR-17, SCR-C04] drillCamera', () => {
  it('fits the region on a region page', () => {
    const r = region('r.a', [0, 0]);
    expect(drillCamera(country('big', [0, 0]), r)).toEqual({ kind: 'fit', feature: r });
  });

  it('fits the country on a country page', () => {
    const c = country('big', [0, 0]);
    expect(drillCamera(c)).toEqual({ kind: 'fit', feature: c });
  });

  it("goes to a point-only country's neighbourhood", () => {
    const c = country('tiny', [20, 20], true);
    expect(drillCamera(c)).toEqual({ kind: 'span', at: answerPoint(c), km: NEIGHBOURHOOD_VIEW_KM });
  });
});

describe('[SCR-C01] the drill-down constants', () => {
  it('draws a place outside the curriculum in the neutral dot colour', () => {
    expect(NEUTRAL_DOT).toBe('#3b3a35');
  });
});
