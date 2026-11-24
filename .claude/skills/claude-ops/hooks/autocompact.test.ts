import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, PromptChangeInput, PromptEditInput } from 'claude-code'

import { COMPACTION_MARK, STALE_IDLE_MS, conductorInFlight, decide } from './autocompact-model'
import type { AutocompactInputs } from './autocompact-model'
import {
  MINUTE,
  NOON,
  ROOT,
  SID,
  STATE_JSON,
  captureRuns,
  mockFs,
  mockProcessRun,
  mockSession,
  mockState,
  mockUi,
  passTurns,
  recordPrompts,
  startSession,
  trailRows,
} from './testkit'

const AGENT_ID = 'a04a88098a5bcd93a'
const HAND_KEPT_ID = 'gate-b'
const STANDING = 'ignore the subagent compaction stuff, not doing it'
const FAILSAFE_TOAST = 'claude-ops autocompact: compacting in 60s · type to cancel'

const OTHER_SID = '7f3c2a10-5b4e-4d8a-9c61-0e2f4b7a8d93'

const GATE = { kind: 'gate', id: HAND_KEPT_ID, what: 'plan review doc open' }
const IMPLEMENTER = { kind: 'agent', id: AGENT_ID, what: 'task-14 implementer' }

// An sdd-loop conductor waiting on a gate and on the implementer it recorded with
// `state inflight add agent …`.
const CONDUCTOR = {
  skill: 'sdd-loop',
  phase: 'implement',
  sessionId: SID,
  standingInstructions: [STANDING],
  inFlight: [GATE, IMPLEMENTER],
}
// Hand-written without the owning session.
const { sessionId: _owner, ...UNOWNED } = CONDUCTOR

interface World {
  clock: MockClock;
  state: Map<string, unknown>;
  files: Map<string, string>;
  compactions: string[];
  toasts: string[];
  statuses: (string | undefined)[];
  /** `$.ui.log` lines, the debug sink's included. */
  logs: string[];
  /** What the engine's `$.session.usage()` reads: undefined for a window with no response yet. */
  usagePercent: number | undefined;
  /** A veto beneath claude-ops (a hook's, or a classic PreCompact block). */
  skip: string | undefined;
}

interface Setup {
  state?: unknown;
  usagePercent?: number;
  /** A `claude-ops.autocompact` value already in `$.state`, as a reload finds it. */
  autocompact?: Record<string, unknown>;
  /** The main loop idle since this time (ms), as a session left open for hours finds it. */
  idleSince?: number;
}

