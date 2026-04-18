#!/usr/bin/env bash
#
# test-skill-protocols.sh — Assert every skill file has the shared protocol sections
# grafted in v0.11.0 and the REPORT table sections grafted in v0.12.0. Each skill
# must contain Completion Status Protocol (with the full 4-status enum), Escalation
# format, Confusion Protocol, and a GSTACK REVIEW REPORT section.
#
# Usage:
#   ./scripts/test-skill-protocols.sh [--verbose]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
VERBOSE=false
PASSED=0
FAILED=0
TOTAL=0

if [ "${1:-}" = "--verbose" ]; then
  VERBOSE=true
fi

log() {
  if $VERBOSE; then
    echo "  $*"
  fi
}

pass() {
  PASSED=$((PASSED + 1))
  TOTAL=$((TOTAL + 1))
  echo "  ✓ $1"
}

fail() {
  FAILED=$((FAILED + 1))
  TOTAL=$((TOTAL + 1))
  echo "  ✗ $1"
  if [ -n "${2:-}" ]; then
    echo "    $2"
  fi
}

# ─── skill protocol assertions ─────────────────────────────────

SKILLS=(pair-review roadmap full-review review-apparatus)

REQUIRED_SECTIONS=(
  "## Completion Status Protocol"
  "### Escalation"
  "## Confusion Protocol"
)

REQUIRED_STATUS_TOKENS=(
  "**DONE**"
  "**DONE_WITH_CONCERNS**"
  "**BLOCKED**"
  "**NEEDS_CONTEXT**"
)

REQUIRED_ESCALATION_FIELDS=(
  "STATUS: BLOCKED | NEEDS_CONTEXT"
  "REASON:"
  "ATTEMPTED:"
  "RECOMMENDATION:"
)

REQUIRED_REPORT_TOKENS=(
  "GSTACK REVIEW REPORT"
  "| Trigger |"
  "| Why |"
  "| Runs |"
  "| Status |"
  "| Findings |"
  "**VERDICT:**"
)

# First column header is "Review" for roadmap/full-review (single-row dashboard) and
# "Group" for pair-review (multi-row rollup across session groups). Either is fine.
REQUIRED_FIRST_COL_ANY=(
  "| Review |"
  "| Group |"
)

for skill in "${SKILLS[@]}"; do
  echo ""
  echo "═══ skills/${skill}.md ═══"
  file="$SCRIPT_DIR/skills/${skill}.md"

  if [ ! -f "$file" ]; then
    fail "Skill file exists" "Missing: $file"
    continue
  fi
  pass "Skill file exists"

  for section in "${REQUIRED_SECTIONS[@]}"; do
    if grep -qF "$section" "$file"; then
      pass "Contains section: $section"
    else
      fail "Missing section: $section" "in $file"
    fi
  done

  for token in "${REQUIRED_STATUS_TOKENS[@]}"; do
    if grep -qF "$token" "$file"; then
      pass "Contains status token: $token"
    else
      fail "Missing status token: $token" "in $file"
    fi
  done

  for field in "${REQUIRED_ESCALATION_FIELDS[@]}"; do
    if grep -qF "$field" "$file"; then
      pass "Contains escalation field: $field"
    else
      fail "Missing escalation field: $field" "in $file"
    fi
  done

  for token in "${REQUIRED_REPORT_TOKENS[@]}"; do
    if grep -qF "$token" "$file"; then
      pass "Contains REPORT token: $token"
    else
      fail "Missing REPORT token: $token" "in $file"
    fi
  done

  # First-column header: must contain at least one of REQUIRED_FIRST_COL_ANY.
  matched_first_col=""
  for token in "${REQUIRED_FIRST_COL_ANY[@]}"; do
    if grep -qF "$token" "$file"; then
      matched_first_col="$token"
      break
    fi
  done
  if [ -n "$matched_first_col" ]; then
    pass "Contains first-column header: $matched_first_col"
  else
    fail "Missing first-column header (expected one of '| Review |' or '| Group |')" "in $file"
  fi
done

# pair-review additionally must describe BOTH a per-group mini-table AND a session-done
# rollup, since its multi-group model is the reason the table renders more than once.
echo ""
echo "═══ pair-review multi-table ═══"
PR_FILE="$SCRIPT_DIR/skills/pair-review.md"
if grep -qF "GSTACK REVIEW REPORT — <group-name> group" "$PR_FILE"; then
  pass "pair-review contains per-group mini-table template"
else
  fail "pair-review missing per-group mini-table template"
fi
if grep -qF "GSTACK REVIEW REPORT — session rollup" "$PR_FILE"; then
  pass "pair-review contains session-done rollup template"
else
  fail "pair-review missing session-done rollup template"
fi

echo ""
echo "═══════════════════════════════════════"
echo "Results: $PASSED passed, $FAILED failed (of $TOTAL)"
echo "═══════════════════════════════════════"

exit $FAILED
