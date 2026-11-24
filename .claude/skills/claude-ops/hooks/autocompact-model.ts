import type { ClaudeOpsAutocompact, ClaudeOpsAutocompactCheck, ClaudeOpsAutocompactMode, ClaudeOpsIdle } from '../types'
import type { InFlightEntry } from './inflight-model'
import { RUN_STATE_FILES, cleanWhat, handKeptInFlight } from './inflight-model'
import { asNonEmptyString, asRecord, asString, cleanLine, formatAge, isIdle, msSince } from './util'

/**
 * Autocompact's pure half: no `$`, no atoms, so autocompact.tsx and its tests share one copy of
 * each rule. Main-loop rules only: subagent compaction is out of scope.
 */

/**
 * Rule 1 fires above this context percent (of the model's full window: about 250k tokens on a 1M
 * model). Every call re-reads the whole window, so a conductor idling at 400k paid for it on each
 * turn; 25% sits just under where the subagents it dispatches compact.
 */
export const CONDUCTOR_PERCENT = 25
/** Rule 2, the failsafe, arms at or above this. */
export const FAILSAFE_PERCENT = 75
/** At most one attempt (compaction, veto or failure) in this window. */
export const DEBOUNCE_MS = 20 * 60_000
/** After an attempt, a re-trigger also needs the percent this far above the first reading after it. */
export const REGROWTH_POINTS = 10
/** How long the failsafe's toast gives the person to type before it compacts. */
export const FAILSAFE_WINDOW_MS = 60_000
/** `compact` holds the hook that calls it for the whole compaction, so turn.complete defers its check. */
export const DEFER_MS = 1_000
export const TICK_MS = 60_000
/**
 * How long a prompt submitted into a turn keeps checks off after that turn ends, when no turn has
 * started since. One typed over the turn starts its own once the turn ends; one delivered into
 * it never does, and nothing at submit time tells the two apart.
 */
export const QUEUED_HOLD_MS = 5 * 60_000
/**
 * Rule 3, opt-in per session (`/claude-autocompact stale on`): a main loop idle this long is
 * compacted at STALE_PERCENT or more. A session left open overnight comes back to a cold prompt
 * cache, so its first prompt re-reads the whole window; compacting while nobody waits makes that
 * read small. Off by default: it also compacts sessions that are never resumed, and a session
 * resumed into a new process (`claude --resume`) starts with no idle time to measure.
 */
export const STALE_IDLE_MS = 6 * 60 * 60_000
export const STALE_PERCENT = 20
/**
 * The opening line every claude-ops compaction asks its summary to start with. A compaction a
 * plugin starts is recorded with `trigger: "manual"`, the same as a typed `/compact`, so the
 * summary is the only place the transcript can say claude-ops made it.
 */
export const COMPACTION_MARK = 'Compacted by claude-ops autocompact'

/**
 * Standing instructions are kept verbatim in meaning, so the per-entry cap is generous: it only
 * bounds a runaway entry. The count cap bounds the instructions as a whole.
 */
const STANDING_MAX_CHARS = 2_000
const STANDING_MAX_ENTRIES = 20

/** The userConfig value as a mode; anything unexpected reads as the default, `on`. */
export function parseMode(value: unknown): ClaudeOpsAutocompactMode {
  return value === 'conductor-only' || value === 'off' ? value : 'on'
}

/**
 * Whether state.json is a durable-state run that is still going: an object whose phase is not
 * `done`. The skill driving it does not matter: any run that keeps its state on disk survives a
 * compaction, which is all rule 1 needs.
 */
export function isLiveRun(stateJson: unknown): boolean {
  const state = asRecord(stateJson)
  return state !== null && state.phase !== 'done'
}

/**
 * What rule 1 counts as in flight for this session's run, or null when rule 1 does not apply to
 * it: no live run, or state.json's `sessionId` names another session (state.json is per
 * worktree, and other sessions may share the worktree). A run that names this session counts its
 * hand-kept `inFlight`. A run that names no session counts nothing, since its hand-kept entries
 * may be another session's; `state` writes `sessionId` on the first write, so only a hand-written
 * file lacks it.
 */
export function conductorInFlight(stateJson: unknown, sessionId: string): InFlightEntry[] | null {
  if (!isLiveRun(stateJson)) {
    return null
  }
  const owner = asNonEmptyString(asRecord(stateJson)?.sessionId)
  if (owner === null) {
    return []
  }
  return owner === sessionId ? handKeptInFlight(stateJson) : null
}

