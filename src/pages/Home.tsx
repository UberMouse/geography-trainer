import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { buildCountryCurriculum } from '../engine/curriculum';
import type { ItemProgress } from '../engine/srs';
import { todayNumbers } from '../engine/today';
import type { Place } from '../engine/types';
import { loadCountries, loadPlaces, type CountriesData } from '../data/loaders';
import { progressStore } from '../storage/progressStore';
import { checkImportText, exportFilename, importConfirmText, leftOutText, type ImportSummary } from './homeView';
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
    progressStore.loadProgress(),
  ]);
  return { countries, places, progress };
};

const tzOffset = (now: Date) => -now.getTimezoneOffset();

/** The current time, refreshed every minute and when the tab comes back to the foreground. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setNow(new Date());
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    const timer = setInterval(refresh, 60_000);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return now;
}

/** Today's numbers, a Start link, and export/import of the saved progress. */
export default function Home() {
  const [data, reload] = useLoaded('home', loadHomeData);
  const now = useNow();
  // Kept here, above `Status`, because the loaded subtree remounts when an import reloads Home.
  const [imported, setImported] = useState(false);
  return (
    <>
      <h1>Geography Trainer</h1>
      <Status
        state={data}
        retry={reload}
        failure="Could not load the map data or your saved progress:"
      >
        {(loaded) => (
          <HomeContent
            data={loaded}
            now={now}
            reload={reload}
            imported={imported}
            setImported={setImported}
          />
        )}
      </Status>
    </>
  );
}

interface HomeContentProps {
  data: HomeData;
  now: Date;
  reload: () => void;
  imported: boolean;
  setImported: (imported: boolean) => void;
}

function HomeContent({ data, now, reload, imported, setImported }: HomeContentProps) {
  const curriculum = useMemo(
    () => buildCountryCurriculum(data.countries.countries, data.places),
    [data.countries, data.places],
  );
  const numbers = useMemo(
    () => todayNumbers(curriculum, data.progress, now, tzOffset(now)),
    [curriculum, data.progress, now],
  );
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
            Start ({numbers.sessionLength} {numbers.sessionLength === 1 ? 'question' : 'questions'})
          </Link>
        </p>
      ) : (
        <p>There is nothing to study right now.</p>
      )}
      <ProgressFiles
        progress={data.progress}
        reload={reload}
        imported={imported}
        setImported={setImported}
      />
    </>
  );
}

function ProgressFiles({
  progress,
  reload,
  imported,
  setImported,
}: {
  progress: Record<string, ItemProgress>;
  reload: () => void;
  imported: boolean;
  setImported: (imported: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [leftOut, setLeftOut] = useState(0);
  const [pending, setPending] = useState<{ parsed: unknown; summary: ImportSummary } | null>(null);
  const [busy, setBusy] = useState(false);
  const latestPick = useRef(0);
  const importedRef = useRef<HTMLParagraphElement>(null);

  // After a Replace Home reloads and this section mounts again: move focus to the status line.
  useEffect(() => {
    if (imported) importedRef.current?.focus();
    // Only on mount: the flag is already set when the reloaded Home renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportFile = async () => {
    setError(null);
    setLeftOut(0);
    setImported(false);
    try {
      const now = new Date();
      const file = await progressStore.exportProgress(now);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = exportFilename(now, tzOffset(now));
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Some browsers fetch the blob after the click returns.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setLeftOut(progressStore.answers.getState().unsaved);
    } catch (e) {
      setError(`Could not export your progress: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const pickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    const pick = ++latestPick.current;
    setError(null);
    setLeftOut(0);
    setImported(false);
    setPending(null);
    if (!file) return;
    try {
      const text = await file.text();
      if (pick !== latestPick.current) return;
      const check = checkImportText(text, progress, tzOffset(new Date()));
      if (check.ok) setPending({ parsed: check.parsed, summary: check.summary });
      else setError(check.message);
    } catch (e) {
      if (pick !== latestPick.current) return;
      setError(`Could not read that file: ${e instanceof Error ? e.message : String(e)}`);
    }
    // So the same file can be picked again.
    input.value = '';
  };

  const replace = async () => {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await progressStore.importProgress(pending.parsed);
      setPending(null);
      setImported(true);
      reload();
    } catch (e) {
      setPending(null);
      setError(`Could not import: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
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
          <input
            type="file"
            accept=".json,application/json"
            onChange={pickFile}
            disabled={busy}
          />
        </label>
      </p>
      {error && <p role="alert">{error}</p>}
      {leftOut > 0 && <p role="alert">{leftOutText(leftOut)}</p>}
      {imported && (
        <p role="status" tabIndex={-1} ref={importedRef}>
          Progress imported.
        </p>
      )}
      {pending && (
        <div className="home-confirm" role="group" aria-label="Confirm import">
          <p>{importConfirmText(pending.summary)}</p>
          <p className="home-actions">
            <button type="button" className="session-button" onClick={replace} disabled={busy}>
              Replace
            </button>
            <button type="button" className="session-button" onClick={() => setPending(null)}
              disabled={busy}
            >
              Cancel
            </button>
          </p>
        </div>
      )}
    </section>
  );
}
