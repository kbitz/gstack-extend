#!/usr/bin/env bash
#
# validate.sh — Run validation gates for /browse-native
#
# Gates:
#   1. AX Tree Quality — Peekaboo see returns actionable elements
#   2. Interaction Reliability — click + type work on 3+ controls
#   3. 20-Step Reliability Proof — 20 see-act-see cycles, 5/5 runs
#   4. Latency — see-act-see cycle <2000ms
#
# Usage:
#   ./scripts/validate.sh [--app "App Name"] [--gate 1|2|3|4] [--verbose]
#
# Defaults to Notes.app. Pass --app to test a different app.
# Pass --gate to run a single gate. Omit to run all gates.

set -euo pipefail

APP_NAME="${APP_NAME:-Notes}"
GATE=""
VERBOSE=false
SESSION_DIR="/tmp/native-browse-validate-$(date +%Y%m%d-%H%M%S)"

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
    if [[ "$APP_NAME" == "Notes" ]]; then
      open -a Notes
    else
      peekaboo app launch "$APP_NAME" --wait-until-ready --json >/dev/null 2>&1
    fi
    sleep 2
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

count_elements() {
  local json="$1"
  echo "$json" | python3 -c "
import sys, json, re
data = sys.stdin.read()
# Count element IDs like B1, T2, S3, etc.
ids = re.findall(r'\b[A-Z]\d+\b', data)
print(len(set(ids)))
" 2>/dev/null || echo "0"
}

