// maptap country names the normalized name match cannot resolve on its own, keyed by maptap's
// exact name. Unit codes are Natural Earth SU_A3 codes (map units, or map subunits when marked).
import type { RegionNameOverrides } from './assign-regions';
import type { Override } from './country-match';
import type { TerritoryMove } from './territory';

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

// Border-place name parts ("USA/Haiti") that maptap spells unlike its own country names.
export const BORDER_NAME_ALIASES: Record<string, string> = { USA: 'United States' };

// Boundary decisions (user-confirmed): follow maptap's place labels where NE draws a de facto line.
export const BOUNDARY_NOTE =
  "Crimea shown as part of Ukraine and Western Sahara as a whole territory, following maptap's place labels";
export const TERRITORY_MOVES: TerritoryMove[] = [
  // NE files the Crimea and Sevastopol admin-1 rows under RUS.
  {
    from: 'Russia',
    to: 'Ukraine',
    territory: { admin1: ['RUS-283', 'RUS-5482'] },
    region: 'Crimea',
  },
  // NE disputed area B19 (ne_10m_admin_0_disputed_areas) is the part of Western Sahara Morocco
  // administers, on NE's own line: it also takes the Smara part of Guelmim - Es-Semara, which no
  // admin-1 row splits off.
  { from: 'Morocco', to: 'Western Sahara', territory: { disputedArea: 'B19' } },
];

const NO_LAND = 'no NE 10m land of this country at this point';
const WATER = 'a feature on open water: no land at this point';
const BORDER = 'border place resolved to the nearest country; NE 10m has no land of its own here';
const SIMPLIFIED_PENINSULA =
  'on NE 10m land; the simplified outline cuts this headland or peninsula';
const SIMPLIFIED_ISLAND = 'on NE 10m land; the simplified outline shrinks this small island';

// Places allowed to lie more than CONTAINMENT_TOLERANCE_KM outside their country or region on
// the emitted geometry, keyed by place id, each with the reason.
export const CONTAINMENT_ALLOW_LIST: Record<string, string> = {
  ailsa_craig_scotland: NO_LAND,
  balls_pyramid_australia: NO_LAND,
  bikini_atoll_marshall_islands: NO_LAND,
  capri: SIMPLIFIED_ISLAND,
  danger_islands_antarctica: NO_LAND,
  devil: NO_LAND,
  fort_jefferson_dry_tortugas_national_park_united_states: NO_LAND,
  great_blue_hole: WATER,
  hel_poland: SIMPLIFIED_PENINSULA,
  ilha_da_queimada_grande_sao_paulo_brazil: NO_LAND,
  inaccessible_island_tristan_da_cunha: NO_LAND,
  isla_martin_garcia_buenos_aires_argentina: NO_LAND,
  kavachi_volcano_solomon_islands: WATER,
  krakatoa: NO_LAND,
  lake_pontchartrain_causeway_louisiana_usa: WATER,
  machias_seal_island_usa_canada: NO_LAND,
  maya_bay: NO_LAND,
  mer_torres_strait_islands_queensland_australia: NO_LAND,
  montebello_islands_western_australia_australia: NO_LAND,
  nangan_matsu_islands_taiwan: NO_LAND,
  navassa_island_usa_haiti: BORDER,
  nukunonu_new_zealand: NO_LAND,
  perhentian_islands_malaysia: NO_LAND,
  saint_martin_s_island_bangladesh: NO_LAND,
  santa_cruz_del_islote_colombia: NO_LAND,
  skellig_michael_ireland: NO_LAND,
};

// Display names for admin-1 rows (NE `adm1_code`) whose NE name is wrong or shared with another
// row of the same country, so no two regions of a country share a name. `mislabel` marks the rows
// where NE's name belongs to another region: it is then no match alias for this one.
export const REGION_NAME_OVERRIDES: RegionNameOverrides = {
  'IRL-713': { name: 'Galway (county)', reason: 'NE type County; shares a name with the city' },
  'IRL-5568': { name: 'Galway (city)', reason: 'NE type City; shares a name with the county' },
  'IRL-78': { name: 'Cork (county)', reason: 'NE type County; shares a name with the city' },
  'IRL-5569': { name: 'Cork (city)', reason: 'NE type City; shares a name with the county' },
  'IRL-726': { name: 'Limerick (county)', reason: 'NE type County; shares a name with the city' },
  'IRL-5570': { name: 'Limerick (city)', reason: 'NE type City; shares a name with the county' },
  'IRL-1444': { name: 'Waterford (county)', reason: 'NE type County; shares a name with the city' },
  'IRL-5571': { name: 'Waterford (city)', reason: 'NE type City; shares a name with the county' },
  'MOZ-1927': {
    name: 'Maputo (province)',
    reason: 'NE gn_name "Maputo Province"; same name as the city',
  },
  'MOZ-5854': {
    name: 'Maputo (city)',
    reason: 'NE gn_name "Cidade de Maputo"; same name as the province',
  },
  'UZB-372': {
    name: 'Tashkent (region)',
    reason: 'NE gn_name "Toshkent Viloyati"; same name as the city',
  },
  'UZB-4828': {
    name: 'Tashkent (city)',
    reason: 'NE gn_name "Toshkent Shahri"; same name as the region',
  },
  'AFG-1769': {
    name: 'Panjshir',
    reason: 'NE labels it "Parwan", but gn_name/woe_name say Panjshir (split from Parwan in 2004)',
    mislabel: true,
  },
  'AFG-1753': {
    name: 'Daykundi',
    reason:
      'NE labels it "Uruzgan", but gn_name/woe_name say Daykundi (split from Uruzgan in 2004)',
    mislabel: true,
    aliases: ['Wilayat-e Daykundi'], // NE gn_name
  },
  'HRV-1604': {
    name: 'Požeško-Slavonska',
    reason:
      'NE labels it "Brodsko-Posavska" (twin of HRV-1602), but its FIPS HR11, wikidata Q58111 and centre are Požega-Slavonia\'s',
    mislabel: true,
    aliases: ['Požega-Slavonia'], // NE name_en
  },
  'UGA-3371': {
    name: 'Kiruhura',
    reason: 'NE labels it "Mbarara", but its gn_name is Kiruhura District (UGA-3374 is Mbarara)',
    mislabel: true,
    aliases: ['Kiruhura District'], // NE gn_name
  },
  'HUN-3158': { name: 'Veszprém (county)', reason: 'NE type County; shares a name with the city' },
  'HUN-4909': {
    name: 'Veszprém (city)',
    reason: 'NE type Urban county; shares a name with the county',
  },
};
