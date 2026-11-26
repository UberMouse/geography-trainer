# Grading (GRD)

How an answer becomes an FSRS rating, how that rating moves an item along the three-rung
exercise ladder and schedules its next review, and how multiple-choice options are chosen. All of
it is pure engine logic: the same inputs, clock and seed always give the same result.

The rungs: **L1** the item is highlighted and the learner picks its name from four choices; **L2**
the learner taps it with borders drawn; **L3** the learner taps it on the bare globe. The ratings
are FSRS's four: Again, Hard, Good, Easy. A *pass* is Good or Easy.

## Ratings

### GRD-01 Good and Easy pass; Hard and Again do not
Up: PRD-04

```gherkin
Scenario Outline: which ratings pass
  Given an answer rated <rating>
  Then it <passes> as a pass
  Examples:
    | rating | passes      |
    | Again  | does not count |
    | Hard   | does not count |
    | Good   | counts      |
    | Easy   | counts      |
```

### GRD-02 A multiple-choice answer is rated by correctness and speed
Up: PRD-03, PRD-04

*Why:* a fast correct pick shows the learner knows it; a slow one shows they had to work it out.

```gherkin
Scenario Outline: a multiple-choice answer's rating
  Given an L1 question
  When the learner picks the <choice> option after <seconds> s
  Then the answer is rated <rating>
  Examples:
    | choice  | seconds | rating |
    | wrong   | 0       | Again  |
    | wrong   | 50      | Again  |
    | right   | 3.999   | Easy   |
    | right   | 4       | Good   |
    | right   | 12      | Good   |
    | right   | 12.001  | Hard   |

Scenario: an impossible answer time is an error
  When a multiple-choice answer is graded with a negative or not-a-number time
  Then grading fails with a range error instead of returning a rating
```

### GRD-03 A tap inside a country or region is Good, or Easy near its answer point
Up: PRD-01, PRD-04

*Why:* a region's answer point is not always its centre (Nunavut's is Iqaluit), so anywhere inside
the polygon is correct; landing near the answer point as well earns Easy.

```gherkin
Scenario Outline: inside the target
  Given a <tier> question whose target is 1000 km in size
  When the tap lands inside the target, <km> km from its answer point
  Then the answer is rated <rating>
  Examples:
    | tier    | km    | rating |
    | country | 250   | Easy   |
    | country | 250.1 | Good   |
    | region  | 250   | Easy   |
    | region  | 900   | Good   |

Scenario: a target with no measurable size is never Easy
  Given a country or region question whose target's size is zero or less
  When the tap lands inside it, on its answer point
  Then the answer is rated Good

Scenario: the border distance does not matter inside
  When the tap lands inside the target
  Then how far the tap is from the border plays no part in the rating
```

### GRD-04 A tap outside a country or region is a near miss or a miss
Up: PRD-01, PRD-04

```gherkin
Scenario Outline: outside the target
  Given a <tier> question
  When the tap lands outside the target, <km> km from its border
  Then the answer is rated <rating>
  Examples:
    | tier    | km    | rating |
    | country | 150   | Hard   |
    | country | 150.1 | Again  |
    | region  | 50    | Hard   |
    | region  | 50.1  | Again  |
```

### GRD-05 A place tap is rated by its distance from the place
Up: PRD-01, PRD-04

*Why:* a place is a point, so only raw distance counts; maptap's score is too flat to grade on.

```gherkin
Scenario Outline: place taps
  Given a place question
  When the tap lands <km> km from the place
  Then the answer is rated <rating>
  Examples:
    | km    | rating |
    | 24.9  | Easy   |
    | 25    | Good   |
    | 74.9  | Good   |
    | 75    | Hard   |
    | 199.9 | Hard   |
    | 200   | Again  |

Scenario: a place has no polygon to be inside
  Given a place question
  When the tap is reported as inside, 500 km from the place
  Then the answer is rated Again
```

### GRD-06 A tap measurement the grading cannot use is an error
Up: PRD-01

