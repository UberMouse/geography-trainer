# Tooling (TLG)

The spec checker, `npm run spec:check`. Its rules are listed in `spec/README.md`.

### TLG-01 The checker reads the spec's tiers
Up: PRD-15

```gherkin
Scenario: entries are read from the three tiers
  Given spec/00-product.md, spec/features/*.md and spec/contracts/*.md
  When spec:check runs
  Then every heading that starts with an ID is an entry of its file's tier
    And each entry's Up: and Verified: lines and its gherkin block are read
    And spec/README.md and other files under spec/ are not read as entries
```

### TLG-02 The checker reads every test's title
Up: PRD-15

```gherkin
Scenario: tests are found with the describe titles around them
  Given the spec files under src/, scripts/ and e2e/
  When spec:check runs
  Then every Vitest and Playwright test is found with its describe titles
    And an ID in square brackets in any of those titles is cited by the test
    And hooks, test steps and in-body skips are not counted as tests
```

### TLG-03 The checker fails on broken tracing
Up: PRD-15

```gherkin
Scenario: a spec and tests that trace to each other pass
  Given every entry is linked up a tier and tested or marked Verified:
    And every test cites an ID that exists
  When spec:check runs
  Then it exits 0 and prints the counts

Scenario: broken tracing fails
  Given an untested entry, a test citing an unknown ID, an untagged test,
    a broken Up: link, a duplicate ID or an L1 entry without a scenario
  When spec:check runs
  Then it lists each problem with its file and line
    And it exits 1
```

### TLG-04 verify runs the checker first
Up: PRD-15

```gherkin
Scenario: verify stops on broken tracing
  Given spec:check fails
  When npm run verify runs
  Then it stops before the typecheck
```
