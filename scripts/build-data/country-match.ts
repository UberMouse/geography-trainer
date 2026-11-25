// Maps maptap country names to Natural Earth geometry: a normalized name match against the map
// units, then the overrides table. Fails listing every name that is neither matched, overridden
// nor excluded.
import type { MultiPolygon, Position } from 'geojson';
import { type Area, type BBox, areaContains, bboxOf, distanceToEdgeKm } from './geo';
import type { NeUnit } from './natural-earth';
import { compareStrings, normalizeName, slugify } from './normalize';

export type Override =
  /** The union of these SU_A3 codes, from the map units unless `subunits` is set. */
  | { kind: 'units'; codes: string[]; subunits?: boolean }
  /** No NE polygon of its own: a circle around a point. */
  | { kind: 'point'; lng: number; lat: number; radiusKm: number }
  | { kind: 'exclude'; reason: string };

export interface MatchedCountry {
  id: string;
  /** maptap's name. */
  name: string;
  how: 'name' | 'override';
  /** SU_A3 codes of the NE units making up the geometry; empty for a point-only country. */
  ne: string[];
  /** ADM0_A3 and GU_A3 of those units, for picking admin-1 rows. */
  adm0: string[];
  guA3: string[];
  area: Area | null;
  box: BBox | null;
  point: { lng: number; lat: number; radiusKm: number } | null;
}

export interface CountryMatch {
  countries: MatchedCountry[];
  excluded: Array<{ name: string; reason: string }>;
}

/** A maptap "country" naming several countries ("Nepal/China") marks a border place. */
export function isBorderName(name: string): boolean {
  return name.includes('/');
}

function union(units: NeUnit[]): MultiPolygon {
  const coordinates: Position[][][] = [];
  for (const unit of units) {
    if (unit.geometry.type === 'Polygon') coordinates.push(unit.geometry.coordinates);
    else coordinates.push(...unit.geometry.coordinates);
  }
  return { type: 'MultiPolygon', coordinates };
}

/** Geounit-level keys: a map unit is one geounit, a subunit is part of its GU_A3. */
interface Footprint {
  gu: Set<string>;
  su: Set<string>;
}

function footprint(units: NeUnit[], subunits: boolean): Footprint {
  return {
    gu: new Set(units.map((u) => u.guA3)),
    su: new Set(subunits ? units.map((u) => u.code) : []),
  };
}

