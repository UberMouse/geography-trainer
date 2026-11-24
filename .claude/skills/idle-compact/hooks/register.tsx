import type { Register } from 'claude-code'

import { registerAutocompact } from './autocompact'
import { parseMode } from './autocompact-model'
import { registerIdle } from './idle'

// One plugin, one load-failure domain: each feature registers its own hooks, and every hook
// carries its own .catch that logs and passes the event on, so a failing feature degrades alone.
// Autocompact is last, inside idle, so its turn.complete reads the idle state already updated.
// `options.autocompact` is the userConfig switch; changing it reloads the module.
export const register: Register = (on, options) => {
  registerIdle(on)
  registerAutocompact(on, parseMode(options.autocompact))
}
