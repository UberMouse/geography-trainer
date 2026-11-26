import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

// MapLibre needs a browser: the shell renders without the map (e2e covers the globe).
vi.mock('./maps/Globe', () => ({ default: () => <div data-testid="globe-stub" /> }));

function render(path: string) {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App', () => {
  it('renders the heading and both credit lines', () => {
    const html = render('/');
    expect(html).toContain('<h1>Geography Trainer</h1>');
    expect(html).toContain('Place list courtesy of');
    expect(html).toContain('href="https://maptap.gg"');
    expect(html).toContain('Boundaries:');
    expect(html).toContain('href="https://www.naturalearthdata.com"');
  });

  it('renders the page and footer in the column, beside the one globe', () => {
    const html = render('/');
    expect(html.match(/data-testid="globe-stub"/g)).toHaveLength(1);
    const column = html.indexOf('data-testid="column"');
    expect(column).toBeGreaterThan(-1);
    expect(html.indexOf('<h1>Geography Trainer</h1>')).toBeGreaterThan(column);
    expect(html.indexOf('Place list courtesy of')).toBeGreaterThan(column);
  });

  it('renders the Progress page heading', () => {
    expect(render('/progress')).toContain('<h1>Progress</h1>');
  });

  it('renders the Credits page', () => {
    const html = render('/credits');
    expect(html).toContain('<h1>Credits</h1>');
    expect(html).toContain('MapTap.gg');
    expect(html).toContain('Natural Earth');
  });

  it('renders the Settings page heading', () => {
    expect(render('/settings')).toContain('<h1>Settings</h1>');
  });

  it('renders the Placement page (loading first)', () => {
    expect(render('/placement')).toContain('Loading…');
  });

  it('renders the test-out routes (loading first)', () => {
    expect(render('/placement/france')).toContain('Loading…');
    expect(render('/placement/france/france.bretagne')).toContain('Loading…');
  });
});
