import { useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { buildCountryCurriculum } from '../engine/curriculum';
import type { ItemProgress } from '../engine/srs';
import { todayNumbers } from '../engine/today';
import type { Place } from '../engine/types';
import { loadCountries, loadPlaces, type CountriesData } from '../data/loaders';
import { repo } from '../storage/repo';
import { checkImportText, exportFilename, importConfirmText, type ImportSummary } from './homeView';
import Status from './LoadStatus';
import { useLoaded } from './useLoaded';

interface HomeData {
  countries: CountriesData;
  places: Place[];
  progress: Record<string, ItemProgress>;
}

const loadHomeData = async (): Promise<HomeData> => {
  const [countries, places, progress] = await Promise.all([
    loadCountries(),
    loadPlaces(),
    repo.loadProgress(),
  ]);
  return { countries, places, progress };
};

const tzOffset = (now: Date) => -now.getTimezoneOffset();

/** Today's numbers, a Start link, and export/import of the saved progress. */
export default function Home() {
  const [data, reload] = useLoaded('home', loadHomeData);
  return (
    <>
      <h1>Geography Trainer</h1>
      <Status
        state={data}
        retry={reload}
        failure="Could not load the map data or your saved progress:"
      >
        {(loaded) => <HomeContent data={loaded} reload={reload} />}
      </Status>
    </>
  );
}

function HomeContent({ data, reload }: { data: HomeData; reload: () => void }) {
  const numbers = useMemo(() => {
    const now = new Date();
    const curriculum = buildCountryCurriculum(data.countries.countries, data.places);
    return todayNumbers(curriculum, data.progress, now, tzOffset(now));
  }, [data]);
  return (
    <>
      <dl className="home-numbers">
        <div>
          <dt>Due reviews</dt>
          <dd data-testid="today-due">{numbers.due}</dd>
        </div>
        <div>
          <dt>New today</dt>
          <dd data-testid="today-new">
            {numbers.newToday} of {numbers.dailyCap} new today
          </dd>
        </div>
        <div>
          <dt>Learning</dt>
          <dd data-testid="today-learning">{numbers.learning}</dd>
        </div>
        <div>
          <dt>Learned</dt>
          <dd data-testid="today-learned">{numbers.learned}</dd>
        </div>
      </dl>
      {numbers.sessionLength > 0 ? (
        <p>
          <Link to="/session" className="home-start">
            Start ({numbers.sessionLength} questions)
          </Link>
        </p>
      ) : (
        <p>There is nothing to study right now.</p>
      )}
      <ProgressFiles progress={data.progress} reload={reload} />
    </>
  );
}

function ProgressFiles({
  progress,
  reload,
}: {
  progress: Record<string, ItemProgress>;
  reload: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ parsed: unknown; summary: ImportSummary } | null>(null);

  const exportFile = async () => {
    setError(null);
    try {
      const now = new Date();
      const file = await repo.exportProgress(now);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = exportFilename(now, tzOffset(now));
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Could not export your progress: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    setError(null);
    setPending(null);
    if (!file) return;
    try {
      const check = checkImportText(await file.text(), progress, tzOffset(new Date()));
      if (check.ok) setPending({ parsed: check.parsed, summary: check.summary });
      else setError(check.message);
    } catch (e) {
      setError(`Could not read that file: ${e instanceof Error ? e.message : String(e)}`);
    }
    // So the same file can be picked again.
    input.value = '';
  };

  const replace = async () => {
    if (!pending) return;
    try {
      await repo.importProgress(pending.parsed);
      setPending(null);
      reload();
    } catch (e) {
      setPending(null);
      setError(`Could not import: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <section aria-labelledby="home-progress">
      <h2 id="home-progress">Your progress</h2>
      <p className="home-actions">
        <button type="button" className="session-button" onClick={exportFile}>
          Export progress
        </button>
        <label className="session-button home-import">
          Import progress
          <input type="file" accept=".json,application/json" onChange={pickFile} />
        </label>
      </p>
      {error && <p role="alert">{error}</p>}
      {pending && (
        <div className="home-confirm" role="group" aria-label="Confirm import">
          <p>{importConfirmText(pending.summary)}</p>
          <p className="home-actions">
            <button type="button" className="session-button" onClick={replace}>
              Replace
            </button>
            <button type="button" className="session-button" onClick={() => setPending(null)}>
              Cancel
            </button>
          </p>
        </div>
      )}
    </section>
  );
}
