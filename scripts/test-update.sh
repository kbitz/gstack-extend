#!/usr/bin/env bash
#
# test-update.sh — Test suite for bin/update-run and setup
#
# Tests:
#   update-run: happy path, non-main branch, ff-only failure, missing arg
#   setup: default dir, custom env var, --skills-dir flag, --uninstall
#
# Usage:
#   ./scripts/test-update.sh [--verbose]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
VERBOSE=false
PASSED=0
FAILED=0
TOTAL=0
TMPDIR_BASE=$(mktemp -d /tmp/gstack-test-update-XXXXXXXX)

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

# ─── Fixtures ──────────────────────────────────────────────────
# Create a fake gstack-extend repo with a remote to test against.

create_fixture_repo() {
  local name="$1"
  local dir="$TMPDIR_BASE/$name"
  local remote_dir="$TMPDIR_BASE/${name}-remote"

  # Create the "remote" bare repo
  mkdir -p "$remote_dir"
  git -C "$remote_dir" init --bare --initial-branch=main --quiet

  # Create the local repo
  mkdir -p "$dir/bin"
  mkdir -p "$dir/skills"

  git -C "$dir" init --initial-branch=main --quiet
  git -C "$dir" remote add origin "$remote_dir"

  # Add VERSION file
  echo "1.0.0" > "$dir/VERSION"

  # Add a minimal setup script that just echoes
  cat > "$dir/setup" << 'SETUP'
#!/usr/bin/env bash
echo "setup ran"
SETUP
  chmod +x "$dir/setup"

  # Add the real bin/update-run
  cp "$SCRIPT_DIR/bin/update-run" "$dir/bin/update-run"

  # Initial commit
  git -C "$dir" add -A
  git -C "$dir" commit -m "initial" --quiet

  # Push to remote
  git -C "$dir" push origin main --quiet 2>/dev/null

  echo "$dir"
}

# ─── update-run tests ──────────────────────────────────────────

echo ""
echo "═══ bin/update-run ═══"

# Test: missing arg
echo ""
echo "--- Missing argument ---"
OUTPUT=$("$SCRIPT_DIR/bin/update-run" 2>&1 || true)
if echo "$OUTPUT" | grep -q "UPGRADE_FAILED missing repo root argument"; then
  pass "Rejects missing argument"
else
  fail "Should reject missing argument" "Got: $OUTPUT"
fi

# Test: not a git repo
echo ""
echo "--- Not a git repo ---"
NOT_GIT="$TMPDIR_BASE/not-a-repo"
mkdir -p "$NOT_GIT"
OUTPUT=$("$SCRIPT_DIR/bin/update-run" "$NOT_GIT" 2>&1 || true)
if echo "$OUTPUT" | grep -q "UPGRADE_FAILED not a git repo"; then
  pass "Rejects non-git directory"
else
  fail "Should reject non-git directory" "Got: $OUTPUT"
fi

# Test: happy path from main
echo ""
echo "--- Happy path (on main) ---"
REPO=$(create_fixture_repo "happy-path")
STATE="$TMPDIR_BASE/state-happy"
mkdir -p "$STATE"

# Simulate a new remote version
REMOTE_DIR="$TMPDIR_BASE/happy-path-remote"
WORK="$TMPDIR_BASE/happy-path-work"
git clone --quiet "$REMOTE_DIR" "$WORK" 2>/dev/null
echo "1.1.0" > "$WORK/VERSION"
git -C "$WORK" add VERSION
git -C "$WORK" commit -m "bump to 1.1.0" --quiet
git -C "$WORK" push origin main --quiet 2>/dev/null
rm -rf "$WORK"

OUTPUT=$(GSTACK_EXTEND_STATE_DIR="$STATE" "$SCRIPT_DIR/bin/update-run" "$REPO" 2>&1 || true)
log "Output: $OUTPUT"
if echo "$OUTPUT" | grep -q "UPGRADE_OK 1.0.0 1.1.0"; then
  pass "Upgrades from main successfully"
else
  fail "Should output UPGRADE_OK 1.0.0 1.1.0" "Got: $OUTPUT"
