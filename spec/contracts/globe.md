# Globe: the map, its layers, the camera and the shell (GLB contracts)

`src/maps/` holds the MapLibre globe (`Globe.tsx`, `GlobeProvider.tsx`, `globeContext.ts`) and
its pure parts (`globeLayers.ts`, `globeOptions.ts`, `camera.ts`), which only take types from
MapLibre and run in Node. The app shell is `src/App.tsx`, `src/main.tsx`,
`src/components/GlobeLayout.tsx` and `src/components/Footer.tsx`.

### GLB-C07 The imagery style
Up: GLB-02, GLB-03

`imageryStyle()` in `src/maps/globeLayers.ts`: a MapLibre v8 style with no glyphs, no sprite
and one source.

| Part | Value |
|---|---|
| `projection` | `{ type: 'globe' }` |
| source `imagery` | raster, `tileSize` 256, `maxzoom` 14 |
| tiles (`EOX_TILES`) | `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg` |
| attribution (`EOX_ATTRIBUTION`) | `Sentinel-2 cloudless – <a href="https://s2maps.eu">https://s2maps.eu</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)` |
| layers | `sphere` (background, `SPHERE_COLOUR` `#0b2545`), then `imagery` (raster) |
| `sky` | `{ 'atmosphere-blend': 0 }` |
| space behind the globe (`SPACE_COLOUR`) | `#05070d`, the globe element's background |

### GLB-C08 The map's options
Up: GLB-04, GLB-16, GLB-17, GLB-03

`mapOptions(zoom)` in `src/maps/globeOptions.ts`, which `Globe.tsx` spreads into
`new maplibregl.Map` with the container and a pixel ratio of `min(devicePixelRatio,
MAX_PIXEL_RATIO)`, followed when the screen's ratio changes.

| Option or constant | Value |
|---|---|
| `center` (`START`) | `[0, 20]` |
| `zoom`, `minZoom` | the fitted zoom of the container (GLB-C14) |
| `maxZoom` | `MAX_ZOOM` (GLB-C14) |
| `maxPitch` | 0 |
| `dragRotate`, `pitchWithRotate`, `touchPitch` | false (touch and keyboard rotation are disabled after creation too) |
| `doubleClickZoom` | false |
| `attributionControl` | false: the globe adds an `AttributionControl`, `compact` below `WIDE_SCREEN` and collapsed to its button there |
| `MAX_PIXEL_RATIO` | 2 |
| `WIDE_SCREEN` | `(min-width: 48em)` (768px) |

### GLB-C09 Globe modes and their layers
Up: GLB-09, GLB-10, GLB-11, GLB-18

```ts
type GlobeMode =
  | { kind: 'bare' }
  | { kind: 'countryBorders'; countries: CountryFeature[] }
  | { kind: 'regionBorders'; country: CountryFeature; regions?: RegionFeature[] }
  | { kind: 'highlight'; target:
      | { kind: 'country'; feature: CountryFeature; countries: CountryFeature[] }
      | { kind: 'region'; feature: RegionFeature; country: CountryFeature; regions: RegionFeature[] }
      | { kind: 'place'; place: Place; country: CountryFeature; regions?: RegionFeature[] } }
  | { kind: 'progress'; features: IdentifiedFeature[]; fills: Record<string, string>;
      dots?: { id: string; at: LngLat; colour: string }[] };
modeLayers(mode: GlobeMode): { sources: Record<string, GeoJsonSource>; layers: GlobeLayer[] }
```

Every source and layer id starts with `OUR_PREFIX` `gt-`; every layer reads only its own set's
sources. Layers, bottom to top:

| Mode | Layers |
|---|---|
| bare | none |
| countryBorders | `gt-country-borders` |
| regionBorders | `gt-region-borders` (only with `regions`), `gt-country-outline` |
| highlight country | `gt-country-borders`, `gt-highlight-fill`, `gt-highlight-line` |
| highlight region | `gt-region-borders`, `gt-country-outline`, `gt-highlight-fill`, `gt-highlight-line` |
| highlight place | `gt-region-borders` (only with `regions`), `gt-country-outline`, `gt-highlight-dot` |
| progress | `gt-progress-fill` (filter `['has', 'fill']`, colour from each feature's `fill` property), `gt-progress-borders`, `gt-progress-dots` (`PROGRESS_DOTS_LAYER`, only with dots; each dot's `id` and `colour` are properties) |

Paint:

| Layer | Type | Colour | Width / radius | Opacity |
|---|---|---|---|---|
| `gt-country-borders`, `gt-progress-borders` | line | `#ffffff` | 1 | 0.85 |
| `gt-country-outline` | line | `#ffffff` | 1.5 | 0.85 |
| `gt-region-borders` | line | `#ffd43b` | 1 | 0.85 |
| `gt-highlight-fill` | fill | `#ffd43b` | | 0.35 |
| `gt-highlight-line` | line | `#ffd43b` | 2 | 0.85 |
| `gt-highlight-dot` | circle | `#ff922b` | `PROGRESS_DOT_RADIUS` 6, white stroke 2 | |
| `gt-progress-fill` | fill | each feature's `fill` | | 0.55 |
| `gt-progress-dots` | circle | each dot's `colour` | `PROGRESS_DOT_RADIUS` 6, white stroke 2 | |

