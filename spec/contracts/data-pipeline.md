# Data pipeline contracts (DAT)

The constants, tables and module contracts of `scripts/build-data/`. The output file formats are
in `data-files.md`.

### DAT-C01 Sources, cache and time limits
Up: DAT-01, DAT-04, DAT-05

| Name | Value | Lives in |
|---|---|---|
| maptap list URL | `https://maptap.gg/data/master_locations_v2.js` | `fetch-maptap.ts` `MAPTAP_URL` |
| Place-array marker | `const masterLocationsV2 = ` (the `[` must follow it directly) | `fetch-maptap.ts` `MARKER` |
| maptap fetch limit | 60 000 ms, for the whole response | `fetch-maptap.ts` `FETCH_TIMEOUT_MS` |
| Natural Earth release | `v5.1.2` | `natural-earth.ts` `NE_VERSION` |
| Natural Earth files | `mapUnits`: `ne_10m_admin_0_map_units`, `mapSubunits`: `ne_10m_admin_0_map_subunits`, `admin1`: `ne_10m_admin_1_states_provinces`, `disputedAreas`: `ne_10m_admin_0_disputed_areas` | `natural-earth.ts` `NE_FILES` |
| Natural Earth URL | `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/<release>/geojson/<file>.geojson` | `natural-earth.ts` `naturalEarthUrl` |
| Natural Earth download limit | 120 000 ms per file | `natural-earth.ts` `DOWNLOAD_TIMEOUT_MS` |
| Cache | `<repo>/.cache/natural-earth/<release>/<file>.geojson`, gitignored; a download is written to `<file>.geojson.part` and renamed | `index.ts` `CACHE_DIR`, `natural-earth.ts` |
| Staging | `<repo>/.cache/publish-tmp-<pid>` (and `publish-old-<pid>` during the swap) | `index.ts` `STAGING_DIR`, `emit.ts` |

`fetchWithin(url, timeoutMs, read)` (`http.ts`) fetches and reads the body within the limit. A
non-2xx fails with `fetching <url>: HTTP <status>`; the limit fails with
`fetching <url>: no complete response within <s> s`.

### DAT-C02 The maptap entry
Up: DAT-02, DAT-03

maptap's array holds objects. Fields the build reads (others, such as `continent`, `difficulty`
and `prevNames`, are ignored):

| Field | Type | Required |
|---|---|---|
| `id` | string | on active entries |
| `name` | string | on active entries |
| `country` | string: maptap's country name; a `/` marks a border place | on active entries |
| `lat`, `lng` | number, degrees | on active entries |
| `type` | string | on active entries |
| `difficultyLevel` | number | on active entries |
| `population` | number | no |
| `admin` | string: maptap's region name | no |
| `disabled` | boolean; `true` drops the entry | no |

`parseMaptap(source): { total, active }`: `total` is the array's length, `active` the entries
without `disabled: true`. Optional fields are type-checked on every entry, disabled ones too.
Errors start `maptap file:` and list up to 5 examples per kind.

### DAT-C03 Names, slugs and string order
Up: DAT-06, DAT-17, DAT-27

`normalizeName(name)` (`normalize.ts`): NFD, combining marks removed, lowercased, then
`ø→o, ł→l, đ→d, ð→d, þ→th, ß→ss, æ→ae, œ→oe, ı→i`, `&` → ` and `, every run of other
non-`[a-z0-9]` characters → one space, trimmed. `"Côte d'Ivoire"` → `cote d ivoire`.

`slugify(name)`: `normalizeName` with spaces as `-`. `"Georgia (Country)"` → `georgia-country`.

`compareStrings(a, b)`: order by UTF-16 code unit (`<`), never locale. Every sort in the output
uses it.

### DAT-C04 Country overrides
Up: DAT-07, DAT-08

`overrides.ts` `OVERRIDES`, keyed by maptap's exact country name. Kinds: `units` (the union of
these Natural Earth `SU_A3` codes from the map units, or from the map subunits when marked),
`point` (a circle), `exclude` (with a reason).

| maptap name | Override |
|---|---|
| Cape Verde | units CPV |
| Georgia (Country) | units GEG, GEA |
| Midway Atoll | units MQI |
| Naoero | units NRU |
| South Georgia | units SGS |
| Turks & Caicos | units TCA |
| Türkiye | units TUR |
| US Virgin Islands | units VIR |
| Vatican City | units VAT |
| Australia | units AUS, CCK, CXR, HMD, NFK |
| China | units CHN, HKG, MAC, PFA |
| Cyprus | units CYP, CYN, CNM |
| Finland | units FIN, ALD |
| France | units FXX, ATF, GLP, GUF, MTQ, MYT, REU |
| Kazakhstan | units KAZ, KAB |
| Serbia | units SRS, SRV |
| Somalia | units SOX, SOP, SOL |
| Tanzania | units TZA, TZZ |
| United Kingdom | units GIB, WSB, ESB |
| Netherlands | units NLX |
| Bonaire | point (-68.26, 12.2), radius 20 km |
| Saba | point (-63.237, 17.633), radius 4 km |
| Sint Eustatius | point (-62.975, 17.49), radius 5 km |
| Saint Helena | subunits SHS |
| Ascension Island | subunits BAC |
| Tristan da Cunha | subunits SHT |
| Pacific Ocean, North Atlantic, North Sea, Arctic Ocean | exclude: `open ocean: no country polygon` |

