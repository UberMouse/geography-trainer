# Geography Trainer: product (L0)

Geography Trainer is a public website that trains the skill maptap.gg tests: given a place name,
tap it on a bare globe with no borders or labels. maptap scores a tap by its distance from the
answer. The site teaches countries first, then a country's regions, then the cities and landmarks
in them. Spaced repetition keeps what was learned, and a placement test skips what the learner
already knows.

Each item below is a promise the product keeps. The scenarios in `features/` say how; see
`README.md` for the tiers.

## PRD-01 Train the tap
The core exercise is maptap's own: a place is named, and the learner taps where it is on a bare
globe. The app shows maptap's score for each tap so the numbers feel familiar, but it schedules
learning on the raw distance, because maptap's curve is too flat to tell a near miss from a far one.

## PRD-02 Countries, then regions, then places
Learning runs down a tree. Countries come first. Mastering a country unlocks its regions (for
countries with enough places to need them), and mastering a region unlocks its cities and
landmarks. Unlocking is per country, so a learner can go deep on one country while others stay
at the country tier. Going deep waits until the learner knows the world well: nothing below a
country opens until they have mastered many countries, and the countries maptap asks about most
open first. Even then, new countries keep arriving ahead of the deeper tiers.

## PRD-03 Each item climbs from recognising to recalling
An item is learned in rungs, all on the globe. First the learner picks its name from four
choices while it is highlighted. Then they tap it with borders drawn. Finally they tap it on the
bare globe, as in maptap. An item reviewed later is asked at the highest rung it has reached.

## PRD-04 Spaced repetition keeps what was learned
Every answer is graded and fed to an FSRS scheduler, which decides when each item comes back. Fast
and close answers push an item further out; misses bring it back soon. Mastered items stay in
review indefinitely.

## PRD-05 A placement test skips what the learner knows
On first launch, a short adaptive test estimates how much the learner already knows and places
countries accordingly. When a tier unlocks, the learner can test out of it the same way. Nothing
is skipped outright: items the learner passes come back soon to confirm.

## PRD-06 A daily session
A session asks the reviews that are due first, then introduces new items, up to a daily limit.
It mixes the rungs so it isn't one long run of the same exercise. It survives a reload, and it
ends with a summary.

## PRD-07 Progress is visible on the globe
Home says what there is to study today and shows progress on the globe. The Progress pages color
each country, and then each region within it, by how far the learner has got, and let them drill
down.

## PRD-08 One globe, imagery only
Every screen shares one 3D globe of satellite imagery that stays mounted as the learner moves
between pages. Pages and exercises change what the globe shows (borders, highlights, progress)
and where it looks. The globe carries no labels; names appear only after an answer. Grading is
done against the app's own geometry, never against what the globe drew.

## PRD-09 Works on a phone and on a desktop
The layout works at phone width with touch: drag to rotate and pinch to zoom. Nothing scrolls
sideways. On a desktop the question column sits beside the globe; on a phone the globe sits above
the panel.

## PRD-10 Progress stays on the device, and is portable
There is no account and no backend. Progress is saved in the browser, and the learner can export
it to a file and import it again, here or on another device. Device settings stay out of the file.
The learner can reset all progress.

## PRD-11 The learner controls the pace
The learner sets how many new items a day the app introduces.

## PRD-12 maptap's place list, prepared offline
The places are maptap's own list, used with permission. A script fetches that list, matches it to
Natural Earth boundaries, assigns regions and writes the app's data files, which are committed,
so the site itself never contacts maptap. The script never runs maptap's code.

## PRD-13 Credits and licence terms are kept
The site credits MapTap.gg for the place list, Natural Earth for the boundaries, and EOX for the
Sentinel-2 imagery. The imagery licence is non-commercial, so the site stays non-commercial.

## PRD-14 A static site
The site is static files with no server of its own. It is deployed to GitHub Pages and works from
a sub-path, including on a reload of a deep link.

## PRD-15 The spec is enforced
This spec is the source of truth for behaviour. Every scenario and contract entry is checked by a
test (or says how it is checked), and every test traces to the spec, so the two cannot drift
apart unnoticed.

## PRD-16 Developers can see the globe and exercises in isolation
A development-only playground shows the globe's layer modes and each exercise type with sample
data, for checking changes by eye.
