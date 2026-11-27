# Session contracts (SES)

The session engine (`src/engine/session.ts`, `sessionRun.ts`, `today.ts`), the Session page's
helpers (`src/pages/sessionView.ts`) and the saved run (`src/storage/sessionRunStore.ts`).

### SES-C01 Session constants
Up: SES-03, SES-07, SES-11, SES-12, SES-13

| Constant | Value | Unit | Meaning |
|---|---|---|---|
| `DAILY_NEW_CAP` | 15 | items per local day | the default daily limit of new items (a device setting overrides it) |
| `SESSION_MAX_RUN` | 2 | questions | the longest run of one rung a session aims for |
| `SESSION_ROUND_SIZE` | 20 | answers | answers in a round before its summary |
| `SESSION_REQUEUE_GAP` | 3 | questions | other questions before a climbed or lapsed item comes back |
| `SESSION_MAX_ASKS_PER_ITEM` | 6 | answers | the most answers one item gets in a session |

All live in `src/engine/config.ts`.

### SES-C02 Building the queue
Up: SES-01, SES-02, SES-03, SES-04, SES-05, SES-06, SES-07

```ts
interface SessionQuestion { itemId: string; rung: 1 | 2 | 3 }
interface SessionInput {
  curriculum: Curriculum;
  progress: Readonly<Record<string, ItemProgress>>;
  now: Date;
  introducedToday: number;              // progress rows whose introducedAt is on today's local day
  dailyCap?: number;                    // default DAILY_NEW_CAP; caps new items only
  placeTypes?: ReadonlySet<string>;     // maptap types to keep; undefined keeps all
  rng?: () => number;                   // accepted, unused: the queue is deterministic
}
buildSession(input: SessionInput): SessionQuestion[]
dueQuestions(input: Pick<SessionInput, 'curriculum' | 'progress' | 'now' | 'placeTypes'>): SessionQuestion[]
```

- `dueQuestions`: unlocked items with an answered card (`isIntroduced`) whose current card is due
  at or before `now`, at `dueRung` (the current rung), ordered by due time then item id.
- `buildSession`: `dueQuestions`, then `newItems` (no progress, or never answered) in curriculum
  order, the first `max(0, dailyCap - introducedToday)`, each at its progress's rung or L1 without
  progress. Then interleaved:
  - the target longest run is `max(SESSION_MAX_RUN, ceil(cMax / (n - cMax + 1)))`, where `n` is the
    queue length and `cMax` the count of the commonest rung;
  - each pick is the highest-priority remaining question that keeps the run within the target and
    leaves a remainder that can still meet it; failing that, the first within the target; failing
    that, the first.
- Pure and deterministic: no clock, no randomness, inputs not mutated.

### SES-C03 Today's numbers
Up: SES-08, SES-09

```ts
introducedToday(curriculum, progress, now: Date, tzOffsetMinutes: number): number
todayNumbers(curriculum, progress, now: Date, tzOffsetMinutes: number, dailyCap = DAILY_NEW_CAP): {
  due: number;            // dueQuestions(...).length
  newToday: number;       // introducedToday(...)
  dailyCap: number;
  learning: number;       // studied (isStudied) and not mastered
  learned: number;        // mastered (isMastered)
  sessionLength: number;  // buildSession({ ..., introducedToday: newToday, dailyCap }).length
}
```

- `tzOffsetMinutes` is minutes **east** of UTC (`-new Date().getTimezoneOffset()`); the local day is
  `localDayKey(now, tzOffsetMinutes)`, a `YYYY-MM-DD` string.
- Only ids in `curriculum.items` are counted. No place-type filter is applied.
- Pure; `src/engine/today.ts`.

### SES-C04 The session run
Up: SES-11, SES-12, SES-13, SES-14, SES-15

