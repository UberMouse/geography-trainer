// Pins the hand-kept tables in overrides.ts to the values spec/contracts/data-pipeline.md states.
import { describe, expect, it } from 'vitest';
import { isBorderName } from './country-match';
import {
  BORDER_NAME_ALIASES,
  BOUNDARY_NOTE,
  CONTAINMENT_ALLOW_LIST,
  OVERRIDES,
  REGION_NAME_OVERRIDES,
  TERRITORY_MOVES,
} from './overrides';

const units = (...codes: string[]) => ({ kind: 'units', codes });
const subunits = (...codes: string[]) => ({ kind: 'units', codes, subunits: true });
const OCEAN = { kind: 'exclude', reason: 'open ocean: no country polygon' };

describe('[DAT-C04] country overrides', () => {
  it('holds exactly the overrides the contract lists', () => {
    expect(OVERRIDES).toEqual({
      'Cape Verde': units('CPV'),
      'Georgia (Country)': units('GEG', 'GEA'),
      'Midway Atoll': units('MQI'),
      Naoero: units('NRU'),
      'South Georgia': units('SGS'),
      'Turks & Caicos': units('TCA'),
      Türkiye: units('TUR'),
      'US Virgin Islands': units('VIR'),
      'Vatican City': units('VAT'),
      Australia: units('AUS', 'CCK', 'CXR', 'HMD', 'NFK'),
      China: units('CHN', 'HKG', 'MAC', 'PFA'),
      Cyprus: units('CYP', 'CYN', 'CNM'),
      Finland: units('FIN', 'ALD'),
      France: units('FXX', 'ATF', 'GLP', 'GUF', 'MTQ', 'MYT', 'REU'),
      Kazakhstan: units('KAZ', 'KAB'),
      Serbia: units('SRS', 'SRV'),
      Somalia: units('SOX', 'SOP', 'SOL'),
      Tanzania: units('TZA', 'TZZ'),
      'United Kingdom': units('GIB', 'WSB', 'ESB'),
      Netherlands: units('NLX'),
      Bonaire: { kind: 'point', lng: -68.26, lat: 12.2, radiusKm: 20 },
      Saba: { kind: 'point', lng: -63.237, lat: 17.633, radiusKm: 4 },
      'Sint Eustatius': { kind: 'point', lng: -62.975, lat: 17.49, radiusKm: 5 },
      'Saint Helena': subunits('SHS'),
      'Ascension Island': subunits('BAC'),
      'Tristan da Cunha': subunits('SHT'),
      'Pacific Ocean': OCEAN,
      'North Atlantic': OCEAN,
      'North Sea': OCEAN,
      'Arctic Ocean': OCEAN,
    });
  });

  it('leaves the four UK nations to the name match', () => {
    for (const nation of ['England', 'Scotland', 'Wales', 'Northern Ireland']) {
      expect(OVERRIDES[nation]).toBeUndefined();
    }
  });
});

describe('[DAT-C05] border-place aliases', () => {
  it('maps USA to United States, and a slash marks a border name', () => {
    expect(BORDER_NAME_ALIASES).toEqual({ USA: 'United States' });
    expect(isBorderName('Nepal/China')).toBe(true);
    expect(isBorderName('China')).toBe(false);
  });
});

describe('[DAT-C06] territory moves', () => {
  it('moves Crimea to Ukraine as one region, then B19 to Western Sahara', () => {
    expect(TERRITORY_MOVES).toEqual([
      {
        from: 'Russia',
        to: 'Ukraine',
        territory: { admin1: ['RUS-283', 'RUS-5482'] },
        region: 'Crimea',
      },
      { from: 'Morocco', to: 'Western Sahara', territory: { disputedArea: 'B19' } },
    ]);
    expect(BOUNDARY_NOTE).toBe(
      "Crimea shown as part of Ukraine and Western Sahara as a whole territory, following maptap's place labels",
    );
  });
});

describe('[DAT-C08] region-name overrides', () => {
  it('holds exactly the codes, names, mislabels and aliases the contract lists', () => {
    const table = Object.fromEntries(
      Object.entries(REGION_NAME_OVERRIDES).map(([code, o]) => [
        code,
        [o.name, o.mislabel === true, o.aliases ?? []],
      ]),
    );
    expect(table).toEqual({
      'IRL-713': ['Galway (county)', false, []],
      'IRL-5568': ['Galway (city)', false, []],
      'IRL-78': ['Cork (county)', false, []],
      'IRL-5569': ['Cork (city)', false, []],
      'IRL-726': ['Limerick (county)', false, []],
      'IRL-5570': ['Limerick (city)', false, []],
      'IRL-1444': ['Waterford (county)', false, []],
      'IRL-5571': ['Waterford (city)', false, []],
      'MOZ-1927': ['Maputo (province)', false, []],
      'MOZ-5854': ['Maputo (city)', false, []],
      'UZB-372': ['Tashkent (region)', false, []],
      'UZB-4828': ['Tashkent (city)', false, []],
      'AFG-1769': ['Panjshir', true, []],
      'AFG-1753': ['Daykundi', true, ['Wilayat-e Daykundi']],
      'HRV-1604': ['Požeško-Slavonska', true, ['Požega-Slavonia']],
      'UGA-3371': ['Kiruhura', true, ['Kiruhura District']],
      'HUN-3158': ['Veszprém (county)', false, []],
      'HUN-4909': ['Veszprém (city)', false, []],
    });
  });

  it('gives every override a reason', () => {
    const blank = Object.entries(REGION_NAME_OVERRIDES).filter(([, o]) => !o.reason.trim());
    expect(blank).toEqual([]);
  });
});

const NO_LAND = 'no NE 10m land of this country at this point';
const WATER = 'a feature on open water: no land at this point';

describe('[DAT-C09] containment allow-list', () => {
  it('holds exactly the places and reasons the contract lists', () => {
    const byReason: Record<string, string[]> = {};
    for (const [id, reason] of Object.entries(CONTAINMENT_ALLOW_LIST)) {
      (byReason[reason] ??= []).push(id);
    }
    for (const ids of Object.values(byReason)) ids.sort();
    expect(byReason).toEqual({
      [NO_LAND]: [
        'ailsa_craig_scotland',
        'balls_pyramid_australia',
        'bikini_atoll_marshall_islands',
        'danger_islands_antarctica',
        'devil',
        'fort_jefferson_dry_tortugas_national_park_united_states',
        'ilha_da_queimada_grande_sao_paulo_brazil',
        'inaccessible_island_tristan_da_cunha',
        'isla_martin_garcia_buenos_aires_argentina',
        'krakatoa',
        'machias_seal_island_usa_canada',
        'maya_bay',
        'mer_torres_strait_islands_queensland_australia',
        'montebello_islands_western_australia_australia',
        'nangan_matsu_islands_taiwan',
        'nukunonu_new_zealand',
        'perhentian_islands_malaysia',
        'saint_martin_s_island_bangladesh',
        'santa_cruz_del_islote_colombia',
        'skellig_michael_ireland',
      ],
      [WATER]: [
        'great_blue_hole',
        'kavachi_volcano_solomon_islands',
        'lake_pontchartrain_causeway_louisiana_usa',
      ],
      'border place resolved to the nearest country; NE 10m has no land of its own here': [
        'navassa_island_usa_haiti',
      ],
      'on NE 10m land; the simplified outline cuts this headland or peninsula': ['hel_poland'],
      'on NE 10m land; the simplified outline shrinks this small island': ['capri'],
    });
  });
});