Line layers draw `borderLines(features)`: each ring split at its cut edges, an edge with both ends
at longitude ±180 or both at latitude −90, which the data holds exactly. Fill layers keep the
polygons. `borderLines` and each source are memoised per array, so the same features give the
same data object and the globe skips `setData`. A mode's set replaces the previous one's in place,
below the reveal's first layer.

### GLB-C10 The reveal and markers
Up: GLB-12

```ts
interface Reveal {
  target: { kind: 'area'; feature: AreaFeature } | { kind: 'point'; at: LngLat };
  tap?: { at: LngLat; answer: LngLat };   // absent for a multiple-choice answer
}
type GlobeMarker = { kind: 'pin'; at: LngLat } | { kind: 'name'; at: LngLat; text: string };
```

| Part | Value |
|---|---|
| `gt-reveal-target-line` (area) | line `#40c057`, width 2.5, opacity 0.85 |
| `gt-reveal-target-dot` (point) | circle `#40c057`, radius 6, white stroke 2 |
| `gt-reveal-path` (with `tap`) | line `#ffffff`, width 2, dash `[2, 1]`, along `greatCircle(tap.at, tap.answer)` |
| tap pin (`REVEAL_TAP_PIN`) | `#fa5252`, `opacityWhenCovered` `'0'` |
| answer pin (`REVEAL_ANSWER_PIN`) | `#40c057`, `opacityWhenCovered` `'0'` |
| name marker | an HTML label anchored at its top, offset `NAME_MARKER_OFFSET` `[0, 6]` px |
| pin marker | MapLibre's default pin, `pointer-events: none` so a tap on it reaches the globe |

`greatCircle(a, b)` returns `max(1, ceil(degrees apart))` + 1 points with the ends exactly `a` and
`b`, its longitudes unwrapped so consecutive points never differ by more than 180°. The pin
colours live in `src/maps/globeOptions.ts`, the layers in `src/maps/globeLayers.ts`.

### GLB-C11 Taps and progress selection
Up: GLB-14, GLB-15, GLB-18

The globe listens to MapLibre's `click` (which a drag or pinch does not fire):

1. A click whose target is inside a `.maplibregl-marker` is ignored.
2. A click whose point, unprojected and projected back, moves more than `OFF_GLOBE_PX` is off the
   sphere and ignored.
3. The point is wrapped to [-180, 180]. In progress mode the selection is the nearest dot within
   `DOT_DRAWN_PX` of the click, else `featureAt(features, point)` (the first feature
   `geoContains` holds it), else the nearest dot within `DOT_SLACK_PX`, and `onSelect(id)` gets it;
   `onTap` is never called. In every other mode `onTap(point)` gets it.

| Constant (`src/maps/globeOptions.ts`) | Value |
|---|---|
| `OFF_GLOBE_PX` | 2 CSS px |
| `DOT_DRAWN_PX` | `PROGRESS_DOT_RADIUS` + 2 = 8 CSS px |
| `DOT_SLACK_PX` | `PROGRESS_DOT_RADIUS` + 8 = 14 CSS px |

### GLB-C12 `useGlobe` and the provider
Up: GLB-01, GLB-13, GLB-21

```ts
interface GlobeSettings {
  mode?: GlobeMode; reveal?: Reveal | null; markers?: GlobeMarker[];
  onTap?: (at: LngLat) => void; onSelect?: (id: string) => void;
}
useGlobe(settings?: GlobeSettings): GlobeCamera
moveCamera(camera: GlobeCamera, move: CameraMove): void
```

- `GlobeProvider` wraps the app; `SharedGlobe` renders the one `Globe` inside `GlobeLayout`.
  `useGlobe` outside a provider throws.
- A caller with `settings` shows them while it is mounted; the latest caller to show wins. On its
  unmount its settings are cleared together (only if they are still the ones shown), leaving the
  bare globe with no reveal, markers or handlers. Without `settings`, a caller only gets the camera.
- `mode`, `reveal` and `markers` are compared by identity: callers memoise them. Handlers may be new
  each render; the latest one is called.
- The camera's calls do nothing while there is no map (no WebGL). A call before the style has
  loaded is held, the last one only, and runs right after the opening jump; `stop` drops a held call.

### GLB-C13 Camera moves
Up: GLB-20, GLB-21

```ts
type CameraMove =
  | { kind: 'fit'; feature: AreaFeature }                          // fitBounds(featureBounds(f), padding FIT_PADDING)
  | { kind: 'span'; at: LngLat; km: number }                       // flyTo(at, spanZoom(km, shorter side, lat))
  | { kind: 'pair'; a: LngLat; b: LngLat; feature?: AreaFeature }  // fitBounds(pairBounds ∪ featureBounds, padding REVEAL_PADDING, maxZoom spanZoom(NEIGHBOURHOOD_VIEW_KM, …))
  | { kind: 'world'; at?: LngLat }                                 // flyTo(at ?? START, minZoom + latAllowance(lat))
  | { kind: 'stay' };                                              // stop()
```

