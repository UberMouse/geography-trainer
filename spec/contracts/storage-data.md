# Data loading contracts (STO)

How the app loads the generated files in `public/data/` (their formats are the data pipeline's
contracts).

### STO-C10 Data file paths
Up: STO-17, STO-18

Every path is fetched as `dataUrl(path)` = `import.meta.env.BASE_URL + path` (`src/data/fetchJson.ts`),
so the site works from a sub-path.

| Loader (`src/data/loaders.ts`) | File | Topology object | Returns |
|---|---|---|---|
| `loadCountries()` | `data/countries.topo.json` | `countries` | `{ features: CountryFeature[], countries: Country[] }` |
| `loadPlaces()` | `data/places.json` | – | `Place[]` as stored |
| `loadRegions(countryId)` | `data/regions/<countryId>.topo.json` | `regions` | `{ features: RegionFeature[], regions: Region[] }` |

- A country's `id` is the feature id; `Country` is `{ id, name, places, hasRegions }` from its properties.
- A region's `id` is the feature id (`<country>.<region>`); `Region` is `{ id, name, country: countryId, places }`.
- `loadRegions` first loads the countries; it throws `Unknown country "<id>"` or
  `Country "<id>" has no regions tier` before fetching anything else.
- Each feature goes through `ensureArea` (globe contracts). A country whose feature it replaced
  gets `properties.pointOnly = true`; the others have no `pointOnly` key. Regions are not marked.

### STO-C11 The fetch cache
Up: STO-17, STO-19

`src/data/fetchJson.ts`, one module-wide cache for the page's lifetime.

| Function | Contract |
|---|---|
| `once(key, load)` | runs `load` once per key and returns the same promise to every caller; a rejected promise is dropped from the cache, so the next call runs `load` again |
| `fetchJsonOnce<T>(url)` | `once(url, …)`: `fetch(url)`, then `res.json()`; on a non-OK response rejects with `Failed to load <url>: HTTP <status>` |
| `clearDataCache()` | empties the cache (for specs) |

The loaders cache their built result too: `once('countries', …)` and `once('regions:<countryId>', …)`.
