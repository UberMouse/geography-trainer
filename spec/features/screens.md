# Screens (SCR)

The pages that ask no questions: Home, Progress and its drill-down, Settings, Credits, and the
development-only playground. What a learner sees on each, and what each control does.

## Home

### SCR-01 Home shows today's numbers
Up: PRD-06, PRD-07

```gherkin
Scenario: a fresh browser
  Given no progress is saved and the daily limit is the default
  When the learner opens Home
  Then Home shows the due reviews, the new items started today against the daily limit,
    the items learning and the items learned
    And every count is zero

Scenario: a round shows up after it is saved
  Given the learner has answered questions in a session
  When they open Home again, even after a reload
  Then the new-today count is the number of distinct items first answered today
    And the learning count is above zero
```

### SCR-02 The new-today count names the limit when it is passed
Up: PRD-11

*Why:* the learner can lower the limit after starting more items than the new limit allows.

```gherkin
Scenario Outline: the new-today line
  Given <started> new items were started today and the daily limit is <limit>
  When Home shows the new-today count
  Then it reads <reading>
  Examples:
    | started | limit | reading                                  |
    | 0       | 5     | the count out of the limit               |
    | 5       | 5     | the count out of the limit               |
    | 10      | 5     | the count, then the limit named apart    |
```

### SCR-03 Start, or nothing to study
Up: PRD-06

```gherkin
Scenario: there is something to study
  Given a session built now would hold N questions, N above zero
  When the learner opens Home
  Then Home shows a Start link to the session page that says N are to study

Scenario: there is nothing to study
  Given no review is due and today's new items are used up
  When the learner opens Home
  Then there is no Start link
    And Home says there is nothing to study right now
```

### SCR-04 Home's numbers follow the clock
Up: PRD-06

*Why:* a tab left open overnight must not show yesterday's numbers.

```gherkin
Scenario: time passes while Home is open
  Given Home is open
  When a minute passes, or the tab comes back to the foreground or gains focus
  Then Home recomputes its numbers and its Start link for the current time
    And a review that has fallen due since is counted
```

### SCR-05 Home offers the placement test until it is used
Up: PRD-05

```gherkin
Scenario Outline: the placement offer
  Given <studied>
    And <seeded>
    And <finished>
  When the learner opens Home
  Then the offer of the placement test is <shown>
  Examples:
    | studied                                    | seeded                                  | finished                                  | shown  |
    | no item has been answered in a session     | no item has a placement seed            | no test is finished                       | shown  |
    | no item has been answered in a session     | some countries have placement seeds     | no test is finished                       | shown  |
    | no item has been answered in a session     | every country has a placement seed      | no test is finished                       | hidden |
    | an item has been answered in a session     | any                                     | no test is finished                       | hidden |
    | a seeded item has been answered in a session | some countries have placement seeds   | no test is finished                       | hidden |
    | no item has been answered in a session     | no item has a placement seed            | the countries placement test is finished  | hidden |
    | no item has been answered in a session     | no item has a placement seed            | only a test-out is finished               | shown  |

Scenario: what the offer says
  Given the offer is shown
  Then it links to the placement test
    And it says how many questions the test asks, as its minimum to its maximum
```

### SCR-06 Home's globe shows progress by country, and a tap opens a country
Up: PRD-07, PRD-08

```gherkin
Scenario: the world by country
  Given Home or the Progress page is open
  Then the globe fills every country in its progress colour
    And a country too small to see filled is also drawn as a dot in its colour
    And the camera goes to the whole world once the page has loaded

Scenario: tapping a country
  Given Home or the Progress page is open
  When the learner taps a country, or a small country's dot
  Then that country's progress page opens
```

### SCR-07 The legend says what the colours mean
Up: PRD-07

```gherkin
Scenario Outline: the legend on each page
  Given the learner opens <page>
  Then a legend lists a swatch and a name for <states>
    And the mastered entry says it deepens as the regions and places below are mastered
    And a last entry gives the colour of a country with everything below it mastered
  Examples:
    | page              | states                              |
    | Home              | new, learning, mastered (no locked) |
    | the Progress page | locked, new, learning, mastered     |
```

### SCR-08 Home links to Progress and Settings
Up: PRD-07, PRD-11

```gherkin
Scenario: the links
  When the learner opens Home
  Then Home links to the Progress page and to Settings
```

## Progress: the world

### SCR-09 Progress counts each tier
Up: PRD-07

