# Globe (GLB)

The one globe every screen shares: its imagery, what it draws, how it takes taps and gestures,
how the camera moves, the spherical maths that grading runs on, and the app shell around it.

## The one globe

### GLB-01 One globe stays mounted across pages
Up: PRD-08

```gherkin
Scenario: moving between pages keeps the same globe
  Given the app is open on any page
  When the learner follows links to other pages, or goes back
  Then the globe is the same map it was, never a new one
    And there is only ever one globe on the page
```

### GLB-02 Imagery only, on a 3D globe
Up: PRD-08, PRD-13

```gherkin
Scenario: the globe is satellite imagery and nothing else
  When the globe is shown
  Then it is a 3D sphere of EOX's Sentinel-2 cloudless 2025 imagery
    And it carries no labels, place names or vector basemap
    And the space around the sphere is near black
    And where an imagery tile is missing, the sphere shows dark blue
```

### GLB-03 The imagery is credited on the globe
Up: PRD-13, PRD-09

```gherkin
Scenario: on a wide screen the credit is written out
  Given a screen at least 768px wide
  When the globe is shown
  Then the EOX credit, with a link to s2maps.eu, shows in full in a corner of the globe

Scenario: at phone width the credit starts collapsed
  Given a screen narrower than 768px
  When the globe is shown
  Then the credit is a small info button, its text hidden
  When the learner taps the button
  Then the credit's text shows
```

### GLB-04 The opening view shows the whole sphere
Up: PRD-08, PRD-09

```gherkin
Scenario: the globe opens on the whole sphere
  When the globe first loads
  Then it is centred at 0° longitude, 20° north
    And the whole sphere fits its area with a small margin

Scenario: the learner cannot zoom out past the whole sphere
  Given the globe shows the whole sphere
  When the learner zooms out
  Then the zoom stays where the whole sphere fits

Scenario: a resized globe area refits
  Given the globe's area changes size
  When the learner had not zoomed in
  Then the view follows, still showing the whole sphere
  When the learner had zoomed in
  Then the zoom stays, unless it is now further out than the whole sphere allows
```

### GLB-05 Without WebGL the globe says so and the app still works
Up: PRD-09

```gherkin
Scenario: a browser that cannot draw the globe
  Given the browser has no WebGL
  When the app opens
  Then the globe's area shows a message that this browser can't draw the globe
    And the column's pages still render and their links still work
    And no error is thrown
```

### GLB-06 A lost drawing context comes back
Up: PRD-09

```gherkin
Scenario: the globe loses and regains its WebGL context
  Given the globe is drawing a mode
  When the browser drops the globe's WebGL context
  Then the message that the globe can't be drawn shows
  When the page changes the mode while the context is lost
    And the context comes back
  Then the message goes, and the globe draws the new mode
```

### GLB-07 The globe works while the imagery never arrives
Up: PRD-08

```gherkin
Scenario: EOX never answers
  Given no imagery tile ever loads
  When the globe is shown
  Then the mode's borders still draw
    And taps still register
```

## What the globe draws

### GLB-09 Each mode draws its own layers
Up: PRD-08, PRD-03, PRD-07

```gherkin
Scenario Outline: what each mode draws over the imagery
  Given the globe is in <mode> mode
  Then it draws <drawn>
    And nothing else of the app's own
  Examples:
    | mode                               | drawn                                                                 |
    | bare                               | nothing                                                               |
    | country borders                    | every country's border as a line                                      |
    | region borders, regions loaded     | the country's region borders, and its outline over them               |
    | region borders, no regions         | the country's outline only                                            |
    | highlight a country                | every country's border, the country shaded and outlined over them     |
    | highlight a region                 | the country's region borders and outline, the region shaded over them |
    | highlight a place                  | the country's region borders (else its outline), a dot at the place   |
    | progress                           | each feature filled in its colour or left unfilled, every feature's border, its dots on top |
```

### GLB-10 Switching mode leaves nothing behind, and the reveal stays on top
Up: PRD-08

```gherkin
Scenario: a new mode replaces the old one
  Given the globe is drawing one mode
  When a page switches it to another
  Then none of the old mode's layers remain

Scenario: the reveal stays over any mode
  Given a reveal is shown
  When the mode changes
  Then the reveal is still drawn above the mode's layers
```

### GLB-11 Borders are not drawn along cuts in the data
Up: PRD-08

