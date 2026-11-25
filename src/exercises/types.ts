import type { Grade } from 'ts-fsrs';
import type { Tier } from '../engine/curriculum';
import type { Rung } from '../engine/srs';
import type { AreaFeature, IdentifiedFeature, TapTarget } from '../maps/geo';
import type { GlobeView } from '../maps/view';

/** A same-tier item a multiple-choice question can offer as a wrong option. */
export interface Candidate {
  /** Namespaced item id. */
  id: string;
  name: string;
  lat: number;
  lng: number;
}

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
   * The features the L2 and L3 maps draw: every country for a country; for a region or place,
   * its country's regions, or the country alone when it has no regions tier.
   */
  context: IdentifiedFeature[];
  /**
   * Every other same-tier item a wrong option may be drawn from (see `buildExerciseItem`). It may
   * be empty: a region whose country has no other region with places has none, so a session
   * should not ask such an item at a multiple-choice rung (L1, L2).
   */
  candidates: Candidate[];
  /** What L1 outlines: the target, or a place's region (its country when it has no regions). */
  outline: AreaFeature;
  /** The country's main part, which the flat maps fit to. */
  frame: AreaFeature;
  /** Every country, with the item's country drawn as its regions when it has them: the globes. */
  world: IdentifiedFeature[];
  /**
   * A region or place outside its country's flat map (France's Réunion, Alaska): L2 and L3 show
   * it on the globe instead.
   */
  onGlobe: boolean;
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
  /** Where the L3 and L4 globes start (default `NEUTRAL_VIEW`). */
  initialView?: GlobeView;
}
