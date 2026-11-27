# Placement (PLC)

The placement test on first launch (countries) and the test-out of a newly unlocked tier: how the
ability estimate moves, which question comes next, when the test stops, and how every tested and
untested item is placed when it ends.

## What is tested

### PLC-01 The first-launch test covers every country not yet started
Up: PRD-05

```gherkin
Scenario: a fresh profile is offered the countries test
  Given no progress is stored
  When the learner opens Home
  Then Home offers the placement test
    And following the offer opens the countries test

Scenario: the countries test leaves out started countries
  Given some countries already have a progress row
  When the countries test is built
  Then it covers every other country, in curriculum order
    And each item carries its difficulty band and the world area of its centre
```

### PLC-02 A test-out covers the unstarted children of the item
Up: PRD-05, PRD-02

```gherkin
Scenario Outline: the children of the tested item are the questions
  Given <item> is being tested out of
  When its test is built
  Then the questions are its <children> that have no progress row
    Examples:
      | item                             | children |
      | a country with a regions tier    | regions  |
      | a country without a regions tier | places   |
      | a region                         | places   |
      | a place                          | (none)   |

Scenario: an item outside the curriculum
  Given an id that is not in the curriculum
  When its test is built
  Then building it fails
```

### PLC-03 Every question is a tap at the top rung
Up: PRD-05, PRD-03

```gherkin
Scenario: placement asks only the top rung
  Given a placement test or a test-out is running
  When a question shows
  Then it is an L3 question: tap the named item on the globe with no borders drawn (a region
    is the exception, below)

Scenario: a test-out over a country's regions
  Given a test-out over a country's regions is running
  When a question shows
  Then it is an L3 region question as an exercise asks one: named with its country, with only
    its country's outline drawn and the camera on the country (EXR-02, EXR-09, EXR-24)
```

## The ability estimate

### PLC-04 The estimate is a posterior over ability, updated after every answer
Up: PRD-05

*Why:* a learner of ability `a` knows an item of level `d` with probability
`logistic(slope · (a − d))`, so each answer moves the whole distribution, not a single number.

```gherkin
Scenario Outline: a learner who knows everything up to a level is placed there
  Given a learner who taps every item at level <k> or below right and every harder one far off
  When the test runs to its end
  Then the estimate is <k> or <k> + 1
    And between 12 and 20 questions were asked
    Examples:
      | k |
      | 2 |
      | 4 |
      | 6 |

Scenario: noisy learners are placed close to their ability
  Given learners of abilities 2, 3.5, 5 and 6.5 who pass each item with the model's own probability
  When the test runs to its end for 40 of each
  Then every ability estimate is within 2 levels of the true one
    And the average error for each ability is under 0.75 levels

Scenario: the extremes
  Given a learner who gets every question right
  When the test ends
  Then the estimate is 8
  Given a learner who gets every question far off
  When the test ends
  Then the estimate is 0, meaning no level was shown
```

### PLC-05 A close miss earns half credit
Up: PRD-05, PRD-01

```gherkin
Scenario Outline: the credit an answer earns
  Given a placement question about a <tier>
  When the answer is rated <rating> with the tap <km> km from the target
  Then it earns <credit> credit
    Examples:
      | tier    | rating     | km           | credit |
      | country | Good       | 0            | 1      |
      | country | Easy       | not measured | 1      |
      | country | Hard       | 600          | 0.5    |
      | country | Again      | 601          | 0      |
      | region  | Again      | 150          | 0.5    |
      | place   | Again      | 201          | 0      |
      | country | Again      | not measured | 0      |

Scenario: close misses read as rough knowledge
  Given a learner who is right only at level 1, close at levels 2 to 6 and far off above
  When the test ends
  Then the estimate is at least 3
    And no level-1 item is left to start from the beginning
```

Countries and regions measure the distance from the border, places from the point.

### PLC-06 The reveal says when a miss was close
Up: PRD-05

```gherkin
Scenario: a close miss is acknowledged
  Given a placement question
  When the learner's tap misses but is close enough for half credit
  Then the reveal adds a note that the tap shows they roughly know where it is

Scenario: no note otherwise
  Given a placement question
  When the tap is right or far off
  Then no close-miss note shows
```

## Choosing the next question

### PLC-07 Each question aims at the estimate
Up: PRD-05

