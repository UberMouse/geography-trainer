// `npm run build:data`: regenerates public/data/ from maptap's V2 list and Natural Earth.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Assignment,
  type DroppedRow,
  DISSOLVE_BY_REGION,
  type Region,
  adminDisagrees,
  admin1Rows,
  assignRegion,
  buildRegions,
  hasRegionsTier,
} from './assign-regions';
import { CONTAINMENT_TOLERANCE_KM, checkContainment } from './containment';
import {
  type MatchedCountry,
  isBorderName,
  matchCountries,
  resolveBorderCountry,
} from './country-match';
import {
  type Manifest,
  type PlaceOut,
  type ShapeOut,
  type Topology,
  toTopology,
  publishData,
} from './emit';
import { MAPTAP_URL, type MaptapEntry, fetchMaptap } from './fetch-maptap';
import { NE_FILES, NE_VERSION, loadNaturalEarth } from './natural-earth';
import { compareStrings } from './normalize';
import {
  BORDER_NAME_ALIASES,
  BOUNDARY_NOTE,
  CONTAINMENT_ALLOW_LIST,
  OVERRIDES,
  TERRITORY_MOVES,
} from './overrides';
import { applyTerritoryMoves } from './territory';
import { validateDataDir } from './validate';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT_DIR = join(ROOT, 'public', 'data');
const CACHE_DIR = join(ROOT, '.cache', 'natural-earth');
// Gitignored, outside public/ (so a leftover is never served or built), same filesystem as OUT_DIR.
const STAGING_DIR = join(ROOT, '.cache');

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
const byId = <T extends { id: string }>(a: T, b: T) => compareStrings(a.id, b.id);

