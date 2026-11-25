import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAnswer, createProgress, type ItemProgress } from '../engine/srs';
import { createRepo, type ProgressRepo } from '../storage/repo';
import { checkImportText, exportFilename, importConfirmText, leftOutText } from './homeView';

const NOW = new Date('2026-03-04T23:30:00Z');

const started = (id: string): ItemProgress =>
  applyAnswer(createProgress(id, NOW), 1, 3, NOW, '2026-03-04');

describe('exportFilename', () => {
  it('names the file by the local day', () => {
    expect(exportFilename(NOW, 0)).toBe('geography-trainer-progress-2026-03-04.json');
    expect(exportFilename(NOW, 120)).toBe('geography-trainer-progress-2026-03-05.json');
  });
});

describe('checkImportText', () => {
  let repo: ProgressRepo;
  beforeEach(() => {
    repo = createRepo('home-view-spec');
  });
  afterEach(() => repo.close());

  it('rejects text that is not JSON', () => {
    expect(checkImportText('nope', {}, 0)).toEqual({
      ok: false,
      message: 'That file is not valid JSON.',
    });
  });

  it('rejects JSON that is not a progress export, naming the problem', () => {
    const result = checkImportText('{"hello":1}', {}, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Wrong format/);
  });

  it('summarises both sides of a valid file', async () => {
    await repo.importProgress({
      format: 'geography-trainer-progress',
      version: 1,
      exportedAt: NOW.toISOString(),
      progress: [started('country:france'), started('country:peru')],
      answers: [],
    });
    const text = JSON.stringify(await repo.exportProgress(NOW));
    const here = { 'country:chad': started('country:chad') };
    const result = checkImportText(text, here, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toEqual({ here: 1, inFile: 2, exportedOn: '2026-03-04' });
    expect(importConfirmText(result.summary)).toBe(
      'This browser: 1 country started. File: 2 countries started, exported 2026-03-04.',
    );
    expect(importConfirmText({ here: 0, inFile: 1, exportedOn: '2026-03-04' })).toBe(
      'This browser: 0 countries started. File: 1 country started, exported 2026-03-04.',
    );
  });

  it('words the answers an export left out', () => {
    expect(leftOutText(1)).toBe('1 answer could not be saved and is not in the file.');
    expect(leftOutText(3)).toBe('3 answers could not be saved and are not in the file.');
  });
});
