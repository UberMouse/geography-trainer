import { MantineProvider } from '@mantine/core';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { DEPENDENCY_CREDITS } from './credits';
import ProgressLegend from './ProgressLegend';
import { PROGRESS_COLOURS } from './progressView';

// MapLibre needs a browser: the pages render without the map (e2e covers the globe). Effects do
// not run in a server render, so a page that loads data shows its loading state.
vi.mock('../maps/Globe', () => ({ default: () => <div data-testid="globe-stub" /> }));

const render = (path: string) =>
  renderToString(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

/** The level-one headings' text (Mantine's `Title` gives them attributes). */
const h1s = (html: string) => [...html.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1]);

afterEach(() => vi.unstubAllEnvs());

describe('[SCR-C05] the routes', () => {
  it.each([
    ['/', 'Geography Trainer'],
    ['/progress', 'Progress'],
    ['/settings', 'Settings'],
    ['/credits', 'Credits'],
  ])('%s renders its page', (path, heading) => {
    expect(h1s(render(path))).toEqual([heading]);
  });

  it('renders the drill-down pages, loading first', () => {
    expect(render('/progress/france')).toContain('Loading…');
    expect(render('/progress/france/france.bretagne')).toContain('Loading…');
  });

  it('renders no page for an unknown path: it redirects to Home', () => {
    expect(h1s(render('/nowhere'))).toEqual([]);
  });
});

describe('[SCR-29, SCR-C05] the playground route', () => {
  it('exists in a development build', () => {
    vi.stubEnv('DEV', true);
    expect(h1s(render('/playground'))).toEqual(['Map playground']);
  });

  it('does not exist in a production build', () => {
    vi.stubEnv('DEV', false);
    const html = render('/playground');
    expect(h1s(html)).toEqual([]);
    expect(html).not.toContain('Map playground');
  });
});

describe('[SCR-07, SCR-C01] the legend', () => {
  const legend = (states: Parameters<typeof ProgressLegend>[0]['states']) =>
    renderToString(
      <MantineProvider>
        <ProgressLegend states={states} />
      </MantineProvider>,
    );
  const entries = (html: string) =>
    [...html.matchAll(/<li[^>]*>.*?<p[^>]*>([^<]*)<\/p><\/li>/g)].map((m) => m[1]);

  it("lists Home's states, the mastered entry's note and the complete colour", () => {
    const html = legend(['new', 'learning', 'mastered']);
    const shown = entries(html);
    expect(shown).toHaveLength(4);
    expect(shown[0]).toBe('New');
    expect(shown[1]).toBe('Learning');
    expect(shown[2]).toMatch(/^Mastered \(.*mastered\)$/);
    expect(shown.join()).not.toContain('Locked');
    for (const state of ['new', 'learning', 'mastered', 'complete'] as const) {
      expect(html).toContain(PROGRESS_COLOURS[state]);
    }
  });

  it("puts Progress's locked state first", () => {
    const shown = entries(legend(['locked', 'new', 'learning', 'mastered']));
    expect(shown).toHaveLength(5);
    expect(shown[0]).toBe('Locked');
  });

  it('has no complete entry without the mastered state', () => {
    expect(entries(legend(['new', 'learning']))).toEqual(['New', 'Learning']);
  });
});

describe('[SCR-27, SCR-28] the Credits page', () => {
  const html = render('/credits');

  it('has no link of its own back to Home: the app bar leads there', () => {
    expect(html).not.toContain('Back to Home');
    expect(html).toContain('>Geography Trainer</a>');
  });

  it('credits the place list, the boundaries and the imagery, with their links', () => {
    expect(html).toContain('href="https://maptap.gg"');
    expect(html).toContain('href="https://www.naturalearthdata.com"');
    expect(html).toContain('public domain');
    expect(html).toContain('href="https://s2maps.eu"');
    expect(html).toContain('by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)');
  });

  it('links every runtime library with its licence', () => {
    for (const c of DEPENDENCY_CREDITS) {
      expect(html).toContain(`href="${c.url}"`);
      // React marks the text boundaries with comments.
      expect(html).toContain(`${c.name}</a>, <!-- -->${c.licence}<!-- --> licence`);
    }
  });
});

describe('[GLB-36, GLB-C17] the app bar', () => {
  /** The links of the bar, each as `text` plus `*` when it is marked the current page. */
  const bar = (path: string) => {
    const nav = /<nav aria-label="Main"[^>]*>(.*?)<\/nav>/.exec(render(path))?.[1] ?? '';
    return [...nav.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map(
      (m) => `${m[2]}${m[1]!.includes('aria-current="page"') ? '*' : ''}`,
    );
  };

  it.each([
    ['/', ['Geography Trainer*', 'Progress', 'Settings']],
    ['/progress', ['Geography Trainer', 'Progress*', 'Settings']],
    ['/progress/france', ['Geography Trainer', 'Progress*', 'Settings']],
    ['/progress/france/france.bretagne', ['Geography Trainer', 'Progress*', 'Settings']],
    ['/settings', ['Geography Trainer', 'Progress', 'Settings*']],
    ['/credits', ['Geography Trainer', 'Progress', 'Settings']],
    ['/session', ['Geography Trainer', 'Progress', 'Settings']],
    ['/placement', ['Geography Trainer', 'Progress', 'Settings']],
    ['/placement/france', ['Geography Trainer', 'Progress', 'Settings']],
  ])('%s shows the three links, current as the table says', (path, links) => {
    expect(bar(path)).toEqual(links);
  });
});
