#!/usr/bin/env bash
#
# test-test-plan-e2e.sh — End-to-end integration test for /test-plan.
#
# The skill itself runs inside a live Claude session (no standalone binary). So
# this test validates the DATA CONTRACTS the skill's phases establish:
#
#   - A fixture repo with ROADMAP.md containing a Group+Tracks is parseable.
#   - Fixture review docs under the project store are discoverable by the
#     expected glob patterns.
#   - Fixture .context/pair-review state (prior per-Track sessions) is readable
#     in the 5-category consumption scheme (PASSED/SKIPPED/DEFERRED/PARKED/FIXED).
#   - A simulated /test-plan run writes the expected files to the expected paths.
#   - /qa-only's discovery glob would find the written batch-plan file.
#   - Archive-then-fresh-write is idempotent.
#   - TODOS.md Unprocessed append format is correct.
#
# The test stands up one realistic scenario, then exercises it end-to-end using
# the same bash primitives the skill file documents (Phase 1 manifest write,
# Phase 4 consume categories, Phase 7 archive, etc.). Run after
# test-test-plan.sh and test-test-plan-extractor.sh pass — those cover the
# static contracts; this covers behavior.
#
# Usage:
#   ./scripts/test-test-plan-e2e.sh [--verbose]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
VERBOSE=false
PASSED=0
FAILED=0
TOTAL=0
TMPDIR_BASE=$(mktemp -d /tmp/gstack-test-tp-e2e-XXXXXXXX)
MOCK_HOME="$TMPDIR_BASE/home"
FIXTURE_REPO="$TMPDIR_BASE/fixture-repo"

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

# ─── Build fixture repo ────────────────────────────────────────

echo "=== fixture setup ==="

mkdir -p "$FIXTURE_REPO/docs" "$FIXTURE_REPO/.context/pair-review/groups"
cd "$FIXTURE_REPO"
git init --quiet
git config user.email "test@test.com"
git config user.name "Test"

# Minimal ROADMAP.md with a Group + 2 Tracks.
cat > docs/ROADMAP.md <<'EOF'
# Roadmap — Pre-1.0 (v0.x)

Organized as Groups > Tracks > Tasks.

---

## Group 1: Widget Pipeline

Build the widget processing pipeline with validation.

### Track 1A: Widget Core
_1 task · ~1 hour (human) / ~20 min (CC) · medium risk · [src/widget.ts]_
_touches: src/widget.ts_

- **Implement the widget model** -- core data type and persistence. _[src/widget.ts], ~80 lines._ (M)

### Track 1B: Widget Validation
_1 task · ~1 hour (human) / ~20 min (CC) · low risk · [src/validate.ts]_
_touches: src/validate.ts_

- **Add widget validation layer** -- validates inputs and surfaces errors. _[src/validate.ts], ~50 lines._ (S)

### Track 1C: Widget Bug-Bash
_0 tasks · bug-bash only · medium risk · [no code]_
_touches: (none)_

(No implementation work. Bug-bash against integrated build. See /test-plan run widget-pipeline.)

---

## Unprocessed

EOF

echo "0.1.0" > VERSION
cat > CLAUDE.md <<'EOF'
# fixture-repo

Test fixture.

## Testing

Run scripts/test-*.sh
EOF

git add -A
git commit -m "init fixture" --quiet

if [ -f "$FIXTURE_REPO/docs/ROADMAP.md" ]; then
  pass "Fixture ROADMAP.md created"
else
  fail "Fixture ROADMAP.md not created"
fi

# ─── Parse Group + Tracks from ROADMAP.md ──────────────────────
#
# The skill's Phase 1 Step 2 reads the Group heading + its Track headings.
# If our ROADMAP parser regex works here, the skill's equivalent will work
# on real roadmaps.

echo ""
echo "=== ROADMAP parsing ==="

GROUPS_FOUND=$(grep -c '^## Group [0-9]\+:' "$FIXTURE_REPO/docs/ROADMAP.md" || true)
if [ "$GROUPS_FOUND" -eq 1 ]; then
  pass "Detects 1 Group in fixture"
