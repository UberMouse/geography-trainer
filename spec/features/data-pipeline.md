# Data pipeline (DAT)

`npm run build:data` turns maptap's place list and Natural Earth's boundaries into the app's data
files under `public/data/`, which are committed. It runs rarely, by hand, with network access; the
site build and the app never contact maptap. The file formats are in
`contracts/data-files.md`, the tables and constants in `contracts/data-pipeline.md`.

## Reading maptap's list

### DAT-01 maptap's file is read as data, never run
Up: PRD-12

*Why:* maptap's file is JavaScript from another site; running it would run their code on the
build machine.

```gherkin
Scenario: the place array is sliced out of the file and parsed as JSON
  Given maptap's V2 file, which declares the place array and then a second array of shapes
  When the build reads it
  Then it takes the text from the place array's opening bracket to its matching closing bracket
    And brackets and escaped quotes inside strings do not end the slice
    And it parses that text as JSON
    And the shapes array after it is not read

Scenario: nothing in the file is executed
  Given the code that reads maptap's file
  Then it never evaluates, requires or imports that file, or builds a function from it
```

### DAT-02 Disabled entries are dropped
Up: PRD-12

```gherkin
Scenario: only active entries go on
  Given maptap's list holds entries with disabled true, with disabled false, and with no disabled
  When the build reads it
  Then the entries with disabled true are dropped
    And the others are the active entries
    And the total counts every entry, disabled ones included
```

### DAT-03 A malformed list fails the build
Up: PRD-12

```gherkin
Scenario Outline: a file the build can't trust stops it with a clear error
  Given maptap's file <problem>
  When the build reads it
  Then the build fails with an error that says so
    And no data file is written
  Examples:
    | problem                                                                  |
    | does not contain the place array's declaration                          |
    | has something other than an opening bracket right after the declaration |
    | has a place array that never closes                                      |
    | has a place array that is not valid JSON                                 |
    | has elements that are not objects (the error lists the first few)        |
    | has an active entry lacking a required field or with one of the wrong type |
    | has an optional field of the wrong type (the error names entry and field) |
```

### DAT-04 A failed or stalled download fails the build
Up: PRD-12

```gherkin
Scenario Outline: the build never hangs on the network or carries on without the data
  Given a download of <file>
  When the server <answers>
  Then the build fails naming the URL and <what>
  Examples:
    | file                  | answers                                   | what                  |
    | maptap's list         | with a status outside 2xx                 | the status            |
    | maptap's list         | with no complete response within 60 s     | the time limit        |
    | a Natural Earth file  | with no complete response within 120 s    | the time limit        |
```

maptap's list is fetched fresh on every run; it is never cached.

## Natural Earth

### DAT-05 Natural Earth comes from one pinned release, downloaded once
Up: PRD-12

```gherkin
Scenario: a cached release is reused
  Given a Natural Earth file of the pinned release is in the local cache
  When the build loads it
  Then it reads the cached copy and downloads nothing

Scenario: a missing file is downloaded into the cache
  Given the file is not in the cache
  When the build loads it
  Then it downloads it from the pinned release and saves it to the cache
    And a download cut off part-way never leaves a file the next run would trust

Scenario: unnamed admin-1 fragments are left out
  Given Natural Earth admin-1 rows without a name
  When the build loads them
  Then they are not regions, so a place inside one goes to the nearest named region
```

## Matching countries

### DAT-06 Countries match Natural Earth by normalized name
Up: PRD-12

```gherkin
Scenario: names match across spelling differences
  Given a maptap country name that differs from Natural Earth's only in case, diacritics,
    punctuation or "&" for "and"
  When countries are matched
  Then it matches the map unit with that name, long name, admin name or geounit name
    And every map unit sharing a matched admin name joins the country (France and French Guiana)
    And the country's id is a lowercase ASCII slug of maptap's name ("Côte d'Ivoire" is cote-d-ivoire)
```

### DAT-07 The UK nations are countries of their own
Up: PRD-12