function world(on: On, setup: Setup = {}): World {
  const state = mockState(on, {
    ...(setup.autocompact === undefined ? {} : { 'claude-ops.autocompact': setup.autocompact }),
    ...(setup.idleSince === undefined
      ? {}
      : { 'claude-ops.idle': { running: false, idleSince: new Date(setup.idleSince).toISOString(), queued: 0, pendingSubmits: 0 } }),
  })
  const clock = mock.clock(on, { now: NOON })
  mockSession(on, { root: ROOT })
  const { files } = mockFs(on, setup.state === undefined ? {} : { [STATE_JSON]: JSON.stringify(setup.state) })
  mockProcessRun(on)
  const ui = mockUi(on)
  const w: World = {
    clock,
    state,
    files,
    compactions: [],
    toasts: ui.toasts,
    statuses: ui.statuses,
    logs: ui.logs,
    usagePercent: setup.usagePercent,
    skip: undefined,
  }
  on('session.usage', () => ({ value: { startedAt: NOON, context: { window: 1_000_000, percent: w.usagePercent }, rateLimits: [] } }))
  on('session.compact', (_$, e) => {
    w.compactions.push(e.instructions ?? '')
    // A compaction leaves at least one message: its summary.
    return w.skip === undefined ? { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] } : { skip: w.skip }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  recordPrompts(on)
  on('prompt.edit', (_$, e) => ({ text: e.text, cursor: e.cursor }))
  on('prompt.change', (_$, e) => ({ text: e.text }))
  passTurns(on)
  return w
}

async function measure($: Engine, w: World, percent: number | undefined): Promise<void> {
  await $.session.measure({ context: { window: 1_000_000, percent }, rateLimits: [], changed: ['context'] })
  await w.clock.settle()
}

/** A main-loop turn that ends with the context at `percent`, then the 1 s deferred check. */
async function turn($: Engine, w: World, turnId: string, percent: number | undefined): Promise<void> {
  await $.turn.start({ text: 'go', turnId })
  await measure($, w, percent)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
  await w.clock.advance(1_000)
}

/**
 * The person typing into the prompt box. The kit's `Engine` type lists no `prompt.edit` call (it
 * is not an `EventCalls` member), so it is reached through the runtime noun.
 */
async function edit($: Engine, e: PromptEditInput): Promise<unknown> {
  const prompt = $.prompt as unknown as { edit: (input: PromptEditInput) => Promise<unknown> }
  return prompt.edit(e)
}

/** A change to the prompt box no keystroke carried; reached as `edit` is, for the same reason. */
async function change($: Engine, e: PromptChangeInput): Promise<unknown> {
  const prompt = $.prompt as unknown as { change: (input: PromptChangeInput) => Promise<unknown> }
  return prompt.change(e)
}

async function autocompactCommand($: Engine, w: World, args: string): Promise<string | undefined> {
  const result = await $.command.run({ command: 'claude-autocompact', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  await w.clock.settle()
  return result.text
}

test('an idle conductor over 25% compacts 1 s after its turn, listing its inFlight ids verbatim', async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await measure($, w, 45)
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.advance(999)
  expect(w.compactions).toEqual([])

  await w.clock.advance(1)
  expect(w.compactions.length).toBe(1)
  const instructions = w.compactions[0] ?? ''
  expect(instructions).toContain(`agent ${AGENT_ID}: task-14 implementer`)
  expect(instructions).toContain(`gate ${HAND_KEPT_ID}: plan review doc open`)
  expect(instructions).toContain(`> ${STANDING}`)
  expect(instructions).toContain(`re-read ${STATE_JSON}.`)
  expect(instructions).not.toContain('registry')
  expect(w.statuses).toEqual(['claude-ops autocompact: compacted at 45% (conductor idle)'])
})

test('conductorInFlight counts every hand-kept entry, whatever its kind, only when the run names this session', () => {
  expect(conductorInFlight(CONDUCTOR, SID)).toEqual([GATE, IMPLEMENTER])
  expect(conductorInFlight({ ...CONDUCTOR, inFlight: [IMPLEMENTER] }, SID)).toEqual([IMPLEMENTER])
  expect(conductorInFlight({ ...CONDUCTOR, inFlight: [42, null, GATE] }, SID)).toEqual([GATE])
  expect(conductorInFlight({ ...CONDUCTOR, inFlight: 'agents' }, SID)).toEqual([])

  expect(conductorInFlight({ ...CONDUCTOR, sessionId: OTHER_SID }, SID)).toBeNull()

  expect(conductorInFlight(UNOWNED, SID)).toEqual([])
  expect(conductorInFlight({ ...UNOWNED, sessionId: '' }, SID)).toEqual([])

  expect(conductorInFlight({ ...CONDUCTOR, phase: 'done' }, SID)).toBeNull()
})

// 60% is under the failsafe's 75%, so the only rule that could compact here is rule 1.
test('a bystander at 60% is not compacted when the run names another session', async ($, on) => {
  const w = world(on, { state: { ...CONDUCTOR, sessionId: OTHER_SID } })
  await startSession($, w.clock)
  await turn($, w, 't1', 60)
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([])
})

test('a bystander at 75% gets the failsafe as if there were no run', async ($, on) => {
  const w = world(on, { state: { ...CONDUCTOR, sessionId: OTHER_SID } })
  await startSession($, w.clock)
  await turn($, w, 't1', 80)
  expect(w.toasts).toContain(FAILSAFE_TOAST)
  await w.clock.advance(60_000)
  expect(w.compactions.length).toBe(1)
  expect(w.compactions[0]).toContain('Keep the thread')
})

test('a run with no sessionId does not count its hand-kept inFlight, which may be another session\'s', async ($, on) => {
  const w = world(on, { state: UNOWNED })
  await startSession($, w.clock)
  await turn($, w, 't1', 60)
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([])
})

test('a run naming this session compacts on a hand-kept gate alone', async ($, on) => {
  const w = world(on, { state: { ...CONDUCTOR, inFlight: [GATE] } })
  await startSession($, w.clock)
  await turn($, w, 't1', 45)
  expect(w.compactions.length).toBe(1)
  expect(w.compactions[0]).toContain(`gate ${HAND_KEPT_ID}`)
})

// claude-ops keeps no task registry, so a hand-kept agent entry is what says a subagent runs.
test('a run naming this session compacts on a hand-kept agent entry alone', async ($, on) => {
  const w = world(on, { state: { ...CONDUCTOR, inFlight: [IMPLEMENTER] } })
  await startSession($, w.clock)
  await turn($, w, 't1', 60)
  expect(w.compactions.length).toBe(1)
  expect(w.compactions[0]).toContain(`agent ${AGENT_ID}: task-14 implementer`)
})

// 60% is under the failsafe's 75%, so a compaction here can only be rule 1's.
test('a standalone durable-state run with no phase compacts under rule 1', async ($, on) => {
  const { phase: _phase, ...standalone } = { ...CONDUCTOR, skill: 'durable-state' }
  const w = world(on, { state: standalone })
  await startSession($, w.clock)
  await turn($, w, 't1', 60)
  expect(w.compactions.length).toBe(1)
  expect(w.statuses).toEqual(['claude-ops autocompact: compacted at 60% (conductor idle)'])
})

test('a durable-state run driven by any skill compacts under rule 1', async ($, on) => {
  const w = world(on, { state: { ...CONDUCTOR, skill: 'triage-issues', phase: 'verify' } })
  await startSession($, w.clock)
  await turn($, w, 't1', 60)
  expect(w.compactions.length).toBe(1)
})

test('a state.json that is not a JSON object does not compact under rule 1', async ($, on) => {
  const w = world(on, { state: [CONDUCTOR] })
  await startSession($, w.clock)
  await turn($, w, 't1', 60)
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([])
})

test('a conductor whose phase is done does not compact', async ($, on) => {
  const w = world(on, { state: { ...CONDUCTOR, phase: 'done' } })
  await startSession($, w.clock)
  await turn($, w, 't1', 60)
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([])
})

test('a conductor with nothing wake-capable in flight does not compact', async ($, on) => {
  const w = world(on, { state: { ...CONDUCTOR, inFlight: [] } })
  await startSession($, w.clock)
  await turn($, w, 't1', 60)
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([])
})

test('a conductor at exactly 25% does not compact', async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)
  await turn($, w, 't1', 25)
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([])
})

