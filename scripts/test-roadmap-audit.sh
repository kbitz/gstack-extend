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

# Four-segment version in CHANGELOG
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
if echo "$OUTPUT" | grep -q "four-segment version"; then
  pass "Four-segment version in CHANGELOG detected"
else
  fail "Four-segment version in CHANGELOG detected"
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
DIR=$(create_fixture "unproc-items")
cat > "$DIR/TODOS.md" << 'EOF'
# TODOs

## Unprocessed
- [pair-review] Arrow key double-move on child messages (found 2026-04-06)
- [pair-review] NSNull crash in batch response parsing
- [manual] Add Cmd+Arrow page navigation
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

# ─── Summary ──────────────────────────────────────────────────

echo ""
echo "────────────────────────────"
echo "Results: $PASSED passed, $FAILED failed (of $TOTAL)"
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
