// Keys of the finished-placement markers, shared by the pages and the storage layer. Pure: no
// Dexie, so a page may import it.

/** Every marker key starts with this; setting rows use another prefix. */
export const MARKER_PREFIX = 'placement:';

/** The scope of the countries test. */
export const COUNTRIES_SCOPE = 'countries';

/** The marker key for a placement scope: `'countries'`, or a country or region item id. */
export function placementKey(scope: string): string {
  return `${MARKER_PREFIX}${scope}`;
}

const COUNTRY_PREFIX = placementKey('country:');
const REGION_PREFIX = placementKey('region:');

/** Whether the key is `placement:countries`, `placement:country:<id>` or `placement:region:<country>.<region>`. */
export function isPlacementKey(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  if (key === placementKey(COUNTRIES_SCOPE)) return true;
  if (key.startsWith(COUNTRY_PREFIX)) return key.length > COUNTRY_PREFIX.length;
  if (!key.startsWith(REGION_PREFIX)) return false;
  const [country, region, ...rest] = key.slice(REGION_PREFIX.length).split('.');
  return !!country && !!region && rest.length === 0;
}
