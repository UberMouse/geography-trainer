// Tunable learning config. Pure constants: the engine and the data script both read them.

/** A country gets a regions tier when at least this many of its regions contain a place... */
export const REGIONS_TIER_MIN_REGIONS = 4;
/** ...and it has at least this many places. */
export const REGIONS_TIER_MIN_PLACES = 15;

// Multiple-choice grading (L1, the only multiple-choice rung), in milliseconds.
/** A correct answer faster than this is Easy. */
export const MC_FAST_MS = 4_000;
/** A correct answer slower than this is Hard. */
export const MC_SLOW_MS = 12_000;

// maptap's scoring: round(100 * exp(-3.5 * km / MAPTAP_SCORE_KM)), 0 at MAPTAP_SCORE_KM and beyond.
export const MAPTAP_SCORE_KM = 16_250;
export const MAPTAP_SCORE_DECAY = 3.5;

// Tap grading (L2 and L3).
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
/** An item is mastered once it has passed L3 on this many different local days. */
export const MASTERY_DISTINCT_DAYS = 2;
/** Stability, in days, of the L3 card a placement test seeds for an item the learner passed. */
export const PLACEMENT_SEED_STABILITY_DAYS = 2;

// Sessions.
/** New items introduced per local day. */
export const DAILY_NEW_CAP = 15;
/** A session never asks more than this many questions at the same rung in a row when the mix allows. */
export const SESSION_MAX_RUN = 2;
/** Questions answered per round of a session before its summary. */
export const SESSION_ROUND_SIZE = 20;
/** An item that climbed or lapsed comes back after this many other questions. */
export const SESSION_REQUEUE_GAP = 3;
/** An item is answered at most this many times in one session. */
export const SESSION_MAX_ASKS_PER_ITEM = 6;

// Difficulty. A country's difficulty is its band (1-DIFFICULTY_LEVELS) when every country is ranked
// by `-ln(place count) + DIFFICULTY_MEAN_LEVEL_WEIGHT * mean place level`: maptap asks more about
// the countries people know, and their places are easier. A region is banded the same way among its
// country's regions.
export const DIFFICULTY_LEVELS = 8;
export const DIFFICULTY_MEAN_LEVEL_WEIGHT = 0.4;

// Placement: an ability estimate over a grid, updated after every answer.
export const PLACEMENT_MIN_LEVEL = 1;
export const PLACEMENT_MAX_LEVEL = DIFFICULTY_LEVELS;
/** The estimate when nothing was shown: below PLACEMENT_MIN_LEVEL. */
export const PLACEMENT_NO_ESTIMATE = 0;
/** The prior's centre: where the first question aims. */
export const PLACEMENT_START_LEVEL = 4;
/** The prior's spread, in levels. */
export const PLACEMENT_PRIOR_SD = 2.5;
/** How sharply knowing an item falls off with its level above the learner's ability (logistic slope). */
export const PLACEMENT_SLOPE = 1.5;
export const PLACEMENT_MIN_QUESTIONS = 12;
export const PLACEMENT_MAX_QUESTIONS = 20;
/** The test stops (after PLACEMENT_MIN_QUESTIONS) once the ability's spread is below this, in levels. */
export const PLACEMENT_STOP_SD = 0.45;
/** A miss this close still shows the learner roughly knows where it is: half credit. Countries
 * and regions measure outside the border, places from the point. */
export const PLACEMENT_CLOSE_KM = { country: 600, region: 150, place: 200 } as const;
/** An untested item the learner knows with at least this probability is sent to L3 review to confirm. */
export const PLACEMENT_LIKELY_KNOWN = 0.85;
/** ...and with at least this probability (below the one above) it starts at L2. */
export const PLACEMENT_PROBABLY_KNOWN = 0.5;
/** Confirmation reviews start this many days after the test... */
export const PLACEMENT_CONFIRM_START_DAYS = 2;
/** ...and at most this many fall due per day, least certain first. */
export const PLACEMENT_CONFIRM_PER_DAY = 6;