| Function (`src/maps/camera.ts`, `globeLayers.ts`) | Contract |
|---|---|
| `spanZoom(km, sizePx, lat)` | `log2(sizePx · 2π · EARTH_RADIUS_KM · max(MIN_COS_LAT, cos lat) / (TILE_PX · km))`, capped at `MAX_ZOOM`; `MAX_ZOOM` for a span or size that is not a positive finite number |
| `pairBounds(a, b)` | `[[west, south], [east, north]]` of two points, the shorter way in longitude; across 180° east is above 180 |
| `unionBounds(a, b)` | the narrowest box holding both, `b` tried shifted by 0 and ±360° |
| `featureBounds(f)` | `geoBounds(mainPart(f))`, east raised by 360 when it is below west |

| Constant | Value | Lives in |
|---|---|---|
| `NEIGHBOURHOOD_VIEW_KM` | 600 km | `src/maps/camera.ts` |
| `TILE_PX` | 512 CSS px around the world at zoom 0 | `src/maps/camera.ts` |
| `MIN_COS_LAT` | 0.01 (about 89.4°) | `src/maps/camera.ts` |
| `FIT_PADDING` | 40 CSS px | `src/maps/globeOptions.ts` |
| `REVEAL_PADDING` | 72 CSS px | `src/maps/globeOptions.ts` |

### GLB-C14 The fitted zoom
Up: GLB-04, GLB-31

`fittedZoom(width, height)` in `src/maps/globeLayers.ts` is the zoom at the equator at which the
sphere's outline, seen by MapLibre's perspective camera, fits the container with a 5% margin
each side: with `v = 0.9 · min(w, h) / 2` and `d = h / 2 / tan(FOV_DEG / 2)`, the radius
`R = (v² + v · √(v² + d²)) / d` and the zoom `log2(2πR / 512)`, clamped to
`[LOWEST_ZOOM, MAX_ZOOM]`. A container with no size, or a non-finite one, gets `LOWEST_ZOOM`.

The globe sets `minZoom` to it at creation, when the style loads and on every resize (skipped
while hidden), and opens at `minZoom + latAllowance(START lat)`. A view within `FITTED_EPSILON`
of the old fit follows the new one; a moving camera finishes first.

| Constant | Value | Lives in |
|---|---|---|
| `LOWEST_ZOOM` | −2 | `src/maps/globeLayers.ts` |
| `FOV_DEG` | `atan(0.75)` in degrees, about 36.87 (MapLibre's default) | `src/maps/globeLayers.ts` |
| `MAX_ZOOM` | 14 | `src/maps/globeLayers.ts` |
| `FITTED_EPSILON` | 0.01 zoom | `src/maps/globeOptions.ts` |
| `latAllowance(lat)` | `log2(cos lat)` (−1 at 60°) | `src/maps/globeOptions.ts` |

### GLB-C15 The test-only globe hook
Up: GLB-01, GLB-09, GLB-12, GLB-18

Dev builds only (`import.meta.env.DEV`), set when the style loads and deleted on unmount:

```ts
window.__globe: {
  project(at: LngLat): { x: number; y: number };   // viewport CSS px
  center(): LngLat;
  zoom(): number;
  minZoom(): number;
  jumpTo(at: LngLat, zoom: number): void;          // stops any flight
  layerIds(): string[];                            // our gt- layers, bottom to top
  instanceId(): number;                            // one number per map created
  markers(): { kind: 'pin' | 'name' | 'reveal'; text: string; lngLat: LngLat }[];  // in the order added
  progress(): { fills: Record<string, string>; dots: ProgressDot[] } | null;      // null outside progress mode
}
```

Also dev-only: the map's container carries `data-mode` (the mode's `kind`) and, once the camera has
settled after the opening jump and the map has first gone idle, `data-ready="true"`. `e2e/globeHook.ts`
wraps these for the specs.

### GLB-C16 Layout
Up: GLB-29, GLB-30, GLB-31, GLB-35

`src/components/GlobeLayout.module.css` and `src/App.tsx`:

| Rule | Value |
|---|---|
| wide-screen breakpoint | `min-width: 48em` (768px, Mantine's `sm`) |
| wide: column | 320px wide, on the left, full height, a right border |
| phone: order | globe on top (`flex-direction: column-reverse`), column below |
| phone: column | at most 50dvh, scrolls inside itself |
| phone: globe | at least 50dvh |
| column padding (the gutter) | 16px |
| root | fixed to the viewport, 100dvh, `overflow: hidden` |
| pages that hide the globe at phone width (`NO_PHONE_GLOBE`) | `/settings`, `/credits`; the globe stays mounted with `display: none` |
| colour scheme | Mantine, forced dark |

The router's basename is `import.meta.env.BASE_URL` without its trailing slash (`/` stays `/`),
in `src/main.tsx`.
