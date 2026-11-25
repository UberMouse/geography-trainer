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
  let running = false;
  let current: Promise<void> = Promise.resolve();

  function setState(next: SaveQueueState) {
    // A new object only on a real change, so `getState` suits useSyncExternalStore.
    if (next.unsaved === state.unsaved && next.failed === state.failed) return;
    state = next;
    for (const listener of [...listeners]) {
      // A throwing listener must never stop the queue.
      try {
        listener();
      } catch (error) {
        console.error('saveQueue listener threw', error);
      }
    }
  }

  // `running` is cleared synchronously at each exit, so a push or retry made right after (or from
  // a listener notified at) the exit always starts a new drain.
  async function drain() {
    while (pending.length > 0) {
      try {
        await write(pending[0] as T);
      } catch {
        running = false;
        setState({ unsaved: pending.length, failed: true });
        return;
      }
      pending.shift();
      // `failed` clears once the write that had failed succeeds, so a retry keeps the banner up.
      setState({ unsaved: pending.length, failed: false });
    }
    running = false;
  }

  function start(): Promise<void> {
    if (!running) {
      running = true;
      current = drain();
    }
    return current;
  }

  return {
    push(entry) {
      pending.push(entry);
      setState({ unsaved: pending.length, failed: state.failed });
      if (!state.failed) void start();
    },
    retry() {
      if (running) return current;
      if (!state.failed) return Promise.resolve();
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
