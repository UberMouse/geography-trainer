# Session (SES)

The daily study session: which questions it asks and in what order, what "today" means for the
daily limit, how a round runs and ends, and how a reload resumes it.

## Building a session

### SES-01 Due reviews come first, then new items
Up: PRD-06, PRD-04

*Why:* what is due is what the learner is about to forget.

```gherkin
Scenario: due reviews lead, most overdue first
  Given 3 unlocked items are due, one 5 days ago, one 3 days ago and one 1 day ago
    And new items are unlocked and the daily limit has room
  When a session is built
  Then the first 3 questions are the reviews, the most overdue first
    And the new items follow them

Scenario: equally overdue reviews are ordered by item id
  Given several reviews fell due at the same moment
  When a session is built
  Then they are ordered by item id, not by the curriculum's new-item order
```

### SES-02 A review is asked at the item's current rung, once it is due
Up: PRD-03, PRD-04

```gherkin
Scenario Outline: only items due by now are reviewed
  Given an answered item at L<rung> whose next review is <when>
  When a session is built
  Then it is <asked>
  Examples:
    | rung | when                         | asked              |
    | 2    | a day ago                    | asked at L2        |
    | 1    | exactly now                  | asked at L1        |
    | 1    | a millisecond from now       | not asked          |
    | 3    | two days from now            | not asked          |
```

### SES-03 New items fill the daily limit that is left
Up: PRD-06, PRD-11

```gherkin
Scenario Outline: new items are capped by what today has already introduced
  Given nothing is due and plenty of new items are unlocked
    And the daily limit is <cap> and <today> new items were introduced today
  When a session is built
  Then it holds <count> new items
  Examples:
    | cap        | today | count |
    | default 15 | 0     | 15    |
    | default 15 | 10    | 5     |
    | 4          | 2     | 2     |
    | 0          | 0     | 0     |
    | default 15 | 15    | 0     |
    | default 15 | 40    | 0     |

Scenario: the limit never holds back a review
  Given today's limit is used up
    And a review is due
  When a session is built
  Then the review is asked
```

### SES-04 New items start at the bottom rung, or where placement left them
Up: PRD-03, PRD-05

```gherkin
Scenario: a never-seen item is asked at L1, in new-item order
  Given no progress
  When a session is built
  Then every new item is asked at L1
    And they come in the curriculum's new-item order, easiest first

Scenario: a placement seed that was never answered counts as new
  Given placement left many items to start at L2, none answered yet
  When a session is built
  Then they are asked at L2
    And they count against the daily limit like any new item

Scenario: a passed placement seed is a review
  Given placement passed an item, which comes back two days later
  When a session is built before then
  Then it is not asked
  When a session is built two days later
  Then it is asked at L3 as a review
```

### SES-05 A session asks nothing locked, and nothing twice
Up: PRD-02, PRD-06

```gherkin
Scenario: locked items are left out, even with due progress
  Given a country that is not mastered, so its places are locked
    And one of its places has progress that is due
  When a session is built
  Then only the country is asked

Scenario: every item appears once
  When a session is built
  Then no item appears in it twice
```

### SES-06 A session can be limited to some place types
Up: PRD-06

The app itself always builds sessions with every type; the filter is part of the engine's
session API.

```gherkin
Scenario: filtered place types are left out, due and new
  Given a session is built keeping only cities
  Then places of other types are left out, both due reviews and new items
    And a region with no city in it is left out, with its due reviews paused
    And countries are always kept
```

### SES-07 Runs of one exercise type are kept short
Up: PRD-06

```gherkin
Scenario: no more than 2 questions in a row share a rung when the mix allows
  Given a session's questions span more than one rung
    And some order of them has no run longer than 2
  When a session is built
  Then no 3 questions in a row share a rung
    And building it again gives the same order

Scenario: when a run longer than 2 is unavoidable, it is the shortest possible
  Given 3 L2 reviews and 15 new L1 items
  When a session is built
  Then its longest run of one rung is 4, the shortest any order allows
    And the L2 questions are spread through it rather than spent at the start

Scenario: a new item can come before an overdue review to break a run
  Given 2 due L2 reviews and 4 new L1 items
  When a session is built
  Then no 3 questions in a row share a rung
    And so a new item is asked between the reviews

Scenario: a single-rung session keeps its order
  Given every question is at the same rung
  When a session is built
  Then they stay in priority order as one run
```