export function matchCountries(
  names: string[],
  mapUnits: NeUnit[],
  mapSubunits: NeUnit[],
  overrides: Record<string, Override>,
): CountryMatch {
  const unitsByCode = new Map(mapUnits.map((u) => [u.code, u]));
  const subunitsByCode = new Map(mapSubunits.map((u) => [u.code, u]));
  const sorted = [...new Set(names)].sort();

  const byName = (name: string, fields: Array<keyof NeUnit['names']>) => {
    const key = normalizeName(name);
    return mapUnits.filter((u) => fields.some((f) => normalizeName(u.names[f] ?? '') === key));
  };

  // A name-matched geounit belongs to the name that matches it specifically (NAME, NAME_LONG or
  // GEOUNIT) or overrides it, not to a name that only matches its ADMIN: "New Zealand" does not
  // take Tokelau, "United Kingdom" does not take England.
  const claims = new Map<string, string>();
  for (const name of sorted) {
    const override = overrides[name];
    const units =
      override?.kind === 'units'
        ? override.codes.map((c) => (override.subunits ? subunitsByCode : unitsByCode).get(c))
        : override
          ? []
          : byName(name, ['NAME', 'NAME_LONG', 'GEOUNIT']);
    for (const unit of units) if (unit) claims.set(unit.guA3, name);
  }

  const countries: MatchedCountry[] = [];
  const footprints = new Map<string, Footprint>();
  const excluded: CountryMatch['excluded'] = [];
  const unmatched: string[] = [];
  const problems: string[] = [];

  for (const name of sorted) {
    const override = overrides[name];
    let units: NeUnit[] = [];
    let subunits = false;
    let how: MatchedCountry['how'] = 'override';
    let point: MatchedCountry['point'] = null;

    if (override?.kind === 'exclude') {
      excluded.push({ name, reason: override.reason });
      continue;
    } else if (override?.kind === 'point') {
      point = { lng: override.lng, lat: override.lat, radiusKm: override.radiusKm };
    } else if (override?.kind === 'units') {
      subunits = override.subunits === true;
      const table = subunits ? subunitsByCode : unitsByCode;
      for (const code of override.codes) {
        const unit = table.get(code);
        if (unit) units.push(unit);
        else problems.push(`override for "${name}": no NE unit ${code}`);
      }
    } else {
      how = 'name';
      units = byName(name, ['NAME', 'NAME_LONG', 'ADMIN', 'GEOUNIT']).filter(
        (u) => (claims.get(u.guA3) ?? name) === name,
      );
      if (units.length === 0) {
        unmatched.push(name);
        continue;
      }
    }

    units.sort((a, b) => compareStrings(a.code, b.code));
    const area = units.length > 0 ? union(units) : null;
    countries.push({
      id: slugify(name),
      name,
      how,
      ne: units.map((u) => u.code),
      adm0: [...new Set(units.map((u) => u.adm0))].sort(),
      guA3: [...new Set(units.map((u) => u.guA3))].sort(),
      area,
      box: area ? bboxOf(area) : null,
      point,
    });
    footprints.set(name, footprint(units, subunits));
  }

  if (unmatched.length > 0) {
    problems.push(
      `${unmatched.length} maptap countries match no Natural Earth unit and have no override: ${unmatched.map((n) => `"${n}"`).join(', ')}`,
    );
  }
  problems.push(...overlaps(countries, footprints));
  const ids = new Map<string, string>();
  for (const c of countries) {
    const other = ids.get(c.id);
    if (other) problems.push(`"${other}" and "${c.name}" both slug to id "${c.id}"`);
    ids.set(c.id, c.name);
  }
  if (problems.length > 0) throw new Error(`country matching failed:\n  ${problems.join('\n  ')}`);

  return { countries, excluded };
}

/** Two maptap countries never share NE geometry. */
function overlaps(countries: MatchedCountry[], footprints: Map<string, Footprint>): string[] {
  const problems: string[] = [];
  for (let i = 0; i < countries.length; i++) {
    for (let j = i + 1; j < countries.length; j++) {
      const a = countries[i]!;
      const b = countries[j]!;
      const fa = footprints.get(a.name)!;
      const fb = footprints.get(b.name)!;
      // Two subunit-based countries may share a geounit as long as their subunits differ.
      const bothSubunits = fa.su.size > 0 && fb.su.size > 0;
      const clash = bothSubunits
        ? [...fa.su].filter((su) => fb.su.has(su))
        : [...fa.gu].filter((gu) => fb.gu.has(gu));
      if (clash.length > 0) {
        problems.push(
          `"${a.name}" and "${b.name}" share Natural Earth unit(s) ${clash.join(', ')}`,
        );
      }
    }
  }
  return problems;
}

/**
 * The polygon country for a border place, among the countries its name lists ("Nepal/China"):
 * the one containing the point, else the one whose edge is nearest. Each part is a maptap country
 * name, or a key of `aliases` for maptap's other spellings; a part naming no matched polygon
 * country fails.
 */
export function resolveBorderCountry(
  countries: MatchedCountry[],
  borderName: string,
  lng: number,
  lat: number,
  aliases: Record<string, string> = {},
): MatchedCountry {
  const candidates = borderName.split('/').map((rawPart) => {
    const part = rawPart.trim();
    const name = aliases[part] ?? part;
    const country = countries.find((c) => c.name === name);
    if (!country?.area || !country.box) {
      throw new Error(`border place "${borderName}": "${part}" names no polygon country`);
    }
    return country;
  });
  const inside = candidates.find((c) => areaContains(c.area!, c.box!, lng, lat));
  if (inside) return inside;
  let best = candidates[0]!;
  let bestKm = Infinity;
  for (const c of candidates) {
    const km = distanceToEdgeKm(c.area!, lng, lat);
    if (km < bestKm) [best, bestKm] = [c, km];
  }
  return best;
}
