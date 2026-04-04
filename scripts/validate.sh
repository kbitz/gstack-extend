#!/usr/bin/env bash
#
# validate.sh — Run validation gates for /browse-native (inside-out pattern)
#
# Gates:
#   1. Snapshot Bundle Validity — trigger produces valid bundle
#   2. osascript Interaction — activate, list windows, send keystroke
#   3. Cycle Latency — see-act-see cycle <3000ms
#
# Usage:
#   ./scripts/validate.sh [--app "App Name"] [--gate 1|2|3] [--verbose]
#   ./scripts/validate.sh [--degraded]  # Test degraded mode (no instrumentation)
#
# Defaults to TextEdit in degraded mode. Pass --app for instrumented apps.

set -euo pipefail

APP_NAME="${APP_NAME:-TextEdit}"
GATE=""
VERBOSE=false
DEGRADED=false
SESSION_DIR=$(mktemp -d /tmp/native-browse-validate-XXXXXXXX)

# Snapshot configuration — override via env or CLAUDE.md parsing
SNAPSHOT_DIR="${NATIVE_SNAPSHOT_DIR:-.context/snapshots}"
TRIGGER_FILE="${NATIVE_TRIGGER_FILE:-.context/snapshot-trigger}"

while [[ $# -gt 0 ]]; do
  case $1 in
    --app) APP_NAME="$2"; shift 2 ;;
    --gate) GATE="$2"; shift 2 ;;
    --verbose) VERBOSE=true; shift ;;
    --degraded) DEGRADED=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Sanitize APP_NAME to prevent shell injection in osascript calls
if [[ ! "$APP_NAME" =~ ^[a-zA-Z0-9\ ._-]+$ ]]; then
  echo "ERROR: Invalid app name: $APP_NAME (only alphanumeric, spaces, dots, hyphens, underscores allowed)"
  exit 1
fi

PASS=0
FAIL=0
TOTAL=0

log() { echo "  $1"; }
pass() { PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); log "PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); log "FAIL: $1"; }
header() { echo ""; echo "=== $1 ==="; }

cleanup() {
  if [[ "$VERBOSE" == "false" ]]; then
    rm -rf "$SESSION_DIR"
  else
    echo ""
    echo "Session directory: $SESSION_DIR"
  fi
}
trap cleanup EXIT

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

ensure_app_running() {
  local running
  running=$(osascript -e "tell application \"System Events\" to (name of processes) contains \"$APP_NAME\"" 2>/dev/null || echo "false")

  if [[ "$running" != "true" ]]; then
    echo "Launching $APP_NAME..."
    open -a "$APP_NAME"
    sleep 2

    local retries=5
    while [[ $retries -gt 0 ]]; do
      running=$(osascript -e "tell application \"System Events\" to (name of processes) contains \"$APP_NAME\"" 2>/dev/null || echo "false")
      if [[ "$running" == "true" ]]; then
        break
      fi
      sleep 1
      retries=$((retries - 1))
    done

    if [[ "$running" != "true" ]]; then
      echo "ERROR: Could not launch $APP_NAME"
      exit 1
    fi
  fi
}

trigger_snapshot() {
  # Touch the trigger file and wait for manifest to appear/update
  local manifest="$SNAPSHOT_DIR/latest/manifest.json"
  local before_mtime=""

  # Use content hash instead of mtime to avoid second-resolution TOCTOU race
  local before_hash=""
  if [[ -f "$manifest" ]]; then
    before_hash=$(md5 -q "$manifest" 2>/dev/null || echo "none")
  fi

  touch "$TRIGGER_FILE"

  # Poll for manifest update (200ms intervals, 2s timeout = 10 attempts)
  local attempts=10
  while [[ $attempts -gt 0 ]]; do
    if [[ -f "$manifest" ]]; then
      local current_hash
      current_hash=$(md5 -q "$manifest" 2>/dev/null || echo "none")
      if [[ "$current_hash" != "$before_hash" ]]; then
        return 0
      fi
    fi
    sleep 0.2
    attempts=$((attempts - 1))
  done

  return 1
}

