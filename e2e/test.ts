import { fileURLToPath } from 'node:url';
import { test as base } from '@playwright/test';

export { expect, type Locator, type Page } from '@playwright/test';

export const EOX_ROUTE = 'https://tiles.maps.eox.at/**';
const FIXTURE_TILE = fileURLToPath(new URL('./fixtures/eox-tile.jpg', import.meta.url));

/**
 * Playwright's `test`, with every request to EOX answered by the local fixture tile: the app
 * shell shows the globe on every page, and no test touches EOX. `eoxRequests` lists the tile URLs
 * the page asked for.
 */
export const test = base.extend<{ eoxRequests: string[] }>({
  eoxRequests: [
    async ({ page }, use) => {
      const requests: string[] = [];
      await page.route(EOX_ROUTE, (route) => {
        requests.push(route.request().url());
        return route.fulfill({ path: FIXTURE_TILE, contentType: 'image/jpeg' });
      });
      await use(requests);
    },
    { auto: true },
  ],
});