```gherkin
Scenario Outline: a tier's line
  Given the <tier> tier has <total> items, <learned> learned and <learning> learning
  When the learner opens the Progress page
  Then the tier's line names the tier, in the singular only when <total> is 1,
    and gives the learned count, the learning count and the total
  Examples:
    | tier    | total | learned | learning |
    | country | 243   | 12      | 5        |
    | region  | 1     | 0       | 0        |

Scenario: a fresh browser
  Given no progress is saved
  When the learner opens the Progress page
  Then each of the country, region and place lines shows 0 learned
```

### SCR-10 A country's colour is its state, deepening as it is completed
Up: PRD-07

```gherkin
Scenario Outline: an item's fill on the progress globe
  Given an item whose state is <state>, with <below> of the items below it mastered
  Then its fill is <fill>
  Examples:
    | state    | below          | fill                                                   |
    | locked   | any share      | the locked colour                                      |
    | new      | any share      | the new colour, muted so the untouched world reads calm |
    | learning | any share      | the learning colour                                    |
    | mastered | none           | the mastered colour                                    |
    | mastered | a quarter      | a quarter of the way from mastered to complete         |
    | mastered | all            | the complete colour                                    |
    | mastered | no items below | the complete colour                                    |
```

### SCR-11 Any country can be opened from a list
Up: PRD-07, PRD-09

*Why:* a tiny country is hard to tap, and a keyboard user cannot tap at all.

```gherkin
Scenario: going to a country
  Given the Progress page is open
  Then a country picker lists every country by name, alphabetically
    And its Go button is disabled until a country is chosen
  When the learner chooses a country and presses Go, with the keyboard alone if they like
  Then that country's progress page opens
```

### SCR-12 The started countries are listed
Up: PRD-07

```gherkin
Scenario: some countries are started
  Given some countries are learning or mastered
  When the learner opens the Progress page
  Then those countries, and only those, are listed alphabetically by name
    And each links to its progress page and shows its state

Scenario: nothing is started
  Given no country is learning or mastered
  When the learner opens the Progress page
  Then the page says no country is started yet, with a link to start a session
```

## Progress: a country and a region

### SCR-13 A drill-down address shows its page or says it is not found
Up: PRD-07, PRD-14

```gherkin
Scenario Outline: what the address names
  Given the learner opens <address>
  Then they see <page>
  Examples:
    | address                                          | page                                          |
    | a known country                                  | the country's page                            |
    | a known country with no places                   | the country's page                            |
    | an unknown country, with or without a region     | not found, with a link back to the world      |
    | a country and one of its regions, by full id     | the region's page                             |
    | a country and another country's region           | not found, with a link back to the country    |
    | a country and its region that has no places      | not found, with a link back to the country    |
    | a country and an unknown region                  | not found, with a link back to the country    |
    | a country without regions and any region         | not found, with a link back to the country    |
    | a country and one of its place ids as the region | not found, with a link back to the country    |
```

### SCR-14 A drill-down page lists the item's children
Up: PRD-02, PRD-07

```gherkin
Scenario: the page's heading and list
  When the learner opens a country's or a region's page
  Then the heading names the item and its state
    And a country's page links back to the world, a region's page back to its country
    And the children are listed alphabetically by name, each with its state
    And a region row links to its page; a place row is not a link

Scenario: locked children
  Given the item is not mastered
  Then each child row is locked and says that mastering the item unlocks it

Scenario: unlocked children
  Given the item is mastered
  Then its children read new, with no unlock note

Scenario: no children
  Given a country with no places
  Then the page says there are no regions or places to learn there
```

### SCR-15 A country page's globe
Up: PRD-07, PRD-08

```gherkin
Scenario: a country with regions
  Given the country has a regions tier
  When its page opens
  Then the globe draws the country's regions, each filled in its progress colour
    And a region with no places is drawn but not filled
  When the learner taps a region that has places
  Then that region's page opens

Scenario: a country without regions
  Given the country has no regions tier
  When its page opens
  Then the globe draws the country's outline unfilled and each place as a dot
    And a place's dot is its state's own colour (a mastered place is not deepened)
    And a dot for a place that is not in the curriculum is a neutral colour

Scenario: the camera
  When a country's page opens
  Then the camera fits the country
    But for a country too small to see, it shows the country's neighbourhood instead
```

### SCR-16 Outlying regions and places are named under the map
Up: PRD-07

