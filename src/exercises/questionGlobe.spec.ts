import { describe, expect, it } from 'vitest';
import { NEIGHBOURHOOD_VIEW_KM } from '../maps/camera';
import { answerPoint, midpoint, type LngLat } from '../maps/geo';
import { COUNTRIES, DATA, DATA_WITH_ALPHA } from './fixtures';
import { buildExerciseItem } from './item';
import type { ExerciseItem } from './types';
import {
  questionCamera,
  questionMarkers,
  questionMode,
  questionReveal,
  revealCamera,
} from './questionGlobe';

/** An area item's feature and answer point. */
function area(item: ExerciseItem) {
  if (!('feature' in item.target)) throw new Error(`${item.id} is not an area`);
  return item.target;
}

const country = buildExerciseItem('country:alpha', DATA);
const region = buildExerciseItem('region:alpha.north', DATA_WITH_ALPHA);
const place = buildExerciseItem('place:n1', DATA_WITH_ALPHA);

/** The same data with Beta marked point-only, as `loadCountries` marks a country with no area. */
const pointOnlyData = {
  ...DATA,
  countries: {
    ...COUNTRIES,
    features: COUNTRIES.features.map((f) =>
      f.id === 'beta' ? { ...f, properties: { ...f.properties, pointOnly: true } } : f,
    ),
  },
};
const pointOnlyCountry = buildExerciseItem('country:beta', pointOnlyData);
const pointOnlyPlace = buildExerciseItem('place:b1', pointOnlyData);

describe('questionMode', () => {
  it('highlights at L1, draws the borders at L2 and is bare at L3', () => {
    expect(questionMode(region, 1)).toBe(region.highlightMode);
    expect(questionMode(region, 2)).toBe(region.bordersMode);
    expect(questionMode(region, 3)).toEqual({ kind: 'bare' });
  });

  it('gives the same bare mode every time, so the globe does not redraw', () => {
    expect(questionMode(country, 3)).toBe(questionMode(place, 3));
  });
});

describe('questionCamera', () => {
  it('L1: fits a country or region', () => {
    expect(questionCamera(country, 1)).toEqual({ kind: 'fit', feature: area(country).feature });
    expect(questionCamera(region, 1)).toEqual({ kind: 'fit', feature: area(region).feature });
  });

  it('L1: flies to the neighbourhood of a place or a point-only country', () => {
    expect(questionCamera(place, 1)).toEqual({
      kind: 'span',
      at: [2, 47],
      km: NEIGHBOURHOOD_VIEW_KM,
    });
    expect(questionCamera(pointOnlyCountry, 1)).toEqual({
      kind: 'span',
      at: area(pointOnlyCountry).answer,
      km: NEIGHBOURHOOD_VIEW_KM,
    });
  });

  it('L2: shows the whole world for a country, and fits a region’s or place’s country', () => {
    expect(questionCamera(country, 2)).toEqual({ kind: 'world' });
    expect(questionCamera(region, 2)).toEqual({ kind: 'fit', feature: region.frame });
    expect(questionCamera(place, 2)).toEqual({ kind: 'fit', feature: place.frame });
  });

  it('L2: shows the whole world, centred between frame and target, for one outside the frame', () => {
    const isle = buildExerciseItem('region:alpha.isle', DATA_WITH_ALPHA);
    const islePlace = buildExerciseItem('place:i1', DATA_WITH_ALPHA);
    expect(questionCamera(isle, 2)).toEqual({
      kind: 'world',
      at: midpoint(answerPoint(isle.frame), area(isle).answer),
    });
    expect(questionCamera(islePlace, 2)).toEqual({
      kind: 'world',
      at: midpoint(answerPoint(islePlace.frame), [55.5, -21]),
    });
    // L2 still draws its country's region borders.
    expect(questionMode(isle, 2)).toBe(isle.bordersMode);
    expect(isle.bordersMode).toMatchObject({ kind: 'regionBorders' });
  });

  it('L2: flies to the neighbourhood of a point-only country for its place', () => {
    expect(questionCamera(pointOnlyPlace, 2)).toEqual({
      kind: 'span',
      at: answerPoint(pointOnlyPlace.frame),
      km: NEIGHBOURHOOD_VIEW_KM,
    });
    // A point-only country itself is a country question: the whole world.
    expect(questionCamera(pointOnlyCountry, 2)).toEqual({ kind: 'world' });
  });

  it('L3: stays where the camera is, unless it opens a page', () => {
    expect(questionCamera(country, 3)).toEqual({ kind: 'stay' });
    expect(questionCamera(place, 3, false)).toEqual({ kind: 'stay' });
    expect(questionCamera(place, 3, true)).toEqual({ kind: 'world' });
  });

  it('L1 and L2 make their own move when they open a page', () => {
    expect(questionCamera(region, 1, true)).toEqual(questionCamera(region, 1));
    expect(questionCamera(region, 2, true)).toEqual(questionCamera(region, 2));
  });
});

describe('questionReveal', () => {
  it('outlines an area target, with the tap and its answer point for a tap', () => {
    const tap: LngLat = [3, 44];
    expect(questionReveal(region, tap)).toEqual({
      target: { kind: 'area', feature: area(region).feature },
      tap: { at: tap, answer: area(region).answer },
    });
  });

  it('dots a place target at its point', () => {
    expect(questionReveal(place, [0, 0])).toEqual({
      target: { kind: 'point', at: [2, 47] },
      tap: { at: [0, 0], answer: [2, 47] },
    });
  });

  it('has no tap for a multiple-choice answer', () => {
    const reveal = questionReveal(country);
    expect(reveal.target.kind).toBe('area');
    expect(reveal).not.toHaveProperty('tap');
  });
});

describe('revealCamera', () => {
  it('frames the tap and the answer point together', () => {
    expect(revealCamera(place, [10, 40])).toEqual({ kind: 'pair', a: [10, 40], b: [2, 47] });
  });
});

describe('questionMarkers', () => {
  it('has nothing before the first tap, then the pin', () => {
    expect(questionMarkers(place, null, false)).toEqual([]);
    expect(questionMarkers(place, [1, 2], false)).toEqual([{ kind: 'pin', at: [1, 2] }]);
  });

  it('names the target at its answer point once answered, and drops the pin', () => {
    expect(questionMarkers(place, [1, 2], true)).toEqual([
      { kind: 'name', at: [2, 47], text: 'N1' },
    ]);
    expect(questionMarkers(country, null, true)).toEqual([
      { kind: 'name', at: answerPoint(COUNTRIES.features[0]!), text: 'Alpha' },
    ]);
  });
});
