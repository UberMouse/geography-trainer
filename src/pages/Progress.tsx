import {
  Anchor,
  Button,
  ColorSwatch,
  Group,
  List,
  NativeSelect,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { tierCounts, type ItemState, type Tier } from '../engine/curriculum';
import Status from './LoadStatus';
import {
  PROGRESS_COLOURS,
  STATE_LABELS,
  countryLooks,
  countryOptions,
  startedCountries,
  tierCountText,
} from './progressView';
import { useCountriesGlobe } from './useCountriesGlobe';
import { useLoaded } from './useLoaded';
import { loadWorldData, type WorldData } from './worldData';

const TIERS: Tier[] = ['country', 'region', 'place'];
const LEGEND: ItemState[] = ['locked', 'new', 'learning', 'mastered'];

/** A legend entry: its colour's swatch and what it means. */
function LegendEntry({ colour, children }: { colour: string; children: string }) {
  return (
    <Group component="li" gap={6} wrap="nowrap" align="flex-start">
      <ColorSwatch color={colour} size={14} radius={0} withShadow={false} mt={4} />
      <Text size="sm">{children}</Text>
    </Group>
  );
}

/** The per-tier counts, the legend, a way to any country and the started countries, beside the globe. */
export default function Progress() {
  const [data, reload] = useLoaded('progress', loadWorldData);
  return (
    <Stack>
      <Title order={1}>Progress</Title>
      <Status
        state={data}
        retry={reload}
        failure="Could not load the map data or your saved progress:"
      >
        {(loaded) => <ProgressContent data={loaded} />}
      </Status>
    </Stack>
  );
}

function ProgressContent({ data }: { data: WorldData }) {
  const navigate = useNavigate();
  const { curriculum } = data;
  const counts = useMemo(() => tierCounts(curriculum, data.progress), [curriculum, data.progress]);
  const looks = useMemo(
    () => countryLooks(curriculum, data.progress, data.countries.countries),
    [curriculum, data.progress, data.countries],
  );
  const started = useMemo(
    () => startedCountries(data.countries.countries, looks),
    [data.countries, looks],
  );
  const options = useMemo(() => countryOptions(data.countries.countries), [data.countries]);
  useCountriesGlobe(data, looks);
  const [chosen, setChosen] = useState('');
  const go = (event: FormEvent) => {
    event.preventDefault();
    if (chosen) navigate(`/progress/${chosen}`);
  };
  return (
    <Stack>
      <List listStyleType="none" spacing={2}>
        {TIERS.map((tier) => (
          <List.Item key={tier} data-testid={`tier-${tier}`}>
            {tierCountText(tier, counts[tier])}
          </List.Item>
        ))}
      </List>
      <Stack component="ul" gap={4} m={0} p={0} aria-label="Legend" style={{ listStyle: 'none' }}>
        {LEGEND.map((state) => (
          <LegendEntry key={state} colour={PROGRESS_COLOURS[state]}>
            {state === 'mastered'
              ? `${STATE_LABELS[state]} (deeper as its regions and places are mastered)`
              : STATE_LABELS[state]}
          </LegendEntry>
        ))}
        <LegendEntry colour={PROGRESS_COLOURS.complete}>Everything below it mastered</LegendEntry>
      </Stack>
      <form onSubmit={go}>
        <Group align="flex-end" gap="xs" wrap="nowrap">
          <NativeSelect
            label="Go to a country"
            value={chosen}
            onChange={(event) => setChosen(event.currentTarget.value)}
            data={[{ value: '', label: 'Choose a country' }, ...options.map(({ id, name }) => ({ value: id, label: name }))]}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Button type="submit" disabled={!chosen}>
            Go
          </Button>
        </Group>
      </form>
      <Title order={2} size="h4">
        Countries you have started
      </Title>
      {started.length === 0 ? (
        <Text>
          You haven&apos;t started any countries yet.{' '}
          <Anchor component={Link} to="/session">
            Start
          </Anchor>
        </Text>
      ) : (
        <List listStyleType="none" spacing={2} data-testid="started-countries">
          {started.map(({ country, state }) => (
            <List.Item key={country.id}>
              <Anchor component={Link} to={`/progress/${country.id}`}>
                {country.name}
              </Anchor>
              : {STATE_LABELS[state]}
            </List.Item>
          ))}
        </List>
      )}
    </Stack>
  );
}
