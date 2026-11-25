import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { ItemProgress } from '../engine/srs';
import { progressStore } from '../storage/progressStore';
import { DAILY_NEW_CAP_MAX, DAILY_NEW_CAP_MIN } from '../storage/settings';
import Status from './LoadStatus';
import {
  checkImportText,
  checkLimitText,
  exportFilename,
  importConfirmText,
  isResetConfirmed,
  leftOutText,
  RESET_WORD,
  type ImportSummary,
} from './settingsView';
import { useLoaded } from './useLoaded';

const tzOffset = (now: Date) => -now.getTimezoneOffset();

interface SettingsData {
  progress: Record<string, ItemProgress>;
  dailyNewCap: number;
}

const loadSettingsData = async (): Promise<SettingsData> => {
  const [progress, settings] = await Promise.all([
    progressStore.loadProgress(),
    progressStore.loadSettings(),
  ]);
  return { progress, dailyNewCap: settings.dailyNewCap };
};

/** What the page last did, shown as a status line in the section that did it. */
type Notice = 'saved' | 'imported' | 'reset' | null;

/** The daily limit on new items, export and import of the saved progress, and a full reset. */
export default function Settings() {
  const [data, reload] = useLoaded('settings', loadSettingsData);
  // Kept here, above `Status`, because the loaded subtree remounts when an import or reset reloads.
  const [notice, setNotice] = useState<Notice>(null);
  return (
    <>
      <h1>Settings</h1>
      <p>
        <Link to="/">Back to Home</Link>
      </p>
      <Status
        state={data}
        retry={reload}
        failure="Could not load your saved progress and settings:"
      >
        {(loaded) => (
          <SettingsContent data={loaded} reload={reload} notice={notice} setNotice={setNotice} />
        )}
      </Status>
    </>
  );
}

interface SectionProps {
  /** True while a write is running: no other write may start. */
  busy: boolean;
  setBusy: (busy: boolean) => void;
  notice: Notice;
  setNotice: (notice: Notice) => void;
}

function SettingsContent({
  data,
  reload,
  notice,
  setNotice,
}: {
  data: SettingsData;
  reload: () => void;
  notice: Notice;
  setNotice: (notice: Notice) => void;
}) {
  const [busy, setBusy] = useState(false);
  const shared = { busy, setBusy, notice, setNotice };
  return (
    <>
      <DailyLimit stored={data.dailyNewCap} {...shared} />
      <ProgressFiles progress={data.progress} reload={reload} {...shared} />
      <Reset reload={reload} {...shared} />
    </>
  );
}

function DailyLimit({
  stored,
  busy,
  setBusy,
  notice,
  setNotice,
}: SectionProps & { stored: number }) {
  const [text, setText] = useState(String(stored));
  const [error, setError] = useState<string | null>(null);

  const edit = (event: ChangeEvent<HTMLInputElement>) => {
    setText(event.currentTarget.value);
    setError(null);
    setNotice(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setNotice(null);
    const check = checkLimitText(text);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await progressStore.saveDailyNewCap(check.value);
      setNotice('saved');
    } catch (e) {
      setError(`Could not save the limit: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="settings-limit">
      <h2 id="settings-limit">Daily limit</h2>
      <form className="settings-form" onSubmit={save} noValidate>
        <label>
          New items per day
          <input
            type="number"
            className="settings-number"
            min={DAILY_NEW_CAP_MIN}
            max={DAILY_NEW_CAP_MAX}
            step={1}
            value={text}
            onChange={edit}
          />
        </label>
        <button type="submit" className="session-button" disabled={busy}>
          Save
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {notice === 'saved' && <p role="status">Saved.</p>}
    </section>
  );
}

function ProgressFiles({
  progress,
  reload,
  busy,
  setBusy,
  notice,
  setNotice,
}: SectionProps & { progress: Record<string, ItemProgress>; reload: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [leftOut, setLeftOut] = useState(0);
  const [pending, setPending] = useState<{ parsed: unknown; summary: ImportSummary } | null>(null);
  const latestPick = useRef(0);
  const importedRef = useRef<HTMLParagraphElement>(null);

  // After a Replace the page reloads and this section mounts again: move focus to the status line.
  useEffect(() => {
    if (notice === 'imported') importedRef.current?.focus();
    // Only on mount: the notice is already set when the reloaded page renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportFile = async () => {
    setError(null);
    setLeftOut(0);
    setNotice(null);
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
    setNotice(null);
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
      setNotice('imported');
      reload();
    } catch (e) {
      setPending(null);
      setError(`Could not import: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="settings-progress">
      <h2 id="settings-progress">Your progress</h2>
      <p className="home-actions">
        <button type="button" className="session-button" onClick={exportFile} disabled={busy}>
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
      {notice === 'imported' && (
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
            <button
              type="button"
              className="session-button"
              onClick={() => setPending(null)}
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

function Reset({
  reload,
  busy,
  setBusy,
  notice,
  setNotice,
}: SectionProps & { reload: () => void }) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const resetRef = useRef<HTMLParagraphElement>(null);

  // After a reset the page reloads and this section mounts again: move focus to the status line.
  useEffect(() => {
    if (notice === 'reset') resetRef.current?.focus();
    // Only on mount: the notice is already set when the reloaded page renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !isResetConfirmed(typed)) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await progressStore.resetProgress();
      setTyped('');
      setNotice('reset');
      reload();
    } catch (e) {
      setError(`Could not reset your progress: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="settings-reset">
      <h2 id="settings-reset">Reset all progress</h2>
      <p>
        This deletes your progress, your answer history and your finished placement tests. The
        daily limit stays.
      </p>
      <form className="settings-form" onSubmit={run}>
        <label>
          Type {RESET_WORD} to confirm
          <input
            type="text"
            className="settings-text"
            value={typed}
            onChange={(event) => setTyped(event.currentTarget.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>
        <button
          type="submit"
          className="session-button"
          disabled={busy || !isResetConfirmed(typed)}
        >
          Reset all progress
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {notice === 'reset' && (
        <p role="status" tabIndex={-1} ref={resetRef}>
          All progress was reset.
        </p>
      )}
    </section>
  );
}
