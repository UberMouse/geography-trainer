// Plain helpers for Home's export and import, kept out of the component so they can be unit-tested.

import { isIntroduced, localDayKey, type ItemProgress } from '../engine/srs';
import { startedByTier, validateProgressFile, type ProgressFile, type TierCounts } from '../storage/progressFile';

/** The download name for an export made at `now`: the local day, `tzOffsetMinutes` east of UTC. */
export function exportFilename(now: Date, tzOffsetMinutes: number): string {
  return `geography-trainer-progress-${localDayKey(now, tzOffsetMinutes)}.json`;
}

export interface ImportSummary {
  /** Items started in this browser, by tier. */
  here: TierCounts;
  /** Items started in the file, by tier. */
  inFile: TierCounts;
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
      here: startedByTier(Object.values(current)),
      inFile: startedByTier(file.progress),
      exportedOn: localDayKey(new Date(file.exportedAt), tzOffsetMinutes),
    },
  };
}

/** "3 countries, 12 regions and 40 places started": the tiers above zero, or "nothing started". */
function startedText(c: TierCounts): string {
  const parts = [
    c.countries > 0 && `${c.countries} ${c.countries === 1 ? 'country' : 'countries'}`,
    c.regions > 0 && `${c.regions} ${c.regions === 1 ? 'region' : 'regions'}`,
    c.places > 0 && `${c.places} ${c.places === 1 ? 'place' : 'places'}`,
  ].filter((part): part is string => part !== false);
  if (parts.length === 0) return 'nothing started';
  const last = parts.pop()!;
  return `${parts.length > 0 ? `${parts.join(', ')} and ` : ''}${last} started`;
}

export const importConfirmText = (s: ImportSummary): string =>
  `This browser: ${startedText(s.here)}. File: ${startedText(s.inFile)}, exported ${s.exportedOn}.`;

/** The warning after an export that left out `n` answers that could not be saved. */
export const leftOutText = (n: number): string =>
  `${n === 1 ? '1 answer' : `${n} answers`} could not be saved and ${n === 1 ? 'is' : 'are'} not in the file.`;

/** Whether Home offers the placement test: while no item has been started. */
export const offersPlacement = (progress: Readonly<Record<string, ItemProgress>>): boolean =>
  !Object.values(progress).some(isIntroduced);
