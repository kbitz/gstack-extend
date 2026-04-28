#!/usr/bin/env bash
#
# test-roadmap-audit.sh — Test suite for bin/roadmap-audit
#
# Tests all 8 audit checks with fixture repos.
#
# Usage:
#   ./scripts/test-roadmap-audit.sh [--verbose]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
VERBOSE=false
PASSED=0
FAILED=0
TOTAL=0
TMPDIR_BASE=$(mktemp -d /tmp/gstack-test-audit-XXXXXXXX)

# Test isolation: point bin/config at an empty state dir so user-level
# overrides (~/.gstack-extend/config) cannot leak into fixtures and
# affect cap-default assertions like "max_loc_per_track=300".
export GSTACK_EXTEND_STATE_DIR="$TMPDIR_BASE/state"
mkdir -p "$GSTACK_EXTEND_STATE_DIR"

if [ "${1:-}" = "--verbose" ]; then
  VERBOSE=true
fi

cleanup() {
  rm -rf "$TMPDIR_BASE"
}
trap cleanup EXIT

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

# Create a minimal git repo fixture with TODOS.md, PROGRESS.md, VERSION
create_fixture() {
  local name="$1"
  local dir="$TMPDIR_BASE/$name"
  mkdir -p "$dir"
  git -C "$dir" init --quiet
  git -C "$dir" config user.email "test@test.com"
  git -C "$dir" config user.name "Test"
  echo "0.1.0" > "$dir/VERSION"
  echo "placeholder" > "$dir/dummy.txt"
  git -C "$dir" add -A
  git -C "$dir" commit -m "init" --quiet
  echo "$dir"
}

run_audit() {
  local dir="$1"
  GSTACK_EXTEND_DIR="$SCRIPT_DIR" "$SCRIPT_DIR/bin/roadmap-audit" "$dir" 2>/dev/null || true
}

# Extract STATUS line from a named section of audit output
# Usage: section_status "$OUTPUT" "SECTION_NAME"
section_status() {
  local output="$1"
  local section="$2"
  echo "$output" | sed -n "/^## ${section}$/,/^## /p" | grep "STATUS:" | head -1 || echo "STATUS: not_found"
}

# ─── find_doc tests ───────────────────────────────────────────

echo "=== find_doc ==="

# ROADMAP.md in root
DIR=$(create_fixture "find-root")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap
## Group 1: Test
### Track 1A: Test
_1 task . ~1 day . low risk . test.txt_
- **Test task** — test. _test.txt._ (S)
EOF
echo "# TODOs" > "$DIR/TODOS.md"
cat > "$DIR/PROGRESS.md" << 'EOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "STATUS: pass"; then
  pass "ROADMAP.md found in root"
else
  fail "ROADMAP.md found in root" "Expected pass status"
fi

# ROADMAP.md in docs/
DIR=$(create_fixture "find-docs")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap
## Group 1: Test
### Track 1A: Test
_1 task . ~1 day . low risk . test.txt_
- **Test task** — test. _test.txt._ (S)
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'EOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "VOCAB_LINT" && ! echo "$OUTPUT" | grep -q "No ROADMAP.md found"; then
  pass "ROADMAP.md found in docs/"
else
  fail "ROADMAP.md found in docs/"
fi

# ROADMAP.md in both root and docs/
DIR=$(create_fixture "find-both")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap
EOF
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "ROADMAP.md exists in both root and docs/"; then
  pass "ROADMAP.md in both locations flagged"
else
  fail "ROADMAP.md in both locations flagged"
fi

# ROADMAP.md missing
DIR=$(create_fixture "find-missing")
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "No ROADMAP.md found"; then
  pass "Missing ROADMAP.md handled gracefully"
else
  fail "Missing ROADMAP.md handled gracefully"
fi

# ─── vocab_lint tests ─────────────────────────────────────────

echo ""
echo "=== vocab_lint ==="

# Clean file
DIR=$(create_fixture "vocab-clean")
cat > "$DIR/ROADMAP.md" << 'EOF'
# TODOs
## Group 1: Refactors
### Track 1A: Code DRY
_1 task . ~1 day . low risk . test.txt_
- **Extract helper** — do it. _test.txt._ (S)
EOF
OUTPUT=$(run_audit "$DIR")
VOCAB_STATUS=$(section_status "$OUTPUT" "VOCAB_LINT")
if echo "$VOCAB_STATUS" | grep -q "pass"; then
  pass "Clean file passes vocab lint"
else
  fail "Clean file passes vocab lint" "$VOCAB_STATUS"
fi

# Phase as Group synonym heading (banned — not a whitelisted pattern)
DIR=$(create_fixture "vocab-phase-heading")
cat > "$DIR/ROADMAP.md" << 'EOF'
# TODOs
## Phase 1: Something
- Do a thing
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q 'banned term "phase"'; then
  pass "Detects Phase used as Group synonym heading"
else
  fail "Detects Phase used as Group synonym heading"
fi

# Phase in ROADMAP.md title (allowed — whitelisted pattern)
DIR=$(create_fixture "vocab-phase-title")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1 (v0.x)

## Group 1: Test
### Track 1A: First
_1 task . ~1 day . low risk . a.txt_
- **Do A** — test. (S)
EOF
OUTPUT=$(run_audit "$DIR")
VOCAB_STATUS=$(section_status "$OUTPUT" "VOCAB_LINT")
if echo "$VOCAB_STATUS" | grep -q "pass"; then
  pass "Phase in title is allowed"
else
  fail "Phase in title is allowed" "$VOCAB_STATUS"
fi

# Phase inside Future section (allowed)
DIR=$(create_fixture "vocab-phase-future")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1 (v0.x)

## Future (Phase 2+)

Phase 2 items go here. This mentions phase freely.
- **Some item** — deferred to Phase 3.
EOF
OUTPUT=$(run_audit "$DIR")
VOCAB_STATUS=$(section_status "$OUTPUT" "VOCAB_LINT")
if echo "$VOCAB_STATUS" | grep -q "pass"; then
  pass "Phase inside Future section is allowed"
else
  fail "Phase inside Future section is allowed" "$VOCAB_STATUS"
fi

# Phase inside Group body (banned)
DIR=$(create_fixture "vocab-phase-group-body")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1 (v0.x)

## Group 1: Test
This is the phase 1 work.
### Track 1A: First
_1 task . ~1 day . low risk . a.txt_
- **Do A** — test. (S)
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q 'banned term "phase"'; then
  pass "Phase inside Group body is banned"
else
  fail "Phase inside Group body is banned"
fi

# Phase inside Track body (banned)
DIR=$(create_fixture "vocab-phase-track-body")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1 (v0.x)

## Group 1: Test
### Track 1A: First
_1 task . ~1 day . low risk . a.txt_
- **Do A** — this is a phase 2 task. (S)
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q 'banned term "phase"'; then
  pass "Phase inside Track body is banned"
else
  fail "Phase inside Track body is banned"
fi

# Other banned terms still work with state machine
DIR=$(create_fixture "vocab-case")
cat > "$DIR/ROADMAP.md" << 'EOF'
# TODOs
## WORKSTREAM alpha
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q 'banned term "workstream"'; then
  pass "Case-insensitive detection (workstream)"
else
  fail "Case-insensitive detection (workstream)"
fi

# Other banned terms in Future section (still banned — only Phase is exempted)
DIR=$(create_fixture "vocab-banned-in-future")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Future (Phase 2+)

- This milestone is deferred.
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q 'banned term "milestone"'; then
  pass "Other banned terms still caught in Future section"
else
  fail "Other banned terms still caught in Future section"
fi

# Strikethrough lines still skipped with state machine
DIR=$(create_fixture "vocab-strikethrough")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: Test
### Track 1A: First
_1 task . ~1 day . low risk . a.txt_
- ~~This phase item is done~~ (completed)
EOF
OUTPUT=$(run_audit "$DIR")
VOCAB_STATUS=$(section_status "$OUTPUT" "VOCAB_LINT")
if echo "$VOCAB_STATUS" | grep -q "pass"; then
  pass "Strikethrough lines with Phase are skipped"
else
  fail "Strikethrough lines with Phase are skipped" "$VOCAB_STATUS"
fi

# ─── structure tests ──────────────────────────────────────────

echo ""
echo "=== structure ==="

# Valid structure
DIR=$(create_fixture "struct-valid")
cat > "$DIR/ROADMAP.md" << 'EOF'
# TODOs
## Group 1: Refactors
### Track 1A: Code DRY
_3 tasks . ~2 days . medium risk . sync.ts_
- **Extract helper** — do it. (S)
### Track 1B: Tests
_1 task . ~1 day . low risk . test/_
- **Add tests** — coverage. (S)
EOF
OUTPUT=$(run_audit "$DIR")
STRUCT_STATUS=$(section_status "$OUTPUT" "STRUCTURE")
if echo "$STRUCT_STATUS" | grep -q "pass"; then
  pass "Valid Groups > Tracks > Tasks structure"
else
  fail "Valid Groups > Tracks > Tasks structure" "$STRUCT_STATUS"
fi

# Flat list
DIR=$(create_fixture "struct-flat")
cat > "$DIR/ROADMAP.md" << 'EOF'
# TODOs
### Some item
- Do thing 1
- Do thing 2
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "No Group headings found"; then
  pass "Flat list detected (no Groups)"
else
  fail "Flat list detected (no Groups)"
fi

# Missing track metadata
DIR=$(create_fixture "struct-nometa")
cat > "$DIR/ROADMAP.md" << 'EOF'
# TODOs
## Group 1: Test
### Track 1A: No Metadata
- **Task** — do it. (S)
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "missing metadata line"; then
  pass "Missing track metadata detected"
else
  fail "Missing track metadata detected"
fi

# Future-only roadmap (valid structure)
DIR=$(create_fixture "struct-future-only")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1 (v0.x)

## Future (Phase 2+)

- **Deferred item** — not yet. _Deferred because: not needed now._
EOF
OUTPUT=$(run_audit "$DIR")
STRUCT_STATUS=$(section_status "$OUTPUT" "STRUCTURE")
if echo "$STRUCT_STATUS" | grep -q "pass"; then
  pass "Future-only roadmap is valid structure"
else
  fail "Future-only roadmap is valid structure" "$STRUCT_STATUS"
fi

# Groups + Future section (valid structure)
DIR=$(create_fixture "struct-groups-future")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1 (v0.x)

## Group 1: Test
### Track 1A: First
_1 task . ~1 day . low risk . a.txt_
- **Do A** — test. (S)

## Future (Phase 2+)

- **Deferred item** — not yet.
EOF
OUTPUT=$(run_audit "$DIR")
STRUCT_STATUS=$(section_status "$OUTPUT" "STRUCTURE")
if echo "$STRUCT_STATUS" | grep -q "pass"; then
  pass "Groups + Future section is valid structure"
else
  fail "Groups + Future section is valid structure" "$STRUCT_STATUS"
fi

# ─── staleness tests ─────────────────────────────────────────

echo ""
echo "=== staleness ==="

# Strikethrough + DONE + version shipped (via VERSION comparison)
DIR=$(create_fixture "stale-shipped")
echo "0.5.0" > "$DIR/VERSION"
cat > "$DIR/ROADMAP.md" << 'EOF'
# TODOs
### ~~Old feature~~ ✓ DONE (v0.3.0)
### Active feature
- Do the thing
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "completed item still present (v0.3.0 shipped)"; then
  pass "Stale item detected via VERSION comparison"
else
  fail "Stale item detected via VERSION comparison"
fi

# Strikethrough but version NOT shipped
DIR=$(create_fixture "stale-notshipped")
echo "0.2.0" > "$DIR/VERSION"
cat > "$DIR/ROADMAP.md" << 'EOF'
# TODOs
### ~~Future feature~~ DONE (v0.5.0)
EOF
OUTPUT=$(run_audit "$DIR")
STALE_STATUS=$(section_status "$OUTPUT" "STALENESS")
if echo "$STALE_STATUS" | grep -q "pass"; then
  pass "Unshipped version not flagged as stale"
else
  fail "Unshipped version not flagged as stale" "$STALE_STATUS"
fi

# Checkmark emoji variant
DIR=$(create_fixture "stale-emoji")
echo "1.0.0" > "$DIR/VERSION"
cat > "$DIR/ROADMAP.md" << 'EOF'
# TODOs
### ~~Done thing~~ ✅ Done (v0.2.0)
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "completed item still present"; then
  pass "Checkmark emoji variant detected"
else
  fail "Checkmark emoji variant detected"
fi

# ─── version tests ────────────────────────────────────────────

echo ""
echo "=== version ==="

# All in sync (with tag)
DIR=$(create_fixture "ver-sync")
echo "# TODOs" > "$DIR/TODOS.md"
echo "# Roadmap" > "$DIR/ROADMAP.md"
echo "# Progress" > "$DIR/PROGRESS.md"
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
git -C "$DIR" tag v0.1.0
OUTPUT=$(run_audit "$DIR")
VER_STATUS=$(section_status "$OUTPUT" "VERSION")
if echo "$VER_STATUS" | grep -q "pass"; then
  pass "Version in sync with tag"
else
  fail "Version in sync with tag" "$VER_STATUS"
fi

# VERSION != latest tag
DIR=$(create_fixture "ver-mismatch")
echo "# TODOs" > "$DIR/TODOS.md"
echo "0.2.0" > "$DIR/VERSION"
git -C "$DIR" add -A
git -C "$DIR" commit -m "bump" --quiet
git -C "$DIR" tag v0.1.0 HEAD~1
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "does not match latest tag"; then
  pass "VERSION/tag mismatch detected"
else
  fail "VERSION/tag mismatch detected"
fi

# Four-segment version in CHANGELOG accepted
DIR=$(create_fixture "ver-fourseg")
echo "# TODOs" > "$DIR/TODOS.md"
echo "0.4.0" > "$DIR/VERSION"
cat > "$DIR/CHANGELOG.md" << 'EOF'
## [0.4.1.1] - 2026-01-01
- Fixed thing
## [0.4.0] - 2026-01-01
- Added thing
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "CHANGELOG_LATEST: 0.4.1.1"; then
  pass "Four-segment version in CHANGELOG accepted"
else
  fail "Four-segment version in CHANGELOG accepted"
fi

# No git tags
DIR=$(create_fixture "ver-notags")
echo "# TODOs" > "$DIR/TODOS.md"
echo "0.1.0" > "$DIR/VERSION"
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "No git tags found"; then
  pass "Missing tags flagged"
else
  fail "Missing tags flagged"
fi

# PROGRESS_LATEST picks highest version regardless of table order (oldest-first)
DIR=$(create_fixture "ver-progress-oldest-first")
echo "# TODOs" > "$DIR/TODOS.md"
echo "0.4.11" > "$DIR/VERSION"
cat > "$DIR/PROGRESS.md" << 'EOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
| 0.2.0 | 2026-01-15 | Feature |
| 0.4.11 | 2026-03-01 | Latest |
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "PROGRESS_LATEST: 0.4.11"; then
  pass "PROGRESS_LATEST picks highest version (oldest-first table)"
else
  fail "PROGRESS_LATEST picks highest version (oldest-first table)" "$(echo "$OUTPUT" | grep PROGRESS_LATEST)"
fi

# PROGRESS_LATEST picks highest version (newest-first table)
DIR=$(create_fixture "ver-progress-newest-first")
echo "# TODOs" > "$DIR/TODOS.md"
echo "0.8.4" > "$DIR/VERSION"
cat > "$DIR/PROGRESS.md" << 'EOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.8.4 | 2026-04-07 | Latest |
| 0.7.0 | 2026-04-06 | Older |
| 0.1.0 | 2026-03-24 | Init |
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "PROGRESS_LATEST: 0.8.4"; then
  pass "PROGRESS_LATEST picks highest version (newest-first table)"
else
  fail "PROGRESS_LATEST picks highest version (newest-first table)" "$(echo "$OUTPUT" | grep PROGRESS_LATEST)"
fi

# PROGRESS_LATEST includes four-segment versions
DIR=$(create_fixture "ver-progress-four-seg")
echo "# TODOs" > "$DIR/TODOS.md"
echo "0.8.4.1" > "$DIR/VERSION"
cat > "$DIR/PROGRESS.md" << 'EOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.8.4 | 2026-04-07 | Three-seg |
| 0.8.4.1 | 2026-04-08 | Four-seg micro |
| 0.7.0 | 2026-04-06 | Older |
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "PROGRESS_LATEST: 0.8.4.1"; then
  pass "PROGRESS_LATEST includes four-segment versions"
else
  fail "PROGRESS_LATEST includes four-segment versions" "$(echo "$OUTPUT" | grep PROGRESS_LATEST)"
fi

# ─── taxonomy tests ───────────────────────────────────────────

echo ""
echo "=== taxonomy ==="

# All docs present
DIR=$(create_fixture "tax-complete")
echo "# TODOs" > "$DIR/TODOS.md"
echo "# Roadmap" > "$DIR/ROADMAP.md"
cat > "$DIR/PROGRESS.md" << 'EOF'
# Progress
EOF
OUTPUT=$(run_audit "$DIR")
TAX_STATUS=$(section_status "$OUTPUT" "TAXONOMY")
if echo "$TAX_STATUS" | grep -q "pass"; then
  pass "All docs present passes taxonomy"
else
  fail "All docs present passes taxonomy" "$TAX_STATUS"
fi