## Today

### SES-08 "Today" is the learner's local day
Up: PRD-06, PRD-11

The day boundary is the learner's local midnight, not UTC.

```gherkin
Scenario Outline: new items introduced today are counted by local day
  Given 2 items were first answered at 20:00 UTC on 10 March
  When it is <now> UTC and the learner's clock is <offset> from UTC
  Then <count> new items count as introduced today
  Examples:
    | now          | offset | count |
    | 23:00, 10 Mar | +0h    | 2     |
    | 23:00, 10 Mar | +12h   | 2     |
    | 11:59, 10 Mar | +12h   | 0     |
    | 03:00, 11 Mar | -12h   | 2     |
    | 13:00, 11 Mar | -12h   | 0     |
```

### SES-09 Today's numbers
Up: PRD-07, PRD-11

What Home reports about today: how many reviews are due, new items introduced today against the
daily limit, how many items are being learned and how many are learned, and how long a session
started now would be.

```gherkin
Scenario: a fresh start
  Given no progress
  Then nothing is due, nothing was introduced today, nothing is learning or learned
    And a session would be the full daily limit of new items

Scenario: the session length is the session that would be built
  Given 4 items were introduced a minute ago
  Then 4 count as introduced today
    And the session length is the length of a session built now with those 4 counted

Scenario: learning versus learned
  Given one item answered once, one mastered and one with no answer yet
  Then one is learning and one is learned

Scenario: the limit is shared by every tier
  Given a mastered country and one of its regions introduced today
  Then the region counts as introduced today
    And a daily limit of 1 leaves no room for another new item, of any tier

Scenario: progress for items the data no longer has is ignored
  Given progress rows for ids that are not in the curriculum
  Then they count toward none of today's numbers
```

## Running a round

### SES-10 Each answer is shown, then Next moves on
Up: PRD-01, PRD-06

```gherkin
Scenario: a session from Home climbs the rungs on the globe
  Given a fresh learner starts a session from Home
  When they answer correctly and unhurried, again and again
  Then the session asks L1, L2 and L3 questions, each with its exercise on the globe
    And after each answer the result and the reveal show, with Next
    And Next shows the next question, with the last one's reveal cleared

Scenario: a miss is shown as incorrect
  When a tap at L2 or L3 lands on the far side of the Earth
  Then the result says it is incorrect and names the place
    And the reveal gives the distance and a low maptap score
```

### SES-11 An item that climbed or lapsed comes back in the same session
Up: PRD-03, PRD-06

```gherkin
Scenario Outline: what an answer does to the item's place in the session
  Given an item asked at L<rung>
  When it is answered <answer>
  Then it <next>
  Examples:
    | rung | answer                      | next                                                |
    | 1    | Good, climbing to L2        | comes back at L2 after 3 other questions            |
    | 1    | Again                       | comes back at L1 after 3 other questions            |
    | 2    | Again, dropping to L1       | comes back at L1 after 3 other questions            |
    | 3    | Good, staying at L3         | does not come back this session                     |
    | 2    | Hard, a near miss           | does not come back this session                     |

Scenario: fewer than 3 questions left
  Given fewer than 3 other questions remain
  When an item climbs
  Then it comes back at the end of the queue

Scenario: in the browser
  Given a fresh learner's first question at L1
  When they answer it correctly and unhurried
  Then the same item is asked again at L2 within the next 4 questions
```

### SES-12 An item is asked at most 6 times in a session
Up: PRD-06

```gherkin
Scenario: a repeated miss stops coming back
  Given an item answered Again 5 times this session
  When it is answered Again a 6th time
  Then it does not come back this session

Scenario: one item never waits in the queue twice
  Given a long session of misses and climbs
  Then no item is ever queued twice at once
    And the session ends, with no item answered more than 6 times
```

### SES-13 A round is 20 answers
Up: PRD-06

```gherkin
Scenario: a round ends after 20 answers
  Given a session of 25 questions
  When 20 have been answered
  Then the round ends with its summary, and questions remain

Scenario: a round ends when the queue empties
  Given the last question is answered and not re-queued
  Then the round ends with nothing left to ask

Scenario: Keep going starts the next round
  Given a round ended with questions remaining
  When the learner keeps going
  Then the next round starts with its counts at zero and the rest of the queue as it was
```