fi

# Verify state files were written
if [ -f "$STATE/just-upgraded-from" ]; then
  MARKER=$(cat "$STATE/just-upgraded-from")
  if [ "$MARKER" = "1.0.0" ]; then
    pass "Writes just-upgraded-from marker"
  else
    fail "Marker should be 1.0.0" "Got: $MARKER"
  fi
else
  fail "Should write just-upgraded-from marker"
fi

# Test: non-main branch gets switched to main
echo ""
echo "--- Non-main branch auto-switch ---"
REPO2=$(create_fixture_repo "branch-switch")
STATE2="$TMPDIR_BASE/state-branch"
mkdir -p "$STATE2"

# Create and switch to a feature branch
git -C "$REPO2" checkout -b feature/test --quiet
echo "branch work" > "$REPO2/branch-file.txt"
git -C "$REPO2" add branch-file.txt
git -C "$REPO2" commit -m "branch commit" --quiet

# Push a new version to remote
REMOTE_DIR2="$TMPDIR_BASE/branch-switch-remote"
WORK2="$TMPDIR_BASE/branch-switch-work"
git clone --quiet "$REMOTE_DIR2" "$WORK2" 2>/dev/null
echo "1.2.0" > "$WORK2/VERSION"
git -C "$WORK2" add VERSION
git -C "$WORK2" commit -m "bump to 1.2.0" --quiet
git -C "$WORK2" push origin main --quiet 2>/dev/null
rm -rf "$WORK2"

OUTPUT2=$(GSTACK_EXTEND_STATE_DIR="$STATE2" "$SCRIPT_DIR/bin/update-run" "$REPO2" 2>&1 || true)
log "Output: $OUTPUT2"

if echo "$OUTPUT2" | grep -q "switched from branch 'feature/test' to main"; then
  pass "Warns about branch switch"
else
  fail "Should warn about branch switch" "Got: $OUTPUT2"
fi

if echo "$OUTPUT2" | grep -q "UPGRADE_OK"; then
  pass "Upgrade succeeds after branch switch"
else
  fail "Should succeed after branch switch" "Got: $OUTPUT2"
fi

# Verify branch commit is preserved (still exists, just not checked out)
BRANCH_EXISTS=$(git -C "$REPO2" branch --list "feature/test" 2>/dev/null || true)
if [ -n "$BRANCH_EXISTS" ]; then
  pass "Preserves feature branch (not destroyed)"
else
  fail "Feature branch should still exist"
fi

# Verify we're back on the original branch (not left on main)
CURRENT_BRANCH=$(git -C "$REPO2" branch --show-current 2>/dev/null || true)
if [ "$CURRENT_BRANCH" = "feature/test" ]; then
  pass "Restores original branch after upgrade"
else
  fail "Should restore original branch after upgrade" "Got: $CURRENT_BRANCH"
fi

# Test: dirty worktree on feature branch (stash applied to correct branch)
echo ""
echo "--- Dirty worktree + branch switch ---"
REPO4=$(create_fixture_repo "dirty-worktree")
STATE4="$TMPDIR_BASE/state-dirty"
mkdir -p "$STATE4"

# Create and switch to a feature branch with dirty working tree
git -C "$REPO4" checkout -b feature/dirty --quiet
echo "committed work" > "$REPO4/feature-file.txt"
git -C "$REPO4" add feature-file.txt
git -C "$REPO4" commit -m "feature commit" --quiet
echo "uncommitted change" > "$REPO4/VERSION"

# Push a new version to remote
REMOTE_DIR4="$TMPDIR_BASE/dirty-worktree-remote"
WORK4="$TMPDIR_BASE/dirty-worktree-work"
git clone --quiet "$REMOTE_DIR4" "$WORK4" 2>/dev/null
echo "1.3.0" > "$WORK4/VERSION"
git -C "$WORK4" add VERSION
git -C "$WORK4" commit -m "bump to 1.3.0" --quiet
git -C "$WORK4" push origin main --quiet 2>/dev/null
rm -rf "$WORK4"

