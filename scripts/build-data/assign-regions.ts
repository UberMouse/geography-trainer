// Builds a country's regions from NE admin-1 rows and assigns places to them.
import { REGIONS_TIER_MIN_PLACES, REGIONS_TIER_MIN_REGIONS } from '../../src/engine/config';
import { CONTAINMENT_TOLERANCE_KM } from './containment';
import type { MatchedCountry } from './country-match';
import { type BBox, areaContains, bboxOf, distanceToEdgeKm, haversineKm } from './geo';
import type { NeAdmin1 } from './natural-earth';
import { compareStrings, normalizeName, slugify } from './normalize';

/**
 * maptap countries whose admin-1 rows are dissolved by NE's `region` field (French régions,
 * English regions, Italian regions, Spanish communities, Philippine regions).
 */
export const DISSOLVE_BY_REGION = new Set([
  'france',
  'england',
  'scotland',
  'wales',
  'northern-ireland',
  'italy',
  'spain',
  'philippines',
]);

export interface RegionUnit {
  row: NeAdmin1;
  box: BBox;
}

export interface Region {
  id: string;
  name: string;
  /** The admin-1 rows it is made of (one, unless dissolved). */
  units: RegionUnit[];
}

function insideCountry(country: MatchedCountry, [lng, lat]: [number, number]): boolean {
  if (country.point) {
    return haversineKm(lng, lat, country.point.lng, country.point.lat) <= country.point.radiusKm;
  }
  return areaContains(country.area!, country.box!, lng, lat);
}

/** An admin-1 row of a country's ADM0_A3 dropped because its label point is in another country. */
export interface DroppedRow {
  code: string;
  name: string;
  country: string;
  /** The country whose geometry contains the row's label point. */
  labelIn: string;
}

/**
 * The admin-1 rows of `country`: rows of its ADM0_A3, minus rows whose GU_A3 is another kept
 * country's geounit and not its own (England's rows are not Scotland's, Tokelau's not New
 * Zealand's), minus rows whose label point lies in another kept country (Caribbean Netherlands
 * rows are NLD/NLD but belong to Bonaire, Saba and Sint Eustatius), which are returned as
 * `dropped` so the build can report them.
 */
export function admin1Rows(
  country: MatchedCountry,
  admin1: NeAdmin1[],
  countries: MatchedCountry[],
): { rows: NeAdmin1[]; dropped: DroppedRow[] } {
  const others = countries.filter((other) => other.id !== country.id);
  const othersGeounits = new Set(others.flatMap((other) => other.guA3));
  const rows: NeAdmin1[] = [];
  const dropped: DroppedRow[] = [];
  for (const row of admin1) {
    if (!country.adm0.includes(row.adm0)) continue;
    if (row.guA3 && othersGeounits.has(row.guA3) && !country.guA3.includes(row.guA3)) continue;
    const labelIn = others.find((other) => insideCountry(other, row.label));
    if (labelIn) {
      dropped.push({ code: row.code, name: row.name, country: country.id, labelIn: labelIn.id });
    } else {
      rows.push(row);
    }
  }
  return { rows, dropped };
}

/**
 * Applies region-name overrides (by NE code) to admin-1 rows: the row's `name` becomes the
 * override and NE's own name moves to `neName`. An override naming no row throws, so a stale one
 * cannot go unnoticed.
 */
export function applyRegionNameOverrides(
  admin1: NeAdmin1[],
  overrides: Record<string, { name: string; reason: string }>,
): NeAdmin1[] {
  const codes = new Set(admin1.map((row) => row.code));
  const stale = Object.keys(overrides).filter((code) => !codes.has(code));
  if (stale.length > 0) {
    throw new Error(`region name overrides for codes not in NE admin-1: ${stale.join(', ')}`);
  }
  return admin1.map((row) => {
    const override = overrides[row.code];
    return override ? { ...row, name: override.name, neName: row.name } : row;
  });
}

/** Throws when two regions of a country share a display name, naming the country and rows. */
export function assertDistinctRegionNames(countryId: string, regions: Region[]): void {
  const byName = new Map<string, Region[]>();
  for (const region of regions) {
    const key = normalizeName(region.name);
    byName.set(key, [...(byName.get(key) ?? []), region]);
  }
  const clashes = [...byName.values()].filter((same) => same.length > 1);
  if (clashes.length > 0) {
    const lines = clashes.map(
      (same) =>
        `"${same[0]!.name}": ${same.map((r) => `${r.id} (${r.units.map((u) => u.row.code).join('+')})`).join(', ')}`,
    );
    throw new Error(`${countryId} has regions with the same name: ${lines.join('; ')}`);
  }
}