### SES-14 The counter counts items done, and never grows
Up: PRD-06

The header shows the question's number within its round, and the items the session has finished
out of the items it started with.

```gherkin
Scenario: a fresh session
  Given a session of 7 items
  Then the header says question 1, with 0 of 7 done

Scenario: a re-asked item does not grow the total
  Given a session of 3 items
  When the first item climbs and is queued again
  Then the header says question 2, with 0 of 3 done
  When the second item is answered and not queued again
  Then the header says question 3, with 1 of 3 done
```

### SES-15 An answer that cannot be recorded skips the question
Up: PRD-06, PRD-10

```gherkin
Scenario: the answer cannot be recorded
  Given the current question's answer throws while it is being recorded
  Then the learner is told the answer could not be recorded and the question is skipped
    And the question is not queued again
    And it does not count toward the round's 20 answers or its score
    And it does count toward the item's 6 asks
```

### SES-16 Each answer is recorded with what happened
Up: PRD-04, PRD-10

```gherkin
Scenario: an answer is saved with its details
  When the learner answers a question
  Then the item's new progress is saved, starting from fresh progress on its first answer
    And the answer is saved with the item, rung, rating, whether it was correct, the time taken,
      the time it was given and the learner's local day
    And a tap answer also carries its distance and maptap score

Scenario: a clock that went backwards does not break an answer
  Given the item's card was last reviewed later than the current time
  When the learner answers it
  Then the answer is recorded at the current time, without an error
```

### SES-17 Choices vary between visits, not within one
Up: PRD-03

```gherkin
Scenario: the distractors for a question
  Given the same item at the same position in a session
  Then it gets the same choices on every render within one visit to the session
    And other choices on another visit, at another position, or for another item
```

### SES-18 Focus follows the session
Up: PRD-06, PRD-09

```gherkin
Scenario: focus moves to what replaced the button
  When the learner presses Next
  Then focus moves to the new question
  When a round ends
  Then focus moves to the summary's heading
```

### SES-19 A session fits a phone
Up: PRD-09

```gherkin
Scenario: an L1 question at phone width
  Given a phone-width screen
  When an L1 question shows
  Then all 4 choices are visible within the panel without scrolling, below the app bar (GLB-36)
    And nothing scrolls sideways
```

### SES-20 A session works without WebGL
Up: PRD-06, PRD-08

```gherkin
Scenario: the globe cannot draw
  Given the browser has no WebGL
  When a session starts
  Then the globe's area says it cannot show the globe
    And an L1 question can still be answered, and Next moves on, without a page error
```

### SES-21 An empty session and a failed load
Up: PRD-06

```gherkin
Scenario: nothing to study
  Given nothing is due and today's new items are used up
  When the learner opens the session
  Then it says there is nothing to study right now, with a link back to Home

Scenario: the data cannot be loaded
  Given the map data or the saved progress fails to load
  When the learner opens the session
  Then it says what could not be loaded, with Retry
  When the data can be loaded and the learner presses Retry
  Then the session starts
```

## The summary

### SES-22 A round ends in a summary
Up: PRD-06

```gherkin
Scenario: the summary
  When a round ends
  Then a summary says how many of the round's answers were right
    And it links back to Home
    And it offers Keep going when questions remain

Scenario: the last round
  When a round ends with nothing left to ask
  Then the summary says that is everything for today, with no Keep going
```

### SES-23 The summary names what the round unlocked
Up: PRD-02, PRD-06

```gherkin
Scenario Outline: an item mastered this round
  Given <item> was mastered during the round
  Then the summary says it unlocked <what>
  Examples:
    | item                                | what                                        |
    | a country with a regions tier       | the country's regions                       |
    | a country without one               | the country's places                        |
    | a region                            | the region's places, naming its country     |

Scenario: unlocks are listed once, and only when there are any
  Given an item mastered twice in a round, and one whose tier is empty
  Then the first is listed once and the second not at all
    And with nothing mastered there are no unlock lines

Scenario: unlocked items wait for the next session
  Given the round unlocked something
  Then the summary says the new items join from the next session
    And they are not added to the session in progress
```