OUTPUT4=$(GSTACK_EXTEND_STATE_DIR="$STATE4" "$SCRIPT_DIR/bin/update-run" "$REPO4" 2>&1 || true)
log "Output: $OUTPUT4"

if echo "$OUTPUT4" | grep -q "UPGRADE_OK"; then
  pass "Upgrade succeeds with dirty worktree"
else
  fail "Should succeed with dirty worktree" "Got: $OUTPUT4"
fi

# Verify we're back on the feature branch
CURRENT4=$(git -C "$REPO4" branch --show-current 2>/dev/null || true)
if [ "$CURRENT4" = "feature/dirty" ]; then
  pass "Restores feature branch after dirty-worktree upgrade"
else
  fail "Should restore feature branch" "Got: $CURRENT4"
fi

# Test: ff-only failure (diverged main)
echo ""
echo "--- Diverged main (ff-only failure) ---"
REPO3=$(create_fixture_repo "diverged")
STATE3="$TMPDIR_BASE/state-diverged"
mkdir -p "$STATE3"

# Create a local-only commit on main that's NOT on remote
echo "local-only change" > "$REPO3/local-only.txt"
git -C "$REPO3" add local-only.txt
git -C "$REPO3" commit -m "local diverge" --quiet

# Push a different commit to remote main
REMOTE_DIR3="$TMPDIR_BASE/diverged-remote"
WORK3="$TMPDIR_BASE/diverged-work"
git clone --quiet "$REMOTE_DIR3" "$WORK3" 2>/dev/null
echo "remote change" > "$WORK3/remote-only.txt"
git -C "$WORK3" add remote-only.txt
git -C "$WORK3" commit -m "remote diverge" --quiet
git -C "$WORK3" push origin main --quiet 2>/dev/null
rm -rf "$WORK3"

OUTPUT3=$(GSTACK_EXTEND_STATE_DIR="$STATE3" "$SCRIPT_DIR/bin/update-run" "$REPO3" 2>&1 || true)
log "Output: $OUTPUT3"

if echo "$OUTPUT3" | grep -q "UPGRADE_FAILED.*ff-only"; then
  pass "Fails safely on diverged main"
else
  fail "Should fail with ff-only error" "Got: $OUTPUT3"
fi

# Verify the local commit still exists
LOCAL_COMMIT=$(git -C "$REPO3" log --oneline -1 2>/dev/null || true)
if echo "$LOCAL_COMMIT" | grep -q "local diverge"; then
  pass "Preserves local commits on failure"
else
  fail "Local commit should still be on main" "Got: $LOCAL_COMMIT"
fi


# ─── setup tests ──────────────────────────────────────────────

echo ""
echo "═══ setup ═══"