```ts
interface SessionRun {
  queue: readonly SessionQuestion[];   // still to ask; the head is the current question
  answered: number;                    // answers and skips in the whole session
  answeredInRound: number;             // graded answers in the current round
  correctInRound: number;
  asks: Readonly<Record<string, number>>;  // answers and skips per item id this session
  roundTotal: number;                  // min(SESSION_ROUND_SIZE, answeredInRound + queue.length)
  itemTotal: number;                   // distinct items the session started with
}
interface RunAnswer { rating: Grade; correct: boolean; after: ItemProgress }

startRun(questions): SessionRun
answerCurrent(run, answer: RunAnswer): SessionRun
skipCurrent(run): SessionRun
nextRound(run): SessionRun            // round counts to 0, queue unchanged
roundEnded(run): boolean              // answeredInRound >= SESSION_ROUND_SIZE || queue empty
questionsRemain(run): boolean         // queue not empty
itemsDone(run): number                // itemTotal - distinct item ids in queue; never decreases
```

- `answerCurrent` re-queues the head at `dueRung(after)`, after `SESSION_REQUEUE_GAP` questions
  (at the end when fewer remain), when `after.rung > rung asked` or the rating is Again, unless this
  was the item's `SESSION_MAX_ASKS_PER_ITEM`-th ask.
- `skipCurrent` drops the head without a re-queue; it adds to `answered` and `asks` only.
- Both throw `No current question` on an empty queue. Every function is pure and returns a new run.
- `answered` keys the exercise on screen, so a skip still remounts it.

### SES-C05 The saved run
Up: SES-23, SES-24, SES-25, SES-26, SES-27

The run in progress is kept in the tab's `sessionStorage` under the key
`geography-trainer:session-run`, as JSON:

```json
{ "dayKey": "2026-03-01", "run": { "queue": [{ "itemId": "country:peru", "rung": 1 }],
  "answered": 1, "answeredInRound": 1, "correctInRound": 1,
  "asks": { "country:france": 1 }, "roundTotal": 2, "itemTotal": 2 },
  "mastered": ["country:france"], "testable": ["country:france"] }
```

```ts
interface SavedSession { run: SessionRun; mastered: readonly string[]; testable: readonly string[] }

saveSessionRun(dayKey, run, mastered, testable): void
parseSavedRun(text, dayKey, progress, isKnown): SavedSession | null
loadSessionRun(dayKey, progress, isKnown): SavedSession | null
```

- `mastered` is the ids of the items that passed from not mastered to mastered in the current
  round, in answer order; `testable` is those of them whose unlock line links to a test-out, as
  judged when each was mastered. A country mastered while its gate (CUR-21) was shut is judged
  again after each later answer in the round, and joins `testable` (after the ids already in it)
  once its gate opens. They are what the summary's unlock lines and Test out links are drawn
  from.
