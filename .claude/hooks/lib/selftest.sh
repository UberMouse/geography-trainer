# Sourced by the hook selftests: the pass/fail tally every table test keeps.

PASS=0
FAIL=0

selftest_pass() {
  PASS=$((PASS + 1))
}

# selftest_fail <printf format> [args...] -> one `FAIL  …` line
selftest_fail() {
  local fmt=$1
  shift
  FAIL=$((FAIL + 1))
  printf "FAIL  $fmt\n" "$@"
}

# Last command of a selftest: its exit status is the verdict.
selftest_summary() {
  printf '\n%s: %d passed, %d failed\n' "$(basename "$0")" "$PASS" "$FAIL"
  [[ "$FAIL" -eq 0 ]]
}

