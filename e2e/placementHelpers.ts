import { writeFile } from 'node:fs/promises';

// Progress files for the placement specs, in the export format Settings imports.

const DAY = 24 * 60 * 60 * 1000;

/** A mastered row: L3 passed on two different days, introduced long ago, next due in 30 days. */
function masteredRow(itemId: string) {
  const now = Date.now();
  return {
    itemId,
    rung: 3,
    highestRung: 3,
    cards: {
      3: {
        due: now + 30 * DAY,
        stability: 30,
        difficulty: 5,
        scheduled_days: 30,
        learning_steps: 0,
        reps: 4,
        lapses: 0,
        state: 2,
        last_review: now - 5 * DAY,
      },
    },
    l3PassDays: ['2026-01-10', '2026-01-20'],
    inL3Lapse: false,
    introducedAt: now - 60 * DAY,
  };
}

/** A progress file in which the United States and its region Texas are mastered, and nothing else is stored. */
export async function writeMasteredTexas(path: string) {
  const file = {
    format: 'geography-trainer-progress',
    version: 3,
    exportedAt: new Date().toISOString(),
    progress: [masteredRow('country:united-states'), masteredRow('region:united-states.texas')],
    answers: [],
    placementsDone: [],
  };
  await writeFile(path, JSON.stringify(file));
}