```gherkin
Scenario: a negative or not-a-number distance that the rule uses fails
  Given a place question, or a tap inside a country or region, or a tap outside one
  When the distance that case grades on is negative or not a number
    Or, inside a country or region, the target's size is not a number
  Then grading fails with a range error instead of returning a rating

Scenario: distances the rule does not use are not checked
  Given a tap inside a country
  When its distance from the border is not a number
  Then the tap is still graded

Scenario: an infinite distance is a miss
  When a place tap, or a tap outside a country, is infinitely far away
  Then the answer is rated Again
```

## maptap's score

### GRD-07 Each tap shows maptap's own score
Up: PRD-01

The score is maptap's: 100 inside the target, otherwise 100·exp(−3.5·km / 16,250), rounded, and
0 from 16,250 km on. It is shown, never graded on.

```gherkin
Scenario Outline: maptap's score for a tap
  When a tap lands <km> km from the answer point, <where>
  Then maptap's score is <score>
  Examples:
    | km     | where              | score |
    | 0      | outside the target | 100   |
    | 23     | outside the target | 100   |
    | 1000   | outside the target | 81    |
    | 16249  | outside the target | 3     |
    | 16250  | outside the target | 0     |
    | 20000  | outside the target | 0     |
    | 5000   | inside the target  | 100   |

Scenario: before rounding, a 23 km tap scores at least 99.5
  When a tap lands 23 km from the answer point, outside the target
  Then maptap's unrounded score is at least 99.5

Scenario: an impossible distance is an error
  When the score is asked for a negative or not-a-number distance outside the target
  Then it fails with a range error
```

## The ladder

### GRD-08 A new item starts at L1
Up: PRD-03

```gherkin
Scenario: a fresh item
  Given an item the learner has never seen
  When its progress is created
  Then it is at L1, the highest rung it has reached is L1
    And it has one new L1 card, due now
    And it has no L3 pass days, no L3 lapse, and is not mastered
    And it has not been introduced
```

### GRD-09 An answer on the current rung moves the item up, down or nowhere
Up: PRD-03

*Why:* a slow but correct pick at L1 is still correct, so it climbs; Hard at L2 and L3 is a near
miss, which is not a pass. An Easy skips a rung, so a country picked fast at L1 goes straight to L3.

```gherkin
Scenario Outline: moving on the ladder
  Given an item at L<from>
  When it is answered at L<from> and rated <rating>
  Then it is at L<to>
  Examples:
    | from | rating | to |
    | 1    | Again  | 1  |
    | 1    | Hard   | 2  |
    | 1    | Good   | 2  |
    | 1    | Easy   | 3  |
    | 2    | Again  | 1  |
    | 2    | Hard   | 2  |
    | 2    | Good   | 3  |
    | 2    | Easy   | 3  |
    | 3    | Again  | 2  |
    | 3    | Hard   | 3  |
    | 3    | Good   | 3  |
    | 3    | Easy   | 3  |

Scenario: the highest rung reached never falls
  Given an item that has reached L2 or L3
  When an Again drops it a rung
  Then the highest rung it has reached is unchanged
```

### GRD-10 An L3 lapse is remembered until the item is back at L3
Up: PRD-03, PRD-04

```gherkin
Scenario: a lapse at L3 and the way back
  Given an item at L3
  When it is rated Again at L3
  Then it is at L2 and marked as in an L3 lapse
  When it is then passed at L2
  Then it is back at L3 and no longer in a lapse

Scenario: the lapse mark stays through further slips
  Given an item in an L3 lapse, at L2
  When it is rated Hard at L2
  Then it stays at L2, still in the lapse
  When it is rated Again at L2
  Then it is at L1, still in the lapse
  When it is rated Hard or better at L1 and then passed at L2
  Then it is back at L3 and no longer in the lapse

Scenario: an Again at L2 outside a lapse sets no lapse mark
  Given an item at L2 that has never lapsed at L3
  When it is rated Again at L2
  Then it is at L1 and not marked as in an L3 lapse
```

### GRD-11 Each rung has its own card, made when the rung is first reached
Up: PRD-03, PRD-04

