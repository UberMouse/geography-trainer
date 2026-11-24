import type { IdleCompactIdle } from '../types'

/** The `$.state` keys more than one file declares an atom for. */
interface SharedInitials {
  idle: IdleCompactIdle;
}

/**
 * The initial value of every idle-compact atom that more than one file declares. Each file still
 * holds its own `atom(…)` const (the validator rejects a shared atom module), but the copies of
 * one key must agree on the initial, so they all take it from here.
 */
export const INITIAL: Readonly<SharedInitials> = {
  idle: { running: false, idleSince: null, queued: 0, pendingSubmits: 0 },
}
