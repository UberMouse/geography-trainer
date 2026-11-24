/**
 * Every toast idle-compact raises, built here so one table (texts.test.ts) can pin that each opens
 * with `idle-compact: `. The autocompact status line is `statusText` in
 * autocompact-model.ts.
 */

export const AUTOCOMPACT_FAILSAFE_TOAST = 'idle-compact: compacting in 60s · type to cancel'

export const AUTOCOMPACT_CANCELLED_TOAST = 'idle-compact: cancelled'
