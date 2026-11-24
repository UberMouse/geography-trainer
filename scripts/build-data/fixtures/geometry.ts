// Synthetic Natural Earth rows on small square polygons, for the build-data specs.
import type { Polygon } from 'geojson';
import type { MatchedCountry } from '../country-match';
import { bboxOf } from '../geo';
import type { NeAdmin1, NeUnit } from '../natural-earth';

/** An axis-aligned square with its south-west corner at (lng, lat). */
export function square(lng: number, lat: number, size = 1): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [lng, lat],
        [lng + size, lat],
        [lng + size, lat + size],
        [lng, lat + size],
        [lng, lat],
      ],
    ],
  };
}

export function unit(
  code: string,
  name: string,
  at: [number, number],
  extra: Partial<NeUnit['names']> & { adm0?: string } = {},
): NeUnit {
  return {
    code,
    names: {
      NAME: name,
      NAME_LONG: extra.NAME_LONG ?? name,
      ADMIN: extra.ADMIN ?? name,
      GEOUNIT: extra.GEOUNIT ?? name,
    },
    adm0: extra.adm0 ?? code,
    guA3: code,
    geometry: square(...at),
  };
}

export function admin1(
  code: string,
  name: string,
  at: [number, number],
  extra: Partial<Omit<NeAdmin1, 'code' | 'name' | 'geometry'>> = {},
): NeAdmin1 {
  return {
    code,
    name,
    nameEn: null,
    nameAlt: null,
    region: null,
    adm0: 'AAA',
    guA3: null,
    label: [at[0] + 0.5, at[1] + 0.5],
    ...extra,
    geometry: square(...at),
  };
}

export function polygonCountry(id: string, at: [number, number], size = 1): MatchedCountry {
  const area = square(at[0], at[1], size);
  return {
    id,
    name: id,
    how: 'name',
    ne: [id.toUpperCase()],
    adm0: [id.toUpperCase()],
    guA3: [id.toUpperCase()],
    area,
    box: bboxOf(area),
    point: null,
  };
}
