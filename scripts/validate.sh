#!/usr/bin/env bash
#
# validate.sh — Run validation gates for /browse-native
#
# Gates:
#   1. AX Tree Quality — Peekaboo see returns actionable elements
#   2. Interaction Reliability — hotkey + click + type work
#   3. Latency — see-act-see cycle <2000ms
#
# Usage:
#   ./scripts/validate.sh [--app "App Name"] [--gate 1|2|3] [--verbose]
#
# Defaults to Notes.app. Pass --app to test a different app.
# Pass --gate to run a single gate. Omit to run all gates.

set -euo pipefail

APP_NAME="${APP_NAME:-TextEdit}"
GATE=""
VERBOSE=false
SESSION_DIR=$(mktemp -d /tmp/native-browse-validate-XXXXXXXX)

while [[ $# -gt 0 ]]; do
  case $1 in
    --app) APP_NAME="$2"; shift 2 ;;
    --gate) GATE="$2"; shift 2 ;;
    --verbose) VERBOSE=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$SESSION_DIR/screenshots"

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
  local bundle_id
  bundle_id=$(peekaboo window list --app "$APP_NAME" --json 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['target_application_info']['bundle_id'])" 2>/dev/null || true)

  if [[ -z "$bundle_id" ]]; then
    echo "Launching $APP_NAME..."
    # Create a temp file to open, avoids file-picker dialogs
    local tmpfile
    tmpfile="$SESSION_DIR/scratch.txt"
    touch "$tmpfile"
    open -a "$APP_NAME" "$tmpfile"
    sleep 2

    # Retry until a window appears
    local retries=5
    while [[ $retries -gt 0 ]]; do
      local wid
      wid=$(get_window_id)
      if [[ -n "$wid" ]]; then
        break
      fi
      sleep 1
      retries=$((retries - 1))
    done
  fi
}

get_window_id() {
  peekaboo window list --app "$APP_NAME" --json 2>/dev/null \
    | python3 -c "
import sys, json
d = json.load(sys.stdin)
windows = d['data']['windows']
if windows:
    print(windows[0]['window_id'])
else:
    print('')
" 2>/dev/null || echo ""
}

get_pid() {
  peekaboo window list --app "$APP_NAME" --json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['target_application_info']['pid'])" 2>/dev/null || echo ""
}

run_see() {
  local wid="$1"
  local path="${2:-$SESSION_DIR/screenshots/see-$(date +%s).png}"
  peekaboo see --window-id "$wid" --json --annotate --path "$path" 2>/dev/null
}

# Screenshot-only capture (no element detection, never times out)
take_screenshot() {
  local path="$1"
  screencapture -l "$WINDOW_ID" "$path" 2>/dev/null
  [[ -f "$path" ]]
}

count_elements() {
  local json="$1"
  echo "$json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d['data'].get('element_count', len(d['data'].get('ui_elements', []))))
" 2>/dev/null || echo "0"
}

has_interactive_elements() {
  local json="$1"
  echo "$json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
elems = d['data'].get('ui_elements', [])
buttons = [e for e in elems if e.get('role') == 'button']
textfields = [e for e in elems if e.get('role') in ('textField', 'text field')]
print(len(buttons) + len(textfields))
" 2>/dev/null || echo "0"
}

check_success() {
  echo "$1" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "False"
}

# --------------------------------------------------------------------------
# Pre-flight
# --------------------------------------------------------------------------

echo "browse-native validation"
echo "========================"
echo "App: $APP_NAME"
echo "Session: $SESSION_DIR"

# Check peekaboo installed
if ! command -v peekaboo &>/dev/null; then
  echo "ERROR: peekaboo not found. Install from https://peekaboo.dev"
  exit 1
fi