/** state.json's `standingInstructions`, the strings only. */
export function standingInstructions(stateJson: unknown): string[] {
  const list = asRecord(stateJson)?.standingInstructions
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
}

/**
 * Whether a prompt submitted into a turn still keeps checks off at `now`: while that turn runs,
 * and for QUEUED_HOLD_MS after it ends unless a turn starts first (turn.start clears the hold).
 * An end time that does not parse keeps the hold.
 */
export function isQueuedHold(ac: ClaudeOpsAutocompact, now: number): boolean {
  if (ac.queuedTurnId === null) {
    return false
  }
  if (ac.queuedTurnEndedAt === null) {
    return true
  }
  const sinceEnd = msSince(ac.queuedTurnEndedAt, now)
  return sinceEnd === null || sinceEnd < QUEUED_HOLD_MS
}

/**
 * `ac` with `percent` taken as a reading: the first defined one after a compaction becomes the
 * baseline the regrowth rule measures from.
 */
export function withReading(ac: ClaudeOpsAutocompact, percent: number | undefined): ClaudeOpsAutocompact {
  if (percent === undefined || !ac.isAwaitingBaseline) {
    return ac
  }
  return { ...ac, baseline: percent, isAwaitingBaseline: false }
}

/**
 * Why no attempt may run at `percent`, or null when one may: none in the last DEBOUNCE_MS, a
 * reading since the last compaction, and the percent REGROWTH_POINTS above that first reading. A
 * last attempt whose time does not parse does not debounce.
 */
export function retriggerBlock(ac: ClaudeOpsAutocompact, percent: number, now: number): string | null {
  const sinceAttempt = msSince(ac.lastAttemptAt, now)
  if (sinceAttempt !== null && sinceAttempt < DEBOUNCE_MS) {
    return `debounced: the last attempt was ${formatAge(sinceAttempt)} ago, quiet for ${formatAge(DEBOUNCE_MS - sinceAttempt)} more`
  }
  if (ac.isAwaitingBaseline) {
    return 'awaiting the first context reading since the last compaction'
  }
  if (ac.baseline !== null && percent < ac.baseline + REGROWTH_POINTS) {
    return `regrowth: at ${percent}%, needs ${ac.baseline + REGROWTH_POINTS}% (the first reading since the last attempt was ${ac.baseline}%)`
  }
  return null
}

/** Whether another attempt may run at `percent` (`retriggerBlock` finds nothing in the way). */
export function canRetrigger(ac: ClaudeOpsAutocompact, percent: number, now: number): boolean {
  return retriggerBlock(ac, percent, now) === null
}

/** Why the main loop is not idle, for a decision's reason. */
function notIdleReason(idle: ClaudeOpsIdle): string {
  if (idle.running) {
    return 'a main-loop turn is running'
  }
  if (idle.pendingSubmits > 0) {
    return `${idle.pendingSubmits} submitted prompt(s) have not started their turn yet`
  }
  return 'no main-loop turn has ended yet this session'
}

/** Why `isQueuedHold` holds, for a decision's reason. */
function queuedHoldReason(ac: ClaudeOpsAutocompact, now: number): string {
  const turn = `a prompt was submitted into turn ${ac.queuedTurnId ?? '?'}`
  if (ac.queuedTurnEndedAt === null) {
    return `held: ${turn}, still running`
  }
  const sinceEnd = msSince(ac.queuedTurnEndedAt, now)
  return sinceEnd === null
    ? `held: ${turn}, whose end time does not parse`
    : `held: ${turn}; the hold lapses in ${formatAge(QUEUED_HOLD_MS - sinceEnd)} unless a turn starts`
}

/** Rule 1's view of this session's run: its in-flight work, and one line saying what was read. */
export interface ConductorStatus {
  /** `conductorInFlight`'s answer: null when rule 1 does not apply to this session's run. */
  inFlight: InFlightEntry[] | null;
  note: string;
}

/**
 * `conductorInFlight` with the reason beside it. `run` is the state.json found (its path and
 * parsed JSON), or null when there is none or it does not parse.
 */
export function conductorStatus(run: { path: string; json: unknown } | null, sessionId: string): ConductorStatus {
  if (run === null) {
    return { inFlight: null, note: `no readable state.json (${RUN_STATE_FILES.join(' or ')})` }
  }
  const state = asRecord(run.json)
  const skill = asString(state?.skill) ?? 'no skill'
  const phase = asString(state?.phase) ?? 'no phase'
  const described = `${run.path} (${skill}, phase ${phase})`
  if (!isLiveRun(run.json)) {
    return { inFlight: null, note: state === null ? `${run.path} is not a JSON object` : `${described} is finished` }
  }
  const owner = asNonEmptyString(state?.sessionId)
  if (owner !== null && owner !== sessionId) {
    return { inFlight: null, note: `${described} belongs to session ${owner}` }
  }
  const whose = owner === null ? 'names no session, so none of its inFlight counts' : 'is this session\'s'
  return { inFlight: conductorInFlight(run.json, sessionId), note: `${described} ${whose}` }
}

