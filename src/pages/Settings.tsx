import {
  Alert,
  Button,
  FileButton,
  Group,
  Modal,
  NumberInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { usePageTitle } from '../components/usePageTitle';
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
  usePageTitle('Settings');
  const [data, reload] = useLoaded('settings', loadSettingsData);
  // Kept here, above `Status`, because the loaded subtree remounts when an import or reset reloads.
  const [notice, setNotice] = useState<Notice>(null);
  return (
    <Stack align="flex-start">
      <Title order={1}>Settings</Title>
      <Status
        state={data}
        retry={reload}
        failure="Could not load your saved progress and settings:"
      >
        {(loaded) => (
          <SettingsContent data={loaded} reload={reload} notice={notice} setNotice={setNotice} />
        )}
      </Status>
    </Stack>
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
    <Stack gap="xl" w="100%">
      <DailyLimit stored={data.dailyNewCap} {...shared} />
      <ProgressFiles progress={data.progress} reload={reload} {...shared} />
      <Reset reload={reload} {...shared} />
    </Stack>
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

  const edit = (value: number | string) => {
    setText(String(value));
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
    <Stack component="section" aria-labelledby="settings-limit" gap="sm">
      <Title order={2} size="h4" id="settings-limit">
        Daily limit
      </Title>
      <form onSubmit={save} noValidate>
        <Group align="flex-end" gap="sm">
          <NumberInput
            label="New items per day"
            min={DAILY_NEW_CAP_MIN}
            max={DAILY_NEW_CAP_MAX}
            step={1}
            // The check below says what is wrong with a value; the input does not change it.
            clampBehavior="none"
            value={text}
            onChange={edit}
            w="8rem"
          />
          <Button type="submit" disabled={busy}>
            Save
          </Button>
        </Group>
      </form>
      {error && <Alert color="red">{error}</Alert>}
      {notice === 'saved' && <Text role="status">Saved.</Text>}
    </Stack>
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
  const resetPicker = useRef<() => void>(null);
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
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (file: File | null) => {
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
    resetPicker.current?.();
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
    <Stack component="section" aria-labelledby="settings-progress" gap="sm">
      <Title order={2} size="h4" id="settings-progress">
        Your progress
      </Title>
      <Group gap="sm">
        <Button onClick={exportFile} disabled={busy}>
          Export progress
        </Button>
        <FileButton
          onChange={(file) => void pickFile(file)}
          accept=".json,application/json"
          disabled={busy}
          resetRef={resetPicker}
          inputProps={{ 'aria-label': 'Import progress' }}
        >
          {(props) => <Button {...props}>Import progress</Button>}
        </FileButton>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      {leftOut > 0 && <Alert color="yellow">{leftOutText(leftOut)}</Alert>}
      {notice === 'imported' && (
        <Text role="status" tabIndex={-1} ref={importedRef}>
          Progress imported.
        </Text>
      )}
      <Modal
        opened={pending !== null}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        title="Confirm import"
        centered
      >
        <Stack>
          <Text>{pending && importConfirmText(pending.summary)}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button color="red" onClick={replace} disabled={busy}>
              Replace
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

function Reset({
  reload,
  busy,
  setBusy,
  notice,
  setNotice,
}: SectionProps & { reload: () => void }) {
  const [confirming, setConfirming] = useState(false);
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
      setConfirming(false);
      setNotice('reset');
      reload();
    } catch (e) {
      setConfirming(false);
      setError(`Could not reset your progress: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const open = () => {
    setTyped('');
    setError(null);
    setNotice(null);
    setConfirming(true);
  };

  return (
    <Stack component="section" aria-labelledby="settings-reset" gap="sm" align="flex-start">
      <Title order={2} size="h4" id="settings-reset">
        Reset all progress
      </Title>
      <Text>
        This deletes your progress, your answer history and your finished placement tests. The
        daily limit stays.
      </Text>
      <Button color="red" variant="outline" onClick={open} disabled={busy}>
        Reset all progress
      </Button>
      {error && <Alert color="red">{error}</Alert>}
      {notice === 'reset' && (
        <Text role="status" tabIndex={-1} ref={resetRef}>
          All progress was reset.
        </Text>
      )}
      <Modal
        opened={confirming}
        onClose={() => {
          if (!busy) setConfirming(false);
        }}
        title="Reset all progress"
        centered
      >
        <form onSubmit={run}>
          <Stack>
            <TextInput
              label={`Type ${RESET_WORD} to confirm`}
              value={typed}
              onChange={(event) => setTyped(event.currentTarget.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              data-autofocus
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" color="red" disabled={busy || !isResetConfirmed(typed)}>
                Reset all progress
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
