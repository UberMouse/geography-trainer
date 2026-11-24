// Builds a country's regions from NE admin-1 rows and assigns places to them.
import { REGIONS_TIER_MIN_PLACES, REGIONS_TIER_MIN_REGIONS } from '../../src/engine/config';
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

/**
 * The admin-1 rows of `country`: rows of its ADM0_A3, minus rows whose GU_A3 is another kept
 * country's geounit and not its own (England's rows are not Scotland's, Tokelau's not New
 * Zealand's), minus rows whose label point lies in another kept country (Caribbean Netherlands
 * rows are NLD/NLD but belong to Bonaire, Saba and Sint Eustatius).
 */
export function admin1Rows(
  country: MatchedCountry,
  admin1: NeAdmin1[],
  countries: MatchedCountry[],
): NeAdmin1[] {
  const others = countries.filter((other) => other.id !== country.id);
  const othersGeounits = new Set(others.flatMap((other) => other.guA3));
  return admin1.filter(
    (row) =>
      country.adm0.includes(row.adm0) &&
      !(row.guA3 && othersGeounits.has(row.guA3) && !country.guA3.includes(row.guA3)) &&
      !others.some((other) => insideCountry(other, row.label)),
  );
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
    if (row.nameEn) names.push(row.nameEn);
    if (row.nameAlt) names.push(...row.nameAlt.split('|'));
  }
  return names.map(normalizeName);
}

/**
 * The region for a place: the one maptap's `admin` names (by region name or by one of its
 * admin-1 rows' name, name_en or name_alt), else the one containing the point, else the one
 * with the nearest edge.
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

  if (adminMatches.length > 0) {
    const region = inside && adminMatches.includes(inside) ? inside : adminMatches[0]!;
    return { region, how: 'admin', inside, adminMatches };
  }
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

/** Whether an assignment disagrees with maptap's `admin` (only places with an `admin` can). */
export function adminDisagrees(assignment: Assignment, admin: string | undefined): boolean {
  if (!admin) return false;
  if (assignment.adminMatches.length === 0) return true;
  return assignment.inside !== null && !assignment.adminMatches.includes(assignment.inside);
}

/** A country gets a regions tier with enough regions holding places and enough places. */
export function hasRegionsTier(regionsWithPlaces: number, places: number): boolean {
  return regionsWithPlaces >= REGIONS_TIER_MIN_REGIONS && places >= REGIONS_TIER_MIN_PLACES;
}
