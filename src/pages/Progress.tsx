import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { tierCounts, type ItemState, type Tier } from '../engine/curriculum';
import ProgressMap, { type ProgressFeature } from '../maps/ProgressMap';
import Status from './LoadStatus';
import {
  STATE_LABELS,
  countryLooks,
  countryOptions,
  lookOrLocked,
  startedCountries,
  tierCountText,
} from './progressView';
import { useLoaded } from './useLoaded';
import { loadWorldData, type WorldData } from './worldData';

const TIERS: Tier[] = ['country', 'region', 'place'];
const LEGEND: ItemState[] = ['locked', 'new', 'learning', 'mastered'];

/** The per-tier counts, a world map coloured by country progress, and the started countries. */
export default function Progress() {
  const [data, reload] = useLoaded('progress', loadWorldData);
  return (
    <>
      <h1>Progress</h1>
      <Status
        state={data}
        retry={reload}
        failure="Could not load the map data or your saved progress:"
      >
        {(loaded) => <ProgressContent data={loaded} />}
      </Status>
    </>
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
  const [chosen, setChosen] = useState('');
  const go = (event: FormEvent) => {
    event.preventDefault();
    if (chosen) navigate(`/progress/${chosen}`);
  };
  return (
    <>
      <ul className="progress-counts">
        {TIERS.map((tier) => (
          <li key={tier} data-testid={`tier-${tier}`}>
            {tierCountText(tier, counts[tier])}
          </li>
        ))}
      </ul>
      <ProgressMap
        features={data.countries.features as ProgressFeature[]}
        look={lookOrLocked(looks)}
        onSelect={(id) => navigate(`/progress/${id}`)}
      />
      <ul className="progress-legend" aria-label="Legend">
        {LEGEND.map((state) => (
          <li key={state}>
            <span className="progress-swatch" style={{ background: `var(--progress-${state})` }} />
            {STATE_LABELS[state]}
            {state === 'mastered' &&
              ' (deeper as its regions and places are mastered)'}
          </li>
        ))}
        <li>
          <span className="progress-swatch" style={{ background: 'var(--progress-complete)' }} />
          Everything below it mastered
        </li>
      </ul>
      <form className="progress-goto" onSubmit={go}>
        <label htmlFor="progress-goto-select">Go to a country</label>{' '}
        <select
          id="progress-goto-select"
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
        >
          <option value="">Choose a country</option>
          {options.map(({ id, name }) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>{' '}
        <button type="submit" disabled={!chosen}>
          Go
        </button>
      </form>
      <h2>Countries you have started</h2>
      {started.length === 0 ? (
        <p>
          You haven&apos;t started any countries yet. <Link to="/session">Start</Link>
        </p>
      ) : (
        <ul className="progress-started" data-testid="started-countries">
          {started.map(({ country, state }) => (
            <li key={country.id}>
              <Link to={`/progress/${country.id}`}>{country.name}</Link>: {STATE_LABELS[state]}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
