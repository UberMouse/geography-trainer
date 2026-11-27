// What a question shows on the shared globe and where it moves the camera, as plain data.
import type { Rung } from '../engine/srs';
import {
  boundsCentre,
  featureSpanKm,
  NEIGHBOURHOOD_VIEW_KM,
  type CameraMove,
} from '../maps/camera';
import { answerPoint, distanceKm, midpoint, targetPoint, type LngLat } from '../maps/geo';
import type { GlobeMarker } from '../maps/Globe';
import { featureBounds, type GlobeMode, type Reveal } from '../maps/globeLayers';
import type { ExerciseItem } from './types';

const BARE: GlobeMode = { kind: 'bare' };

/** The globe's mode for a question: L1 the highlight, L2 the borders, L3 bare. */
export function questionMode(item: ExerciseItem, rung: Rung): GlobeMode {
  return rung === 1 ? item.highlightMode : rung === 2 ? item.bordersMode : BARE;
}

/** An L1 area's view is this many times its main part's span, so the part takes about 2/5 of the shorter side. */
export const L1_CONTEXT_SCALE = 2.5;
/**
 * An L1 area's view is never more than this many times its main part's span, so a tiny one (Monaco,
 * a city district) still takes about a tenth of the shorter side rather than a speck.
 */
export const L1_CONTEXT_MAX_SCALE = 10;
/** The narrowest view (km across) an L1 region gets; an L1 country's is `NEIGHBOURHOOD_VIEW_KM`. */
export const REGION_CONTEXT_MIN_KM = 300;

const neighbourhood = (at: LngLat): CameraMove => ({
  kind: 'span',
  at,
  km: NEIGHBOURHOOD_VIEW_KM,
});

/**
 * Where the camera goes when a question starts:
 * - L1: a country or region with an area, in its surroundings (centred on its main part, wider
 *   than it, never narrower than the floor unless that is over L1_CONTEXT_MAX_SCALE times it);
 *   the neighbourhood of a point-only country or a place.
 * - L2: a country, the whole world; a region or place, to fit its country (the neighbourhood of a
 *   point-only one); when it lies outside that frame (`outsideFrame`), the whole world centred
 *   halfway between the frame's answer point and the target's, so both are well on the near side.
 * - L3: nowhere (any flight stops where it is), except for a page's `opening` question, which
 *   starts from the whole world.
 */
export function questionCamera(item: ExerciseItem, rung: Rung, opening = false): CameraMove {
  const { target } = item;
  if (rung === 1) {
    if ('point' in target) return neighbourhood(target.point);
    if (item.pointOnly) return neighbourhood(target.answer);
    const floor = item.tier === 'region' ? REGION_CONTEXT_MIN_KM : NEIGHBOURHOOD_VIEW_KM;
    const span = featureSpanKm(target.feature);
    return {
      kind: 'span',
      at: boundsCentre(featureBounds(target.feature)),
      km: Math.max(L1_CONTEXT_SCALE * span, Math.min(floor, L1_CONTEXT_MAX_SCALE * span)),
    };
  }
  if (rung === 2) {
    if (item.tier === 'country') return { kind: 'world' };
    if (item.pointOnly) return neighbourhood(answerPoint(item.frame));
    return item.outsideFrame
      ? { kind: 'world', at: midpoint(answerPoint(item.frame), targetPoint(target)) }
      : { kind: 'fit', feature: item.frame };
  }
  return opening ? { kind: 'world' } : { kind: 'stay' };
}

/** The reveal after an answer: the target, and the confirmed `tap` with the answer point (L2, L3). */
export function questionReveal(item: ExerciseItem, tap?: LngLat): Reveal {
  const { target } = item;
  return {
    target:
      'point' in target
        ? { kind: 'point', at: target.point }
        : { kind: 'area', feature: target.feature },
    ...(tap && { tap: { at: tap, answer: targetPoint(target) } }),
  };
}

/** Beyond this a tap and its answer are framed by the whole globe, not by fitting both. */
export const REVEAL_WORLD_KM = 5_000;
/** Beyond this they cannot both sit well on the near side, so the globe centres on the answer. */
export const REVEAL_FAR_SIDE_KM = 9_000;

/**
 * The camera after a tap's answer. Within REVEAL_WORLD_KM: framing the tap, the answer point and
 * the target's outline (for a country or region) together, so the country shows whole. Further:
 * the whole globe, centred halfway between them, or on the answer beyond REVEAL_FAR_SIDE_KM, where
 * fitting both would leave a pin on the globe's edge.
 */
export function revealCamera(item: ExerciseItem, tap: LngLat): CameraMove {
  const answer = targetPoint(item.target);
  const km = distanceKm(tap, answer);
  if (km > REVEAL_FAR_SIDE_KM) return { kind: 'world', at: answer };
  if (km > REVEAL_WORLD_KM) return { kind: 'world', at: midpoint(tap, answer) };
  const { target } = item;
  return 'feature' in target ? { kind: 'pair', a: tap, b: answer, feature: target.feature } : { kind: 'pair', a: tap, b: answer };
}

/**
 * The question's markers: the pin while it is unanswered (none before the first tap); once
 * answered, the target's name at its answer point, and no pin (the reveal has its own).
 */
export function questionMarkers(
  item: ExerciseItem,
  pin: LngLat | null,
  answered: boolean,
): GlobeMarker[] {
  if (answered) return [{ kind: 'name', at: targetPoint(item.target), text: item.name }];
  return pin ? [{ kind: 'pin', at: pin }] : [];
}