test('an undefined percent never compacts, measured or read from usage', async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)
  // No measure yet: the tick falls back to usage(), which has no reading either.
  await w.clock.advance(MINUTE)
  await turn($, w, 't1', undefined)
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([])
  expect(w.toasts).not.toContain(FAILSAFE_TOAST)
})

test('with no measure seen, the tick reads the percent from usage()', async ($, on) => {
  const w = world(on, { state: CONDUCTOR, usagePercent: 45 })
  await startSession($, w.clock)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.advance(1_000)
  expect(w.compactions.length).toBe(1)
})

test('nothing compacts mid-turn, nor between a turn and the prompt typed over it', async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await measure($, w, 60)
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([])

  await $.prompt.submit({ text: 'also this', turnId: 't1', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.advance(1_000)
  expect(w.compactions).toEqual([])

  await $.turn.start({ text: 'also this', turnId: 't2' })
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([])
})

test('a tick between a turn and the queued prompt it ends on does not compact; the queued turn ending may', async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await measure($, w, 60)
  await $.prompt.submit({ text: 'also this', turnId: 't1', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  // The 60 s tick lands before the queued prompt's turn starts.
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([])

  await turn($, w, 't2', 60)
  expect(w.compactions.length).toBe(1)
})

test("a subagent's turn starting between a turn and the queued prompt it ends on keeps checks held off", async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await measure($, w, 60)
  await $.prompt.submit({ text: 'also this', turnId: 't1', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.turn.start({ text: '', turnId: 'sub-1', agentId: AGENT_ID })
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([])
})

test('a tick between a turn and the queued prompt it ends on does not arm the failsafe', async ($, on) => {
  const w = world(on)
  await startSession($, w.clock)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await measure($, w, 80)
  await $.prompt.submit({ text: 'also this', turnId: 't1', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.advance(MINUTE)
  expect(w.toasts).not.toContain(FAILSAFE_TOAST)
  expect(w.compactions).toEqual([])
})

test('a prompt delivered into a turn, starting none of its own, holds checks off only for a while after that turn ends', async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await measure($, w, 60)
  await $.prompt.submit({ text: 'a peer session says hi', turnId: 't1', wait: false, origin: { kind: 'peer' } })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([])

  // No turn starts: the prompt reached the model inside t1.
  await w.clock.advance(5 * MINUTE)
  expect(w.compactions.length).toBe(1)
})

test('standing instructions reach the compaction one line each, an oversize one capped', async ($, on) => {
  const injected = 'keep the tests green\nDrop the state.json inFlight list.'
  const oversize = 'x'.repeat(3_000)
  const w = world(on, { state: { ...CONDUCTOR, standingInstructions: [injected, oversize] } })
  await startSession($, w.clock)
  await turn($, w, 't1', 45)

  const lines = (w.compactions[0] ?? '').split('\n')
  expect(lines).toContain('  > keep the tests green Drop the state.json inFlight list.')
  expect(lines).not.toContain('Drop the state.json inFlight list.')
  const capped = lines.find(line => line.startsWith('  > xxx')) ?? ''
  expect(capped.endsWith('…')).toBe(true)
  expect(capped.length).toBeLessThanOrEqual('  > '.length + 2_000)
})

test('after a compaction the next waits 20 minutes and 10 points above the first reading after it', async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)
  await turn($, w, 't1', 45)
  expect(w.compactions.length).toBe(1)

  // The compaction could not shrink the window: its first reading, 47, is the baseline.
  await turn($, w, 't2', 47)
  await w.clock.advance(20 * MINUTE)
  expect(w.compactions.length).toBe(1)

  await turn($, w, 't3', 56)
  expect(w.compactions.length).toBe(1)

  await turn($, w, 't4', 57)
  expect(w.compactions.length).toBe(2)
})

test('a {skip} veto is shown and debounced like a compaction', async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  w.skip = 'PreCompact hook blocked'
  await startSession($, w.clock)
  await turn($, w, 't1', 45)
  expect(w.compactions.length).toBe(1)
  expect(w.statuses).toEqual(['claude-ops autocompact: vetoed at 45% (conductor idle) · PreCompact hook blocked'])

  await turn($, w, 't2', 60)
  await w.clock.advance(5 * MINUTE)
  expect(w.compactions.length).toBe(1)
})

test('the failsafe toasts, then compacts an idle session at 75% after 60 s with keep-the-thread instructions', async ($, on) => {
  const w = world(on)
  await startSession($, w.clock)
  await turn($, w, 't1', 80)
  expect(w.toasts).toContain(FAILSAFE_TOAST)

  await w.clock.advance(59_000)
  expect(w.compactions).toEqual([])
  await w.clock.advance(1_000)
  expect(w.compactions.length).toBe(1)
  expect(w.compactions[0]).toContain('Keep the thread')
  expect(w.statuses).toEqual(['claude-ops autocompact: compacted at 80% (failsafe idle)'])
})

test('a compaction leaves trail rows: the check that chose it, the attempt, and its outcome', async ($, on) => {
  const runs = captureRuns(on)
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)

  await turn($, w, 't1', 45)

  const rows = trailRows(runs, 'autocompact')
  expect(rows.slice(-2)).toEqual(['claude-ops autocompact: conductor: compacting at 45%', 'claude-ops autocompact: compacted at 45% (conductor idle)'])
  expect(rows.at(-3)?.startsWith('claude-ops autocompact: check at 45%: conductor: rule 1: ')).toBe(true)
})

