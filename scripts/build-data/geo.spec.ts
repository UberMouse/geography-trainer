import { describe, expect, it } from 'vitest';
import { square } from './fixtures/geometry';
import { distanceToEdgeKm, haversineKm } from './geo';

describe('distanceToEdgeKm', () => {
  it('measures to the nearest edge', () => {
    // 0.5° of latitude north of a square's top edge.
    expect(distanceToEdgeKm(square(0, 0), 0.5, 1.5)).toBeCloseTo(55.6, 0);
  });

  it('does not shortcut through an edge on the far side of the globe', () => {
    // A square straddling the meridian 180° away from the point is about half the globe away.
    expect(distanceToEdgeKm(square(104.5, 18), -75, 18.5)).toBeGreaterThan(5000);
  });
});

describe('haversineKm', () => {
  it('gives great-circle km', () => {
    expect(haversineKm(0, 0, 1, 0)).toBeCloseTo(111.2, 0);
  });
});
