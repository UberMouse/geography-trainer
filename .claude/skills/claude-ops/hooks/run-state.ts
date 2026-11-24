import type { EngineInterface } from 'claude-code'

import { RUN_STATE_FILES } from './inflight-model'

/**
 * The run's state.json, parsed, and where it was; null when there is none or it does not parse.
 * One reader for every feature, so which files count and how a bad one is treated cannot drift;
 * `onError` is the caller's log, so the failure names the feature that read it.
 */
export async function readRunState(
  $: EngineInterface,
  root: string,
  onError: (where: string, error: unknown) => void,
): Promise<{ path: string; json: unknown } | null> {
  for (const name of RUN_STATE_FILES) {
    const path = `${root}/${name}`
    if (await $.fs.exists(path)) {
      try {
        return { path, json: JSON.parse(await $.fs.read(path)) }
      } catch (error) {
        onError(`read of ${path}`, error)
        return null
      }
    }
  }
  return null
}