test('a check repeated every minute leaves one trail row until its verdict changes, not one per tick', async ($, on) => {
  const runs = captureRuns(on)
  const w = world(on)
  await startSession($, w.clock)

  await turn($, w, 't1', 24)
  await w.clock.advance(3 * MINUTE)
  await measure($, w, 25)
  await w.clock.advance(MINUTE)
  await turn($, w, 't2', 50)

  expect(trailRows(runs, 'autocompact')).toEqual([
    'claude-ops autocompact: check at 24%: none: rule 1: at 24%, not over 25%; rule 2: at 24%, under 75%',
    'claude-ops autocompact: check at 50%: none: rule 1: no readable state.json (.durable-state/state.json); rule 2: at 50%, under 75%',
  ])
})

const AC: AutocompactInputs['ac'] = {
  isSessionOn: true,
  percent: null,
  isMeasured: true,
  lastAttemptAt: null,
  baseline: null,
  isAwaitingBaseline: false,
  failsafe: null,
  failsafeSeq: 0,
  cancelledFor: null,
  queuedTurnId: null,
  queuedTurnEndedAt: null,
  lastCheck: null,
}

function staleDecision(isStaleOn: boolean, idleMs: number, percent: number): string {
  const idle = { running: false, idleSince: new Date(NOON - idleMs).toISOString(), queued: 0, pendingSubmits: 0 }
  const decision = decide({ mode: 'on', ac: { ...AC, isStaleOn }, idle, percent, conductor: null, now: NOON })
  return `${decision.rule}: ${decision.reason}`
}