```gherkin
Scenario: England, Scotland, Wales and Northern Ireland use their own map units
  Given maptap lists England and Scotland as countries, and also the United Kingdom
  When countries are matched
  Then England and Scotland each get their own map unit
    And the United Kingdom does not take them, though Natural Earth gives them its admin name
    And the United Kingdom is only the units its override lists (Gibraltar and the Cyprus bases)

Scenario: a specific name beats an admin-name match
  Given a map unit that one maptap name matches by its own name and another only by admin name
  When countries are matched
  Then it belongs to the first (New Zealand does not take Tokelau)
```

### DAT-08 The overrides table settles what the name match can't
Up: PRD-12

```gherkin
Scenario Outline: an override replaces the name match for one maptap name
  Given maptap's country "<name>" has an override of kind <kind>
  When countries are matched
  Then <result>
  Examples:
    | name             | kind                | result                                                                |
    | Türkiye          | map units           | its geometry is the listed map units, here Turkey's                   |
    | Saint Helena     | map subunits        | its geometry is the listed subunits, so it and Ascension can split one map unit |
    | Saba             | point               | it has no polygon: it is a circle of the given radius around the point |
    | Pacific Ocean    | exclude, with reason | it is not a country, and each of its places is listed as excluded with the reason |
```

### DAT-09 An unmatched or ambiguous country fails the build
Up: PRD-12

```gherkin
Scenario Outline: country matching stops the build rather than guess
  Given <problem>
  When countries are matched
  Then the build fails, and the error <names>
  Examples:
    | problem                                                       | names                         |
    | maptap names countries that no map unit matches and no override covers | every such name, at once |
    | an override lists a unit code Natural Earth doesn't have     | the name and the code         |
    | two maptap countries take the same Natural Earth unit        | both names and the unit       |
    | two maptap names slug to the same id                         | both names and the id         |

Scenario: two countries may share a geounit through different subunits
  Given two countries whose overrides take different subunits of one geounit
  When countries are matched
  Then both are kept
```

### DAT-10 A border place goes to one of the countries it names
Up: PRD-12

```gherkin
Scenario: a place filed under "A/B" belongs to A or B
  Given a maptap place whose country is two names joined by a slash ("Nepal/China")
  When the build files it
  Then it goes to the named country whose polygon contains it
    And if neither contains it, to the named country whose border is nearest
    And a country not named is never chosen, even if it contains the point
    And spaces around the slash are ignored, and maptap's other spellings map through aliases ("USA")

Scenario: a part that is no polygon country fails the build
  Given a border place whose name includes a part that names no polygon country
  When the build files it
  Then the build fails naming the place's country and that part
```

## Territories

### DAT-11 A territory moves with its geometry and its regions
Up: PRD-12

```gherkin
Scenario: a territory moves from one country to another
  Given a territory move from country A to country B, the territory being a set of A's admin-1
    rows or a Natural Earth disputed area
  When it is applied
  Then A's geometry loses the territory and B's gains it
    And A's admin-1 rows are clipped to what is left, and the clipped-off pieces become B's rows
    And B's own rows give up what the moved pieces cover, so B's rows still tile
    And when the move names a region, the moved pieces become one region of B with that name;
      otherwise each keeps its own name
    And moves apply in order, each to the result of the last
```

### DAT-12 Clipping slivers are reported, not kept as territory
Up: PRD-12

```gherkin
Scenario Outline: a piece under 1% of its row is a sliver
  Given a territory move whose edge leaves <piece>
  When it is applied
  Then <outcome>
    And the sliver is reported with its row, its share of the row and its area in km²
  Examples:
    | piece                                                     | outcome                                   |
    | a sliver of one of A's rows inside the territory          | the row stays A's, whole                  |
    | a sliver of a moved row outside the territory             | the rest of the row moves; the sliver has no row |
    | a sliver of B's own row overlapping the moved pieces      | B's row stays as it is                    |
    | B's row lying in the territory but for a sliver           | B's row is dropped; the moved pieces replace it |

Scenario: a clipped row keeps a label point inside itself
  Given one of A's rows is clipped so that its old centre lies on the cut
  When the move is applied
  Then its label point is moved strictly inside what is left
    And so the row stays A's region and is not taken for another country's
```