# Test: default install (uses mock HOME to avoid touching real ~/.claude/skills/)
echo ""
echo "--- Default install ---"
MOCK_HOME="$TMPDIR_BASE/mock-home"
mkdir -p "$MOCK_HOME"
OUTPUT=$(HOME="$MOCK_HOME" "$SCRIPT_DIR/setup" 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -q "Installed 5 skills"; then
  pass "Installs 5 skills to default skills dir"
else
  fail "Should install 5 skills" "Got: $OUTPUT"
fi

# Check symlinks were created
if [ -L "$MOCK_HOME/.claude/skills/pair-review/SKILL.md" ]; then
  LINK_TARGET=$(readlink "$MOCK_HOME/.claude/skills/pair-review/SKILL.md")
  if [ "$LINK_TARGET" = "$SCRIPT_DIR/skills/pair-review.md" ]; then
    pass "Symlink points to correct source"
  else
    fail "Symlink target wrong" "Got: $LINK_TARGET"
  fi
else
  fail "Should create pair-review symlink"
fi

if [ -L "$MOCK_HOME/.claude/skills/review-apparatus/SKILL.md" ]; then
  LINK_TARGET=$(readlink "$MOCK_HOME/.claude/skills/review-apparatus/SKILL.md")
  if [ "$LINK_TARGET" = "$SCRIPT_DIR/skills/review-apparatus.md" ]; then
    pass "review-apparatus symlink points to correct source"
  else
    fail "review-apparatus symlink target wrong" "Got: $LINK_TARGET"
  fi
else
  fail "Should create review-apparatus symlink"
fi

if [ -L "$MOCK_HOME/.claude/skills/test-plan/SKILL.md" ]; then
  LINK_TARGET=$(readlink "$MOCK_HOME/.claude/skills/test-plan/SKILL.md")
  if [ "$LINK_TARGET" = "$SCRIPT_DIR/skills/test-plan.md" ]; then
    pass "test-plan symlink points to correct source"
  else
    fail "test-plan symlink target wrong" "Got: $LINK_TARGET"
  fi
else
  fail "Should create test-plan symlink"
fi

if [ -L "$MOCK_HOME/.claude/skills/browse-native/SKILL.md" ]; then
  fail "Should NOT create browse-native symlink (removed in v0.10.0)"
else
  pass "browse-native not installed (removed in v0.10.0)"
fi

# Test: --with-native flag rejected (removed in v0.10.0)
echo ""
echo "--- --with-native rejected ---"
MOCK_HOME_NATIVE="$TMPDIR_BASE/mock-home-native-rejected"
mkdir -p "$MOCK_HOME_NATIVE"
OUTPUT=$(HOME="$MOCK_HOME_NATIVE" "$SCRIPT_DIR/setup" --with-native 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -q "Unknown option"; then
  pass "Rejects --with-native (flag removed in v0.10.0)"
else
  fail "Should reject --with-native flag" "Got: $OUTPUT"
fi

# Test: --uninstall (uses MOCK_HOME which has only stable skills installed)
echo ""
echo "--- Uninstall ---"
OUTPUT=$(HOME="$MOCK_HOME" "$SCRIPT_DIR/setup" --uninstall 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -q "Removed pair-review"; then
  pass "Uninstalls pair-review"
else
  fail "Should uninstall pair-review" "Got: $OUTPUT"
fi

if [ ! -L "$MOCK_HOME/.claude/skills/pair-review/SKILL.md" ]; then
  pass "pair-review symlink removed after uninstall"
else
  fail "pair-review symlink should be removed after uninstall"
fi

# Test: uninstall path still attempts to clean up legacy browse-native symlinks
# (for users upgrading from pre-0.10.0 installs). Create a stale symlink pointing
# to a non-existent source and verify uninstall leaves it alone because the link
# target does not match what this setup would have created.
echo ""
echo "--- Uninstall leaves foreign browse-native symlinks alone ---"
MOCK_HOME_LEGACY="$TMPDIR_BASE/mock-home-legacy"
mkdir -p "$MOCK_HOME_LEGACY/.claude/skills/browse-native"
ln -sf "/nonexistent/elsewhere.md" "$MOCK_HOME_LEGACY/.claude/skills/browse-native/SKILL.md"
OUTPUT=$(HOME="$MOCK_HOME_LEGACY" "$SCRIPT_DIR/setup" --uninstall 2>&1 || true)
log "Output: $OUTPUT"

if [ -L "$MOCK_HOME_LEGACY/.claude/skills/browse-native/SKILL.md" ]; then
  pass "Foreign browse-native symlink preserved (points elsewhere)"
else
  fail "Should not remove foreign browse-native symlink"
fi

# Test: unknown flag is rejected
echo ""
echo "--- Unknown flag ---"
MOCK_HOME3="$TMPDIR_BASE/mock-home-unknown"
mkdir -p "$MOCK_HOME3"
OUTPUT=$(HOME="$MOCK_HOME3" "$SCRIPT_DIR/setup" --bogus 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -q "Unknown option"; then
  pass "Rejects unknown flag"
else
  fail "Should reject unknown flag" "Got: $OUTPUT"
fi

if [ ! -d "$MOCK_HOME3/.claude/skills/pair-review" ]; then
  pass "Does not install anything on unknown flag"
else
  fail "Should not install when flag is unknown"
fi

# Tests for --skills-dir isolate HOME so a parse regression cannot touch the
# developer's real ~/.claude/skills.
MOCK_HOME_SKILLS_DIR="$TMPDIR_BASE/mock-home-skills-dir"
mkdir -p "$MOCK_HOME_SKILLS_DIR"

# Test: --skills-dir installs to custom directory
echo ""
echo "--- --skills-dir custom directory ---"
CUSTOM_DIR="$TMPDIR_BASE/custom-skills"
OUTPUT=$(HOME="$MOCK_HOME_SKILLS_DIR" "$SCRIPT_DIR/setup" --skills-dir "$CUSTOM_DIR" 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -qE "Installed [0-9]+ skills into $CUSTOM_DIR"; then
  pass "Installs to --skills-dir path"
else
  fail "Should install to --skills-dir path" "Got: $OUTPUT"
fi

if [ -L "$CUSTOM_DIR/pair-review/SKILL.md" ]; then
  LINK_TARGET=$(readlink "$CUSTOM_DIR/pair-review/SKILL.md")
  if [ "$LINK_TARGET" = "$SCRIPT_DIR/skills/pair-review.md" ]; then
    pass "Custom-dir symlink points to correct source"
  else
    fail "Custom-dir symlink target wrong" "Got: $LINK_TARGET"
  fi
else
  fail "Should create pair-review symlink in custom dir"
fi

# Defense-in-depth: confirm --skills-dir did not also touch the default path.
if [ ! -L "$MOCK_HOME_SKILLS_DIR/.claude/skills/pair-review/SKILL.md" ]; then
  pass "--skills-dir does not write to default ~/.claude/skills"
else
  fail "Default dir should be untouched when --skills-dir is set"
fi

# Test: --skills-dir with no value is rejected
echo ""
echo "--- --skills-dir with no value ---"
RC=0
OUTPUT=$(HOME="$MOCK_HOME_SKILLS_DIR" "$SCRIPT_DIR/setup" --skills-dir 2>&1) || RC=$?
log "Output: $OUTPUT (rc=$RC)"

if echo "$OUTPUT" | grep -q "requires a path argument"; then
  pass "Rejects --skills-dir with no value"
else
  fail "Should reject --skills-dir with no value" "Got: $OUTPUT"
fi

if [ "$RC" -ne 0 ]; then
  pass "Exits non-zero on --skills-dir with no value"
else
  fail "Should exit non-zero on --skills-dir with no value"
fi

# Test: --skills-dir followed by another flag (e.g., --uninstall) is rejected
echo ""
echo "--- --skills-dir <flag-like-value> ---"
OUTPUT=$(HOME="$MOCK_HOME_SKILLS_DIR" "$SCRIPT_DIR/setup" --skills-dir --uninstall 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -q "requires a path argument"; then
  pass "Rejects --skills-dir when value looks like a flag"
else
  fail "Should reject --skills-dir followed by another flag" "Got: $OUTPUT"
fi

# Test: --skills-dir with a relative path is rejected
echo ""
echo "--- --skills-dir with relative path ---"
OUTPUT=$(HOME="$MOCK_HOME_SKILLS_DIR" "$SCRIPT_DIR/setup" --skills-dir "relative/path" 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -q "requires an absolute path"; then
  pass "Rejects --skills-dir with a relative path"
else
  fail "Should reject --skills-dir with a relative path" "Got: $OUTPUT"
fi

# Test: --skills-dir != default prints the known-limitation warning
echo ""
echo "--- --skills-dir default-mismatch warning ---"
CUSTOM_DIR_WARN="$TMPDIR_BASE/custom-warn"
OUTPUT=$(HOME="$MOCK_HOME_SKILLS_DIR" "$SCRIPT_DIR/setup" --skills-dir "$CUSTOM_DIR_WARN" 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -q "Skill preambles still hardcode"; then
  pass "Warns when --skills-dir != default (known limitation)"
else
  fail "Should print known-limitation warning" "Got: $OUTPUT"
fi

# Default install should NOT print the warning
OUTPUT=$(HOME="$MOCK_HOME_SKILLS_DIR" "$SCRIPT_DIR/setup" 2>&1 || true)
if echo "$OUTPUT" | grep -q "Skill preambles still hardcode"; then
  fail "Should NOT print known-limitation warning on default install"
else
  pass "No known-limitation warning when SKILLS_DIR equals default"
fi
# Clean up default install (we just ran it via mock HOME)
HOME="$MOCK_HOME_SKILLS_DIR" "$SCRIPT_DIR/setup" --uninstall >/dev/null 2>&1 || true

# Test: --skills-dir + --uninstall removes from custom dir
echo ""
echo "--- --skills-dir + --uninstall ---"
OUTPUT=$(HOME="$MOCK_HOME_SKILLS_DIR" "$SCRIPT_DIR/setup" --skills-dir "$CUSTOM_DIR" --uninstall 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -q "Removed pair-review"; then
  pass "Uninstalls from --skills-dir path"
else
  fail "Should uninstall from --skills-dir path" "Got: $OUTPUT"
fi

if [ ! -L "$CUSTOM_DIR/pair-review/SKILL.md" ]; then
  pass "Custom-dir pair-review removed after uninstall"
else
  fail "Should remove pair-review from custom dir"
fi

# Defense-in-depth: verify EVERY skill got removed, not just pair-review
REMOVED_COUNT=$(echo "$OUTPUT" | grep -c "^Removed " || true)
if [ "$REMOVED_COUNT" -eq 5 ]; then
  pass "All 5 skills removed from custom dir"
else
  fail "Should remove all 5 skills from custom dir" "Removed count: $REMOVED_COUNT"
fi

# Test: --uninstall --skills-dir (order reversed) also works
echo ""
echo "--- --uninstall --skills-dir (reversed order) ---"
CUSTOM_DIR2="$TMPDIR_BASE/custom-skills-reversed"
if ! HOME="$MOCK_HOME_SKILLS_DIR" "$SCRIPT_DIR/setup" --skills-dir "$CUSTOM_DIR2" >/dev/null 2>&1; then
  fail "Pre-install for reversed-order test failed"
fi
OUTPUT=$(HOME="$MOCK_HOME_SKILLS_DIR" "$SCRIPT_DIR/setup" --uninstall --skills-dir "$CUSTOM_DIR2" 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -q "Removed pair-review"; then
  pass "Handles --uninstall --skills-dir in reversed order"
else
  fail "Should handle reversed flag order" "Got: $OUTPUT"
fi

# Test: --skills-dir handles paths that contain spaces
echo ""
echo "--- --skills-dir with spaces in path ---"
CUSTOM_DIR_SPACE="$TMPDIR_BASE/with space/skills"
OUTPUT=$(HOME="$MOCK_HOME_SKILLS_DIR" "$SCRIPT_DIR/setup" --skills-dir "$CUSTOM_DIR_SPACE" 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -qE "Installed [0-9]+ skills into"; then
  pass "Installs to --skills-dir path containing spaces"
else
  fail "Should handle path with spaces" "Got: $OUTPUT"
fi

if [ -L "$CUSTOM_DIR_SPACE/pair-review/SKILL.md" ]; then
  pass "Symlink created at path-with-spaces location"
else
  fail "Should create symlink at path-with-spaces location"
fi

# ─── semver tests ─────────────────────────────────────────────

echo ""
echo "═══ semver (4-digit) ═══"

source "$SCRIPT_DIR/bin/lib/semver.sh"

# 4-digit > 4-digit
echo ""
echo "--- version_gt 4-digit ---"
if version_gt "0.8.9.1" "0.8.9.0"; then
  pass "0.8.9.1 > 0.8.9.0"
else
  fail "0.8.9.1 should be > 0.8.9.0"
fi

if version_gt "0.9.0" "0.8.9.0"; then
  pass "0.9.0 > 0.8.9.0"
else
  fail "0.9.0 should be > 0.8.9.0"
fi

# 3-digit vs 4-digit with trailing .0 (should be equal)
if version_gt "0.8.9" "0.8.9.0"; then
  fail "0.8.9 should NOT be > 0.8.9.0 (equal)"
else
  pass "0.8.9 == 0.8.9.0 (not greater)"
fi

if version_gt "0.8.9.0" "0.8.9"; then
  fail "0.8.9.0 should NOT be > 0.8.9 (equal)"
else
  pass "0.8.9.0 == 0.8.9 (not greater)"
fi

# 4-digit < 4-digit
if version_gt "0.8.9.0" "0.8.9.1"; then
  fail "0.8.9.0 should NOT be > 0.8.9.1"
else
  pass "0.8.9.0 < 0.8.9.1"
fi

# ─── update-check tests ──────────────────────────────────────

echo ""
echo "═══ bin/update-check ═══"

# Test: version validation regex
echo ""
echo "--- Version regex validation ---"

# Valid versions (should be accepted by the regex)
for ver in "0.8.9" "0.8.9.0" "1.0.0" "0.8.10" "10.20.30.40"; do
  if echo "$ver" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$'; then
    pass "Accepts valid version: $ver"
  else
    fail "Should accept valid version: $ver"
  fi
done

# Invalid versions (should be rejected by the regex)
for ver in "1..2" "1.2." "1.2.3.4.5" "1" "abc" "1.2" ".1.2.3" "1.2.3." "1.2.3.4.5.6"; do
  if echo "$ver" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$'; then
    fail "Should reject invalid version: $ver"
  else
    pass "Rejects invalid version: $ver"
  fi
done

# Test: update-check with 4-digit versions
echo ""
echo "--- update-check with 4-digit versions ---"
UC_REPO=$(create_fixture_repo "uc-fourseg")
UC_STATE="$TMPDIR_BASE/state-uc-fourseg"
mkdir -p "$UC_STATE"

# Set local version to 4-digit
echo "0.8.9.0" > "$UC_REPO/VERSION"
git -C "$UC_REPO" add VERSION
git -C "$UC_REPO" commit -m "set 4-digit version" --quiet

# Copy update-check and semver lib into fixture
cp "$SCRIPT_DIR/bin/update-check" "$UC_REPO/bin/update-check"
mkdir -p "$UC_REPO/bin/lib"
cp "$SCRIPT_DIR/bin/lib/semver.sh" "$UC_REPO/bin/lib/semver.sh"
cp "$SCRIPT_DIR/bin/config" "$UC_REPO/bin/config"

# Create a fake remote that serves a newer 4-digit version
UC_REMOTE_FILE="$TMPDIR_BASE/uc-remote-version"
echo "0.8.9.1" > "$UC_REMOTE_FILE"

OUTPUT=$(GSTACK_EXTEND_DIR="$UC_REPO" \
  GSTACK_EXTEND_STATE_DIR="$UC_STATE" \
  GSTACK_EXTEND_REMOTE_URL="file://$UC_REMOTE_FILE" \
  "$UC_REPO/bin/update-check" --force 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -q "UPGRADE_AVAILABLE 0.8.9.0 0.8.9.1"; then
  pass "Detects upgrade: 0.8.9.0 → 0.8.9.1"
else
  fail "Should detect upgrade 0.8.9.0 → 0.8.9.1" "Got: $OUTPUT"
fi

# Test: 3-digit local == 4-digit remote with .0 (should be UP_TO_DATE)
echo "0.8.9" > "$UC_REPO/VERSION"
echo "0.8.9.0" > "$UC_REMOTE_FILE"
rm -f "$UC_STATE/last-update-check"

OUTPUT=$(GSTACK_EXTEND_DIR="$UC_REPO" \
  GSTACK_EXTEND_STATE_DIR="$UC_STATE" \
  GSTACK_EXTEND_REMOTE_URL="file://$UC_REMOTE_FILE" \
  "$UC_REPO/bin/update-check" --force 2>&1 || true)
log "Output: $OUTPUT"

if [ -z "$OUTPUT" ]; then
  pass "3-digit 0.8.9 treats 4-digit 0.8.9.0 remote as up-to-date"
else
  fail "0.8.9 should produce no output for 0.8.9.0 remote" "Got: $OUTPUT"
fi

# ─── Summary ──────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════"
echo "Results: $PASSED passed, $FAILED failed (of $TOTAL)"
echo "═══════════════════════════════════════"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
