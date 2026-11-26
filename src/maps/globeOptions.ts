// The globe's map options and interaction constants, as plain data: only types come from
// MapLibre, so this runs (and is tested) without a browser.
import type { MapOptions } from 'maplibre-gl';
import type { LngLat } from './geo';
import { imageryStyle, MAX_ZOOM, PROGRESS_DOT_RADIUS } from './globeLayers';

/** Where the globe opens, and where `worldView` centres by default. */
export const START: LngLat = [0, 20];
/** The map never draws at more than this many device pixels per CSS pixel. */
export const MAX_PIXEL_RATIO = 2;
/** A tap whose point, unprojected and projected back, moves more than this is off the globe. */
export const OFF_GLOBE_PX = 2;
/** `fitFeature`'s margin around the feature, in CSS px. */
export const FIT_PADDING = 40;
/** The reveal's margin: wider, so a pin and the name beside it clear the globe's edges. */
export const REVEAL_PADDING = 72;
/** How far from a progress dot's centre, in CSS px, a tap is on the dot as drawn. */
export const DOT_DRAWN_PX = PROGRESS_DOT_RADIUS + 2;
/** How far from a progress dot's centre, in CSS px, a tap inside no feature still lands on it. */
export const DOT_SLACK_PX = PROGRESS_DOT_RADIUS + 8;
/** Zoom slack when telling a view at the fitted zoom from one the user zoomed in. */
export const FITTED_EPSILON = 0.01;
/** The reveal's pin colours: the tap's and the answer's. */
export const REVEAL_TAP_PIN = '#fa5252';
export const REVEAL_ANSWER_PIN = '#40c057';
/** A name marker hangs below its point by this offset, in CSS px. */
export const NAME_MARKER_OFFSET: [number, number] = [0, 6];

/**
 * Wide screens, as `GlobeLayout.module.css` has them (Mantine's `sm`, 768px): the attribution is
 * written out in full there, and compact (the ⓘ button) at phone width.
 */
export const WIDE_SCREEN = '(min-width: 48em)';

/** MapLibre's globe lets the zoom go this far below minZoom at `lat` (see the opening jump). */
export const latAllowance = (lat: number) => Math.log2(Math.cos((lat * Math.PI) / 180));

/**
 * The map's options but its container and pixel ratio: the imagery style, opening at `zoom`
 * (also the zoom-out limit), north up and never tilted, with no double-click zoom and no
 * attribution control (the globe adds its own, compact or not by screen width).
 */
export function mapOptions(zoom: number): Omit<MapOptions, 'container' | 'pixelRatio'> {
  return {
    style: imageryStyle(),
    center: START,
    zoom,
    minZoom: zoom,
    maxZoom: MAX_ZOOM,
    maxPitch: 0,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    // A tap is an answer, so two quick taps are two answers, not a zoom (mouse and touch).
    doubleClickZoom: false,
    attributionControl: false,
  };
}
