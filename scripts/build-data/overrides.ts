// maptap country names the normalized name match cannot resolve on its own, keyed by maptap's
// exact name. Unit codes are Natural Earth SU_A3 codes (map units, or map subunits when marked).
import type { Override } from './country-match';

const units = (...codes: string[]): Override => ({ kind: 'units', codes });
const subunits = (...codes: string[]): Override => ({ kind: 'units', codes, subunits: true });
const OCEAN = 'open ocean: no country polygon';

export const OVERRIDES: Record<string, Override> = {
  // maptap names NE spells differently.
  'Cape Verde': units('CPV'),
  'Georgia (Country)': units('GEG', 'GEA'),
  'Midway Atoll': units('MQI'),
  Naoero: units('NRU'),
  'South Georgia': units('SGS'),
  'Turks & Caicos': units('TCA'),
  Türkiye: units('TUR'),
  'US Virgin Islands': units('VIR'),
  'Vatican City': units('VAT'),

  // NE draws these territories as units of their own, but maptap files their places under the
  // country: Heard, Christmas, Cocos and Norfolk islands; Hong Kong and Macao; Northern Cyprus
  // (plus the UN buffer zone, so the island has no gap); Åland; Kerguelen (French Southern
  // Lands); Baikonur; Vojvodina; Somaliland; Zanzibar.
  Australia: units('AUS', 'CCK', 'CXR', 'HMD', 'NFK'),
  China: units('CHN', 'HKG', 'MAC', 'PFA'),
  Cyprus: units('CYP', 'CYN', 'CNM'),
  Finland: units('FIN', 'ALD'),
  France: units('FXX', 'ATF', 'GLP', 'GUF', 'MTQ', 'MYT', 'REU'),
  Kazakhstan: units('KAZ', 'KAB'),
  Serbia: units('SRS', 'SRV'),
  Somalia: units('SOX', 'SOP', 'SOL'),
  Tanzania: units('TZA', 'TZZ'),

  // maptap's "United Kingdom" holds only the places outside the four nations.
  'United Kingdom': units('GIB', 'WSB', 'ESB'),
  // Caribbean Netherlands (NLY) is one NE unit, but maptap splits it into three countries.
  Netherlands: units('NLX'),
  Bonaire: { kind: 'point', lng: -68.26, lat: 12.2, radiusKm: 20 },
  Saba: { kind: 'point', lng: -63.237, lat: 17.633, radiusKm: 4 },
  'Sint Eustatius': { kind: 'point', lng: -62.975, lat: 17.49, radiusKm: 5 },
  // NE's Saint Helena map unit covers all three; its subunits split them.
  'Saint Helena': subunits('SHS'),
  'Ascension Island': subunits('BAC'),
  'Tristan da Cunha': subunits('SHT'),

  'Pacific Ocean': { kind: 'exclude', reason: OCEAN },
  'North Atlantic': { kind: 'exclude', reason: OCEAN },
  'North Sea': { kind: 'exclude', reason: OCEAN },
  'Arctic Ocean': { kind: 'exclude', reason: OCEAN },
};
