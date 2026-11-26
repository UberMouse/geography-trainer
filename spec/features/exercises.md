# Exercises (EXR)

The three exercise types as the learner sees them on the shared globe: what each shows, where it
puts the camera, the reveal after an answer, and how an answer becomes a result for the scheduler.
How a result is rated (thresholds, speeds) is in `grading.md`.

## The three exercise types

### EXR-01 Each rung sets up its own globe and way to answer
Up: PRD-03, PRD-08

```gherkin
Scenario Outline: a question's globe and answer by rung
  Given an item asked at rung <rung>
  When the question starts
  Then the globe shows <globe>
    And the learner answers by <answer>
  Examples:
    | rung | globe                                                              | answer                                      |
    | L1   | the item shaded (a place as a dot) with its tier's context borders | choosing its name from the options          |
    | L2   | the borders of the item's tier                                     | tapping where it is, then confirming        |
    | L3   | imagery only: no borders, no highlight                             | tapping where it is, then confirming        |
```

### EXR-02 The borders drawn follow the item's tier
Up: PRD-03, PRD-08

```gherkin
Scenario Outline: context borders at L1 and borders at L2
  Given a <tier> item
  When it is asked at L1 or L2
  Then the borders drawn are <borders>
  Examples:
    | tier                                   | borders                                         |
    | country                                | every country's border                          |
    | region                                 | its country's outline and its region borders    |
    | place in a country with a regions tier | its country's outline and its region borders    |
    | place in a country without one         | its country's outline alone                     |
```

### EXR-03 The L1 prompt says what is shown
Up: PRD-03

```gherkin
Scenario Outline: the multiple-choice prompt by tier
  Given a <tier> item asked at L1
  When the question starts
  Then the prompt asks which <tier> is <shown>
  Examples:
    | tier    | shown       |
    | country | highlighted |
    | region  | highlighted |
    | place   | marked      |
```

### EXR-04 L1 offers the item and three wrong names
Up: PRD-03

```gherkin
Scenario: four options
  Given an item with at least three possible wrong options
  When it is asked at L1
  Then four options show: its own name and three wrong ones, each once
    And the order and the wrong ones are the same for the same question seed

Scenario: fewer options when the tier is small
  Given an item with only two possible wrong options
  When it is asked at L1
  Then three options show: its own name and both wrong ones
```

### EXR-06 L1 is graded on the first choice
Up: PRD-03, PRD-04

```gherkin
Scenario: the first choice is the answer
  Given an L1 question
  When the learner chooses an option
  Then it is graded at once and reported once
    And the right option is marked, and so is the chosen one if it was wrong
    And the options are then disabled

Scenario: later choices change nothing
  Given an answered L1 question
  When the learner clicks another option
  Then the verdict, the marks and the reported result stay as they were
```

### EXR-07 L2 and L3: a tap drops a pin, and Confirm grades it
Up: PRD-01, PRD-03

```gherkin
Scenario: the pin moves until confirmed
  Given an L2 or L3 question with no pin
  Then Confirm is disabled
  When the learner taps the globe
  Then one pin stands where they tapped and Confirm is enabled
  When they tap again, even on the pin itself
  Then the one pin moves to the new tap
  When they press Confirm
  Then the pin's position is graded and reported once, and Confirm is disabled

Scenario: taps after the answer are ignored
  Given an answered L2 or L3 question
  When the learner taps the globe
  Then no pin appears, Confirm stays disabled and the reported result is unchanged
```

### EXR-08 Nothing names the item on the globe before the answer
Up: PRD-08

```gherkin
Scenario: an unanswered question
  Given a question that has not been answered
  Then the globe carries no name and no reveal
    And there is no pin until the first tap
    And the verdict area is present but empty, so a screen reader announces it when it fills
```

## The camera

### EXR-09 Where a question puts the camera
Up: PRD-08

A country's *main part* is its largest landmass; an item *outside it* is defined in EXR-12. The
*neighbourhood* is a view about 600 km across; the *whole world* is the zoom the app opens on.