# Missing PROGRESS.md
DIR=$(create_fixture "tax-noprogress")
echo "# TODOs" > "$DIR/TODOS.md"
echo "# Roadmap" > "$DIR/ROADMAP.md"
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "PROGRESS.md: missing"; then
  pass "Missing PROGRESS.md detected"
else
  fail "Missing PROGRESS.md detected"
fi

# ─── doc location tests ──────────────────────────────────────

echo ""
echo "=== doc_location ==="

# Docs in correct locations (TODOS in docs/, README in root)
DIR=$(create_fixture "loc-correct")
mkdir -p "$DIR/docs"
echo "# TODOs" > "$DIR/docs/TODOS.md"
echo "# README" > "$DIR/README.md"
echo "# Progress" > "$DIR/docs/PROGRESS.md"
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
LOC_STATUS=$(section_status "$OUTPUT" "DOC_LOCATION")
if echo "$LOC_STATUS" | grep -q "pass"; then
  pass "Correct doc locations passes"
else
  fail "Correct doc locations passes" "$LOC_STATUS"
fi

# TODOS.md in root with docs/ existing
DIR=$(create_fixture "loc-todos-root")
mkdir -p "$DIR/docs"
echo "# TODOs" > "$DIR/TODOS.md"
echo "# Progress" > "$DIR/docs/PROGRESS.md"
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "TODOS.md is in root.*should be in docs/"; then
  pass "TODOS.md in root with docs/ flagged"
else
  fail "TODOS.md in root with docs/ flagged"
fi

# PROGRESS.md in root with docs/ existing
DIR=$(create_fixture "loc-progress-root")
mkdir -p "$DIR/docs"
echo "# Progress" > "$DIR/PROGRESS.md"
echo "# TODOs" > "$DIR/docs/TODOS.md"
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "PROGRESS.md is in root.*should be in docs/"; then
  pass "PROGRESS.md in root with docs/ flagged"
else
  fail "PROGRESS.md in root with docs/ flagged"
fi

# TODOS.md in root, no docs/ directory
DIR=$(create_fixture "loc-no-docs-dir")
echo "# TODOs" > "$DIR/TODOS.md"
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "TODOS.md is in root.*consider creating docs/"; then
  pass "TODOS.md in root without docs/ suggests creating it"
else
  fail "TODOS.md in root without docs/ suggests creating it"
fi

# README.md only in docs/ (wrong direction)
DIR=$(create_fixture "loc-readme-wrong")
mkdir -p "$DIR/docs"
echo "# README" > "$DIR/docs/README.md"
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "README.md is in docs/.*should be in root"; then
  pass "README.md in docs/ flagged as wrong direction"
else
  fail "README.md in docs/ flagged as wrong direction"
fi

# No misplaced docs at all (empty repo)
DIR=$(create_fixture "loc-empty")
OUTPUT=$(run_audit "$DIR")
LOC_STATUS=$(section_status "$OUTPUT" "DOC_LOCATION")
if echo "$LOC_STATUS" | grep -q "pass"; then
  pass "No docs at all passes location check"
else
  fail "No docs at all passes location check" "$LOC_STATUS"
fi

# ─── archive candidate tests ────────────────────────────────

echo ""
echo "=== archive_candidates ==="

# No docs/designs/ directory
DIR=$(create_fixture "arch-no-designs")
echo "# TODOs" > "$DIR/TODOS.md"
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
ARCH_STATUS=$(section_status "$OUTPUT" "ARCHIVE_CANDIDATES")
if echo "$ARCH_STATUS" | grep -q "pass"; then
  pass "No docs/designs/ passes archive check"
else
  fail "No docs/designs/ passes archive check" "$ARCH_STATUS"
fi

# Design doc referencing shipped version
DIR=$(create_fixture "arch-shipped")
echo "0.5.0" > "$DIR/VERSION"
mkdir -p "$DIR/docs/designs"
cat > "$DIR/docs/designs/old-feature.md" << 'EOF'
# Old Feature Design
Shipped in v0.3.0
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "old-feature.md.*candidate for archiving"; then
  pass "Shipped design doc flagged as archive candidate"
else
  fail "Shipped design doc flagged as archive candidate"
fi

# Design doc referencing future version
DIR=$(create_fixture "arch-future")
echo "0.5.0" > "$DIR/VERSION"
mkdir -p "$DIR/docs/designs"
cat > "$DIR/docs/designs/future-feature.md" << 'EOF'
# Future Feature Design
Planned for v1.0.0
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
ARCH_STATUS=$(section_status "$OUTPUT" "ARCHIVE_CANDIDATES")
if echo "$ARCH_STATUS" | grep -q "pass"; then
  pass "Future design doc not flagged"
else
  fail "Future design doc not flagged" "$ARCH_STATUS"
fi

# Design doc with no version reference
DIR=$(create_fixture "arch-no-ver")
echo "0.5.0" > "$DIR/VERSION"
mkdir -p "$DIR/docs/designs"
cat > "$DIR/docs/designs/vague.md" << 'EOF'
# Some Design
No version mentioned here.
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
ARCH_STATUS=$(section_status "$OUTPUT" "ARCHIVE_CANDIDATES")
if echo "$ARCH_STATUS" | grep -q "pass"; then
  pass "Design doc without version reference not flagged"
else
  fail "Design doc without version reference not flagged" "$ARCH_STATUS"
fi

# ─── updated taxonomy duplicate message test ─────────────────

echo ""
echo "=== taxonomy_updated_messages ==="

# Duplicate TODOS.md should recommend docs/
DIR=$(create_fixture "tax-dup-opinionated")
echo "# TODOs" > "$DIR/TODOS.md"
mkdir -p "$DIR/docs"
echo "# TODOs" > "$DIR/docs/TODOS.md"
echo "# Roadmap" > "$DIR/ROADMAP.md"
echo "# Progress" > "$DIR/PROGRESS.md"
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "TODOS.md exists in both.*should be in docs/ only"; then
  pass "Duplicate TODOS.md recommends docs/"
else
  fail "Duplicate TODOS.md recommends docs/"
fi

# ─── dependency tests ─────────────────────────────────────────

echo ""
echo "=== dependencies ==="

# Valid Depends on: with real track
DIR=$(create_fixture "dep-valid")
cat > "$DIR/ROADMAP.md" << 'EOF'
# TODOs
## Group 1: Test
### Track 1A: First
_1 task . ~1 day . low risk . a.txt_
- **Do A** — first. (S)
### Track 1B: Second
_1 task . ~1 day . low risk . b.txt_
Depends on: Track 1A
- **Do B** — second. (S)
EOF
OUTPUT=$(run_audit "$DIR")
DEP_STATUS=$(section_status "$OUTPUT" "DEPENDENCIES")
if echo "$DEP_STATUS" | grep -q "pass"; then
  pass "Valid track dependency passes"
else
  fail "Valid track dependency passes" "$DEP_STATUS"
fi

# Reference to nonexistent track
DIR=$(create_fixture "dep-broken")
cat > "$DIR/ROADMAP.md" << 'EOF'
# TODOs
## Group 1: Test
### Track 1A: First
_1 task . ~1 day . low risk . a.txt_
Depends on: Track 9Z
- **Do A** — first. (S)
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "no such track exists"; then
  pass "Nonexistent track dependency flagged"
else
  fail "Nonexistent track dependency flagged"
fi

# No Depends on: lines (should skip)
DIR=$(create_fixture "dep-none")
cat > "$DIR/ROADMAP.md" << 'EOF'
# TODOs
## Group 1: Test
### Track 1A: First
_1 task . ~1 day . low risk . a.txt_
- **Do A** — first. (S)
EOF
OUTPUT=$(run_audit "$DIR")
DEP_STATUS=$(section_status "$OUTPUT" "DEPENDENCIES")
if echo "$DEP_STATUS" | grep -q "skip"; then
  pass "No dependencies outputs STATUS: skip"
else
  fail "No dependencies outputs STATUS: skip" "$DEP_STATUS"
fi

# ─── unprocessed tests ────────────────────────────────────────

echo ""
echo "=== unprocessed ==="

# Unprocessed section with items (lives in TODOS.md, the inbox)
# Rich format per docs/source-tag-contract.md (v0.15.1+).
DIR=$(create_fixture "unproc-items")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed

### [pair-review:group=2,item=3] Arrow key double-move on child messages
- **Why:** selection skips a row intermittently.
- **Effort:** S

### [pair-review:group=2,item=5] NSNull crash in batch response parsing
- **Why:** crash on non-standard JSON payloads.
- **Effort:** M

### [manual] Add Cmd+Arrow page navigation
- **Why:** power users expect this shortcut.
- **Effort:** S
EOF
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap
## Group 1: Test
### Track 1A: First
_1 task . ~1 day . low risk . a.txt_
- **Do A** — first. (S)
EOF
OUTPUT=$(run_audit "$DIR")
UNPROC_STATUS=$(section_status "$OUTPUT" "UNPROCESSED")
if echo "$UNPROC_STATUS" | grep -q "found"; then
  pass "Unprocessed section with items detected"
else
  fail "Unprocessed section with items detected" "$UNPROC_STATUS"
fi
if echo "$OUTPUT" | grep -q "ITEMS: 3"; then
  pass "Correct item count (3)"
else
  fail "Correct item count (3)" "$(echo "$OUTPUT" | grep 'ITEMS:')"
fi

# Unprocessed section empty
DIR=$(create_fixture "unproc-empty")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed
EOF
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap
## Group 1: Test
### Track 1A: First
_1 task . ~1 day . low risk . a.txt_
- **Do A** — first. (S)
EOF
OUTPUT=$(run_audit "$DIR")
UNPROC_STATUS=$(section_status "$OUTPUT" "UNPROCESSED")
if echo "$UNPROC_STATUS" | grep -q "empty"; then
  pass "Empty Unprocessed section detected"
else
  fail "Empty Unprocessed section detected" "$UNPROC_STATUS"
fi

# No Unprocessed section
DIR=$(create_fixture "unproc-none")
echo "# TODOs" > "$DIR/TODOS.md"
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap
## Group 1: Test
### Track 1A: First
_1 task . ~1 day . low risk . a.txt_
- **Do A** — first. (S)
EOF
OUTPUT=$(run_audit "$DIR")
UNPROC_STATUS=$(section_status "$OUTPUT" "UNPROCESSED")
if echo "$UNPROC_STATUS" | grep -q "none"; then
  pass "Missing Unprocessed section reported"
else
  fail "Missing Unprocessed section reported" "$UNPROC_STATUS"
fi

# ─── mode detection tests ────────────────────────────────────

echo ""
echo "=== mode detection ==="

# Triage mode (ROADMAP.md has Groups)
DIR=$(create_fixture "mode-triage")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap
## Group 1: Test
### Track 1A: First
_1 task . ~1 day . low risk . a.txt_
- **Do A** — first. (S)
EOF
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs
## Unprocessed
- [pair-review] Some bug
EOF
OUTPUT=$(run_audit "$DIR")
MODE_SECTION=$(section_status "$OUTPUT" "MODE")
if echo "$MODE_SECTION" | grep -qi "triage"; then
  pass "Triage mode detected (Groups + Unprocessed)"
else
  # MODE section uses DETECTED: not STATUS:, check differently
  MODE_LINE=$(echo "$OUTPUT" | grep "DETECTED:" | head -1)
  if echo "$MODE_LINE" | grep -qi "triage"; then
    pass "Triage mode detected (Groups + Unprocessed)"
  else
    fail "Triage mode detected (Groups + Unprocessed)" "$MODE_LINE"
  fi
fi

# Overhaul mode (no ROADMAP.md)
DIR=$(create_fixture "mode-overhaul")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs
### Some flat item
- Do thing 1
- Do thing 2
EOF
OUTPUT=$(run_audit "$DIR")
MODE_LINE=$(echo "$OUTPUT" | grep "DETECTED:" | head -1)
if echo "$MODE_LINE" | grep -qi "overhaul"; then
  pass "Overhaul mode detected (no Groups)"
else
  fail "Overhaul mode detected (no Groups)" "$MODE_LINE"
fi

# Triage mode (Future-only roadmap, no Groups)
DIR=$(create_fixture "mode-future-only")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1 (v0.x)

## Future (Phase 2+)

- **Deferred item** — not yet.
EOF
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs
## Unprocessed
- [manual] New item
EOF
OUTPUT=$(run_audit "$DIR")
MODE_LINE=$(echo "$OUTPUT" | grep "DETECTED:" | head -1)
if echo "$MODE_LINE" | grep -qi "triage"; then
  pass "Triage mode detected (Future-only roadmap)"
else
  fail "Triage mode detected (Future-only roadmap)" "$MODE_LINE"
fi

# ─── scattered_todos tests ──────────────────────────────────

echo ""
echo "=== scattered_todos ==="

# No non-standard .md files (only known docs)
DIR=$(create_fixture "scatter-none")
echo "# README" > "$DIR/README.md"
echo "# TODOs" > "$DIR/TODOS.md"
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
SCATTER_STATUS=$(section_status "$OUTPUT" "SCATTERED_TODOS")
if echo "$SCATTER_STATUS" | grep -q "pass"; then
  pass "No non-standard .md files passes scattered check"
else
  fail "No non-standard .md files passes scattered check" "$SCATTER_STATUS"
fi

# plan.md with TODO patterns
DIR=$(create_fixture "scatter-found")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/plan.md" << 'EOF'
# Feature Plan

## Tasks

- [ ] Add keyboard navigation
- [ ] Fix crash on startup
- **Refactor auth flow** -- Clean up token handling. _auth.ts._ (S)
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
SCATTER_STATUS=$(section_status "$OUTPUT" "SCATTERED_TODOS")
if echo "$SCATTER_STATUS" | grep -q "found"; then
  pass "plan.md with TODO patterns detected"
else
  fail "plan.md with TODO patterns detected" "$SCATTER_STATUS"
fi
# Verify count (## Tasks heading + 2 checkboxes + 1 effort marker = 4)
if echo "$OUTPUT" | grep -q "docs/plan.md: 4 items"; then
  pass "Correct TODO pattern count in plan.md (4)"
else
  fail "Correct TODO pattern count in plan.md" "$(echo "$OUTPUT" | grep 'docs/plan.md')"
fi

# plan.md with no TODO patterns
DIR=$(create_fixture "scatter-clean")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/plan.md" << 'EOF'
# Feature Plan

This is a narrative document about our feature goals.
We want to improve performance and user experience.
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
SCATTER_STATUS=$(section_status "$OUTPUT" "SCATTERED_TODOS")
if echo "$SCATTER_STATUS" | grep -q "pass"; then
  pass "plan.md with no TODO patterns passes"
else
  fail "plan.md with no TODO patterns passes" "$SCATTER_STATUS"
fi

# Multiple files with scattered TODOs
DIR=$(create_fixture "scatter-multi")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/plan.md" << 'EOF'
# Plan
- [ ] First item
- [ ] Second item
EOF
cat > "$DIR/docs/notes.md" << 'EOF'
# Notes
TODO: fix the login bug
FIXME: memory leak in parser
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "TOTAL_SCATTERED: 4"; then
  pass "Multiple files: correct total scattered count (4)"
else
  fail "Multiple files: correct total scattered count" "$(echo "$OUTPUT" | grep 'TOTAL_SCATTERED')"
fi

# Excluded files not scanned (CHANGELOG.md with TODO:)
DIR=$(create_fixture "scatter-excluded")
cat > "$DIR/CHANGELOG.md" << 'EOF'
## 0.1.0
- TODO: update this section later
- Added feature
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
SCATTER_STATUS=$(section_status "$OUTPUT" "SCATTERED_TODOS")
if echo "$SCATTER_STATUS" | grep -q "pass"; then
  pass "CHANGELOG.md with TODO: not scanned (excluded)"
else
  fail "CHANGELOG.md with TODO: not scanned" "$SCATTER_STATUS"
fi

# Files in docs/archive/ not scanned
DIR=$(create_fixture "scatter-archive")
mkdir -p "$DIR/docs/archive"
cat > "$DIR/docs/archive/old-design.md" << 'EOF'
# Old Design
- [ ] This was never done
TODO: cleanup
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
SCATTER_STATUS=$(section_status "$OUTPUT" "SCATTERED_TODOS")
if echo "$SCATTER_STATUS" | grep -q "pass"; then
  pass "docs/archive/ files not scanned"
else
  fail "docs/archive/ files not scanned" "$SCATTER_STATUS"
fi

# TODO patterns inside code blocks not counted
DIR=$(create_fixture "scatter-codeblock")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/guide.md" << 'MDEOF'
# Developer Guide

Here is an example:

```bash
# TODO: this is just a code example, not a real TODO
echo "hello"
```

This line is outside the code block.
MDEOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
SCATTER_STATUS=$(section_status "$OUTPUT" "SCATTERED_TODOS")
if echo "$SCATTER_STATUS" | grep -q "pass"; then
  pass "TODO inside code block not counted"
else
  fail "TODO inside code block not counted" "$SCATTER_STATUS"
fi

# Checked-off [x] items still flagged
DIR=$(create_fixture "scatter-checked")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/plan.md" << 'EOF'
# Plan
- [x] Completed item
- [x] Another completed item
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
SCATTER_STATUS=$(section_status "$OUTPUT" "SCATTERED_TODOS")
if echo "$SCATTER_STATUS" | grep -q "found"; then
  pass "Checked-off [x] items still flagged"
else
  fail "Checked-off [x] items still flagged" "$SCATTER_STATUS"
fi
if echo "$OUTPUT" | grep -q "docs/plan.md: 2 items"; then
  pass "Checked-off [x] items: correct count (2)"
