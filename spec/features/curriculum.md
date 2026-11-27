# Curriculum (CUR)

What there is to learn and in what order: the country → regions → places tree, which items are
unlocked, the order new items arrive in, and how hard each item is. When an item counts as mastered
is `grading.md`'s (GRD-15); which countries get a regions tier is decided when the data is built
(DAT-21). How the Progress pages show all this is `screens.md`'s.

## The tree

### CUR-01 Every country is at the top of the tree and unlocked from the start
Up: PRD-02

```gherkin
Scenario: a first-run learner can start on any country
  Given a learner with no progress
  When the unlocked items are listed
  Then every country in the data is listed, and no region or place is
    And a country drawn only as a point (Bonaire, Vatican City) is a country like any other
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
Scenario Outline: what a mastered country unlocks once its gate is open
  Given a learner who has mastered <country>
    And enough other countries that its gate is open (CUR-21)
  When the unlocked items are listed
  Then <unlocked> are unlocked
    And the regions and places of every country not mastered stay locked
    And the regions' places stay locked
  Examples:
    | country                          | unlocked          |
    | France (a regions-tier country)  | France's regions  |
    | Tuvalu (no regions tier)         | Tuvalu's places   |

Scenario: the next session asks the newly unlocked regions once easier countries are learned
  Given a learner who has mastered the United States and opened its gate
    And no new country of band 4 or easier is left
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

### CUR-21 Nothing below a country opens until enough countries are mastered
Up: PRD-02

*Why:* regions and a country's places are niche next to the countries themselves, so the learner
masters a broad base of countries first, and the deeper tiers open first for the countries
maptap asks about most.

```gherkin
Scenario Outline: a country's gate
  Given a learner who has mastered <country> and <mastered> countries in all, it among them
  When the unlocked items are listed
  Then <country>'s children are <state>
  Examples:
    | country                        | mastered | state    |
    | the United States (629 places) | 59       | locked   |
    | the United States (629 places) | 60       | unlocked |
    | Poland (41 places)             | 60       | locked   |
    | Poland (41 places)             | 149      | locked   |
    | Poland (41 places)             | 150      | unlocked |
    | Tuvalu (no regions tier)       | 149      | locked   |
    | Tuvalu (no regions tier)       | 150      | unlocked |

Scenario: the gate is on the country's own children only
  Given a country whose gate is open, and one of its regions mastered
  Then that region's places unlock as CUR-09 says, with no gate of their own

Scenario: the first wave on the committed data
  Given the committed countries and places
  Then the countries in the first wave are the 28 with 50 or more places,
    from the United States (629) down to South Africa (52)
    And every other country is in the second wave

Scenario: a gate that has opened stays open
  Given a learner whose mastered countries have opened a gate
  When a mastered country lapses at the top rung
  Then it is still mastered (GRD-15), so the count does not fall and the gate stays open
```

### CUR-22 The gate never locks an item the learner has already answered
Up: PRD-02, PRD-04

*Why:* progress made before the gate existed, or through a test-out, keeps being reviewed.

```gherkin
Scenario: a region answered before the gate
  Given a learner who has mastered the United States and 10 countries in all
    And has answered California in a session
  When the unlocked items are listed
  Then California is unlocked and keeps its state
    And the United States regions never answered stay locked

Scenario: a test-out pass counts as answered
  Given a region passed in a test-out, so its progress has an answered card
  Then the gate does not lock it

Scenario: a seed that was never answered is held
  Given a region with only a close-miss or failed placement seed, and its country's gate shut
  Then it is locked
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
    | a country's child, never answered, while its gate is shut   | locked   |
    | a country's child already answered, while its gate is shut  | as if the gate were open |
    | that is unlocked and has never been answered                 | new      |
    | that is unlocked with only a placement result, unanswered    | new      |
    | that has been answered in a session and is not mastered      | learning |
    | that is mastered                                             | mastered |
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
```

### CUR-17 Mastering an item names what it unlocks
Up: PRD-02

```gherkin
Scenario: what an item unlocks
  Given an item
  Then what mastering it unlocks is its children and their tier (regions or places)
    And a place, or a country with nothing under it, unlocks nothing
```

## New items

### CUR-18 New items are the unlocked items never answered
Up: PRD-06

```gherkin
Scenario: which items are new
  Given some unlocked items
  Then an item with no progress, or with progress never answered, is new
    And a placement seed that starts below L3 (a close miss, or probably known) is still new
    And an item placement sent to L3 review (passed, or likely known), or answered in a session,
      is not new
```

### CUR-19 New items arrive easiest first, countries ahead, then by how much maptap asks about the country
Up: PRD-02, PRD-06

*Why:* maptap asks most about the countries with the most places, so those come first among equals.
A region or place counts as three bands harder than it is, so new countries keep arriving after
a gate opens instead of being swamped by the easiest regions.

```gherkin
Scenario: the order of new items
  Given new items of any tiers
  Then they are ordered by difficulty, lowest first,
    a region's or a place's counting three bands more than its own
    And ties go to the item whose country has more places
    And remaining ties are broken by id
    And a place-type filter changes which items are listed, not their difficulty or country counts

Scenario: a band-1 region sorts among band-4 countries
  Given new items: a band-3 country, a band-4 country with fewer places than the United States,
    and a band-1 United States region
  Then the order is the band-3 country, the United States region, the band-4 country
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
