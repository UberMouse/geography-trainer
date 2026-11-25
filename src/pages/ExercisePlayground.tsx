import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { countryItemId, placeItemId, regionItemId, type Tier } from '../engine/curriculum';
import { mulberry32 } from '../engine/rng';
import type { Rung } from '../engine/srs';
import type { Place } from '../engine/types';
import { loadPlaces, loadRegions, type CountriesData, type RegionsData } from '../data/loaders';
import Exercise from '../exercises/Exercise';
import { buildExerciseItem } from '../exercises/item';
import { RATING_LABEL, formatKm } from '../exercises/result';
import type { ExerciseResult } from '../exercises/types';
import { targetPoint } from '../maps/geo';
import type { GlobeView } from '../maps/view';
import Status from './LoadStatus';
import { useLoaded } from './useLoaded';

const DEFAULT_ITEM = 'country:france';
const RUNGS: Rung[] = [1, 2, 3, 4];
const TIERS: Tier[] = ['country', 'region', 'place'];

const parseRung = (text: string | null): Rung => {
  const n = Number(text);
  return RUNGS.includes(n as Rung) ? (n as Rung) : 1;
};

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/** The tier and plain country id of a namespaced item id, or null when they cannot be found. */
function locate(itemId: string, places: Place[]): { tier: Tier; countryId: string } | null {
  const [tier, id = ''] = itemId.split(/:(.*)/s);
  if (tier === 'country') return { tier, countryId: id };
  if (tier === 'region') return { tier, countryId: id.split('.')[0]! };
  if (tier === 'place') {
    const place = places.find((p) => p.id === id);
    return place ? { tier, countryId: place.country } : null;
  }
  return null;
}

/** A small deterministic 32-bit string hash (FNV-1a). */
function hashOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * Dev-only: run one exercise. The item and rung live in the URL (`?item=<id>&rung=<1-4>`, and the
 * globes start from `?view=`), so e2e can open any question directly.
 */
export default function ExercisePlayground({
  countries,
  initialView,
}: {
  countries: CountriesData;
  initialView?: GlobeView;
}) {
  const [places, retry] = useLoaded('places', loadPlaces);
  return (
    <Status state={places} retry={retry}>
      {(data) => <Picker countries={countries} places={data} initialView={initialView} />}
    </Status>
  );
}

