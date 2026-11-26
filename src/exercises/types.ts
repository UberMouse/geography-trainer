import type { Grade } from 'ts-fsrs';
import type { Tier } from '../engine/curriculum';
import type { Candidate } from '../engine/distractors';
import type { Rung } from '../engine/srs';
import type { AreaFeature, TapTarget } from '../maps/geo';
import type { GlobeMode } from '../maps/globeLayers';

/** Everything an exercise needs about one item, built by `buildExerciseItem`. */
export interface ExerciseItem {
  /** Namespaced item id (`country:<id>`, `region:<id>` or `place:<id>`). */
  id: string;
  tier: Tier;
  name: string;
  /** Namespaced id of the owning country (`country:<id>`). */
  countryId: string;
  /** A country or region: its feature and answer point; a place: its point. */
  target: TapTarget;
  /**
   * Every other same-tier item a wrong option may be drawn from (see `buildExerciseItem`). It may
   * be empty: a region whose country has no other region with places has none, so a session
   * should not ask such an item at L1, the multiple-choice rung.
   */
  candidates: Candidate[];
  /** The country's main part, which L2's camera fits for a region or place. */
  frame: AreaFeature;
  /**
   * L1's globe: the item shaded (a place dotted) with its tier's context borders: every country's
   * for a country, its country's regions' (or the country's outline alone) for a region or place.
   */
  highlightMode: GlobeMode;
  /** L2's globe: every country's border for a country, else its country's region borders. */
  bordersMode: GlobeMode;
  /**
   * A point-only country (no area of its own) or a place in one; always false for a region.
   * `questionCamera` reads it: at L1 a point-only country's question flies to the neighbourhood
   * of its answer point instead of fitting the country; at L2 a place's question flies to the
   * neighbourhood of its `frame`'s answer point instead of fitting the frame.
   */
  pointOnly: boolean;
}

/** What one answered question reports. */
export interface ExerciseResult {
  rating: Grade;
  /** Multiple choice: the target was chosen. A tap: it rated Good or Easy. */
  correct: boolean;
  /** From the question's first render to the answer. */
  timeMs: number;
  /**
   * A tap's km off the target as shown: outside a country's or region's border (0 inside), or
   * from a place's point.
   */
  km?: number;
  /** maptap's score for a tap: `maptapScore(kmFromAnswer, inside)`. */
  maptapScore?: number;
}

/** The props every exercise takes. A new `item` or `rung` starts a fresh question. */
export interface ExerciseProps {
  item: ExerciseItem;
  rung: Rung;
  /**
   * Seeds the option order and distractors (`mulberry32(seed)`). A number, not a stateful `Rng`:
   * React may run a state initializer twice in dev, and each run must pick the same options.
   */
  seed: number;
  /** Called exactly once per question, when it is answered. */
  onAnswer: (result: ExerciseResult) => void;
  /** Called when the learner presses Next after the reveal. */
  onNext: () => void;
  /**
   * The first question a page shows: an L3 question then starts from the whole-world view rather
   * than where the camera was left (L1 and L2 move the camera to their own view anyway).
   */
  opening?: boolean;
}
