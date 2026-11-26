import { Link, useSearchParams } from 'react-router';
import { loadCountries } from '../data/loaders';
import ExercisePlayground from './ExercisePlayground';
import GlobePlayground from './GlobePlayground';
import Status from './LoadStatus';
import { useLoaded } from './useLoaded';

/**
 * Dev-only, two tabs on the shared globe: the Exercises tab (the default) runs one exercise, and
 * `?mode=globe` opens the Globe tab, to try by hand and drive from e2e.
 */
export default function Playground() {
  const [params] = useSearchParams();
  const [countries, retry] = useLoaded('countries', loadCountries);

  // The Globe tab's column carries its own link back.
  if (params.get('mode') === 'globe') return <GlobePlayground />;

  return (
    <>
      <h1>Map playground</h1>
      <nav className="playground-controls" aria-label="Playground">
        <Link to="/playground?mode=exercises" aria-current="page">
          Exercises
        </Link>
        <Link to="/playground?mode=globe">Globe</Link>
      </nav>
      <Status state={countries} retry={retry}>
        {(data) => <ExercisePlayground countries={data} />}
      </Status>
    </>
  );
}
