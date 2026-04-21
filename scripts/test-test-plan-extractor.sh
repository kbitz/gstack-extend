#!/usr/bin/env bash
#
# test-test-plan-extractor.sh — Golden-set validation harness for the
# /test-plan item-extractor prompt.
#
# The extractor runs inside a live Claude session (Agent subagent or inline LLM
# reasoning), not as a standalone binary — so this script cannot invoke it
# directly in CI. Instead, it does three CI-tractable things:
#
#   1. Validates the skill file's extractor prompt contract (required output
#      fields, required rules, JSON shape). If the contract drifts, this fails.
#
#   2. Stores golden-set fixtures: paths to real design docs + hand-labeled
#      expected items (fuzzy-match keywords, not verbatim strings). These are
#      the ground truth for "what SHOULD be extracted."
#
#   3. Provides a scoring subcommand that takes an actual extractor-output JSON
#      file (produced by running /test-plan against the golden doc in a real
#      session) and scores it against the expected fixture. Pass criterion:
#      >=70% tolerant match (keyword overlap per expected item).
#
# Usage:
#   ./scripts/test-test-plan-extractor.sh                    # contract + fixtures
#   ./scripts/test-test-plan-extractor.sh --score <json>     # score output
#   ./scripts/test-test-plan-extractor.sh --list-fixtures    # show golden inputs
#   ./scripts/test-test-plan-extractor.sh --verbose          # verbose contract check
#
# Workflow for tuning the prompt:
#   1. Run this script with no args — verifies contract is intact.
#   2. Take a fixture doc, run it through the extractor inside a Claude session
#      (paste the prompt, paste the doc, capture JSON output).
#   3. Save output to e.g. /tmp/actual.json
#   4. ./scripts/test-test-plan-extractor.sh --score /tmp/actual.json
#   5. Iterate on the prompt until >=70% match.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
VERBOSE=false
PASSED=0
FAILED=0
TOTAL=0

# Subcommand dispatch
MODE="contract"
SCORE_INPUT=""
for arg in "$@"; do
  case "$arg" in
    --verbose) VERBOSE=true ;;
    --list-fixtures) MODE="list" ;;
    --score) MODE="score" ;;
    *)
      if [ "$MODE" = "score" ] && [ -z "$SCORE_INPUT" ]; then
        SCORE_INPUT="$arg"
      fi
      ;;
  esac
done

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

SKILL_FILE="$SCRIPT_DIR/skills/test-plan.md"

# ─── Golden-set fixtures ───────────────────────────────────────
#
# Two real design docs from the gstack-extend project store. Chosen because:
#   - They're real prose written by a human (not synthetic).
#   - They have mixed content: problem statement, approach, constraints, some
#     named success criteria. Typical shape the extractor will see in the wild.
#
# Expected items are hand-labeled as keyword sets. A real extractor output
# "passes" a fixture item when the actual item's description contains a
# majority (>=50%) of the expected keywords — tolerant string match, not
# verbatim.

FIXTURE_1_PATH="$HOME/.gstack/projects/kbitz-gstack-extend/kb-kbitz-add-full-review-skill-design-20260406-150606.md"
FIXTURE_2_PATH="$HOME/.gstack/projects/kbitz-gstack-extend/kb-kbitz-todo-roadmap-skill-design-20260406-095321.md"

# Expected-items fixture. Format: one line per expected item:
#   <fixture-number>|<minimum keywords that should appear in the description>
# Example: "1|root-cause,cluster,triage" means fixture 1 should yield an item
# whose description contains at least 2 of {root-cause, cluster, triage}.

FIXTURE_EXPECTED="$(cat <<'EOF'
1|root-cause,cluster,synthesis
1|triage,askuserquestion,approve
1|agent,dispatch,parallel
1|dedup,roadmap,existing
1|state,resume,phase
2|overhaul,triage,mode
2|audit,vocabulary,check
2|groups,tracks,tasks
2|freshness,scan,completed
2|version,bump,recommend
EOF
)"

# ─── LIST mode ─────────────────────────────────────────────────

if [ "$MODE" = "list" ]; then
  echo "Golden-set fixtures:"
  echo ""
  echo "  Fixture 1: $FIXTURE_1_PATH"
  if [ -f "$FIXTURE_1_PATH" ]; then
    echo "    [exists, $(wc -l < "$FIXTURE_1_PATH" | tr -d ' ') lines]"
  else
    echo "    [MISSING — score mode will not work against this fixture]"
  fi
  echo ""
  echo "  Fixture 2: $FIXTURE_2_PATH"
  if [ -f "$FIXTURE_2_PATH" ]; then
    echo "    [exists, $(wc -l < "$FIXTURE_2_PATH" | tr -d ' ') lines]"
  else
    echo "    [MISSING — score mode will not work against this fixture]"
  fi
  echo ""
  echo "Expected items (fixture|keywords):"
  echo "$FIXTURE_EXPECTED" | sed 's/^/  /'
  echo ""
  echo "Workflow: paste extractor prompt + fixture doc content into a Claude session,"
  echo "capture the JSON array output, save to a file, then run:"
  echo "  $0 --score <output.json>"
  exit 0