test('rule 3 compacts a session idle 6 h at 20% or more, and only once it is switched on', () => {
  expect(staleDecision(true, STALE_IDLE_MS, 20)).toBe('stale: rule 3: idle 6h00m at 20%, at or over 20%')
  expect(staleDecision(true, STALE_IDLE_MS - MINUTE, 50)).toBe(
    'none: rule 1: state.json was not read; rule 2: at 50%, under 75%; rule 3: idle 5h59m, needs 6h00m',
  )
  expect(staleDecision(true, 30 * STALE_IDLE_MS, 19)).toBe(
    'none: rule 1: at 19%, not over 25%; rule 2: at 19%, under 75%; rule 3: idle 180h00m but at 19%, under 20%',
  )
  expect(staleDecision(false, 30 * STALE_IDLE_MS, 50)).toBe('none: rule 1: state.json was not read; rule 2: at 50%, under 75%')
})

test('a session left idle for hours is not compacted while the idle-hours rule is off', async ($, on) => {
  const w = world(on, { usagePercent: 30, idleSince: NOON - 7 * 60 * MINUTE })
  await startSession($, w.clock)

  await w.clock.advance(2 * MINUTE)
  expect(w.compactions).toEqual([])
})

test('/claude-autocompact stale on compacts a session idle for hours, its summary told to name rule 3', async ($, on) => {
  const runs = captureRuns(on)
  const w = world(on, { usagePercent: 30, idleSince: NOON - 7 * 60 * MINUTE })
  await startSession($, w.clock)

  expect(await autocompactCommand($, w, 'stale on')).toBe(
    'the idle-hours rule is on for this session: idle 6 h at 20% or more compacts, unless autocompact is off.',
  )
  await w.clock.advance(MINUTE)

  expect(w.compactions.length).toBe(1)
  expect(w.compactions[0]?.split('\n')[0]).toBe(`Begin the summary with this line, verbatim: "${COMPACTION_MARK} (rule 3, 30%)."`)
  expect(w.statuses).toEqual(['claude-ops autocompact: compacted at 30% (idle for hours)'])
  expect(trailRows(runs, 'autocompact')).toContain('claude-ops autocompact: idle-hours rule (3) switched on for this session')
})

