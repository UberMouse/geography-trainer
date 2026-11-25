// Tunable learning config. Pure constants: the engine and the data script both read them.

/** A country gets a regions tier when at least this many of its regions contain a place... */
export const REGIONS_TIER_MIN_REGIONS = 4;
/** ...and it has at least this many places. */
export const REGIONS_TIER_MIN_PLACES = 15;

// Multiple-choice grading (L1, L2), in milliseconds.
/** A correct answer faster than this is Easy. */
export const MC_FAST_MS = 4_000;
/** A correct answer slower than this is Hard. */
export const MC_SLOW_MS = 12_000;

// maptap's scoring: round(100 * exp(-3.5 * km / MAPTAP_SCORE_KM)), 0 at MAPTAP_SCORE_KM and beyond.
export const MAPTAP_SCORE_KM = 16_250;
export const MAPTAP_SCORE_DECAY = 3.5;

// Tap grading.
/** Inside a country/region: Easy when within this fraction of the feature size of the answer. */
export const TAP_EASY_FRACTION = 0.25;
/** Outside a country: Hard when within this many km of its border, else Again. */
export const COUNTRY_NEAR_MISS_KM = 150;
/** Outside a region: Hard when within this many km of its border, else Again. */
export const REGION_NEAR_MISS_KM = 50;
/** Place taps: below this distance is Easy... */
export const PLACE_EASY_KM = 25;
/** ...below this Good... */
export const PLACE_GOOD_KM = 75;
/** ...below this Hard, otherwise Again. */
export const PLACE_HARD_KM = 200;

// Spaced repetition and the exercise ladder.
/** An item is mastered once it has passed L4 on this many different local days. */
export const MASTERY_DISTINCT_DAYS = 2;
/** Stability, in days, of the L4 card a placement test seeds for an item the learner passed. */
export const PLACEMENT_SEED_STABILITY_DAYS = 2;

// Sessions.
/** New items introduced per local day. */
export const DAILY_NEW_CAP = 15;
/** A session never asks more than this many questions at the same rung in a row when the mix allows. */
export const SESSION_MAX_RUN = 2;

// Placement staircase.
export const PLACEMENT_MIN_LEVEL = 1;
export const PLACEMENT_MAX_LEVEL = 8;
export const PLACEMENT_START_LEVEL = 4;
export const PLACEMENT_MAX_QUESTIONS = 20;
/** The test stops once the staircase has turned this many times. */
export const PLACEMENT_REVERSALS = 6;
/** The estimate is the mean level of this many most recent reversals. */
export const PLACEMENT_ESTIMATE_REVERSALS = 4;