### DAT-13 A territory move that can't apply fails the build
Up: PRD-12

```gherkin
Scenario Outline: a broken territory move stops the build
  Given a territory move where <problem>
  When it is applied
  Then the build fails with an error naming the move and the problem
  Examples:
    | problem                                         |
    | an admin-1 row it lists doesn't exist           |
    | the disputed area it names doesn't exist        |
    | either country has no polygon                   |
    | the territory covers all of the losing country  |
    | no admin-1 row of the losing country lies in it |
```

### DAT-14 Crimea is Ukraine's and Western Sahara is whole
Up: PRD-12

*Why:* maptap labels its places this way; Natural Earth draws a de facto line. The decision is
the user's, and SOURCE.md states it.

```gherkin
Scenario: the committed data follows maptap's labels
  Given the committed data
  Then the places in Crimea (Sevastopol, Simferopol, Yalta, ...) are in Ukraine,
    in one region named Crimea
    And the places of Western Sahara, Smara included, are in Western Sahara, not Morocco
```

## Regions

### DAT-15 A country's regions are its own admin-1 rows
Up: PRD-02, PRD-12

```gherkin
Scenario: admin-1 rows are picked for a country
  Given Natural Earth admin-1 rows
  When a country's regions are built
  Then they are the rows under its Natural Earth admin code
    And not rows of a geounit another kept country owns (England's rows are not Scotland's)
    And not rows whose label point lies in another kept country, polygon or circle
      (the Caribbean Netherlands rows belong to Bonaire, Saba and Sint Eustatius);
      those are reported as dropped, naming the country the label lies in
```

### DAT-16 Some countries' regions are Natural Earth's larger regions
Up: PRD-02, PRD-12

```gherkin
Scenario: provinces are merged into regions for some countries
  Given a country on the dissolve list (France, England, Scotland, Wales, Northern Ireland,
    Italy, Spain, the Philippines)
  When its regions are built
  Then admin-1 rows sharing Natural Earth's region field become one region named after it
    And a row with no region field (France's southern lands) stays a region of its own
```

### DAT-17 Region ids are unique and stable
Up: PRD-12

```gherkin
Scenario: a region's id is its country id and a slug of its name
  Given a country's regions
  When they are built
  Then each id is "<country id>.<slug of the region name>"
    And when two regions' names give the same slug, or a name gives no slug, the id also
      carries the Natural Earth row code ("x.limburg-aaa-1")
    And regions are listed in id order
```

### DAT-18 Region names are distinct within a country
Up: PRD-02, PRD-12

*Why:* a question names a region; two regions of one country with one name can't be told apart.

```gherkin
Scenario: a renamed row still matches maptap's spelling
  Given a region-name override for an admin-1 row (Galway the county and Galway the city)
  When regions are built
  Then the region takes the override's name, and its id follows that name
    And maptap's admin naming Natural Earth's original name still matches it

Scenario: a mislabelled row drops the wrong name
  Given an override marked as a mislabel, where Natural Earth's names describe another region
  When regions are built
  Then the row's Natural Earth names no longer match maptap's admin
    And only the override's own aliases match besides its new name

Scenario Outline: a name problem fails the build
  Given <problem>
  When regions are built
  Then the build fails naming <names>
  Examples:
    | problem                                                                 | names                         |
    | an override for a row code Natural Earth doesn't have                  | the code                      |
    | an override for a row that ends up in no built region                  | the code                      |
    | an override for a row of a country whose regions are dissolved         | the country and the code      |
    | two regions of a country with a regions tier share a name (normalized) | the country, the name and the rows |

Scenario: the committed regions have distinct names
  Given the committed region files
  Then no country has two regions whose names match once normalized
    And Galway city and Galway county are separate items, each with its own name
```

### DAT-19 A place's region comes from maptap's admin, its point, or the nearest edge
Up: PRD-02, PRD-12

