import type { Grade } from 'ts-fsrs';
import type { Tier } from '../engine/curriculum';
import type { Candidate } from '../engine/distractors';
import type { Rung } from '../engine/srs';
import type { AreaFeature, IdentifiedFeature, TapTarget } from '../maps/geo';
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
   * The features the L1 and L2 maps draw: every country for a country; for a region or place,
   * its country's regions, or the country alone when it has no regions tier.
   */
  context: IdentifiedFeature[];
  /**
   * Every other same-tier item a wrong option may be drawn from (see `buildExerciseItem`). It may
   * be empty: a region whose country has no other region with places has none, so a session
   * should not ask such an item at L1, the multiple-choice rung.
   */
  candidates: Candidate[];
  /** The country's main part, which the flat maps fit to and L2's camera frames. */
  frame: AreaFeature;
  /**
   * L1's globe: the item shaded (a place dotted) with its tier's context borders: every country's
   * for a country, its country's regions' (or the country's outline alone) for a region or place.
   */
  highlightMode: GlobeMode;
  /** L2's globe: every country's border for a country, else its country's region borders. */
  bordersMode: GlobeMode;
  /** Every country, with the item's country drawn as its regions when it has them: the globes. */
  world: IdentifiedFeature[];
  /**
   * A region or place outside its country's flat map (France's Réunion, Alaska): L1 and L2 show
   * it on the globe instead.
   */
  onGlobe: boolean;
  /**
   * A point-only country (no area of its own) or a place in one: L1 zooms its globe to the
   * neighbourhood, and a place has `onGlobe` set because its country's flat map is a featureless
   * disc.
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