Every other maptap name is matched by name, England, Scotland, Wales and Northern Ireland among
them.

### DAT-C05 Border-place aliases
Up: DAT-10

`overrides.ts` `BORDER_NAME_ALIASES`: `USA` → `United States`. A border name is any maptap
country name containing `/` (`isBorderName`).

### DAT-C06 Territory moves
Up: DAT-11, DAT-12, DAT-14

`overrides.ts` `TERRITORY_MOVES`, applied in this order:

| From | To | Territory | Region |
|---|---|---|---|
| Russia | Ukraine | admin-1 rows `RUS-283`, `RUS-5482` (Crimea, Sevastopol) | `Crimea` |
| Morocco | Western Sahara | disputed area `B19` (by `BRK_A3`) | each piece keeps its own name |

`BOUNDARY_NOTE` (`overrides.ts`): `Crimea shown as part of Ukraine and Western Sahara as a whole
territory, following maptap's place labels`, printed by the build and written to SOURCE.md.

Sliver share: a clipped piece under **0.01** of its row's planar area is a sliver
(`territory.ts` `SLIVER_SHARE`).

Moved rows get codes: one merged region is the pieces' codes joined by `+`, with the pieces' old
names joined by `|` as its alternative names; otherwise `<code>><to id>`.

### DAT-C07 Region building and the regions tier
Up: DAT-16, DAT-21

| Name | Value | Lives in |
|---|---|---|
| Dissolve by NE `region` | `france`, `england`, `scotland`, `wales`, `northern-ireland`, `italy`, `spain`, `philippines` | `assign-regions.ts` `DISSOLVE_BY_REGION` |

`hasRegionsTier(regionsWithPlaces, places)` applies both regions-tier thresholds,
`REGIONS_TIER_MIN_REGIONS` and `REGIONS_TIER_MIN_PLACES` (CUR-C01). The build counts places and
regions over the kept places and final regions.

### DAT-C08 Region-name overrides
Up: DAT-18

`overrides.ts` `REGION_NAME_OVERRIDES`, keyed by Natural Earth `adm1_code`. Each has a non-empty
`reason`. A `mislabel` override drops NE's `name`, `name_en` and `name_alt` as match names; only a
mislabel may carry `aliases` (the type forbids it otherwise).

| Code | Name | Mislabel | Aliases |
|---|---|---|---|
| IRL-713 | Galway (county) | | |
| IRL-5568 | Galway (city) | | |
| IRL-78 | Cork (county) | | |
| IRL-5569 | Cork (city) | | |
| IRL-726 | Limerick (county) | | |
| IRL-5570 | Limerick (city) | | |
| IRL-1444 | Waterford (county) | | |
| IRL-5571 | Waterford (city) | | |
| MOZ-1927 | Maputo (province) | | |
| MOZ-5854 | Maputo (city) | | |
| UZB-372 | Tashkent (region) | | |
| UZB-4828 | Tashkent (city) | | |
| AFG-1769 | Panjshir | yes | |
| AFG-1753 | Daykundi | yes | Wilayat-e Daykundi |
| HRV-1604 | Požeško-Slavonska | yes | Požega-Slavonia |
| UGA-3371 | Kiruhura | yes | Kiruhura District |
| HUN-3158 | Veszprém (county) | | |
| HUN-4909 | Veszprém (city) | | |

### DAT-C09 Containment tolerance and allow-list
Up: DAT-19, DAT-23

`containment.ts` `CONTAINMENT_TOLERANCE_KM` = **10** km. It is also how far outside the region its
`admin` names a place may lie and still get that region.

A place's distance is the larger of its km outside its country and outside its region, measured
on the emitted (simplified, quantized) geometry; a point-only country counts as a circle of its
`radiusKm`. Distances in the manifest are rounded to 0.1 km.

`overrides.ts` `CONTAINMENT_ALLOW_LIST`, place id → reason:

