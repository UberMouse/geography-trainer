import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../engine/rng';
import { DATA, DATA_WITH_ALPHA } from './fixtures';
import { buildExerciseItem } from './item';
import { buildChoices } from './options';

describe('buildChoices', () => {
  it('offers the item and 3 named distractors from its candidates', () => {
    const item = buildExerciseItem('place:s1', DATA_WITH_ALPHA);
    const choices = buildChoices(item, mulberry32(1));
    expect(choices).toHaveLength(4);
    expect(new Set(choices.map((c) => c.id)).size).toBe(4);
    expect(choices).toContainEqual({ id: 'place:s1', name: 'S1' });
    const candidateIds = item.candidates.map((c) => c.id);
    for (const c of choices.filter((c) => c.id !== item.id)) {
      expect(candidateIds).toContain(c.id);
      expect(c.name).toBe(c.id.slice('place:'.length).toUpperCase());
    }
  });

  it('is the same for the same seed', () => {
    const item = buildExerciseItem('place:s1', DATA_WITH_ALPHA);
    expect(buildChoices(item, mulberry32(7))).toEqual(buildChoices(item, mulberry32(7)));
  });

  it('offers fewer options when there are fewer candidates', () => {
    const item = buildExerciseItem('country:beta', DATA);
    expect(
      buildChoices(item, mulberry32(1))
        .map((c) => c.id)
        .sort(),
    ).toEqual(['country:alpha', 'country:beta', 'country:gamma']);
  });
});
