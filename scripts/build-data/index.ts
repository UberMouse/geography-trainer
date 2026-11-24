// `npm run build:data`: regenerates public/data/ from maptap's V2 list and Natural Earth.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Assignment,
  DISSOLVE_BY_REGION,
  type Region,
  adminDisagrees,
  admin1Rows,
  assignRegion,
  buildRegions,
  hasRegionsTier,
} from './assign-regions';
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
  writeData,
} from './emit';
import { MAPTAP_URL, type MaptapEntry, fetchMaptap } from './fetch-maptap';
import { NE_FILES, NE_VERSION, loadNaturalEarth } from './natural-earth';
import { compareStrings } from './normalize';
import { OVERRIDES } from './overrides';
import { validateDataDir } from './validate';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT_DIR = join(ROOT, 'public', 'data');
const CACHE_DIR = join(ROOT, '.cache', 'natural-earth');

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
const byId = <T extends { id: string }>(a: T, b: T) => compareStrings(a.id, b.id);

async function main(): Promise<number> {
  const maptap = await fetchMaptap();
  const ne = await loadNaturalEarth(CACHE_DIR);

  const names = maptap.active.map((e) => e.country);
  const match = matchCountries(
    names.filter((n) => !isBorderName(n)),
    ne.mapUnits,
    ne.mapSubunits,
    OVERRIDES,
  );
  const countryByName = new Map(match.countries.map((c) => [c.name, c]));
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
      const country = resolveBorderCountry(match.countries, entry.lng, entry.lat);
      border.push(`${entry.id} (${entry.country}) → ${country.id}`);
      kept.push({ entry, country });
    } else {
      kept.push({ entry, country: countryByName.get(entry.country)! });
    }
  }

  const regionsByCountry = new Map<string, Region[]>();
  for (const country of match.countries) {
    if (!country.area) continue;
    const rows = admin1Rows(country, ne.admin1, match.countries);
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

  const countryShapes: ShapeOut[] = match.countries.map((c) => ({
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

  const count = (how: (c: MatchedCountry) => boolean) => match.countries.filter(how).length;
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
  };

  await writeData(OUT_DIR, {
    places,
    countries,
    regions,
    manifest,
    sourceMd: sourceMarkdown(manifest, new Date()),
  });

  const { counts } = manifest;
  console.log(
    `\nplaces: total ${counts.total}, active ${counts.active}, kept ${counts.kept}, excluded ${counts.excluded}`,
  );
  for (const e of excluded) console.log(`  excluded ${e.id} (${e.country}): ${e.reason}`);
  const c = manifest.countries;
  console.log(
    `countries: ${match.countries.length} kept (by name ${c.byName}, by override ${c.byOverride}, point-only ${c.pointOnly}), excluded: ${c.excludedNames.join(', ')}`,
  );
  console.log(`border places (${border.length}):\n  ${border.join('\n  ')}`);
  console.log(`regions tier (${tier.size}): ${manifest.regionsTierCountries.join(', ')}`);
  console.log(`admin mismatches (${mismatches.length}):\n  ${mismatches.join('\n  ')}`);
  console.log(`snapped points (${snapped.length}):\n  ${snapped.join('\n  ')}`);

  const problems = await validateDataDir(OUT_DIR);
  if (problems.length > 0) {
    console.error(`\nvalidation failed (${problems.length}):\n  ${problems.join('\n  ')}`);
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
