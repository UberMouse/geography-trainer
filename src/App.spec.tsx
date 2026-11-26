import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

// MapLibre needs a browser: the shell renders without the map (e2e covers the globe).
vi.mock('./maps/Globe', () => ({ default: () => <div data-testid="globe-stub" /> }));

/** A level-one heading's text as rendered (Mantine's `Title` gives it attributes). */
const h1 = (text: string) => new RegExp(`<h1[^>]*>${text}</h1>`);

function render(path: string) {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App', () => {
  it('[GLB-33] renders the heading and both credit lines', () => {
    const html = render('/');
    expect(html).toMatch(h1('Geography Trainer'));
    expect(html).toContain('Place list courtesy of');
    expect(html).toContain('href="https://maptap.gg"');
    expect(html).toContain('Boundaries:');
    expect(html).toContain('href="https://www.naturalearthdata.com"');
  });

  it('[GLB-01, GLB-33] renders the page and footer in the column, beside the one globe', () => {
    const html = render('/');
    expect(html.match(/data-testid="globe-stub"/g)).toHaveLength(1);
    const column = html.indexOf('data-testid="column"');
    expect(column).toBeGreaterThan(-1);
    expect(html.search(h1('Geography Trainer'))).toBeGreaterThan(column);
    expect(html.indexOf('Place list courtesy of')).toBeGreaterThan(column);
  });

  it('[GLB-32] renders the Progress page heading', () => {
    expect(render('/progress')).toMatch(h1('Progress'));
  });

  it('[GLB-32] renders the Credits page', () => {
    const html = render('/credits');
    expect(html).toMatch(h1('Credits'));
    expect(html).toContain('MapTap.gg');
    expect(html).toContain('Natural Earth');
    expect(html).toContain('Sentinel-2 cloudless – <a');
    expect(html).toContain(
      'by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)',
    );
  });

  it('[GLB-32] renders the Settings page heading', () => {
    expect(render('/settings')).toMatch(h1('Settings'));
  });

  it('[GLB-32] renders the Placement page (loading first)', () => {
    expect(render('/placement')).toContain('Loading…');
  });

  it('[GLB-32] renders the test-out routes (loading first)', () => {
    expect(render('/placement/france')).toContain('Loading…');
    expect(render('/placement/france/france.bretagne')).toContain('Loading…');
  });
});
