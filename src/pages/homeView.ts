// Plain helpers for Home's export and import, kept out of the component so they can be unit-tested.

import { localDayKey, type ItemProgress } from '../engine/srs';
import { countriesStarted, validateProgressFile, type ProgressFile } from '../storage/progressFile';

/** The download name for an export made at `now`: the local day, `tzOffsetMinutes` east of UTC. */
export function exportFilename(now: Date, tzOffsetMinutes: number): string {
  return `geography-trainer-progress-${localDayKey(now, tzOffsetMinutes)}.json`;
}

export interface ImportSummary {
  /** Countries started in this browser. */
  here: number;
  /** Countries started in the file. */
  inFile: number;
  /** The local day the file was exported. */
  exportedOn: string;
}

export type ImportCheck =
  { ok: true; parsed: unknown; summary: ImportSummary } | { ok: false; message: string };

/** Reads a picked file's text: an error message, or the summary to confirm a replace with. */
export function checkImportText(
  text: string,
  current: Readonly<Record<string, ItemProgress>>,
  tzOffsetMinutes: number,
): ImportCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: 'That file is not valid JSON.' };
  }
  let file: ProgressFile;
  try {
    file = validateProgressFile(parsed);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  return {
    ok: true,
    parsed,
    summary: {
      here: countriesStarted(Object.values(current)),
      inFile: countriesStarted(file.progress),
      exportedOn: localDayKey(new Date(file.exportedAt), tzOffsetMinutes),
    },
  };
}

const countries = (n: number) => `${n} ${n === 1 ? 'country' : 'countries'}`;

export const importConfirmText = (s: ImportSummary): string =>
  `This browser: ${countries(s.here)} started. File: ${countries(s.inFile)} started, exported ${s.exportedOn}.`;