screencapture_fallback() {
  # Degraded mode: capture using CGWindowID + screencapture
  local output_dir="$SESSION_DIR/degraded"
  mkdir -p "$output_dir"

  # Get CGWindowListIDs via Python (System Events AX IDs != CGWindowIDs)
  local window_id
  window_id=$(python3 -c "
import subprocess, json
result = subprocess.run(
    ['osascript', '-e', 'tell application \"System Events\" to get unix id of process \"$APP_NAME\"'],
    capture_output=True, text=True
)
pid = result.stdout.strip()
if pid:
    # Use CGWindowListCopyWindowInfo via Python to get CGWindowIDs for this PID
    import Quartz
    windows = Quartz.CGWindowListCopyWindowInfo(
        Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
        Quartz.kCGNullWindowID
    )
    for w in windows:
        if w.get('kCGWindowOwnerPID') == int(pid) and w.get('kCGWindowLayer', 999) == 0:
            print(w['kCGWindowNumber'])
            break
" 2>/dev/null || echo "")

  if [[ -z "$window_id" ]]; then
    # Fallback: capture the entire screen
    screencapture "$output_dir/window.png" 2>/dev/null
    return $?
  fi

  screencapture -l "$window_id" "$output_dir/window.png" 2>/dev/null
  return $?
}

# --------------------------------------------------------------------------
# Gate 1: Snapshot Bundle Validity
# --------------------------------------------------------------------------

gate1_snapshot_bundle() {
  header "Gate 1: Snapshot Bundle Validity"

  if [[ "$DEGRADED" == "true" ]]; then
    log "DEGRADED MODE: Testing screencapture fallback"

    if screencapture_fallback; then
      pass "screencapture produced a screenshot"
    else
      fail "screencapture failed"
    fi

    if [[ -f "$SESSION_DIR/degraded/window.png" ]]; then
      local size
      size=$(wc -c < "$SESSION_DIR/degraded/window.png" | tr -d ' ')
      if [[ "$size" -gt 1000 ]]; then
        pass "screenshot is non-trivial ($size bytes)"
      else
        fail "screenshot is suspiciously small ($size bytes)"
      fi
    else
      fail "no screenshot file produced"
    fi
    return
  fi

  # Full/partial mode: trigger and validate bundle
  if trigger_snapshot; then
    pass "snapshot trigger produced a response"
  else
    fail "snapshot trigger timed out (2s)"
    return
  fi

  local latest="$SNAPSHOT_DIR/latest"

  # manifest.json
  if [[ -f "$latest/manifest.json" ]]; then
    if python3 -c "import json; json.load(open('$latest/manifest.json'))" 2>/dev/null; then
      pass "manifest.json is valid JSON"
    else
      fail "manifest.json is not valid JSON"
    fi
  else
    fail "manifest.json not found"
  fi

  # windows/*.png
  local png_count
  png_count=$(find "$latest/windows" -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$png_count" -gt 0 ]]; then
    pass "found $png_count window screenshot(s)"
  else
    fail "no window screenshots found"
  fi

  # probes.json (optional — partial mode is OK)
  if [[ -f "$latest/probes.json" ]]; then
    if python3 -c "import json; json.load(open('$latest/probes.json'))" 2>/dev/null; then
      pass "probes.json is valid JSON"
    else
      fail "probes.json is not valid JSON"
    fi
  else
    log "NOTE: probes.json not found (partial instrumentation mode)"
  fi

  # state.json (optional — partial mode is OK)
  if [[ -f "$latest/state.json" ]]; then
    if python3 -c "import json; json.load(open('$latest/state.json'))" 2>/dev/null; then
      pass "state.json is valid JSON"
    else
      fail "state.json is not valid JSON"
    fi
  else
    log "NOTE: state.json not found (partial instrumentation mode)"
  fi
}

# --------------------------------------------------------------------------
# Gate 2: osascript Interaction
# --------------------------------------------------------------------------

gate2_osascript() {
  header "Gate 2: osascript Interaction"

  # Activate
  if osascript -e "tell application \"$APP_NAME\" to activate" 2>/dev/null; then
    pass "activate app via osascript"
  else
    fail "activate app via osascript"
  fi

  sleep 0.5

  # List windows
  local windows
  windows=$(osascript -e "tell application \"System Events\" to get name of every window of process \"$APP_NAME\"" 2>/dev/null || echo "")
  if [[ -n "$windows" ]]; then
    pass "list windows: $windows"
  else
    fail "list windows returned empty"
  fi

  # Send keystroke (Cmd+A — select all, harmless in most apps)
  if osascript -e "tell application \"System Events\" to keystroke \"a\" using command down" 2>/dev/null; then
    pass "send keystroke (Cmd+A)"
  else
    fail "send keystroke"
  fi

  # Verify app is still running after interactions
  local running
  running=$(osascript -e "tell application \"System Events\" to (name of processes) contains \"$APP_NAME\"" 2>/dev/null || echo "false")
  if [[ "$running" == "true" ]]; then
    pass "app still running after interactions"
  else
    fail "app crashed or quit during interaction"
  fi
}

# --------------------------------------------------------------------------
# Gate 3: Cycle Latency
# --------------------------------------------------------------------------

gate3_latency() {
  header "Gate 3: Cycle Latency (<3000ms)"

  if [[ "$DEGRADED" == "true" ]]; then
    log "DEGRADED MODE: Measuring screencapture latency"

    local total_ms=0
    local cycles=3

    for i in $(seq 1 $cycles); do
      local start_ms
      start_ms=$(python3 -c "import time; print(int(time.time() * 1000))")

      screencapture_fallback 2>/dev/null

      local end_ms
      end_ms=$(python3 -c "import time; print(int(time.time() * 1000))")

      local cycle_ms=$((end_ms - start_ms))
      total_ms=$((total_ms + cycle_ms))
      log "  Cycle $i: ${cycle_ms}ms"
    done

    local avg_ms=$((total_ms / cycles))
    if [[ $avg_ms -lt 3000 ]]; then
      pass "average cycle: ${avg_ms}ms"
    else
      fail "average cycle: ${avg_ms}ms (target: <3000ms)"
    fi
    return
  fi

  # Full mode: measure trigger-to-manifest cycle
  local total_ms=0
  local cycles=5
  local max_ms=0

  for i in $(seq 1 $cycles); do
    local start_ms
    start_ms=$(python3 -c "import time; print(int(time.time() * 1000))")

    if ! trigger_snapshot; then
      fail "snapshot trigger timed out on cycle $i"
      return
    fi

    local end_ms
    end_ms=$(python3 -c "import time; print(int(time.time() * 1000))")

    local cycle_ms=$((end_ms - start_ms))
    total_ms=$((total_ms + cycle_ms))
    if [[ $cycle_ms -gt $max_ms ]]; then
      max_ms=$cycle_ms
    fi

    if [[ "$VERBOSE" == "true" ]]; then
      log "  Cycle $i: ${cycle_ms}ms"
    fi
  done

  local avg_ms=$((total_ms / cycles))
  log "  avg: ${avg_ms}ms | worst: ${max_ms}ms"

  if [[ $max_ms -lt 3000 ]]; then
    pass "all cycles under 3000ms (worst: ${max_ms}ms)"
  else
    fail "worst cycle: ${max_ms}ms (target: <3000ms)"
  fi
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

echo "browse-native validation (inside-out pattern)"
echo "App: $APP_NAME"
echo "Mode: $(if [[ "$DEGRADED" == "true" ]]; then echo "DEGRADED"; else echo "INSTRUMENTED"; fi)"
echo ""

ensure_app_running

if [[ -n "$GATE" ]]; then
  case $GATE in
    1) gate1_snapshot_bundle ;;
    2) gate2_osascript ;;
    3) gate3_latency ;;
    *) echo "Unknown gate: $GATE"; exit 1 ;;
  esac
else
  gate1_snapshot_bundle
  gate2_osascript
  gate3_latency
fi

echo ""
echo "=== Results ==="
echo "  $PASS passed, $FAIL failed (of $TOTAL)"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