export interface AutocompactInputs {
  mode: ClaudeOpsAutocompactMode;
  ac: ClaudeOpsAutocompact;
  idle: ClaudeOpsIdle;
  /** `context.percent`; undefined right after a compaction (and in a fresh session) until the next response. */
  percent: number | undefined;
  /** Rule 1's view of the run; null when it was not read (at or under 25%, state.json is not). */
  conductor: ConductorStatus | null;
  now: number;
}

export type AutocompactVerdict = 'none' | 'conductor' | 'failsafe' | 'stale'

/** The rules as claude-ops numbers them in its texts. */
export type AutocompactRule = Exclude<AutocompactVerdict, 'none'>

const RULE_NUMBER: Readonly<Record<AutocompactRule, number>> = { conductor: 1, failsafe: 2, stale: 3 }

export interface AutocompactDecision {
  rule: AutocompactVerdict;
  /** One line: what made the rule apply, or the first thing in the way of each. */
  reason: string;
}

/** Why rule 1 does not apply at `percent`, or null when it does. */
function conductorBlock(conductor: ConductorStatus | null, percent: number): string | null {
  if (percent <= CONDUCTOR_PERCENT) {
    return `at ${percent}%, not over ${CONDUCTOR_PERCENT}%`
  }
  if (conductor === null) {
    return 'state.json was not read'
  }
  if (conductor.inFlight === null) {
    return conductor.note
  }
  if (conductor.inFlight.length === 0) {
    return `${conductor.note}, but nothing is in flight (no hand-kept inFlight entry)`
  }
  return null
}

/** Why rule 3 does not apply, or null when it does: switched on, idle STALE_IDLE_MS, at STALE_PERCENT. */
function staleBlock(ac: ClaudeOpsAutocompact, idle: ClaudeOpsIdle, percent: number, now: number): string | null {
  if (ac.isStaleOn !== true) {
    return 'off (opt in with /claude-autocompact stale on)'
  }
  const idleMs = msSince(idle.idleSince, now)
  if (idleMs === null || idleMs < STALE_IDLE_MS) {
    return `idle ${idleMs === null ? 'for an unreadable time' : formatAge(idleMs)}, needs ${formatAge(STALE_IDLE_MS)}`
  }
  if (percent < STALE_PERCENT) {
    return `idle ${formatAge(idleMs)} but at ${percent}%, under ${STALE_PERCENT}%`
  }
  return null
}

/**
 * Which rule applies now, and why. Rule 1: this session's durable-state run with work in flight,
 * above 25%. Rule 3 (switched on per session): idle 6 h at 20% or more. Rule 2 (mode `on` only):
 * any other idle main session at 75% or more. None of them while a turn runs or may be about to
 * (`isQueuedHold`), nor with no percent known, nor inside the debounce.
 */
export function decide(inputs: AutocompactInputs): AutocompactDecision {
  const { mode, ac, idle, percent, now } = inputs
  const none = (reason: string): AutocompactDecision => ({ rule: 'none', reason })
  if (mode === 'off') {
    return none('the global setting is off')
  }
  if (!ac.isSessionOn) {
    return none('off for this session (/claude-autocompact on)')
  }
  if (!isIdle(idle)) {
    return none(notIdleReason(idle))
  }
  if (isQueuedHold(ac, now)) {
    return none(queuedHoldReason(ac, now))
  }
  if (percent === undefined) {
    return none('no context reading (a fresh window, or just compacted)')
  }
  const blocked = retriggerBlock(ac, percent, now)
  if (blocked !== null) {
    return none(blocked)
  }
  const conductorBlocked = conductorBlock(inputs.conductor, percent)
  if (conductorBlocked === null) {
    const count = inputs.conductor?.inFlight?.length ?? 0
    return { rule: 'conductor', reason: `rule 1: ${inputs.conductor?.note ?? ''}, ${count} in flight, at ${percent}%` }
  }
  // Before rule 2: whoever switched it on is away, so a toast's 60 s window would only delay it.
  const staleBlocked = staleBlock(ac, idle, percent, now)
  if (staleBlocked === null) {
    return { rule: 'stale', reason: `rule 3: idle ${formatAge(msSince(idle.idleSince, now) ?? 0)} at ${percent}%, at or over ${STALE_PERCENT}%` }
  }
  if (mode === 'on' && percent >= FAILSAFE_PERCENT) {
    return { rule: 'failsafe', reason: `rule 2: idle at ${percent}%, at or over ${FAILSAFE_PERCENT}%` }
  }
  const failsafe = mode === 'on' ? `at ${percent}%, under ${FAILSAFE_PERCENT}%` : `off (global setting ${mode})`
  const stale = ac.isStaleOn === true ? `; rule 3: ${staleBlocked}` : ''
  return none(`rule 1: ${conductorBlocked}; rule 2: ${failsafe}${stale}`)
}