```gherkin
Scenario: a feature split at the antimeridian or closed at the south pole
  Given a country or region whose outline the data cuts at 180° (Russia, Fiji, Chukotka) or closes along the south pole (Antarctica)
  When its border is drawn
  Then no line runs along 180° or along the pole
    And its fill, where it has one, still covers the whole feature
```

### GLB-12 The reveal shows the target, the tap and the path between them
Up: PRD-01, PRD-08

```gherkin
Scenario: after a tap answer
  Given a tap answer has been given
  When the reveal is shown
  Then the target is outlined in green (a green dot for a place)
    And a red pin marks the tap and a green pin marks the answer point
    And a dashed line joins them along the great circle, the short way across the antimeridian
    And a pin on the far side of the sphere is hidden, not faded

Scenario: after a multiple-choice answer
  Given a multiple-choice answer has been given
  When the reveal is shown
  Then the target is outlined, with no pins and no path

Scenario: names appear only as markers
  When a page names something on the globe
  Then the name is an HTML label at its point, readable over any imagery
```

### GLB-13 The latest page to set the globe owns it
Up: PRD-08

```gherkin
Scenario: a page shows its mode, and another takes over
  Given a page or exercise is showing its mode, reveal, markers and tap handling on the globe
  When another one shows its own
  Then the globe shows the newer one's

Scenario: a page that leaves takes everything of its own with it
  Given a page is showing its mode, reveal and markers
  When the learner leaves it for a page that sets nothing on the globe
  Then the globe is bare, with no reveal and no markers
    And taps do nothing
    And the camera stays where it was
```

## Taps and gestures

### GLB-14 A tap gives the point tapped
Up: PRD-01, PRD-08

```gherkin
Scenario: tapping the sphere
  Given a page is listening for taps
  When the learner taps (or clicks) a point on the sphere
  Then the page gets that point's longitude and latitude, the longitude within -180° to 180°
```

### GLB-15 What is not a tap
Up: PRD-01, PRD-09

```gherkin
Scenario Outline: a gesture that is not a tap on the globe
  Given a page is listening for taps
  When the learner <gesture>
  Then the page gets no tap
  Examples:
    | gesture                                        |
    | drags the globe                                |
    | pinches to zoom                                |
    | taps the space beside the sphere               |
    | taps one of the reveal's pins                  |
```

### GLB-16 A double tap is two taps, never a zoom
Up: PRD-01

```gherkin
Scenario: tapping twice quickly
  When the learner double-clicks or double-taps the sphere
  Then the page gets the taps
    And the zoom does not change
```

### GLB-17 Drag rotates, wheel and pinch zoom, north stays up
Up: PRD-09

```gherkin
Scenario Outline: the globe's gestures
  When the learner <gesture>
  Then the globe <result>
  Examples:
    | gesture                        | result                       |
    | drags with a mouse or a finger | turns, its centre moving     |
    | scrolls the wheel up           | zooms in                     |
    | spreads two fingers apart      | zooms in                     |

Scenario: the globe never tilts or turns off north
  When the learner uses any gesture or key
  Then north stays up and the view is never tilted
```

### GLB-18 Progress mode selects what was tapped
Up: PRD-07

```gherkin
Scenario Outline: a tap in progress mode
  Given the globe is in progress mode with features and dots
  When the learner taps <where>
  Then <selected> is selected
  Examples:
    | where                                                   | selected                  |
    | on a dot as drawn                                       | the dot's item            |
    | inside a feature, off any dot                           | the feature               |
    | in no feature, a fingertip's width from a dot           | the dot's item            |
    | in no feature and well clear of every dot               | nothing                   |

Scenario: progress mode is not a tap question
  Given the globe is in progress mode
  When the learner taps it
  Then no tap point is reported, only the selection
```

### GLB-19 The globe stays smooth while dragging
Up: PRD-09
Verified: manual — frame times while dragging depend on the device's GPU; checked by hand on a phone and with a Playwright trace of a drag (no long main-thread frames)

```gherkin
Scenario: dragging on a phone
  When the learner drags the globe on a phone
  Then it turns with the finger without visible stutter
```

## The camera

### GLB-20 Camera moves frame what a page asks for
Up: PRD-08, PRD-07

