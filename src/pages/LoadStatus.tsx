import type { ReactNode } from 'react';
import type { Loaded } from './useLoaded';

/** Loading, an error with Retry, or `children` with the loaded data. */
export default function Status<T>({
  state,
  retry,
  children,
}: {
  state: Loaded<T>;
  retry: () => void;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'loading') return <p>Loading…</p>;
  if (state.status === 'error') {
    return (
      <div role="alert">
        <p>Could not load the map data: {state.error.message}</p>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }
  return children(state.data);
}