/** Which rule applies now: `decide` without its reason. */
export function verdict(inputs: AutocompactInputs): AutocompactVerdict {
  return decide(inputs).rule
}

export interface ConductorBrief {
  percent: number;
  statePath: string;
  /** state.json's hand-kept `inFlight` entries. */
  handKept: readonly InFlightEntry[];
  standing: readonly string[];
}

function itemLine(item: InFlightEntry): string {
  const what = cleanWhat(item.what)
  return `  - ${cleanWhat(item.kind)} ${cleanWhat(item.id)}${what === '' ? '' : `: ${what}`}`
}

/**
 * The instructions' first line: the summary opens with the COMPACTION_MARK line, which is how the
 * transcript tells a claude-ops compaction from a typed `/compact`.
 */
export function provenanceLine(rule: AutocompactRule, percent: number): string {
  return `Begin the summary with this line, verbatim: "${COMPACTION_MARK} (rule ${RULE_NUMBER[rule]}, ${percent}%)."`
}

/** Rule 1's compaction instructions: what a conductor must still know when it wakes. */
export function conductorInstructions(brief: ConductorBrief): string {
  const handKept = brief.handKept.map(itemLine)
  // One line per entry, so a newline inside one cannot pass for a line of these instructions.
  const standing = brief.standing.slice(0, STANDING_MAX_ENTRIES).map(line => `  > ${cleanLine(line, STANDING_MAX_CHARS)}`)
  const unlisted = brief.standing.length - STANDING_MAX_ENTRIES
  if (unlisted > 0) {
    standing.push(`  > (${unlisted} more in ${cleanWhat(brief.statePath)})`)
  }
  return [
    provenanceLine('conductor', brief.percent),
    `claude-ops autocompact: this conductor was idle at ${brief.percent}% context, waiting on background work.`,
    'Keep in the summary, verbatim, the background work in flight (ids and what lines); its notifications will wake you:',
    ...(handKept.length === 0 ? [] : ['state.json inFlight:', ...handKept]),
    `After the compaction, before any other action, re-read ${brief.statePath}.`,
    ...(standing.length === 0
      ? ['Keep any standingInstructions from state.json verbatim.']
      : ['Keep these standingInstructions from state.json verbatim:', ...standing]),
    'Keep the current task (id, status, the agent working on it) and any open gate.',
    'Drop tool payloads: file contents, command output and diffs; keep only their conclusions.',
  ].join('\n')
}

/** Rule 2's compaction instructions: keep the thread, whatever the session was doing. */
export function failsafeInstructions(percent: number): string {
  return [
    provenanceLine('failsafe', percent),
    `claude-ops failsafe autocompact: this session was idle at ${percent}% context.`,
    "Keep the thread: the user's current request and goal, decisions made and why, open questions, and the next step.",
    'Keep every instruction the user gave verbatim.',
    'Drop tool payloads: file contents, command output and diffs; keep only their conclusions.',
  ].join('\n')
}

/** Rule 3's compaction instructions: the person left this session idle for hours and will return to it. */
export function staleInstructions(percent: number, idleMs: number): string {
  return [
    provenanceLine('stale', percent),
    `claude-ops idle-hours autocompact: this session was idle ${formatAge(idleMs)} at ${percent}% context.`,
    "Keep the thread: the user's current request and goal, decisions made and why, open questions, and the next step.",
    'Keep every instruction the user gave verbatim, and any background work still in flight (ids and what it is).',
    'Drop tool payloads: file contents, command output and diffs; keep only their conclusions.',
  ].join('\n')
}

const STATUS_WHY: Readonly<Record<AutocompactRule, string>> = {
  conductor: 'conductor idle',
  failsafe: 'failsafe idle',
  stale: 'idle for hours',
}