/**
 * Groups admin-1 rows into regions with unique ids. When dissolving, rows sharing a `region`
 * become one region named after it; a row NE gives no `region` (France's southern lands) stays a
 * region of its own.
 */
export function buildRegions(countryId: string, rows: NeAdmin1[], dissolve: boolean): Region[] {
  const groups = new Map<string, { name: string; rows: NeAdmin1[] }>();
  for (const row of rows) {
    const byRegion = dissolve && row.region !== null;
    const key = byRegion ? `region:${row.region}` : `row:${row.code}`;
    const group = groups.get(key) ?? { name: byRegion ? row.region! : row.name, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  const named = [...groups.values()].map(({ name, rows: group }) => ({
    name,
    code: group[0]!.code,
    group,
  }));
  const slugCounts = new Map<string, number>();
  for (const { name } of named)
    slugCounts.set(slugify(name), (slugCounts.get(slugify(name)) ?? 0) + 1);

  return named
    .map(({ name, code, group }) => {
      const slug = slugify(name);
      // Two admin-1 rows with the same name (or a name with no Latin letters) keep their NE code.
      const unique =
        slug && slugCounts.get(slug) === 1 ? slug : [slug, slugify(code)].filter(Boolean).join('-');
      return {
        id: `${countryId}.${unique}`,
        name,
        units: group
          .sort((a, b) => compareStrings(a.code, b.code))
          .map((row) => ({ row, box: bboxOf(row.geometry) })),
      };
    })
    .sort((a, b) => compareStrings(a.id, b.id));
}

export interface Assignment {
  region: Region;
  how: 'admin' | 'inside' | 'snapped';
  /** The region containing the point, if any. */
  inside: Region | null;
  /** The regions maptap's `admin` names, when it has one. */
  adminMatches: Region[];
  /** Distance to the snapped region's edge. */
  snappedKm?: number;
}

function namesOf(region: Region): string[] {
  const names = [region.name];
  for (const { row } of region.units) {
    names.push(row.name);
    if (row.neName) names.push(row.neName);
    if (row.nameEn) names.push(row.nameEn);
    if (row.nameAlt) names.push(...row.nameAlt.split('|'));
  }
  return names.map(normalizeName);
}

function kmOutsideRegion(region: Region, lng: number, lat: number): number {
  let km = Infinity;
  for (const u of region.units) {
    if (areaContains(u.row.geometry, u.box, lng, lat)) return 0;
    km = Math.min(km, distanceToEdgeKm(u.row.geometry, lng, lat));
  }
  return km;
}

/**
 * The region for a place: the one maptap's `admin` names (by region name or by one of its
 * admin-1 rows' name, name_en or name_alt) when the point lies within CONTAINMENT_TOLERANCE_KM
 * of it, else the one containing the point, else the one with the nearest edge.
 */
export function assignRegion(
  regions: Region[],
  lng: number,
  lat: number,
  admin: string | undefined,
): Assignment {
  if (regions.length === 0) throw new Error('assignRegion needs at least one region');
  const inside =
    regions.find((r) => r.units.some((u) => areaContains(u.row.geometry, u.box, lng, lat))) ?? null;
  const key = admin ? normalizeName(admin) : '';
  const adminMatches = key ? regions.filter((r) => namesOf(r).includes(key)) : [];

  const nearMatch =
    inside && adminMatches.includes(inside)
      ? inside
      : adminMatches.find((r) => kmOutsideRegion(r, lng, lat) <= CONTAINMENT_TOLERANCE_KM);
  if (nearMatch) return { region: nearMatch, how: 'admin', inside, adminMatches };
  if (inside) return { region: inside, how: 'inside', inside, adminMatches };

  let region = regions[0]!;
  let snappedKm = Infinity;
  for (const r of regions) {
    for (const u of r.units) {
      const km = distanceToEdgeKm(u.row.geometry, lng, lat);
      if (km < snappedKm) [region, snappedKm] = [r, km];
    }
  }
  return { region, how: 'snapped', inside, adminMatches, snappedKm };
}

/**
 * Whether an assignment disagrees with maptap's `admin` (only places with an `admin` can): the
 * admin names no region, the place got a region other than the ones it names, or the region
 * containing the point is not one it names (the admin won within tolerance).
 */
export function adminDisagrees(assignment: Assignment, admin: string | undefined): boolean {
  if (!admin) return false;
  const named = (region: Region | null) =>
    region !== null && assignment.adminMatches.includes(region);
  return !named(assignment.region) || (assignment.inside !== null && !named(assignment.inside));
}

/** A country gets a regions tier with enough regions holding places and enough places. */
export function hasRegionsTier(regionsWithPlaces: number, places: number): boolean {
  return regionsWithPlaces >= REGIONS_TIER_MIN_REGIONS && places >= REGIONS_TIER_MIN_PLACES;
}
