import { describe, expect, it } from 'vitest';
import {
  buildCurriculum,
  countryItemId,
  placeItemId,
  regionItemId,
  unlockedBy,
} from '../engine/curriculum';
import type { ItemProgress } from '../engine/srs';
import { gateFillers, withFillersMastered } from '../engine/gateFixtures';
import type { Country, Place } from '../engine/types';
import type { AreaFeature } from '../maps/geo';
import { childRows, resolveDrillRoute, sortOffMap, splitByFrame } from './drillView';
import { showsTestOutLink, testOutLabel, testOutPath } from './testOutView';

const countries: Country[] = [
  { id: 'fr', name: 'France', places: 2, hasRegions: true },
  { id: 'de', name: 'Germany', places: 1, hasRegions: true },
  { id: 'sg', name: 'Singapore', places: 1, hasRegions: false },
  { id: 'nowhere', name: 'Nowhere', places: 0, hasRegions: false },
];
const place = (id: string, country: string, region: string | null): Place => ({
  id,
  name: id.toUpperCase(),
  country,
  region,
  lat: 0,
  lng: 0,
  type: 'city',
  level: 1,
});
const places = [
  place('paris', 'fr', 'fr.idf'),
  place('lyon', 'fr', 'fr.ara'),
  place('berlin', 'de', 'de.be'),
  place('changi', 'sg', null),
];
// `fr.empty` has no places, so the curriculum drops it.
const regions = [
  { id: 'fr.idf', country: 'fr' },
  { id: 'fr.ara', country: 'fr' },
  { id: 'fr.empty', country: 'fr' },
  { id: 'de.be', country: 'de' },
];
// The fillers (placeless countries) are in the curriculum only, so `opened` can open every gate.
const fillers = gateFillers();
const curriculum = buildCurriculum([...countries, ...fillers], regions, places);

// Mastered: L3 passed on two different days.
const mastered = (itemId: string): ItemProgress =>
  ({
    itemId,
    rung: 3,
    highestRung: 3,
    cards: {},
    l3PassDays: ['2026-01-10', '2026-01-20'],
    inL3Lapse: false,
    introducedAt: 1,
  }) as unknown as ItemProgress;

/** `progress` with every filler mastered: every gate (CUR-21) is open. */
const opened = (progress: Record<string, ItemProgress>) =>
  withFillersMastered(progress, mastered('country:filler'), fillers);

describe('[SCR-13, SCR-C09] resolveDrillRoute', () => {
  const resolve = (c: string, r?: string) => resolveDrillRoute(curriculum, countries, c, r);

  it('resolves a known country, with whether it has a regions tier', () => {
    expect(resolve('fr')).toEqual({ kind: 'country', countryId: 'fr', hasRegions: true });
    expect(resolve('sg')).toEqual({ kind: 'country', countryId: 'sg', hasRegions: false });
  });

  it('resolves a country with no places', () => {
    expect(resolve('nowhere')).toMatchObject({ kind: 'country' });
  });

  it('sends an unknown country back to Progress', () => {
    expect(resolve('atlantis')).toEqual({ kind: 'not-found', back: '/progress' });
    expect(resolve('atlantis', 'fr.idf')).toEqual({ kind: 'not-found', back: '/progress' });
  });

  it('resolves a region of the country by its full id', () => {
    expect(resolve('fr', 'fr.idf')).toEqual({ kind: 'region', countryId: 'fr', regionId: 'fr.idf' });
  });

  it('sends a region of another country back to the country', () => {
    expect(resolve('fr', 'de.be')).toEqual({ kind: 'not-found', back: '/progress/fr' });
  });

  it('sends a region with no places, or an unknown one, back to the country', () => {
    expect(resolve('fr', 'fr.empty')).toEqual({ kind: 'not-found', back: '/progress/fr' });
    expect(resolve('fr', 'fr.nope')).toEqual({ kind: 'not-found', back: '/progress/fr' });
  });

  it('sends a region URL under a country without a regions tier back to the country', () => {
    expect(resolve('sg', 'sg.x')).toEqual({ kind: 'not-found', back: '/progress/sg' });
  });

  it('does not take a place id for a region id', () => {
    expect(resolve('sg', 'changi')).toEqual({ kind: 'not-found', back: '/progress/sg' });
  });
});