else
  fail "Checked-off [x] items: correct count" "$(echo "$OUTPUT" | grep 'docs/plan.md')"
fi

# Nested code blocks (``` inside ```)
DIR=$(create_fixture "scatter-nested-fence")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/guide.md" << 'MDEOF'
# Guide

````markdown
```bash
TODO: this is inside nested code block
```
````

TODO: this is outside and should be counted
MDEOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
# Should find exactly 1 (only the one outside)
if echo "$OUTPUT" | grep -q "docs/guide.md: 1 items"; then
  pass "Nested code blocks handled correctly"
else
  fail "Nested code blocks handled correctly" "$(echo "$OUTPUT" | grep 'docs/guide.md')"
fi

# Mixed pattern file (checkboxes + TODO: + ## Tasks heading)
DIR=$(create_fixture "scatter-mixed")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/plan.md" << 'EOF'
# Feature Plan

## Tasks

- [ ] Add dark mode
- [ ] Fix mobile layout
TODO: investigate performance regression
HACK: workaround for API bug
- **Add caching layer** -- Redis integration. _cache.ts._ (M)
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
# ## Tasks heading (1) + 2 checkboxes + TODO: (1) + HACK: (1) + effort marker (1) = 6
if echo "$OUTPUT" | grep -q "docs/plan.md: 6 items"; then
  pass "Mixed pattern file: correct total (6)"
else
  fail "Mixed pattern file: correct total" "$(echo "$OUTPUT" | grep 'docs/plan.md')"
fi

# PROGRESS.md with TODO: markers (excluded, should not be scanned)
DIR=$(create_fixture "scatter-progress-excluded")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/PROGRESS.md" << 'EOF'
# Progress
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | TODO: fill in later |
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
SCATTER_STATUS=$(section_status "$OUTPUT" "SCATTERED_TODOS")
if echo "$SCATTER_STATUS" | grep -q "pass"; then
  pass "PROGRESS.md with TODO: not scanned (excluded)"
else
  fail "PROGRESS.md with TODO: not scanned" "$SCATTER_STATUS"
fi

# ─── doc_inventory tests ──────────────────────────────────────

echo ""
echo "=== doc_inventory ==="

# Standard docs only
DIR=$(create_fixture "inv-standard")
echo "# README" > "$DIR/README.md"
echo "# TODOs" > "$DIR/TODOS.md"
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "DOC_INVENTORY"; then
  pass "Doc inventory section present"
else
  fail "Doc inventory section present"
fi
# Should list README.md and TODOS.md (and VERSION dummy)
if echo "$OUTPUT" | grep -q "TOTAL_FILES:"; then
  pass "Doc inventory reports total file count"
else
  fail "Doc inventory reports total file count"
fi

# Non-standard .md files listed with counts
DIR=$(create_fixture "inv-nonstandard")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/plan.md" << 'EOF'
# Plan
- [ ] A checkbox item
TODO: do the thing
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "docs" --quiet
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "docs/plan.md:.*(unknown)"; then
  pass "Non-standard .md file listed as unknown type"
else
  fail "Non-standard .md file listed as unknown type" "$(echo "$OUTPUT" | grep 'plan.md')"
fi

# Empty repo (no .md files besides what create_fixture makes)
DIR=$(create_fixture "inv-empty")
rm -f "$DIR/dummy.txt"
git -C "$DIR" add -A
git -C "$DIR" commit -m "cleanup" --quiet
OUTPUT=$(run_audit "$DIR")
# Only VERSION exists (not .md), should have minimal files
if echo "$OUTPUT" | grep -q "DOC_INVENTORY"; then
  pass "Doc inventory works on minimal repo"
else
  fail "Doc inventory works on minimal repo"
fi

# ─── task_list ─────────────────────────────────────────────────

echo ""
echo "=== task_list ==="

# Standard ROADMAP.md with 2 groups, 3 tracks, 5 tasks
DIR=$(create_fixture "tasklist-standard")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'ROADMAPEOF'
# Roadmap — Pre-1.0 (v0.x)

## Group 1: Foundation

### Track 1A: Core Setup
_2 tasks . ~1 day . low risk . [setup]_

- **Init system** -- Initialize the system. _[setup], ~20 lines._ (S)
- **Config loader** -- Load configuration. _[config.sh], ~30 lines._ (M)

---

## Group 2: Features

### Track 2A: User Flow
_1 task . ~2 days . medium risk . [lib/user.sh]_

- **Add user creation** -- Create users. _[lib/user.sh], ~50 lines._ (M)

### Track 2B: Admin Flow
_2 tasks . ~1 day . low risk . [lib/admin.sh]_

- **Admin dashboard** -- Build dashboard. _[lib/admin.sh], ~40 lines._ (L)
- **Admin permissions** -- Set permissions. _[lib/admin.sh], ~20 lines._ (S)

---

## Execution Map

```
Group 1 → Group 2
```

## Future (Phase 1.x+)

- **API v2** — Next gen API. _Deferred because: not needed yet. L effort._

## Unprocessed

ROADMAPEOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "add roadmap" --quiet
OUTPUT=$(run_audit "$DIR")

if echo "$OUTPUT" | grep -q "TOTAL_TASKS: 6"; then
  pass "Task list: correct total count (6)"
else
  fail "Task list: correct total count (6)" "$(echo "$OUTPUT" | grep TOTAL_TASKS)"
fi

if echo "$OUTPUT" | grep -q "TOTAL_CURRENT: 5"; then
  pass "Task list: correct current count (5)"
else
  fail "Task list: correct current count (5)" "$(echo "$OUTPUT" | grep TOTAL_CURRENT)"
fi

if echo "$OUTPUT" | grep -q "TOTAL_FUTURE: 1"; then
  pass "Task list: correct future count (1)"
else
  fail "Task list: correct future count (1)" "$(echo "$OUTPUT" | grep TOTAL_FUTURE)"
fi

if echo "$OUTPUT" | grep -q 'TASK: group=1|track=1A|title=Init system|effort=S|files=setup'; then
  pass "Task list: correct task parsing (group, track, title, effort, files)"
else
  fail "Task list: correct task parsing" "$(echo "$OUTPUT" | grep 'Init system')"
fi

if echo "$OUTPUT" | grep -q 'TASK: group=future|track=none|title=API v2'; then
  pass "Task list: future items extracted"
else
  fail "Task list: future items extracted" "$(echo "$OUTPUT" | grep 'API v2')"
fi

# ROADMAP.md with Pre-flight section
DIR=$(create_fixture "tasklist-preflight")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'ROADMAPEOF'
# Roadmap

## Group 1: Setup

**Pre-flight** (any agent, <30 min):
- Fix typo in README
- Update version constant

### Track 1A: Core
_1 task . ~1 day . low risk . [core.sh]_

- **Build core** -- Build the core. _[core.sh], ~100 lines._ (M)

## Unprocessed

ROADMAPEOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "add roadmap" --quiet
OUTPUT=$(run_audit "$DIR")

if echo "$OUTPUT" | grep -q "TOTAL_TASKS: 3"; then
  pass "Task list: pre-flight items counted (3 total)"
else
  fail "Task list: pre-flight items counted" "$(echo "$OUTPUT" | grep TOTAL_TASKS)"
fi

if echo "$OUTPUT" | grep -q 'TASK: group=1|track=preflight|title=Fix typo in README|effort=S'; then
  pass "Task list: pre-flight task parsed correctly"
else
  fail "Task list: pre-flight task parsed correctly" "$(echo "$OUTPUT" | grep 'preflight')"
fi

# Empty ROADMAP.md (no groups)
DIR=$(create_fixture "tasklist-empty")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'ROADMAPEOF'
# Roadmap

## Future

- **Someday** — maybe. _Deferred because: not now._

## Unprocessed

ROADMAPEOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "add roadmap" --quiet
OUTPUT=$(run_audit "$DIR")

if echo "$OUTPUT" | grep -q "TOTAL_CURRENT: 0"; then
  pass "Task list: future-only roadmap has 0 current tasks"
else
  fail "Task list: future-only roadmap has 0 current tasks" "$(echo "$OUTPUT" | grep TOTAL_CURRENT)"
fi

# No ROADMAP.md at all
DIR=$(create_fixture "tasklist-none")
OUTPUT=$(run_audit "$DIR")

if echo "$OUTPUT" | grep -q "## TASK_LIST" && echo "$OUTPUT" | grep -q "STATUS: skip"; then
  pass "Task list: missing ROADMAP.md skips gracefully"
else
  fail "Task list: missing ROADMAP.md skips gracefully"
fi

# ─── structural_fitness ─────────────────────────────────────────

echo ""
echo "=== structural_fitness ==="

# Balanced groups (3 tasks each)
DIR=$(create_fixture "fitness-balanced")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'ROADMAPEOF'
# Roadmap

## Group 1: Alpha

### Track 1A: Core
_3 tasks . ~1 day . low risk . [a.sh]_

- **Task A1** -- desc. _[a.sh]._ (S)
- **Task A2** -- desc. _[a.sh]._ (S)
- **Task A3** -- desc. _[a.sh]._ (S)

## Group 2: Beta

### Track 2A: Core
_3 tasks . ~1 day . low risk . [b.sh]_

- **Task B1** -- desc. _[b.sh]._ (S)
- **Task B2** -- desc. _[b.sh]._ (S)
- **Task B3** -- desc. _[b.sh]._ (S)

## Unprocessed

ROADMAPEOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "add roadmap" --quiet
OUTPUT=$(run_audit "$DIR")

if echo "$OUTPUT" | grep -q "IMBALANCE_RATIO: 1.00"; then
  pass "Structural fitness: balanced groups ratio 1.00"
else
  fail "Structural fitness: balanced groups ratio 1.00" "$(echo "$OUTPUT" | grep IMBALANCE)"
fi

if echo "$OUTPUT" | grep -q "GROUP_COUNT: 2"; then
  pass "Structural fitness: correct group count"
else
  fail "Structural fitness: correct group count" "$(echo "$OUTPUT" | grep GROUP_COUNT)"
fi

# Lopsided groups (8 vs 2)
DIR=$(create_fixture "fitness-lopsided")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'ROADMAPEOF'
# Roadmap

## Group 1: Heavy

### Track 1A: Lots
_8 tasks . ~5 days . high risk . [heavy.sh]_

- **T1** -- d. _[h.sh]._ (S)
- **T2** -- d. _[h.sh]._ (S)
- **T3** -- d. _[h.sh]._ (S)
- **T4** -- d. _[h.sh]._ (S)
- **T5** -- d. _[h.sh]._ (S)
- **T6** -- d. _[h.sh]._ (S)
- **T7** -- d. _[h.sh]._ (S)
- **T8** -- d. _[h.sh]._ (S)

## Group 2: Light

### Track 2A: Few
_2 tasks . ~1 day . low risk . [light.sh]_

- **L1** -- d. _[l.sh]._ (S)
- **L2** -- d. _[l.sh]._ (S)

## Unprocessed

ROADMAPEOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "add roadmap" --quiet
OUTPUT=$(run_audit "$DIR")

if echo "$OUTPUT" | grep -q "IMBALANCE_RATIO: 4.00"; then
  pass "Structural fitness: lopsided groups ratio 4.00"
else
  fail "Structural fitness: lopsided groups ratio 4.00" "$(echo "$OUTPUT" | grep IMBALANCE)"
fi

if echo "$OUTPUT" | grep -q "GROUP_SIZES: 1=8,2=2"; then
  pass "Structural fitness: correct group sizes"
else
  fail "Structural fitness: correct group sizes" "$(echo "$OUTPUT" | grep GROUP_SIZES)"
fi

# Single group (no imbalance ratio)
DIR=$(create_fixture "fitness-single")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'ROADMAPEOF'
# Roadmap

## Group 1: Only

### Track 1A: Solo
_2 tasks . ~1 day . low risk . [solo.sh]_

- **S1** -- d. _[s.sh]._ (S)
- **S2** -- d. _[s.sh]._ (S)

## Unprocessed

ROADMAPEOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "add roadmap" --quiet
OUTPUT=$(run_audit "$DIR")

if echo "$OUTPUT" | grep -q "GROUP_COUNT: 1" && ! echo "$OUTPUT" | grep -q "IMBALANCE_RATIO"; then
  pass "Structural fitness: single group, no imbalance ratio"
else
  fail "Structural fitness: single group, no imbalance ratio" "$(echo "$OUTPUT" | grep -E 'GROUP_COUNT|IMBALANCE')"
fi

# No groups (future-only)
DIR=$(create_fixture "fitness-future")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'ROADMAPEOF'
# Roadmap

## Future

- **Someday** — maybe.

## Unprocessed

ROADMAPEOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "add roadmap" --quiet
OUTPUT=$(run_audit "$DIR")

if echo "$OUTPUT" | grep -q "GROUP_COUNT: 0"; then
  pass "Structural fitness: future-only has 0 groups"
else
  fail "Structural fitness: future-only has 0 groups" "$(echo "$OUTPUT" | grep GROUP_COUNT)"
fi

# ─── size, collisions, style_lint, shared_infra (v0.9.0) ──────

# Helper: fixture with one Group containing one modern Track.
# Writes a minimal ROADMAP.md with the given track body (including _touches:_).
make_modern_fixture() {
  local name="$1" track_body="$2"
  local dir
  dir=$(create_fixture "$name")
  mkdir -p "$dir/docs"
  {
    echo "# Roadmap"
    echo ""
    echo "## Group 1: G1"
    echo ""
    echo "$track_body"
    echo ""
    echo "## Unprocessed"
  } > "$dir/docs/ROADMAP.md"
  echo "# TODOs" > "$dir/docs/TODOS.md"
  cat > "$dir/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
  echo "$dir"
}

# Helper: run audit with env overrides (passes through configured vars).
run_audit_env() {
  local dir="$1"
  shift
  env "$@" GSTACK_EXTEND_DIR="$SCRIPT_DIR" "$SCRIPT_DIR/bin/roadmap-audit" "$dir" 2>/dev/null || true
}

echo ""
echo "=== size caps ==="

