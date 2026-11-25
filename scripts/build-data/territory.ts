// Moves a territory from one country to another: country geometry and admin-1 rows both follow.
import turfDifference from '@turf/difference';
import { feature, featureCollection } from '@turf/helpers';
import turfIntersect from '@turf/intersect';
import turfUnion from '@turf/union';
import type { MatchedCountry } from './country-match';
import { type Area, approxAreaKm2, bboxOf, interiorPoint, planarArea } from './geo';
import type { NeAdmin1 } from './natural-earth';

export interface TerritoryMove {
  /** maptap country names. */
  from: string;
  to: string;
  /** The territory: the union of these admin-1 rows, or an NE disputed area by BRK_A3. */
  territory: { admin1: string[] } | { disputedArea: string };
  /** Moved admin-1 pieces become one region with this name; otherwise each keeps its own. */
  region?: string;
}

/** A clipped piece smaller than this share of its row is a boundary sliver, not territory. */
const SLIVER_SHARE = 0.01;

/**
 * A clipping result the build reports. `in-territory`: a sliver that stayed with the losing
 * country's row although the country geometry lost it. `outside`: a sliver that stayed in the
 * losing country's geometry with no row, as the rest of the row moved. `gaining-overlap`: a
 * gaining country's row still overlaps the moved pieces by this much. `gaining-covered`: a
 * gaining country's row lay (all but a sliver) in the territory, so it was dropped and the moved
 * pieces replace it; share and km² are of the overlap.
 */
interface Sliver {
  move: string;
  row: string;
  part: 'in-territory' | 'outside' | 'gaining-overlap' | 'gaining-covered';
  share: number;
  km2: number;
}

type Moved = { countries: MatchedCountry[]; admin1: NeAdmin1[]; slivers: Sliver[] };

const pair = (a: Area, b: Area) => featureCollection([feature(a), feature(b)]);
const union = (a: Area, b: Area): Area => turfUnion(pair(a, b))!.geometry;
const difference = (a: Area, b: Area): Area | null => turfDifference(pair(a, b))?.geometry ?? null;
const intersect = (a: Area, b: Area): Area | null => turfIntersect(pair(a, b))?.geometry ?? null;

/** Applies the moves in order: the updated countries and admin-1 rows, and what to report. */
export function applyTerritoryMoves(
  countries: MatchedCountry[],
  admin1: NeAdmin1[],
  disputedAreas: Map<string, Area>,
  moves: TerritoryMove[],
): Moved {
  let result: Moved = { countries, admin1, slivers: [] };
  for (const move of moves) {
    const next = applyMove(result.countries, result.admin1, disputedAreas, move);
    result = { ...next, slivers: [...result.slivers, ...next.slivers] };
  }
  return result;
}

function applyMove(
  countries: MatchedCountry[],
  admin1: NeAdmin1[],
  disputedAreas: Map<string, Area>,
  move: TerritoryMove,
): Moved {
  const label = `move ${move.from} → ${move.to}`;
  const from = countries.find((c) => c.name === move.from);
  const to = countries.find((c) => c.name === move.to);
  if (!from?.area || !to?.area) throw new Error(`${label}: both must be polygon countries`);

  let territory: Area;
  if ('admin1' in move.territory) {
    const rows = move.territory.admin1.map((code) => {
      const row = admin1.find((r) => r.code === code);
      if (!row) throw new Error(`${label}: no admin-1 row ${code}`);
      return row.geometry;
    });
    territory = rows.reduce(union);
  } else {
    const area = disputedAreas.get(move.territory.disputedArea);
    if (!area) throw new Error(`${label}: no disputed area ${move.territory.disputedArea}`);
    territory = area;
  }

  const fromArea = difference(from.area, territory);
  if (!fromArea) throw new Error(`${label}: the territory covers all of ${move.from}`);
  const toArea = union(to.area, territory);
  const updated = countries.map((c) =>
    c === from
      ? { ...c, area: fromArea, box: bboxOf(fromArea) }
      : c === to
        ? { ...c, area: toArea, box: bboxOf(toArea) }
        : c,
  );

  // Clip the losing country's rows; the clipped-off pieces become the gaining country's rows.
  const kept: NeAdmin1[] = [];
  const pieces: Array<{ row: NeAdmin1; piece: Area }> = [];
  const slivers: Sliver[] = [];
  const sliver = (row: NeAdmin1, part: Sliver['part'], area: Area, size: number) =>
    slivers.push({
      move: label,
      row: `${row.code} ${row.name}`,
      part,
      share: planarArea(area) / size,
      km2: approxAreaKm2(area),
    });
  for (const row of admin1) {
    const piece = from.adm0.includes(row.adm0) ? intersect(row.geometry, territory) : null;
    const size = planarArea(row.geometry);
    if (!piece || planarArea(piece) < SLIVER_SHARE * size) {
      if (piece) sliver(row, 'in-territory', piece, size);
      kept.push(row);
      continue;
    }
    pieces.push({ row, piece });
    const rest = difference(row.geometry, territory);
    if (rest && planarArea(rest) >= SLIVER_SHARE * size) {
      kept.push({ ...row, geometry: rest, label: interiorPoint(rest) });
    } else if (rest) {
      sliver(row, 'outside', rest, size);
    }
  }

  if (pieces.length === 0) throw new Error(`${label}: no admin-1 row of ${move.from} lies in it`);

  // The gaining country's own rows give up what the moved pieces cover, so its rows tile.
  const tiled = kept.flatMap((row): NeAdmin1[] => {
    if (!to.adm0.includes(row.adm0)) return [row];
    const overlap = intersect(row.geometry, territory);
    const size = planarArea(row.geometry);
    if (!overlap) return [row];
    if (planarArea(overlap) < SLIVER_SHARE * size) {
      sliver(row, 'gaining-overlap', overlap, size);
      return [row];
    }
    const rest = difference(row.geometry, territory);
    if (!rest || planarArea(rest) < SLIVER_SHARE * size) {
      sliver(row, 'gaining-covered', overlap, size);
      return [];
    }
    return [{ ...row, geometry: rest, label: interiorPoint(rest) }];
  });
  const adopt = (row: NeAdmin1, geometry: Area): NeAdmin1 => ({
    ...row,
    adm0: to.adm0[0]!,
    guA3: null,
    label: interiorPoint(geometry),
    geometry,
  });
  const moved = move.region
    ? [
        adopt(
          {
            ...pieces[0]!.row,
            code: pieces.map((p) => p.row.code).join('+'),
            name: move.region,
            nameEn: null,
            nameAlt: pieces.map((p) => p.row.name).join('|'),
            region: null,
          },
          pieces.map((p) => p.piece).reduce(union),
        ),
      ]
    : pieces.map(({ row, piece }) => adopt({ ...row, code: `${row.code}>${to.id}` }, piece));
  return { countries: updated, admin1: [...tiled, ...moved], slivers };
}
