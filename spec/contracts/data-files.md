# Data file contracts (DAT)

The files `npm run build:data` writes to `public/data/`, as the app's loaders
(`src/data/loaders.ts`) read them. They are committed, and served under the site's base path as
`data/<file>`.

### DAT-C14 The data directory
Up: DAT-24, DAT-27, DAT-29

```
public/data/
  places.json
  countries.topo.json
  regions/<country id>.topo.json   one per regions-tier country, none for the others
  manifest.json
  SOURCE.md
```

Nothing else is written; a build replaces the whole directory. `places.json`,
`countries.topo.json` and the region files are compact JSON (`JSON.stringify`, no spaces) with a
final newline; `manifest.json` is JSON indented by 2 spaces with a final newline.

Ids:

| Id | Shape | Example |
|---|---|---|
| place | maptap's `id`, unchanged | `a_coruna_spain` |
| country | `slugify(maptap country name)` | `cote-d-ivoire`, `georgia-country` |
| region | `<country id>.<slugify(name)>`, or `<country id>.<slug>-<slugify(adm1_code)>` when the slug is shared or empty | `ireland.galway-city`, `x.limburg-aaa-1` |

### DAT-C15 places.json
Up: DAT-19, DAT-21, DAT-27

An array of every kept place, sorted by `id` (code-unit order):

```json
{
  "id": "a_coruna_spain",
  "name": "A Coruña, Spain",
  "country": "spain",
  "region": "spain.galicia",
  "lat": 43.3667,
  "lng": -8.3833,
  "type": "city",
  "level": 4,
  "pop": 250438
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | string | maptap's id, unique |
| `name` | string | maptap's name |
| `country` | string | a country id in `countries.topo.json`; a border place's resolved country |
| `region` | string \| null | a region id in `regions/<country>.topo.json` when the country has a regions tier, else `null` |
| `lat`, `lng` | number | maptap's point, degrees, rounded to 4 decimals |
| `type` | string | maptap's type: `city`, `capital`, `state_capital`, `monument`, `ancient_monument`, `religious_site`, `mountain`, `island`, `natural_wonder`, `national_park` |
| `level` | number | maptap's `difficultyLevel`, 1–8 |
| `pop` | number, optional | maptap's `population`, present only when maptap gives one |

The keys appear in that order, and no others.

### DAT-C16 countries.topo.json
Up: DAT-06, DAT-08, DAT-21, DAT-22

A TopoJSON `Topology` (`type`, `arcs`, `transform`, `objects`) quantized at `1e5`, with one object
`countries`: a `GeometryCollection` with one geometry per kept country, sorted by `id`.

```json
{
  "type": "MultiPolygon",
  "arcs": [[[0, 1]], [[2]]],
  "id": "france",
  "properties": {
    "name": "France",
    "ne": ["ATF", "FXX", "GLP", "GUF", "MTQ", "MYT", "REU"],
    "places": 101,
    "hasRegions": true
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `type` | `Polygon` \| `MultiPolygon` \| `Point` | `Point` only for point-only countries, with quantized `coordinates` instead of `arcs` |
| `id` | string | the country id |
| `properties.name` | string | maptap's country name |
| `properties.ne` | string[] | the Natural Earth `SU_A3` codes it is made of, sorted; `[]` for a point-only country |
| `properties.places` | number | how many places in `places.json` have this country, ≥ 1 |
| `properties.hasRegions` | boolean | whether it has a regions tier, and so a region file |
| `properties.radiusKm` | number, point-only countries only | the circle's radius |

A country's geometry may have so little area after quantization that the loader treats it as
point-only too (Vatican City).

### DAT-C17 regions/&lt;country id&gt;.topo.json
Up: DAT-15, DAT-16, DAT-17, DAT-18, DAT-21

A TopoJSON `Topology` quantized at `1e5`, with one object `regions`: one `Polygon` or
`MultiPolygon` geometry per region of the country, sorted by `id`, regions with no places
included.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `<country id>.<…>`, unique across every region file |
| `properties.name` | string | the display name; distinct within the country once normalized |
| `properties.places` | number | how many places in `places.json` have this region, ≥ 0 |

The keys of `properties` are exactly `name` and `places`.

### DAT-C18 manifest.json
Up: DAT-20, DAT-23, DAT-25, DAT-28

The build's record of what it kept and why; validation reads it, the app does not.

```json
{
  "source": "https://maptap.gg/data/master_locations_v2.js",
  "naturalEarth": { "version": "v5.1.2", "files": ["ne_10m_admin_0_map_units.geojson", "…"] },
  "counts": { "total": 9462, "active": 6612, "kept": 6607, "excluded": 5 },
  "excluded": [{ "id": "…", "name": "…", "country": "Pacific Ocean", "reason": "…" }],
  "countries": { "byName": 217, "byOverride": 23, "pointOnly": 3, "excludedNames": ["Arctic Ocean", "…"] },
  "regionsTierCountries": ["afghanistan", "…"],
  "outsideTolerance": [{ "id": "…", "country": "…", "region": "… or null", "km": 13.7, "reason": "…" }],
  "droppedAdmin1": [{ "code": "NLD-5147", "name": "Saba", "country": "netherlands", "labelIn": "saba" }]
}
```

| Field | Meaning |
|---|---|
| `naturalEarth.files` | the four `NE_FILES` with `.geojson`, in the order `mapUnits`, `mapSubunits`, `admin1`, `disputedAreas` |
| `counts` | `total` entries, `active` (not disabled), `kept` (in `places.json`), `excluded`; `kept + excluded = active` |
| `excluded` | each excluded place, in id order, with its maptap country and the override's reason |
| `countries` | countries matched by name, by a `units` override, and by a `point` override; the excluded maptap names, sorted |
| `regionsTierCountries` | the ids of the countries with `hasRegions: true`, sorted |
| `outsideTolerance` | the allow-listed places beyond the containment tolerance, in place order, km to 0.1 |
| `droppedAdmin1` | admin-1 rows left out because their label point is in another country, sorted by code then country |

### DAT-C19 SOURCE.md
Up: DAT-26

Markdown, in this order:

1. `# Data source`, and a line saying it is generated by `npm run build:data` and not edited by hand.
2. A list: `Fetched:` (ISO time), `Place list:` (maptap's URL), `Boundaries: Natural Earth
   <release>, <files>`.
3. The line `Place list courtesy of MapTap.gg`, then `Boundaries: Natural Earth (public domain)`,
   then `Boundary decisions: <BOUNDARY_NOTE>.`
4. `## Counts`: `Entries`, `Active`, `Kept`, `Excluded` (with one sub-item per exclusion reason and
   its count), `Countries: <n> (by name …, by override …, point-only …)`, `Regions-tier countries`.
5. `## Excluded places`: one item per excluded place: `` `<id>` <name> (<maptap country>): <reason> ``.

### DAT-C20 The committed data's counts
Up: DAT-29

As fetched on 2026-11-25 (SOURCE.md's fetch time). A regeneration that changes them changes this
table in the same commit.

| Count | Value |
|---|---|
| maptap entries | 9462 |
| active | 6612 |
| kept (places in `places.json`) | 6607 |
| excluded | 5, all `open ocean: no country polygon` |
| countries | 243: 217 by name, 23 by override, 3 point-only |
| excluded country names | Arctic Ocean, North Atlantic, North Sea, Pacific Ocean |
| regions-tier countries (region files) | 93 |
| places with no region | 817 |
