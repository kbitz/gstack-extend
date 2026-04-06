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

if echo "$OUTPUT" | grep -q "Installed 2 skills"; then
  pass "Installs 2 skills to default skills dir"
else
  fail "Should install 2 skills" "Got: $OUTPUT"
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

if [ -L "$MOCK_HOME/.claude/skills/browse-native/SKILL.md" ]; then
  fail "Should NOT create browse-native symlink by default"
else
  pass "browse-native not installed by default (beta)"
fi

# Test: --with-native installs both
echo ""
echo "--- Install with --with-native ---"
MOCK_HOME2="$TMPDIR_BASE/mock-home-native"
mkdir -p "$MOCK_HOME2"
OUTPUT=$(HOME="$MOCK_HOME2" "$SCRIPT_DIR/setup" --with-native 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -q "Installed 3 skills"; then
  pass "--with-native reports 3 skills installed"
else
  fail "--with-native should report 3 skills" "Got: $OUTPUT"
fi

if [ -L "$MOCK_HOME2/.claude/skills/pair-review/SKILL.md" ]; then
  pass "--with-native installs pair-review"
else
  fail "--with-native should install pair-review"
fi

if [ -L "$MOCK_HOME2/.claude/skills/browse-native/SKILL.md" ]; then
  pass "--with-native installs browse-native"
else
  fail "--with-native should install browse-native"
fi

# Test: --uninstall (uses MOCK_HOME2 which has both skills installed)
echo ""
echo "--- Uninstall ---"
OUTPUT=$(HOME="$MOCK_HOME2" "$SCRIPT_DIR/setup" --uninstall 2>&1 || true)
log "Output: $OUTPUT"

if echo "$OUTPUT" | grep -q "Removed pair-review"; then
  pass "Uninstalls pair-review"
else
  fail "Should uninstall pair-review" "Got: $OUTPUT"
fi

if echo "$OUTPUT" | grep -q "Removed browse-native"; then
  pass "Uninstalls browse-native"
else
  fail "Should uninstall browse-native" "Got: $OUTPUT"
fi

if [ ! -L "$MOCK_HOME2/.claude/skills/pair-review/SKILL.md" ]; then
  pass "pair-review symlink removed after uninstall"
else
  fail "pair-review symlink should be removed after uninstall"
fi

if [ ! -L "$MOCK_HOME2/.claude/skills/browse-native/SKILL.md" ]; then
  pass "browse-native symlink removed after uninstall"
else
  fail "browse-native symlink should be removed after uninstall"
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

# ─── Summary ──────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════"
echo "Results: $PASSED passed, $FAILED failed (of $TOTAL)"
echo "═══════════════════════════════════════"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
