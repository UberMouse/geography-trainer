// How far each place lies outside its country and region, measured on the emitted (simplified)
// TopoJSON. A place beyond the tolerance needs a reasoned allow-list entry.
import type { Geometry } from 'geojson';
import { feature } from 'topojson-client';
import type { PlaceOut, Topology } from './emit';
import { areaContains, bboxOf, distanceToEdgeKm, haversineKm } from './geo';

export const CONTAINMENT_TOLERANCE_KM = 10;

export interface OutsidePlace {
  id: string;
  country: string;
  region: string | null;
  /** km outside the country or the region, whichever is further. */
  km: number;
  reason: string;
}

/** km from the point to the geometry, 0 inside it (a Point with `radiusKm` is a circle). */
function kmOutside(
  geometry: Geometry,
  radiusKm: number | undefined,
  lng: number,
  lat: number,
): number {
  if (geometry.type === 'Point') {
    const [pLng, pLat] = geometry.coordinates;
    return Math.max(0, haversineKm(lng, lat, pLng!, pLat!) - (radiusKm ?? 0));
  }
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return Infinity;
  return areaContains(geometry, bboxOf(geometry), lng, lat)
    ? 0
    : distanceToEdgeKm(geometry, lng, lat);
}

type DecodedFeature = { geometry: Geometry | null; properties: Record<string, unknown> | null };

function featuresById(topology: Topology, object: string): Map<string, DecodedFeature> {
  const decoded = feature(
    topology as unknown as Parameters<typeof feature>[0],
    (topology.objects[object] ?? { type: 'GeometryCollection', geometries: [] }) as never,
  ) as unknown as { features: Array<DecodedFeature & { id?: string | number }> };
  return new Map(decoded.features.map((f) => [String(f.id), f]));
}

/**
 * The places beyond the tolerance (each with its allow-list reason), and a problem for every one
 * not allow-listed, every allow-list entry without a reason, and every stale entry.
 */
export function checkContainment(
  places: PlaceOut[],
  countries: Topology,
  regions: Record<string, Topology>,
  allowList: Record<string, string>,
): { outside: OutsidePlace[]; problems: string[] } {
  const countryFeatures = featuresById(countries, 'countries');
  const regionFeatures = new Map<string, DecodedFeature>();
  for (const topology of Object.values(regions)) {
    for (const [id, f] of featuresById(topology, 'regions')) regionFeatures.set(id, f);
  }

  const outside: OutsidePlace[] = [];
  const problems: string[] = [];
  const beyond = new Set<string>();
  for (const place of places) {
    // A country or region with no geometry is the id checks' problem, not a distance.
    const country = countryFeatures.get(place.country);
    if (!country?.geometry) continue;
    const radiusKm = country.properties?.radiusKm;
    const countryKm = kmOutside(
      country.geometry,
      typeof radiusKm === 'number' ? radiusKm : undefined,
      place.lng,
      place.lat,
    );
    const region = place.region ? regionFeatures.get(place.region)?.geometry : undefined;
    const regionKm = region ? kmOutside(region, undefined, place.lng, place.lat) : 0;
    const km = Math.max(countryKm, regionKm);
    if (km <= CONTAINMENT_TOLERANCE_KM) continue;

    beyond.add(place.id);
    const where = `${place.country}${place.region ? ` / ${place.region}` : ''}`;
    const reason = allowList[place.id];
    if (reason === undefined) {
      problems.push(
        `place ${place.id} lies ${km.toFixed(1)} km outside ${where} and is not on the containment allow-list`,
      );
    } else {
      outside.push({
        id: place.id,
        country: place.country,
        region: place.region,
        km: Math.round(km * 10) / 10,
        reason,
      });
    }
  }

  for (const [id, reason] of Object.entries(allowList)) {
    if (!reason.trim()) problems.push(`containment allow-list entry ${id} has no reason`);
    if (!beyond.has(id)) {
      problems.push(
        `containment allow-list entry ${id} is stale: no place with that id lies beyond ${CONTAINMENT_TOLERANCE_KM} km`,
      );
    }
  }
  return { outside, problems };
}
