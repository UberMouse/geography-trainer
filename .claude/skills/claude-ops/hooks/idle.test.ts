import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { NOON, mockState, passTurns, recordPrompts } from './testkit'

// The engine beneath the turn and prompt events: each answers as core would, echoing the input.
function turnEngine(on: On): void {
  passTurns(on)
  recordPrompts(on)
}

test('a main-loop turn marks the session running, and its end marks it idle at the clock time', async ($, on) => {
  const state = mockState(on)
  const clock = mock.clock(on, { now: NOON })
  turnEngine(on)

  await $.turn.start({ text: 'go', turnId: 't1' })
  expect(state.get('claude-ops.idle')).toEqual({ running: true, idleSince: null, queued: 0, pendingSubmits: 0 })

  await clock.advance(5000)
  await $.turn.complete({ answer: 'done', durationMs: 5000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(state.get('claude-ops.idle')).toEqual({ running: false, idleSince: '2026-10-06T12:00:05.000Z', queued: 0, pendingSubmits: 0 })
})

test('a subagent turn ending leaves the main loop running', async ($, on) => {
  const state = mockState(on)
  mock.clock(on, { now: NOON })
  turnEngine(on)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({
    answer: 'sub done',
    durationMs: 10,
    isAborted: false,
    turnId: 'sub-1',
    agentId: 'a1',
    reason: 'answer',
  })
  expect(state.get('claude-ops.idle')).toEqual({ running: true, idleSince: null, queued: 0, pendingSubmits: 0 })
})

test('a subagent turn ending while the main loop is idle keeps the original idleSince', async ($, on) => {
  const state = mockState(on)
  const clock = mock.clock(on, { now: NOON })
  turnEngine(on)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(60_000)
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted: false,
    turnId: 'sub-1',
    agentId: 'a1',
    reason: 'answer',
  })
  expect(state.get('claude-ops.idle')).toEqual({ running: false, idleSince: '2026-10-06T12:00:00.000Z', queued: 0, pendingSubmits: 0 })
})

test('a subagent turn starting while the main loop is idle leaves the session idle', async ($, on) => {
  const state = mockState(on)
  const clock = mock.clock(on, { now: NOON })
  turnEngine(on)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(60_000)
  await $.turn.start({ text: 'review the branch', turnId: 'sub-1', agentId: 'a1' })
  expect(state.get('claude-ops.idle')).toEqual({ running: false, idleSince: '2026-10-06T12:00:00.000Z', queued: 0, pendingSubmits: 0 })
})

test('a subagent turn starting mid-turn keeps the count of prompts typed over the main turn', async ($, on) => {
  const state = mockState(on)
  mock.clock(on, { now: NOON })
  turnEngine(on)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.prompt.submit({ text: 'also this', turnId: 't1', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'review the branch', turnId: 'sub-1', agentId: 'a1' })
  expect(state.get('claude-ops.idle')).toMatchObject({ running: true, queued: 1 })
})

test('a prompt typed over the running turn counts as queued, and the turn end clears it', async ($, on) => {
  const state = mockState(on)
  mock.clock(on, { now: NOON })
  turnEngine(on)

  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.prompt.submit({ text: 'also this', turnId: 't1', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'and this', turnId: 't1', wait: true, origin: { kind: 'composer' } })
  expect(state.get('claude-ops.idle')).toEqual({ running: true, idleSince: null, queued: 2, pendingSubmits: 0 })

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(state.get('claude-ops.idle')).toMatchObject({ running: false, queued: 0, pendingSubmits: 0 })
})

test('a prompt submitted while idle is pending, not queued, until its turn starts', async ($, on) => {
  const state = mockState(on)
  turnEngine(on)

  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  expect(state.get('claude-ops.idle')).toMatchObject({ running: false, queued: 0, pendingSubmits: 1 })

  await $.turn.start({ text: 'hello', turnId: 't1' })
  expect(state.get('claude-ops.idle')).toMatchObject({ running: true, pendingSubmits: 0 })
})

test('a prompt dropped while idle gives its pending turn back', async ($, on) => {
  const state = mockState(on)
  on('prompt.submit', () => ({ drop: 'refused beneath claude-ops' }))

  await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
  expect(state.get('claude-ops.idle')).toMatchObject({ pendingSubmits: 0 })
})
