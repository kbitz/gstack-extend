---
name: browse-native
description: |
  Focused interaction with native macOS apps via inside-out debug infrastructure.
  The app instruments itself (screenshots, layout probes, state dumps). The agent
  communicates via filesystem triggers and osascript. Three tiers: full
  instrumentation, partial, or screenshot-only degraded mode.
  Use when asked to "test this screen", "interact with the settings panel",
  "check the message composer", or "click through the onboarding flow".
  NOT for autonomous full-app QA — use /qa-native for that (when available).
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# /browse-native — Inside-Out Native App Interaction

Interact with a specific part of a native macOS app using inside-out debug
infrastructure. The app instruments itself: captures its own screenshots,
measures its own layout, dumps its own state. You communicate via filesystem
triggers and osascript.

**This is a focused interaction tool, not an autonomous QA suite.** It does one
thing well: interact with the part of the app you're pointed at. For full
autonomous QA, see /qa-native (roadmap).

## Step 0: Get a Target

**REQUIRED before doing anything else.** Ask the user what specific area or flow
they want to interact with. Do not start a broad exploration of the entire app.

Good targets:
- "Test the message composer — can I type and send a message?"
- "Check the settings screen in dark mode"
- "Navigate to the attachment picker and verify it opens"
- "Tab through the login form and check focus order"

If the user says something vague like "test the app" or "QA the native app", ask:
**"What specific screen or flow should I focus on?"**

Save the target as `$INTERACTION_TARGET` and scope all actions to it.

## Known Limitations

Be honest about what works and what doesn't before starting a session.

**Polling trigger adds latency.** The filesystem trigger mechanism has ~500ms of
polling overhead. A full See-Act-See cycle takes ~1-3 seconds. Plan interactions
efficiently — don't trigger a snapshot after every micro-action.

**No fine-grained element clicking.** You cannot click on a specific UI element
by ID or accessibility label. Use keyboard shortcuts and osascript menu access
instead. Most well-built macOS apps have rich keyboard navigation.