```gherkin
Scenario Outline: a page moves the camera
  When a page asks the camera to <move>
  Then the globe flies to <view>
  Examples:
    | move                              | view                                                                                  |
    | fit a feature                     | its main part framed with a margin, its far-flung parts (Alaska, overseas) left out    |
    | show a span around a point        | the point centred, about that many km across the globe's shorter side                  |
    | frame two points                  | both points (and a feature too, when given) framed with room for pins and a name, never closer than the neighbourhood span |
    | show the world around a point     | the whole sphere at the opening zoom, centred on the point (else the opening centre)  |
    | stay                              | wherever a flight in progress has reached, and it stops there                         |

Scenario: framing across the antimeridian
  When the camera frames a feature or two points either side of 180°
  Then it frames them the short way, across 180°, not round the world
```

### GLB-21 A camera move asked for before the globe opens still happens
Up: PRD-08

```gherkin
Scenario: a deep link moves the camera at once
  Given the learner opens a page that moves the camera as it mounts (a country's progress page)
  When the globe finishes loading after the page asked
  Then the opening view is shown first
    And the page's move happens right after it
```

## Spherical maths

These rules hold for any feature and any tap, and grading relies on them.

### GLB-22 A tap is inside its target or measured to its border
Up: PRD-01, PRD-08

```gherkin
Scenario: a tap inside the target
  When a tap lands inside the target, tested on the sphere
  Then it is inside, 0 km outside the border

Scenario: a tap inside a feature with the same name
  Given the target shares its name with other features
  When a tap lands inside one of them
  Then it is inside, 0 km outside the border

Scenario: a tap outside
  When a tap lands outside the target and every same-name feature
  Then its distance outside the border is the great-circle distance to the nearest edge of any of them
    And a tap in a hole is measured to the hole's edge
    And a tap beyond a corner is measured to the corner
    And a target across the antimeridian is measured across it
```

### GLB-23 Distances are great-circle km
Up: PRD-01

```gherkin
Scenario: the distance from the answer
  When any tap is measured
  Then its distance from the answer point is the great-circle distance in km on a 6371 km sphere

Scenario: a place target
  Given the target is a place, a point with no outline
  When a tap is measured
  Then it is never inside, and its border distance and size are 0
```

### GLB-24 A feature's size and main part
Up: PRD-01, PRD-08

```gherkin
Scenario: far-flung parts are not the feature's main part
  Given a feature with parts more than 500 km from the rest
  When the cluster with the most area holds at least 80% of it
  Then that cluster is the feature's main part
  When no cluster holds 80% (a spread-out island nation), or there is one cluster
  Then the whole feature is its main part

Scenario: a feature's size
  When a tap on a feature target is measured
  Then the feature's size is the square root of its main part's area, in km
    And a tap on a far part still counts as inside
```

### GLB-25 The answer point is inside the feature
Up: PRD-01, PRD-08

```gherkin
Scenario: a country's or region's answer point
  When a feature's answer point is found
  Then it is the centroid of the feature's main part, when that is inside it
    And otherwise a point inside the main part, roughly the farthest from its edge
    And it is inside for a crescent, a sliver thinner than the search grid, and a shape across the antimeridian
```

### GLB-26 A feature with no area becomes a small disc
Up: PRD-08, PRD-01

```gherkin
Scenario: a tiny country stored as a point
  Given a feature stored as a point, or as a polygon with no area
  When it is loaded
  Then it becomes a disc around its centre, of its own radius when it has a valid one, else 2 km
    And it keeps its id and properties
    And a feature with no finite coordinate at all is an error naming it
```

### GLB-27 What lies on a map of a feature
Up: PRD-07

```gherkin
Scenario: a point within a frame's extent
  Given a frame feature, such as a country's main part
  When a point lies inside it, or just off its edge within the frame's margin
  Then it is on the frame's map
  When a point is far outside it or round the back of the globe
  Then it is not
```

### GLB-28 The midpoint of two points
Up: PRD-08

```gherkin
Scenario: halfway between two points
  When the midpoint of two points is found
  Then it is halfway along the great circle between them, the short way across the antimeridian
    And its longitude is within -180° to 180°
```

## The app shell and layout

### GLB-29 On a wide screen the column sits left of the globe
Up: PRD-09

```gherkin
Scenario: a screen at least 768px wide
  When any page is shown
  Then the page's column is a 320px strip at the left, the full height of the screen
    And the globe fills the rest
    And the page scrolls neither down nor sideways
```

### GLB-30 At phone width the globe sits above the panel
Up: PRD-09

```gherkin
Scenario: a screen narrower than 768px
  When a page with the globe is shown
  Then the globe is at the top, at least half the screen's height
    And the column is below it, reaching the bottom of the screen
    And the column's content keeps a 16px gutter at each side
    And nothing scrolls sideways
```

