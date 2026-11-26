import { describe, expect, it } from 'vitest';
import { COUNTRIES_SCOPE, isPlacementKey, placementKey } from './placementKeys';

describe('[PLC-C08] placementKey', () => {
  it('names the countries test and a test-out by its item id', () => {
    expect(placementKey(COUNTRIES_SCOPE)).toBe('placement:countries');
    expect(placementKey('country:peru')).toBe('placement:country:peru');
    expect(placementKey('region:us.tx')).toBe('placement:region:us.tx');
  });
});

describe('[PLC-C08] isPlacementKey', () => {
  it.each(['placement:countries', 'placement:country:peru', 'placement:region:us.tx'])('accepts %s', (key) => {
    expect(isPlacementKey(key)).toBe(true);
  });

  it.each([
    'placement:',
    'placement:country:',
    'placement:region:',
    'placement:region:us',
    'placement:region:us.',
    'placement:region:.tx',
    'placement:region:us.tx.x',
    'placement:place:paris',
    'setting:dailyNewCap',
    'countries',
    '',
    3,
    null,
  ])('rejects %s', (key) => {
    expect(isPlacementKey(key)).toBe(false);
  });
});
