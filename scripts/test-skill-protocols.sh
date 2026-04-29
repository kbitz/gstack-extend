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

SKILLS=(pair-review roadmap full-review review-apparatus test-plan)

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

# ─── verbatim graft blocks (shared across all 5 skills) ───────
# These fragments must appear byte-identical in every skill file. They represent
# the shared parts of cross-skill protocol grafts (Completion Status Protocol enum,
# Escalation opener, Escalation format, Confusion Protocol head). Per-skill
# customization lives OUTSIDE these fragments, not inside them. Updates to a
# shared fragment are a deliberate two-step: edit the expected block below,
# run tests (they fail), propagate the new text to all 5 skills.
#
# The <!-- SHARED:... --> HTML markers are part of each block — they're invisible
# to agents reading the prose but make the shared-ness legible to humans and set
# up the deferred SKILL.md.tmpl TODO for trivial extraction later.

read -r -d '' BLOCK_COMPLETION_STATUS_ENUM <<'BLOCK' || true
<!-- SHARED:completion-status-enum -->
## Completion Status Protocol

When completing a skill workflow, report status using one of:

- **DONE** — All steps completed successfully. Evidence provided for each claim.
- **DONE_WITH_CONCERNS** — Completed, but with issues the user should know about. List each concern.
- **BLOCKED** — Cannot proceed. State what is blocking and what was tried.
- **NEEDS_CONTEXT** — Missing information required to continue. State exactly what you need.
<!-- /SHARED:completion-status-enum -->
BLOCK

read -r -d '' BLOCK_ESCALATION_OPENER <<'BLOCK' || true
<!-- SHARED:escalation-opener -->
### Escalation

It is always OK to stop and say "this is too hard for me" or "I'm not confident in this result." Bad work is worse than no work. You will not be penalized for escalating.
<!-- /SHARED:escalation-opener -->
BLOCK

read -r -d '' BLOCK_ESCALATION_FORMAT <<'BLOCK' || true
<!-- SHARED:escalation-format -->
Escalation format:

```
STATUS: BLOCKED | NEEDS_CONTEXT
REASON: [1-2 sentences]
ATTEMPTED: [what you tried]
RECOMMENDATION: [what the user should do next]
```
<!-- /SHARED:escalation-format -->
BLOCK

read -r -d '' BLOCK_CONFUSION_HEAD <<'BLOCK' || true
<!-- SHARED:confusion-head -->
## Confusion Protocol

When you encounter high-stakes ambiguity during this workflow:
<!-- /SHARED:confusion-head -->
BLOCK

# Pairs of "var_name:label" for reporting. Var names reference the heredoc vars above.
VERBATIM_BLOCKS=(
  "BLOCK_COMPLETION_STATUS_ENUM:completion-status-enum"
  "BLOCK_ESCALATION_OPENER:escalation-opener"
  "BLOCK_ESCALATION_FORMAT:escalation-format"
  "BLOCK_CONFUSION_HEAD:confusion-head"
)

# ─── roadmap-only verbatim assertions (v0.18.0 reassessment redesign) ─
# These strings live in skills/roadmap.md only. They're load-bearing for
# skill behavior (fast-path output) and test fixtures (proposal artifact
# format). Drift here means dogfood fixtures stop matching.

read -r -d '' BLOCK_ROADMAP_FAST_PATH <<'BLOCK' || true
Plan looks current. No changes.
BLOCK

read -r -d '' BLOCK_ROADMAP_PROPOSAL_PATH <<'BLOCK' || true
.context/roadmap/proposal-
BLOCK

read -r -d '' BLOCK_ROADMAP_CLUSTER_STRUCTURAL <<'BLOCK' || true
Hold scope — fold into existing structure instead
BLOCK

ROADMAP_VERBATIM_BLOCKS=(
  "BLOCK_ROADMAP_FAST_PATH:fast-path-output"
  "BLOCK_ROADMAP_PROPOSAL_PATH:proposal-artifact-path"
  "BLOCK_ROADMAP_CLUSTER_STRUCTURAL:cluster-structural-hold-scope"
)

echo ""
echo "═══ verbatim graft blocks ═══"
for skill in "${SKILLS[@]}"; do
  file="$SCRIPT_DIR/skills/${skill}.md"
  [ -f "$file" ] || continue
  haystack=$(<"$file")
  for pair in "${VERBATIM_BLOCKS[@]}"; do
    var_name="${pair%%:*}"
    label="${pair##*:}"
    expected="${!var_name}"
    if [[ "$haystack" == *"$expected"* ]]; then
      pass "$skill contains verbatim block: $label"
    else
      fail "$skill missing verbatim block: $label" "drift or missing markers — propagate canonical text from scripts/test-skill-protocols.sh"
    fi
  done
done

echo ""
echo "═══ roadmap verbatim blocks ═══"
ROADMAP_FILE="$SCRIPT_DIR/skills/roadmap.md"
if [ -f "$ROADMAP_FILE" ]; then
  haystack=$(<"$ROADMAP_FILE")
  for pair in "${ROADMAP_VERBATIM_BLOCKS[@]}"; do
    var_name="${pair%%:*}"
    label="${pair##*:}"
    expected="${!var_name}"
    if [[ "$haystack" == *"$expected"* ]]; then
      pass "roadmap contains verbatim block: $label"
    else
      fail "roadmap missing verbatim block: $label" "drift in skills/roadmap.md — propagate canonical text from scripts/test-skill-protocols.sh"
    fi
  done
fi

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