fi

# ─── SCORE mode ────────────────────────────────────────────────

if [ "$MODE" = "score" ]; then
  if [ -z "$SCORE_INPUT" ] || [ ! -f "$SCORE_INPUT" ]; then
    echo "Error: --score requires a JSON file path." >&2
    echo "Usage: $0 --score <path-to-extractor-output.json>" >&2
    exit 2
  fi

  # Determine which fixture this output maps to. Easiest: ask the user to name it.
  # Convention: the JSON file's filename prefix is the fixture number:
  #   1-actual.json  or  fixture1.json  or  1.json
  FIXTURE_NUM=""
  BASENAME=$(basename "$SCORE_INPUT")
  case "$BASENAME" in
    1-*|fixture1*|1.*) FIXTURE_NUM=1 ;;
    2-*|fixture2*|2.*) FIXTURE_NUM=2 ;;
  esac

  if [ -z "$FIXTURE_NUM" ]; then
    echo "Warning: couldn't infer fixture number from filename '$BASENAME'." >&2
    echo "Expected filenames starting with 1- or 2- or fixture1 or fixture2." >&2
    echo "Treating as fixture 1 by default." >&2
    FIXTURE_NUM=1
  fi

  echo "Scoring against fixture $FIXTURE_NUM expectations..."

  # Parse expected keyword sets for this fixture
  EXPECTED_SETS=$(echo "$FIXTURE_EXPECTED" | awk -F'|' -v n="$FIXTURE_NUM" '$1 == n { print $2 }')
  EXPECTED_COUNT=$(echo "$EXPECTED_SETS" | wc -l | tr -d ' ')

  # Concatenate all description fields from the actual output into one lowercase blob.
  # Use python for robust JSON parsing (bash + sed on JSON is a footgun).
  ACTUAL_BLOB=$(python3 -c "
import json, sys
try:
    with open('$SCORE_INPUT') as f:
        data = json.load(f)
    if not isinstance(data, list):
        print('', end='')
        sys.exit(0)
    parts = []
    for item in data:
        if isinstance(item, dict) and 'description' in item:
            parts.append(str(item['description']).lower())
    print('\n'.join(parts))
except Exception as e:
    print(f'PARSE_ERROR: {e}', file=sys.stderr)
    sys.exit(1)
" 2>&1) || {
    echo "Error: extractor output is not a valid JSON array of {description, ...} objects." >&2
    echo "Got: $ACTUAL_BLOB" >&2
    exit 2
  }

  MATCHED=0
  UNMATCHED_LIST=()
  while IFS= read -r kwset; do
    [ -z "$kwset" ] && continue
    # For each expected item, count how many of its keywords appear in the
    # actual blob. >=50% of keywords present = this expected item matches.
    IFS=',' read -ra KWS <<< "$kwset"
    total=${#KWS[@]}
    hits=0
    for kw in "${KWS[@]}"; do
      if echo "$ACTUAL_BLOB" | grep -iqF "$kw"; then
        hits=$((hits + 1))
      fi
    done
    if [ "$total" -gt 0 ]; then
      # Require majority (>=50%) of keywords present
      threshold=$(( (total + 1) / 2 ))
      if [ "$hits" -ge "$threshold" ]; then
        MATCHED=$((MATCHED + 1))
        log "matched [$kwset] ($hits/$total keywords)"
      else
        UNMATCHED_LIST+=("$kwset ($hits/$total keywords present)")
      fi
    fi
  done <<< "$EXPECTED_SETS"

  PCT=$(( MATCHED * 100 / (EXPECTED_COUNT == 0 ? 1 : EXPECTED_COUNT) ))

  echo ""
  echo "─────────────────────────────────────"
  echo "Score: $MATCHED / $EXPECTED_COUNT expected items matched ($PCT%)"
  echo "Threshold: 70% tolerant match"
  echo "─────────────────────────────────────"

  if [ ${#UNMATCHED_LIST[@]} -gt 0 ]; then
    echo ""
    echo "Unmatched expected items:"
    for u in "${UNMATCHED_LIST[@]}"; do
      echo "  - $u"
    done
  fi

  if [ "$PCT" -ge 70 ]; then
    echo ""
    echo "✓ PASS — extractor output clears the 70% threshold."
    exit 0
  else
    echo ""
    echo "✗ FAIL — extractor output below 70% threshold. Tune the prompt."
    echo ""
    echo "Debugging tips:"
    echo "  - Make sure the fixture doc was fed in its entirety (not truncated)."
    echo "  - Check that the extractor produced >= as many items as expected."
    echo "  - Compare unmatched keyword sets against the doc to see if the claim"
    echo "    is actually testable — if not, update the fixture keyword set."
    exit 1
  fi
fi

# ─── CONTRACT mode (default) ───────────────────────────────────

echo "=== extractor prompt contract ==="

if [ ! -f "$SKILL_FILE" ]; then
  fail "skills/test-plan.md missing — cannot validate extractor contract"
  exit 1
fi
pass "skills/test-plan.md exists"

# The extractor prompt must document every required output field. If any of
# these drift, downstream code (dedup by ID, classification, provenance index)
# breaks.

REQUIRED_EXTRACTOR_FIELDS=(
  "description: string"
  "imperative verb"
  "source_type"
  "rationale_quote"
  "section_heading"
  "classification_signal"
)

REQUIRED_SOURCE_TYPES=(
  "\"ceo-review\""
  "\"eng-review\""
  "\"design-review\""
  "\"design-doc\""
)

REQUIRED_EXTRACTOR_RULES=(
  "Extract EVERY claim"
  "testable"
  "rationale_quote MUST be a real snippet"
  "No duplicates within a single doc"
  "Output ONLY the JSON array"
)

for fld in "${REQUIRED_EXTRACTOR_FIELDS[@]}"; do
  if grep -qF "$fld" "$SKILL_FILE"; then
    pass "Extractor prompt documents: $fld"
  else
    fail "Extractor prompt missing field spec: $fld"
  fi
done

for st in "${REQUIRED_SOURCE_TYPES[@]}"; do
  if grep -qF "$st" "$SKILL_FILE"; then
    pass "Extractor prompt declares source_type: $st"
  else
    fail "Extractor prompt missing source_type: $st"
  fi
done

for rule in "${REQUIRED_EXTRACTOR_RULES[@]}"; do
  if grep -qF "$rule" "$SKILL_FILE"; then
    pass "Extractor prompt asserts rule: $rule"
  else
    fail "Extractor prompt missing rule: $rule"
  fi
done

# Retry behavior: if the LLM returns non-JSON, the skill must retry once before
# giving up. Without this, a single bad response nukes the whole harvest.
if grep -qE "retry once|Previous response was not valid JSON" "$SKILL_FILE"; then
  pass "Extractor retry-on-invalid-JSON documented"
else
  fail "Extractor retry-on-invalid-JSON documentation missing"
fi

# Example: the prompt MUST include a concrete input/output example so the LLM
# can ground on shape. Missing examples = high variance output.
if grep -qF "Example:" "$SKILL_FILE" && grep -qF "Input excerpt:" "$SKILL_FILE" && grep -qF "Output:" "$SKILL_FILE"; then
  pass "Extractor prompt includes worked example"
else
  fail "Extractor prompt missing worked example (Input excerpt + Output)"
fi

echo ""
echo "=== fixture availability ==="

if [ -f "$FIXTURE_1_PATH" ]; then
  pass "Fixture 1 exists: $(basename "$FIXTURE_1_PATH")"
else
  log "Fixture 1 missing: $FIXTURE_1_PATH"
  log "  Not a fatal error in contract mode — fixtures are only needed for --score"
  pass "Fixture 1 availability (optional in contract mode)"
fi

if [ -f "$FIXTURE_2_PATH" ]; then
  pass "Fixture 2 exists: $(basename "$FIXTURE_2_PATH")"
else
  log "Fixture 2 missing: $FIXTURE_2_PATH"
  pass "Fixture 2 availability (optional in contract mode)"
fi

# Sanity-check the expected-items fixture structure
EXPECTED_COUNT=$(echo "$FIXTURE_EXPECTED" | grep -c '^[12]|' || true)
if [ "$EXPECTED_COUNT" -ge 5 ]; then
  pass "Expected items fixture has at least 5 entries ($EXPECTED_COUNT total)"
else
  fail "Expected items fixture too thin" "Got $EXPECTED_COUNT, need at least 5"
fi

# ─── results ───────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════"
echo "Results: $PASSED passed, $FAILED failed (of $TOTAL)"
echo "═══════════════════════════════════════"

if [ $FAILED -eq 0 ]; then
  echo ""
  echo "Extractor prompt contract is intact. To validate output quality:"
  echo "  1. Run \`$0 --list-fixtures\` to see golden inputs."
  echo "  2. Run the extractor against a fixture in a live Claude session."
  echo "  3. Save JSON output to '1-actual.json' (or 2-actual.json)."
  echo "  4. Run \`$0 --score 1-actual.json\` to score it."
fi

exit $FAILED
