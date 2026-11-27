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

function render(
  pool: PlacementItem[],
  items: ReadonlyMap<string, ExerciseItem>,
  scopeName?: string,
  back = { to: '/', name: 'Home' },
) {
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
          back={back}
        />
      </MemoryRouter>
    </MantineProvider>,
  );
}

/** Text as React renders it into HTML. */
/** `text` escaped as renderToString escapes text content. */
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
const html = (text: string) => text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
const linkTo = (href: string, label: string) => new RegExp(`<a[^>]*href="${href}"[^>]*>${label}</a>`);
const homeLink = (label: string) => linkTo('/', label);

describe('PlacementRun', () => {
  it('[PLC-21] says there is nothing left to place when the countries pool is empty, with a link Home', () => {
    const out = render([], new Map());
    expect(out).toContain(html(emptyPoolText('countries')));
    expect(out).toMatch(homeLink('Back to Home'));
    expect(out).not.toContain('data-testid="exercise-stub"');
  });

  it('[PLC-21] names the item and its tier when a test-out has nothing left to test', () => {
    const out = render([], new Map(), 'France', { to: '/progress/france', name: 'France' });
    expect(out).toContain(html(emptyPoolText('regions', 'France')));
    expect(out).toMatch(linkTo('/progress/france', 'Back to France'));
  });

  it('[PLC-09] says there is nothing to ask when no item has a difficulty', () => {
    const out = render([{ itemId: 'country:beta', level: Infinity, area: 'europe' }], new Map());
    expect(out).toContain(NOTHING_TO_ASK_TEXT);
    expect(out).toMatch(homeLink('Back to Home'));
  });

  it('[PLC-18] a test-out names the tested item in its Quit link and leads to its page', () => {
    const items = new Map([['country:alpha', buildExerciseItem('country:alpha', DATA)] as const]);
    const pool = [{ itemId: 'country:alpha', level: 4, area: 'europe' }];
    const out = render(pool, items, 'France', { to: '/progress/france', name: 'France' });
    expect(out).toMatch(linkTo('/progress/france', 'Quit to France'));
    expect(out).not.toMatch(homeLink('Quit to Home'));
  });

  it('[PLC-03, PLC-18] opens on an L3 question with the heading, the counter and Quit, and no Finish now', () => {
    const items = new Map(
      ['country:alpha', 'country:beta'].map((id) => [id, buildExerciseItem(id, DATA)] as const),
    );
    const pool = [...items.keys()].map((itemId) => ({ itemId, level: 4, area: 'europe' }));
    const out = render(pool, items);
    expect(out).toContain('Heading under test');
    expect(out).toContain(placementHeader(0, 2));
    expect(out).toMatch(homeLink('Quit to Home'));
    expect(out).not.toContain('Finish now');
    expect(out).toMatch(/data-testid="placement-question"[^>]*data-rung="3"/);
    expect(out).toMatch(/data-exercise="country:(alpha|beta)@3"/);
  });
});