| Reason | Place ids |
|---|---|
| `no NE 10m land of this country at this point` | ailsa_craig_scotland, balls_pyramid_australia, bikini_atoll_marshall_islands, danger_islands_antarctica, devil, fort_jefferson_dry_tortugas_national_park_united_states, ilha_da_queimada_grande_sao_paulo_brazil, inaccessible_island_tristan_da_cunha, isla_martin_garcia_buenos_aires_argentina, krakatoa, machias_seal_island_usa_canada, maya_bay, mer_torres_strait_islands_queensland_australia, montebello_islands_western_australia_australia, nangan_matsu_islands_taiwan, nukunonu_new_zealand, perhentian_islands_malaysia, saint_martin_s_island_bangladesh, santa_cruz_del_islote_colombia, skellig_michael_ireland |
| `a feature on open water: no land at this point` | great_blue_hole, kavachi_volcano_solomon_islands, lake_pontchartrain_causeway_louisiana_usa |
| `border place resolved to the nearest country; NE 10m has no land of its own here` | navassa_island_usa_haiti |
| `on NE 10m land; the simplified outline cuts this headland or peninsula` | hel_poland |
| `on NE 10m land; the simplified outline shrinks this small island` | capri |

### DAT-C10 Simplification and quantization
Up: DAT-22

`emit.ts`, run through mapshaper:

| Name | Value |
|---|---|
| `SIMPLIFY` | `27%` of points retained, with `keep-shapes` |
| `QUANTIZATION` | `1e5` |

`toTopology(name, shapes)`: each shape's polygons are exploded into parts, simplified, dissolved
by `id`, and written as one TopoJSON object `name`; point shapes join that object as `Point`
geometries sharing its transform. Each geometry's `properties` are the shape's, verbatim. Fails
`<name>: simplification lost <ids>` when a shape comes out with no geometry.

### DAT-C11 File size limits
Up: DAT-25

| File | Limit | Lives in |
|---|---|---|
| `countries.topo.json` | 1 500 000 bytes | `validate.ts` `MAX_COUNTRIES_BYTES` |
| each `regions/<id>.topo.json` | 600 000 bytes | `validate.ts` `MAX_REGION_FILE_BYTES` |
| `places.json` | none | |

A file at the limit passes; one byte over fails.

### DAT-C12 Geometry helpers
Up: DAT-10, DAT-19, DAT-23

`geo.ts`, over GeoJSON `Polygon | MultiPolygon` in `[lng, lat]` degrees:

| Function | Contract |
|---|---|
| `haversineKm` | great-circle km on a sphere of radius 6371 km |
| `bboxOf(area)` | `[minLng, minLat, maxLng, maxLat]` of the outer rings |
| `areaContains(area, box, lng, lat)` | point-in-polygon after a box check; rings must be split at ±180° (Natural Earth's are) |
| `distanceToEdgeKm(area, lng, lat)` | km to the nearest edge of any ring, holes included; edges along ±180° are skipped; an edge crossing ±180° is measured the short way; accurate near the point, approximate far away |
| `interiorPoint(area)` | a point strictly inside, never on the outline |
| `planarArea(area)` | square degrees, holes subtracted, for comparing nearby shapes |
| `approxAreaKm2(area)` | planar area scaled at the box's middle latitude, for reports |

### DAT-C13 Pipeline stages
Up: DAT-06, DAT-10, DAT-11, DAT-15, DAT-19, DAT-24, DAT-25
Verified: typecheck — the signatures below are the modules' exported types, which tsc holds every caller to; their behaviour is the scenarios above

| Stage | Signature |
|---|---|
| read maptap | `fetchMaptap(url?): Promise<MaptapList>`, `parseMaptap(source)`, `sliceArrayLiteral(source, marker)` |
| load NE | `loadNaturalEarth(cacheDir): Promise<NaturalEarth>` (`mapUnits`, `mapSubunits`, `admin1`, `disputedAreas` by `BRK_A3`) |
| match | `matchCountries(names, mapUnits, mapSubunits, overrides): { countries, excluded }`; `resolveBorderCountry(countries, borderName, lng, lat, aliases?)` |
| territories | `applyTerritoryMoves(countries, admin1, disputedAreas, moves): { countries, admin1, slivers }` |
| regions | `applyRegionNameOverrides`, `admin1Rows(country, admin1, countries): { rows, dropped }`, `buildRegions(countryId, rows, dissolve)`, `assertNoDissolvedOverrides`, `assertOverridesReachRegions`, `assertDistinctRegionNames` |
| assign | `assignRegion(regions, lng, lat, admin): { region, how: 'admin' \| 'inside' \| 'snapped', inside, adminMatches, snappedKm? }`; `adminDisagrees(assignment, admin)`; `hasRegionsTier` |
| emit | `toTopology(name, shapes)`; `checkContainment(places, countries, regions, allowList): { outside, problems }`; `publishData(dir, stagingParent, data, validate): Promise<string[]>` |
| validate | `validateData(files, allowList?)`, `readDataDir(dir)`, `validateDataDir(dir, allowList?)`: one line per problem, empty when consistent |

Every stage throws (or returns problems) rather than writing partial data; `index.ts` runs them
in this order and exits 1 on any failure.