```gherkin
Scenario Outline: each place in a country with regions is assigned one region
  Given a place <where>
  When regions are assigned
  Then it gets <region>
  Examples:
    | where                                                                 | region                              |
    | whose maptap admin names a region it lies in or within 10 km of       | the region its admin names          |
    | whose admin names a region more than 10 km away, inside another region | the region containing the point     |
    | with no admin, inside a region                                        | the region containing the point     |
    | outside every region (a coastal point)                                | the region with the nearest edge, snapped |

Scenario: admin matches any of a region's names
  Given a place's maptap admin
  When it is compared with the regions
  Then it matches, once normalized, a region's name or any of its rows' names, English names
    or alternative names (and a renamed row's original name)
```

### DAT-20 Disagreements with maptap's admin are reported, not fatal
Up: PRD-12

```gherkin
Scenario Outline: the build reports where maptap's admin and the geometry disagree
  Given a place with a maptap admin
  When <case>
  Then it is <reported> in the admin-mismatch report
    And the build does not fail over it
  Examples:
    | case                                                              | reported |
    | the admin names the region the place lies in                      | not      |
    | the admin names a region within 10 km, but the point is in another | listed   |
    | the admin names a region the place doesn't get                     | listed   |
    | the admin names no region of the country                           | listed   |
    | the place has no admin                                             | not      |
```

### DAT-21 A country with enough places and regions gets a regions tier
Up: PRD-02

```gherkin
Scenario Outline: the regions tier is decided at build time
  Given a country with <regions> regions holding places and <places> places
  When the build decides tiers
  Then it <has> a regions tier
  Examples:
    | regions | places | has          |
    | 4       | 15     | has          |
    | 3       | 15     | does not have |
    | 4       | 14     | does not have |

Scenario: only regions-tier countries ship regions
  Given a country without a regions tier
  Then it has no region file, and its places have no region
    And a regions-tier country's region file holds all its regions, those with no places too
```

## Geometry

### DAT-22 Geometry is simplified without losing any shape
Up: PRD-08, PRD-12

```gherkin
Scenario: every polygon part survives simplification
  Given countries and regions with many parts, small islands among them
  When their geometry is simplified and quantized for the data files
  Then every part keeps a shape, however small
    And each feature's parts are merged back into one geometry with its id
    And point-only countries pass through as points in the same object

Scenario: a feature that comes out empty fails the build
  Given a feature with no geometry left after simplification
  When the data files are made
  Then the build fails naming it
```

### DAT-23 Every place lies within tolerance of its country and region
Up: PRD-08, PRD-12

*Why:* the app grades a tap against its own geometry, so a place must sit on the shape it's
asked about.

```gherkin
Scenario Outline: places are checked against the simplified geometry
  Given a place <where>
  When containment is checked on the geometry the data files hold
  Then <outcome>
  Examples:
    | where                                                    | outcome                                  |
    | inside its country                                       | it passes                                |
    | 5 km outside its country                                 | it passes                                |
    | 50 km outside its country                                | the build fails naming it and the distance |
    | 50 km outside its country, allow-listed with a reason    | it passes and is listed with its distance |
    | inside its country but 50 km outside its region          | the build fails naming it                |
    | within the radius of its point-only country              | it passes                                |

Scenario: the allow-list stays honest
  Given a containment allow-list entry with an empty reason, or for a place that no longer
    lies beyond the tolerance
  When containment is checked
  Then the build fails naming the entry
```

## Writing and validating

### DAT-24 public/data is replaced only by data that validates
Up: PRD-12

```gherkin
Scenario: the new files go in only when they validate
  Given generated data
  When the build writes it
  Then the files are written to a staging directory outside public/ and validated there
    And only when validation finds no problem do they replace public/data/ as a whole

Scenario: a failed validation leaves public/data as it was
  Given validation finds problems, or throws
  When the build writes the data
  Then public/data/ is byte-for-byte unchanged
    And the problems are returned for the build to print
    And no staging directory is left behind

Scenario: a first run creates public/data
  Given there is no public/data/ yet
  When generated data validates
  Then public/data/ is created
```

### DAT-25 Validation checks the files against each other
Up: PRD-12

