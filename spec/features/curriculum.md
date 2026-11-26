# Curriculum (CUR)

What there is to learn and in what order: the country → regions → places tree, which items are
unlocked, when an item counts as mastered, the order new items arrive in, and how hard each item is.

## The tree

### CUR-01 Every country is at the top of the tree and unlocked from the start
Up: PRD-02

```gherkin
Scenario: a first-run learner can start on any country
  Given a learner with no progress
  When the unlocked items are listed
  Then every country in the data is listed, and no region or place is
    And a country drawn only as a point (Bonaire, Vatican City) is a country like any other
    And every country can be opened from the globe, or from the country picker with the keyboard

Scenario: an address that names nothing in the tree
  Given a country or region id that is not in the tree
  When its progress page is opened
  Then nothing is shown for it, only a way back
```

### CUR-02 A country gets a regions tier when it has enough regions and places
Up: PRD-02

*Why:* a country with a handful of places gains nothing from a regions step in between.

```gherkin
Scenario Outline: the regions tier is decided by regions holding places and total places
  Given a country with <regions> regions that hold a place, and <places> places in all
  When the data is generated
  Then the country <has> a regions tier
  Examples:
    | regions | places | has         |
    | 4       | 15     | has         |
    | 3       | 15     | does not have |
    | 4       | 14     | does not have |
```

### CUR-03 Regions sit between a country and its places only in a regions-tier country
Up: PRD-02

```gherkin
Scenario: a regions-tier country
  Given a country with a regions tier
  Then its children are its regions, in the order its places first name them
    And each region's children are its places
    And every one of its places belongs to one of its regions

Scenario: a country without a regions tier
  Given a country without a regions tier
  Then its children are its places directly, and it has no region items

Scenario: a region with no places is not part of the tree
  Given a region that holds no place
  Then it is not an item and is not listed under its country
```

### CUR-04 Landmarks are places, beside the cities
Up: PRD-02

```gherkin
Scenario: every maptap place type is in the places tier
  Given the committed place list, with cities, capitals, monuments, mountains, islands,
    religious sites, natural wonders, national parks and the rest
  When the tree is built
  Then each of them is a place item under its region or country, exactly as a city is
```

### CUR-05 A place may share its id with a country
Up: PRD-02

```gherkin
Scenario: the place Cyprus and the country Cyprus are two items
  Given a place whose id is the same as a country's (Cyprus, Bonaire)
  Then the place and the country are separate items with their own progress
    And the country's page shows the place as a place, not as the country's outline
```

### CUR-06 Inconsistent data is refused
Up: PRD-12

```gherkin
Scenario Outline: the tree is not built from inconsistent data
  Given <problem>
  When the tree is built
  Then building fails, naming the offending id
  Examples:
    | problem                                                            |
    | two countries, two regions or two places with the same id          |
    | a region or place of a country that is not in the data             |
    | a place of a regions-tier country with no region, or an unknown one |
    | a place that names a region of another country                     |
```

### CUR-07 Each country and region has a centre
Up: PRD-08

```gherkin
Scenario: the centre is the spherical mean of the item's places
  Given a country or region with places
  Then its centre is the mean of its places' points on the sphere
    And a group of places across the antimeridian has its centre near 180°, not near 0°
    And a place's centre is its own point
```

## Unlocking

### CUR-08 Mastering a country unlocks its next tier, and only its own
Up: PRD-02

```gherkin
Scenario Outline: what a mastered country unlocks
  Given a learner who has mastered <country> and nothing else
  When the unlocked items are listed
  Then <unlocked> are unlocked
    And the regions and places of every other country stay locked
    And the regions' places stay locked
  Examples:
    | country                          | unlocked          |
    | France (a regions-tier country)  | France's regions  |
    | Tuvalu (no regions tier)         | Tuvalu's places   |

Scenario: the next session asks the newly unlocked regions
  Given a learner who has mastered the United States
  When they start a session
  Then a United States region is asked within the first round
```

### CUR-09 Mastering a region unlocks its places
Up: PRD-02

```gherkin
Scenario: a mastered region
  Given a learner who has mastered France and Bretagne
  When the unlocked items are listed
  Then Bretagne's places are unlocked
    And the places of France's other regions stay locked
```

### CUR-10 An item that is not yet mastered unlocks nothing
Up: PRD-02

```gherkin
Scenario: a country in progress
  Given a learner who has started France but not mastered it
  When the unlocked items are listed
  Then none of France's regions are unlocked
    And France's page lists every region as locked, saying France must be mastered first
```

### CUR-11 A lapse does not re-lock anything
Up: PRD-04

