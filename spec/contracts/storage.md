# Storage contracts (STO)

The IndexedDB schema, the export file, the device settings, and the modules other code relies on
to save and read progress. Only `src/storage/` imports Dexie.

### STO-C01 The IndexedDB schema
Up: STO-01, STO-16

Database `geography-trainer` (`DB_NAME`, `src/storage/db.ts`), opened by `GeographyDb`.

| Dexie version | Tables (primary key) | Change |
|---|---|---|
| 1 | `progress` (`itemId`), `answers` (`++id`, auto-increment) | first layout |
| 2 | `progress` (`itemId`), `answers` (`++id`), `meta` (`key`) | adds the key-value table; rows of the other two are kept as they are, no upgrade function |

The current version is **2**. A schema change adds a version with a migration (CLAUDE.md).

- `progress` rows are the engine's `ItemProgress` (see the engine contracts), stored as is.
- `answers` rows are `AnswerRow` (STO-C02).
- `meta` rows are `{ key: string, value: unknown }`: a finished-placement marker (key
  `placement:…`, value `true`; key shapes are the placement area's `isPlacementKey`) or a setting
  (key `setting:…`, STO-C05).

### STO-C02 An answer row
Up: STO-01, STO-08

```ts
interface AnswerRow {
  id: number;          // assigned by the database (auto-increment), from 1
  itemId: string;      // e.g. "country:france"
  rung: 1 | 2 | 3;
  rating: 1 | 2 | 3 | 4; // ts-fsrs Grade: Again, Hard, Good, Easy
  correct: boolean;
  timeMs: number;      // answer time
  km?: number;         // tap distance; absent for a choice answer
  maptapScore?: number;
  at: number;          // epoch ms
  dayKey: string;      // the learner's local day, YYYY-MM-DD
}
```

`NewAnswer` is `AnswerRow` without `id`. Lives in `src/storage/db.ts`.

### STO-C03 The export file
Up: STO-07, STO-08, STO-09

The file is JSON (`ProgressFile`, `src/storage/progressFile.ts`):

```json
{
  "format": "geography-trainer-progress",
  "version": 3,
  "exportedAt": "2026-03-04T10:00:00.000Z",
  "progress": [ ItemProgress, … ],
  "answers": [ AnswerRow, … ],
  "placementsDone": [ "placement:countries", "placement:country:peru", "placement:region:us.tx" ]
}
```

| Field | Value |
|---|---|
| `format` | `FILE_FORMAT` = `"geography-trainer-progress"` |
| `version` | `FILE_VERSION` = `3` |
| `exportedAt` | `now.toISOString()` of the export |
| `progress` | every `progress` row, in primary-key order |
| `answers` | every `answers` row with its `id`, in id order; optional `km`/`maptapScore` kept when present |
| `placementsDone` | the `meta` keys starting `placement:` that pass `isPlacementKey`, in key order |

No `setting:` row is ever written to the file. Versions 1 and 2 are the four-rung ladder's files.

### STO-C04 Import validation
Up: STO-10, STO-11, STO-13

`validateProgressFile(parsed: unknown): ProgressFile` (`src/storage/progressFile.ts`) returns the
same object typed, or throws an `Error` naming the first problem (`progress[0].rung is not 1-3`).
Pure. The checks, in order: the file is an object; `format`; `version` (an integer 1–2 throws the
older-version message, anything else not 3 throws `Unsupported version: <v>`); `exportedAt`;
`progress` and `answers` are arrays; `placementsDone`; each progress row; each answer; unique keys.

| Value | Rule |
|---|---|
| epoch-ms field (`due`, `last_review`, `introducedAt`, `at`, `Date.parse(exportedAt)`) | a safe integer from 0 to `MAX_EPOCH_MS` = `Date.UTC(9999, 11, 31)` |
| `rung`, `highestRung`, answer `rung`, card key | an integer 1–3; card keys written exactly (`"1"`, not `"01"`) |
| `rung` | ≤ `highestRung`, and `cards` has a card for it |
| answer `rating` | an integer 1–4 |
| answer `id` | a safe integer from 1 to `MAX_ANSWER_ID` = 2^52 |
| card `scheduled_days`, `learning_steps`, `reps`, `lapses` | integers ≥ 0 |
| card `state` | an integer 0–3 |
| card `stability`, `difficulty` | finite numbers; unless all-zero on a New card (`state` 0), stability ≥ ts-fsrs `S_MIN` (0.001) and difficulty ≥ 1 |
| `l3PassDays` | distinct real calendar days `YYYY-MM-DD`; non-empty only when `highestRung` is 3 |
| `inL3Lapse`, `correct` | booleans |
| `introducedAt` | epoch ms or `null` |
| `timeMs`, `km`, `maptapScore` | finite numbers (`km`, `maptapScore` may be absent) |
| `dayKey` | a real calendar day `YYYY-MM-DD` |
| `placementsDone` | an array of distinct `isPlacementKey` strings |
| `progress[].itemId`, `answers[].id` | unique within the file |

Item ids are not checked against the curriculum: an unknown id imports as is.

### STO-C05 The daily new-item limit
Up: STO-15

| Name | Value | Lives in |
|---|---|---|
| `DAILY_NEW_CAP_KEY` | `"setting:dailyNewCap"` (a `meta` row) | `src/storage/settings.ts` |
| `DAILY_NEW_CAP_MIN` | 5 | `src/storage/settings.ts` |
| `DAILY_NEW_CAP_MAX` | 50 | `src/storage/settings.ts` |
| default | 15 (`DAILY_NEW_CAP`) | `src/engine/config.ts` |

`isValidDailyNewCap(v)`: `v` is a number, an integer, and 5 ≤ v ≤ 50.
`dailyNewCapOrDefault(stored)`: `stored` when valid, else 15. Both pure.

### STO-C06 The save queue
Up: STO-01, STO-02, STO-03

`createSaveQueue<T>(write: (entry: T) => Promise<void>): SaveQueue<T>` (`src/storage/saveQueue.ts`),
plain TypeScript.

| Member | Contract |
|---|---|
| `push(entry)` | appends; written in its turn, never while `failed` |
| `retry()` | when `failed`, writes again from the first unsaved entry, stopping at the next failure; resolves when idle. A no-op when not failed; returns the running drain while one runs |
| `getState()` | `{ unsaved, failed }`: `unsaved` counts entries not yet written, the one in flight included. A new object only on a real change (suits `useSyncExternalStore`) |
| `whenSettled()` | resolves once no write runs and nothing is unsaved or the queue is `failed`; works detached |
| `unsavedEntries()` | a copy of the unsaved entries, in push order |
| `discard()` | drops every unsaved entry, state `{0, false}`; throws while a write runs |
| `restore(entries, failed)` | puts `entries` back ahead of the unsaved ones (behind one in flight); `failed` becomes `failed \|\| state.failed`; writes at once unless failed |
| `subscribe(listener)` | calls `listener` after each state change; returns unsubscribe. A throwing listener is logged and never stops the queue |

One write at a time; `failed` clears only when the entry that failed is written.

### STO-C07 The progress store
Up: STO-05, STO-06, STO-07, STO-12, STO-14

`createProgressStore(repo: ProgressRepo): ProgressStore` (`src/storage/progressStore.ts`); the app
uses the singleton `progressStore` on the app repo. It is the pages' only door to storage.

| Member | Contract |
|---|---|
| `answers` | the app-wide `SaveQueue<AnswerEntry>` writing through `repo.recordAnswer` |
| `loadProgress()` | after the queue settled and in-flight writes settled: stored rows, with every unsaved entry's progress laid over them |
| `loadSettings()`, `loadFinishedTests()` | after the same waits; the tests as a `Set` of marker keys |
| `seedProgress(rows)`, `saveDailyNewCap(v)`, `finishPlacement(key, rows)` | tracked writes: each runs after the queue settled and the writes registered before it settled, and is registered from the call, so later reads and writes wait for it. They reject when the repo does |
| `resetProgress()`, `importProgress(parsed)` | tracked writes that, just before writing, take and discard the unsaved entries; on failure the entries are restored with their failed flag. `importProgress` validates first and throws without touching the queue |
| `exportProgress(now)` | retries a failed queue once, waits as above, then `repo.exportProgress(now)` |

A failed tracked write never makes a later read reject.

### STO-C08 The progress repo
Up: STO-01, STO-06, STO-08, STO-09, STO-14, STO-16

`createRepo(name = DB_NAME): ProgressRepo` (`src/storage/repo.ts`), the only module that reads
and writes IndexedDB; `repo` is the app's.

| Member | Transaction | Contract |
|---|---|---|
| `loadProgress()` | – | every progress row by item id; `{}` when empty |
| `recordAnswer({progress, answer})` | rw progress, answers | puts the progress row, adds the answer row |
| `seedProgress(rows)` | rw progress | adds the rows whose item has no stored row |
| `loadSettings()` | – | `{ dailyNewCap: dailyNewCapOrDefault(stored) }` |
| `saveDailyNewCap(v)` | – | throws without writing unless `isValidDailyNewCap(v)` |
| `loadFinishedTests()` | – | `placement:` keys passing `isPlacementKey`, in key order |
| `finishPlacement(key, rows)` | rw progress, meta | throws without writing on a bad key; adds absent rows and puts `{key, value: true}`, both or neither |
| `resetProgress()` | rw progress, answers, meta | clears progress and answers, deletes `placement:` keys; settings kept |
| `exportProgress(now)` | r progress, answers, meta | the STO-C03 file |
| `importProgress(parsed)` | rw progress, answers, meta | validates (STO-C04) first; then clears as reset does and bulk-adds the file's rows and markers |
| `close()` | – | closes the database |

`AnswerEntry` is `{ progress: ItemProgress; answer: NewAnswer }`.

### STO-C09 Started items per tier
Up: STO-09

`startedByTier(progress: Iterable<ItemProgress>): { countries, regions, places }`
(`src/storage/progressFile.ts`), pure: counts the rows the engine's `isStudied` accepts, by the
item id's prefix `country:`, `region:` or `place:`; other prefixes are ignored. A placement seed
that was never answered is not counted. Settings uses it to compare the stored progress with an
import file's before replacing.
