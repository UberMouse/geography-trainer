import { MantineProvider } from '@mantine/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SaveQueueState } from '../storage/saveQueue';
import SaveStatus from './SaveStatus';

const state = vi.hoisted(() => ({ current: { unsaved: 0, failed: false } as SaveQueueState }));

vi.mock('../storage/progressStore', () => ({
  progressStore: {
    answers: {
      subscribe: () => () => {},
      getState: () => state.current,
      retry: () => Promise.resolve(),
    },
  },
}));

function render(next: SaveQueueState) {
  state.current = next;
  // Without Mantine's style tag and React's markers between adjacent text parts.
  return renderToString(
    <MantineProvider>
      <SaveStatus />
    </MantineProvider>,
  )
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replaceAll('<!-- -->', '');
}

describe('[GLB-34] the save status banner', () => {
  it('shows nothing while saves succeed, even with answers waiting', () => {
    expect(render({ unsaved: 0, failed: false })).toBe('');
    expect(render({ unsaved: 3, failed: false })).toBe('');
  });

  it('after a failed save, says how many answers are unsaved and offers Retry', () => {
    const many = render({ unsaved: 2, failed: true });
    expect(many).toContain('Your last 2 answers could not be saved');
    expect(many).toContain('loses them');
    expect(many).toMatch(/<button[^>]*>.*Retry.*<\/button>/s);
    const one = render({ unsaved: 1, failed: true });
    expect(one).toContain('Your last answer could not be saved');
    expect(one).toContain('loses it');
  });
});
