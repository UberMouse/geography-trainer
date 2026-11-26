import { Alert, Button, Text } from '@mantine/core';
import { useEffect, useSyncExternalStore } from 'react';
import { progressStore } from '../storage/progressStore';

/**
 * Answers waiting to be saved, app-wide: a banner with Retry once a save has failed, and a prompt
 * before closing or reloading while any are unsaved.
 */
export default function SaveStatus() {
  const queue = progressStore.answers;
  const { failed, unsaved } = useSyncExternalStore(queue.subscribe, queue.getState, queue.getState);
  const hasUnsaved = unsaved > 0;
  // Closing or reloading while answers are unsaved would lose them: make the browser ask first.
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsaved]);

  if (!failed) return null;
  return (
    <Alert color="red" mb="md">
      <Text mb="sm">
        Your last {unsaved === 1 ? 'answer' : `${unsaved} answers`} could not be saved. You can keep
        going; closing or reloading the app before it is saved loses {unsaved === 1 ? 'it' : 'them'}.
      </Text>
      <Button onClick={() => void queue.retry()}>Retry</Button>
    </Alert>
  );
}