test('the failsafe is cancelled by prompt.edit and does not re-arm in that idle episode', async ($, on) => {
  const w = world(on)
  await startSession($, w.clock)
  await turn($, w, 't1', 80)
  expect(w.toasts).toContain(FAILSAFE_TOAST)

  await edit($, { origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'h' })
  await w.clock.settle()
  await w.clock.advance(3 * MINUTE)
  expect(w.compactions).toEqual([])
  expect(w.toasts.filter(text => text === FAILSAFE_TOAST).length).toBe(1)
  expect(w.toasts).toContain('claude-ops autocompact: cancelled')
})

test('the failsafe is cancelled by a prompt recalled from history', async ($, on) => {
  const w = world(on)
  await startSession($, w.clock)
  await turn($, w, 't1', 80)
  expect(w.toasts).toContain(FAILSAFE_TOAST)

  await change($, { text: 'an earlier prompt', cursor: 17, origin: { kind: 'history' } })
  await w.clock.settle()
  await w.clock.advance(3 * MINUTE)
  expect(w.compactions).toEqual([])
  expect(w.toasts).toContain('claude-ops autocompact: cancelled')
})

test("a plugin's fill of the prompt box leaves the failsafe armed", async ($, on) => {
  const w = world(on)
  await startSession($, w.clock)
  await turn($, w, 't1', 80)

  await change($, { text: 'filled', cursor: 6, origin: { kind: 'plugin', name: 'another-plugin' } })
  await w.clock.settle()
  await w.clock.advance(MINUTE)
  expect(w.compactions.length).toBe(1)
})

test('conductor-only never arms the failsafe', { options: { autocompact: 'conductor-only' } }, async ($, on) => {
  const w = world(on)
  await startSession($, w.clock)
  await turn($, w, 't1', 90)
  await w.clock.advance(2 * MINUTE)
  expect(w.toasts).not.toContain(FAILSAFE_TOAST)
  expect(w.compactions).toEqual([])
})

test('conductor-only still compacts a qualifying conductor', { options: { autocompact: 'conductor-only' } }, async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)
  await turn($, w, 't1', 45)
  expect(w.compactions.length).toBe(1)
})

test('off never compacts or arms', { options: { autocompact: 'off' } }, async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)
  await turn($, w, 't1', 90)
  await w.clock.advance(2 * MINUTE)
  expect(w.compactions).toEqual([])
  expect(w.toasts).not.toContain(FAILSAFE_TOAST)
  expect(await autocompactCommand($, w, '')).toContain('global setting: off')
})

test('the built-in /autocompact is left to the engine', async ($, on) => {
  const w = world(on)
  on('command.run', { command: 'autocompact' }, () => ({ text: 'engine threshold' }))
  await startSession($, w.clock)
  const result = await $.command.run({ command: 'autocompact', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(result.text).toBe('engine threshold')
})

test('a /compact the person ran leaves no stale percent for the next tick to act on', async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)
  await autocompactCommand($, w, 'off')
  await turn($, w, 't1', 45)
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'long history', toolUses: [] }] })
  expect(w.compactions).toEqual([''])

  await autocompactCommand($, w, 'on')
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([''])
})