### SES-24 The summary offers a test-out
Up: PRD-05

```gherkin
Scenario: a newly unlocked tier can be tested out of
  Given the round mastered an item whose unlocked tier can be tested out of
  Then its unlock line links to that test-out
  When the learner follows it
  Then the test-out for that tier starts
```

## Resuming after a reload

### SES-25 A reload carries on where the round was
Up: PRD-06

The session in progress is kept per browser tab.

```gherkin
Scenario: a reload mid-round
  Given the learner has answered 3 questions of a round
  When they reload the page
  Then the same question is asked, with the same header counts

Scenario: a reload after answering, before Next
  Given the learner answered a question and its reveal is showing
  When they reload the page
  Then the session carries on at the next question, not the one just answered

Scenario: a reload on a summary
  Given a round's summary is showing, with questions left in the session
  When they reload the page
  Then the same summary shows, with the same unlock lines and Test out links
    And Keep going carries on with the rest of the queue

Scenario: a reload on the last summary of the day
  Given the summary of a round that left nothing to ask is showing
  When they reload the page
  Then the same summary shows, with the same unlock lines and Test out links
    And it says that is everything for today, with no Keep going

Scenario: a reload mid-round keeps what the round has mastered
  Given an item was mastered earlier in the round
  When the learner reloads the page and finishes the round
  Then the summary still says what that item unlocked, a region naming its country

Scenario: Keep going starts the next round's list afresh
  Given a summary listed what the round unlocked
  When the learner presses Keep going and then reloads the page
  Then the next round's summary lists only what that round mastered

Scenario: an unlock the saved progress does not back is left out
  Given the round mastered an item, but that answer was not saved before a reload
  When the page reloads
  Then the round carries on, and its summary does not list that item

Scenario: reloading the same summary again
  Given a summary was shown again after a reload
  When they reload the page again
  Then the same summary still shows
```

### SES-26 A saved round that cannot carry on is dropped
Up: PRD-06, PRD-10

```gherkin
Scenario Outline: a fresh session is built instead
  Given a round was saved in this tab
    And <why>
  When the session opens
  Then a fresh session is built
  Examples:
    | why                                                                 |
    | it was saved on another local day                                   |
    | what was saved is not valid                                         |
    | it has nothing left to ask, and nothing was answered in it          |
    | progress was reset or imported, so a queued rung has no card        |
    | it has nothing left to ask, and an item asked in it has no progress |
    | it has nothing left to ask, and a review has come due since         |
    | a queued or mastered item is no longer in the data                  |
    | the browser's session storage is missing or refuses access          |
```

### SES-27 Leaving the session keeps its round for the day
Up: PRD-06, PRD-17

*Why:* with the app bar on every page, leaving a session to look at Progress is one tap; it
should not cost the round's place, its counter or the re-asks it has queued. The round is kept
where a reload keeps it, per browser tab (SES-25), so closing the tab still ends it.

```gherkin
Scenario: leaving mid-round and coming back
  Given the learner answered 3 questions of a round and then left the session for another page
  When they open the session again, the same day, in the same tab
  Then the same question is asked, with the same header counts

Scenario: leaving after answering, before Next
  Given the learner answered a question and left while its reveal showed
  When they open the session again
  Then the session carries on at the next question, not the one just answered

Scenario: leaving on a summary
  Given a round's summary was showing when the learner left
  When they open the session again
  Then the same summary shows, with the same unlock lines and Test out links
    But a test-out finished since is no longer offered: its unlock line stays, without the link

Scenario: a kept round that cannot carry on
  Given a kept round that SES-26 would drop, such as one from another local day
  When the learner opens the session
  Then a fresh session is built
```

### SES-28 A running session has a link to Home
Up: PRD-06, PRD-17

*Why:* the link was built with the session, but no scenario promised a way out of one.

```gherkin
Scenario: the Quit link
  Given a session is showing a question, or the reveal of an answer
  Then beside the counter a link says it leaves for Home
  When the learner follows it
  Then Home opens, offering to continue the session (SCR-03)
    And no pin or reveal is left on the globe, and taps on Home's globe drop no pin
    And the round is kept (SES-27)
```