```gherkin
Scenario: a mastered country is missed at the top rung
  Given a learner who has mastered Tuvalu
  When they miss Tuvalu at the top rung and it drops back a rung
  Then Tuvalu is still mastered
    And Tuvalu's places stay unlocked
```

### CUR-12 A place-type filter narrows the places, never the countries
Up: PRD-02

The filter is an option of the engine; no screen sets it yet.

```gherkin
Scenario: only places of the chosen types
  Given a place-type filter
  When the unlocked or new items are listed
  Then places of other types are left out
    And a region with no place of a chosen type is left out
    And every country is kept
    And an empty filter leaves out every place, and no filter keeps every place
```

## Mastery

### CUR-13 An item is mastered by passing the top rung on two different days
Up: PRD-02, PRD-04

```gherkin
Scenario Outline: passes at the top rung
  Given an item that has passed the top rung on <days> different local day(s)
  Then it <is> mastered
  Examples:
    | days | is     |
    | 1    | is not |
    | 2    | is     |

Scenario: two passes on one day count once
  Given an item that passes the top rung twice on the same local day
  Then it is not mastered

Scenario: mastery is kept
  Given a mastered item
  When it is later missed
  Then it stays mastered
```

## Item states and counts

### CUR-14 Each item is locked, new, learning or mastered
Up: PRD-07

```gherkin
Scenario Outline: an item's state
  Given an item <situation>
  Then its state is <state>
  Examples:
    | situation                                                    | state    |
    | whose parent is not mastered                                 | locked   |
    | that is unlocked and has never been answered                 | new      |
    | that is unlocked with only a placement result, unanswered    | new      |
    | that has been answered in a session and is not mastered      | learning |
    | that is mastered                                             | mastered |

Scenario: progress shows the states
  Given a learner who has mastered the United States
  Then the United States shows as mastered, and every one of its regions as new
    And a country never touched, such as Germany, shows as new on Home and Progress
```

### CUR-15 Progress under an item counts its whole subtree
Up: PRD-07

```gherkin
Scenario: counts below an item
  Given a country or region
  Then the counts below it cover all its descendants (regions and places), not itself:
    how many in all, mastered, learning, and not locked
    And its mastered share is mastered over all, 0 when it has no descendants
```

### CUR-16 Each tier is counted on its own
Up: PRD-07

```gherkin
Scenario: tier totals
  Given any progress
  Then each tier (countries, regions, places) has a total, a learning count and a learned count
    And learned means mastered, and learning means answered in a session and not mastered
    And progress for ids not in the tree is ignored

Scenario: the Progress page counts a mastered country
  Given a learner who has mastered the United States
  When the Progress page opens
  Then the countries tier says one is learned
```

### CUR-17 Mastering an item names what it unlocks
Up: PRD-02, PRD-05

```gherkin
Scenario: what an item unlocks
  Given an item
  Then what mastering it unlocks is its children and their tier (regions or places)
    And a place, or a country with nothing under it, unlocks nothing

Scenario: a mastered country offers to test out of its next tier
  Given a learner who has mastered the United States
  When its progress page opens
  Then it offers a test-out of the United States's regions
    And a region that is not mastered offers none
```

## New items

### CUR-18 New items are the unlocked items never answered
Up: PRD-06

```gherkin
Scenario: which items are new
  Given some unlocked items
  Then an item with no progress, or with progress never answered, is new
    And a placement seed the learner did not pass is still new
    And an item the learner passed in placement, or answered in a session, is not new
```

### CUR-19 New items arrive easiest first, then by how much maptap asks about the country
Up: PRD-06

*Why:* maptap asks most about the countries with the most places, so those come first among equals.

```gherkin
Scenario: the order of new items
  Given new items of any tiers
  Then they are ordered by difficulty, lowest first
    And ties go to the item whose country has more places
    And remaining ties are broken by id
    And a place-type filter changes which items are listed, not their difficulty or country counts
```

## Difficulty

### CUR-20 Countries and regions are banded by how much maptap asks and how hard its places are
Up: PRD-02, PRD-05

```gherkin
Scenario: banding siblings
  Given a group of siblings: every country, or one country's regions
  When they are ranked by many places first, and easy places next
  Then the ranking is cut into eight equal bands, 1 the easiest
    And of two items with as many places, the one with harder places ranks harder
    And an item with no places is harder than every band

Scenario: the committed data
  Given the committed countries and places
  Then countries spread evenly over the eight bands
    And the United States, China, Brazil, Japan and France are in band 1
    And Tuvalu is in band 7 or 8

Scenario: a place's difficulty
  Given a place
  Then its difficulty is maptap's level for it
```