describe('[SCR-14, SCR-C09] childRows', () => {
  const names = new Map([
    [countryItemId('fr'), 'France'],
    [countryItemId('de'), 'Germany'],
    [regionItemId('fr.idf'), 'Ile-de-France'],
    [regionItemId('fr.ara'), 'Auvergne'],
    [placeItemId('paris'), 'Paris'],
  ]);

  it('lists a locked country’s regions with what unlocks them and a link each', () => {
    const rows = childRows(curriculum, {}, countryItemId('fr'), names);
    expect(rows.map((r) => [r.name, r.state, r.stateLabel, r.unlockText, r.href])).toEqual([
      ['Auvergne', 'locked', 'Locked', 'Master France to unlock', '/progress/fr/fr.ara'],
      ['Ile-de-France', 'locked', 'Locked', 'Master France to unlock', '/progress/fr/fr.idf'],
    ]);
  });

  it('shows the regions as new, with no unlock text, once the country is mastered', () => {
    const progress = opened({ [countryItemId('fr')]: mastered(countryItemId('fr')) });
    const rows = childRows(curriculum, progress, countryItemId('fr'), names);
    expect(rows.map((r) => [r.state, r.unlockText])).toEqual([
      ['new', null],
      ['new', null],
    ]);
  });

  it('holds a mastered country’s unanswered children behind its gate, saying when they open', () => {
    const fr = countryItemId('fr');
    const ara = regionItemId('fr.ara');
    const answered = { ...mastered(ara), l3PassDays: [], cards: { 1: { reps: 1 } } } as unknown as ItemProgress;
    const progress = { [fr]: mastered(fr), [ara]: answered };
    const rows = childRows(curriculum, progress, fr, names);
    expect(rows.map((r) => [r.name, r.state, r.unlockText])).toEqual([
      ['Auvergne', 'learning', null],
      ['Ile-de-France', 'locked', "Opens once you've mastered 150 countries (1 so far)"],
    ]);
  });

  it('lists a region’s places without links, naming the region that unlocks them', () => {
    const [row] = childRows(curriculum, {}, regionItemId('fr.idf'), names);
    expect(row).toMatchObject({
      name: 'Paris',
      tier: 'place',
      state: 'locked',
      unlockText: 'Master Ile-de-France to unlock',
      href: null,
    });
  });

  it('lists the places of a country without a regions tier', () => {
    const sg = countryItemId('sg');
    const rows = childRows(curriculum, {}, sg, new Map([[sg, 'Singapore']]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tier: 'place', state: 'locked', unlockText: 'Master Singapore to unlock' });
    const open = childRows(curriculum, opened({ [sg]: mastered(sg) }), sg, new Map());
    expect(open[0]).toMatchObject({ state: 'new', unlockText: null });
  });

  it('is empty for a country with no places', () => {
    expect(childRows(curriculum, {}, countryItemId('nowhere'), names)).toEqual([]);
  });
});

describe('[SCR-14, SCR-C09] childRows order', () => {
  it('sorts rows by name, whatever the curriculum order', () => {
    const names = new Map([
      [regionItemId('fr.idf'), 'Zeta'],
      [regionItemId('fr.ara'), 'alpha'],
    ]);
    const rows = childRows(curriculum, {}, countryItemId('fr'), names);
    expect(rows.map((r) => r.name)).toEqual(['alpha', 'Zeta']);
  });
});

describe('[SCR-16, SCR-C09] splitByFrame', () => {
  const square: AreaFeature = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 10],
          [10, 10],
          [10, 0],
          [0, 0],
        ],
      ],
    },
  };

  it('keeps points inside the fitted frame and sets outlying ones aside', () => {
    const items = [
      { id: 'in', at: [5, 5] as [number, number] },
      { id: 'far', at: [-150, 60] as [number, number] },
    ];
    const { onMap, off } = splitByFrame(square, items, (i) => i.at);
    expect(onMap.map((i) => i.id)).toEqual(['in']);
    expect(off.map((i) => i.id)).toEqual(['far']);
  });
});

describe('[SCR-16, SCR-C09] sortOffMap', () => {
  it('sorts regions and places together by name', () => {
    const entries = [
      { id: 'b', name: 'Navassa Island', isRegion: false },
      { id: 'a', name: 'Alaska', isRegion: true },
      { id: 'c', name: 'Gibraltar', isRegion: false },
    ];
    expect(sortOffMap(entries).map((e) => e.name)).toEqual(['Alaska', 'Gibraltar', 'Navassa Island']);
    expect(entries[0]?.name).toBe('Navassa Island');
  });
});

describe('[SCR-18, SCR-C09] the test-out link', () => {
  const fr = countryItemId('fr');
  const idf = regionItemId('fr.idf');
  const shows = (progress: Record<string, ItemProgress>, finished: string[] = [], itemId = fr) =>
    showsTestOutLink(curriculum, progress, new Set(finished), itemId);
  /** The link's tier, as the drill page words it: the plural of the child tier. */
  const linkTier = (itemId: string) => `${unlockedBy(curriculum, itemId)!.tier}s`;

  it('shows on a mastered item none of whose children is studied', () => {
    expect(shows(opened({ [fr]: mastered(fr) }))).toBe(true);
    expect(shows({ [idf]: mastered(idf) }, [], idf)).toBe(true);
  });

  it('hides on a mastered country whose gate is shut', () => {
    expect(shows({ [fr]: mastered(fr) })).toBe(false);
  });

  it('hides once the item’s test-out is finished', () => {
    expect(shows({ [fr]: mastered(fr) }, ['placement:country:fr'])).toBe(false);
  });

  it('does not show on an item that is not mastered', () => {
    expect(shows({})).toBe(false);
  });

  it('names the item and the child tier, and opens the item’s test-out page', () => {
    expect(linkTier(fr)).toBe('regions');
    expect(linkTier(countryItemId('sg'))).toBe('places');
    expect(testOutLabel('France', 'regions')).toBe("Test out of France's regions");
    expect(testOutPath(fr)).toBe('/placement/fr');
    expect(testOutPath(idf)).toBe('/placement/fr/fr.idf');
  });
});