```gherkin
Scenario: the first question is at the start level
  Given a test that has asked nothing
  When the first question is chosen
  Then its level is 4

Scenario: the aim follows the answers
  Given the first question was answered
  When the next question is chosen
  Then it is harder after a pass
    And easier after a miss

Scenario: an empty level falls back to the nearest one
  Given no unasked item sits at the aimed level
  When the next question is chosen
  Then it is drawn from the unasked items within half a level of the nearest unasked level
```

The aim is the estimate clamped to levels 1 to 8.

### PLC-08 Questions spread across the world
Up: PRD-05

```gherkin
Scenario: the least-asked world area goes next
  Given several unasked items near the aimed level, in different world areas
  When the next question is chosen
  Then it comes from the area asked least so far
    And ties are broken at random
    And over a test the areas are asked within 2 questions of each other

Scenario Outline: points are bucketed into coarse world areas
  Given an item whose centre is at <lng>, <lat>
  Then its world area is <area>
    Examples:
      | lng  | lat  | area              | e.g.             |
      | -98  | 39   | north-america     | United States    |
      | -84  | 10   | north-america     | Costa Rica       |
      | -80  | 8.5  | north-america     | Panama           |
      | -74  | 5    | south-america     | Colombia         |
      | -55  | -10  | south-america     | Brazil           |
      | 10   | 51   | europe            | Germany          |
      | 14.4 | 35.9 | europe            | Malta            |
      | 10   | 35.2 | africa            | Tunisia          |
      | 20   | 0    | africa            | Central Africa   |
      | 30   | 26   | africa            | Egypt            |
      | 39   | 15   | africa            | Eritrea          |
      | 59   | -20  | africa            | Mauritius        |
      | 35   | 32   | west-central-asia | Palestine        |
      | 45   | 24   | west-central-asia | Saudi Arabia     |
      | 47   | 15   | west-central-asia | Yemen            |
      | 67   | 48   | west-central-asia | Kazakhstan       |
      | 73   | 3    | west-central-asia | Maldives         |
      | 105  | 35   | east-south-asia   | China            |
      | 134  | -25  | oceania           | Australia        |
      | 178  | -18  | oceania           | Fiji             |
      | -145 | -13  | oceania           | French Polynesia |
      | -130 | -25  | oceania           | Pitcairn         |
      | 0    | -80  | antarctica        | Antarctica       |

Scenario: an item with no centre
  Given an item with no centre
  Then its world area is unknown
```

### PLC-09 No item is asked twice, and items without a difficulty are never asked
Up: PRD-05

```gherkin
Scenario: each item at most once
  When a test runs to its end
  Then no item was asked more than once

Scenario: items without a difficulty
  Given an item whose difficulty is not a finite number
  When the test runs
  Then it is never asked
    And it ends up starting from the beginning

Scenario: nothing can be asked
  Given a test whose items all lack a difficulty
  When it opens
  Then the page says there are no questions to ask here yet
    And links back to Home
```

### PLC-10 One question is open at a time, and the test can be resumed from its state
Up: PRD-05

```gherkin
Scenario: asking again returns the open question
  Given a question has been handed out and not answered
  When the next question is asked for again
  Then the same question comes back and no randomness is spent

Scenario: only the open question can be answered
  Given a test in any state
  When an answer arrives for an item that is not the open question
    (never asked, already answered, or another item)
  Then it is rejected

Scenario: the state survives a JSON round trip
  Given a test's state, with or without an open question
  When it is written to JSON and read back
  Then the next question and the final result are the same as before
```

## When the test stops

### PLC-11 The test stops once the estimate is settled, or at the limit
Up: PRD-05

```gherkin
Scenario: stopping early when confident
  Given at least 12 answers
    And the estimate's spread is below 0.45 levels
  Then the test is over

Scenario: the hard limit
  Given 20 answers
  Then the test is over, whatever the spread

Scenario: the pool runs out
  Given every askable item has been asked
  Then the test is over

Scenario: confident learners finish early
  Given learners who know everything up to level 5
  When their tests run
  Then some finish before the 20th question
```

### PLC-12 The learner can finish early, and placement then holds back
Up: PRD-05

```gherkin
Scenario: finishing with no answers
  Given a test that has asked nothing
  When it is finished
  Then the estimate is 0
    And every item starts from the beginning

Scenario: finishing with few answers places only what was asked
  Given fewer than 8 answers and unasked items left
  When the test is finished
  Then the estimate is 0
    And every answered item is placed by its answer
    And every unasked item starts from the beginning

Scenario: a small pool that ran out still places
  Given a pool of fewer than 8 items, all of them answered
  When the test ends
  Then a level is placed from those answers

Scenario: an open question at the finish
  Given a question was on screen when the test was finished
  Then that item counts as untested
```

