// An ordered, retryable queue of writes: the session keeps going on in-memory progress while the
// queue saves each answer to storage one at a time. Plain TypeScript, no storage code.

export interface SaveQueueState {
  /** Entries pushed and not yet written, including the one being written. */
  unsaved: number;
  /** The oldest unsaved entry's write failed; nothing is attempted again until `retry()`. */
  failed: boolean;
}

export interface SaveQueue<T> {
  /** Adds an entry behind the unsaved ones; it is written in its turn (never while `failed`). */
  push(entry: T): void;
  /** Writes again from the first unsaved entry, stopping at the next failure. Resolves when idle. */
  retry(): Promise<void>;
  getState(): SaveQueueState;
  /** Calls `listener` after every state change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export function createSaveQueue<T>(write: (entry: T) => Promise<void>): SaveQueue<T> {
  const pending: T[] = [];
  const listeners = new Set<() => void>();
  let state: SaveQueueState = { unsaved: 0, failed: false };
  let draining: Promise<void> | null = null;

  function setState(next: SaveQueueState) {
    // A new object only on a real change, so `getState` suits useSyncExternalStore.
    if (next.unsaved === state.unsaved && next.failed === state.failed) return;
    state = next;
    for (const listener of [...listeners]) listener();
  }

  async function drain() {
    while (pending.length > 0) {
      try {
        await write(pending[0] as T);
      } catch {
        setState({ unsaved: pending.length, failed: true });
        return;
      }
      pending.shift();
      setState({ unsaved: pending.length, failed: false });
    }
  }

  function start(): Promise<void> {
    draining ??= drain().finally(() => {
      draining = null;
    });
    return draining;
  }

  return {
    push(entry) {
      pending.push(entry);
      setState({ unsaved: pending.length, failed: state.failed });
      if (!state.failed) void start();
    },
    retry() {
      if (draining) return draining;
      if (!state.failed) return Promise.resolve();
      setState({ unsaved: pending.length, failed: false });
      return start();
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