```gherkin
Scenario: reaching a rung for the first time
  Given an item reaches a rung it has never been on
  Then that rung gets a new card, due at the time of the answer

Scenario: a rung skipped by an Easy has no card until it is needed
  Given an item that went from L1 straight to L3 with an Easy
  Then it has cards for L1 and L3 only
  When it lapses at L3
  Then a new L2 card is made, due now
```

### GRD-12 Stepping down asks the lower rung again now
Up: PRD-03, PRD-04

```gherkin
Scenario: the lower rung's card keeps its history but comes due now
  Given an item whose L2 (or L1) card was last scheduled for days ahead
  When an Again steps the item down to that rung
  Then that card is due at the time of the answer
    And its stability, difficulty, reps and lapses are unchanged
```

### GRD-13 An answer off the current rung schedules only that rung
Up: PRD-03, PRD-04

```gherkin
Scenario: answering a lower rung
  Given an item at L3
  When it is answered at L1
  Then the L1 card is rescheduled
    And the item stays at L3

Scenario: answering L3 during a lapse
  Given an item in an L3 lapse, at L2
  When it is passed at L3
  Then the item stays at L2, still in the lapse
    And no L3 pass day is added

Scenario: a rung above the highest reached cannot be answered
  Given an item that has only reached L1
  When an answer at L3 is applied
  Then it fails with an error
```

### GRD-14 An item is asked at its current rung, when that rung's card is due
Up: PRD-03, PRD-06

```gherkin
Scenario: the rung and due time asked
  Given an item at some rung, including L2 during an L3 lapse
  Then it is asked at that rung
    And it is next due when that rung's card is due
```

## Mastery

### GRD-15 Mastery is L3 passed on two different local days, and is never lost
Up: PRD-02, PRD-04

```gherkin
Scenario: two passes on one day are one pass day
  Given an item at L3
  When it is passed at L3 twice on the same local day
  Then it has one L3 pass day and is not mastered
  When it is passed at L3 on a later day
  Then it has two pass days and is mastered

Scenario: only L3 passes count
  Given an item at L3
  When it is rated Hard or Again at L3, or passed at L1 or L2
  Then no L3 pass day is added

Scenario: a lapse does not undo mastery
  Given a mastered item
  When it lapses at L3
  Then it is in an L3 lapse and still mastered
```

### GRD-16 Pass days are the learner's local calendar days
Up: PRD-04

```gherkin
Scenario Outline: the local day of an instant
  Given the instant 2026-12-31 20:00 UTC
  When the learner's clock is <offset> minutes east of UTC
  Then the local day is <day>
  Examples:
    | offset | day        |
    | 0      | 2026-12-31 |
    | 780    | 2027-01-01 |
    | -300   | 2026-12-31 |
```

## New and studied items

### GRD-17 An item is introduced by its first answer
Up: PRD-06, PRD-11

*Why:* the daily new-item limit counts items whose first answer fell on that day.

```gherkin
Scenario: the first answer stamps the introduction time
  Given an item that has never been answered (fresh, or seeded at L2 by placement)
  When it is answered, at any rating
  Then it counts as introduced
    And its introduction time is the time of that answer
  When it is answered again later
  Then its introduction time is unchanged

Scenario: a placement review seed is introduced but never stamped
  Given an item seeded by placement as an L3 review (passed, or likely known)
  Then it counts as introduced from the start
    And its introduction time stays empty, even after it is answered
```

### GRD-18 An item is studied once answered in a session
Up: PRD-06, PRD-07

```gherkin
Scenario Outline: whether an item has been studied
  Given <item>
  Then it <studied> as studied
  Examples:
    | item                                              | studied        |
    | a fresh item                                      | does not count |
    | any placement seed, before it is answered         | does not count |
    | a fresh item after one answer                     | counts         |
    | an L3 review seed after one answer in a session   | counts         |
```

## Placement seeds

### GRD-19 A placement outcome decides where an item starts
Up: PRD-05