test('/claude-autocompact off stops this session compacting, and on lets it again', async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)
  expect(await autocompactCommand($, w, 'off')).toContain('off for this session')
  await turn($, w, 't1', 45)
  await w.clock.advance(MINUTE)
  expect(w.compactions).toEqual([])

  expect(await autocompactCommand($, w, 'on')).toContain('on for this session')
  await turn($, w, 't2', 45)
  expect(w.compactions.length).toBe(1)
})

test('bare /claude-autocompact says an idle conductor over 25% did not compact because nothing is in flight', async ($, on) => {
  const w = world(on, { state: { ...CONDUCTOR, inFlight: [] } })
  await startSession($, w.clock)
  await turn($, w, 't1', 45)
  expect(w.compactions).toEqual([])

  const text = await autocompactCommand($, w, '')
  expect(text).toContain('autocompact is on for this session (global setting: on;')
  expect(text).toContain('but nothing is in flight')
  expect(text).toContain('context: 45% (from the last session.measure)')
  expect(text).toContain('in flight: nothing')
  expect(text).toContain('checks: every 60s, and 1s after each main-loop turn')
  expect(text).toMatch(/last check: 0s ago at 45%: none: rule 1: .* but nothing is in flight .*; rule 2: at 45%, under 75%/)
  expect(w.logs.some(line => line.startsWith('claude-ops: autocompact check at 45%: none: rule 1:'))).toBe(true)
})

test('bare /claude-autocompact names the session another run belongs to', async ($, on) => {
  const w = world(on, { state: { ...CONDUCTOR, sessionId: OTHER_SID } })
  await startSession($, w.clock)
  await turn($, w, 't1', 60)

  const text = await autocompactCommand($, w, '')
  expect(text).toContain(`now: would not compact: rule 1: ${STATE_JSON} (sdd-loop, phase implement) belongs to session ${OTHER_SID}; rule 2: at 60%, under 75%`)
  expect(text).toContain('in flight: nothing')
})

test('bare /claude-autocompact reads the run under 25% and lists what is in flight', async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)
  await turn($, w, 't1', 24)

  const text = await autocompactCommand($, w, '')
  expect(text).toContain('now: would not compact: rule 1: at 24%, not over 25%; rule 2: at 24%, under 75%')
  expect(text).toContain(`run: ${STATE_JSON} (sdd-loop, phase implement) is this session's`)
  expect(text).toContain(`in flight: gate ${HAND_KEPT_ID}, agent ${AGENT_ID}`)
})

test('after a compaction, bare /claude-autocompact shows the last attempt and the debounce holding the next', async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)
  await turn($, w, 't1', 45)
  expect(w.compactions.length).toBe(1)
  await turn($, w, 't2', 52)

  const text = await autocompactCommand($, w, '')
  expect(text).toContain('last attempt: 1s ago (first reading since 52%, re-trigger at 62%)')
  expect(text).toMatch(/last check: 0s ago at 52%: none: debounced: the last attempt was 1s ago, quiet for 19m more/)
  expect(text).toContain('now: would not compact: debounced')
})

test('a check while a turn runs records that the turn is running', async ($, on) => {
  const w = world(on, { state: CONDUCTOR })
  await startSession($, w.clock)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await w.clock.advance(MINUTE)

  expect(await autocompactCommand($, w, '')).toContain('none: a main-loop turn is running')
})

test('bare /claude-autocompact reads state saved before lastCheck existed as no check yet', async ($, on) => {
  const saved = {
    isSessionOn: true,
    percent: 45,
    isMeasured: true,
    lastAttemptAt: null,
    baseline: null,
    isAwaitingBaseline: false,
    failsafe: null,
    failsafeSeq: 0,
    cancelledFor: null,
    queuedTurnId: null,
    queuedTurnEndedAt: null,
  }
  const w = world(on, { state: CONDUCTOR, autocompact: saved })
  await startSession($, w.clock)

  const text = await autocompactCommand($, w, '')
  expect(text).toContain('last check: none since this session loaded the state')
  expect(text).toContain('context: 45% (from the last session.measure)')
})