- Written after every answer or skip (as already answered, with that answer's mastery included)
  and on Keep going (with `mastered` and `testable` empty); written again, as resumed, when the
  Session page mounts on a resumed run; removed when the Session page unmounts (leaving it). A
  reload runs no cleanup, so the run survives it, and the write on mount keeps it through a dev
  build's StrictMode remount, so reloading the same summary twice shows it twice.
- `parseSavedRun(text, dayKey, progress, isKnown)` returns the saved session, or null when the
  text is null or not JSON, `dayKey` differs, a field is missing or not a non-negative integer, a
  rung is not 1–3, the queue is empty and `run.answered` is 0, or a queued question is
  unanswerable: `isKnown(itemId)` is false, or the item has progress without a card at that rung
  or with the rung above `highestRung`, or has no progress and the rung is not 1.
- An empty queue with `run.answered` above 0 is the last summary of the day: it is returned, and
  the page shows that summary rather than "nothing to study".
- A missing `mastered` or `testable` reads as `[]` (a run saved before they existed). Either makes
  the result null when present but not an array of strings, when it holds an id `isKnown` rejects, or,
  for `testable`, an id not in `mastered`.
- A `mastered` id whose progress is missing or not `isMastered` (its answer was not saved before
  the reload) is left out of `mastered`, and out of `testable`; the rest of the session is
  returned.
- When the queue is empty, the result is also null when an id in `run.asks` has no progress, and
  the page builds a fresh session instead of the resumed one when `dueQuestions` (curriculum,
  progress, now) holds an item not in `run.asks`. With no queued question left to check against,
  these notice that a new item's answer could not be recorded (SES-15), that a review has come due
  since, and most resets and imports in another tab: the session is then rebuilt from the progress
  as it is. Items the session asked, in any of its rounds (the keys of `run.asks`), do not count,
  since their learning steps come due within minutes; so a review whose answer was lost in a reload
  before it was saved is not noticed here, and a later session asks it again. Nor do new items
  count, including those the round unlocked, so the summary keeps its unlock lines. `dueQuestions`
  is only consulted when the queue is empty.
- `loadSessionRun`, `saveSessionRun` and `clearSessionRun` swallow storage errors: a load that
  throws is null, a save or clear that throws does nothing.

### SES-C06 Recording an answer and seeding its exercise
Up: SES-16, SES-17

```ts
answerEntry(before: ItemProgress | undefined, question, result: ExerciseResult, now: Date,
            tzOffsetMinutes: number): { after: ItemProgress; entry: AnswerEntry }
questionSeed(itemId: string, position: number, salt: number): number
```

- `answerEntry` applies the rating to `before` (or `createProgress(itemId, now)`) at the asked rung,
  scheduled at the later of `now` and that card's `last_review`; `entry.progress` is `after`, and
  `entry.answer` carries `itemId, rung, rating, correct, timeMs, km?, maptapScore?`, `at` = `now`
  in epoch ms and `dayKey` = `localDayKey(now, tzOffsetMinutes)`.
- `questionSeed` is 32-bit FNV-1a (offset basis `0x811c9dc5`, prime `0x01000193`) of
  `` `${salt}:${itemId}:${position}` ``, as an unsigned integer: `questionSeed('country:france', 3, 7)`
  is `49630588`. The page picks `salt` once per visit, uniformly in `[0, 2^32)`, and passes
  `run.answered` as the position.

### SES-C07 The page's view helpers
Up: SES-10, SES-14, SES-21, SES-23, SES-25

- `questionHeader(run)`: the question number `answeredInRound + 1`, then `itemsDone(run)` of
  `itemTotal` done.
- `countriesNeedingRegions(curriculum, itemIds)`: the bare ids of the countries owning a region
  or a place under a region among `itemIds`, once each in first-seen order. At session load
  the page passes the queued questions' item ids and, for a resumed round, its `mastered` ids, so
  a mastered region's unlock line can name it; only these region files are loaded. Throws
  `Unknown item` for an id not in the curriculum, which fails the load (with Retry).
- `unlockLines(curriculum, progress, masteredIds, nameOf)`: for each distinct mastered id that
  unlocks a tier (`unlockedBy`), `{ id, text }`, the text naming the item, the unlocked tier, and
  for a region its country. For a country whose `gateOpen` (CUR-C08) is false in `progress`, the
  text instead names the gate's count and `masteredCountryCount`, and the item is not `testable`.
- `gateOpenedLines(curriculum, progress, masteredIds)`: one `{ id: 'gate:<count>', text, opened }`
  per gate count (60, 150) that `masteredCountryCount(progress)` reaches while the count before
  the round (it, less the country ids in `masteredIds`) is below it. `opened` is how many mastered
  countries of that wave it opened; the text names the count and, when `opened` is above 0, that
  number, and with `opened` 0 says instead that that wave's countries open as each is mastered.
  Shown after the unlock lines. The summary's "next session" sentence counts a gate line only
  when its `opened` is above 0.
- `withMastered(round, itemId, testOut)`: `round` (`{ mastered, testable }`, a `RoundMastery`)
  with `itemId` appended to `mastered`, and to `testable` when `testOut`; the page's bookkeeping
  for SES-C05's two lists.
- `withGateRecheck(round, isTestable)`: `round` with each country id in `mastered` that is not in
  `testable` and for which `isTestable(id)` is true appended to `testable`, in `mastered` order;
  the same object when none is. The page calls it after every answer with `showsTestOutLink`
  (PLC-C07) on the progress after that answer. All in `src/pages/sessionView.ts`.
