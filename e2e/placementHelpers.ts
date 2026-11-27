import { readFile } from 'node:fs/promises';
import { progressRow, writeProgressFile } from './sessionHelpers';

// Progress files for the placement specs, in the export format Settings imports.

const DAY = 24 * 60 * 60 * 1000;

/** A mastered row: L3 passed on two different days, introduced long ago, next due in 30 days. */
const masteredRow = (itemId: string) =>
  progressRow(itemId, 3, {
    dueInDays: 30,
    l3PassDays: ['2026-01-10', '2026-01-20'],
    introducedAt: Date.now() - 60 * DAY,
  });

/** A progress file in which the United States and its region Texas are mastered, and nothing else is stored. */
export async function writeMasteredTexas(path: string) {
  await writeProgressFile(path, [masteredRow('country:united-states'), masteredRow('region:united-states.texas')]);
}

/**
 * A progress file in which the United States and Texas are mastered and every place in Texas has
 * a placement-style row (L3, one rep, not introduced): Texas's test-out has nothing left to test.
 */
export async function writeTexasPlacesPlaced(path: string) {
  const places = JSON.parse(await readFile('public/data/places.json', 'utf8')) as {
    id: string;
    region?: string;
  }[];
  const placed = places
    .filter((p) => p.region === 'united-states.texas')
    .map((p) => {
      const row = progressRow(`place:${p.id}`, 3, { dueInDays: 30, introducedAt: null });
      return { ...row, cards: { 3: { ...row.cards[3]!, reps: 1 } } };
    });
  await writeProgressFile(path, [
    masteredRow('country:united-states'),
    masteredRow('region:united-states.texas'),
    ...placed,
  ]);
}
