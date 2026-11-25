import { useEffect, useState } from 'react';

export type Loaded<T> =
  { status: 'loading' } | { status: 'error'; error: Error } | { status: 'ready'; data: T };

/**
 * Run `load` for `key` (again on `retry`), tracking loading, error and result. A result is kept
 * with the key and attempt it answers, so a stale one reads as loading.
 */
export function useLoaded<T>(key: string, load: () => Promise<T>): [Loaded<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ for: string; result: Loaded<T> } | null>(null);
  const current = `${key}#${attempt}`;
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setSettled({ for: current, result: { status: 'ready', data } }),
      (error: unknown) =>
        live &&
        setSettled({
          for: current,
          result: {
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          },
        }),
    );
    return () => {
      live = false;
    };
    // `load` is keyed by `key`: a new closure for the same key is the same load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  const state = settled?.for === current ? settled.result : { status: 'loading' as const };
  return [state, () => setAttempt((a) => a + 1)];
}