## Placing items

### PLC-13 Answered items are placed by their answer
Up: PRD-05, PRD-03

What each placement makes of the item's progress (its rung, its card, its pass days) is
`grading.md`'s (GRD-19).

```gherkin
Scenario Outline: what an answer places
  Given a placement answer that earned <credit> credit
  When the test's results are stored
  Then the item is placed as <placement>
    Examples:
      | credit | placement                                                    |
      | 1      | passed, and stored                                           |
      | 0.5    | a close miss, and stored                                     |
      | 0      | failed, and nothing is stored, so it starts like any new item |
```

*Why:* nothing is skipped outright; a pass comes back within days to confirm.

### PLC-14 Untested items are placed by how likely the learner knows them
Up: PRD-05

```gherkin
Scenario Outline: untested items
  Given the test ended with enough answers to place untested items
    And an untested item the learner knows with probability <p>, averaged over the estimate
  When the results are stored
  Then the item is placed as <placement>
    Examples:
      | p                                                            | placement                                        |
      | 0.85 or more, at or below the highest level passed outright  | likely known, sent to L3 review to confirm       |
      | 0.85 or more, above every level passed outright              | probably known                                   |
      | from 0.5 up to the L3 threshold                              | probably known                                   |
      | below 0.5                                                    | not placed, and nothing is stored                |

Scenario: close misses alone never skip to review
  Given a learner whose every answer was a close miss
  When the test ends
  Then the estimate is above 0
    And some untested items are placed as probably known
    And none is sent to L3 review
```

### PLC-15 Confirmation reviews trickle in, least certain first
Up: PRD-05, PRD-04

```gherkin
Scenario: 6 a day from day 2
  Given a test that sent 13 untested items to L3 review
  When the results are stored
  Then the least certain item comes first
    And 6 are due 2 days after the test, 6 the day after, and 1 the day after that
    And none of them counts against the daily new-item limit

Scenario: storing order
  When the results are stored
  Then passed, close and probably-known items are stored in the order they were placed
    And the confirmation reviews follow, least certain first
```

### PLC-16 Placement never overwrites progress
Up: PRD-05, PRD-10

```gherkin
Scenario: a started item is left alone
  Given an item already has a progress row
  When placement results that cover it are stored
  Then its row is unchanged and no seed is stored for it
```

### PLC-17 The estimate shown is the rounded posterior mean
Up: PRD-05

```gherkin
Scenario: the level shown
  Given a test that ended with enough answers
    And at least one answer earned credit
  Then the estimate is the posterior mean rounded to a whole level, from 0 to 8

Scenario: nothing earned credit
  Given no answer earned any credit
  Then the estimate is 0
    And every answered item is failed and every other item starts from the beginning
```

## Running a test

### PLC-18 The question screen
Up: PRD-05, PRD-09, PRD-17

```gherkin
Scenario: the first question
  Given a test with items to ask
  When it opens
  Then it shows its heading, a counter of the question being asked out of at most 20
    (fewer when fewer items can be asked), and a Quit link back to where the test began
    And there is no way to finish early yet

Scenario: after the first answer
  Given the learner has answered a question
  Then a button to finish now shows

Scenario Outline: where a test leads back to
  Given <test>
  Then its Quit link, its result's link back and its nothing-to-test message's link go to <page>
    And each link names that page
  Examples:
    | test                              | page                     |
    | the countries test                | Home                     |
    | a country's test-out              | the country's page       |
    | a region's test-out               | the region's page        |

Scenario: phone width
  Given a phone-width screen
  When a question and the result show
  Then nothing scrolls sideways

Scenario: focus follows the test
  When the next question appears
  Then focus moves to the question
  When the result appears
  Then focus moves to the result heading
```

### PLC-19 Passes and close misses are saved as they are answered
Up: PRD-05, PRD-10

```gherkin
Scenario: quitting keeps what was shown
  Given the learner passed or was close on some questions
  When they quit before the end
  Then those items are already stored with their placement
    And no finished-test marker is stored

Scenario: quitting during a question leaves the globe clean
  Given the learner has dropped a pin but not confirmed it
  When they quit
  Then no pin or reveal is left on the globe
    And taps on the next page's globe drop no pin

Scenario: an answer that fails to save
  Given one or more passes or close misses failed to save
  Then an alert counts the answers that could not be saved, with the latest error
    And says finishing the test saves them
    And the error reads as one sentence even when it ends with its own full stop
```