async function main(): Promise<number> {
  const maptap = await fetchMaptap();
  const fetchedAt = new Date();
  const ne = await loadNaturalEarth(CACHE_DIR);

  const names = maptap.active.map((e) => e.country);
  const match = matchCountries(
    names.filter((n) => !isBorderName(n)),
    ne.mapUnits,
    ne.mapSubunits,
    OVERRIDES,
  );
  const moved = applyTerritoryMoves(match.countries, ne.admin1, ne.disputedAreas, TERRITORY_MOVES);
  const matched = moved.countries;
  const countryByName = new Map(matched.map((c) => [c.name, c]));
  const exclusionReason = new Map(match.excluded.map((e) => [e.name, e.reason]));

  // Each active place: excluded, a border place resolved to a polygon country, or its country.
  const kept: Array<{ entry: MaptapEntry; country: MatchedCountry }> = [];
  const excluded: Manifest['excluded'] = [];
  const border: string[] = [];
  for (const entry of [...maptap.active].sort(byId)) {
    const reason = exclusionReason.get(entry.country);
    if (reason) {
      excluded.push({ id: entry.id, name: entry.name, country: entry.country, reason });
    } else if (isBorderName(entry.country)) {
      const country = resolveBorderCountry(
        matched,
        entry.country,
        entry.lng,
        entry.lat,
        BORDER_NAME_ALIASES,
      );
      border.push(`${entry.id} (${entry.country}) → ${country.id}`);
      kept.push({ entry, country });
    } else {
      kept.push({ entry, country: countryByName.get(entry.country)! });
    }
  }

  const regionsByCountry = new Map<string, Region[]>();
  const droppedAdmin1: DroppedRow[] = [];
  for (const country of matched) {
    if (!country.area) continue;
    const { rows, dropped } = admin1Rows(country, moved.admin1, matched);
    droppedAdmin1.push(...dropped);
    if (rows.length > 0) {
      regionsByCountry.set(
        country.id,
        buildRegions(country.id, rows, DISSOLVE_BY_REGION.has(country.id)),
      );
    }
  }

  const assignments = new Map<string, Assignment>();
  const mismatches: string[] = [];
  const snapped: string[] = [];
  for (const { entry, country } of kept) {
    const regions = regionsByCountry.get(country.id);
    if (!regions) {
      if (entry.admin)
        mismatches.push(
          `${entry.id}: admin "${entry.admin}" but ${country.id} has no admin-1 regions`,
        );
      continue;
    }
    const a = assignRegion(regions, entry.lng, entry.lat, entry.admin);
    assignments.set(entry.id, a);
    if (adminDisagrees(a, entry.admin)) {
      mismatches.push(
        `${entry.id}: admin "${entry.admin}" → ${a.adminMatches.length > 0 ? a.region.id : 'no region'}, point in ${a.inside?.id ?? 'none'}`,
      );
    }
    if (a.how === 'snapped')
      snapped.push(`${entry.id} → ${a.region.id} (${a.snappedKm!.toFixed(1)} km)`);
  }

  // Tiers, over kept places and final regions.
  const placesPerCountry = new Map<string, number>();
  const placesPerRegion = new Map<string, number>();
  for (const { entry, country } of kept) {
    placesPerCountry.set(country.id, (placesPerCountry.get(country.id) ?? 0) + 1);
    const region = assignments.get(entry.id)?.region;
    if (region) placesPerRegion.set(region.id, (placesPerRegion.get(region.id) ?? 0) + 1);
  }
  const tier = new Set(
    [...regionsByCountry]
      .filter(([id, regions]) =>
        hasRegionsTier(
          regions.filter((r) => placesPerRegion.has(r.id)).length,
          placesPerCountry.get(id) ?? 0,
        ),
      )
      .map(([id]) => id),
  );

  const places: PlaceOut[] = kept.map(({ entry, country }) => ({
    id: entry.id,
    name: entry.name,
    country: country.id,
    region: tier.has(country.id) ? assignments.get(entry.id)!.region.id : null,
    lat: round4(entry.lat),
    lng: round4(entry.lng),
    type: entry.type,
    level: entry.difficultyLevel,
    ...(typeof entry.population === 'number' ? { pop: entry.population } : {}),
  }));

  const countryShapes: ShapeOut[] = matched.map((c) => ({
    id: c.id,
    areas: c.area ? [c.area] : [],
    ...(c.point ? { point: [c.point.lng, c.point.lat] as [number, number] } : {}),
    properties: {
      name: c.name,
      ne: c.ne,
      places: placesPerCountry.get(c.id) ?? 0,
      hasRegions: tier.has(c.id),
      ...(c.point ? { radiusKm: c.point.radiusKm } : {}),
    },
  }));
  const countries = await toTopology('countries', countryShapes);
  const regions = new Map<string, Topology>();
  for (const countryId of [...tier].sort()) {
    const shapes = regionsByCountry.get(countryId)!.map((r) => ({
      id: r.id,
      areas: r.units.map((u) => u.row.geometry),
      properties: { name: r.name, places: placesPerRegion.get(r.id) ?? 0 },
    }));
    regions.set(countryId, await toTopology('regions', shapes));
  }

  const containment = checkContainment(
    places,
    countries,
    Object.fromEntries(regions),
    CONTAINMENT_ALLOW_LIST,
  );

  const count = (how: (c: MatchedCountry) => boolean) => matched.filter(how).length;
  const manifest: Manifest = {
    source: MAPTAP_URL,
    naturalEarth: {
      version: NE_VERSION,
      files: Object.values(NE_FILES).map((f) => `${f}.geojson`),
    },
    counts: {
      total: maptap.total,
      active: maptap.active.length,
      kept: places.length,
      excluded: excluded.length,
    },
    excluded,
    countries: {
      byName: count((c) => c.how === 'name'),
      byOverride: count((c) => c.how === 'override' && !c.point),
      pointOnly: count((c) => c.point !== null),
      excludedNames: match.excluded.map((e) => e.name),
    },
    regionsTierCountries: [...tier].sort(),
    outsideTolerance: containment.outside,
    droppedAdmin1: droppedAdmin1.sort(
      (a, b) => compareStrings(a.code, b.code) || compareStrings(a.country, b.country),
    ),
  };

  const data = {
    places,
    countries,
    regions,
    manifest,
    sourceMd: sourceMarkdown(manifest, fetchedAt),
  };

  const { counts } = manifest;
  console.log(
    `\nplaces: total ${counts.total}, active ${counts.active}, kept ${counts.kept}, excluded ${counts.excluded}`,
  );
  for (const e of excluded) console.log(`  excluded ${e.id} (${e.country}): ${e.reason}`);
  const c = manifest.countries;
  console.log(
    `countries: ${matched.length} kept (by name ${c.byName}, by override ${c.byOverride}, point-only ${c.pointOnly}), excluded: ${c.excludedNames.join(', ')}`,
  );
  console.log(`border places (${border.length}):\n  ${border.join('\n  ')}`);
  console.log(`regions tier (${tier.size}): ${manifest.regionsTierCountries.join(', ')}`);
  console.log(`admin mismatches (${mismatches.length}):\n  ${mismatches.join('\n  ')}`);
  console.log(`snapped points (${snapped.length}):\n  ${snapped.join('\n  ')}`);
  console.log(
    `admin-1 rows dropped, label point in another country (${droppedAdmin1.length}):\n  ${droppedAdmin1.map((d) => `${d.code} ${d.name} (${d.country}): label in ${d.labelIn}`).join('\n  ')}`,
  );
  console.log(`boundaries: ${BOUNDARY_NOTE}`);
  console.log(
    `territory-move slivers and covered rows (${moved.slivers.length}):\n  ${moved.slivers.map((s) => `${s.move}: ${s.row}, ${s.part}, ${(s.share * 100).toFixed(3)}% of the row, ${s.km2.toFixed(1)} km²`).join('\n  ')}`,
  );
  console.log(
    `beyond ${CONTAINMENT_TOLERANCE_KM} km of country or region, allow-listed (${containment.outside.length}):\n  ${containment.outside.map((o) => `${o.id} (${o.region ?? o.country}) ${o.km} km: ${o.reason}`).join('\n  ')}`,
  );

  const problems = await publishData(OUT_DIR, STAGING_DIR, data, (dir) => validateDataDir(dir));
  if (problems.length > 0) {
    console.error(
      `\nvalidation failed (${problems.length}), ${OUT_DIR} left unchanged:\n  ${problems.join('\n  ')}`,
    );
    return 1;
  }
  console.log(`\nwrote ${OUT_DIR}, validation passed`);
  return 0;
}

