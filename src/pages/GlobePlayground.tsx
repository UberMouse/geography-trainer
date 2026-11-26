import {
  Anchor,
  Button,
  Group,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  loadCountries,
  loadPlaces,
  loadRegions,
  type CountryFeature,
  type RegionFeature,
} from '../data/loaders';
import { maptapScore } from '../engine/grading';
import type { Place } from '../engine/types';
import { answerPoint, measureTap, type IdentifiedFeature, type LngLat } from '../maps/geo';
import type { GlobeMarker } from '../maps/Globe';
import { useGlobe } from '../maps/globeContext';
import type { GlobeMode, GlobeModeKind, Reveal } from '../maps/globeLayers';
import Status from './LoadStatus';
import { useLoaded } from './useLoaded';

const DEMO_CHOICES = ['Choice A', 'Choice B', 'Choice C', 'Choice D'];
const DEFAULT_COUNTRY = 'france';
const MODES: { value: GlobeModeKind; label: string }[] = [
  { value: 'bare', label: 'Bare' },
  { value: 'countryBorders', label: 'Country borders' },
  { value: 'regionBorders', label: 'Region borders' },
  { value: 'highlight', label: 'Highlight' },
  { value: 'progress', label: 'Progress' },
];
const DEMO_PALETTE = ['#40c057', '#fab005', '#fa5252', '#228be6'];

type HighlightKind = 'country' | 'region' | 'place';
type ProgressTier = 'countries' | 'regions';

/** Demo fills for a tier: by id, every third feature left out, the rest in the palette's colours in turn. */
function demoFills(features: IdentifiedFeature[]): Record<string, string> {
  const fills: Record<string, string> = {};
  let k = 0;
  [...features]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .forEach((f, i) => {
      if (i % 3 !== 2) fills[f.id] = DEMO_PALETTE[k++ % DEMO_PALETTE.length]!;
    });
  return fills;
}

/** The country's place with the highest `pop` (none counts as 0), the earlier one on a tie. */
function mostPopulous(places: Place[], countryId: string): Place | undefined {
  let best: Place | undefined;
  for (const p of places) {
    if (p.country === countryId && (!best || (p.pop ?? 0) > (best.pop ?? 0))) best = p;
  }
  return best;
}

const byName = (a: RegionFeature, b: RegionFeature) =>
  a.properties.name.localeCompare(b.properties.name);

/** Dev-only: the playground's Globe tab, a column to try the shared globe's modes, taps and reveal. */
export default function GlobePlayground() {
  const [data, retry] = useLoaded('globe-playground', () =>
    Promise.all([loadCountries(), loadPlaces()]),
  );
  return (
    <Status state={data} retry={retry}>
      {([countries, places]) => (
        <GlobeTab
          countries={countries.features}
          places={places}
          nav={
            <Group component="nav" aria-label="Playground tabs">
              <Anchor component={Link} to="/playground?mode=exercises">
                Exercises
              </Anchor>
            </Group>
          }
        />
      )}
    </Status>
  );
}

