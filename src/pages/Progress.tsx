import {
  Anchor,
  Button,
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
import ProgressLegend from './ProgressLegend';
import {
  STATE_LABELS,
  countryLooks,
  countryOptions,
  startedCountries,
  tierCountText,
} from './progressView';
import { useCountriesGlobe } from './useCountriesGlobe';
import { useLoaded } from './useLoaded';
import { usePageTitle } from '../components/usePageTitle';
import { loadWorldData, type WorldData } from './worldData';

const TIERS: Tier[] = ['country', 'region', 'place'];
const LEGEND: ItemState[] = ['locked', 'new', 'learning', 'mastered'];


/** The per-tier counts, the legend, a way to any country and the started countries, beside the globe. */
export default function Progress() {
  usePageTitle('Progress');
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
      <ProgressLegend states={LEGEND} />
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