```gherkin
Scenario Outline: the camera as a question starts
  Given a <item>
  When it is asked at L1, the camera goes to <L1>
  When it is asked at L2, the camera goes to <L2>
  Examples:
    | item                                   | L1                              | L2                                                                       |
    | country with an area                   | fit the country                 | the whole world                                                          |
    | point-only country                     | the neighbourhood of its point  | the whole world                                                          |
    | region                                 | fit the region                  | fit its country's main part                                              |
    | region outside its country's main part | fit the region                  | the whole world, centred halfway between the main part and the region   |
    | place                                  | the neighbourhood of the place  | fit its country's main part                                              |
    | place outside its country's main part  | the neighbourhood of the place  | the whole world, centred halfway between the main part and the place    |
    | place in a point-only country          | the neighbourhood of the place  | the neighbourhood of its country's point                                 |

Scenario: an item outside the main part stays in view at L2
  Given a region or place outside its country's main part
  When it is asked at L2
  Then its answer point is well on the near side of the globe and inside the globe's area
```

### EXR-10 L3 never moves the camera
Up: PRD-01, PRD-08

*Why:* in a maptap round the globe stays where the last question left it.

```gherkin
Scenario: an L3 question keeps the view
  Given the camera is where the last question left it
  When an L3 question starts
  Then the camera does not move

Scenario: the first question a page shows
  Given a page opens on an L3 question
  When it starts
  Then the camera goes to the whole world first
    And L1 and L2 questions make their own move whether or not they open a page
```

### EXR-11 A new question's move replaces the reveal's flight
Up: PRD-08

```gherkin
Scenario: Next while the reveal is still flying
  Given the camera is flying to a reveal's framing
  When the learner presses Next
  Then the camera ends at the next question's own view, not the reveal's
```

### EXR-12 What lies outside a country's main part
Up: PRD-08

```gherkin
Scenario: overseas and far-off items are set apart
  Given a region or place whose answer point lies beyond its country's main part and a margin around it
  Then it counts as outside the main part (Hawaii and Réunion do; Bretagne does not)
    And a country itself never does
```

## The reveal

### EXR-13 The verdict in plain words
Up: PRD-01, PRD-04

The reveal says how the answer went without naming the scheduler's ratings.

```gherkin
Scenario Outline: the verdict for each outcome
  Given a question answered <how>
  Then the verdict reads as <verdict> in <colour>
    And when it is incorrect, it also says which item it was
  Examples:
    | how                                            | verdict                  | colour |
    | with the right option, fast                    | correct, spot on         | green  |
    | with the right option                          | correct                  | green  |
    | with the right option, slowly                  | correct, slow            | green  |
    | with a tap rated Easy                          | correct, spot on         | green  |
    | with a tap rated Good                          | correct                  | green  |
    | with a tap that is a near miss (rated Hard)    | incorrect, near miss     | yellow |
    | with a wrong option, or a tap rated Again      | incorrect                | red    |
```

### EXR-14 How far off, and maptap's score
Up: PRD-01

```gherkin
Scenario Outline: the distance line after a tap
  Given a tap answer to a <tier> item, <km> km off
  Then the reveal says <wording>
    And beside it shows maptap's score for the tap
  Examples:
    | tier    | km      | wording                       |
    | country | 0       | the tap is inside the border  |
    | region  | 4.06    | 4.1 km outside the border     |
    | country | 18840.4 | 18,840 km outside the border  |
    | place   | 0       | 0.0 km away                   |
    | place   | 21      | 21 km away                    |

Scenario Outline: distances are rounded before they are formatted
  Given a distance of <km> km
  Then it reads <shown>
  Examples:
    | km     | shown |
    | 9.97   | 10    |
    | 9.94   | 9.9   |
    | 0      | 0.0   |
    | 1234.4 | 1,234 |

Scenario: a multiple-choice answer
  Given an L1 question answered
  Then the reveal shows no distance and no score
```

