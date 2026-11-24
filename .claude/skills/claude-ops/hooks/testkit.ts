import type { On, ProcessRunResult } from 'claude-code'
import type { Engine, MockClock } from 'claude-code/testing'

import { TRAIL_SHELL, tracedRow } from './trail'

/**
 * The engine beneath claude-ops for the feature tests: fixtures and the hooks every test world is
 * built from. A test's hooks sit beneath every plugin and, among themselves, the first registered
 * is outermost, so a test registers its special cases before these and falls through via `next`.
 */

export const NOON = Date.UTC(2026, 9, 6, 12, 0, 0)
export const MINUTE = 60_000
export const ROOT = '/home/u/proj'
export const SID = '995a3baa-fecc-4c6a-a63f-f540f7fad18d'
const HOME = '/home/u'
export const STATE_JSON = `${ROOT}/.durable-state/state.json`

/**
 * `$.state` for a test: the kit serves no noun the test does not hook, so these hooks stand in
 * for the host beneath the plugin, compare-and-set included (`update` writes with ifVersion).
 * A call on `$` answers its hooks as `{ value }`, so each hook wraps the host's own result.
 * Returns the store, keyed `<plugin>.<key>`, for the test to seed and read.
 */
export function mockState(on: On, seed: Readonly<Record<string, unknown>> = {}): Map<string, unknown> {
  const values = new Map<string, unknown>(Object.entries(seed))
  const versions = new Map<string, number>(Object.keys(seed).map(name => [name, 1]))
  on('state.get', (_$, e) => {
    const name = `${e.plugin}.${e.key}`
    return { value: { value: values.get(name), version: versions.get(name) ?? 0 } }
  })
  on('state.set', (_$, e) => {
    const name = `${e.plugin}.${e.key}`
    const version = versions.get(name) ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== version) {
      return { value: { isSet: false as const, version } }
    }
    values.set(name, e.value)
    versions.set(name, version + 1)
    return { value: { isSet: true as const, version: version + 1 } }
  })
  return values
}

/** The session nouns: start and end echoed, root, cwd, id, HOME, command registration. */
export function mockSession(on: On, options: { root: string }): void {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.root', () => ({ value: options.root }))
  on('session.cwd', () => ({ value: options.root }))
  on('session.id', () => ({ value: SID }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
}

/** What reached the UI beneath the plugins. */
export interface FakeUi {
  logs: string[];
  toasts: string[];
  statuses: (string | undefined)[];
}

/** The UI nouns, recorded: log, toast, status line. */
export function mockUi(on: On): FakeUi {
  const ui: FakeUi = { logs: [], toasts: [], statuses: [] }
  on('ui.log', (_$, e) => {
    ui.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    ui.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    ui.statuses.push(e.text)
    return { value: undefined }
  })
  return ui
}

/** The file system beneath the plugins, for the test to seed and read. */
export interface FakeFs {
  files: Map<string, string>;
}

export function mockFs(on: On, seed: Readonly<Record<string, string>> = {}): FakeFs {
  const fs: FakeFs = { files: new Map(Object.entries(seed)) }
  on('fs.exists', (_$, e) => ({ value: fs.files.has(e.path) }))
  on('fs.read', (_$, e) => {
    const text = fs.files.get(e.path)
    if (text === undefined) {
      throw new Error(`ENOENT: ${e.path}`)
    }
    return { value: text }
  })
  return fs
}

export function runResult(exitCode: number, stdout = '', stderr = ''): ProcessRunResult {
  return { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false }
}

/**
 * The decision-trail rows among recorded `$.process.run` argvs (trail.ts): each row's text, in
 * order, only `feature`'s when one is named.
 */
export function trailRows(runs: readonly (readonly string[])[], feature?: string): string[] {
  return runs.flatMap(argv => {
    const row = tracedRow(argv)
    return row === null || (feature !== undefined && row.feature !== feature) ? [] : [row.text]
  })
}

/**
 * Every `$.process.run` argv, seen on its way to the hooks beneath, for a world that keeps none:
 * register it before the world's own `process.run` hook, and read the rows with `trailRows`.
 */
export function captureRuns(on: On): (readonly string[])[] {
  const runs: (readonly string[])[] = []
  // A matcher every argv satisfies: a second matcher-less process.run hook would be refused.
  on('process.run', { argv: /^/ }, (_$, e, next) => {
    runs.push(e.argv)
    return next(e)
  })
  return runs
}

/** `$.process.run`, answered 0 for the trail's shell and 127 (not found) for anything else. */
export function mockProcessRun(on: On): (readonly string[])[] {
  const runs: (readonly string[])[] = []
  on('process.run', (_$, e) => {
    runs.push(e.argv)
    return { value: runResult(e.argv[0] === TRAIL_SHELL ? 0 : 127) }
  })
  return runs
}

/** Turn starts and ends, answered as core would. */
export function passTurns(on: On): void {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

/** One prompt that reached beneath the plugins. */
export interface SubmittedPrompt {
  text: string;
  context: readonly string[];
  origin: string;
}

/** `prompt.submit`, recorded and let through with its text and context. */
export function recordPrompts(on: On): SubmittedPrompt[] {
  const prompts: SubmittedPrompt[] = []
  on('prompt.submit', (_$, e) => {
    prompts.push({ text: e.text, context: e.context ?? [], origin: e.origin.kind })
    return { text: e.text, context: e.context }
  })
  return prompts
}

export async function startSession($: Engine, clock: MockClock, root: string = ROOT): Promise<void> {
  await $.session.start({ cwd: root, surface: 'terminal', isInteractive: true })
  await clock.settle()
}
