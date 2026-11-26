import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAnswer, createProgress, type ItemProgress } from '../engine/srs';
import { createRepo, type ProgressRepo } from '../storage/repo';
import type { TierCounts } from '../storage/progressFile';
import {
  checkImportText,
  checkLimitText,
  exportFilename,
  importConfirmText,
  isResetConfirmed,
  leftOutText,
  RESET_WORD,
} from './settingsView';

const NOW = new Date('2026-03-04T23:30:00Z');

const started = (id: string): ItemProgress =>
  applyAnswer(createProgress(id, NOW), 1, 3, NOW, '2026-03-04');

describe('[SCR-20, SCR-C02, SCR-C10] exportFilename', () => {
  it('names the file by the local day', () => {
    expect(exportFilename(NOW, 0)).toBe('geography-trainer-progress-2026-03-04.json');
    expect(exportFilename(NOW, 120)).toBe('geography-trainer-progress-2026-03-05.json');
  });
});

describe('[SCR-C10] checkImportText', () => {
  let repo: ProgressRepo;
  beforeEach(() => {
    repo = createRepo('settings-view-spec');
  });
  afterEach(() => repo.close());

  it('[SCR-21] rejects text that is not JSON', () => {
    expect(checkImportText('nope', {}, 0)).toEqual({
      ok: false,
      message: 'That file is not valid JSON.',
    });
  });

  it('[SCR-21] rejects JSON that is not a progress export, naming the problem', () => {
    const result = checkImportText('{"hello":1}', {}, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Wrong format/);
  });

  it('[SCR-21, SCR-22] summarises both sides of a valid file', async () => {
    await repo.importProgress({
      format: 'geography-trainer-progress',
      version: 3,
      exportedAt: NOW.toISOString(),
      progress: [started('country:france'), started('country:peru')],
      answers: [],
      placementsDone: [],
    });
    const text = JSON.stringify(await repo.exportProgress(NOW));
    const here = { 'country:chad': started('country:chad') };
    const result = checkImportText(text, here, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toEqual({
      here: { countries: 1, regions: 0, places: 0 },
      inFile: { countries: 2, regions: 0, places: 0 },
      exportedOn: '2026-03-04',
    });
    expect(importConfirmText(result.summary)).toBe(
      'This browser: 1 country started. File: 2 countries started, exported 2026-03-04.',
    );
    expect(
      importConfirmText({
        here: { countries: 0, regions: 0, places: 0 },
        inFile: { countries: 1, regions: 0, places: 0 },
        exportedOn: '2026-03-04',
      }),
    ).toBe('This browser: nothing started. File: 1 country started, exported 2026-03-04.');
  });

  it('[SCR-22] lists each tier above zero, singular or plural, joined with "and"', () => {
    const text = (here: TierCounts, inFile: TierCounts) => importConfirmText({ here, inFile, exportedOn: '2026-11-20' });
    expect(text({ countries: 3, regions: 12, places: 40 }, { countries: 3, regions: 1, places: 0 })).toBe(
      'This browser: 3 countries, 12 regions and 40 places started. File: 3 countries and 1 region started, exported 2026-11-20.',
    );
    expect(text({ countries: 0, regions: 1, places: 1 }, { countries: 0, regions: 0, places: 1 })).toBe(
      'This browser: 1 region and 1 place started. File: 1 place started, exported 2026-11-20.',
    );
  });

  it('[SCR-22] counts started region and place rows, not rows without answers', () => {
    const here = {
      'country:chad': started('country:chad'),
      'region:fr.bre': started('region:fr.bre'),
      'place:paris': started('place:paris'),
      'place:rome': createProgress('place:rome', NOW),
    };
    const file = JSON.stringify({
      format: 'geography-trainer-progress',
      version: 3,
      exportedAt: NOW.toISOString(),
      progress: [started('country:france')],
      answers: [],
      placementsDone: [],
    });
    const result = checkImportText(file, here, 0);
    expect(result.ok && result.summary.here).toEqual({ countries: 1, regions: 1, places: 1 });
  });

  it('[SCR-20] words the answers an export left out', () => {
    expect(leftOutText(1)).toBe('1 answer could not be saved and is not in the file.');
    expect(leftOutText(3)).toBe('3 answers could not be saved and are not in the file.');
  });
});

describe('[SCR-19, SCR-C02, SCR-C10] checkLimitText', () => {
  it('accepts whole numbers from 5 to 50, trimmed', () => {
    expect(checkLimitText('5')).toEqual({ ok: true, value: 5 });
    expect(checkLimitText(' 50 ')).toEqual({ ok: true, value: 50 });
    expect(checkLimitText('015')).toEqual({ ok: true, value: 15 });
  });

  it.each(['', '  ', '4', '51', '7.0', '1e1', '-6', '+6', 'abc', '5 5'])('rejects %j naming the range', (text) => {
    expect(checkLimitText(text)).toEqual({ ok: false, message: 'Enter a whole number from 5 to 50.' });
  });
});

describe('[SCR-23, SCR-C02, SCR-C10] isResetConfirmed', () => {
  it('takes "reset" in any case with spaces around it', () => {
    expect(isResetConfirmed('reset')).toBe(true);
    expect(isResetConfirmed('  Reset ')).toBe(true);
    expect(isResetConfirmed('RESET')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isResetConfirmed('')).toBe(false);
    expect(isResetConfirmed('rese')).toBe(false);
    expect(isResetConfirmed('re set')).toBe(false);
    expect(isResetConfirmed('reset all')).toBe(false);
  });
});

describe('[SCR-C02] the Settings values', () => {
  it('asks for the word "reset"', () => {
    expect(RESET_WORD).toBe('reset');
  });
});
