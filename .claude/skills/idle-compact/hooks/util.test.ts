import { expect, test } from 'claude-code/testing'

import { NOON } from './testkit'
import { cleanLine, isIdle, isTurnFree, msSince, printable } from './util'

test('cleanLine collapses what durable-state-resume.sh strips: C0, DEL, C1 (NEL included), U+2028 and U+2029', () => {
  const stripped = [0x00, 0x0a, 0x1b, 0x1f, 0x7f, 0x80, 0x85, 0x9b, 0x9f, 0x2028, 0x2029]
  for (const code of stripped) {
    expect([code, cleanLine(`a${String.fromCodePoint(code)}b`, 200)]).toEqual([code, 'a b'])
  }
  expect(cleanLine(`OPEN GATE${String.fromCodePoint(0x85, 0x2028)}  forged\n`, 200)).toBe('OPEN GATE forged')
})

test('cleanLine keeps printable text beyond C1, and cuts a long line with an ellipsis', () => {
  expect(cleanLine('café – ½ ✓', 200)).toBe('café – ½ ✓')
  expect(cleanLine('x'.repeat(10), 5)).toBe('xxxx…')
})

test('msSince is the age of an ISO time, and null for none or one that does not parse', () => {
  expect(msSince(new Date(NOON - 90_000).toISOString(), NOON)).toBe(90_000)
  expect(msSince(null, NOON)).toBeNull()
  expect(msSince('not a time', NOON)).toBeNull()
})

test('a turn is free with none running or pending; idle also needs a turn to have ended', () => {
  const ended = { running: false, idleSince: new Date(NOON).toISOString(), queued: 0, pendingSubmits: 0 }
  expect([isTurnFree(ended), isIdle(ended)]).toEqual([true, true])
  expect([isTurnFree({ ...ended, idleSince: null }), isIdle({ ...ended, idleSince: null })]).toEqual([true, false])
  expect([isTurnFree({ ...ended, pendingSubmits: 1 }), isIdle({ ...ended, pendingSubmits: 1 })]).toEqual([false, false])
  expect([isTurnFree({ ...ended, running: true }), isIdle({ ...ended, running: true })]).toEqual([false, false])
})

test('printable drops escape sequences and control characters, C1 included, but keeps tab and newline', () => {
  expect(printable('a\x1b[31mb\x9b31mc\x07d\x7fe\x85f\tg\nh')).toBe('ab31mcdef\tg\nh')
})
