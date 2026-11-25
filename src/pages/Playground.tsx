import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import {
  loadCountries,
  loadRegions,
  type CountryFeature,
  type RegionFeature,
} from '../data/loaders';
import BareGlobe from '../maps/BareGlobe';
import { answerPoint, type LngLat, type TapTarget } from '../maps/geo';
import HighlightMap from '../maps/HighlightMap';
import OutlineView from '../maps/OutlineView';
import TapMap from '../maps/TapMap';
import { parseView, type GlobeView } from '../maps/view';

type Loaded<T> =
  { status: 'loading' } | { status: 'error'; error: Error } | { status: 'ready'; data: T };

/**
 * Run `load` for `key` (again on `retry`), tracking loading, error and result. A result is kept
 * with the key and attempt it answers, so a stale one reads as loading.
 */
function useLoaded<T>(key: string, load: () => Promise<T>): [Loaded<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ for: string; result: Loaded<T> } | null>(null);
  const current = `${key}#${attempt}`;
  useEffect(() => {
    let live = true;
    load().then(
      (data) => live && setSettled({ for: current, result: { status: 'ready', data } }),
      (error: unknown) =>
        live &&
        setSettled({
          for: current,
          result: {
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          },
        }),
    );
    return () => {
      live = false;
    };
    // `load` is keyed by `key`: a new closure for the same key is the same load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  const state = settled?.for === current ? settled.result : { status: 'loading' as const };
  return [state, () => setAttempt((a) => a + 1)];
}

function Status<T>({
  state,
  retry,
  children,
}: {
  state: Loaded<T>;
  retry: () => void;
  children: (data: T) => ReactNode;
}) {
  if (state.status === 'loading') return <p>Loading…</p>;
  if (state.status === 'error') {
    return (
      <div role="alert">
        <p>Could not load the map data: {state.error.message}</p>
        <button type="button" onClick={retry}>
          Retry
        </button>
      </div>
    );
  }
  return children(state.data);
}

function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="playground-panel" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

const DEFAULT_COUNTRY = 'france';
const NO_REGIONS: RegionFeature[] = [];

/** Dev-only: every map component for one country, to try by hand and drive from e2e. */
export default function Playground() {
  const [params] = useSearchParams();
  const initialView = useMemo(() => parseView(params.get('view')), [params]);
  const [countries, retry] = useLoaded('countries', loadCountries);
  const [countryId, setCountryId] = useState(DEFAULT_COUNTRY);

  return (
    <>
      <h1>Map playground</h1>
      <Status state={countries} retry={retry}>
        {({ features }) => {
          const country = features.find((f) => f.id === countryId) ?? features[0]!;
          const sorted = [...features].sort((a, b) =>
            a.properties.name.localeCompare(b.properties.name),
          );
          return (
            <>
              <label className="playground-picker">
                Country{' '}
                <select value={country.id} onChange={(e) => setCountryId(e.target.value)}>
                  {sorted.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.properties.name}
                    </option>
                  ))}
                </select>
              </label>
              <CountryMaps
                key={country.id}
                world={features}
                country={country}
                initialView={initialView}
              />
            </>
          );
        }}
      </Status>
    </>
  );
}

type PinnedMap = 'tap' | 'bare' | 'bordered';

function CountryMaps({
  world,
  country,
  initialView,
}: {
  world: CountryFeature[];
  country: CountryFeature;
  initialView?: GlobeView;
}) {
  const hasRegions = country.properties.hasRegions;
  const [regions, retryRegions] = useLoaded(`regions:${country.id}`, () =>
    hasRegions ? loadRegions(country.id) : Promise.resolve({ features: NO_REGIONS, regions: [] }),
  );
  const [pins, setPins] = useState<Record<PinnedMap, LngLat | null>>({
    tap: null,
    bare: null,
    bordered: null,
  });
  const [lastPin, setLastPin] = useState<LngLat | null>(null);
  const [revealed, setRevealed] = useState(false);
  const pinOn = (map: PinnedMap) => (at: LngLat) => {
    setPins((p) => ({ ...p, [map]: at }));
    setLastPin(at);
  };
  const countryTarget = useMemo<TapTarget | undefined>(
    () => (revealed ? { feature: country, answer: answerPoint(country) } : undefined),
    [revealed, country],
  );

  return (
    <>
      <div className="playground-controls">
        <label>
          <input
            type="checkbox"
            checked={revealed}
            onChange={(e) => setRevealed(e.target.checked)}
          />{' '}
          Reveal
        </label>
        <p>
          Last pin:{' '}
          <output data-testid="last-pin">
            {lastPin ? `${lastPin[0].toFixed(2)}, ${lastPin[1].toFixed(2)}` : 'none'}
          </output>
        </p>
      </div>
      <div className="playground-grid">
        <Panel id="pg-outline" title="Outline">
          <OutlineView feature={country} point={answerPoint(country)} />
        </Panel>
        <Panel id="pg-highlight-globe" title="Highlight (globe)">
          <HighlightMap mode="globe" features={world} highlightId={country.id} />
        </Panel>
        <Status state={regions} retry={retryRegions}>
          {({ features }) => {
            const tapFeatures = features.length > 0 ? features : [country];
            const first = tapFeatures[0]!;
            return (
              <>
                <Panel id="pg-highlight-fit" title="Highlight (fit)">
                  <HighlightMap mode="fit" features={tapFeatures} highlightId={first.id} />
                </Panel>
                <Panel id="pg-tap" title={features.length > 0 ? 'Tap map (regions)' : 'Tap map'}>
                  <TapRevealed
                    features={tapFeatures}
                    target={first}
                    revealed={revealed}
                    pin={pins.tap}
                    onPin={pinOn('tap')}
                  />
                </Panel>
              </>
            );
          }}
        </Status>
        <Panel id="pg-bare-globe" title="Bare globe">
          <BareGlobe
            features={world}
            pin={pins.bare}
            onPin={pinOn('bare')}
            initialView={initialView}
            reveal={countryTarget}
          />
        </Panel>
        <Panel id="pg-bordered-globe" title="Bordered globe">
          <BareGlobe
            features={world}
            borders
            pin={pins.bordered}
            onPin={pinOn('bordered')}
            initialView={initialView}
            reveal={countryTarget}
          />
        </Panel>
      </div>
    </>
  );
}

/** The tap map with its first feature as the revealed target. */
function TapRevealed({
  features,
  target,
  revealed,
  pin,
  onPin,
}: {
  features: (CountryFeature | RegionFeature)[];
  target: CountryFeature | RegionFeature;
  revealed: boolean;
  pin: LngLat | null;
  onPin: (at: LngLat) => void;
}) {
  const reveal = useMemo<TapTarget | undefined>(
    () => (revealed ? { feature: target, answer: answerPoint(target) } : undefined),
    [revealed, target],
  );
  return <TapMap features={features} pin={pin} onPin={onPin} reveal={reveal} />;
}
