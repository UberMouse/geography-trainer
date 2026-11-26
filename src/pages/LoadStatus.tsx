import { Alert, Button, Group, Loader, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import type { Loaded } from './useLoaded';

/** Loading, an error with Retry, or `children` with the loaded data. */
export default function Status<T>({
  state,
  retry,
  children,
  failure = 'Could not load the map data:',
}: {
  state: Loaded<T>;
  retry: () => void;
  children: (data: T) => ReactNode;
  /** The error text before the message. */
  failure?: string;
}) {
  if (state.status === 'loading') {
    return (
      <Group gap="xs">
        <Loader size="sm" />
        <Text>Loading…</Text>
      </Group>
    );
  }
  if (state.status === 'error') {
    return (
      <Alert color="red">
        <Text mb="sm">
          {failure} {state.error.message}
        </Text>
        <Button onClick={retry}>Retry</Button>
      </Alert>
    );
  }
  return children(state.data);
}
