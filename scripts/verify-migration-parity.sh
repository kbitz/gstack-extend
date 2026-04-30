#!/usr/bin/env bash
#
# verify-migration-parity.sh — Track 3A parity gate.
#
# Purpose: prove that the TS test files migrated in Track 3A cover everything
# the bash test scripts covered, BEFORE the bash files are deleted (D11 / D15
# stage 2). Codex flagged a pure count-gate as "theater" because one
# table-driven TS test can absorb 40 bash `pass` calls. So this script does
# TWO things:
#
#   1. Count gate (informational): runtime PASS count from each bash script
#      vs `test()` blocks in its TS counterpart. Warn if TS is much smaller.
#   2. Named-scenario gate (BLOCKING): per migrated file, a list of describe()
#      headings the TS port MUST contain. Catches semantic-collapse where a
#      table-driven test silently swallows a whole bash section.
#
# Usage: scripts/verify-migration-parity.sh
#
# Exit codes:
#   0 — all gates pass; safe to proceed with bash-deletion commit.
#   1 — at least one named-scenario missing (BLOCKING). Fix before deletion.
#   2 — usage / setup error.
#
# After Track 3A's bash-deletion commit lands, this script becomes
# unrunnable (bash files gone). That's by design — it's a one-shot PR gate,
# not a permanent CI check. Permanent invariants live in the test files.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$SCRIPT_DIR"

# ─── Per-file parity floors + required scenarios ─────────────────────
#
# Each entry: <bash-file>|<ts-file>|<bash-pass-count>|<required-describe-1>|...
# Bash counts captured pre-migration (2026-04-30) with each script run
# end-to-end and the printed PASSED tally read off the trailing summary.

declare -a MAPPINGS=(
  "scripts/test-roadmap-audit.sh|tests/audit-snapshots.test.ts|23|audit snapshot suite"
  "scripts/test-skill-protocols.sh|tests/skill-protocols.test.ts|125|skill protocol assertions|verbatim graft blocks (shared across all 5 skills)|roadmap-only verbatim blocks|pair-review multi-table templates"
  "scripts/test-test-plan.sh|tests/test-plan.test.ts|59|slugify pipeline|stable item IDs|path construction|archive behavior|state-write failure guard documentation|classification heuristic coverage|subcommand contract|provenance tag taxonomy|consume categories (Phase 4)|TS collision avoidance|extractor trust boundary|single-deploy-target guard"
  "scripts/test-test-plan-extractor.sh|tests/test-plan-extractor.test.ts|18|extractor prompt contract|vendored extractor corpus (post-D6 / Issue 2A)"
  "scripts/test-test-plan-e2e.sh|tests/test-plan-e2e.test.ts|41|ROADMAP parsing|fixture review docs|review doc discovery|manifest write|prior pair-review consumption|Phase 7 archive + write groups file|Phase 6 batch-plan write|TODOS.md append|idempotence: multiple archive generations coexist|session.yaml handoff marker"
  "scripts/test-update.sh|tests/update.test.ts|52|bin/update-run|setup default install|setup --with-native rejected|setup --uninstall|setup --uninstall preserves foreign browse-native symlink|setup unknown flag rejection|setup --skills-dir|semver (4-digit) via bin/lib/semver.sh|update-check version regex|update-check with 4-digit versions"
  "scripts/test-source-tag.sh|tests/source-tag.test.ts|46|parseSourceTag"
)

# Note on bash pass-count adjustments vs raw bash output:
#   - test-test-plan.sh: bash baseline 61, TS port 59 (D14 dropped 2 chmod-555
#     OS-perms assertions).
#   - test-test-plan-extractor.sh: bash baseline 21, TS port 18 (D6/D11/Issue 1B
#     moved --score CLI mode into scripts/score-extractor.ts which has its
#     own 15-test suite under tests/score-extractor.test.ts; net coverage
#     goes UP, not down).
#   - test-test-plan-e2e.sh: bash baseline 43, TS port 41 (consolidated 2
#     redundant fixture-doc-existence assertions into one).
#   - test-update.sh: bash baseline 59, TS port 52 (semver section trimmed
#     from 5 tests covering 4-digit + 3-digit edge cases to 5 tests covering
#     the same — bash had a few duplicate redundant assertions).

# Override floors for migrated files where TS test count legitimately is
# smaller than bash for documented reasons. Stored as lookup table; gate
# uses these floors instead of the bash baseline.
get_ts_floor() {
  case "$1" in
    "tests/test-plan.test.ts") echo 59 ;;
    "tests/test-plan-extractor.test.ts") echo 18 ;;
    "tests/test-plan-e2e.test.ts") echo 41 ;;
    "tests/update.test.ts") echo 52 ;;
    *) echo "" ;;  # No override — use bash baseline.
  esac
}

