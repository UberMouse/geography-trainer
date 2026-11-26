import { MantineProvider } from '@mantine/core';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { PlacementItem } from '../engine/placement';
import { DATA } from '../exercises/fixtures';
import { buildExerciseItem } from '../exercises/item';
import type { ExerciseItem, ExerciseProps } from '../exercises/types';
import { COUNTRIES_SCOPE } from '../storage/placementKeys';
import PlacementRun from './PlacementRun';
import { emptyPoolText, NOTHING_TO_ASK_TEXT, placementHeader } from './placementView';

// The exercise draws on the globe and the store opens IndexedDB: neither is needed to render.
vi.mock('../exercises/Exercise', () => ({
  default: ({ item, rung }: ExerciseProps) => <div data-testid="exercise-stub" data-exercise={`${item.id}@${rung}`} />,
}));
vi.mock('../storage/progressStore', () => ({ progressStore: {} }));

function render(pool: PlacementItem[], items: ReadonlyMap<string, ExerciseItem>, scopeName?: string) {
  return renderToString(
    <MantineProvider>
      <MemoryRouter>
        <PlacementRun
          pool={pool}
          items={items}
          progress={{}}
          tier={scopeName === undefined ? 'countries' : 'regions'}
          scope={COUNTRIES_SCOPE}
          heading="Heading under test"
          scopeName={scopeName}
        />
      </MemoryRouter>
    </MantineProvider>,
  );
}

/** Text as React renders it into HTML. */
const html = (text: string) => text.replace(/'/g, '&#x27;');
const homeLink = (label: string) => new RegExp(`<a[^>]*href="/"[^>]*>${label}</a>`);

describe('PlacementRun', () => {
  it('[PLC-21] says there is nothing left to place when the countries pool is empty, with a link Home', () => {
    const out = render([], new Map());
    expect(out).toContain(html(emptyPoolText('countries')));
    expect(out).toMatch(homeLink('Back to Home'));
    expect(out).not.toContain('data-testid="exercise-stub"');
  });

  it('[PLC-21] names the item and its tier when a test-out has nothing left to test', () => {
    expect(render([], new Map(), 'France')).toContain(html(emptyPoolText('regions', 'France')));
  });

  it('[PLC-09] says there is nothing to ask when no item has a difficulty', () => {
    const out = render([{ itemId: 'country:beta', level: Infinity, area: 'europe' }], new Map());
    expect(out).toContain(NOTHING_TO_ASK_TEXT);
    expect(out).toMatch(homeLink('Back to Home'));
  });

  it('[PLC-03, PLC-18] opens on an L3 question with the heading, the counter and Quit, and no Finish now', () => {
    const items = new Map(
      ['country:alpha', 'country:beta'].map((id) => [id, buildExerciseItem(id, DATA)] as const),
    );
    const pool = [...items.keys()].map((itemId) => ({ itemId, level: 4, area: 'europe' }));
    const out = render(pool, items);
    expect(out).toContain('Heading under test');
    expect(out).toContain(placementHeader(0, 2));
    expect(out).toMatch(homeLink('Quit'));
    expect(out).not.toContain('Finish now');
    expect(out).toMatch(/data-testid="placement-question"[^>]*data-rung="3"/);
    expect(out).toMatch(/data-exercise="country:(alpha|beta)@3"/);
  });
});
