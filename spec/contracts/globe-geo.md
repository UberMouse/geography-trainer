# Globe: spherical maths (GLB contracts)

`src/maps/geo.ts`: the d3-geo maths that grading, the camera and the drill-down rely on. Pure:
no DOM, no MapLibre, deterministic for the same input. Coordinates are `LngLat`,
`[longitude, latitude]` in degrees.

### GLB-C01 Spherical constants
Up: GLB-22, GLB-23, GLB-24, GLB-25, GLB-26, GLB-27

| Constant | Value | Unit | Meaning |
|---|---|---|---|
| `EARTH_RADIUS_KM` | 6371 | km | the sphere every distance and size is on |
| `POINT_FEATURE_RADIUS_KM` | 2 | km | the disc radius `ensureArea` gives a feature with no valid `radiusKm` |
| `MIN_AREA_SR` | 1e-12 | steradians (about 40 m²) | below this a polygon counts as having no area |
| `MAIN_PART_GAP_KM` | 500 | km | parts closer than this (boundary to boundary) share a cluster |
| `MAIN_PART_MIN_SHARE` | 0.8 | share of area | the biggest cluster is the main part only when it holds at least this |
| `FRAME_SIZE` | 480 | px (notional) | the square `frameTest` fits a frame into |
| `FRAME_PADDING` | 16 | px (notional) | its padding; only the ratio 16/448 matters |
| `INTERIOR_GRID` | 20 | cells per side | the interior-point search grid |
| `INTERIOR_REFINES` | 3 | passes | finer grids after the first |
| `INTERIOR_BOUNDARY_VERTICES` | 250 | vertices | the boundary is thinned to about this many when scoring |
| `NEAR_BOUNDARY_TRIES` | 100 | triangles per ring | the sliver fallback's budget |

All live in `src/maps/geo.ts`.

### GLB-C02 `measureTap`
Up: GLB-22, GLB-23, GLB-24

```ts
type TapTarget =
  | { feature: AreaFeature; answer: LngLat; alsoInside?: AreaFeature[] }
  | { point: LngLat };
measureTap(target: TapTarget, tap: LngLat): {
  inside: boolean;          // in the feature or any alsoInside one (geoContains); false for a point
  kmFromAnswer: number;     // distanceKm(tap, answer or point)
  kmOutsideBorder: number;  // 0 when inside or a point; else min over the features of the km to the nearest ring edge (holes included)
  featureSizeKm: number;    // sqrt(geoArea(mainPart(feature))) · EARTH_RADIUS_KM; 0 for a point
}
```

The result is `TapInput` without `tier`, the input of the engine's `gradeTap`. The border
distance is to the nearest point of the great-circle arcs, not to the nearest vertex.

### GLB-C03 Distances and points
Up: GLB-23, GLB-28

| Function | Contract |
|---|---|
| `distanceKm(a, b)` | great-circle distance, `geoDistance(a, b) · EARTH_RADIUS_KM` |
| `targetPoint(t)` | a `TapTarget`'s point: `t.point` for a place, `t.answer` for a feature |
| `midpoint(a, b)` | the great circle's halfway point, its longitude normalised to [-180, 180] |

### GLB-C04 `mainPart`, `answerPoint`, `nearPoint`
Up: GLB-24, GLB-25

- `mainPart(f)`: the polygons are clustered (union-find, parts less than `MAIN_PART_GAP_KM`
  apart, measured vertex to vertex) and the cluster with the most area comes back as a
  MultiPolygon feature with `f`'s id and properties. `f` itself comes back when it is one
  Polygon, has one cluster, or its biggest cluster holds under `MAIN_PART_MIN_SHARE` of the area.
  Polygons with no rings (collapsed by quantization) are ignored.
- `answerPoint(f)`: `geoCentroid(mainPart(f))` when `geoContains` confirms it; else a grid search
  of the main part (`INTERIOR_GRID`, refined `INTERIOR_REFINES` times) for the candidate farthest
  from a thinned boundary that `geoContains` confirms; else the biggest polygon's; else a point
  just inside its boundary (`NEAR_BOUNDARY_TRIES`); else, unconfirmed, the centroid.
- `nearPoint(f)`: `geoCentroid(mainPart(f))`, which may lie outside `f`. For ranking by distance
  (distractors), never for tapping.

All three are cached per feature object (a `WeakMap`): the same object in gives the same result
object out.

### GLB-C05 `ensureArea`
Up: GLB-26

```ts
ensureArea<P>(feature: Feature<Geometry | null, P>): Feature<Polygon | MultiPolygon, P>
```

A Polygon or MultiPolygon with area ≥ `MIN_AREA_SR` comes back as the same object. A Point,
MultiPoint, or areal geometry with less area becomes a `geoCircle` (d3's default 6° step) around its centroid
(else its first finite coordinate) of radius `properties.radiusKm` when that is a finite number
above 0, else `POINT_FEATURE_RADIUS_KM`, keeping `id` and `properties`. Any other geometry, or one
with no finite coordinate, throws an `Error` naming the feature's id. The data loaders call it on
every country and region feature.

### GLB-C06 `frameTest`
Up: GLB-27

```ts
frameTest(frame: AreaFeature): (point: LngLat) => boolean
```

Builds once an azimuthal equal-area projection centred on the frame's centroid and fitted to
`[[FRAME_PADDING, FRAME_PADDING], [FRAME_SIZE − FRAME_PADDING, FRAME_SIZE − FRAME_PADDING]]`;
a point is on the frame when it projects to finite x and y within `[0, FRAME_SIZE]`. The answer
for a point does not depend on which other points were tested.