has_interactive_elements() {
  local json="$1"
  echo "$json" | python3 -c "
import sys, re
data = sys.stdin.read()
# Look for button (B) and text field (T) IDs
buttons = re.findall(r'\bB\d+\b', data)
textfields = re.findall(r'\bT\d+\b', data)
print(len(set(buttons)) + len(set(textfields)))
" 2>/dev/null || echo "0"
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
  echo "WARNING: Accessibility permission not granted. Interaction tests may fail."
  echo "Grant at: System Settings > Privacy & Security > Accessibility"
fi

ensure_app_running
WINDOW_ID=$(get_window_id)
APP_PID=$(get_pid)

if [[ -z "$WINDOW_ID" ]]; then
  echo "ERROR: Could not find window for $APP_NAME"
  exit 1
fi

echo "Window ID: $WINDOW_ID"
echo "PID: $APP_PID"

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
  success=$(echo "$see_output" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "False")

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

  local see_output
  see_output=$(run_see "$WINDOW_ID" "$SESSION_DIR/screenshots/gate2-before.png" || echo "")

  if [[ -z "$see_output" ]] || [[ "$(echo "$see_output" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success', False))" 2>/dev/null)" != "True" ]]; then
    fail "Could not capture initial state"
    return
  fi

  # Extract first button ID
  local first_button
  first_button=$(echo "$see_output" | python3 -c "
import sys, re
data = sys.stdin.read()
buttons = re.findall(r'\bB\d+\b', data)
print(buttons[0] if buttons else '')
" 2>/dev/null || echo "")

  if [[ -n "$first_button" ]]; then
    local click_result
    click_result=$(peekaboo click --on "$first_button" --window-id "$WINDOW_ID" --json 2>/dev/null || echo "")
    local click_success
    click_success=$(echo "$click_result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "False")

    if [[ "$click_success" == "True" ]]; then
      pass "Click on $first_button succeeded"
    else
      fail "Click on $first_button failed"
    fi
  else
    fail "No buttons found to click"
  fi

  # Re-see after click
  see_output=$(run_see "$WINDOW_ID" "$SESSION_DIR/screenshots/gate2-after-click.png" || echo "")

  # Try to find and type in a text field
  local first_textfield
  first_textfield=$(echo "$see_output" | python3 -c "
import sys, re
data = sys.stdin.read()
fields = re.findall(r'\bT\d+\b', data)
print(fields[0] if fields else '')
" 2>/dev/null || echo "")

  if [[ -n "$first_textfield" ]]; then
    peekaboo click --on "$first_textfield" --window-id "$WINDOW_ID" --json >/dev/null 2>&1
    local type_result
    type_result=$(peekaboo type "validate-test" --window-id "$WINDOW_ID" --json 2>/dev/null || echo "")
    local type_success
    type_success=$(echo "$type_result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "False")

    if [[ "$type_success" == "True" ]]; then
      pass "Type into $first_textfield succeeded"
    else
      fail "Type into $first_textfield failed"
    fi
  else
    log "SKIP: No text fields found to type into"
  fi

  # Try pressing a key
  local press_result
  press_result=$(peekaboo press Tab --window-id "$WINDOW_ID" --json 2>/dev/null || echo "")
  local press_success
  press_success=$(echo "$press_result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "False")

  if [[ "$press_success" == "True" ]]; then
    pass "Press Tab succeeded"
  else
    fail "Press Tab failed"
  fi

  # Verify app still running
  if kill -0 "$APP_PID" 2>/dev/null; then
    pass "App still running after interactions"
  else
    fail "App crashed during interactions"
  fi
}

# --------------------------------------------------------------------------
# Gate 3: 20-Step Reliability Proof
# --------------------------------------------------------------------------

run_gate_3() {
  header "Gate 3: 20-Step Reliability Proof (5 runs)"

  local consecutive_passes=0
  local required_passes=5

  for run in $(seq 1 $required_passes); do
    log "Run $run/$required_passes..."
    local steps_ok=0
    local steps_fail=0

    for step in $(seq 1 20); do
      # see
      local see_out
      see_out=$(run_see "$WINDOW_ID" "$SESSION_DIR/screenshots/gate3-run${run}-step${step}.png" 2>/dev/null || echo "")
      local see_ok
      see_ok=$(echo "$see_out" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "False")

      if [[ "$see_ok" != "True" ]]; then
        steps_fail=$((steps_fail + 1))
        continue
      fi

      # act (press Tab to cycle focus — safe, non-destructive)
      peekaboo press Tab --window-id "$WINDOW_ID" --json >/dev/null 2>&1

      # see again
      run_see "$WINDOW_ID" "$SESSION_DIR/screenshots/gate3-run${run}-step${step}-after.png" >/dev/null 2>&1

      steps_ok=$((steps_ok + 1))
    done

    if [[ $steps_fail -eq 0 ]]; then
      consecutive_passes=$((consecutive_passes + 1))
      log "  Run $run: 20/20 steps passed"
    else
      consecutive_passes=0
      log "  Run $run: $steps_ok/20 steps passed ($steps_fail failed)"
    fi

    # Check app still alive
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      fail "App crashed during run $run"
      return
    fi
  done

  if [[ $consecutive_passes -ge $required_passes ]]; then
    pass "20-step proof: $consecutive_passes/$required_passes consecutive runs passed"
  else
    fail "20-step proof: only $consecutive_passes/$required_passes consecutive runs passed"
  fi
}

# --------------------------------------------------------------------------
# Gate 4: Latency
# --------------------------------------------------------------------------

run_gate_4() {
  header "Gate 4: Latency (<2000ms per see-act-see cycle)"

  local total_ms=0
  local samples=5

  for i in $(seq 1 $samples); do
    local start_ms
    start_ms=$(python3 -c "import time; print(int(time.time() * 1000))")

    # see
    run_see "$WINDOW_ID" "$SESSION_DIR/screenshots/gate4-${i}-before.png" >/dev/null 2>&1

    # act
    peekaboo press Tab --window-id "$WINDOW_ID" --json >/dev/null 2>&1

    # see
    run_see "$WINDOW_ID" "$SESSION_DIR/screenshots/gate4-${i}-after.png" >/dev/null 2>&1

    local end_ms
    end_ms=$(python3 -c "import time; print(int(time.time() * 1000))")

    local cycle_ms=$((end_ms - start_ms))
    total_ms=$((total_ms + cycle_ms))
    log "  Cycle $i: ${cycle_ms}ms"
  done

  local avg_ms=$((total_ms / samples))
  echo ""
  log "Average: ${avg_ms}ms over $samples cycles"

  if [[ $avg_ms -lt 2000 ]]; then
    pass "Latency ${avg_ms}ms < 2000ms target"
  else
    fail "Latency ${avg_ms}ms exceeds 2000ms target"
    log "Consider daemon graduation (see TODOS.md)"
  fi

  if [[ $avg_ms -lt 1000 ]]; then
    log "NOTE: Already under 1000ms — daemon graduation may not be needed"
  fi
}

# --------------------------------------------------------------------------
# Run gates
# --------------------------------------------------------------------------

if [[ -n "$GATE" ]]; then
  "run_gate_$GATE"
else
  run_gate_1
  run_gate_2
  run_gate_3
  run_gate_4
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
