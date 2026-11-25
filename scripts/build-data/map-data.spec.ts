import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { geoArea } from 'd3-geo';
import { loadCountries, loadRegions } from '../../src/data/loaders';
import { answerPoint, measureTap, type AreaFeature, type LngLat } from '../../src/maps/geo';

const dir = new URL('../../public/data/', import.meta.url);

// Serve the committed files to the loaders, as the browser would fetch them.
beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    try {
      const body = readFileSync(new URL(url.replace(/^\/data\//, ''), dir), 'utf8');
      return new Response(body, { status: 200 });
    } catch {
      return new Response('', { status: 404 });
    }
  });
});

describe('committed map data, as the loaders return it', () => {
  it(
    'has no feature that covers more than a hemisphere (d3 winding)',
    { timeout: 120_000 },
    async () => {
      const { features, countries } = await loadCountries();
      const all: { id: string | number | undefined; f: AreaFeature }[] = features.map((f) => ({
        id: f.id,
        f,
      }));
      for (const c of countries.filter((x) => x.hasRegions)) {
        for (const f of (await loadRegions(c.id)).features) all.push({ id: f.id, f });
      }
      expect(all.length).toBeGreaterThan(2000);
      const inverted = all.filter(({ f }) => geoArea(f) >= 2 * Math.PI).map(({ id }) => id);
      expect(inverted).toEqual([]);
    },
  );

  it('measures taps against France', async () => {
    const { features } = await loadCountries();
    const france = features.find((f) => f.id === 'france')!;
    const target = { feature: france, answer: answerPoint(france) };
    expect(measureTap(target, [2.3522, 48.8566]).inside).toBe(true);
    // 100 km due west of Brest would be only about 55 km from Ouessant (Ushant), which is part of
    // France, so measure from Ouessant's westernmost point instead (about 5.15 W, 48.46 N).
    const ushant: LngLat = [-5.15, 48.46];
    const west: LngLat = [
      ushant[0] - 100 / (111.19 * Math.cos((ushant[1] * Math.PI) / 180)),
      ushant[1],
    ];
    const m = measureTap(target, west);
    expect(m.inside).toBe(false);
    expect(m.kmOutsideBorder).toBeGreaterThan(70);
    expect(m.kmOutsideBorder).toBeLessThan(130);
  });
});
