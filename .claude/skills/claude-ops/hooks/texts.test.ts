import { expect, test } from 'claude-code/testing'

import { COMPACTION_MARK, conductorInstructions, failsafeInstructions, staleInstructions, statusText } from './autocompact-model'
import { AUTOCOMPACT_CANCELLED_TOAST, AUTOCOMPACT_FAILSAFE_TOAST } from './ui-texts'
import { failureText } from './util'

/**
 * Every text claude-ops puts in front of the model or into the transcript names claude-ops first.
 * The transcript records a hook's context, a drop line or a plugin prompt with no plugin field, so
 * the text is the only way to tell which mod wrote it. The toasts and status lines the person
 * reads are held to the stricter `claude-ops <feature>: ` form.
 */

const MODEL_OR_TRANSCRIPT = /^claude-ops[ :]/
const TOAST_OR_STATUS = /^claude-ops autocompact: /

interface Pinned {
  readonly text: string
  readonly opens: RegExp
}

function model(text: string): Pinned {
  return { text, opens: MODEL_OR_TRANSCRIPT }
}

function ui(text: string): Pinned {
  return { text, opens: TOAST_OR_STATUS }
}

const BRIEF = { percent: 43, statePath: '/w/.durable-state/state.json', handKept: [], standing: [] }

// A new text belongs in this table, or it ships unchecked.
const TEXTS: Readonly<Record<string, Pinned>> = {
  'failureText': model(failureText('autocompact tick', new Error('boom'))),
  'conductorInstructions, second line': model(conductorInstructions(BRIEF).split('\n')[1] ?? ''),
  'failsafeInstructions, second line': model(failsafeInstructions(80).split('\n')[1] ?? ''),
  'staleInstructions, second line': model(staleInstructions(25, 7 * 3_600_000).split('\n')[1] ?? ''),
  'autocompact failsafe': ui(AUTOCOMPACT_FAILSAFE_TOAST),
  'autocompact cancelled': ui(AUTOCOMPACT_CANCELLED_TOAST),
  'autocompact status, compacted': ui(statusText('conductor', 43, null)),
  'autocompact status, vetoed': ui(statusText('stale', 43, 'PreCompact hook blocked')),
}

test('every text claude-ops shows, sends the model or writes to the transcript names claude-ops first', () => {
  const unprefixed = Object.entries(TEXTS).filter(([, { text, opens }]) => !opens.test(text))
  expect(unprefixed).toEqual([])
})

test('every claude-ops compaction asks its summary to open with a line naming claude-ops, the rule and the percent', () => {
  const opening = (instructions: string): string | undefined => instructions.split('\n')[0]

  expect(opening(conductorInstructions(BRIEF))).toBe(`Begin the summary with this line, verbatim: "${COMPACTION_MARK} (rule 1, 43%)."`)
  expect(opening(failsafeInstructions(80))).toBe(`Begin the summary with this line, verbatim: "${COMPACTION_MARK} (rule 2, 80%)."`)
  expect(opening(staleInstructions(25, 7 * 3_600_000))).toBe(`Begin the summary with this line, verbatim: "${COMPACTION_MARK} (rule 3, 25%)."`)
  expect(COMPACTION_MARK).toBe('Compacted by claude-ops autocompact')
})
