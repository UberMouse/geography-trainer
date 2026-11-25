import { geoContains } from 'd3-geo';
import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
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
            const tapFeatures = features.length > 0 ? features : [country];
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