# Check permissions
PERMS=$(peekaboo permissions --json 2>/dev/null)
SCREEN_REC=$(echo "$PERMS" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for p in d['data']['permissions']:
    if p['name'] == 'Screen Recording':
        print('granted' if p['isGranted'] else 'denied')
        break
" 2>/dev/null || echo "unknown")

ACCESSIBILITY=$(echo "$PERMS" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for p in d['data']['permissions']:
    if p['name'] == 'Accessibility':
        print('granted' if p['isGranted'] else 'denied')
        break
" 2>/dev/null || echo "unknown")

echo "Screen Recording: $SCREEN_REC"
echo "Accessibility: $ACCESSIBILITY"

if [[ "$SCREEN_REC" != "granted" ]]; then
  echo "ERROR: Screen Recording permission required."
  echo "Grant at: System Settings > Privacy & Security > Screen Recording"
  exit 1
fi

if [[ "$ACCESSIBILITY" != "granted" ]]; then
  echo "ERROR: Accessibility permission required."
  echo "Grant at: System Settings > Privacy & Security > Accessibility"
  exit 1
fi

ensure_app_running
WINDOW_ID=$(get_window_id)
APP_PID=$(get_pid)

if [[ -z "$WINDOW_ID" ]]; then
  echo "ERROR: Could not find window for $APP_NAME"
  exit 1
fi

if [[ -z "$APP_PID" ]]; then
  echo "WARNING: Could not determine PID for $APP_NAME. Crash detection will be skipped."
fi

echo "Window ID: $WINDOW_ID"
echo "PID: ${APP_PID:-unknown}"

# --------------------------------------------------------------------------
# Gate 1: AX Tree Quality
# --------------------------------------------------------------------------

run_gate_1() {
  header "Gate 1: AX Tree Quality"

  local see_output
  see_output=$(run_see "$WINDOW_ID" "$SESSION_DIR/screenshots/gate1.png" || echo "")

  if [[ -z "$see_output" ]]; then
    fail "peekaboo see returned no output"
    return
  fi

  local success
  success=$(check_success "$see_output")

  if [[ "$success" != "True" ]]; then
    fail "peekaboo see did not succeed"
    if [[ "$VERBOSE" == "true" ]]; then
      echo "$see_output" | head -20
    fi
    return
  fi

  local elem_count
  elem_count=$(count_elements "$see_output")

  if [[ "$elem_count" -gt 0 ]]; then
    pass "AX tree contains $elem_count elements"
  else
    fail "AX tree is empty (0 elements)"
  fi

  local interactive_count
  interactive_count=$(has_interactive_elements "$see_output")

  if [[ "$interactive_count" -ge 3 ]]; then
    pass "Found $interactive_count interactive elements (buttons + text fields)"
  elif [[ "$interactive_count" -gt 0 ]]; then
    pass "Found $interactive_count interactive elements (fewer than 3, but present)"
  else
    fail "No interactive elements (buttons/text fields) found"
  fi
}

# --------------------------------------------------------------------------
# Gate 2: Interaction Reliability
# --------------------------------------------------------------------------

run_gate_2() {
  header "Gate 2: Interaction Reliability"

  # Screenshot: initial state
  take_screenshot "$SESSION_DIR/screenshots/gate2-01-initial.png" || true

  # Step 1: Click the document body to ensure focus
  local click_result
  click_result=$(peekaboo click --coords "300,300" --app "$APP_NAME" --json 2>/dev/null || echo "")
  local click_ok
  click_ok=$(check_success "$click_result")

  if [[ "$click_ok" == "True" ]]; then
    pass "Click into document"
  else
    fail "Click into document failed"
  fi

  # Step 2: Type text
  take_screenshot "$SESSION_DIR/screenshots/gate2-02-before-type.png" || true

  local type_result
  type_result=$(peekaboo type "validate-test" --app "$APP_NAME" --json 2>/dev/null || echo "")
  local type_ok
  type_ok=$(check_success "$type_result")

  if [[ "$type_ok" == "True" ]]; then
    pass "Typed text into document"
  else
    fail "Type into document failed"
  fi

  take_screenshot "$SESSION_DIR/screenshots/gate2-03-after-type.png" || true

  # Step 3: Hotkey test (Select All via Cmd+A)
  local hotkey_result
  hotkey_result=$(peekaboo hotkey --keys "cmd,a" --app "$APP_NAME" --json 2>/dev/null || echo "")
  local hotkey_ok
  hotkey_ok=$(check_success "$hotkey_result")

  if [[ "$hotkey_ok" == "True" ]]; then
    pass "Hotkey (Cmd+A) succeeded"
  else
    fail "Hotkey (Cmd+A) failed"
  fi

  take_screenshot "$SESSION_DIR/screenshots/gate2-04-after-hotkey.png" || true

  # Verify app still running
  if [[ -n "$APP_PID" ]]; then
    if kill -0 "$APP_PID" 2>/dev/null; then
      pass "App still running after interactions"
    else
      fail "App crashed during interactions"
    fi
  else
    log "SKIP: Crash detection (PID unknown)"
  fi
}

# --------------------------------------------------------------------------
# Gate 3: Latency
# --------------------------------------------------------------------------

run_gate_3() {
  header "Gate 3: Latency (<2000ms per see-act-see cycle)"

  # Single clean see-act-see measurement, matching real browse-skill usage:
  # snapshot → interact → snapshot (with natural spacing)

  local start_ms
  start_ms=$(python3 -c "import time; print(int(time.time() * 1000))")

  # see (snapshot to get element state)
  local see1
  see1=$(run_see "$WINDOW_ID" "$SESSION_DIR/screenshots/gate3-before.png" 2>/dev/null || echo "")

  # act (press Tab — safe, non-destructive)
  local act
  act=$(peekaboo press Tab --window-id "$WINDOW_ID" --json 2>/dev/null || echo "")

  # see (verify state after action)
  local see2
  see2=$(run_see "$WINDOW_ID" "$SESSION_DIR/screenshots/gate3-after.png" 2>/dev/null || echo "")

  local end_ms
  end_ms=$(python3 -c "import time; print(int(time.time() * 1000))")

  local see1_ok act_ok see2_ok
  see1_ok=$(check_success "$see1")
  act_ok=$(check_success "$act")
  see2_ok=$(check_success "$see2")

  local cycle_ms=$((end_ms - start_ms))

  if [[ "$see1_ok" != "True" ]] || [[ "$act_ok" != "True" ]] || [[ "$see2_ok" != "True" ]]; then
    fail "see-act-see cycle incomplete (see1=$see1_ok act=$act_ok see2=$see2_ok)"
    return
  fi

  log "Cycle time: ${cycle_ms}ms (see → Tab → see)"

  if [[ $cycle_ms -lt 2000 ]]; then
    pass "Latency ${cycle_ms}ms < 2000ms target"
  else
    fail "Latency ${cycle_ms}ms exceeds 2000ms target"
  fi
}

# --------------------------------------------------------------------------
# Cleanup: close the app
# --------------------------------------------------------------------------

close_app() {
  header "Cleanup: Close $APP_NAME"

  # Find the close button in the AX tree
  local see_output
  see_output=$(run_see "$WINDOW_ID" "$SESSION_DIR/screenshots/cleanup-before.png" 2>/dev/null || echo "")

  local close_button
  close_button=$(echo "$see_output" | python3 -c "
import sys, json
d = json.load(sys.stdin)
elems = d.get('data', {}).get('ui_elements', [])
for e in elems:
    label = (e.get('label') or '').lower()
    if e.get('role') == 'button' and 'close' in label:
        print(e['id'])
        break
" 2>/dev/null || echo "")

  if [[ -n "$close_button" ]]; then
    local click_result
    click_result=$(peekaboo click --on "$close_button" --window-id "$WINDOW_ID" --json 2>/dev/null || echo "")
    local click_ok
    click_ok=$(check_success "$click_result")

    if [[ "$click_ok" == "True" ]]; then
      pass "Clicked close button ($close_button)"
    else
      fail "Click close button failed"
    fi

    sleep 0.5

    # TextEdit may prompt "Don't Save" — dismiss it
    local dialog_see
    dialog_see=$(run_see "$WINDOW_ID" "$SESSION_DIR/screenshots/cleanup-dialog.png" 2>/dev/null || echo "")
    local dont_save
    dont_save=$(echo "$dialog_see" | python3 -c "
import sys, json
d = json.load(sys.stdin)
elems = d.get('data', {}).get('ui_elements', [])
for e in elems:
    label = (e.get('label') or '').lower()
    if e.get('role') == 'button' and ('don' in label and 'save' in label):
        print(e['id'])
        break
    if e.get('role') == 'button' and label == 'delete':
        print(e['id'])
        break
" 2>/dev/null || echo "")

    if [[ -n "$dont_save" ]]; then
      peekaboo click --on "$dont_save" --window-id "$WINDOW_ID" --json >/dev/null 2>&1 || true
      log "Dismissed save dialog"
    fi
  else
    log "Close button not found — killing process"
  fi

  sleep 0.5

  # Ensure process is gone
  if [[ -n "$APP_PID" ]]; then
    if kill -0 "$APP_PID" 2>/dev/null; then
      kill "$APP_PID" 2>/dev/null || true
      pass "Process cleaned up"
    else
      pass "App already closed"
    fi
  fi
}

# --------------------------------------------------------------------------
# Run gates
# --------------------------------------------------------------------------

if [[ -n "$GATE" ]]; then
  if ! declare -f "run_gate_$GATE" >/dev/null 2>&1; then
    echo "ERROR: Unknown gate '$GATE'. Valid gates: 1, 2, 3"
    exit 1
  fi
  "run_gate_$GATE"
else
  run_gate_1
  run_gate_2
  run_gate_3
  close_app
fi

# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------

echo ""
echo "========================"
echo "RESULTS: $PASS passed, $FAIL failed (out of $TOTAL)"
echo "========================"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