*Why:* a country page shows the country's main part, as the exercises do; Alaska or Gibraltar
would shrink the map to nothing.

```gherkin
Scenario: a country with far parts
  Given some of a country's regions or places lie outside the frame of its main part
  When its page opens
  Then those are not drawn
    And a line under the heading names them, regions and places together, alphabetically
    And each named region that has places links to its page; places are plain names
```

### SCR-17 A region page
Up: PRD-07, PRD-08

```gherkin
Scenario: the region alone
  When the learner opens a region's page
  Then the globe draws that region alone, filled in its progress colour, and its places as dots
    And the camera fits the region
  When the learner taps the region on the globe
  Then nothing opens: the region page has no deeper page
```

### SCR-18 A drill-down page links to its test-out
Up: PRD-05

```gherkin
Scenario Outline: the test-out link
  Given a country or region that <condition>
  When the learner opens its page
  Then a link to test out of its children is <shown>
  Examples:
    | condition                                          | shown  |
    | is mastered, and none of its children is studied   | shown  |
    | is mastered, but its test-out was already finished | hidden |
    | is not mastered                                    | hidden |

Scenario: the link
  Given the link is shown
  Then it names the item and the tier of its children
    And it opens the item's test-out page
```

## Settings

### SCR-19 The daily limit can be changed within its range
Up: PRD-11

```gherkin
Scenario: saving a limit
  Given Settings shows the stored daily limit (the default when none is stored)
  When the learner enters a new limit and saves it
  Then Settings says it is saved
    And Home's new-today line uses the new limit
    And Settings shows it on the next visit

Scenario Outline: what the field accepts
  When the learner saves <text>
  Then it is <result>
  Examples:
    | text                     | result                                      |
    | the minimum or maximum   | saved                                       |
    | a number padded by spaces | saved, as the number                       |
    | digits with a leading 0  | saved, as the number                        |
    | below the minimum        | refused                                     |
    | above the maximum        | refused                                     |
    | empty, or only spaces    | refused                                     |
    | a decimal, an exponent, a sign, letters, two numbers | refused         |

Scenario: a refused limit
  When the learner saves a value that is refused
  Then an alert names the accepted range
    And nothing is saved, and no saved confirmation shows
  When the learner edits the field again
  Then the alert goes away
```

### SCR-20 Export downloads the progress
Up: PRD-10

```gherkin
Scenario: exporting
  When the learner exports their progress
  Then the browser downloads a progress file named for today's local date

Scenario: answers that could not be saved
  Given some answers could not be saved to the browser
  When the learner exports
  Then a warning says how many answers are left out of the file
```

### SCR-21 Import asks before it replaces anything
Up: PRD-10

```gherkin
Scenario Outline: a file that cannot be imported
  When the learner picks <file> to import
  Then an alert says <reason>
    And no confirmation opens and the progress is unchanged
  Examples:
    | file                                | reason                         |
    | a file that is not JSON             | it is not valid JSON           |
    | JSON that is not a progress export  | what is wrong with its format  |

Scenario: a progress file
  When the learner picks a valid progress file
  Then a dialog asks to confirm, comparing what is started here with what is started in the file,
    and giving the day the file was exported
  When they cancel
  Then nothing changes
  When they pick the same file again and replace
  Then the file's progress replaces this browser's, the page reloads its data,
    and a status line, which takes the focus, says the progress was imported
    And Home shows the imported numbers, as they were in the browser that exported them
```

### SCR-22 The import confirmation counts started items by tier
Up: PRD-10

```gherkin
Scenario Outline: each side's count
  Given one side has <countries> countries, <regions> regions and <places> places started
  Then that side reads <reading>
  Examples:
    | countries | regions | places | reading                                          |
    | 0         | 0       | 0      | nothing started                                  |
    | 1         | 0       | 0      | one country, singular                            |
    | 2         | 0       | 0      | two countries, plural                            |
    | 3         | 1       | 0      | the two tiers joined by "and", the region singular |
    | 3         | 12      | 40     | the first two with a comma, the last after "and" |
    | 0         | 1       | 1      | one region and one place                         |

Scenario: what counts as started
  Then an item is counted when it has been answered, by tier from its id
    And a progress row with no answer is not counted
```

### SCR-23 Reset needs the word typed
Up: PRD-10