### PLC-20 The result screen
Up: PRD-05

```gherkin
Scenario: the test ends
  Given the test is over, or the learner chose to finish now
  Then a placement-done heading shows
    And the learner's level out of 8, or that no level was placed yet
    And one line per group that is not empty: the items got right come back within a couple of
      days, the very likely known come back over the next few weeks, the close or probably known
      start at tapping on a bordered map, and the rest start from the beginning
    And each line counts its items in the tier's noun, singular for one
    And a link back to where the test began (PLC-18)

Scenario: nothing placed
  Given the estimate is 0 and no item was placed
  Then the result is the single line that everything starts from the beginning

Scenario: saving the results
  When the result shows
  Then it says the results are being saved
    And once they are saved a button starts a study session
  When saving fails
  Then the error shows with a button to try again
```

### PLC-21 A test with nothing left to test
Up: PRD-05

```gherkin
Scenario: the countries test
  Given every country is already placed or being studied
  When the placement test opens
  Then it says there is nothing left to place, naming the tier in the singular
    And links back to Home

Scenario: a test-out
  Given all of an item's children are already placed or being studied
  When its test-out opens
  Then it says there is nothing left to test in that item, naming it and its children's tier
    And links back to the item's page
```

## Finished tests

### PLC-22 Finishing a test stores its marker
Up: PRD-05

The seeds and the marker are written together, both or neither (STO-06). The marker is what hides
Home's placement offer (SCR-05) and an item's test-out link (SCR-18); quitting stores none (PLC-19).

```gherkin
Scenario: finishing stores the marker
  Given a test ends, or the learner chose to finish now
  When its results are stored
  Then its finished-test marker is stored with its seeds
    And the Home offer or the test-out link for that test no longer shows
```

## Test out of a tier

### PLC-23 A test-out runs for a mastered item whose children are unstudied
Up: PRD-05, PRD-02

```gherkin
Scenario Outline: which test-out pages run
  Given the learner opens the test-out page of <target>
  Then <result>
    Examples:
      | target                                                            | result                               |
      | a mastered country with a regions tier                            | it runs over its regions             |
      | a mastered country without a regions tier                         | it runs over its places              |
      | a mastered region                                                 | it runs over its places              |
      | a mastered country with one child already stored                  | it runs over the other children      |
      | a mastered country whose child has only a placement seed          | it runs                              |
      | a mastered country with a child answered in a study session       | it is unavailable, back to the country |
      | an unknown country, with or without a region                      | it is unavailable, back to the world |
      | a country that is not mastered or has no progress                 | it is unavailable, back to the country |
      | a mastered country whose gate (CUR-21) is shut                    | it is unavailable, back to the country |
      | a region page of a country without a regions tier                 | it is unavailable, back to the country |
      | a region of another country, or an id not starting with the country | it is unavailable, back to the country |
      | a region that is not in the curriculum                            | it is unavailable, back to the country |
      | a region that is not mastered, though its country is              | it is unavailable, back to the country |

Scenario: the page names what it tests
  Given a test-out runs
  Then its heading names the item and the tier of its children
    And its result counts items in that tier's noun
```

### PLC-24 The test-out link shows while there is something to test
Up: PRD-05

```gherkin
Scenario Outline: when the link shows
  Given <state>
  Then the item's test-out link <shows>
    Examples:
      | state                                                                 | shows        |
      | a mastered item with children, none stored                            | shows        |
      | the same, with another item's or the countries test's marker          | shows        |
      | the same, with that item's own marker                                 | is hidden    |
      | a mastered item with a child that has only a placement seed           | shows        |
      | a mastered item with a child answered in a study session              | is hidden    |
      | a mastered item every one of whose children has a row                 | is hidden    |
      | a mastered country whose gate (CUR-21) is shut                        | is hidden    |
      | an item that is not mastered or has no progress                       | is hidden    |
      | a mastered item with no children                                      | is hidden    |

Scenario: an item outside the curriculum
  Given an id that is not in the curriculum
  When whether it can be tested out of is checked
  Then the check fails
```

A placement seed alone is not studying: only an answer in a study session is.
