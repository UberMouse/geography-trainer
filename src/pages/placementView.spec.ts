import { describe, expect, it } from 'vitest';
import type { PlacementResult } from '../engine/placement';
import type { PlacementOutcome } from '../engine/srs';
import { emptyPoolText, placementHeader, resultLines, saveFailureText, type PlacementTier } from './placementView';

/** A result with the given number of items of each outcome. */
function result(
  estimate: number,
  n: { passed?: number; below?: number; failed?: number; above?: number },
): PlacementResult {
  const outcomes: Record<string, PlacementOutcome> = {};
  const add = (count: number | undefined, outcome: PlacementOutcome) => {
    for (let i = 0; i < (count ?? 0); i++) outcomes[`${outcome}:${i}`] = outcome;
  };
  add(n.passed, 'passed');
  add(n.below, 'untestedAtOrBelow');
  add(n.failed, 'failed');
  add(n.above, 'aboveEstimate');
  return { estimate, outcomes };
}

describe('placementHeader', () => {
  it('counts the question being asked, out of the maximum', () => {
    expect(placementHeader(0, 50)).toBe('Placement: question 1 of up to 20');
    expect(placementHeader(6, 20)).toBe('Placement: question 7 of up to 20');
  });

  it('caps the total at the number of askable items', () => {
    expect(placementHeader(0, 3)).toBe('Placement: question 1 of up to 3');
  });
});

describe('saveFailureText', () => {
  it('is null when nothing failed', () => {
    expect(saveFailureText([])).toBeNull();
  });

  it('words one failure for an answer and several for a count, with the latest error', () => {
    expect(saveFailureText([{ itemId: 'country:peru', message: 'disk full' }])).toBe(
      '1 answer could not be saved: disk full. Finish the test to save it.',
    );
    expect(
      saveFailureText([
        { itemId: 'country:peru', message: 'disk full' },
        { itemId: 'country:chile', message: 'quota' },
      ]),
    ).toBe('2 answers could not be saved: quota. Finish the test to save them.');
  });

  it('adds no second full stop when the error already ends a sentence', () => {
    expect(saveFailureText([{ itemId: 'country:peru', message: 'Disk full.' }])).toBe(
      '1 answer could not be saved: Disk full. Finish the test to save it.',
    );
  });
});

describe('emptyPoolText', () => {
  it('names the tier in the singular', () => {
    expect(emptyPoolText('countries')).toBe('There is nothing left to place: every country is already placed or being studied.');
    expect(emptyPoolText('regions')).toBe('There is nothing left to place: every region is already placed or being studied.');
    expect(emptyPoolText('places')).toBe('There is nothing left to place: every place is already placed or being studied.');
  });

  it('says what was started in the country or region being tested out of', () => {
    expect(emptyPoolText('regions', 'France')).toBe(
      "There is nothing left to test: all of France's regions are already placed or being studied.",
    );
    expect(emptyPoolText('places', 'Bretagne')).toBe(
      "There is nothing left to test: all of Bretagne's places are already placed or being studied.",
    );
  });
});

describe('resultLines', () => {
  it('says what each group of countries does, with many', () => {
    expect(resultLines(result(5, { passed: 4, below: 12, failed: 1, above: 30 }), 'countries')).toEqual([
      'Your level: 5 of 8.',
      '4 countries you got right come back within a couple of days to confirm.',
      '12 countries at or below your level start at tapping on a bordered map.',
      'The other 31 start from the beginning.',
    ]);
  });

  it('pluralises a count of one', () => {
    expect(resultLines(result(3, { passed: 1, below: 1, above: 1 }), 'countries')).toEqual([
      'Your level: 3 of 8.',
      '1 country you got right comes back within a couple of days to confirm.',
      '1 country at or below your level starts at tapping on a bordered map.',
      'The other 1 starts from the beginning.',
    ]);
  });

  it('leaves out a line whose count is zero', () => {
    expect(resultLines(result(2, { passed: 2 }), 'countries')).toEqual([
      'Your level: 2 of 8.',
      '2 countries you got right come back within a couple of days to confirm.',
    ]);
    expect(resultLines(result(4, { below: 3 }), 'countries')).toEqual([
      'Your level: 4 of 8.',
      '3 countries at or below your level start at tapping on a bordered map.',
    ]);
    expect(resultLines(result(4, { failed: 2 }), 'countries')).toEqual([
      'Your level: 4 of 8.',
      'The other 2 start from the beginning.',
    ]);
  });

  it('words an estimate of 0 with nothing placed as the single line', () => {
    expect(resultLines(result(0, {}), 'countries')).toEqual([
      'No level placed yet: everything starts from the beginning.',
    ]);
    expect(resultLines(result(0, { failed: 3, above: 5 }), 'countries')).toEqual([
      'No level placed yet: everything starts from the beginning.',
    ]);
  });

  it('words an estimate of 0 with something placed or left over as no level yet, then the rest', () => {
    expect(resultLines(result(0, { below: 1, failed: 3, above: 5 }), 'countries')).toEqual([
      'No level placed yet.',
      '1 country at or below your level starts at tapping on a bordered map.',
      'The other 8 start from the beginning.',
    ]);
    expect(resultLines(result(0, { passed: 1, below: 2, failed: 1 }), 'countries')).toEqual([
      'No level placed yet.',
      '1 country you got right comes back within a couple of days to confirm.',
      '2 countries at or below your level start at tapping on a bordered map.',
      'The other 1 starts from the beginning.',
    ]);
  });

  it.each<[PlacementTier, string, string]>([
    ['countries', 'country', 'countries'],
    ['regions', 'region', 'regions'],
    ['places', 'place', 'places'],
  ])('names the %s tier', (tier, one, many) => {
    const lines = resultLines(result(6, { passed: 1, below: 2 }), tier);
    expect(lines[1]).toBe(`1 ${one} you got right comes back within a couple of days to confirm.`);
    expect(lines[2]).toBe(`2 ${many} at or below your level start at tapping on a bordered map.`);
  });
});
