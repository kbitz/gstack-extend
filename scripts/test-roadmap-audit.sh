#!/usr/bin/env bash
#
# test-roadmap-audit.sh — Snapshot test suite for bin/roadmap-audit
#
# Each fixture in tests/roadmap-audit/ is a directory:
#
#   <name>/
#     files/        files copied into a fresh git repo before audit runs
#     args          (optional) extra args to roadmap-audit, word-split
#     expected.txt  canonical audit stdout (path-normalized to <TMPDIR>)
#
# The runner cp's `files/` into a tmpdir, runs `bin/roadmap-audit [args]`,
# normalizes the tmpdir path in the output, and diffs against `expected.txt`.
# Any drift fails the test with a unified diff.
#
# Updating snapshots:
#   UPDATE_SNAPSHOTS=1 ./scripts/test-roadmap-audit.sh
#
# Then `git diff tests/roadmap-audit/` shows exactly what audit behavior
# changed. Review the diff like any other code review.
#
# Usage:
#   ./scripts/test-roadmap-audit.sh [--verbose]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
FIXTURES_DIR="$SCRIPT_DIR/tests/roadmap-audit"
AUDIT="$SCRIPT_DIR/bin/roadmap-audit"
VERBOSE=false
PASSED=0
FAILED=0
TOTAL=0
TMPDIR_BASE=$(mktemp -d /tmp/gstack-test-audit-XXXXXXXX)

# Test isolation: empty state dir so user-level config can't leak in.
export GSTACK_EXTEND_STATE_DIR="$TMPDIR_BASE/state"
mkdir -p "$GSTACK_EXTEND_STATE_DIR"

if [ "${1:-}" = "--verbose" ]; then
  VERBOSE=true
fi

cleanup() { rm -rf "$TMPDIR_BASE"; }
trap cleanup EXIT

pass() { PASSED=$((PASSED + 1)); TOTAL=$((TOTAL + 1)); echo "  ✓ $1"; }
fail() {
  FAILED=$((FAILED + 1)); TOTAL=$((TOTAL + 1)); echo "  ✗ $1"
  [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/    /'
}

run_one_fixture() {
  local fixture="$1"
  local name
  name=$(basename "$fixture")
  local repo="$TMPDIR_BASE/$name"

  mkdir -p "$repo"
  if [ -d "$fixture/files" ]; then
    # cp -R with a trailing /. copies dotfiles too. The 2>/dev/null swallows
    # "no such file" if files/ is empty (intentional for the empty-repo case).
    cp -R "$fixture/files/." "$repo/" 2>/dev/null || true
  fi

  git -C "$repo" init --quiet
  git -C "$repo" config user.email test@test.com
  git -C "$repo" config user.name Test
  git -C "$repo" add -A 2>/dev/null || true
  git -C "$repo" commit -m init --quiet --allow-empty

  # Read optional extra args (word-split, no quoting support — keep args simple)
  local extra_args=()
  if [ -f "$fixture/args" ]; then
    # shellcheck disable=SC2207
    extra_args=( $(cat "$fixture/args") )
  fi

  # Run audit; capture stdout. stderr is discarded to match how the skill
  # consumes it. Path normalization replaces the tmpdir with a literal token
  # so snapshots stay stable across machines and runs.
  local actual
  actual=$(GSTACK_EXTEND_DIR="$SCRIPT_DIR" "$AUDIT" "${extra_args[@]}" "$repo" 2>/dev/null || true)
  actual=$(printf '%s\n' "$actual" | sed "s|$repo|<TMPDIR>|g")

  local expected_file="$fixture/expected.txt"

  if [ "${UPDATE_SNAPSHOTS:-0}" = "1" ]; then
    printf '%s\n' "$actual" > "$expected_file"
    echo "  ↻ $name (snapshot written)"
    PASSED=$((PASSED + 1)); TOTAL=$((TOTAL + 1))
    return
  fi

  if [ ! -f "$expected_file" ]; then
    fail "$name" "no expected.txt — run with UPDATE_SNAPSHOTS=1 to seed"
    return
  fi

  if diff -u "$expected_file" <(printf '%s\n' "$actual") > "$TMPDIR_BASE/diff.$$" 2>&1; then
    pass "$name"
  else
    fail "$name (run UPDATE_SNAPSHOTS=1 to accept)" "$(cat "$TMPDIR_BASE/diff.$$")"
  fi
  rm -f "$TMPDIR_BASE/diff.$$"
}

# ─── Run fixtures ─────────────────────────────────────────────

if [ ! -d "$FIXTURES_DIR" ]; then
  echo "No fixtures dir at $FIXTURES_DIR" >&2
  exit 2
fi

echo ""
echo "=== roadmap-audit snapshots ==="
for fixture in "$FIXTURES_DIR"/*/; do
  [ -d "$fixture" ] || continue
  run_one_fixture "$fixture"
done

# ─── Summary ──────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════"
echo "  Total: $TOTAL  Passed: $PASSED  Failed: $FAILED"
echo "═══════════════════════════════════════════════"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