```gherkin
Scenario Outline: a data directory with a problem fails validation
  Given a data directory where <problem>
  When it is validated
  Then validation reports it
  Examples:
    | problem                                                                  |
    | a place's country is not in the countries file                           |
    | a place of a regions-tier country has no region                          |
    | a place's region is not in its country's region file                     |
    | a place of a country without a regions tier has a region                 |
    | a regions-tier country has no region file                                |
    | a region file exists for a country without a regions tier                |
    | two places, two countries or two regions share an id                     |
    | kept plus excluded is not the active count                               |
    | the places file holds a different number of places than the kept count  |
    | the countries file or a region file is over its size limit               |
    | a place is beyond the containment tolerance and not allow-listed         |
    | the manifest's list of places beyond the tolerance differs from a fresh check |

Scenario: consistent data passes
  Given a data directory with none of those problems
  When it is validated
  Then validation reports nothing
```

Validation reads only the data directory: it runs offline, and the committed data is checked by
the same rules in the unit tests.

### DAT-26 SOURCE.md records the source and the credits
Up: PRD-12, PRD-13

```gherkin
Scenario: the data directory says where its data came from
  Given a build that succeeded
  Then SOURCE.md gives the fetch time, maptap's URL, the Natural Earth release and files
    And it credits MapTap.gg for the place list and Natural Earth (public domain) for boundaries
    And it states the boundary decisions
    And it gives the entry, active, kept and excluded counts, excluded places by reason,
      the country counts by how they matched, and the number of regions-tier countries
    And it lists every excluded place with its id, name, maptap country and reason
```

### DAT-27 The output is ordered, so a rebuild diffs cleanly
Up: PRD-12

```gherkin
Scenario: everything is written in a fixed order
  Given the generated data
  Then places are in id order, and countries and each country's regions are in id order
    And sorting compares strings by code unit, never by locale
    And coordinates of places are rounded to 4 decimal places
```

### DAT-28 The build prints a report for review
Up: PRD-12
Verified: build:data — console output of the network build, read by the person who runs it

```gherkin
Scenario: a successful build prints what a reviewer should look at
  When the build runs
  Then it prints the place counts and each excluded place
    And the countries kept, by how they matched, and the excluded names
    And each border place and the country it went to
    And the regions-tier countries
    And the admin mismatches (a place with an admin in a country with no admin-1 regions among
      them), the snapped points with their distances, and the dropped admin-1 rows
    And the boundary decisions and the territory-move slivers
    And the allow-listed places beyond the tolerance, with distance and reason
    And whether validation passed, or each problem it found, exiting non-zero on any problem
```

## The committed data

### DAT-29 The committed data validates
Up: PRD-12

```gherkin
Scenario: the committed data passes the build's validation as it is
  Given public/data/ as committed
  When it is validated against the current allow-list
  Then there are no problems
    And a missing data directory fails, rather than being skipped
    And its counts are the ones the contracts give: every active place kept but the excluded ones
```

### DAT-30 The committed geometry suits the app's spherical maths
Up: PRD-08

```gherkin
Scenario: every feature is a proper area once loaded
  Given every committed country and region, as the app's loaders return them
  Then none covers a hemisphere or more (its rings wind the way the globe's maths expects)
    And every one has an area greater than zero
    And the point-only countries (Bonaire, Saba, Sint Eustatius) come out as discs of their own
      radius, and a tap on the point is inside
    And Vatican City, whose polygon is too small to keep an area, comes out as a disc too
    And every feature's answer point lies inside its main part
```

### DAT-31 Countries keep their islands and far territories
Up: PRD-08, PRD-12

```gherkin
Scenario: the country geometry includes the far parts
  Given the committed countries
  Then France includes Corsica, Ushant, French Guiana and Réunion
    And Chile includes Tierra del Fuego and Easter Island, Japan Hokkaido, Italy Sicily,
      and Portugal the Azores
    And a tap in Paris is inside France, and a tap 100 km west of Ushant is 70 to 130 km outside
```

### DAT-32 The committed data builds the curriculum
Up: PRD-02

```gherkin
Scenario: the curriculum is built from the committed files
  Given the committed countries, region files and places
  When the curriculum is built
  Then it holds every country, every place, and the regions that hold places
    And every region item has children
    And the new-item order puts the United States before Tuvalu and London before Akron
```