/** The status line's wording without its `claude-ops autocompact: ` prefix, which is what the trail logs under its own. */
export function statusBody(rule: AutocompactRule, percent: number, skip: string | null): string {
  const why = STATUS_WHY[rule]
  return skip === null ? `compacted at ${percent}% (${why})` : `vetoed at ${percent}% (${why}) · ${cleanWhat(skip)}`
}

/** The status line after an attempt, e.g. `claude-ops autocompact: compacted at 43% (conductor idle)`. */
export function statusText(rule: AutocompactRule, percent: number, skip: string | null): string {
  return `claude-ops autocompact: ${statusBody(rule, percent, skip)}`
}

/** What bare `/claude-autocompact` reports beyond the switches: everything a decision reads. */
export interface AutocompactDiagnostic {
  ac: ClaudeOpsAutocompact;
  /** `currentPercent` as a check would read it. */
  percent: number | undefined;
  /** Whether this load's 60 s tick is running; a load whose session.start never ran has none. */
  isTicking: boolean;
  conductor: ConductorStatus;
  /** `decide` evaluated as the command ran, with state.json read whatever the percent. */
  now: AutocompactDecision;
  nowMs: number;
}

const MAX_LISTED = 5

function ago(iso: string | null, now: number): string {
  const since = msSince(iso, now)
  return since === null ? 'at an unreadable time' : `${formatAge(since)} ago`
}

function checkLine(check: ClaudeOpsAutocompactCheck | null, now: number): string {
  if (check === null) {
    return 'last check: none since this session loaded the state'
  }
  const at = check.percent === null ? '' : ` at ${check.percent}%`
  return `last check: ${ago(check.at, now)}${at}: ${check.rule}: ${check.reason}`
}

function attemptLine(ac: ClaudeOpsAutocompact, now: number): string {
  if (ac.lastAttemptAt === null) {
    return 'last attempt: none this session'
  }
  const baseline = ac.isAwaitingBaseline
    ? 'awaiting its first reading'
    : ac.baseline === null
      ? 'no baseline'
      : `first reading since ${ac.baseline}%, re-trigger at ${ac.baseline + REGROWTH_POINTS}%`
  return `last attempt: ${ago(ac.lastAttemptAt, now)} (${baseline})`
}

function inFlightLine(conductor: ConductorStatus): string {
  const list = conductor.inFlight ?? []
  const shown = list.slice(0, MAX_LISTED).map(entry => `${cleanWhat(entry.kind)} ${cleanWhat(entry.id)}`)
  const more = list.length > MAX_LISTED ? `, ${list.length - MAX_LISTED} more` : ''
  return `in flight: ${list.length === 0 ? 'nothing' : `${shown.join(', ')}${more}`}`
}

/** The diagnostic's lines, one fact each. */
export function diagnosticLines(d: AutocompactDiagnostic): string[] {
  const { ac, nowMs } = d
  const source = ac.isMeasured ? 'the last session.measure' : 'session usage, no measure seen yet'
  const hold = ac.queuedTurnId === null ? 'none' : isQueuedHold(ac, nowMs) ? queuedHoldReason(ac, nowMs) : 'lapsed'
  const failsafe = ac.failsafe === null ? 'closed' : `open (window ${ac.failsafe.id})`
  const cancelled = ac.cancelledFor === null ? '' : `; last cancelled for the idle episode from ${ac.cancelledFor}`
  // State saved before `lastCheck` existed survives a reload without it, until the next check writes it.
  const lastCheck = ac.lastCheck ?? null
  return [
    `now: ${d.now.rule === 'none' ? 'would not compact' : `would act (${d.now.rule})`}: ${d.now.reason}`,
    checkLine(lastCheck, nowMs),
    `checks: ${d.isTicking ? `every ${TICK_MS / 1000}s, and ${DEFER_MS / 1000}s after each main-loop turn` : 'NOT RUNNING: no tick in this load (expected only with the global setting off)'}`,
    `context: ${d.percent === undefined ? 'no reading' : `${d.percent}%`} (from ${source})`,
    attemptLine(ac, nowMs),
    `queued-prompt hold: ${hold}`,
    `failsafe window: ${failsafe}${cancelled}`,
    `run: ${d.conductor.note}`,
    inFlightLine(d.conductor),
    `idle-hours rule (3): ${ac.isStaleOn === true ? `on: compacts after ${formatAge(STALE_IDLE_MS)} idle at ${STALE_PERCENT}% or more` : 'off (/claude-autocompact stale on)'}`,
  ]
}
