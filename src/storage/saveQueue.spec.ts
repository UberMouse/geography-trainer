import { describe, expect, it, vi } from 'vitest';
import { createSaveQueue } from './saveQueue';

/** A writer whose calls are held until the test settles them. */
function controlledWriter() {
  const started: string[] = [];
  const settlers: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const write = (entry: string) => {
    started.push(entry);
    return new Promise<void>((resolve, reject) => settlers.push({ resolve, reject }));
  };
  return { write, started, settlers };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('[STO-C06] createSaveQueue', () => {
  it('[STO-01] writes strictly in order: a write starts only after the previous one settled', async () => {
    const { write, started, settlers } = controlledWriter();
    const queue = createSaveQueue(write);
    queue.push('a');
    queue.push('b');
    await tick();
    expect(started).toEqual(['a']);
    expect(queue.getState()).toEqual({ unsaved: 2, failed: false });
    settlers[0]?.resolve();
    await tick();
    expect(started).toEqual(['a', 'b']);
    expect(queue.getState()).toEqual({ unsaved: 1, failed: false });
    settlers[1]?.resolve();
    await tick();
    expect(queue.getState()).toEqual({ unsaved: 0, failed: false });
  });

  it('[STO-02] on a failure stops, keeps later entries waiting and retry resumes from the failed one', async () => {
    const written: string[] = [];
    let failNext = true;
    const queue = createSaveQueue(async (entry: string) => {
      if (entry === 'b' && failNext) throw new Error('disk full');
      written.push(entry);
    });
    queue.push('a');
    queue.push('b');
    queue.push('c');
    await tick();
    expect(written).toEqual(['a']);
    expect(queue.getState()).toEqual({ unsaved: 2, failed: true });

    queue.push('d');
    await tick();
    expect(written).toEqual(['a']);
    expect(queue.getState()).toEqual({ unsaved: 3, failed: true });

    failNext = false;
    await queue.retry();
    expect(written).toEqual(['a', 'b', 'c', 'd']);
    expect(queue.getState()).toEqual({ unsaved: 0, failed: false });
  });

  it('restore puts entries ahead of a newer push and keeps a failed queue failed until retry', async () => {
    const written: string[] = [];
    const queue = createSaveQueue(async (entry: string) => {
      written.push(entry);
    });
    queue.restore(['a', 'b'], true);
    queue.push('c');
    await tick();
    expect(written).toEqual([]);
    expect(queue.unsavedEntries()).toEqual(['a', 'b', 'c']);
    expect(queue.getState()).toEqual({ unsaved: 3, failed: true });
    await queue.retry();
    expect(written).toEqual(['a', 'b', 'c']);
    expect(queue.getState()).toEqual({ unsaved: 0, failed: false });
  });

  it('restore during a write goes behind the entry being written, once each', async () => {
    const written: string[] = [];
    let release: () => void = () => {};
    const queue = createSaveQueue(async (entry: string) => {
      if (entry === 'A') await new Promise<void>((resolve) => (release = resolve));
      written.push(entry);
    });
    queue.push('A');
    await tick();
    queue.restore(['R1', 'R2'], false);
    release();
    await queue.whenSettled();
    expect(written).toEqual(['A', 'R1', 'R2']);
    expect(queue.getState()).toEqual({ unsaved: 0, failed: false });
  });

  it('restore with failed=false starts writing in order', async () => {
    const written: string[] = [];
    const queue = createSaveQueue(async (entry: string) => {
      written.push(entry);
    });
    queue.restore(['a', 'b'], false);
    await tick();
    expect(written).toEqual(['a', 'b']);
    expect(queue.getState()).toEqual({ unsaved: 0, failed: false });
  });

  it('[STO-02] a retry that fails again stops at that entry and keeps the failed state', async () => {
    const written: string[] = [];
    let failures = 2;
    const queue = createSaveQueue(async (entry: string) => {
      if (entry === 'b' && failures-- > 0) throw new Error('nope');
      written.push(entry);
    });
    queue.push('a');
    queue.push('b');
    queue.push('c');
    await tick();
    await queue.retry();
    expect(written).toEqual(['a']);
    expect(queue.getState()).toEqual({ unsaved: 2, failed: true });
    await queue.retry();
    expect(written).toEqual(['a', 'b', 'c']);
    expect(queue.getState()).toEqual({ unsaved: 0, failed: false });
  });

  it('retry does nothing when nothing failed', async () => {
    const { write, started } = controlledWriter();
    const queue = createSaveQueue(write);
    await queue.retry();
    expect(started).toEqual([]);
  });

  it('notifies subscribers of each state change until they unsubscribe', async () => {
    const queue = createSaveQueue(async () => {});
    const seen: string[] = [];
    const unsubscribe = queue.subscribe(() => {
      const { unsaved, failed } = queue.getState();
      seen.push(`${unsaved}${failed ? 'F' : ''}`);
    });
    queue.push('a');
    await tick();
    expect(seen).toEqual(['1', '0']);
    unsubscribe();
    queue.push('b');
    await tick();
    expect(seen).toEqual(['1', '0']);
  });

  it('[STO-02, STO-03] reports failure to subscribers and keeps it through a retry until the write succeeds', async () => {
    let fail = true;
    const queue = createSaveQueue(async () => {
      if (fail) throw new Error('x');
    });
    const seen: string[] = [];
    queue.subscribe(() => {
      const { unsaved, failed } = queue.getState();
      seen.push(`${unsaved}${failed ? 'F' : ''}`);
    });
    queue.push('a');
    await tick();
    fail = false;
    await queue.retry();
    expect(seen).toEqual(['1', '1F', '0']);
  });

  it('a retry made by a listener as the failure is published still retries', async () => {
    let fail = true;
    const written: string[] = [];
    const queue = createSaveQueue(async (entry: string) => {
      if (fail) {
        fail = false;
        throw new Error('once');
      }
      written.push(entry);
    });
    queue.subscribe(() => {
      if (queue.getState().failed) void queue.retry();
    });
    queue.push('a');
    await tick();
    expect(written).toEqual(['a']);
    expect(queue.getState()).toEqual({ unsaved: 0, failed: false });
  });

  it('a throwing listener does not stop the queue', async () => {
    const written: string[] = [];
    const queue = createSaveQueue(async (entry: string) => {
      written.push(entry);
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    queue.subscribe(() => {
      throw new Error('bad listener');
    });
    queue.push('a');
    queue.push('b');
    await tick();
    errors.mockRestore();
    expect(written).toEqual(['a', 'b']);
    expect(queue.getState()).toEqual({ unsaved: 0, failed: false });
  });

  it('whenSettled waits for an in-flight write and the writes queued behind it', async () => {
    const { write, started, settlers } = controlledWriter();
    const queue = createSaveQueue(write);
    queue.push('a');
    queue.push('b');
    let settled = false;
    void queue.whenSettled().then(() => (settled = true));
    await tick();
    expect(settled).toBe(false);
    settlers[0]?.resolve();
    await tick();
    expect(started).toEqual(['a', 'b']);
    expect(settled).toBe(false);
    settlers[1]?.resolve();
    await tick();
    expect(settled).toBe(true);
  });

  it('whenSettled works when called detached', async () => {
    const { write, settlers } = controlledWriter();
    const queue = createSaveQueue(write);
    const { whenSettled } = queue;
    queue.push('a');
    let settled = false;
    void whenSettled().then(() => (settled = true));
    await tick();
    expect(settled).toBe(false);
    settlers[0]?.resolve();
    await tick();
    expect(settled).toBe(true);
  });

  it('whenSettled resolves at once when idle and resolves on a failure', async () => {
    const queue = createSaveQueue(async () => {
      throw new Error('x');
    });
    await queue.whenSettled();
    queue.push('a');
    await queue.whenSettled();
    expect(queue.getState()).toEqual({ unsaved: 1, failed: true });
  });

  it('unsavedEntries lists the unsaved entries in push order', async () => {
    const queue = createSaveQueue(async (entry: string) => {
      if (entry === 'b') throw new Error('x');
    });
    queue.push('a');
    queue.push('b');
    queue.push('c');
    await queue.whenSettled();
    expect(queue.unsavedEntries()).toEqual(['b', 'c']);
  });

  it('discard drops the unsaved entries, resets the state and notifies', async () => {
    const queue = createSaveQueue(async () => {
      throw new Error('x');
    });
    queue.push('a');
    queue.push('b');
    await queue.whenSettled();
    const seen: string[] = [];
    queue.subscribe(() => {
      const { unsaved, failed } = queue.getState();
      seen.push(`${unsaved}${failed ? 'F' : ''}`);
    });
    queue.discard();
    expect(queue.unsavedEntries()).toEqual([]);
    expect(queue.getState()).toEqual({ unsaved: 0, failed: false });
    expect(seen).toEqual(['0']);
  });

  it('discard while a write is running throws', () => {
    const { write } = controlledWriter();
    const queue = createSaveQueue(write);
    queue.push('a');
    expect(() => queue.discard()).toThrow(/write is running/);
    expect(queue.unsavedEntries()).toEqual(['a']);
  });
});
