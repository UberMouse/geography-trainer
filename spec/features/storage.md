# Storage (STO)

What the app keeps in the browser and how: saving each answer, the export file and its import,
reset, the device settings, and loading the place and boundary data files the site ships with.

## Saving answers

### STO-01 Each answer is saved with the item's progress, in answer order
Up: PRD-10, PRD-04

*Why:* the learner never waits for storage, but no answer is lost or reordered behind their back.

```gherkin
Scenario: answers are saved one at a time, in order
  Given the learner answers two questions in a row
  When the answers are saved
  Then the first answer's save finishes before the second one's starts
    And each save writes the item's new progress and appends the answer to the answer log together
    And a second answer for the same item replaces its progress and adds a second log entry

Scenario: the learner keeps going while answers save
  Given an answer is still being saved
  When the learner moves to the next question
  Then the session carries on from the progress in memory
```

### STO-02 A failed save holds the answers behind it until a retry succeeds
Up: PRD-10

```gherkin
Scenario: a failed save stops the queue
  Given three answers are waiting to be saved
  When saving the second one fails
  Then the first one stays saved
    And the second and third stay unsaved, and nothing more is tried
    And an answer given after the failure also waits

Scenario: a retry resumes from the answer that failed
  Given saving an answer failed
  When the learner retries
  Then the saves restart from that answer, in order, and stop again at the next failure
    And the failure is still reported until that answer's save succeeds
```

### STO-03 A banner says when answers could not be saved
Up: PRD-10

```gherkin
Scenario: the banner appears on a failed save and goes once the retry succeeds
  Given saving an answer failed
  Then a banner on every page says how many answers could not be saved
    And says the learner can keep going, but closing or reloading before they are saved loses them
    And offers a Retry button
  When the learner presses Retry and the save succeeds
  Then the banner goes away

Scenario: no banner while saves succeed
  Given every answer saved
  Then no banner is shown
```

### STO-04 Leaving with unsaved answers asks first
Up: PRD-10

```gherkin
Scenario: closing or reloading with unsaved answers prompts
  Given at least one answer is not saved yet
  When the learner closes or reloads the tab
  Then the browser asks them to confirm leaving

Scenario: nothing unsaved, no prompt
  Given every answer is saved
  When the learner closes the tab
  Then it closes without a prompt
```

### STO-05 Reads see every answer already given
Up: PRD-10, PRD-07

```gherkin
Scenario: a page reads progress after the pending saves
  Given an answer has just been given and is still being saved
  When a page loads the learner's progress, finished placement tests or settings
  Then it waits for that save and sees the answer

Scenario: a failed save never blocks a read
  Given saving an answer failed
  When a page loads the learner's progress
  Then it loads at once, with the unsaved answer's progress laid over what is stored
```

### STO-06 Placement results never overwrite what was learned
Up: PRD-05, PRD-10

```gherkin
Scenario: seeds are added only where there is no progress
  Given an item already has stored progress
  When placement results include that item and some new ones
  Then the stored item's progress is unchanged
    And the new items are added
    And the write waits for any answer still being saved

Scenario: finishing a test saves its results and its marker together
  Given a placement test has finished
  When its results and the finished-test marker are saved
  Then both are stored or, if the save fails, neither is
    And a page reading progress right after sees both

Scenario: a marker for a malformed test scope is refused
  Given a finished-test marker that names no countries test, country or region
  When it is saved
  Then the save is refused and nothing is written

Scenario: a retaken test keeps one marker
  Given a test has been finished once
  When it is finished again
  Then it is listed once among the finished tests
```

## Export

### STO-07 The export file holds every progress record and nothing device-specific
Up: PRD-10