### GLB-31 Settings and Credits hide the globe at phone width
Up: PRD-09, PRD-08

```gherkin
Scenario: a page without the globe on a phone
  Given a screen narrower than 768px
  When Settings or Credits is shown
  Then the globe is hidden and the column fills the screen
  When the learner goes back to a page with the globe
  Then it is the same globe, sized to its area, its camera where it was
```

### GLB-32 The pages and their paths
Up: PRD-07, PRD-05, PRD-06, PRD-10, PRD-16

```gherkin
Scenario Outline: each path shows its page in the column
  When the learner opens <path>
  Then the column shows <page>
  Examples:
    | path                             | page                               |
    | /                                | Home                               |
    | /progress                        | Progress                           |
    | /progress/<country>              | the country's drill-down           |
    | /progress/<country>/<region>     | the region's drill-down            |
    | /placement                       | the placement test                 |
    | /placement/<country>             | the country's test-out             |
    | /placement/<country>/<region>    | the region's test-out              |
    | /session                         | a session                          |
    | /settings                        | Settings                           |
    | /credits                         | Credits                            |
    | /playground                      | the playground, in development builds only |

Scenario: an unknown path
  When the learner opens a path that is not one of these
  Then the app replaces it with Home's path and shows Home

Scenario: one dark theme
  When any page is shown
  Then it uses the dark colour scheme
```

### GLB-33 Every page's column ends with the credits footer
Up: PRD-13

```gherkin
Scenario: the footer
  When any page is shown
  Then below the page, its column credits MapTap.gg for the place list and Natural Earth for the boundaries, each linked to its site
    And it links to the Credits page
```

### GLB-36 Every page's column starts with the app bar
Up: PRD-17, PRD-09

*Why:* each page made its own way out, and some had none back to Home: Progress, its drill-down
pages and every failed load. The bar gives every page the same three ways on.

```gherkin
Scenario: the bar
  When any page is shown, while it loads, after its load fails, and during a session or a test
  Then the top of its column shows the app's name, linking to Home, and links to Progress and to Settings
    And the link to the page shown is marked as the current page, Progress's also on its drill-down pages
    And the bar stays in view at the top of the column while the column scrolls

Scenario: pages do not repeat the bar
  When a page is shown
  Then it has no links of its own to Home, Progress or Settings
    But a session or a test keeps its own way out, which says where it leads: its link out
      while it runs, and a link back on its summary, its result or its nothing-to-ask message

Scenario: phone width
  Given a phone-width screen
  When any page is shown
  Then the bar fits on one line inside the 16px gutters, and nothing scrolls sideways

Scenario: leaving a session or a test by the bar
  Given a session or a test is in progress
  When the learner follows a link in the bar
  Then it is the same as leaving by its own link: a session keeps its round for the day (SES-27), and a
    test keeps the answers already saved and stores no finished-test marker (PLC-19)
    And no pin or reveal is left on the globe
```

### GLB-37 A new page starts at its top, with focus on it
Up: PRD-17

*Why:* the link that had focus unmounts with the old page, so focus fell back to the document
and a screen reader announced nothing.

```gherkin
Scenario: following a link to another page
  Given the column was scrolled down and a link in it had focus
  When the learner follows a link to another page
  Then the column shows the new page from its top
    And focus moves to the new page's main heading, or to the column when the page has none

Scenario: the same page
  When the learner follows the bar's link to the page already shown
  Then nothing moves: the page keeps its scroll and its state
```

### GLB-38 The tab title names the page
Up: PRD-17

```gherkin
Scenario Outline: the browser tab's title
  When <page> is shown
  Then the tab's title is <title>
  Examples:
    | page                         | title                                     |
    | Home                         | the app's name alone                      |
    | Progress                     | Progress, then the app's name             |
    | a country's or region's page | its name, then the app's name             |
    | a session                    | Study, then the app's name                |
    | the placement test           | Placement test, then the app's name       |
    | a test-out                   | the test-out's heading, then the app's name |
    | Settings, Credits            | the page's name, then the app's name      |
```

### GLB-35 The site works from a sub-path
Up: PRD-14
Verified: manual — the e2e server serves the app at `/`; the sub-path build (`npm run build:pages`) is checked on the deployed GitHub Pages site, including a reload of a deep link

```gherkin
Scenario: deployed under a sub-path
  Given the site is built for a sub-path such as /geography-trainer/
  When the learner opens or reloads any page's link under it
  Then the page is shown, and links stay under the sub-path
```