```gherkin
Scenario Outline: seeding from a placement outcome
  Given a placement test left an item <outcome>
  When its progress is seeded
  Then it is at L<rung> with <card>
    And it has <passDays> L3 pass days and is not mastered
  Examples:
    | outcome           | rung | card                                         | passDays |
    | passed            | 3    | one L3 review card, due in 2 days            | 1        |
    | likelyKnown       | 3    | one L3 review card, due at the date given    | 0        |
    | close             | 2    | one new L2 card, due now                     | 0        |
    | untestedAtOrBelow | 2    | one new L2 card, due now                     | 0        |
    | failed            | 1    | a new L1 card, as for a fresh item           | 0        |
    | aboveEstimate     | 1    | a new L1 card, as for a fresh item           | 0        |

Scenario: a review seed comes back within days, never sooner than 2
  Given an item seeded as an L3 review
  Then its card's stability is its whole days until due, at least 2
    And without a due date given it is due in 2 days

Scenario: a passed seed needs one more L3 pass on another day
  Given an item seeded as passed today
  When it is passed at L3 later the same day
  Then it is not mastered
  When it is instead passed at L3 on a later day
  Then it is mastered
```

## Scheduling

### GRD-20 Every answer is scheduled by FSRS, deterministically
Up: PRD-04

```gherkin
Scenario: better answers come back later
  Given a new card
  Then a Good answer is next due later than an Again answer would be

Scenario: a lapse on a review card
  Given an L3 review card
  When it is rated Again
  Then its lapse count goes up by one and it is relearning

Scenario: no randomness in scheduling
  Given the same progress, answer, rating and time
  When the answer is applied twice
  Then both results are identical, interval fuzz and all
```

### GRD-21 Progress is plain data that survives a save
Up: PRD-10

```gherkin
Scenario: a JSON round trip
  Given an item's progress
  When it is written to JSON and read back
  Then it is equal to the original
    And applying the same answer to either gives the same result

Scenario: applying an answer leaves the old progress alone
  When an answer is applied to an item's progress
  Then the progress it was applied to is unchanged
```

## Multiple-choice options

### GRD-22 A question offers the answer and three wrong options, shuffled
Up: PRD-03

```gherkin
Scenario: the options
  Given an item with at least three candidates for wrong options
  When its multiple-choice options are built
  Then they are the item and three wrong options, each exactly once
    And the item can be in any of the four positions

Scenario: the same seed gives the same question
  Given the same item, candidates and seed
  When the options are built twice
  Then the wrong options and their order are the same both times
    And over many seeds the chosen wrong options vary
```

### GRD-23 Wrong options are drawn from the candidates nearest the item
Up: PRD-03

*Why:* nearby wrong options make the learner tell neighbours apart, but a fixed set of the very
nearest would become memorable.

```gherkin
Scenario: drawn from the six nearest
  Given an item with twelve candidates at increasing distances
  When three wrong options are chosen
  Then they are three different candidates from the six nearest, never the item itself

Scenario: ties in distance go by id
  Given several candidates at the same distance
  Then the nearer pool takes the lower ids first

Scenario: too few candidates
  Given fewer candidates than wrong options wanted
  Then every candidate is used
    And with no candidates there are no wrong options
```

### GRD-24 No two options read the same
Up: PRD-03

```gherkin
Scenario: names are distinct
  Given candidates that share a name with each other or with the item
  When the candidate pool is built
  Then a candidate named like the item is left out
    And of candidates sharing a name, only the one nearest the item is kept
```

### GRD-25 Which items can be wrong options, per tier
Up: PRD-03

```gherkin
Scenario: a country
  Given a country question
  Then the candidates are every other country

Scenario: a region
  Given a region question
  Then the candidates are the other regions of its country that contain places

Scenario: a place widens its pool until it has enough
  Given a place question
  Then the candidates are the other places in its region
    But with fewer than three distinctly named ones, the other places in its country
    But with fewer than three of those too, every other place
    And a place with no region starts from its country

Scenario: a place too near the answer is never offered
  Given another place within 25 km of the question's place
  Then it is never a candidate, since a tap there would grade Easy for the answer
```

## Randomness

### GRD-26 Randomness is seeded and repeatable
Up: PRD-06

*Why:* a question rebuilt from its stored seed, after a reload, shows the same options in the same
order.

```gherkin
Scenario: the seeded generator
  Given a seed
  Then the generator gives the same sequence every time for that seed
    And a different sequence for a different seed
    And every number it gives is at least 0 and below 1
```