function Picker({
  countries,
  places,
  initialView,
}: {
  countries: CountriesData;
  places: Place[];
  initialView?: GlobeView;
}) {
  const [params, setParams] = useSearchParams();
  const [seed, setSeed] = useState(1);
  const [last, setLast] = useState<ExerciseResult | null>(null);
  const itemId = params.get('item') ?? DEFAULT_ITEM;
  const rung = parseRung(params.get('rung'));
  const located = locate(itemId, places);
  const country = countries.countries.find((c) => c.id === located?.countryId);
  const needsRegions = !!country?.hasRegions && located?.tier !== 'country';
  const [regions, retryRegions] = useLoaded<RegionsData | undefined>(
    `regions:${needsRegions ? country.id : ''}`,
    () => (needsRegions ? loadRegions(country.id) : Promise.resolve(undefined)),
  );

  const set = (changes: Record<string, string>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) next.set(k, v);
        return next;
      },
      { replace: true },
    );

  /** The first item of `tier` in country `countryId`, from data that is always loaded. */
  const firstItem = (tier: Tier, countryId: string): string => {
    const own = places.filter((p) => p.country === countryId).sort(byName);
    if (tier === 'place' && own[0]) return placeItemId(own[0].id);
    const regionIds = [...new Set(own.map((p) => p.region).filter((r) => r !== null))].sort();
    if (tier === 'region' && regionIds[0]) return regionItemId(regionIds[0]);
    return countryItemId(countryId);
  };

  if (!located || !country) {
    return (
      <div role="alert">
        <p>Unknown item “{itemId}”.</p>
        <button type="button" onClick={() => set({ item: DEFAULT_ITEM })}>
          Show {DEFAULT_ITEM}
        </button>
      </div>
    );
  }

  const tierAvailable = (tier: Tier) =>
    tier === 'country' || (country.places > 0 && (tier === 'place' || country.hasRegions));
  const sortedCountries = [...countries.countries].sort(byName);

  return (
    <>
      <div className="playground-controls">
        <label>
          Tier{' '}
          <select
            value={located.tier}
            onChange={(e) => set({ item: firstItem(e.target.value as Tier, country.id) })}
          >
            {TIERS.map((t) => (
              <option key={t} value={t} disabled={!tierAvailable(t)}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Country{' '}
          <select
            value={country.id}
            onChange={(e) => {
              const c = countries.countries.find((x) => x.id === e.target.value)!;
              const tier =
                c.places > 0 && (c.hasRegions || located.tier !== 'region')
                  ? located.tier
                  : 'country';
              set({ item: firstItem(tier, c.id) });
            }}
          >
            {sortedCountries.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rung{' '}
          <select value={rung} onChange={(e) => set({ rung: e.target.value })}>
            {RUNGS.map((r) => (
              <option key={r} value={r}>
                L{r}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Status state={regions} retry={retryRegions}>
        {(regionsData) => (
          <Run
            key={`${itemId}:${rung}`}
            itemId={itemId}
            rung={rung}
            tier={located.tier}
            countryId={country.id}
            countries={countries}
            places={places}
            regions={regionsData}
            initialView={initialView}
            onSelect={(item) => set({ item })}
            seed={seed}
            onSeedUsed={() => setSeed((s) => s + 1)}
            onAnswer={setLast}
          />
        )}
      </Status>
      <LastResult result={last} />
    </>
  );
}

/** The item list for the picker: every country, the country's regions with places, or its places. */
function itemsOf(
  tier: Tier,
  countryId: string,
  data: { countries: CountriesData; places: Place[]; regions?: RegionsData },
): { id: string; name: string }[] {
  if (tier === 'country') {
    return data.countries.countries
      .map((c) => ({ id: countryItemId(c.id), name: c.name }))
      .sort(byName);
  }
  if (tier === 'region') {
    return (data.regions?.regions ?? [])
      .filter((r) => r.places > 0)
      .map((r) => ({ id: regionItemId(r.id), name: r.name }))
      .sort(byName);
  }
  return data.places
    .filter((p) => p.country === countryId)
    .map((p) => ({ id: placeItemId(p.id), name: p.name }))
    .sort(byName);
}

function Run({
  itemId,
  rung,
  tier,
  countryId,
  countries,
  places,
  regions,
  initialView,
  onSelect,
  seed,
  onSeedUsed,
  onAnswer,
}: {
  itemId: string;
  rung: Rung;
  tier: Tier;
  countryId: string;
  countries: CountriesData;
  places: Place[];
  regions?: RegionsData;
  initialView?: GlobeView;
  onSelect: (itemId: string) => void;
  seed: number;
  onSeedUsed: () => void;
  onAnswer: (result: ExerciseResult) => void;
}) {
  // Bumped by Next when the item list has one item, so the question still starts afresh.
  const [round, setRound] = useState(0);
  const data = useMemo(() => ({ countries, places, regions }), [countries, places, regions]);
  const built = useMemo(() => {
    try {
      return { item: buildExerciseItem(itemId, data) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [itemId, data]);
  const items = useMemo(() => itemsOf(tier, countryId, data), [tier, countryId, data]);
  // Seed, item and round hashed together (XOR collides), so each item shuffles its options
  // differently yet reproducibly.
  const exerciseSeed = hashOf(`${seed}:${itemId}:${round}`);

  const random = () => {
    const pick = items[Math.floor(mulberry32(seed)() * items.length)];
    onSeedUsed();
    if (pick) onSelect(pick.id);
  };
  const next = () => {
    const at = items.findIndex((i) => i.id === itemId);
    const pick = items[(at + 1) % items.length];
    if (pick && pick.id !== itemId) onSelect(pick.id);
    else setRound((r) => r + 1);
  };

  if ('error' in built)
    return (
      <p role="alert">
        Could not build “{itemId}”: {built.error}
      </p>
    );
  const { item } = built;
  const [lng, lat] = targetPoint(item.target);

  return (
    <>
      <div className="playground-controls">
        {tier !== 'country' && (
          <label>
            Item{' '}
            <select value={itemId} onChange={(e) => onSelect(e.target.value)}>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={random}>
          Random item (seed {seed})
        </button>
      </div>
      <p className="playground-item">
        <code data-testid="item-id">{item.id}</code> · answer{' '}
        <span data-testid="item-answer">
          {lng.toFixed(2)},{lat.toFixed(2)}
        </span>
        {item.onGlobe && ' · on the globe'}
      </p>
      <Exercise
        key={`${seed}:${round}`}
        item={item}
        rung={rung}
        seed={exerciseSeed}
        onAnswer={onAnswer}
        onNext={next}
        initialView={initialView}
      />
    </>
  );
}

function LastResult({ result: last }: { result: ExerciseResult | null }) {
  return (
    <section aria-labelledby="pg-last-result">
      <h2 id="pg-last-result" className="playground-subhead">
        Last result
      </h2>
      <dl className="playground-result" data-testid="last-result">
        <dt>Rating</dt>
        <dd data-testid="last-rating">{last ? RATING_LABEL[last.rating] : '–'}</dd>
        <dt>Correct</dt>
        <dd data-testid="last-correct">{last ? String(last.correct) : '–'}</dd>
        <dt>Time</dt>
        <dd>{last ? `${Math.round(last.timeMs)} ms` : '–'}</dd>
        <dt>km</dt>
        <dd data-testid="last-km">{last?.km !== undefined ? formatKm(last.km) : '–'}</dd>
        <dt>maptap score</dt>
        <dd data-testid="last-score">{last?.maptapScore ?? '–'}</dd>
      </dl>
    </section>
  );
}
