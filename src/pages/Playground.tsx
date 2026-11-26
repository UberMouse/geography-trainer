import { geoContains } from 'd3-geo';
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { Link, useHref, useSearchParams } from 'react-router';
import {
  loadCountries,
  loadRegions,
  type CountryFeature,
  type RegionFeature,
} from '../data/loaders';
import BareGlobe from '../maps/BareGlobe';
import { answerPoint, mainPart, type LngLat, type TapTarget } from '../maps/geo';
import HighlightMap from '../maps/HighlightMap';
import OutlineView from '../maps/OutlineView';
import TapMap from '../maps/TapMap';
import { parseView, type GlobeView } from '../maps/view';
import ExercisePlayground from './ExercisePlayground';
import Status from './LoadStatus';
import { useLoaded } from './useLoaded';

function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="playground-panel" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

// Lazy, so Mantine and its CSS load only when the Globe tab opens. Pure, so a production build,
// where the playground route is gone, drops the call and never emits the tab's chunk.
const GlobePlayground = /* @__PURE__ */ lazy(() => import('./GlobePlayground'));

const DEFAULT_COUNTRY = 'france';
const NO_REGIONS: RegionFeature[] = [];

/**
 * Dev-only: every map component for one country, or (with `?mode=exercises`, or an `item` or
 * `rung` in the URL) one exercise, to try by hand and drive from e2e.
 */
export default function Playground() {
  const [params] = useSearchParams();
  const view = params.get('view');
  const initialView = useMemo(() => parseView(view), [view]);
  const [countries, retry] = useLoaded('countries', loadCountries);
  const [countryId, setCountryId] = useState(DEFAULT_COUNTRY);
  const mode = params.get('mode');
  const tab: 'maps' | 'exercises' | 'globe' =
    mode === 'globe'
      ? 'globe'
      : mode === 'exercises' || params.has('item') || params.has('rung')
        ? 'exercises'
        : 'maps';
  const current = (on: typeof tab) => (tab === on ? 'page' : undefined);
  // A full page load, so the Globe tab is always its own document: Mantine's global styles, once
  // loaded, never reach the other tabs, even through Back and Forward.
  const globeHref = useHref('/playground?mode=globe');

  if (tab === 'globe') {
    // The Globe tab covers the whole page, and its panel carries its own links to the others.
    return (
      <Suspense fallback={<p>Loading…</p>}>
        <GlobePlayground />
      </Suspense>
    );
  }

  return (
    <>
      <h1>Map playground</h1>
      <nav className="playground-controls" aria-label="Playground">
        <Link to="/playground" aria-current={current('maps')}>
          Maps
        </Link>
        <Link to="/playground?mode=exercises" aria-current={current('exercises')}>
          Exercises
        </Link>
        <a href={globeHref}>Globe</a>
      </nav>
      <Status state={countries} retry={retry}>
        {(data) => {
          if (tab === 'exercises')
            return <ExercisePlayground countries={data} initialView={initialView} />;
          const { features } = data;
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
  // Stable across renders: a new array would make the tap map treat it as a new map.
  const loadedRegions = regions.status === 'ready' ? regions.data.features : NO_REGIONS;
  const tapFeatures = useMemo(
    () => (loadedRegions.length > 0 ? loadedRegions : [country]),
    [loadedRegions, country],
  );
  const [pins, setPins] = useState<Record<PinnedMap, LngLat | null>>({
    tap: null,
    bare: null,
    bordered: null,
  });
  const [lastPin, setLastPin] = useState<LngLat | null>(null);
  const [revealed, setRevealed] = useState(false);
  const frame = mainPart(country);
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
            // Highlight and reveal a region that shows in the frame.
            const shown =
              tapFeatures.find((f) => geoContains(frame, answerPoint(f))) ?? tapFeatures[0]!;
            return (
              <>
                <Panel id="pg-highlight-fit" title="Highlight (fit)">
                  <HighlightMap
                    mode="fit"
                    features={tapFeatures}
                    highlightId={shown.id}
                    frame={frame}
                  />
                </Panel>
                <Panel id="pg-tap" title={features.length > 0 ? 'Tap map (regions)' : 'Tap map'}>
                  <TapRevealed
                    features={tapFeatures}
                    frame={frame}
                    target={shown}
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

/** The tap map with `target` as the revealed target. */
function TapRevealed({
  features,
  frame,
  target,
  revealed,
  pin,
  onPin,
}: {
  features: (CountryFeature | RegionFeature)[];
  frame: CountryFeature;
  target: CountryFeature | RegionFeature;
  revealed: boolean;
  pin: LngLat | null;
  onPin: (at: LngLat) => void;
}) {
  const reveal = useMemo<TapTarget | undefined>(
    () => (revealed ? { feature: target, answer: answerPoint(target) } : undefined),
    [revealed, target],
  );
  return <TapMap features={features} frame={frame} pin={pin} onPin={onPin} reveal={reveal} />;
}
