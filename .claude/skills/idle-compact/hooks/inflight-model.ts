import { asRecord, asString, cleanLine } from './util'

/**
 * What a durable-state run has in flight, read from its state.json alone. The mod this was cut
 * from also kept a registry of the session's background tasks and, while it was healthy, counted
 * only hand-kept `gate` entries; idle-compact keeps no registry, so every hand-kept entry counts,
 * whatever its kind. That keeps rule 1 firing while an sdd-loop conductor waits on the subagents
 * it recorded with `state inflight add agent …`.
 */

/** A run's state file, by root. Whether a run is durable is its owner skill's call: idle-compact only checks it exists. */
export const RUN_STATE_FILES: readonly string[] = ['.durable-state/state.json']

const WHAT_MAX = 200

/** `text` as one bounded line, cut at 200 chars. */
export function cleanWhat(text: string): string {
  return cleanLine(text, WHAT_MAX)
}

/** One hand-kept `inFlight` entry of state.json. */
export interface InFlightEntry {
  kind: string;
  id: string;
  what: string;
}

/**
 * state.json's hand-kept `inFlight` entries, read defensively: a missing or non-array `inFlight`
 * and any non-object entry contribute nothing.
 */
export function handKeptInFlight(stateJson: unknown): InFlightEntry[] {
  const handKept = asRecord(stateJson)?.inFlight
  return (Array.isArray(handKept) ? handKept : []).flatMap(entry => {
    const record = asRecord(entry)
    return record === null
      ? []
      : [{ kind: asString(record.kind) ?? '', id: asString(record.id) ?? '', what: asString(record.what) ?? '' }]
  })
}