function sourceMarkdown(manifest: Manifest, fetchedAt: Date): string {
  const { counts, countries, naturalEarth } = manifest;
  const reasons = new Map<string, number>();
  for (const e of manifest.excluded) reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1);
  return [
    '# Data source',
    '',
    'Generated by `npm run build:data` (`scripts/build-data/`). Do not edit by hand.',
    '',
    `- Fetched: ${fetchedAt.toISOString()}`,
    `- Place list: ${manifest.source}`,
    `- Boundaries: Natural Earth ${naturalEarth.version}, ${naturalEarth.files.join(', ')}`,
    '',
    'Place list courtesy of MapTap.gg',
    '',
    'Boundaries: Natural Earth (public domain)',
    '',
    `Boundary decisions: ${BOUNDARY_NOTE}.`,
    '',
    '## Counts',
    '',
    `- Entries: ${counts.total}`,
    `- Active: ${counts.active}`,
    `- Kept: ${counts.kept}`,
    `- Excluded: ${counts.excluded}`,
    ...[...reasons].map(([reason, n]) => `  - ${reason}: ${n}`),
    `- Countries: ${countries.byName + countries.byOverride + countries.pointOnly} (by name ${countries.byName}, by override ${countries.byOverride}, point-only ${countries.pointOnly})`,
    `- Regions-tier countries: ${manifest.regionsTierCountries.length}`,
    '',
    '## Excluded places',
    '',
    ...manifest.excluded.map((e) => `- \`${e.id}\` ${e.name} (${e.country}): ${e.reason}`),
    '',
  ].join('\n');
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
