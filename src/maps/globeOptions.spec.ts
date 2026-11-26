import { describe, expect, it } from 'vitest';
import { imageryStyle, MAX_ZOOM, PROGRESS_DOT_RADIUS } from './globeLayers';
import {
  DOT_DRAWN_PX,
  DOT_SLACK_PX,
  FIT_PADDING,
  FITTED_EPSILON,
  latAllowance,
  mapOptions,
  MAX_PIXEL_RATIO,
  NAME_MARKER_OFFSET,
  OFF_GLOBE_PX,
  REVEAL_ANSWER_PIN,
  REVEAL_PADDING,
  REVEAL_TAP_PIN,
  START,
  WIDE_SCREEN,
} from './globeOptions';

describe('[GLB-C08, GLB-04, GLB-16, GLB-17] mapOptions', () => {
  it('opens on the imagery at [0, 20], the zoom also its zoom-out limit, up to zoom 14', () => {
    const options = mapOptions(1.5);
    expect(options.style).toEqual(imageryStyle());
    expect(options.center).toEqual([0, 20]);
    expect(START).toEqual([0, 20]);
    expect(options.zoom).toBe(1.5);
    expect(options.minZoom).toBe(1.5);
    expect(options.maxZoom).toBe(14);
    expect(MAX_ZOOM).toBe(14);
  });

  it('keeps north up and the view untilted, with no double-click zoom', () => {
    expect(mapOptions(0)).toMatchObject({
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      doubleClickZoom: false,
    });
  });

  it('leaves the attribution control to the globe, compact below 48em, at most 2 device px', () => {
    expect(mapOptions(0).attributionControl).toBe(false);
    expect(WIDE_SCREEN).toBe('(min-width: 48em)');
    expect(MAX_PIXEL_RATIO).toBe(2);
  });
});

describe('[GLB-C11] tap constants', () => {
  it('has the off-globe tolerance and the dot hit radii', () => {
    expect(OFF_GLOBE_PX).toBe(2);
    expect(PROGRESS_DOT_RADIUS).toBe(6);
    expect(DOT_DRAWN_PX).toBe(8);
    expect(DOT_SLACK_PX).toBe(14);
  });
});

describe('[GLB-C13] camera padding', () => {
  it('pads a fitted feature by 40 px and a reveal by 72 px', () => {
    expect(FIT_PADDING).toBe(40);
    expect(REVEAL_PADDING).toBe(72);
  });
});

describe('[GLB-C14] the fit allowance', () => {
  it('is log2(cos lat): none at the equator, one zoom level at 60°, slack 0.01', () => {
    expect(latAllowance(0)).toBe(0);
    expect(latAllowance(60)).toBeCloseTo(-1, 9);
    expect(latAllowance(-60)).toBeCloseTo(-1, 9);
    expect(FITTED_EPSILON).toBe(0.01);
  });
});

describe('[GLB-C10] reveal markers', () => {
  it('pins the tap red and the answer green, and hangs a name 6 px below its point', () => {
    expect(REVEAL_TAP_PIN).toBe('#fa5252');
    expect(REVEAL_ANSWER_PIN).toBe('#40c057');
    expect(NAME_MARKER_OFFSET).toEqual([0, 6]);
  });
});