```gherkin
Scenario: the export holds progress, answers and finished tests
  Given the learner has progress, answers and finished placement tests
  When they export
  Then the file holds every item's progress, every logged answer with its id, and every finished-test marker
    And it records the moment it was exported
    And it does not hold the daily new-item limit or any other device setting

Scenario: export saves pending answers first
  Given answers are waiting to be saved, or a save had failed
  When the learner exports
  Then the waiting answers are saved first, a failed save being retried once
    And answers that still cannot be saved are left out of the file

Scenario: a stray marker is left out
  Given storage holds a finished-test marker whose scope is malformed
  When the learner exports
  Then that marker is not in the file, so the file still imports
```

### STO-08 Export then import restores every progress field
Up: PRD-10

```gherkin
Scenario: a round trip to another device
  Given the learner has progress (including an item that passed L3 and then lapsed),
    answers with distances and scores, and finished placement tests
  When they export, and import the file into an empty browser
  Then exporting there gives the same file: every row, every field, every answer id
    And a new answer there gets the next id after the highest imported one
```

## Import

### STO-09 Import replaces all progress and leaves device settings alone
Up: PRD-10, PRD-11

```gherkin
Scenario: import replaces
  Given the browser holds progress, answers and finished-test markers
  When the learner imports a valid file
  Then exactly the file's progress, answers and markers are stored
    And anything not in the file is gone
    And progress for items the app does not know is kept as it is
    And a session round this tab kept (SES-27) is dropped, so Home offers Start, not Continue

Scenario: settings survive an import
  Given the daily new-item limit is set
  When the learner imports a file
  Then the limit is unchanged
```

### STO-10 A malformed file is rejected and nothing changes
Up: PRD-10, PRD-03

*Why:* a bad file must never half-replace the learner's progress or leave records the scheduler
cannot use.

```gherkin
Scenario Outline: malformed files are rejected
  Given the browser holds progress
  When the learner imports a file with <problem>
  Then the import fails with a message naming <field>
    And the stored progress, answers and markers are unchanged
    Examples:
      | problem                                                       | field                 |
      | something that is not a progress export                       | the file              |
      | a different format name                                       | the format            |
      | a version this app does not know                              | the version           |
      | an export time that is not a date                             | exportedAt            |
      | progress or answers that are not lists                        | progress / answers    |
      | an item whose rung or highest rung is outside 1–3             | rung / highestRung    |
      | an item whose rung is above its highest rung                  | rung                  |
      | a card for a rung outside 1–3, or no card for the item's rung | cards                 |
      | a card with a missing, wrong-typed or out-of-range field      | the card's field      |
      | a card whose memory the scheduler cannot use                  | memory state          |
      | L3 pass days that are not real distinct days, or below L3     | l3PassDays            |
      | a lapse flag that is not true or false                        | inL3Lapse             |
      | an introduction time that is neither a date nor empty         | introducedAt          |
      | an answer id that is not a whole number in range              | the answer id         |
      | an answer rung outside 1–3 or rating outside 1–4              | rung / rating         |
      | an answer with a wrong-typed time, distance, score or day     | the answer's field    |
      | finished tests that are not well-formed marker keys           | placementsDone        |
      | two items, two answers or two markers that share a key        | the duplicated rows   |
```

### STO-11 A file from before the three-rung ladder is refused with a reason
Up: PRD-10, PRD-03

```gherkin
Scenario Outline: an older file
  Given a progress file of version <version>
  When the learner imports it
  Then the import fails, saying the file is from an older version of the app,
    from before the exercise ladder changed, and cannot be imported
    And nothing stored changes
    Examples:
      | version |
      | 1       |
      | 2       |
```

### STO-12 Import and unsaved answers
Up: PRD-10

```gherkin
Scenario: an import waits for pending saves and is not overwritten by them
  Given an answer is still being saved
  When the learner imports a file
  Then the import runs after that save
    And no answer saved or retried after the import starts writes over it

Scenario: answers that could not be saved are dropped by a successful import
  Given a save had failed
  When an import succeeds
  Then the unsaved answers are gone and no failure is reported

Scenario: a failed import keeps the unsaved answers
  Given a save had failed
  When the learner imports a file that is invalid, or whose write fails
  Then the unsaved answers are still waiting, in order, and the failure is still reported
```