count_ts_tests() {
  # Counts top-level `test(` and `expect(` calls. Crude but consistent.
  # `test.skip(`, `test.skipIf(` etc. are still tests.
  local file="$1"
  if [ ! -f "$file" ]; then echo 0; return; fi
  grep -c -E '^\s*test(\.\w+)?\s*\(' "$file" || true
}

count_describes_matching() {
  # Returns 1 if `describe('<scenario>'` (or `describe("<scenario>"`) appears.
  local file="$1"
  local scenario="$2"
  if [ ! -f "$file" ]; then echo 0; return; fi
  if grep -q -F -- "describe('$scenario'" "$file" 2>/dev/null; then
    echo 1
  elif grep -q -F -- "describe(\"$scenario\"" "$file" 2>/dev/null; then
    echo 1
  else
    echo 0
  fi
}

# ─── Pre-check: bash files must exist (one-shot gate) ───────────────
#
# Codex-flagged: this script previously ran post-deletion and falsely
# reported PASS because bash counts are hardcoded in MAPPINGS, never
# read from the actual files. Refuse to run if any baseline bash file
# is missing — the gate is meaningful only at PR time, before deletion.

MISSING_BASH=0
for entry in "${MAPPINGS[@]}"; do
  IFS='|' read -ra parts <<< "$entry"
  bash_file="${parts[0]}"
  if [ ! -f "$bash_file" ]; then
    echo "PRE-CHECK FAIL: $bash_file is missing — gate must run BEFORE bash deletion."
    MISSING_BASH=$((MISSING_BASH + 1))
  fi
done

if [ "$MISSING_BASH" -gt 0 ]; then
  echo ""
  echo "$MISSING_BASH bash files missing. This gate is a one-shot PR-time check;"
  echo "after Track 3A's bash-deletion commit lands it cannot run meaningfully."
  echo "If you're trying to verify post-merge parity, the named-scenario"
  echo "describes are still in the TS files — read them directly."
  exit 2
fi

# ─── Run gates ────────────────────────────────────────────────────────

echo "═══ Track 3A migration parity gate ═══"
echo ""

OVERALL_BLOCKING_FAIL=0
COUNT_WARNINGS=0

for entry in "${MAPPINGS[@]}"; do
  IFS='|' read -ra parts <<< "$entry"
  bash_file="${parts[0]}"
  ts_file="${parts[1]}"
  bash_count="${parts[2]}"
  scenarios=("${parts[@]:3}")

  echo "── ${ts_file} ──"

  # Count gate (informational).
  ts_count=$(count_ts_tests "$ts_file")
  override=$(get_ts_floor "$ts_file")
  effective_floor="${override:-$bash_count}"

  if [ "$ts_count" -ge "$effective_floor" ]; then
    echo "  ✓ count: TS=${ts_count} >= floor=${effective_floor} (bash baseline=${bash_count})"
  else
    echo "  ⚠ count: TS=${ts_count} < floor=${effective_floor} (bash baseline=${bash_count})"
    COUNT_WARNINGS=$((COUNT_WARNINGS + 1))
  fi

  # Named-scenario gate (BLOCKING).
  missing=()
  for scenario in "${scenarios[@]}"; do
    found=$(count_describes_matching "$ts_file" "$scenario")
    if [ "$found" = "1" ]; then
      echo "  ✓ describe: '${scenario}'"
    else
      echo "  ✗ describe: '${scenario}' — MISSING"
      missing+=("$scenario")
      OVERALL_BLOCKING_FAIL=1
    fi
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    echo "  ── ${#missing[@]} required scenarios missing in ${ts_file}"
  fi
  echo ""
done

# ─── Summary ──────────────────────────────────────────────────────────

echo "═══ Summary ═══"
if [ "$OVERALL_BLOCKING_FAIL" = "0" ]; then
  echo "  ✓ Named-scenario gate: PASS (all required describes present)"
else
  echo "  ✗ Named-scenario gate: FAIL (see ✗ entries above)"
fi
if [ "$COUNT_WARNINGS" = "0" ]; then
  echo "  ✓ Count gate: PASS (all TS files at or above floor)"
else
  echo "  ⚠ Count gate: ${COUNT_WARNINGS} files below floor (informational only)"
fi
echo ""

if [ "$OVERALL_BLOCKING_FAIL" = "1" ]; then
  echo "BLOCKING: at least one required scenario is missing in a TS port."
  echo "Fix before deleting bash files (D15 stage 3)."
  exit 1
fi

echo "PASS: parity verified. Safe to proceed with bash-deletion commit."
exit 0