**Color and alignment from screenshots alone is unreliable.** LLMs cannot
reliably distinguish similar colors (#F5F5F7 vs #F0F0F2) or detect sub-pixel
misalignment from screenshots. Always use probes.json for exact values. If
probes are unavailable (degraded mode), explicitly state your uncertainty.

**App must be running.** The skill does not build or launch apps. The app must
be running with its debug infrastructure active (or degraded mode for
uninstrumented apps).

**Degraded mode is limited.** Without instrumentation, you only get screenshots
via screencapture. No structured data, no probes, no state. Useful for basic
visual checks only.

## Setup & Instrumentation Check

### Step 1: Read App Config

Check CLAUDE.md for native app configuration:

```yaml
## Native App
native_app_bundle_id: "com.example.MyApp"
native_app_scheme: "MyApp"
native_snapshot_dir: ".context/snapshots"
native_trigger_file: ".context/snapshot-trigger"
```

If config is missing, ask the user for:
- App name (as it appears in Activity Monitor)
- Snapshot directory path (if instrumented)
- Trigger file path (if instrumented)

Save the app name as `$APP_NAME`, snapshot dir as `$SNAPSHOT_DIR`, trigger file
as `$TRIGGER_FILE`.

### Step 2: Verify App Is Running

```bash
osascript -e 'tell application "System Events" to (name of processes) contains "APP_NAME"'
```

If not running, tell the user: "APP_NAME doesn't appear to be running. Please
launch it and try again." The skill does not build or launch apps.

### Step 3: Detect Instrumentation Tier

Check what debug infrastructure the app provides:

**Full instrumentation** (best experience):
```bash
ls "$SNAPSHOT_DIR/latest/manifest.json" 2>/dev/null
ls "$SNAPSHOT_DIR/latest/probes.json" 2>/dev/null
ls "$SNAPSHOT_DIR/latest/state.json" 2>/dev/null
ls "$SNAPSHOT_DIR/latest/windows/" 2>/dev/null
```

All files present → **Full mode.** Report: "Full instrumentation detected.
Screenshots, layout probes, and state dumps available."

**Partial instrumentation** (screenshots + state, no probes):
manifest.json and windows/ present but no probes.json → **Partial mode.**
Report: "Partial instrumentation. Screenshots and state available, but no
layout probes. Color and alignment comparisons will be approximate."

**No instrumentation** (degraded mode):
No snapshot directory or trigger file → **Degraded mode.** Report:
"No debug infrastructure detected. Running in degraded mode: osascript +
screencapture only. No structured data available. For better results, add
debug instrumentation to the app (see docs/designs/inside-out-debugging.md)."

Save the tier as `$TIER` (full / partial / degraded).

## osascript Interaction Primitives

These commands handle app interaction via Apple Events. osascript is more reliable
than accessibility-based tools for app automation but doesn't support fine-grained
element targeting.

### Activate App

```bash
osascript -e 'tell application "APP_NAME" to activate'
```

### List Windows

```bash
osascript -e 'tell application "System Events" to get name of every window of process "APP_NAME"'
```

### Trigger Menu Item

```bash
osascript -e 'tell application "System Events" to tell process "APP_NAME" to click menu item "ITEM" of menu "MENU" of menu bar 1'
```

Example: Open a new compose window:
```bash
osascript -e 'tell application "System Events" to tell process "Bolt" to click menu item "New Message" of menu "File" of menu bar 1'
```

### Send Keystroke

```bash
osascript -e 'tell application "System Events" to keystroke "KEY" using MODIFIER down'
```

Examples:
- `keystroke "n" using command down` — Cmd+N
- `keystroke "," using command down` — Cmd+, (Settings)
- `keystroke "a" using command down` — Cmd+A (Select All)
- `key code 48` — Tab
- `key code 36` — Return/Enter
- `key code 53` — Escape

### What osascript CANNOT Do

- Click on a specific UI element by identifier or accessibility label
- Type into a specific text field (it sends to the focused responder)
- Scroll a specific view
- Read UI element properties (use probes.json instead)

For these operations, use keyboard navigation (Tab, arrow keys, shortcuts) to
reach the target element, then act.

## The Core Pattern: See-Act-See

This is the fundamental interaction loop. Every interaction follows this pattern.

### Step 1: Trigger Snapshot

**Full/Partial mode:**
```bash
touch "$TRIGGER_FILE"
```

Then wait for a FRESH snapshot bundle (not a stale one from a previous run):
```bash
# Save hash of existing manifest (if any) BEFORE triggering
BEFORE_HASH=$(md5 -q "$SNAPSHOT_DIR/latest/manifest.json" 2>/dev/null || echo "none")
# Poll for manifest.json change (200ms intervals, 2s timeout)
for i in $(seq 1 10); do
  if [[ -f "$SNAPSHOT_DIR/latest/manifest.json" ]]; then
    CURRENT_HASH=$(md5 -q "$SNAPSHOT_DIR/latest/manifest.json" 2>/dev/null || echo "none")
    if [[ "$CURRENT_HASH" != "$BEFORE_HASH" ]]; then
      break
    fi
  fi
  sleep 0.2
done
```

**IMPORTANT:** Check that the manifest CHANGED, not just that it exists. A stale
manifest from a previous snapshot will already be on disk. Without the hash
comparison, you'll read stale data.

If timeout: retry once. If second attempt fails, report the error and fall back
to screencapture.

**Degraded mode:**
```bash
# Get the app's PID, then find its CGWindowID via Quartz
PID=$(osascript -e 'tell application "System Events" to get unix id of process "APP_NAME"')
# Use Python + Quartz to get the CGWindowID (System Events IDs are NOT CGWindowIDs)
WINDOW_ID=$(python3 -c "
import Quartz
windows = Quartz.CGWindowListCopyWindowInfo(
    Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements,
    Quartz.kCGNullWindowID
)
for w in windows:
    if w.get('kCGWindowOwnerPID') == $PID and w.get('kCGWindowLayer', 999) == 0:
        print(w['kCGWindowNumber'])
        break
")
screencapture -l "$WINDOW_ID" "/tmp/browse-native-capture.png"
```

Note: `screencapture -l` requires a CGWindowID (from `CGWindowListCopyWindowInfo`),
not an accessibility element ID from System Events. The Python/Quartz approach above
correctly maps PID to CGWindowID.

### Step 2: Read the Snapshot Bundle

**CRITICAL: Read summary.md FIRST** (if it exists). This tells you which windows
are present, which is focused, and what the app state is. This prevents the
common mistake of only looking at main.png.

```
Reading order:
1. summary.md (if exists) — overview of what's in the bundle
2. manifest.json — window list, z-order, focus state
3. ALL window screenshots — not just main.png
4. probes.json — exact frame coordinates and colors (full mode only)
5. state.json — app state (full/partial mode only)
```

### Step 3: Reason with Structured Data + Visual Confirmation

The screenshots show what actually rendered. The JSON tells you the precise
values. Use both together:

- **Color comparison:** Read hex values from probes.json, not from the screenshot.
  Two backgrounds that look identical in a screenshot might be #F5F5F7 vs #F0F0F2.
  The probes know. The screenshot doesn't.

- **Alignment checking:** Read frame coordinates from probes.json. Two elements
  that look aligned might be 2px off. The probes have exact coordinates.
  `{ "x": 12, "y": 48 }` vs `{ "x": 14, "y": 48 }` — that's a 2px horizontal
  misalignment the screenshot won't reveal.

- **State verification:** Read state.json to confirm what the app thinks is
  happening. The screenshot shows what rendered. The state shows the underlying
  data. If they disagree, that's a bug.

- **When probes are unavailable (partial/degraded mode):** Explicitly state
  uncertainty. Say "Based on the screenshot, these appear to be the same color,
  but I cannot verify without probe data." Never claim pixel-level precision
  without structured data to back it up.

### Step 4: Act

Choose the right interaction method:

1. **Keyboard shortcut** (preferred) — fastest, most reliable
2. **osascript menu item** — for menu-driven actions
3. **osascript keystroke** — for keyboard input
4. **Tab navigation** — to reach specific UI elements

### Step 5: Trigger Another Snapshot

Repeat Step 1 to capture the result of your action.

### Step 6: Compare Before/After

Compare the new snapshot with the previous one:
- Did the expected UI change occur?
- Did any unexpected changes occur?
- Are there visual regressions?

Use the manifest.json window list to check if windows appeared or disappeared.
Use state.json to check if app state changed as expected.

## Error Recovery

### Snapshot Trigger Timeout

If the trigger file doesn't produce a snapshot within 2 seconds:

1. Retry once (touch trigger file again, wait 2s)
2. If still no response: "Snapshot trigger timed out. Is the app running with
   debug infrastructure enabled?"
3. Fall back to screencapture for a basic screenshot
4. Continue in degraded mode for the rest of the session

### osascript Failure

If an osascript command fails:

1. Report the specific error message
2. Suggest a keyboard shortcut alternative if possible
3. Check if the app is still running
4. If the app crashed, report it and stop

### Missing Window

If a window referenced in the target isn't visible:

1. Read manifest.json for all windows
2. Try activating the app: `osascript -e 'tell application "APP_NAME" to activate'`
3. If the window was supposed to be opened by a menu action, retry the menu command
4. If still missing, report: "Window 'X' not found. Available windows: [list from manifest]"

### App Crash

If the app stops responding or disappears:

1. Check if the process is still running:
   ```bash
   osascript -e 'tell application "System Events" to (name of processes) contains "APP_NAME"'
   ```
2. Check for crash logs:
   ```bash
   ls -t ~/Library/Logs/DiagnosticReports/*.ips 2>/dev/null | head -3
   ```
3. Report: "APP_NAME appears to have crashed. Recent crash logs: [list if found]"
4. Stop the session — do not attempt to relaunch

## Session Reporting

At the end of a session, summarize what was tested and what was found:

```
## Session Report: $INTERACTION_TARGET

### Environment
- App: $APP_NAME
- Instrumentation: $TIER
- Snapshots taken: N
- Duration: Xm Ys

### Actions Taken
1. [action] → [result]
2. [action] → [result]
...

### Findings
- [issue or observation]
- [issue or observation]

### Limitations
- [anything you couldn't verify due to instrumentation tier]
```

Be specific about limitations. If you couldn't verify color accuracy because
probes were unavailable, say so. If you couldn't test a flow because osascript
couldn't reach a specific element, say so.

## App-Specific Configuration

Apps can provide additional configuration in CLAUDE.md to improve the skill's
effectiveness:

```yaml
## Native App
native_app_bundle_id: "com.example.MyApp"
native_app_scheme: "MyApp"
native_snapshot_dir: ".context/snapshots"
native_trigger_file: ".context/snapshot-trigger"

## App Keyboard Shortcuts (optional — helps the skill navigate)
# native_shortcuts:
#   new_window: "cmd+n"
#   settings: "cmd+,"
#   close_window: "cmd+w"
#   search: "cmd+f"
#   next_item: "j"
#   prev_item: "k"
#   select: "return"
```

When keyboard shortcuts are documented, prefer them over osascript menu access.
They're faster and more reliable.