### EXR-15 The reveal on the globe
Up: PRD-08

```gherkin
Scenario: after any answer
  Given a question has been answered
  Then the target is outlined (a place is dotted)
    And the item's name shows on the globe at its answer point
    And the pin is gone

Scenario: after a tap
  Given an L2 or L3 question answered by a tap
  Then the tap and the answer point are marked, with a line between them

Scenario: after a choice
  Given an L1 question answered
  Then there is no tap, answer point or line, and the shading stays
```

### EXR-16 Where the reveal puts the camera
Up: PRD-01, PRD-08

```gherkin
Scenario Outline: the camera after a tap's answer
  Given a tap <distance> from the answer point
  When it is confirmed
  Then the camera <moves>
  Examples:
    | distance                    | moves                                                                                   |
    | up to 5,000 km              | frames the tap, the answer point and (for a country or region) its whole outline       |
    | over 5,000 km, up to 9,000  | shows the whole globe, centred halfway between the tap and the answer point            |
    | over 9,000 km               | shows the whole globe, centred on the answer point                                      |

Scenario: after a choice
  Given an L1 question answered
  Then the camera does not move
```

### EXR-17 Next starts a fresh question
Up: PRD-03, PRD-06

```gherkin
Scenario: the next question starts clean
  Given an answered question
  When the learner presses Next
  Then the next question shows with an empty verdict, no marked or disabled options and no pin
    And the globe has no name and no reveal left from the last one
    And the next question makes its own camera move
```

## The answer as a result

### EXR-18 A multiple-choice answer's result
Up: PRD-04

```gherkin
Scenario: a choice becomes a result
  Given an L1 question
  When the learner chooses an option
  Then the result is correct exactly when the item's own name was chosen
    And its rating is by speed (see grading.md), timed from when the question first showed
    And it has no distance and no score

Scenario: a slow right answer
  Given an L1 question left for longer than the slow limit
  When the learner chooses the right option
  Then the result is correct and rated Hard, and the verdict says it was slow
```

### EXR-19 A tap's result
Up: PRD-01, PRD-04

```gherkin
Scenario: a confirmed tap becomes a result
  Given an L2 or L3 question with a confirmed tap
  Then the rating is the tap's grade for the item's tier (see grading.md)
    And the result is correct only when that rating is Good or Easy, so a near miss is not
    And its distance is from the place's point, or outside the country's or region's border (0 inside)
    And its maptap score is from the answer point, and 100 inside the target
```

## The item

### EXR-20 What an item targets
Up: PRD-01, PRD-03

```gherkin
Scenario Outline: an item's target
  Given a <tier> item
  Then it is tapped against <target>
    And it belongs to <country>
  Examples:
    | tier    | target                                                                      | country       |
    | country | its outline, with its answer point at the centre of its main part           | itself        |
    | region  | its outline, with its own answer point                                      | its country   |
    | place   | its point                                                                   | its country   |
```

### EXR-21 Same-named sibling regions count as one
Up: PRD-01

*Why:* the learner can't tell two regions apart by a name they share.

```gherkin
Scenario: a region shares its name with another of its country's regions
  Given a region whose name another region of the same country also has
  When a tap lands inside that other region
  Then it counts as inside the target: 0 km off and maptap 100
```

### EXR-22 An item that cannot be built is an error
Up: PRD-03

```gherkin
Scenario Outline: the item is not built
  Given <case>
  When the item is built
  Then it fails with an error rather than showing a broken question
  Examples:
    | case                                                                      |
    | an unknown id, or an id with an unknown tier or no tier                    |
    | a region or regions-tier place without its country's regions data         |
    | another country's regions data, or empty regions data                      |
    | a place in a country with a regions tier whose region is not in the data   |
```

## Layout

### EXR-23 No sideways scroll at phone width
Up: PRD-09

```gherkin
Scenario: every rung at phone width
  Given a 360 px wide screen
  When a country, a region or a place is asked at L1, L2 or L3
  Then the page does not scroll sideways
```
