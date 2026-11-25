import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import App from './App';

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

  it('renders the Progress page heading', () => {
    expect(render('/progress')).toContain('<h1>Progress</h1>');
  });

  it('renders the Placement page (loading first)', () => {
    expect(render('/placement')).toContain('Loading…');
  });

  it('renders the test-out routes (loading first)', () => {
    expect(render('/placement/france')).toContain('Loading…');
    expect(render('/placement/france/france.bretagne')).toContain('Loading…');
  });
});