else
  fail "Group detection wrong" "expected 1, got $GROUPS_FOUND"
fi

# Extract Tracks for Group 1 (between '## Group 1:' and the next '## ' or EOF).
TRACKS_IN_GROUP=$(awk '/^## Group 1:/,/^## [^G]/ { if ($0 ~ /^### Track [0-9]+[A-Z]:/) print $0 }' "$FIXTURE_REPO/docs/ROADMAP.md" | wc -l | tr -d ' ')
if [ "$TRACKS_IN_GROUP" -eq 3 ]; then
  pass "Detects 3 Tracks in Group 1 (including bug-bash Track)"
else
  fail "Track detection wrong" "expected 3, got $TRACKS_IN_GROUP"
fi

# Extract the Group title for slugification
GROUP_TITLE=$(grep -E '^## Group 1:' "$FIXTURE_REPO/docs/ROADMAP.md" | sed -E 's/^## Group [0-9]+: //')
GROUP_SLUG=$(echo "$GROUP_TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')

if [ "$GROUP_SLUG" = "widget-pipeline" ]; then
  pass "Group 1 title slugifies to 'widget-pipeline'"
else
  fail "Slug wrong" "expected 'widget-pipeline', got '$GROUP_SLUG'"
fi

# ─── Fixture review docs ───────────────────────────────────────
#
# Plant review docs in the project store at paths matching the skill's glob
# patterns. Branch names are kbitz/widget-core and kbitz/widget-validation.

echo ""
echo "=== fixture review docs ==="

SLUG="fixture-project"
mkdir -p "$MOCK_HOME/.gstack/projects/$SLUG"

# CEO plan for Track 1A
cat > "$MOCK_HOME/.gstack/projects/$SLUG/test-kbitz-widget-core-ceo-plan-20260420-100000.md" <<'EOF'
# CEO Plan: Widget Core

## Magical moment
The widget list loads in under 100ms for any reasonable widget count.

## Success criteria
- Widget creation returns a valid widget within 50ms
- Persistence survives app restart

## Risk
Users may paste very long widget names — the form should not overflow.
EOF

# Eng review for Track 1A
cat > "$MOCK_HOME/.gstack/projects/$SLUG/test-kbitz-widget-core-eng-review-20260420-110000.md" <<'EOF'
# Eng Review: Widget Core

## Architecture
Widget model uses SQLite. N+1 risk on list rendering — eager-load children.

## Tests required
- Happy path: create, read, update, delete
- Edge case: nil widget name
- Edge case: 10,000 widgets in list

## Performance
List page must stay under 200ms with 1000 widgets.
EOF

# Design review for Track 1B
cat > "$MOCK_HOME/.gstack/projects/$SLUG/test-kbitz-widget-validation-design-review-20260420-120000.md" <<'EOF'
# Design Review: Widget Validation

## Error messaging
Invalid widget inputs should show a clear, non-jargon error message inline.

## Interaction
Error state must clear when the user starts correcting the input.
EOF

# In-repo design doc (pattern in the skill: also scans docs/designs/*.md)
mkdir -p "$FIXTURE_REPO/docs/designs"
cat > "$FIXTURE_REPO/docs/designs/widget-api.md" <<'EOF'
# Widget API Design

## Endpoint shape
POST /widgets returns 201 with the created widget JSON.
GET /widgets/:id returns 200 with the widget JSON, or 404 if absent.
EOF

DOC_COUNT=$(ls "$MOCK_HOME/.gstack/projects/$SLUG/"*.md 2>/dev/null | wc -l | tr -d ' ')
if [ "$DOC_COUNT" -eq 3 ]; then
  pass "3 review docs planted in project store"
else
  fail "Review doc count wrong" "expected 3, got $DOC_COUNT"
fi

if [ -f "$FIXTURE_REPO/docs/designs/widget-api.md" ]; then
  pass "In-repo design doc planted at docs/designs/widget-api.md"
else
  fail "In-repo design doc not planted"
fi

# ─── Glob discovery ────────────────────────────────────────────
#
# The skill discovers review docs by globbing paths with branch-name substrings.
# Simulate Phase 1 Step 3 for each Track and assert it finds the right docs.

echo ""
echo "=== review doc discovery ==="

discover_docs_for_branch() {
  local branch="$1"
  local branch_slug
  branch_slug=$(echo "$branch" | tr / -)
  # The skill's patterns, deduped per Phase 1 Step 3 intra-Track dedup rule:
  {
    ls "$MOCK_HOME/.gstack/projects/$SLUG/"*"-${branch_slug}-"*"-plan-"*.md 2>/dev/null || true
    ls "$MOCK_HOME/.gstack/projects/$SLUG/"*"-${branch_slug}-design-"*.md 2>/dev/null || true
    ls "$MOCK_HOME/.gstack/projects/$SLUG/"*"-${branch_slug}-"*"-review-"*.md 2>/dev/null || true
  } | sort -u
}

TRACK_1A_DOCS=$(discover_docs_for_branch "kbitz/widget-core")
TRACK_1A_COUNT=$(echo "$TRACK_1A_DOCS" | grep -c . || true)
if [ "$TRACK_1A_COUNT" -eq 2 ]; then
  pass "Track 1A discovers 2 docs (ceo-plan + eng-review)"
else
  fail "Track 1A doc discovery wrong" "expected 2, got $TRACK_1A_COUNT: $TRACK_1A_DOCS"
fi

TRACK_1B_DOCS=$(discover_docs_for_branch "kbitz/widget-validation")
TRACK_1B_COUNT=$(echo "$TRACK_1B_DOCS" | grep -c . || true)
if [ "$TRACK_1B_COUNT" -eq 1 ]; then
  pass "Track 1B discovers 1 doc (design-review)"
else
  fail "Track 1B doc discovery wrong" "expected 1, got $TRACK_1B_COUNT"
fi

# In-repo docs/designs/*.md discovery
IN_REPO_DOCS=$(find "$FIXTURE_REPO/docs/designs" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
if [ "$IN_REPO_DOCS" -eq 1 ]; then
  pass "In-repo docs/designs glob finds 1 doc"
else
  fail "In-repo design doc discovery wrong"
fi

# ─── Write manifest ────────────────────────────────────────────
#
# Simulate Phase 1 Step 4: write manifest.yaml for Group 1. Validate shape.

echo ""
echo "=== manifest write ==="

MANIFEST_DIR="$MOCK_HOME/.gstack/projects/$SLUG/groups/$GROUP_SLUG"
mkdir -p "$MANIFEST_DIR"
MANIFEST="$MANIFEST_DIR/manifest.yaml"

cat > "$MANIFEST" <<EOF
schema: 1
group: $GROUP_SLUG
group_title: "$GROUP_TITLE"
created: $(date -u +%Y-%m-%dT%H:%M:%SZ)
tracks:
  - id: 1A
    name: Widget Core
    branch: kbitz/widget-core
    review_docs:
      - $MOCK_HOME/.gstack/projects/$SLUG/test-kbitz-widget-core-ceo-plan-20260420-100000.md
      - $MOCK_HOME/.gstack/projects/$SLUG/test-kbitz-widget-core-eng-review-20260420-110000.md
  - id: 1B
    name: Widget Validation
    branch: kbitz/widget-validation
    review_docs:
      - $MOCK_HOME/.gstack/projects/$SLUG/test-kbitz-widget-validation-design-review-20260420-120000.md
  - id: 1C
    name: Widget Bug-Bash
    branch: main
    review_docs: []
EOF

if [ -f "$MANIFEST" ]; then
  pass "manifest.yaml created at canonical path"
else
  fail "manifest.yaml missing"
fi

# Shape assertions
if grep -q "^schema: 1$" "$MANIFEST" \
  && grep -q "^group: widget-pipeline$" "$MANIFEST" \
  && grep -q "^tracks:$" "$MANIFEST"; then
  pass "manifest.yaml has required top-level fields"
else
  fail "manifest.yaml missing top-level fields"
fi

TRACK_COUNT_IN_MANIFEST=$(grep -cE "^  - id: [0-9]+[A-Z]$" "$MANIFEST" || true)
if [ "$TRACK_COUNT_IN_MANIFEST" -eq 3 ]; then
  pass "manifest.yaml contains all 3 Tracks"
else
  fail "manifest.yaml Track count wrong" "expected 3, got $TRACK_COUNT_IN_MANIFEST"
fi

# ─── Prior pair-review state (Track 1A already pair-reviewed) ─
#
# Plant a .context/pair-review session for kbitz/widget-core with all 5 item
# statuses represented. The skill's Phase 4 consumption must correctly bucket
# each category.

echo ""
echo "=== prior pair-review consumption ==="

# Simulate an ARCHIVED prior session (Track 1A was on a different branch workspace
# that's since been removed). The skill scans .context/pair-review-archived-*.
PR_ARCHIVE="$FIXTURE_REPO/.context/pair-review-archived-20260420-150000"
mkdir -p "$PR_ARCHIVE/groups"

cat > "$PR_ARCHIVE/session.yaml" <<EOF
project: fixture-project
branch: kbitz/widget-core
started: 2026-04-20T14:00:00Z
last_active: 2026-04-20T15:00:00Z
build_commit: abc1234
deploy_recipe: deploy.md
active_groups: []
completed_groups:
  - widget-core
summary:
  total: 5
  passed: 1
  failed: 1
  skipped: 1
  untested: 0
parked_bugs:
  total: 2
  todos: 1
  this_branch: 1
  fixed: 0
EOF

cat > "$PR_ARCHIVE/groups/widget-core.md" <<'EOF'
# Test Group: Widget Core

## Items

### 1. Verify widget list loads under 100ms
- Status: PASSED
- Build: abc1234
- Tested: 2026-04-20T14:30:00Z

### 2. Verify widget creation returns 50ms response
- Status: FAILED
- Evidence: response was 120ms
- Fix: def5678
- Retest required: YES

### 3. Verify very long widget names don't overflow form
- Status: SKIPPED
- Notes: could not reproduce in current viewport

### 4. Verify deletion cascades to children
- Status: FAILED
- Fix: ghi9012
- Retested: PASSED
EOF

cat > "$PR_ARCHIVE/parked-bugs.md" <<'EOF'
# Parked Bugs

## 1. Widget icon flickers on hover
- Noticed during: widget-core, item 1
- Timestamp: 2026-04-20T14:45:00Z
- Description: The icon quickly flashes when hovering the widget card.
- Status: PARKED

## 2. Typo in widget-empty state message
- Noticed during: widget-core, item 2
- Timestamp: 2026-04-20T14:50:00Z
- Description: "Widgtes" instead of "Widgets".
- Status: DEFERRED_TO_TODOS
EOF

# Skill's Phase 4 scan_pair_review function: for each archived session dir
# whose session.yaml matches a Track branch, walk the groups and parked-bugs.
scan_pair_review() {
  local dir="$1"
  local branch="$2"
  local sess_branch
  sess_branch=$(grep -E "^branch: " "$dir/session.yaml" 2>/dev/null | sed 's/^branch: //' || true)
  if [ "$sess_branch" != "$branch" ]; then
    return 1
  fi
  # Output: one line per item, format "STATUS|description"
  for gf in "$dir"/groups/*.md; do
    [ -f "$gf" ] || continue
    awk '
      /^### [0-9]+\./ { desc=$0; sub(/^### [0-9]+\. /, "", desc); next }
      /^- Status: / { status=$0; sub(/^- Status: /, "", status); print status "|" desc; next }
    ' "$gf"
  done
  # Also output parked bugs
  if [ -f "$dir/parked-bugs.md" ]; then
    awk '
      /^## [0-9]+\./ { desc=$0; sub(/^## [0-9]+\. /, "", desc); next }
      /^- Status: / { status=$0; sub(/^- Status: /, "", status); print status "|" desc; next }
    ' "$dir/parked-bugs.md"
  fi
}

CONSUMED=$(scan_pair_review "$PR_ARCHIVE" "kbitz/widget-core")
log "Consumed items:"
log "$CONSUMED"

# Verify each consume category is represented
for status in PASSED FAILED SKIPPED PARKED DEFERRED_TO_TODOS; do
  if echo "$CONSUMED" | grep -q "^$status|"; then
    pass "Consumed category found: $status"
  else
    fail "Consumed category missing: $status"
  fi
done

# Verify mismatched-branch case: scanning with wrong branch filter returns nothing
WRONG_BRANCH_OUT=$(scan_pair_review "$PR_ARCHIVE" "kbitz/some-other-branch" || true)
if [ -z "$WRONG_BRANCH_OUT" ]; then
  pass "Branch filter works (wrong branch yields no items)"
else
  fail "Branch filter leaked items from non-matching session" "$WRONG_BRANCH_OUT"
fi

# ─── Phase 7: archive + write groups/<group>.md ───────────────

echo ""
echo "=== Phase 7 archive + write ==="

GROUPS_FILE="$FIXTURE_REPO/.context/pair-review/groups/$GROUP_SLUG.md"
mkdir -p "$FIXTURE_REPO/.context/pair-review/groups"

# Simulate a prior run left an old groups file in place
cat > "$GROUPS_FILE" <<'EOF'
# Test Group: Widget Pipeline (old)
## Items
### 1. old item, should be archived
- Status: PASSED
EOF

TS=$(date +%Y%m%d-%H%M%S)
ARCH_PATH="$FIXTURE_REPO/.context/pair-review/groups/$GROUP_SLUG-archived-$TS.md"
mv "$GROUPS_FILE" "$ARCH_PATH"

# Write fresh groups file with items carried from consumption + new items
cat > "$GROUPS_FILE" <<'EOF'
# Test Group: Widget Pipeline

## Items

### 1. Verify widget creation returns 50ms response (retest-after-fix)
- Status: UNTESTED
- Provenance: [retest-after-fix] [from parked-bug: kbitz/widget-core]
<!-- test-plan-id: aa112233 -->

### 2. Verify widget list loads under 100ms (new integration check)
- Status: UNTESTED
- Provenance: [from ceo-review: test-kbitz-widget-core-ceo-plan-20260420-100000.md]
<!-- test-plan-id: bb224455 -->
EOF

if [ -f "$ARCH_PATH" ] && grep -q "old item" "$ARCH_PATH"; then
  pass "Old groups file archived"
else
  fail "Archive did not happen"
fi

if [ -f "$GROUPS_FILE" ] && ! grep -q "old item" "$GROUPS_FILE" && grep -q "test-plan-id" "$GROUPS_FILE"; then
  pass "Fresh groups file has new items + IDs, no old content"
else
  fail "Fresh groups file wrong shape"
fi

# The item-ID comment format is load-bearing (pair-review will read it for future retro)
if grep -qE "^<!-- test-plan-id: [a-f0-9]{8} -->$" "$GROUPS_FILE"; then
  pass "Item ID comment uses canonical format"
else
  fail "Item ID comment format wrong" "expected <!-- test-plan-id: <8-hex> -->"
fi

# ─── Phase 6: batch-plan file ──────────────────────────────────

echo ""
echo "=== Phase 6 batch-plan write ==="

USER_NAME="tester"
BRANCH_SLUG="main"
BATCH="$MOCK_HOME/.gstack/projects/$SLUG/${USER_NAME}-${BRANCH_SLUG}-test-plan-batch-${TS}.md"

cat > "$BATCH" <<EOF
---
schema: 1
name: test-plan-batch
group: $GROUP_SLUG
group_title: "$GROUP_TITLE"
generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)
generated_by: /test-plan run
build_branch: main
build_commit: abc1234
manifest: $MANIFEST
stats:
  review_docs_harvested: 4
  items_total: 6
  items_automated: 2
  items_manual: 4
  items_deferred: 1
  items_carried_from_prior: 2
---

# Test Plan: Widget Pipeline

## Affected Pages/Routes
- [\`abc11111\`] [from diff] /widgets list page

## Key Interactions to Verify
- [\`bb224455\`] [from ceo-review: test-kbitz-widget-core-ceo-plan-20260420-100000.md] Verify widget list loads under 100ms for any reasonable widget count.
- [\`cc335566\`] [from design-review: test-kbitz-widget-validation-design-review-20260420-120000.md] Confirm error messaging is clear, non-jargon, and clears when the user corrects input.

## Edge Cases
- [\`dd446677\`] [from eng-review: test-kbitz-widget-core-eng-review-20260420-110000.md] Verify list stays under 200ms with 1000 widgets (no N+1 regression).
- [\`ee557788\`] [from ceo-review: test-kbitz-widget-core-ceo-plan-20260420-100000.md] Confirm very long widget names don't overflow the form.

## Critical Paths
_none_

## Known Deferred
- Typo in widget-empty state message ("Widgtes" instead of "Widgets"). See TODOS.md.

## Automated (v2, not yet executed)
- [\`ff668899\`] [from design-doc: docs/designs/widget-api.md] Verify POST /widgets returns 201 with created widget JSON.

## Manual (for /pair-review)
- [\`aa112233\`] [retest-after-fix] [from parked-bug: kbitz/widget-core] Verify widget creation returns 50ms response (previously failed, now fixed in def5678).
- (plus items from Key Interactions + Edge Cases)

## Items Surfaced From Prior Sessions (user decision required)
- Very long widget names don't overflow form (SKIPPED: could not reproduce in current viewport)

## Provenance Index

| ID | Source | Rationale |
|----|--------|-----------|
| \`bb224455\` | \`test-kbitz-widget-core-ceo-plan-20260420-100000.md\` §Magical moment | "The widget list loads in under 100ms for any reasonable widget count." |
| \`dd446677\` | \`test-kbitz-widget-core-eng-review-20260420-110000.md\` §Performance | "List page must stay under 200ms with 1000 widgets." |
EOF

if [ -f "$BATCH" ]; then
  pass "Batch plan written at project-scoped path"
else
  fail "Batch plan not written"
fi

# ─── Contract: qa-only discovery glob ──────────────────────────
#
# The whole point of the path convention is that /qa-only's existing glob
# finds this file without /test-plan having to tell it.

echo ""
echo "=== qa-only discovery ==="

DISCOVERED=$(ls -t "$MOCK_HOME/.gstack/projects/$SLUG/"*-test-plan-*.md 2>/dev/null)
if echo "$DISCOVERED" | grep -qF "$BATCH"; then
  pass "Batch plan matches qa-only glob '*-test-plan-*.md'"
else
  fail "Batch plan NOT discoverable by qa-only glob" "Files found: $DISCOVERED"
fi

# Front-matter fields required by the contract
for field in "schema: 1" "name: test-plan-batch" "group: widget-pipeline" "generated_by: /test-plan run" "build_commit:" "manifest:"; do
  if grep -qF "$field" "$BATCH"; then
    pass "Batch plan front-matter has: $field"
  else
    fail "Batch plan front-matter missing: $field"
  fi
done

# All 10 required sections present
for section in "## Affected Pages/Routes" "## Key Interactions to Verify" "## Edge Cases" "## Critical Paths" "## Known Deferred" "## Automated (v2" "## Manual (for /pair-review)" "## Items Surfaced From Prior Sessions" "## Provenance Index"; do
  if grep -qF "$section" "$BATCH"; then
    pass "Batch plan section present: $section"
  else
    fail "Batch plan section missing: $section"
  fi
done

# ─── TODOS.md append format ────────────────────────────────────
#
# When bugs from the pair-review session route to TODOS.md, they use the
# [test-plan] source tag in the existing Unprocessed inbox format.

echo ""
echo "=== TODOS.md append ==="

# Plant initial TODOS.md with the Unprocessed section
cat > "$FIXTURE_REPO/docs/TODOS.md" <<'EOF'
# TODOS

## Unprocessed

- [pair-review] Existing parked bug — example

EOF

# Simulate the skill routing a bug via pair-review's append-to-Unprocessed pattern
# (pair-review does this, not test-plan directly, but the source tag must be
# [test-plan] when the session came from /test-plan run).
NEW_BUG="- [test-plan] Widget icon flickers on hover — hover state re-renders the icon rapidly. Found on branch main (2026-04-21)"
# Insert the new bug under ## Unprocessed
awk -v bug="$NEW_BUG" '
  /^## Unprocessed$/ { print; getline; print; print bug; next }
  { print }
' "$FIXTURE_REPO/docs/TODOS.md" > "$FIXTURE_REPO/docs/TODOS.md.tmp"
mv "$FIXTURE_REPO/docs/TODOS.md.tmp" "$FIXTURE_REPO/docs/TODOS.md"

if grep -qF "[test-plan] Widget icon flickers on hover" "$FIXTURE_REPO/docs/TODOS.md"; then
  pass "Bug appended to TODOS.md Unprocessed with [test-plan] tag"
else
  fail "Bug not appended correctly"
fi

# Verify the existing [pair-review] entry survived (append doesn't clobber)
if grep -qF "[pair-review] Existing parked bug" "$FIXTURE_REPO/docs/TODOS.md"; then
  pass "Existing Unprocessed entry preserved after append"
else
  fail "Append clobbered existing entry"
fi

# ─── Idempotence: re-run with fresh timestamp ─────────────────
#
# Real /test-plan invocations get different PIDs, so the skill's TS format
# `%Y%m%d-%H%M%S-$$` avoids collisions even within the same second. This test
# simulates the same shape by substituting a pseudo-PID suffix.

echo ""
echo "=== idempotence ==="

TS2="$(date +%Y%m%d-%H%M%S)-$$-b"
ARCH_PATH2="$FIXTURE_REPO/.context/pair-review/groups/$GROUP_SLUG-archived-$TS2.md"
mv "$GROUPS_FILE" "$ARCH_PATH2"

cat > "$GROUPS_FILE" <<'EOF'
# Test Group: Widget Pipeline (after 2nd run)
## Items
### 1. Second-run item
- Status: UNTESTED
EOF

# Both archives coexist
if [ -f "$ARCH_PATH" ] && [ -f "$ARCH_PATH2" ]; then
  pass "Multiple re-run archives coexist"
else
  fail "Re-run archive collision"
fi

if [ -f "$GROUPS_FILE" ] && grep -q "Second-run item" "$GROUPS_FILE"; then
  pass "Second-run groups file has fresh content"
else
  fail "Second-run groups file missing fresh content"
fi

# ─── Session.yaml handoff marker ───────────────────────────────
#
# The skill writes plan_source: test-plan into session.yaml so pair-review
# knows the session was /test-plan-initiated.

echo ""
echo "=== session.yaml handoff marker ==="

SESSION="$FIXTURE_REPO/.context/pair-review/session.yaml"
cat > "$SESSION" <<EOF
project: fixture-project
branch: main
started: $(date -u +%Y-%m-%dT%H:%M:%SZ)
last_active: $(date -u +%Y-%m-%dT%H:%M:%SZ)
build_commit: abc1234
deploy_recipe: deploy.md
plan_source: test-plan
active_groups:
  - $GROUP_SLUG
completed_groups: []
summary:
  total: 6
  passed: 0
  failed: 0
  skipped: 0
  untested: 6
parked_bugs:
  total: 0
  todos: 0
  this_branch: 0
  fixed: 0
EOF

if grep -q "^plan_source: test-plan$" "$SESSION"; then
  pass "session.yaml carries plan_source: test-plan marker"
else
  fail "session.yaml missing plan_source marker"
fi

# ─── results ───────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════"
echo "Results: $PASSED passed, $FAILED failed (of $TOTAL)"
echo "═══════════════════════════════════════"

exit $FAILED