### STO-13 Imported records are usable at the scheduler's limits
Up: PRD-10, PRD-04

```gherkin
Scenario: boundary records import and can be answered
  Given a file with a card at the lowest stability and difficulty the scheduler accepts,
    and a never-answered card
  When it is imported
  Then both are accepted
    And answering either item works
```

## Reset

### STO-14 Reset clears progress and keeps settings
Up: PRD-10

```gherkin
Scenario: reset
  Given progress, answers, finished-test markers, a daily limit and an unsaved answer
  When the learner resets
  Then progress, answers and markers are gone
    And the unsaved answer is dropped and no failure is reported
    And a session round this tab kept (SES-27) is dropped, so Home offers Start, not Continue
    And the daily limit is unchanged

Scenario: a failed reset changes nothing
  Given an unsaved answer and stored progress
  When the reset's write fails
  Then everything stored is unchanged and the unsaved answer still waits
    And a session round this tab kept is still kept

Scenario: work started after a reset lands after it
  Given a reset has started
  When a placement test finishes, or a page reads, right after
  Then the read sees the reset's result
    And the test's marker survives the reset
```

## Device settings

### STO-15 The daily new-item limit
Up: PRD-11

```gherkin
Scenario: the limit defaults to 15
  Given no limit is stored, or the stored one is not valid
  When the app reads the limit
  Then it is 15

Scenario Outline: saving the limit
  When the learner saves a limit of <value>
  Then it is <outcome>
    Examples:
      | value                | outcome                                 |
      | 5                    | saved                                   |
      | 30                   | saved                                   |
      | 50                   | saved                                   |
      | 4                    | refused, the stored limit unchanged     |
      | 51                   | refused, the stored limit unchanged     |
      | 10.5                 | refused, the stored limit unchanged     |
      | not a finite number  | refused, the stored limit unchanged     |
```

## Upgrades

### STO-16 Upgrading the database keeps every saved answer
Up: PRD-10

```gherkin
Scenario: a browser with the first database layout
  Given a browser holds progress and answers from before settings and markers were stored
  When the app opens it
  Then every progress record and answer is kept as it was
    And there are no finished tests and the limit reads as 15
```

## Data files

### STO-17 The world data loads once per visit
Up: PRD-14, PRD-12

```gherkin
Scenario: countries and places are fetched once
  Given several screens ask for the countries or the places at the same time, or later
  Then each file is fetched once from the site, under its base path
    And every screen gets the same loaded data
```

### STO-18 A country's regions load only when needed
Up: PRD-02, PRD-08, PRD-14

```gherkin
Scenario: the app starts without any region file
  Given a first visit
  When Home has loaded
  Then no country's region file has been fetched

Scenario: regions load on demand
  Given a country with a regions tier
  When a screen needs its regions
  Then that country's own regions file is fetched, once
    And each region names its country
    And no other country's regions file is fetched

Scenario: a country without regions
  Given a country that has no regions tier, or a country the data does not know
  When a screen asks for its regions
  Then the request fails, saying why
    And no regions file is fetched
```

### STO-19 A failed data load can be retried
Up: PRD-14

```gherkin
Scenario: a failed fetch
  Given the site answers a data file with an HTTP error
  When it is loaded
  Then the load fails with an error naming the file and the status
  When it is loaded again
  Then it is fetched again, and succeeds if the site now serves it
```

### STO-20 A country with no area of its own still has an outline
Up: PRD-08, PRD-12

```gherkin
Scenario Outline: tiny countries get a disc
  Given the countries file stores a country as <shape>
  When the countries are loaded
  Then that country is marked as having no area of its own, and is given the small disc GLB-26
    describes as its outline
    And countries with an area of their own are not marked
    Examples:
      | shape                 |
      | a point               |
      | a polygon of no area  |
```