function GlobeTab({
  countries,
  places,
  nav,
}: {
  countries: CountryFeature[];
  places: Place[];
  nav: ReactNode;
}) {
  const [modeKind, setModeKind] = useState<GlobeModeKind>('countryBorders');
  const [countryId, setCountryId] = useState(DEFAULT_COUNTRY);
  const [highlightKind, setHighlightKind] = useState<HighlightKind>('country');
  const [regionId, setRegionId] = useState<string | null>(null);
  const [tier, setTier] = useState<ProgressTier>('countries');
  const [showReveal, setShowReveal] = useState(false);
  const [lastTap, setLastTap] = useState<LngLat | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const country = countries.find((c) => c.id === countryId) ?? countries[0]!;
  const hasRegions = country.properties.hasRegions;
  const [regionsState, retryRegions] = useLoaded(`globe-regions:${country.id}`, () =>
    hasRegions ? loadRegions(country.id) : Promise.resolve(null),
  );
  const regionsData = regionsState.status === 'ready' ? regionsState.data : null;
  // Absent while loading, after a failure and without a regions tier: the globe draws the outline.
  const regions = useMemo(() => regionsData?.features.slice().sort(byName), [regionsData]);
  const region = regions?.find((r) => r.id === regionId) ?? regions?.[0];
  const place = useMemo(() => mostPopulous(places, country.id), [places, country.id]);

  const countryOptions = useMemo(
    () =>
      countries
        .map((c) => ({ value: c.id, label: c.properties.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [countries],
  );

  // Fall back to the country when the chosen kind is not available for this country.
  const effectiveHighlight: HighlightKind =
    (highlightKind === 'region' && !region) || (highlightKind === 'place' && !place)
      ? 'country'
      : highlightKind;
  const effectiveTier: ProgressTier = tier === 'regions' && !regions ? 'countries' : tier;

  const mode = useMemo((): GlobeMode => {
    switch (modeKind) {
      case 'bare':
        return { kind: 'bare' };
      case 'countryBorders':
        return { kind: 'countryBorders', countries };
      case 'regionBorders':
        return { kind: 'regionBorders', country, regions };
      case 'highlight': {
        if (effectiveHighlight === 'region' && region && regions) {
          return {
            kind: 'highlight',
            target: { kind: 'region', feature: region, country, regions },
          };
        }
        if (effectiveHighlight === 'place' && place) {
          return {
            kind: 'highlight',
            target: { kind: 'place', place, country, regions },
          };
        }
        return { kind: 'highlight', target: { kind: 'country', feature: country, countries } };
      }
      case 'progress': {
        const features: IdentifiedFeature[] =
          effectiveTier === 'regions' && regions ? regions : countries;
        return { kind: 'progress', features, fills: demoFills(features) };
      }
    }
  }, [modeKind, countries, country, regions, region, effectiveHighlight, effectiveTier, place]);

  const answer = useMemo(() => answerPoint(country), [country]);
  const reveal = useMemo(
    (): Reveal | null =>
      showReveal && lastTap
        ? { target: { kind: 'area', feature: country }, tap: { at: lastTap, answer } }
        : null,
    [showReveal, lastTap, country, answer],
  );
  const measured = reveal?.tap ? measureTap({ feature: country, answer }, reveal.tap.at) : null;

  // The reveal names its target on the globe.
  const markers = useMemo(
    (): GlobeMarker[] | undefined =>
      reveal ? [{ kind: 'name', at: answer, text: country.properties.name }] : undefined,
    [reveal, answer, country],
  );
  const globe = useGlobe({ mode, reveal, markers, onTap: setLastTap, onSelect: setSelected });

  const usesCountry =
    modeKind === 'regionBorders' || modeKind === 'highlight' || modeKind === 'progress';

  return (
    <Stack>
      {nav}
      <Title order={1} size="h3">
        Globe playground
      </Title>
      {/* First, so a question's four choices fit above the fold of a phone's panel. */}
      <SimpleGrid cols={2}>
        {DEMO_CHOICES.map((label) => (
          <Button key={label} variant="default" data-testid="demo-choice">
            {label}
          </Button>
        ))}
      </SimpleGrid>
      <Select
        label="Mode"
        data={MODES}
        value={modeKind}
        onChange={(v) => v && setModeKind(v as GlobeModeKind)}
        allowDeselect={false}
      />
      {usesCountry ? (
        <Select
          label="Country"
          searchable
          data={countryOptions}
          value={country.id}
          onChange={(v) => v && setCountryId(v)}
          allowDeselect={false}
        />
      ) : null}
      {modeKind === 'highlight' ? (
        <>
          <SegmentedControl
            aria-label="Highlight target"
            value={effectiveHighlight}
            onChange={(v) => setHighlightKind(v as HighlightKind)}
            data={[
              { value: 'country', label: 'Country' },
              { value: 'region', label: 'Region', disabled: !region },
              { value: 'place', label: 'Place', disabled: !place },
            ]}
          />
          <Select
            label="Region"
            data={(regions ?? []).map((r) => ({ value: r.id, label: r.properties.name }))}
            value={region?.id ?? null}
            onChange={(v) => v && setRegionId(v)}
            disabled={!regions}
            description={hasRegions ? undefined : 'No regions tier'}
            allowDeselect={false}
          />
          {effectiveHighlight === 'place' && place ? (
            <Text size="sm">Place: {place.name}</Text>
          ) : null}
        </>
      ) : null}
      {modeKind === 'progress' ? (
        <SegmentedControl
          aria-label="Progress tier"
          value={effectiveTier}
          onChange={(v) => setTier(v as ProgressTier)}
          data={[
            { value: 'countries', label: 'World countries' },
            { value: 'regions', label: 'Its regions', disabled: !regions },
          ]}
        />
      ) : null}
      {hasRegions ? (
        <Status state={regionsState} retry={retryRegions} failure="Could not load the regions:">
          {() => null}
        </Status>
      ) : null}
      <Group>
        <Button variant="default" onClick={() => globe.fitFeature(country)}>
          Fit country
        </Button>
        <Switch
          label="Show reveal"
          checked={showReveal}
          onChange={(e) => setShowReveal(e.currentTarget.checked)}
        />
      </Group>
      <Text size="sm">
        Last tap:{' '}
        <span data-testid="globe-last-tap">
          {lastTap ? `${lastTap[0].toFixed(2)}, ${lastTap[1].toFixed(2)}` : 'none'}
        </span>
      </Text>
      {measured ? (
        <Text size="sm">
          {measured.inside ? 'Inside' : 'Outside'} {country.properties.name},{' '}
          {Math.round(measured.kmFromAnswer)} km from its answer point, maptap score{' '}
          {maptapScore(measured.kmFromAnswer, measured.inside)}
        </Text>
      ) : null}
      {modeKind === 'progress' ? (
        <Text size="sm">
          Selected: <span data-testid="globe-selected">{selected ?? 'none'}</span>
        </Text>
      ) : null}
    </Stack>
  );
}