```gherkin
Scenario: the reset section
  When the learner opens Settings
  Then the reset section says reset deletes the progress, the answer history and the finished
    placement tests, and keeps the daily limit

Scenario Outline: the confirmation
  Given the reset dialog is open
  When the learner types <typed>
  Then the reset button is <state>
  Examples:
    | typed                              | state    |
    | nothing                            | disabled |
    | part of the word                   | disabled |
    | the word with a space inside it    | disabled |
    | the word followed by more words    | disabled |
    | the word, in any case              | enabled  |
    | the word with spaces around it     | enabled  |

Scenario: cancelling
  When the learner opens the reset dialog and cancels it
  Then the dialog closes and nothing is reset

Scenario: resetting
  When the learner types the word and resets
  Then the progress, the answer history and the finished tests are deleted
    And the dialog closes, and a status line, which takes the focus, says all progress was reset
    And Home shows zero learned and zero learning, and offers the placement test again
```

### SCR-24 Settings runs one write at a time
Up: PRD-10
Verified: manual — a save, export, import or reset finishes too quickly for a test to catch the buttons disabled; checked in the browser with IndexedDB throttled

```gherkin
Scenario: a write is running
  Given a save, export, import or reset is running
  Then every other write button on Settings is disabled until it finishes
    And the import and reset dialogs cannot be dismissed while their write runs
```

## Every page

### SCR-25 A failed load says why and offers Retry
Up: PRD-07, PRD-10

```gherkin
Scenario: the data fails to load
  Given the map data or the saved progress cannot be loaded
  When a page that needs it opens
  Then it shows an alert with the reason and a Retry button
  When the learner presses Retry and the data now loads
  Then the page shows its content
```

### SCR-26 The screens fit a phone
Up: PRD-09

```gherkin
Scenario: no sideways scroll
  Given a phone-width screen
  When the learner opens Home, Progress, a drill-down page, Settings, Credits or the playground
  Then the page does not scroll sideways
```

## Credits

### SCR-27 Credits names the place list, the boundaries and the imagery
Up: PRD-13

```gherkin
Scenario: the Credits page
  Given any page
  When the learner follows the footer's Credits link
  Then the Credits page opens, with a link back to Home
    And it credits MapTap.gg for the place list, with a link to maptap.gg
    And it credits Natural Earth for the boundaries, public domain, with a link
    And it gives EOX's Sentinel-2 cloudless attribution line in full, with its s2maps.eu link
```

### SCR-28 Credits lists every runtime library
Up: PRD-13

```gherkin
Scenario: the libraries
  When the learner opens Credits
  Then every library the site ships is listed with its licence and an https link to its project
```

## The playground (development only)

### SCR-29 The playground exists only in development
Up: PRD-16

```gherkin
Scenario Outline: the playground address
  Given a <build> build
  When the playground address is opened
  Then <result>
  Examples:
    | build       | result                                     |
    | development | the playground opens                       |
    | production  | there is no playground: the address goes to Home |
```

### SCR-30 The Exercises tab runs one exercise
Up: PRD-16

```gherkin
Scenario: the default
  When the developer opens the playground
  Then the Exercises tab is current, showing France as a choice question (the first rung)

Scenario Outline: the address picks the question
  When the playground is opened with item <item> and rung <rung>
  Then it shows <shown>
  Examples:
    | item             | rung              | shown                                         |
    | any known item   | 1, 2 or 3         | that item at that rung                        |
    | any known item   | 7, a word, empty  | that item at the first rung                   |
    | an unknown item  | any               | a message naming it, and a button to France   |

Scenario: the controls
  Then the developer can pick the tier, the country, the rung and, below country tier, the item
    And can jump to a random item, or the next one after an answer
    And after an answer a panel shows its rating, whether it was right, its time, its distance
      and its maptap score
```

### SCR-31 The Globe tab tries the globe's modes
Up: PRD-16

```gherkin
Scenario: the Globe tab
  When the developer opens the playground's Globe tab
  Then it links back to the Exercises tab
    And it offers each layer mode: bare, country borders, region borders, highlight and progress
    And choosing a mode puts the globe in it
    And for the modes that need one, a country can be picked
    And highlight can target the country, a region or its most populous place, falling back to
      the country when the country has no regions or places
    And progress fills the world's countries or the country's regions with demo colours
    And the developer can fit the country, show a reveal of the last tap against it with its
      distance, whether it was inside and its maptap score, and read the last tap and the last
      selected feature
```
