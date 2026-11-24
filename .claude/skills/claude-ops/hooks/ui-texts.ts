/**
 * Every toast claude-ops raises, built here so one table (texts.test.ts) can pin that each opens
 * with `claude-ops <feature>: `. The autocompact status line is `statusText` in
 * autocompact-model.ts.
 */

export const AUTOCOMPACT_FAILSAFE_TOAST = 'claude-ops autocompact: compacting in 60s · type to cancel'

export const AUTOCOMPACT_CANCELLED_TOAST = 'claude-ops autocompact: cancelled'
