import type { HookFailure, ToolCallResult } from 'claude-code'

import type { IdleCompactIdle } from '../types'

/**
 * Pure helpers every idle-compact feature shares: no `$` and no atoms, so any file may import them.
 */

/** An error's message, or the thrown value as text when it is no Error. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The line a idle-compact failure logs: a hook's `.catch` (its `next.error`) or a promise it set going.
 * Pure text: the validator never follows `$` across an import, so each file calls `$.ui.log` itself.
 *
 * Failures log to the debug sink, because a failing render hook fails on every frame and would
 * flood the transcript; the engine already puts one dim line per load there naming the plugin
 * and event.
 */
export function failureText(where: string, error: unknown): string {
  if (isHookFailure(error)) {
    const detail = error.message === undefined ? '' : `: ${error.message}`
    return `idle-compact: ${where} failed (${error.kind}${detail})`
  }
  return `idle-compact: ${where} failed (${error instanceof Error ? error.message : String(error)})`
}

function isHookFailure(error: unknown): error is HookFailure {
  return typeof error === 'object' && error !== null && 'kind' in error && 'budget' in error
}

/** `value` as a plain object, or null when it is anything else (an array included). */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** `value` when it is a string, the empty string included; else null. */
export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** `value` when it is a string with at least one character; else null. */
export function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** A tool call's result record, or null when the call was denied, errored, or answered with no object. */
export function answeredRecord(result: ToolCallResult): Record<string, unknown> | null {
  return result.deny === undefined && result.isError !== true ? asRecord(result.result) : null
}

/** How long before `now` the ISO-8601 time `iso` was; null when there is none or it does not parse. */
export function msSince(iso: string | null, now: number): number | null {
  const at = iso === null ? Number.NaN : Date.parse(iso)
  return Number.isNaN(at) ? null : now - at
}

/** `45s`, `6m`, `2h05m`: the band's and the panes' ages. */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m`
  }
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

/** Text safe for a `Text` or `Code`: no escape sequences, no control characters but tab and newline. */
export function printable(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
}

/**
 * `text` as one line of at most `max` chars: control characters (C0, DEL and C1) and the Unicode
 * line and paragraph separators collapse to a space, the rest is cut with `…`. The same class as
 * `.claude/hooks/durable-state-resume.sh`'s `clean`, which reads what this writes.
 */
export function cleanLine(text: string, max: number): string {
  const line = text.replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** Whether a prompt may be submitted now: no main-loop turn running, and none about to start. */
export function isTurnFree(idle: IdleCompactIdle): boolean {
  return !idle.running && idle.pendingSubmits === 0
}

/** Whether the main loop is idle with nothing about to start, a turn having ended at `idleSince`. */
export function isIdle(idle: IdleCompactIdle): idle is IdleCompactIdle & { idleSince: string } {
  return isTurnFree(idle) && idle.idleSince !== null
}