# Passes: 3-task track under every cap
DIR=$(make_modern_fixture "size-pass" '### Track 1A: Small
_3 tasks . low risk . [a, b, c]_
_touches: a, b, c_

- **T1** -- do it. _~30 lines._ (S)
- **T2** -- do it. _~100 lines._ (M)
- **T3** -- do it. _~40 lines._ (S)')
OUTPUT=$(run_audit "$DIR")
if section_status "$OUTPUT" "SIZE" | grep -q "pass"; then
  pass "size: 3-task S+M+S track passes"
else
  fail "size: 3-task S+M+S track passes" "$(section_status "$OUTPUT" SIZE)"
fi

# Fails on tasks > max_tasks_per_track
DIR=$(make_modern_fixture "size-tasks-fail" '### Track 1A: TooMany
_6 tasks . low risk . [a]_
_touches: a_

- **T1** -- . (S)
- **T2** -- . (S)
- **T3** -- . (S)
- **T4** -- . (S)
- **T5** -- . (S)
- **T6** -- . (S)')
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "1A: tasks=6 exceeds max_tasks_per_track=5"; then
  pass "size: tasks cap blocks"
else
  fail "size: tasks cap blocks" "$(echo "$OUTPUT" | grep -A3 '^## SIZE')"
fi

# Split suggestion fires on oversized track with multiple path clusters.
# Regression: v0.17.0 had a malformed sed in _size_split_suggestion that
# blanked the cluster state on every duplicate-key hit, so big_count
# never reached 2 and the suggestion line never emitted.
DIR=$(make_modern_fixture "size-split-suggestion" '### Track 1A: Big
_6 tasks . low risk . [src/foo, src/bar]_
_touches: src/foo/a.py, src/foo/b.py, src/foo/c.py, src/bar/x.py, src/bar/y.py, src/bar/z.py_

- **T1** -- edit `src/foo/a.py`. (S)
- **T2** -- edit `src/foo/b.py`. (S)
- **T3** -- edit `src/foo/c.py`. (S)
- **T4** -- edit `src/bar/x.py`. (S)
- **T5** -- edit `src/bar/y.py`. (S)
- **T6** -- edit `src/bar/z.py`. (S)')
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "Split suggestion for 1A: tasks cluster by file path into 2 groups"; then
  pass "size: split suggestion fires across 2 path clusters"
else
  fail "size: split suggestion fires across 2 path clusters" "$(echo "$OUTPUT" | grep -A6 '^## SIZE')"
fi

# Fails on LOC (2 XL = 1000)
DIR=$(make_modern_fixture "size-loc-fail" '### Track 1A: Heavy
_2 tasks . low risk . [a]_
_touches: a_

- **T1** -- . (XL)
- **T2** -- . (XL)')
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "1A: loc=1000 exceeds max_loc_per_track=300"; then
  pass "size: loc cap blocks"
else
  fail "size: loc cap blocks"
fi

# Fails on files > 8
DIR=$(make_modern_fixture "size-files-fail" '### Track 1A: Wide
_1 task . low risk . [a]_
_touches: a, b, c, d, e, f, g, h, i_

- **T1** -- . (S)')
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "1A: files=9 exceeds max_files_per_track=8"; then
  pass "size: files cap blocks"
else
  fail "size: files cap blocks"
fi

# Env override raises tasks cap to 7
DIR=$(make_modern_fixture "size-env-override" '### Track 1A: Six
_6 tasks . low risk . [a]_
_touches: a_

- **T1** -- . (S)
- **T2** -- . (S)
- **T3** -- . (S)
- **T4** -- . (S)
- **T5** -- . (S)
- **T6** -- . (S)')
OUTPUT=$(run_audit_env "$DIR" ROADMAP_MAX_TASKS_PER_TRACK=7)
if section_status "$OUTPUT" "SIZE" | grep -q "pass"; then
  pass "size: env override raises tasks cap"
else
  fail "size: env override raises tasks cap" "$(section_status "$OUTPUT" SIZE)"
fi

# Non-numeric env var: fall back to default, still blocks 6-task track
DIR=$(make_modern_fixture "size-env-bad" '### Track 1A: Six
_6 tasks . low risk . [a]_
_touches: a_

- **T1** -- . (S)
- **T2** -- . (S)
- **T3** -- . (S)
- **T4** -- . (S)
- **T5** -- . (S)
- **T6** -- . (S)')
OUTPUT=$(run_audit_env "$DIR" ROADMAP_MAX_TASKS_PER_TRACK=foo)
if echo "$OUTPUT" | grep -q "1A: tasks=6 exceeds max_tasks_per_track=5"; then
  pass "size: non-numeric env falls back to default"
else
  fail "size: non-numeric env falls back to default"
fi

# Legacy track (no _touches:_) yields skip-legacy
DIR=$(create_fixture "size-legacy")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G
### Track 1A: Legacy
_1 task . low risk . [a]_

- **T1** -- do it. (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "LEGACY_TRACKS: 1A"; then
  pass "size: legacy track emits LEGACY_TRACKS banner"
else
  fail "size: legacy track emits LEGACY_TRACKS banner"
fi

# Legacy-only roadmap emits skip-legacy-all
if section_status "$OUTPUT" "SIZE" | grep -q "skip-legacy-all"; then
  pass "size: all-legacy roadmap is skip-legacy-all"
else
  fail "size: all-legacy roadmap is skip-legacy-all"
fi

# SIZE_LABEL_MISMATCH: (S) + ~200 lines (4x divergence) → warn
DIR=$(make_modern_fixture "size-mismatch" '### Track 1A: Lie
_1 task . low risk . [a]_
_touches: a_

- **T1** -- big. _~200 lines._ (S)')
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "SIZE_LABEL_MISMATCH"; then
  pass "size: label mismatch detected on 4x divergence"
else
  fail "size: label mismatch detected on 4x divergence"
fi

# SIZE_LABEL_MISMATCH: (S) + ~80 lines (<3x) → silent
DIR=$(make_modern_fixture "size-near" '### Track 1A: Close
_1 task . low risk . [a]_
_touches: a_

- **T1** -- close. _~80 lines._ (S)')
OUTPUT=$(run_audit "$DIR")
if ! echo "$OUTPUT" | grep -q "SIZE_LABEL_MISMATCH"; then
  pass "size: label mismatch silent below 3x"
else
  fail "size: label mismatch silent below 3x"
fi

# SIZE_LABEL_MISMATCH: task with no ~N lines hint → skip cross-check
DIR=$(make_modern_fixture "size-no-hint" '### Track 1A: NoHint
_1 task . low risk . [a]_
_touches: a_

- **T1** -- unlabeled. (S)')
OUTPUT=$(run_audit "$DIR")
if ! echo "$OUTPUT" | grep -q "SIZE_LABEL_MISMATCH"; then
  pass "size: no lines-hint skips label mismatch"
else
  fail "size: no lines-hint skips label mismatch"
fi

echo ""
echo "=== collisions ==="

# No overlap: pass
DIR=$(create_fixture "coll-none")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G

### Track 1A: A
_1 task . low risk . [x]_
_touches: x_

- **T1** -- . (S)

### Track 1B: B
_1 task . low risk . [y]_
_touches: y_

- **T1** -- . (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
if section_status "$OUTPUT" "COLLISIONS" | grep -q "pass"; then
  pass "collisions: disjoint touches pass"
else
  fail "collisions: disjoint touches pass" "$(section_status "$OUTPUT" COLLISIONS)"
fi

# PARALLEL collision: 1A and 1B both touch web/foo.ts (not in shared infra)
DIR=$(create_fixture "coll-parallel")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G

### Track 1A: A
_1 task . low risk . [web/foo.ts]_
_touches: web/foo.ts_

- **T1** -- . (S)

### Track 1B: B
_1 task . low risk . [web/foo.ts]_
_touches: web/foo.ts_

- **T1** -- . (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q '1A-1B:.*\[web/foo.ts\].*\[PARALLEL\]'; then
  pass "collisions: PARALLEL classification when no shared-infra match"
else
  fail "collisions: PARALLEL classification when no shared-infra match" "$(echo "$OUTPUT" | grep -A3 '^## COLLISIONS')"
fi

# SHARED_INFRA collision: both touch bin/config (which IS in default shared-infra)
DIR=$(create_fixture "coll-shared")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G

### Track 1A: A
_1 task . low risk . [bin/config]_
_touches: bin/config_

- **T1** -- . (S)

### Track 1B: B
_1 task . low risk . [bin/config]_
_touches: bin/config_

- **T1** -- . (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
# Put a shared-infra file and make the overlapping file exist
mkdir -p "$DIR/bin"
touch "$DIR/bin/config"
echo "bin/config" > "$DIR/docs/shared-infra.txt"
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q '1A-1B:.*\[bin/config\].*\[SHARED_INFRA\]'; then
  pass "collisions: SHARED_INFRA classification when overlap is in shared-infra set"
else
  fail "collisions: SHARED_INFRA classification" "$(echo "$OUTPUT" | grep -A3 '^## COLLISIONS')"
fi

# Cross-Group: 1A vs 2A share file — NOT flagged (intra-Group only)
DIR=$(create_fixture "coll-cross-group")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G1

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T1** -- . (S)

## Group 2: G2

### Track 2A: A
_1 task . low risk . [a]_
_touches: a_

- **T1** -- . (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
if section_status "$OUTPUT" "COLLISIONS" | grep -q "pass"; then
  pass "collisions: cross-Group overlap NOT flagged"
else
  fail "collisions: cross-Group overlap NOT flagged"
fi

# Legacy tracks excluded from pairing
DIR=$(create_fixture "coll-legacy-excluded")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G

### Track 1A: Legacy
_1 task . low risk . [a]_

- **T1** -- . (S)

### Track 1B: Modern
_1 task . low risk . [a]_
_touches: a_

- **T1** -- . (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
if section_status "$OUTPUT" "COLLISIONS" | grep -q "pass"; then
  pass "collisions: legacy tracks excluded from pairing"
else
  fail "collisions: legacy tracks excluded from pairing"
fi

# SHARED_INFRA_STATUS: missing when file absent
DIR=$(make_modern_fixture "coll-shared-missing" '### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T1** -- . (S)')
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "SHARED_INFRA_STATUS: missing"; then
  pass "collisions: shared-infra.txt absent reports missing"
else
  fail "collisions: shared-infra.txt absent reports missing"
fi

echo ""
echo "=== shared_infra glob ==="

# Literal path match
DIR=$(make_modern_fixture "glob-literal" '### Track 1A: A
_1 task . low risk . [bin/config]_
_touches: bin/config_

- **T1** -- . (S)

### Track 1B: B
_1 task . low risk . [bin/config]_
_touches: bin/config_

- **T1** -- . (S)')
mkdir -p "$DIR/bin"
touch "$DIR/bin/config"
echo "bin/config" > "$DIR/docs/shared-infra.txt"
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q '\[SHARED_INFRA\]'; then
  pass "glob: literal path matches"
else
  fail "glob: literal path matches"
fi

# Single-star glob skills/*.md matches skills/foo.md
DIR=$(make_modern_fixture "glob-single-star" '### Track 1A: A
_1 task . low risk . [x]_
_touches: skills/foo.md_

- **T1** -- . (S)

### Track 1B: B
_1 task . low risk . [x]_
_touches: skills/foo.md_

- **T1** -- . (S)')
mkdir -p "$DIR/skills"
touch "$DIR/skills/foo.md"
echo "skills/*.md" > "$DIR/docs/shared-infra.txt"
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q '\[SHARED_INFRA\]'; then
  pass "glob: *.md pattern matches"
else
  fail "glob: *.md pattern matches"
fi

# Brace expansion bin/{config,update-run}
DIR=$(make_modern_fixture "glob-brace" '### Track 1A: A
_1 task . low risk . [x]_
_touches: bin/update-run_

- **T1** -- . (S)

### Track 1B: B
_1 task . low risk . [x]_
_touches: bin/update-run_

- **T1** -- . (S)')
mkdir -p "$DIR/bin"
touch "$DIR/bin/update-run"
echo "bin/{config,update-run}" > "$DIR/docs/shared-infra.txt"
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q '\[SHARED_INFRA\]'; then
  pass "glob: brace expansion matches"
else
  fail "glob: brace expansion matches"
fi

# SECURITY: malicious pattern with shell metachars is rejected
DIR=$(make_modern_fixture "glob-injection" '### Track 1A: A
_1 task . low risk . [a]_
_touches: bin/config_

- **T1** -- . (S)

### Track 1B: B
_1 task . low risk . [a]_
_touches: bin/config_

- **T1** -- . (S)')
mkdir -p "$DIR/bin"
touch "$DIR/bin/config"
cat > "$DIR/docs/shared-infra.txt" << 'INFRAEOF'
bin/config
; touch /tmp/gstack-pwn-should-not-exist
$(touch /tmp/gstack-pwn-should-not-exist)
INFRAEOF
rm -f /tmp/gstack-pwn-should-not-exist
OUTPUT=$(GSTACK_EXTEND_DIR="$SCRIPT_DIR" "$SCRIPT_DIR/bin/roadmap-audit" "$DIR" 2>&1 || true)
# Valid pattern still matches
valid_match=0
if echo "$OUTPUT" | grep -q '\[SHARED_INFRA\]'; then
  valid_match=1
fi
# Malicious patterns rejected with warning
rejected=0
if echo "$OUTPUT" | grep -q "SHARED_INFRA_WARN: skipping pattern with unsafe characters"; then
  rejected=1
fi
# No pwn file created
safe=1
if [ -e /tmp/gstack-pwn-should-not-exist ]; then
  safe=0
  rm -f /tmp/gstack-pwn-should-not-exist
fi
if [ "$valid_match" -eq 1 ] && [ "$rejected" -eq 1 ] && [ "$safe" -eq 1 ]; then
  pass "security: malicious shared-infra pattern rejected, safe patterns still match"
else
  fail "security: malicious shared-infra pattern rejected, safe patterns still match" "valid_match=$valid_match rejected=$rejected safe=$safe"
fi

# Comment lines and blank lines ignored in shared-infra.txt
DIR=$(make_modern_fixture "glob-comments" '### Track 1A: A
_1 task . low risk . [x]_
_touches: bin/config_

- **T1** -- . (S)

### Track 1B: B
_1 task . low risk . [x]_
_touches: bin/config_

- **T1** -- . (S)')
mkdir -p "$DIR/bin"
touch "$DIR/bin/config"
cat > "$DIR/docs/shared-infra.txt" << 'EOF'
# this is a comment

bin/config
# another comment
EOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q '\[SHARED_INFRA\]'; then
  pass "glob: comment lines ignored"
else
  fail "glob: comment lines ignored"
fi

echo ""
echo "=== style_lint ==="

# Same-Group Depends on: → valid DAG expression (no warn under v0.16.2+)
DIR=$(create_fixture "style-same-group")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T1** -- . (S)

### Track 1B: B
_1 task . low risk . [b]_
_touches: b_

Depends on: Track 1A

- **T1** -- . (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
SL=$(echo "$OUTPUT" | sed -n '/^## STYLE_LINT$/,/^## /p')
if ! echo "$SL" | grep -q "same Group"; then
  pass "style_lint: intra-Group Depends on is valid DAG (no warn)"
else
  fail "style_lint: intra-Group Depends on should not warn" "$SL"
fi

# Cross-Group Depends on: → silent
DIR=$(create_fixture "style-cross-group")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G1

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T1** -- . (S)

## Group 2: G2

### Track 2A: A
_1 task . low risk . [c]_
_touches: c_

Depends on: Track 1A

- **T1** -- . (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
if section_status "$OUTPUT" "STYLE_LINT" | grep -q "pass"; then
  pass "style_lint: cross-Group Depends on is silent"
else
  fail "style_lint: cross-Group Depends on is silent"
fi

echo ""
echo "=== touches parsing ==="

# Whitespace tolerant: `  a ,  b  ,c_` → [a, b, c]
DIR=$(make_modern_fixture "parse-whitespace" '### Track 1A: Spaces
_1 task . low risk . [a]_
_touches:   a  ,  b ,c_

- **T1** -- . (S)')
OUTPUT=$(run_audit "$DIR")
if section_status "$OUTPUT" "SIZE" | grep -q "pass"; then
  # Files-count should be 3, not failing any cap
  pass "parse: whitespace trim in touches list"
else
  fail "parse: whitespace trim in touches list"
fi

# _touches:_ line before metadata → structure error with helpful message
DIR=$(create_fixture "parse-touches-first")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G
### Track 1A: Wrong
_touches: a_
_1 task . low risk . [a]_

- **T1** -- . (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "_touches:_ line appears before metadata"; then
  pass "parse: touches-before-metadata triggers clear error"
else
  fail "parse: touches-before-metadata triggers clear error"
fi

echo ""
echo "=== max_tracks_per_group ==="

# More than 8 modern tracks in a Group → warning
DIR=$(create_fixture "group-track-cap")
mkdir -p "$DIR/docs"
{
  echo "# Roadmap"
  echo ""
  echo "## Group 1: G"
  echo ""
  for letter in A B C D E F G H I; do
    echo "### Track 1${letter}: T${letter}"
    echo "_1 task . low risk . [f${letter}]_"
    echo "_touches: f${letter}_"
    echo ""
    echo "- **T1** -- . (S)"
    echo ""
  done
  echo "## Unprocessed"
} > "$DIR/docs/ROADMAP.md"
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "9 modern tracks exceeds max_tracks_per_group=8"; then
  pass "group cap: 9 tracks flagged"
else
  fail "group cap: 9 tracks flagged"
fi

echo ""
echo "=== track ✓ complete (in-place) ==="

# In-place ✓ Complete excludes the Track from max_tracks_per_group cap
# (symmetric with the Group ✓ Complete convention). Same 9-track fixture
# as above, but 3 marked complete → only 6 modern in-flight → passes.
DIR=$(create_fixture "track-complete-group-cap")
mkdir -p "$DIR/docs"
{
  echo "# Roadmap"
  echo ""
  echo "## Group 1: G"
  echo ""
  i=0
  for letter in A B C D E F G H I; do
    if [ "$i" -lt 3 ]; then
      echo "### Track 1${letter}: T${letter} ✓ Complete"
    else
      echo "### Track 1${letter}: T${letter}"
    fi
    echo "_1 task . low risk . [f${letter}]_"
    echo "_touches: f${letter}_"
    echo ""
    echo "- **T1** -- . (S)"
    echo ""
    i=$((i + 1))
  done
  echo "## Unprocessed"
} > "$DIR/docs/ROADMAP.md"
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
if ! echo "$OUTPUT" | grep -q "modern tracks exceeds max_tracks_per_group"; then
  pass "track complete: 3 of 9 marked ✓ Complete keeps Group under cap"
else
  fail "track complete: ✓ Complete tracks should not count toward Group cap" "$(echo "$OUTPUT" | grep -A3 '^## COLLISIONS')"
fi

# PARALLELISM_BUDGET subtracts in-place ✓ Complete Tracks. Cap=4 (default);
# 6 Tracks total, 3 ✓ Complete → 3 in-flight → passes.
if echo "$OUTPUT" | grep -qE '^IN_FLIGHT_TRACKS: 6$'; then
  pass "track complete: 3 of 9 ✓ Complete → IN_FLIGHT_TRACKS=6 (subtracted)"
else
  fail "track complete: IN_FLIGHT_TRACKS should be 6 after subtracting ✓ Complete" "$(echo "$OUTPUT" | grep -A4 '^## PARALLELISM_BUDGET')"
fi

# COMPLETE_TRACKS line is emitted when any Track is marked complete.
if echo "$OUTPUT" | grep -qE '^COMPLETE_TRACKS: 1A 1B 1C$'; then
  pass "track complete: PARALLELISM_BUDGET emits COMPLETE_TRACKS line"
else
  fail "track complete: COMPLETE_TRACKS line missing or wrong" "$(echo "$OUTPUT" | grep -A5 '^## PARALLELISM_BUDGET')"
fi

# SIZE caps don't apply to ✓ Complete Tracks — the work shipped, caps are
# advice for in-flight. 6-task complete Track + 1-task active Track →
# active Track passes, complete Track skipped silently, overall SIZE pass.
DIR=$(make_modern_fixture "track-complete-size" '### Track 1A: TooManyButDone ✓ Complete
_6 tasks . low risk . [a]_
_touches: a_

- **T1** -- . (S)
- **T2** -- . (S)
- **T3** -- . (S)
- **T4** -- . (S)
- **T5** -- . (S)
- **T6** -- . (S)

### Track 1B: Active
_1 task . low risk . [b]_
_touches: b_

- **T1** -- . (S)')
OUTPUT=$(run_audit "$DIR")
if section_status "$OUTPUT" "SIZE" | grep -q "pass"; then
  pass "track complete: ✓ Complete excludes Track from SIZE caps"
else
  fail "track complete: ✓ Complete should exclude from SIZE caps" "$(echo "$OUTPUT" | grep -A4 '^## SIZE')"
fi

# COLLISIONS: two Tracks with overlapping touches normally fail; if one is
# ✓ Complete, the pair shouldn't collide (the completed Track isn't running).
DIR=$(create_fixture "track-complete-collisions")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G

### Track 1A: Active
_1 task . low risk . [shared.py]_
_touches: shared.py_

- **T1** -- . (S)

### Track 1B: Done ✓ Complete
_1 task . low risk . [shared.py]_
_touches: shared.py_

- **T1** -- . (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
if section_status "$OUTPUT" "COLLISIONS" | grep -q "pass"; then
  pass "track complete: ✓ Complete excludes Track from COLLISIONS pairing"
else
  fail "track complete: ✓ Complete should not collide with active Track" "$(echo "$OUTPUT" | grep -A6 '^## COLLISIONS')"
fi

echo ""
echo "=== migration regression ==="

# The repo's own ROADMAP.md (post-migration) passes every new check.
# This is the load-bearing "dogfood" assertion.
OUTPUT=$(run_audit "$SCRIPT_DIR")
if section_status "$OUTPUT" "SIZE" | grep -q "pass" \
   && section_status "$OUTPUT" "COLLISIONS" | grep -q "pass" \
   && section_status "$OUTPUT" "STYLE_LINT" | grep -q "pass" \
   && section_status "$OUTPUT" "STRUCTURE" | grep -q "pass" \
   && section_status "$OUTPUT" "VOCAB_LINT" | grep -q "pass"; then
  pass "REGRESSION: repo's own migrated ROADMAP.md passes full audit"
else
  fail "REGRESSION: repo's own migrated ROADMAP.md passes full audit" "$(echo "$OUTPUT" | grep -E '^(## |STATUS:)' | head -40)"
fi

# Shared infra file exists and is loaded
if echo "$OUTPUT" | grep -q "SHARED_INFRA_STATUS: loaded"; then
  pass "REGRESSION: repo's docs/shared-infra.txt is loaded"
else
  fail "REGRESSION: repo's docs/shared-infra.txt is loaded"
fi

# Strengthened: no SIZE_LABEL_MISMATCH should fire on own repo.
if ! echo "$OUTPUT" | grep -q "^SIZE_LABEL_MISMATCH:"; then
  pass "REGRESSION: repo's own ROADMAP.md emits no SIZE_LABEL_MISMATCH"
else
  fail "REGRESSION: repo's own ROADMAP.md emits no SIZE_LABEL_MISMATCH" "$(echo "$OUTPUT" | grep -A3 '^SIZE_LABEL_MISMATCH:')"
fi

echo ""
echo "=== round-2 hardening ==="

# CONFIG_INVALID warning is actually emitted on stderr for non-numeric env
DIR=$(make_modern_fixture "stderr-config-invalid" '### Track 1A: Six
_6 tasks . low risk . [a]_
_touches: a_

- **T1** -- . (S)
- **T2** -- . (S)
- **T3** -- . (S)
- **T4** -- . (S)
- **T5** -- . (S)
- **T6** -- . (S)')
STDERR=$(env ROADMAP_MAX_TASKS_PER_TRACK=foo GSTACK_EXTEND_DIR="$SCRIPT_DIR" "$SCRIPT_DIR/bin/roadmap-audit" "$DIR" 2>&1 >/dev/null || true)
if echo "$STDERR" | grep -q "CONFIG_INVALID: env ROADMAP_MAX_TASKS_PER_TRACK='foo'"; then
  pass "config: non-numeric env var emits CONFIG_INVALID on stderr"
else
  fail "config: non-numeric env var emits CONFIG_INVALID on stderr" "$STDERR"
fi

# Zero-boundary: _is_positive_int rejects 0; ceiling falls through to default
DIR=$(make_modern_fixture "config-zero" '### Track 1A: Six
_6 tasks . low risk . [a]_
_touches: a_

- **T1** -- . (S)
- **T2** -- . (S)
- **T3** -- . (S)
- **T4** -- . (S)
- **T5** -- . (S)
- **T6** -- . (S)')
OUTPUT=$(run_audit_env "$DIR" ROADMAP_MAX_TASKS_PER_TRACK=0)
if echo "$OUTPUT" | grep -q "MAX_TASKS_PER_TRACK: 5"; then
  pass "config: zero override rejected, default used"
else
  fail "config: zero override rejected, default used"
fi

# Mixed SHARED_INFRA + PARALLEL intersection: SHARED_INFRA wins on first hit
DIR=$(create_fixture "coll-mixed")
mkdir -p "$DIR/docs" "$DIR/bin" "$DIR/src"
touch "$DIR/bin/config" "$DIR/src/foo.ts"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G

### Track 1A: A
_1 task . low risk . [x]_
_touches: bin/config, src/foo.ts_

- **T1** -- . (S)

### Track 1B: B
_1 task . low risk . [x]_
_touches: bin/config, src/foo.ts_

- **T1** -- . (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
echo "bin/config" > "$DIR/docs/shared-infra.txt"
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q '1A-1B:.*\[SHARED_INFRA\]'; then
  pass "collisions: mixed shared+non-shared overlap classifies SHARED_INFRA"
else
  fail "collisions: mixed shared+non-shared overlap classification"
fi

# Whitespace-only `_touches: _` should NOT silently promote to modern
DIR=$(make_modern_fixture "touches-empty" '### Track 1A: Stub
_1 task . low risk . [a]_
_touches:   _

- **T1** -- . (S)')
OUTPUT=$(run_audit "$DIR")
# Legacy-all behavior OR explicit warning both acceptable
if echo "$OUTPUT" | grep -q "LEGACY_TRACKS: 1A" \
   || echo "$OUTPUT" | grep -q "_touches:_ line is empty or whitespace-only"; then
  pass "parse: whitespace-only _touches:_ does NOT silently modern-ify"
else
  fail "parse: whitespace-only _touches:_ silently bypassed legacy check" "$(echo "$OUTPUT" | grep -E '^(## |LEGACY)')"
fi

# Touches value containing whitespace: reject, keep track modern with only valid files
DIR=$(make_modern_fixture "touches-space-in-value" '### Track 1A: A
_2 tasks . low risk . [a]_
_touches: a b.ts, c.ts_

- **T1** -- . (S)
- **T2** -- . (S)')
OUTPUT=$(run_audit "$DIR")
# Should warn about the malformed entry AND count only 1 file
if echo "$OUTPUT" | grep -q "contained tokens with whitespace"; then
  pass "parse: touches value with internal whitespace rejected with warning"
else
  fail "parse: touches value with internal whitespace rejected with warning"
fi

# ~0 lines hint should NOT divide-by-zero / false-positive mismatch
DIR=$(make_modern_fixture "size-zero-lines" '### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T1** -- nothing. _~0 lines._ (S)')
OUTPUT=$(run_audit "$DIR")
if ! echo "$OUTPUT" | grep -q "SIZE_LABEL_MISMATCH"; then
  pass "size: ~0 lines hint does not trigger mismatch (div-by-zero guard)"
else
  fail "size: ~0 lines hint triggered spurious mismatch"
fi

# Duplicate track IDs across Groups: warn via STYLE_LINT
DIR=$(create_fixture "dup-track-id")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G1

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T1** -- . (S)

## Group 2: G2

### Track 1A: AA
_1 task . low risk . [b]_
_touches: b_

- **T1** -- . (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "1A: duplicate track ID"; then
  pass "parse: duplicate track ID across Groups triggers STYLE_LINT warning"
else
  fail "parse: duplicate track ID warning missing" "$(echo "$OUTPUT" | grep -A3 '^## STYLE_LINT')"
fi

# Pre-flight bullets are NOT counted toward any Track (critical invariant)
DIR=$(create_fixture "preflight-isolation")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G

**Pre-flight** (shared-infra; serial):
- **P1** -- . (XL)
- **P2** -- . (XL)
- **P3** -- . (XL)
- **P4** -- . (XL)
- **P5** -- . (XL)
- **P6** -- . (XL)
- **P7** -- . (XL)

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T1** -- . (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
# 7 XL Pre-flight = 3500 LOC would blow every cap if they leaked into Track 1A
if section_status "$OUTPUT" "SIZE" | grep -q "pass"; then
  pass "preflight: Pre-flight bullets excluded from Track counters"
else
  fail "preflight: Pre-flight bullets leaked into Track 1A" "$(echo "$OUTPUT" | grep -A3 '^## SIZE')"
fi

# Self-reference Depends on: emits distinct warning, not "move to next Group"
DIR=$(create_fixture "style-self-ref")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: G

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

Depends on: Track 1A

- **T1** -- . (S)

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
if echo "$OUTPUT" | grep -q "Depends on itself"; then
  pass "style_lint: self-reference emits distinct warning"
else
  fail "style_lint: self-reference warning missing"
fi

# Brace-expansion bomb defense: pattern with `..` rejected
DIR=$(make_modern_fixture "brace-traversal" '### Track 1A: A
_1 task . low risk . [a]_
_touches: bin/config_

- **T1** -- . (S)

### Track 1B: B
_1 task . low risk . [a]_
_touches: bin/config_

- **T1** -- . (S)')
mkdir -p "$DIR/bin"
touch "$DIR/bin/config"
cat > "$DIR/docs/shared-infra.txt" << 'INFRAEOF'
../../../etc/passwd
bin/config
INFRAEOF
STDERR=$(GSTACK_EXTEND_DIR="$SCRIPT_DIR" "$SCRIPT_DIR/bin/roadmap-audit" "$DIR" 2>&1 >/dev/null || true)
if echo "$STDERR" | grep -q "skipping pattern containing '..'"; then
  pass "security: path-traversal pattern ('..') rejected"
else
  fail "security: path-traversal pattern not rejected" "$STDERR"
fi

echo ""
echo "=== group_deps ==="

# Fixture helper: multi-group roadmap with configurable Group bodies.
# Args: name, then body string containing full Group 1..N markup.
make_multi_group_fixture() {
  local name="$1" body="$2"
  local dir
  dir=$(create_fixture "$name")
  mkdir -p "$dir/docs"
  {
    echo "# Roadmap"
    echo ""
    printf '%s\n' "$body"
    echo ""
    echo "## Unprocessed"
  } > "$dir/docs/ROADMAP.md"
  echo "# TODOs" > "$dir/docs/TODOS.md"
  cat > "$dir/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
  echo "$dir"
}

# 1. No annotations → default "preceding Group" rule; adjacency reflects linear chain
DIR=$(make_multi_group_fixture "gd-default-linear" '## Group 1: First

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: Second

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "STATUS: pass" && echo "$GD" | grep -q "Group 2 ← {1}" && echo "$GD" | grep -q "Group 1 ← {}"; then
  pass "group_deps: default linear chain (no annotations)"
else
  fail "group_deps: default linear chain failed" "$GD"
fi

# 2. Explicit _Depends on: none_ → empty adjacency
DIR=$(make_multi_group_fixture "gd-explicit-none" '## Group 1: First

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: Second
_Depends on: none_

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "Group 2 ← {}"; then
  pass "group_deps: explicit 'none' = no deps"
else
  fail "group_deps: explicit 'none' failed" "$GD"
fi

# 3. Em-dash as "none"
DIR=$(make_multi_group_fixture "gd-em-dash" '## Group 1: First

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: Second
_Depends on: —_

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "Group 2 ← {}"; then
  pass "group_deps: em-dash recognized as 'none'"
else
  fail "group_deps: em-dash failed" "$GD"
fi

# 4. Single explicit ref
DIR=$(make_multi_group_fixture "gd-single-ref" '## Group 1: First

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: Second
_Depends on: none_

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)

## Group 3: Third
_Depends on: Group 1_

### Track 3A: A
_1 task . low risk . [c]_
_touches: c_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "Group 3 ← {1}"; then
  pass "group_deps: single explicit ref"
else
  fail "group_deps: single explicit ref failed" "$GD"
fi

# 5. Multi-ref (DAG join)
DIR=$(make_multi_group_fixture "gd-multi-ref" '## Group 1: A

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: B
_Depends on: Group 1_

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)

## Group 3: C
_Depends on: Group 1_

### Track 3A: A
_1 task . low risk . [c]_
_touches: c_

- **T** -- . (S)

## Group 4: Join
_Depends on: Group 2, Group 3_

### Track 4A: A
_1 task . low risk . [d]_
_touches: d_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "Group 4 ← {2,3}" && echo "$GD" | grep -q "STATUS: pass"; then
  pass "group_deps: multi-ref DAG join"
else
  fail "group_deps: multi-ref failed" "$GD"
fi

# 6. Name-anchored ref (matching current heading) → no STALE_DEPS warn
DIR=$(make_multi_group_fixture "gd-name-anchor-ok" '## Group 1: Foundation

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: Next
_Depends on: Group 1 (Foundation)_

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "STATUS: pass" && ! echo "$GD" | grep -q "now titled"; then
  pass "group_deps: name-anchor matches current heading"
else
  fail "group_deps: name-anchor should not warn when matching" "$GD"
fi

# 7. Name-anchored ref (drifted) → STALE_DEPS warn
DIR=$(make_multi_group_fixture "gd-name-anchor-stale" '## Group 1: Renamed

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: Next
_Depends on: Group 1 (Old Name)_

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "STATUS: warn" && echo "$GD" | grep -q 'now titled "Renamed"'; then
  pass "group_deps: STALE_DEPS warn on name drift"
else
  fail "group_deps: STALE_DEPS warn missing" "$GD"
fi

# 8. Cycle detection
DIR=$(make_multi_group_fixture "gd-cycle" '## Group 1: A
_Depends on: Group 2_

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: B
_Depends on: Group 1_

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "STATUS: fail" && echo "$GD" | grep -q "Cycle detected involving Groups: 1,2"; then
  pass "group_deps: cycle detected"
else
  fail "group_deps: cycle not detected" "$GD"
fi

# 9. Forward reference to nonexistent Group
DIR=$(make_multi_group_fixture "gd-forward-ref" '## Group 1: A
_Depends on: Group 99_

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "STATUS: fail" && echo "$GD" | grep -q "nonexistent Group 99"; then
  pass "group_deps: forward reference fails"
else
  fail "group_deps: forward reference not caught" "$GD"
fi

# 10. Redundant backwards-adjacent → STYLE_LINT warn
DIR=$(make_multi_group_fixture "gd-redundant-back" '## Group 1: A

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: B
_Depends on: Group 1_

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
SL=$(echo "$OUTPUT" | sed -n '/^## STYLE_LINT$/,/^## /p')
if echo "$SL" | grep -q "STATUS: warn" && echo "$SL" | grep -q "is redundant"; then
  pass "group_deps: redundant backwards-adjacent warns"
else
  fail "group_deps: redundant-backwards warn missing" "$SL"
fi

# 11. Non-redundant explicit ref (skips preceding) → no redundancy warn
DIR=$(make_multi_group_fixture "gd-nonredundant" '## Group 1: A

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: B
_Depends on: none_

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)

## Group 3: C
_Depends on: Group 1_

### Track 3A: A
_1 task . low risk . [c]_
_touches: c_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
SL=$(echo "$OUTPUT" | sed -n '/^## STYLE_LINT$/,/^## /p')
if ! echo "$SL" | grep -q "is redundant"; then
  pass "group_deps: explicit ref that skips preceding is not redundant"
else
  fail "group_deps: false-positive redundancy on non-adjacent ref" "$SL"
fi

# 12. Backward compat: legacy roadmap with no annotations still passes
DIR=$(make_multi_group_fixture "gd-legacy-compat" '## Group 1: A

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: B

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)

## Group 3: C

### Track 3A: A
_1 task . low risk . [c]_
_touches: c_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "STATUS: pass" && echo "$GD" | grep -q "Group 3 ← {2}"; then
  pass "group_deps: backward compat — no annotations still valid"
else
  fail "group_deps: backward compat broken" "$GD"
fi

# 13. Adjacency list always emitted (even on pass)
DIR=$(make_multi_group_fixture "gd-adjacency-always" '## Group 1: A

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "^ADJACENCY:" && echo "$GD" | grep -q "Group 1 ← {}"; then
  pass "group_deps: adjacency list always emitted"
else
  fail "group_deps: adjacency list missing" "$GD"
fi

# 14. Empty roadmap (no groups) → skip
DIR=$(create_fixture "gd-empty")
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap

## Unprocessed
EOF
echo "# TODOs" > "$DIR/docs/TODOS.md"
cat > "$DIR/docs/PROGRESS.md" << 'PROGEOF'
| Version | Date | Summary |
|---------|------|---------|
| 0.1.0 | 2026-01-01 | Init |
PROGEOF
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "STATUS: skip" && echo "$GD" | grep -q "No Groups in ROADMAP.md"; then
  pass "group_deps: empty roadmap → skip status"
else
  fail "group_deps: empty roadmap not skipped" "$GD"
fi

# 15. Own ROADMAP.md passes clean (regression)
OUTPUT=$(GSTACK_EXTEND_DIR="$SCRIPT_DIR" "$SCRIPT_DIR/bin/roadmap-audit" "$SCRIPT_DIR" 2>/dev/null || true)
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "STATUS: pass"; then
  pass "group_deps: own ROADMAP.md passes GROUP_DEPS"
else
  fail "group_deps: own ROADMAP.md fails GROUP_DEPS" "$GD"
fi

# 16. Group 1 with no preceding Group and no annotation → no deps (not a forward ref)
DIR=$(make_multi_group_fixture "gd-first-group" '## Group 1: Only

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "STATUS: pass" && echo "$GD" | grep -q "Group 1 ← {}"; then
  pass "group_deps: Group 1 alone has no implicit dep"
else
  fail "group_deps: Group 1 implicit dep wrong" "$GD"
fi

# 17. Cycle-with-redundant: cycle takes precedence over redundancy warn
DIR=$(make_multi_group_fixture "gd-cycle-priority" '## Group 1: A
_Depends on: Group 2_

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: B

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "STATUS: fail"; then
  pass "group_deps: cycle via implicit default still detected"
else
  fail "group_deps: implicit cycle not detected" "$GD"
fi

# 18. Name-anchor syntax with spaces in name
DIR=$(make_multi_group_fixture "gd-name-spaces" '## Group 1: Core App Ready

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: Next
_Depends on: Group 1 (Core App Ready)_

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
if echo "$GD" | grep -q "STATUS: pass" && ! echo "$GD" | grep -q "now titled"; then
  pass "group_deps: name-anchor with spaces matches correctly"
else
  fail "group_deps: name-anchor with spaces mismatched" "$GD"
fi

# 19. Unparseable annotation → STYLE_LINT warn (no silent dropout)
DIR=$(make_multi_group_fixture "gd-unparseable" '## Group 1: A

### Track 1A: A
_1 task . low risk . [a]_
_touches: a_

- **T** -- . (S)

## Group 2: B
_Depends on: whenever bolt is ready_

### Track 2A: A
_1 task . low risk . [b]_
_touches: b_

- **T** -- . (S)')
OUTPUT=$(run_audit "$DIR")
SL=$(echo "$OUTPUT" | sed -n '/^## STYLE_LINT$/,/^## /p')
if echo "$SL" | grep -q "STATUS: warn" && echo "$SL" | grep -q "unparseable"; then
  pass "group_deps: unparseable annotation warns (no silent dropout)"
else
  fail "group_deps: unparseable annotation not warned" "$SL"
fi

# ─── v0.15.1: source-tag contract + closure infrastructure ────

echo ""
echo "=== complete_groups ==="

# Complete-group detection strips ' ✓ Complete' suffix and populates _COMPLETE_GROUPS.
DIR=$(create_fixture "complete-groups-basic")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: Shipped Work ✓ Complete

Shipped as v0.5.0. All 2 tasks landed.

### Track 1A: Done
_1 task . low risk . a_
_touches: a_
- **Done task** -- . (S)

## Group 2: Active Work

### Track 2A: Ongoing
_1 task . low risk . b_
_touches: b_
- **Active task** -- . (S)
EOF
OUTPUT=$(run_audit "$DIR")
IFG=$(echo "$OUTPUT" | sed -n '/^## IN_FLIGHT_GROUPS$/,/^## /p')
if echo "$IFG" | grep -q "COMPLETE: 1" && echo "$IFG" | grep -q "IN_FLIGHT: 2"; then
  pass "complete_groups: heading-embedded ✓ Complete detected"
else
  fail "complete_groups: ✓ Complete not detected" "$IFG"
fi
if echo "$IFG" | grep -q "PRIMARY: 2"; then
  pass "complete_groups: PRIMARY is first non-complete Group"
else
  fail "complete_groups: PRIMARY wrong" "$IFG"
fi
# STRUCTURAL_FITNESS excludes complete groups from active counts
SF=$(echo "$OUTPUT" | sed -n '/^## STRUCTURAL_FITNESS$/,/^## /p')
if echo "$SF" | grep -q "GROUP_COUNT: 1"; then
  pass "complete_groups: STRUCTURAL_FITNESS excludes complete Groups"
else
  fail "complete_groups: STRUCTURAL_FITNESS leaked" "$SF"
fi
# TASK_LIST keeps complete Groups as ground truth, with complete=1 flag.
# (files= is parsed from task-line italic [...], not track _touches:_, so
# fixtures with no task-level files annotation emit files=.)
TL=$(echo "$OUTPUT" | sed -n '/^## TASK_LIST$/,/^## /p')
if echo "$TL" | grep -q "group=1|track=1A|title=Done task|effort=S|files=|complete=1"; then
  pass "complete_groups: TASK_LIST emits complete=1 for shipped tasks"
else
  fail "complete_groups: TASK_LIST complete flag missing" "$TL"
fi
if echo "$TL" | grep -q "group=2|track=2A|title=Active task|effort=S|files=|complete=0"; then
  pass "complete_groups: TASK_LIST emits complete=0 for active tasks"
else
  fail "complete_groups: TASK_LIST active flag wrong" "$TL"
fi

# Group names with the suffix don't pollute _GROUP_NAMES.
DIR=$(create_fixture "complete-groups-name-strip")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: State Architecture ✓ Complete

Shipped.

### Track 1A: x
_1 task . low risk . a_
_touches: a_
- **X** -- . (S)

## Group 2: Foo

_Depends on: Group 1 (State Architecture)_

### Track 2A: y
_1 task . low risk . b_
_touches: b_
- **Y** -- . (S)
EOF
OUTPUT=$(run_audit "$DIR")
GD=$(echo "$OUTPUT" | sed -n '/^## GROUP_DEPS$/,/^## /p')
# Name anchor should match "State Architecture", NOT "State Architecture ✓ Complete"
if ! echo "$GD" | grep -q "STALE_DEPS"; then
  pass "complete_groups: name-anchor matches stripped name (no STALE_DEPS)"
else
  fail "complete_groups: stripped name caused false STALE_DEPS" "$GD"
fi

# Multiple complete groups in a chain
DIR=$(create_fixture "complete-groups-chain")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: A ✓ Complete

### Track 1A: a
_1 task . low risk . a_
_touches: a_
- **A** -- . (S)

## Group 2: B ✓ Complete

### Track 2A: b
_1 task . low risk . b_
_touches: b_
- **B** -- . (S)

## Group 3: C

### Track 3A: c
_1 task . low risk . c_
_touches: c_
- **C** -- . (S)
EOF
OUTPUT=$(run_audit "$DIR")
IFG=$(echo "$OUTPUT" | sed -n '/^## IN_FLIGHT_GROUPS$/,/^## /p')
if echo "$IFG" | grep -q "COMPLETE: 1 2" && echo "$IFG" | grep -q "IN_FLIGHT: 3" && echo "$IFG" | grep -q "PRIMARY: 3"; then
  pass "complete_groups: chain of complete Groups, in-flight frontier correct"
else
  fail "complete_groups: chain detection wrong" "$IFG"
fi

echo ""
echo "=== in_flight_topo ==="

# DAG with _Depends on: none_ — Group 3 runnable even if Group 2 isn't.
DIR=$(create_fixture "in-flight-dag")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: Root ✓ Complete

### Track 1A: a
_1 task . low risk . a_
_touches: a_
- **A** -- . (S)

## Group 2: Active On 1

### Track 2A: b
_1 task . low risk . b_
_touches: b_
- **B** -- . (S)

## Group 3: Parallel Root

_Depends on: none_

### Track 3A: c
_1 task . low risk . c_
_touches: c_
- **C** -- . (S)
EOF
OUTPUT=$(run_audit "$DIR")
IFG=$(echo "$OUTPUT" | sed -n '/^## IN_FLIGHT_GROUPS$/,/^## /p')
# Both Group 2 (deps met, Group 1 complete) AND Group 3 (no deps) are in-flight.
if echo "$IFG" | grep -q "IN_FLIGHT: 2 3" && echo "$IFG" | grep -q "PRIMARY: 2"; then
  pass "in_flight_topo: DAG multiple runnable Groups, doc-order tiebreaker for PRIMARY"
else
  fail "in_flight_topo: DAG topology wrong" "$IFG"
fi

# In-flight with unmet deps — Group depending on incomplete Group is NOT in-flight.
DIR=$(create_fixture "in-flight-blocked")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: Root

### Track 1A: a
_1 task . low risk . a_
_touches: a_
- **A** -- . (S)

## Group 2: Blocked By 1

### Track 2A: b
_1 task . low risk . b_
_touches: b_
- **B** -- . (S)
EOF
OUTPUT=$(run_audit "$DIR")
IFG=$(echo "$OUTPUT" | sed -n '/^## IN_FLIGHT_GROUPS$/,/^## /p')
# Group 1 is the only in-flight Group (Group 2 depends on incomplete Group 1).
if echo "$IFG" | grep -q "IN_FLIGHT: 1" && ! echo "$IFG" | grep -q "IN_FLIGHT: 1 2"; then
  pass "in_flight_topo: Group with unmet deps excluded"
else
  fail "in_flight_topo: Group with unmet deps leaked" "$IFG"
fi

# No Groups → STATUS: skip
DIR=$(create_fixture "in-flight-empty")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Future
- **Some future thing** — future. _Deferred._
EOF
OUTPUT=$(run_audit "$DIR")
IFG=$(echo "$OUTPUT" | sed -n '/^## IN_FLIGHT_GROUPS$/,/^## /p')
if echo "$IFG" | grep -q "STATUS: skip"; then
  pass "in_flight_topo: no Groups → skip"
else
  fail "in_flight_topo: no Groups not skipped" "$IFG"
fi

echo ""
echo "=== origin_stats ==="

DIR=$(create_fixture "origin-stats-basic")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed

### [pair-review:group=2,item=3] Bug A
- **Why:** one.

### [pair-review:group=2,item=5] Bug B
- **Why:** two.

### [pair-review:group=3,item=1] Bug C
- **Why:** three.

### [manual] Unrelated
- **Why:** not origin-tagged.

### [pair-review:group=pre-test] Pre-test bug
- **Why:** non-numeric group — should not count.
EOF
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 2: Active
### Track 2A: x
_1 task . low risk . x_
_touches: x_
- **X** -- . (S)

## Group 3: Active2
### Track 3A: y
_1 task . low risk . y_
_touches: y_
- **Y** -- . (S)
EOF
OUTPUT=$(run_audit "$DIR")
OS=$(echo "$OUTPUT" | sed -n '/^## ORIGIN_STATS$/,/^## /p')
if echo "$OS" | grep -q "TOTAL_OPEN_ORIGIN: 3"; then
  pass "origin_stats: counts numeric group-tagged items only"
else
  fail "origin_stats: wrong total" "$OS"
fi
if echo "$OS" | grep -q "BY_GROUP: 2=2,3=1"; then
  pass "origin_stats: per-group counts correct"
else
  fail "origin_stats: per-group counts wrong" "$OS"
fi

# No TODOS file → skip
DIR=$(create_fixture "origin-stats-no-todos")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: x
### Track 1A: y
_1 task . low risk . y_
_touches: y_
- **Y** -- . (S)
EOF
OUTPUT=$(run_audit "$DIR")
OS=$(echo "$OUTPUT" | sed -n '/^## ORIGIN_STATS$/,/^## /p')
if echo "$OS" | grep -q "STATUS: skip"; then
  pass "origin_stats: no TODOS.md → skip"
else
  fail "origin_stats: no TODOS.md not skipped" "$OS"
fi

echo ""
echo "=== todo_format ==="

# Clean rich-format entries pass.
DIR=$(create_fixture "todo-format-clean")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed

### [manual] Good entry
- **Why:** test.

### [pair-review:group=1,item=2] Another good entry
- **Why:** test.
EOF
OUTPUT=$(run_audit "$DIR")
TF=$(echo "$OUTPUT" | sed -n '/^## TODO_FORMAT$/,/^## /p')
if echo "$TF" | grep -q "STATUS: pass" && echo "$TF" | grep -q "HEADINGS: 2"; then
  pass "todo_format: rich entries pass validator"
else
  fail "todo_format: rich entries should pass" "$TF"
fi

# Legacy bullet entries fail with MALFORMED_HEADING.
DIR=$(create_fixture "todo-format-legacy-bullet")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed
- [pair-review] Legacy bullet form
- [manual] Another legacy bullet
EOF
OUTPUT=$(run_audit "$DIR")
TF=$(echo "$OUTPUT" | sed -n '/^## TODO_FORMAT$/,/^## /p')
if echo "$TF" | grep -q "STATUS: fail" && echo "$TF" | grep -qc "MALFORMED_HEADING"; then
  pass "todo_format: legacy bullet entries flagged MALFORMED_HEADING"
else
  fail "todo_format: legacy bullets not flagged" "$TF"
fi

# Unknown source tag flagged.
DIR=$(create_fixture "todo-format-unknown-source")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed

### [made-up-source] Bogus tag
- **Why:** should fail.
EOF
OUTPUT=$(run_audit "$DIR")
TF=$(echo "$OUTPUT" | sed -n '/^## TODO_FORMAT$/,/^## /p')
if echo "$TF" | grep -q "UNKNOWN_SOURCE"; then
  pass "todo_format: unknown source flagged"
else
  fail "todo_format: unknown source not flagged" "$TF"
fi

# Injection attempt flagged.
DIR=$(create_fixture "todo-format-injection")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed

### [pair-review:group=1`rm -rf /`] Injection attempt
- **Why:** should fail.
EOF
OUTPUT=$(run_audit "$DIR")
TF=$(echo "$OUTPUT" | sed -n '/^## TODO_FORMAT$/,/^## /p')
if echo "$TF" | grep -q "INJECTION_ATTEMPT\|MALFORMED_TAG"; then
  pass "todo_format: injection chars rejected"
else
  fail "todo_format: injection not rejected" "$TF"
fi

# Missing tag is permitted (treated as manual by scrutiny gate).
DIR=$(create_fixture "todo-format-untagged")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed

### Untagged entry
- **Why:** still valid (treated as manual).
EOF
OUTPUT=$(run_audit "$DIR")
TF=$(echo "$OUTPUT" | sed -n '/^## TODO_FORMAT$/,/^## /p')
if echo "$TF" | grep -q "STATUS: pass"; then
  pass "todo_format: untagged entries pass (treated as manual)"
else
  fail "todo_format: untagged entries rejected" "$TF"
fi

# Malformed tag (unclosed bracket) flagged as MALFORMED_HEADING, NOT
# silently accepted as untagged. Regression test for adversarial-review
# finding: `### [pair-review:group=2 Unclosed` was previously bypassed.
DIR=$(create_fixture "todo-format-unclosed-bracket")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed

### [pair-review:group=2 Unclosed tag broken
- **Why:** should flag, not silently become manual.
EOF
OUTPUT=$(run_audit "$DIR")
TF=$(echo "$OUTPUT" | sed -n '/^## TODO_FORMAT$/,/^## /p')
if echo "$TF" | grep -q "STATUS: fail" && echo "$TF" | grep -q "unclosed tag bracket"; then
  pass "todo_format: unclosed tag bracket flagged MALFORMED_HEADING"
else
  fail "todo_format: unclosed bracket bypassed validation" "$TF"
fi

# Fence awareness: '### entry' inside a ``` fence inside ## Unprocessed
# must NOT count as a real item, and '- [tag]' inside a fence must NOT
# trigger MALFORMED_HEADING.
DIR=$(create_fixture "todo-format-fence-aware")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed

### [manual] Real entry
- **Why:** this is a real item.
- **Example:** the entry inside the fence below should be ignored:

```markdown
### [pair-review:group=999] Documentation example
- [full-review] Legacy bullet inside a fence — should not be flagged
```

### [manual] Second real entry
- **Why:** after the fence closes.
EOF
OUTPUT=$(run_audit "$DIR")
UNPROC=$(echo "$OUTPUT" | sed -n '/^## UNPROCESSED$/,/^## /p')
TF=$(echo "$OUTPUT" | sed -n '/^## TODO_FORMAT$/,/^## /p')
# UNPROCESSED counts ONLY the two real entries, not the fenced ones.
if echo "$UNPROC" | grep -q "ITEMS: 2"; then
  pass "fence-aware: ### entries inside fences not counted"
else
  fail "fence-aware: fenced ### miscounted" "$UNPROC"
fi
# TODO_FORMAT does NOT flag fenced content.
if echo "$TF" | grep -q "STATUS: pass"; then
  pass "fence-aware: TODO_FORMAT ignores fenced content"
else
  fail "fence-aware: TODO_FORMAT false positive in fence" "$TF"
fi

# Legacy bullet migration signal: bullet-form entries with zero heading
# entries should produce STATUS: found (not empty) so /roadmap doesn't
# early-exit "nothing to do" on an unmigrated inbox.
DIR=$(create_fixture "todo-format-legacy-only")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed
- [pair-review] Bug A
- [manual] Todo B
EOF
OUTPUT=$(run_audit "$DIR")
UNPROC=$(echo "$OUTPUT" | sed -n '/^## UNPROCESSED$/,/^## /p')
if echo "$UNPROC" | grep -q "STATUS: found" && echo "$UNPROC" | grep -q "LEGACY_BULLETS: 2"; then
  pass "legacy-bullets: bullet-only inbox signals found (not empty)"
else
  fail "legacy-bullets: bullet-only inbox mis-signaled" "$UNPROC"
fi

# DAG ordering consistency — check_in_flight_groups uses numeric sort.
# Regression test for adversarial finding: doc order != numeric order
# when Groups are manually reordered.
DIR=$(create_fixture "in-flight-numeric-sort")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 10: Later-numbered but earlier in file

### Track 10A: x
_1 task . low risk . x_
_touches: x_
- **X** -- . (S)

## Group 1: Earlier number, later in file ✓ Complete

### Track 1A: a
_1 task . low risk . a_
_touches: a_
- **A** -- . (S)
EOF
OUTPUT=$(run_audit "$DIR")
IFG=$(echo "$OUTPUT" | sed -n '/^## IN_FLIGHT_GROUPS$/,/^## /p')
# Group 10 depends (implicitly, numeric order) on Group 1. Group 1 is
# complete, so Group 10 is in-flight.
if echo "$IFG" | grep -q "IN_FLIGHT: 10"; then
  pass "in_flight_topo: numeric-sorted implicit-prev (not doc order)"
else
  fail "in_flight_topo: doc order leaked in dep resolution" "$IFG"
fi

# Unknown deps: reference a nonexistent Group. Frontier should record
# UNKNOWN_DEPS warning and exclude the Group from in-flight.
DIR=$(create_fixture "in-flight-unknown-dep")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: Points at a phantom

_Depends on: Group 99_

### Track 1A: x
_1 task . low risk . x_
_touches: x_
- **X** -- . (S)
EOF
OUTPUT=$(run_audit "$DIR")
IFG=$(echo "$OUTPUT" | sed -n '/^## IN_FLIGHT_GROUPS$/,/^## /p')
if echo "$IFG" | grep -q "UNKNOWN_DEPS: 1→99"; then
  pass "in_flight_topo: forward-ref emits UNKNOWN_DEPS warning"
else
  fail "in_flight_topo: forward-ref silent" "$IFG"
fi

# ─── Compact bullet form (v0.16.1) ────────────────────────────
#
# Regression: the '- **[tag] Title** — body' compact form was silently ignored
# by both the UNPROCESSED item counter and the TODO_FORMAT validator, letting
# real items sit in the inbox while the audit reported "0 unprocessed." Both
# passes must now flag it.

echo "=== compact-bullet form ==="

DIR=$(create_fixture "compact-bullet-only")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed

- **[pair-review] Compact bug** — body text explaining what and why.
- **[manual] Second compact** — another one.
EOF
OUTPUT=$(run_audit "$DIR")
UNPROC=$(echo "$OUTPUT" | sed -n '/^## UNPROCESSED$/,/^## /p')
TF=$(echo "$OUTPUT" | sed -n '/^## TODO_FORMAT$/,/^## /p')
if echo "$UNPROC" | grep -q "STATUS: found" && echo "$UNPROC" | grep -q "COMPACT_BULLETS: 2"; then
  pass "compact-bullet: UNPROCESSED surfaces status=found + count"
else
  fail "compact-bullet: UNPROCESSED missed compact form" "$UNPROC"
fi
if echo "$TF" | grep -q "STATUS: fail" && echo "$TF" | grep -q "compact bold-form entry"; then
  pass "compact-bullet: TODO_FORMAT flags MALFORMED_HEADING"
else
  fail "compact-bullet: TODO_FORMAT missed compact form" "$TF"
fi

# Mixed inbox: compact + rich + legacy all counted and flagged separately.
DIR=$(create_fixture "compact-bullet-mixed")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed

### [manual] Rich entry
- **Why:** baseline.

- **[pair-review] Compact entry** — body.

- [full-review] Legacy entry
EOF
OUTPUT=$(run_audit "$DIR")
UNPROC=$(echo "$OUTPUT" | sed -n '/^## UNPROCESSED$/,/^## /p')
TF=$(echo "$OUTPUT" | sed -n '/^## TODO_FORMAT$/,/^## /p')
if echo "$UNPROC" | grep -q "ITEMS: 1" \
   && echo "$UNPROC" | grep -q "COMPACT_BULLETS: 1" \
   && echo "$UNPROC" | grep -q "LEGACY_BULLETS: 1"; then
  pass "compact-bullet: mixed inbox counts each form separately"
else
  fail "compact-bullet: mixed inbox miscounted" "$UNPROC"
fi
if echo "$TF" | grep -q "STATUS: fail" \
   && echo "$TF" | grep -q "compact bold-form" \
   && echo "$TF" | grep -q "legacy bullet entry"; then
  pass "compact-bullet: TODO_FORMAT flags both compact and legacy"
else
  fail "compact-bullet: TODO_FORMAT missed one form" "$TF"
fi

# Compact form inside a ``` fence is ignored (documentation example).
DIR=$(create_fixture "compact-bullet-fence")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed

### [manual] Real entry
- **Why:** real.

```markdown
- **[pair-review] Example in docs** — this is just a docs example.
```
EOF
OUTPUT=$(run_audit "$DIR")
UNPROC=$(echo "$OUTPUT" | sed -n '/^## UNPROCESSED$/,/^## /p')
TF=$(echo "$OUTPUT" | sed -n '/^## TODO_FORMAT$/,/^## /p')
if echo "$UNPROC" | grep -q "COMPACT_BULLETS: 0" && echo "$TF" | grep -q "STATUS: pass"; then
  pass "compact-bullet: fenced compact examples ignored"
else
  fail "compact-bullet: fence leaked into count or validator" "UNPROC:$UNPROC TF:$TF"
fi

# ─── pyproject.toml as version source (v0.16.1) ───────────────
#
# Python projects whose source of truth is pyproject.toml's `version =` field
# should not be forced to maintain a parallel VERSION file. The audit must
# accept either source, and report which it read via a SOURCE: field.

echo "=== pyproject version source ==="

DIR=$(create_fixture "pyproject-only")
# Remove the VERSION file created by create_fixture.
rm -f "$DIR/VERSION"
cat > "$DIR/pyproject.toml" << 'EOF'
[project]
name = "example"
version = "1.2.3"
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "pyproject" --quiet
OUTPUT=$(run_audit "$DIR")
VER=$(echo "$OUTPUT" | sed -n '/^## VERSION$/,/^## /p')
TAX=$(echo "$OUTPUT" | sed -n '/^## TAXONOMY$/,/^## /p')
if echo "$VER" | grep -q "CURRENT: 1.2.3" && echo "$VER" | grep -q "SOURCE: pyproject.toml"; then
  pass "pyproject: VERSION check reads from pyproject.toml"
else
  fail "pyproject: VERSION check didn't pick up pyproject.toml" "$VER"
fi
if ! echo "$TAX" | grep -q "VERSION: missing"; then
  pass "pyproject: TAXONOMY doesn't fail when pyproject version exists"
else
  fail "pyproject: TAXONOMY still flags VERSION as missing" "$TAX"
fi

# VERSION file wins when both exist.
DIR=$(create_fixture "pyproject-and-version")
echo "2.0.0" > "$DIR/VERSION"
cat > "$DIR/pyproject.toml" << 'EOF'
[project]
name = "example"
version = "9.9.9"
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "both" --quiet
OUTPUT=$(run_audit "$DIR")
VER=$(echo "$OUTPUT" | sed -n '/^## VERSION$/,/^## /p')
if echo "$VER" | grep -q "CURRENT: 2.0.0" && echo "$VER" | grep -q "SOURCE: VERSION"; then
  pass "pyproject: VERSION file wins when both sources present"
else
  fail "pyproject: fallback precedence wrong" "$VER"
fi

# Neither source present — still skips with an informative message.
DIR=$(create_fixture "pyproject-neither")
rm -f "$DIR/VERSION"
OUTPUT=$(run_audit "$DIR")
VER=$(echo "$OUTPUT" | sed -n '/^## VERSION$/,/^## /p')
TAX=$(echo "$OUTPUT" | sed -n '/^## TAXONOMY$/,/^## /p')
if echo "$VER" | grep -q "STATUS: skip" && echo "$VER" | grep -q "No VERSION file or pyproject.toml"; then
  pass "pyproject: neither source → skip with informative message"
else
  fail "pyproject: missing both sources mis-signaled" "$VER"
fi
if echo "$TAX" | grep -q "VERSION: missing"; then
  pass "pyproject: TAXONOMY flags missing when neither source present"
else
  fail "pyproject: TAXONOMY silent when neither source present" "$TAX"
fi

# ─── STYLE_LINT: Depends on: trailing prose tolerance (v0.16.1) ─
#
# Human-readable parentheticals and trailing clauses are valid:
# "_Depends on: Group 5 (Auto-command) landing first before Group 7_"
# The parser captures dep_num=5 and dep_name="Auto-command" for anchoring;
# everything after must not cause the annotation to be dropped as unparseable.

echo "=== depends_on trailing prose ==="

DIR=$(create_fixture "deps-trailing-prose")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: Foundation

### Track 1A: setup
_1 task . low risk . a_
_touches: a_
- **A** — . (S)

## Group 2: Builds on foundation

_Depends on: Group 1 (Foundation) landing first before anything else_

### Track 2A: follow-up
_1 task . low risk . b_
_touches: b_
- **B** — . (S)
EOF
OUTPUT=$(run_audit "$DIR")
SL=$(echo "$OUTPUT" | sed -n '/^## STYLE_LINT$/,/^## /p')
IFG=$(echo "$OUTPUT" | sed -n '/^## IN_FLIGHT_GROUPS$/,/^## /p')
# No "unparseable" warning — prose is tolerated.
if ! echo "$SL" | grep -q "unparseable"; then
  pass "depends-on: trailing prose accepted (no unparseable warning)"
else
  fail "depends-on: trailing prose rejected as unparseable" "$SL"
fi
# Dep still resolves — in_flight sees Group 2 depending on Group 1.
if echo "$IFG" | grep -q "UNKNOWN_DEPS"; then
  fail "depends-on: trailing prose broke dep resolution" "$IFG"
else
  pass "depends-on: trailing prose resolves dep cleanly"
fi

# ─── Track-dep DAG + serialize (v0.16.2) ──────────────────────
#
# Intra-group `Depends on: Track NX` is the canonical serialization signal.
# COLLISIONS skips pairs where one depends on the other (direct or transitive);
# STYLE_LINT no longer warns on intra-group deps (they're valid DAG expressions);
# cycles in the intra-group graph are detected + warned.
# `_serialize: true_` survives as shorthand for "every Track depends on its
# predecessor in document order" — equivalent to writing `Depends on:` on each
# non-first Track.

echo "=== track-dep DAG + serialize ==="

# Two tracks touch the same file with NO Depends on: → COLLISIONS fails.
# This is the real collision case the DAG logic must still catch.
DIR=$(create_fixture "dag-no-deps-collides")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: Real collision

### Track 1A: region one
_2 tasks . low risk . cli.py_
_touches: cli.py_
- **Fix region one** — . (S)

### Track 1B: region two
_2 tasks . low risk . cli.py_
_touches: cli.py_
- **Fix region two** — . (S)
EOF
OUTPUT=$(run_audit "$DIR")
COL=$(echo "$OUTPUT" | sed -n '/^## COLLISIONS$/,/^## /p')
if echo "$COL" | grep -q "STATUS: fail" && echo "$COL" | grep -q "1A-1B"; then
  pass "dag: no-deps overlap still fails COLLISIONS"
else
  fail "dag: no-deps overlap missed by COLLISIONS" "$COL"
fi

# Track 1B Depends on 1A → COLLISIONS skips (valid DAG expression),
# STYLE_LINT silent on intra-group deps.
DIR=$(create_fixture "dag-direct-dep")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: Declared serial

### Track 1A: region one
_2 tasks . low risk . cli.py_
_touches: cli.py_
- **Fix region one** — . (S)

### Track 1B: region two
_2 tasks . low risk . cli.py_
_touches: cli.py_
Depends on: Track 1A
- **Fix region two** — . (S)
EOF
OUTPUT=$(run_audit "$DIR")
COL=$(echo "$OUTPUT" | sed -n '/^## COLLISIONS$/,/^## /p')
SL=$(echo "$OUTPUT" | sed -n '/^## STYLE_LINT$/,/^## /p')
if echo "$COL" | grep -q "STATUS: pass"; then
  pass "dag: direct intra-group Depends on auto-serializes (COLLISIONS pass)"
else
  fail "dag: direct intra-group Depends on didn't skip pair" "$COL"
fi
if ! echo "$SL" | grep -q "same Group"; then
  pass "dag: intra-group Depends on no longer warns (valid DAG)"
else
  fail "dag: STYLE_LINT still complaining about intra-group dep" "$SL"
fi

# Transitive deps: 1C → 1B → 1A, all three touch the same file → COLLISIONS
# must skip all three pairs (1A-1B, 1A-1C, 1B-1C).
DIR=$(create_fixture "dag-transitive")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: Three-track chain

### Track 1A: region one
_2 tasks . low risk . cli.py_
_touches: cli.py_
- **Fix region one** — . (S)

### Track 1B: region two
_2 tasks . low risk . cli.py_
_touches: cli.py_
Depends on: Track 1A
- **Fix region two** — . (S)

### Track 1C: region three
_2 tasks . low risk . cli.py_
_touches: cli.py_
Depends on: Track 1B
- **Fix region three** — . (S)
EOF
OUTPUT=$(run_audit "$DIR")
COL=$(echo "$OUTPUT" | sed -n '/^## COLLISIONS$/,/^## /p')
if echo "$COL" | grep -q "STATUS: pass"; then
  pass "dag: transitive deps skip all pairs (A→B→C covers A-C)"
else
  fail "dag: transitive closure not covering A-C pair" "$COL"
fi

# `_serialize: true_` is shorthand — expands to implicit Depends on chain in
# document order. Same-file overlap across all tracks must pass COLLISIONS.
DIR=$(create_fixture "dag-serialize-shorthand")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: Mono-file batch

_serialize: true_

### Track 1A: region one
_2 tasks . low risk . cli.py_
_touches: cli.py_
- **Fix region one** — . (S)

### Track 1B: region two
_2 tasks . low risk . cli.py_
_touches: cli.py_
- **Fix region two** — . (S)

### Track 1C: region three
_2 tasks . low risk . cli.py_
_touches: cli.py_
- **Fix region three** — . (S)
EOF
OUTPUT=$(run_audit "$DIR")
COL=$(echo "$OUTPUT" | sed -n '/^## COLLISIONS$/,/^## /p')
if echo "$COL" | grep -q "STATUS: pass" && echo "$COL" | grep -q "SERIALIZED_GROUPS:"; then
  pass "dag: _serialize: true_ shorthand expands into implicit chain"
else
  fail "dag: _serialize: true_ shorthand didn't work" "$COL"
fi

# Cycle detection: 1A Depends on 1B, 1B Depends on 1A → STYLE_LINT warns.
DIR=$(create_fixture "dag-cycle")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: Broken chain

### Track 1A: first
_2 tasks . low risk . a.py_
_touches: a.py_
Depends on: Track 1B
- **A** — . (S)

### Track 1B: second
_2 tasks . low risk . b.py_
_touches: b.py_
Depends on: Track 1A
- **B** — . (S)
EOF
OUTPUT=$(run_audit "$DIR")
SL=$(echo "$OUTPUT" | sed -n '/^## STYLE_LINT$/,/^## /p')
if echo "$SL" | grep -q "STATUS: warn" && echo "$SL" | grep -q "Dep cycle"; then
  pass "dag: intra-group cycle detected + warned"
else
  fail "dag: cycle not flagged" "$SL"
fi
# Lock in the cycle render format — previously emitted "1A → 1B → 1B → 1A"
# with a spurious duplicated node. The path should close cleanly: tip → dep.
if echo "$SL" | grep -qE '1A → 1B → 1A|1B → 1A → 1B'; then
  pass "dag: cycle render closes tip → dep without node duplication"
else
  fail "dag: cycle render malformed" "$SL"
fi
# Cycle dedup via canonical rotation: a 2-node cycle should emit exactly ONE
# warning, not two ("1A → 1B → 1A" AND "1B → 1A → 1B"). DFS visits both roots
# but lex-smallest rotation maps both walks to the same canonical string.
CYCLE_LINES=$(echo "$SL" | grep -c "Dep cycle" || true)
if [ "$CYCLE_LINES" = "1" ]; then
  pass "dag: cycle dedup — one warning per cycle (canonical rotation)"
else
  fail "dag: cycle dedup — got $CYCLE_LINES warnings, expected 1" "$SL"
fi
# 3-node cycle preserves direction in canonical form.
DIR=$(create_fixture "dag-cycle-three")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap

## Group 1: Three-node cycle

### Track 1A: a
_2 tasks . low risk . a.py_
_touches: a.py_
Depends on: Track 1C
- **A** — . (S)

### Track 1B: b
_2 tasks . low risk . b.py_
_touches: b.py_
Depends on: Track 1A
- **B** — . (S)

### Track 1C: c
_2 tasks . low risk . c.py_
_touches: c.py_
Depends on: Track 1B
- **C** — . (S)
EOF
OUTPUT=$(run_audit "$DIR")
SL=$(echo "$OUTPUT" | sed -n '/^## STYLE_LINT$/,/^## /p')
CYCLE_LINES=$(echo "$SL" | grep -c "Dep cycle" || true)
# 3-node cycle: 1A→1C→1B→1A. DFS roots may produce three rotations; canonical
# (lex-smallest first) collapses them to one entry. Direction is preserved.
if [ "$CYCLE_LINES" = "1" ] && echo "$SL" | grep -qE '1A → 1C → 1B → 1A'; then
  pass "dag: 3-node cycle dedups + renders in canonical direction"
else
  fail "dag: 3-node cycle dedup or render off — got $CYCLE_LINES warnings" "$SL"
fi

# ─── Empty VERSION file diagnostic (v0.16.2) ──────────────────
#
# An empty VERSION file is a misconfiguration, not "no version source." The
# audit must distinguish from absent VERSION + absent pyproject so the user
# sees a clear "VERSION file is empty" message rather than the misleading
# "no VERSION file or pyproject.toml version found."

echo "=== empty VERSION diagnostic ==="

DIR=$(create_fixture "version-empty-file")
# create_fixture writes "0.1.0" to VERSION. Truncate to empty.
: > "$DIR/VERSION"
# No pyproject.toml — this is the pure "VERSION exists but empty" case.
git -C "$DIR" add -A
git -C "$DIR" commit -m "empty version" --quiet
OUTPUT=$(run_audit "$DIR")
VER=$(echo "$OUTPUT" | sed -n '/^## VERSION$/,/^## /p')
if echo "$VER" | grep -q "STATUS: skip" && echo "$VER" | grep -q "VERSION file exists but is empty"; then
  pass "version: empty VERSION emits distinct diagnostic"
else
  fail "version: empty VERSION still misdiagnosed" "$VER"
fi

# Empty VERSION should NOT silently fall back to pyproject — the user clearly
# intended VERSION as the source. Misconfiguration must be visible.
DIR=$(create_fixture "version-empty-with-pyproject")
: > "$DIR/VERSION"
cat > "$DIR/pyproject.toml" << 'EOF'
[project]
name = "example"
version = "9.9.9"
EOF
git -C "$DIR" add -A
git -C "$DIR" commit -m "empty + pyproject" --quiet
OUTPUT=$(run_audit "$DIR")
VER=$(echo "$OUTPUT" | sed -n '/^## VERSION$/,/^## /p')
if echo "$VER" | grep -q "STATUS: skip" && echo "$VER" | grep -q "empty"; then
  pass "version: empty VERSION wins over pyproject (no silent fallback)"
else
  fail "version: empty VERSION silently fell back to pyproject" "$VER"
fi

# ─── VOCAB_LINT severity (v0.16.2) ────────────────────────────
#
# VOCAB_LINT is a style check, not a correctness check. Violations emit
# STATUS: warn (advisory) so the skill can override with rationale when a
# flagged usage is a false positive in context (e.g. "cluster" as verb).

echo "=== vocab_lint severity ==="

DIR=$(create_fixture "vocab-severity")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1

## Group 1: Legitimate work

### Track 1A: x
_1 task . low risk . x_
_touches: x_
- **Work** — items cluster around the first-pull session. (S)
EOF
OUTPUT=$(run_audit "$DIR")
VL=$(echo "$OUTPUT" | sed -n '/^## VOCAB_LINT$/,/^## /p')
if echo "$VL" | grep -q "STATUS: warn" && echo "$VL" | grep -q "cluster"; then
  pass "vocab_lint: violations emit advisory (warn), not fail"
else
  fail "vocab_lint: still emitting fail for style issue" "$VL"
fi

# ─── --scan-state (signals only, no verdict) ─────────────────

echo "=== scan-state ==="

# scan-state emits SIGNALS only; skill prose composes ops list. These tests
# assert the schema (signal fields present, no verdict fields) and that intent
# detection with negation guard still works as before.

run_scan() {
  local dir="$1"
  local prompt="${2:-}"
  GSTACK_EXTEND_DIR="$SCRIPT_DIR" "$SCRIPT_DIR/bin/roadmap-audit" --scan-state --prompt "$prompt" "$dir" 2>/dev/null || true
}

# Signal schema: required keys present, no ops/needs_clarification leak
DIR=$(create_fixture "scan-shape")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1

## Group 1: A

### Track 1A: x
_1 task . low risk . x_
_touches: x_
- **T** -- . (S)
EOF
echo "## Unprocessed" > "$DIR/TODOS.md"
OUT=$(run_scan "$DIR" "")
if echo "$OUT" | grep -q '"signals":' \
   && echo "$OUT" | grep -q '"intents":' \
   && echo "$OUT" | grep -q '"unprocessed_count":' \
   && echo "$OUT" | grep -q '"staleness_fail":' \
   && echo "$OUT" | grep -q '"git_inferred_freshness":' \
   && echo "$OUT" | grep -q '"has_zero_open_group":'; then
  pass "scan-state: emits required signal keys"
else
  fail "scan-state: missing signal keys" "$OUT"
fi
if echo "$OUT" | grep -qE '"ops":|"needs_clarification":'; then
  fail "scan-state: still emitting verdict keys (ops/needs_clarification)" "$OUT"
else
  pass "scan-state: no verdict keys (ops/needs_clarification removed)"
fi

# Greenfield short-circuit: ROADMAP missing → exclusive_state=GREENFIELD, signals=null
DIR=$(create_fixture "scan-greenfield")
echo "## Unprocessed" > "$DIR/TODOS.md"
OUT=$(run_scan "$DIR" "")
if echo "$OUT" | grep -q '"exclusive_state": "GREENFIELD"' && echo "$OUT" | grep -q '"signals": null'; then
  pass "scan-state: GREENFIELD short-circuit when ROADMAP missing"
else
  fail "scan-state: GREENFIELD short-circuit broken" "$OUT"
fi

# Intent: closure detection
DIR=$(create_fixture "scan-closure")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1
## Group 1: A
### Track 1A: x
_1 task . low risk . x_
_touches: x_
- **T** -- . (S)
EOF
echo "## Unprocessed" > "$DIR/TODOS.md"
OUT=$(run_scan "$DIR" "let's close out group 2")
if echo "$OUT" | grep -q '"closure": 1'; then
  pass "scan-state: detects closure intent"
else
  fail "scan-state: closure intent not detected" "$OUT"
fi

# Intent: negation guard fires (don't close out)
OUT=$(run_scan "$DIR" "don't close out anything yet")
if echo "$OUT" | grep -q '"closure": 0'; then
  pass "scan-state: negation guard blocks closure intent"
else
  fail "scan-state: negation guard failed for closure" "$OUT"
fi

# Intent: split detection
OUT=$(run_scan "$DIR" "split track 2A please")
if echo "$OUT" | grep -q '"split": 1' && echo "$OUT" | grep -q '"track_ref": "2A"'; then
  pass "scan-state: detects split intent + track_ref"
else
  fail "scan-state: split/track_ref not detected" "$OUT"
fi

# Signal: unprocessed_count reflects inbox
DIR=$(create_fixture "scan-unprocessed")
cat > "$DIR/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1
## Group 1: A
### Track 1A: x
_1 task . low risk . x_
_touches: x_
- **T** -- . (S)
EOF
cat > "$DIR/TODOS.md" << 'EOF'
## Unprocessed
### Item one [manual]
### Item two [manual]
### Item three [manual]
EOF
OUT=$(run_scan "$DIR" "")
if echo "$OUT" | grep -qE '"unprocessed_count": 3'; then
  pass "scan-state: signals.unprocessed_count reflects inbox size"
else
  fail "scan-state: unprocessed_count wrong" "$OUT"
fi

# Signal: git_inferred_freshness fires when a referenced file has 2+ commits
# since the task was introduced to ROADMAP.md. Catches the common
# "shipped without updating the roadmap" case that staleness_fail misses.
DIR=$(create_fixture "scan-git-freshness")
git -C "$DIR" init -q
git -C "$DIR" config user.email "test@test.test"
git -C "$DIR" config user.name "test"
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1
## Group 1: A
### Track 1A: x
_1 task . low risk . [setup]_
_touches: setup_
- **Setup custom dir flag** -- Add --skills-dir flag. _[setup], ~20 lines._ (S)
EOF
echo "## Unprocessed" > "$DIR/docs/TODOS.md"
echo "0.1.0" > "$DIR/VERSION"
cat > "$DIR/CHANGELOG.md" << 'EOF'
# Changelog

## v0.1.0 - 2026-04-28
- initial
EOF
echo "" > "$DIR/setup"
git -C "$DIR" add docs/ROADMAP.md docs/TODOS.md VERSION CHANGELOG.md setup
git -C "$DIR" commit -q -m "initial roadmap with Setup custom dir flag task"
# Two commits to setup AFTER the roadmap was introduced — should fire signal.
echo "first" > "$DIR/setup"
git -C "$DIR" add setup
git -C "$DIR" commit -q -m "first change to setup"
echo "second" > "$DIR/setup"
git -C "$DIR" add setup
git -C "$DIR" commit -q -m "second change to setup"
OUT=$(run_scan "$DIR" "")
if echo "$OUT" | grep -qE '"git_inferred_freshness": [1-9]'; then
  pass "scan-state: git_inferred_freshness fires when referenced file churned"
else
  fail "scan-state: git_inferred_freshness should fire" "$OUT"
fi

# Negative: roadmap with no commit churn → signal stays at 0
DIR=$(create_fixture "scan-no-churn")
git -C "$DIR" init -q
git -C "$DIR" config user.email "test@test.test"
git -C "$DIR" config user.name "test"
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1
## Group 1: A
### Track 1A: x
_1 task . low risk . [other_file]_
_touches: other_file_
- **Some task** -- description here. _[other_file], ~20 lines._ (S)
EOF
echo "## Unprocessed" > "$DIR/docs/TODOS.md"
echo "0.1.0" > "$DIR/VERSION"
cat > "$DIR/CHANGELOG.md" << 'EOF'
# Changelog

## v0.1.0 - 2026-04-28
- initial
EOF
echo "" > "$DIR/other_file"
git -C "$DIR" add docs/ROADMAP.md docs/TODOS.md VERSION CHANGELOG.md other_file
git -C "$DIR" commit -q -m "initial — no follow-up commits"
OUT=$(run_scan "$DIR" "")
if echo "$OUT" | grep -qE '"git_inferred_freshness": 0'; then
  pass "scan-state: git_inferred_freshness=0 when no follow-up commits"
else
  fail "scan-state: git_inferred_freshness should be 0" "$OUT"
fi

# Track-ID relaxation: 1 commit since intro fires inferred-freshness
# IF the commit message references "Track NX". Catches single-bundled-PR
# Tracks that the 2-commit floor would otherwise miss. The referenced
# file is created in the follow-up commit (not the initial roadmap
# commit) so `--after=<intro>` boundary semantics can't accidentally
# count the initial commit toward the 2-commit floor.
DIR=$(create_fixture "scan-track-id-1commit")
git -C "$DIR" init -q
git -C "$DIR" config user.email "test@test.test"
git -C "$DIR" config user.name "test"
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1
## Group 7: Editor
### Track 7A: Cmd-V paste handler
_1 task . low risk . [compose-editor.js]_
_touches: compose-editor.js_
- **Cmd-V paste handler** -- intercept paste. _[compose-editor.js], ~50 lines._ (M)
EOF
echo "## Unprocessed" > "$DIR/docs/TODOS.md"
echo "0.1.0" > "$DIR/VERSION"
cat > "$DIR/CHANGELOG.md" << 'EOF'
# Changelog

## v0.1.0 - 2026-04-28
- initial
EOF
git -C "$DIR" add docs/ROADMAP.md docs/TODOS.md VERSION CHANGELOG.md
git -C "$DIR" commit -q -m "initial roadmap with Cmd-V paste handler task"
# Sleep ensures the follow-up commit has a strictly later second-resolution
# timestamp than the intro, so `--after=<intro>` returns exactly 1 commit.
sleep 1
echo "first" > "$DIR/compose-editor.js"
git -C "$DIR" add compose-editor.js
git -C "$DIR" commit -q -m "Track 7A bridge-hygiene sweep: dead code, dedupe"
OUT=$(run_scan "$DIR" "")
if echo "$OUT" | grep -qE '"git_inferred_freshness": [1-9]'; then
  pass "scan-state: 1 commit + Track-ID match fires inferred-freshness"
else
  fail "scan-state: 1 commit + Track-ID match should fire" "$OUT"
fi

# Negative control: 1 commit on the file but message doesn't reference
# the Track. The 2-commit floor still applies, so signal stays at 0.
DIR=$(create_fixture "scan-track-id-1commit-no-ref")
git -C "$DIR" init -q
git -C "$DIR" config user.email "test@test.test"
git -C "$DIR" config user.name "test"
mkdir -p "$DIR/docs"
cat > "$DIR/docs/ROADMAP.md" << 'EOF'
# Roadmap — Phase 1
## Group 7: Editor
### Track 7A: Cmd-V paste handler
_1 task . low risk . [compose-editor.js]_
_touches: compose-editor.js_
- **Cmd-V paste handler** -- intercept paste. _[compose-editor.js], ~50 lines._ (M)
EOF
echo "## Unprocessed" > "$DIR/docs/TODOS.md"
echo "0.1.0" > "$DIR/VERSION"
cat > "$DIR/CHANGELOG.md" << 'EOF'
# Changelog

## v0.1.0 - 2026-04-28
- initial
EOF
git -C "$DIR" add docs/ROADMAP.md docs/TODOS.md VERSION CHANGELOG.md
git -C "$DIR" commit -q -m "initial roadmap with Cmd-V paste handler task"
sleep 1
echo "first" > "$DIR/compose-editor.js"
git -C "$DIR" add compose-editor.js
git -C "$DIR" commit -q -m "unrelated refactor on compose-editor"
OUT=$(run_scan "$DIR" "")
if echo "$OUT" | grep -qE '"git_inferred_freshness": 0'; then
  pass "scan-state: 1 commit without Track-ID stays below 2-commit floor"
else
  fail "scan-state: 1 commit without Track-ID should not fire" "$OUT"
fi

# ─── roadmap-place (ranked candidates) ───────────────────────

echo "=== roadmap-place ==="

run_place() {
  GSTACK_EXTEND_DIR="$SCRIPT_DIR" "$SCRIPT_DIR/bin/roadmap-place" "$@" 2>/dev/null || true
}

# Origin in-flight → 1 candidate, no judgment needed
OUT=$(run_place --tag '[pair-review:group=2,item=5]' --in-flight "1 2" --primary "1")
if echo "$OUT" | grep -q "candidates=1" \
   && echo "$OUT" | grep -q "target=current" \
   && echo "$OUT" | grep -q "group=2" \
   && echo "$OUT" | grep -q "needs_judgment=0"; then
  pass "place: origin in-flight → 1 candidate, no judgment"
else
  fail "place: origin in-flight broken" "$OUT"
fi

# Origin complete + critical → hotfix, 1 candidate
OUT=$(run_place --tag '[full-review:group=2,severity=critical]' --in-flight "1" --complete "2" --primary "1")
if echo "$OUT" | grep -q "candidates=1" \
   && echo "$OUT" | grep -q "target=hotfix" \
   && echo "$OUT" | grep -q "group=2" \
   && echo "$OUT" | grep -q "needs_judgment=0"; then
  pass "place: complete+critical → 1 hotfix candidate"
else
  fail "place: complete+critical broken" "$OUT"
fi

# Origin complete + non-critical → 2 candidates with needs_judgment=1 (the redesign)
OUT=$(run_place --tag '[full-review:group=2,severity=high]' --in-flight "1" --complete "2" --primary "1" --files "auth.ts" --primary-touches "ui/**")
if echo "$OUT" | grep -q "candidates=2"; then
  pass "place: complete+non-critical → 2 candidates (judgment-required)"
else
  fail "place: complete+non-critical should emit 2 candidates" "$OUT"
fi
NEEDS_JUDGE_COUNT=$(echo "$OUT" | grep -c "needs_judgment=1" || true)
if [ "$NEEDS_JUDGE_COUNT" = "2" ]; then
  pass "place: both candidates flag needs_judgment=1"
else
  fail "place: needs_judgment flag not set on both candidates" "$OUT"
fi
if echo "$OUT" | grep -q "rank=1" && echo "$OUT" | grep -q "rank=2" \
   && echo "$OUT" | grep -q "target=current" && echo "$OUT" | grep -q "target=future"; then
  pass "place: candidates include both current (rank-1) and future (rank-2)"
else
  fail "place: ranked candidates missing current/future pair" "$OUT"
fi

# Complete + non-critical with NO primary in-flight → 1 candidate (defer-only)
OUT=$(run_place --tag '[full-review:group=2,severity=high]' --complete "2")
if echo "$OUT" | grep -q "candidates=1" \
   && echo "$OUT" | grep -q "target=future" \
   && echo "$OUT" | grep -q "needs_judgment=0"; then
  pass "place: complete+non-critical+no-primary → defer-only"
else
  fail "place: complete+non-critical+no-primary broken" "$OUT"
fi

# No origin tag + primary → preflight, needs_judgment=1 (off-topic check)
OUT=$(run_place --tag '[manual]' --in-flight "1" --primary "1")
if echo "$OUT" | grep -q "candidates=1" \
   && echo "$OUT" | grep -q "target=current" \
   && echo "$OUT" | grep -q "slot=preflight" \
   && echo "$OUT" | grep -q "needs_judgment=1"; then
  pass "place: no-origin+primary → preflight default, needs_judgment=1 (off-topic check)"
else
  fail "place: no-origin+primary broken" "$OUT"
fi

# Drained: no in-flight → defer to future
OUT=$(run_place --tag '[manual]')
if echo "$OUT" | grep -q "candidates=1" \
   && echo "$OUT" | grep -q "target=future" \
   && echo "$OUT" | grep -q "needs_judgment=0"; then
  pass "place: drained → defer to Future"
else
  fail "place: drained broken" "$OUT"
fi

# Stale group hint (renamed/deleted): future + needs_judgment=1
OUT=$(run_place --tag '[full-review:group=99]' --in-flight "1" --primary "1")
if echo "$OUT" | grep -q "candidates=1" \
   && echo "$OUT" | grep -q "target=future" \
   && echo "$OUT" | grep -q "needs_judgment=1"; then
  pass "place: stale group hint → future, needs_judgment=1"
else
  fail "place: stale group hint broken" "$OUT"
fi

# ─── Summary ──────────────────────────────────────────────────

echo ""
echo "────────────────────────────"
echo "Results: $PASSED passed, $FAILED failed (of $TOTAL)"
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
