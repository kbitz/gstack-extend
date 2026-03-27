---
name: browse-native
description: |
  Focused interaction with native macOS apps via Peekaboo CLI. Point it at a
  specific screen, flow, or feature to interact with. Sees the UI, clicks
  elements, types text, and verifies state — scoped to what the user asks for.
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

# /browse-native — Focused Native macOS App Interaction

Interact with a specific part of a native macOS app using Peekaboo CLI. See the
UI, click elements, type text, and verify state — scoped to a targeted area or
flow that the user specifies.

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

**SwiftUI apps often have sparse AX trees.** `see --json` may return few or no
interactive elements (B1, T2, etc.) for SwiftUI views. When this happens,
element-based clicking (`click --on B1`) won't work. The skill detects this
during capability probing and switches to keyboard-first mode automatically.

**Window targeting can fail.** `--window-id` sometimes fails with "Failed to focus
frontmost window." The skill falls back to `--app` targeting when this happens.

**Keystroke delivery is not guaranteed.** `peekaboo type` reports success even when
the target view doesn't have keyboard focus. There's no way to verify which
responder received the input — you must verify via screenshot.

**Each `see` command takes 3-5 seconds.** A See-Act-See cycle is 7-10 seconds
minimum. Plan interactions efficiently — batch where possible, don't screenshot
after every micro-action.

**Sandboxed apps may block input.** Some apps restrict programmatic input. If
interactions consistently fail, this may be the cause.

## Setup & Onboarding

Before first use, verify Peekaboo is installed and permissions are granted.

### Step 1: Check Peekaboo

```bash
which peekaboo
```

If not found: "Peekaboo is required. Install via
`brew install steipete/tap/peekaboo` (see https://github.com/steipete/Peekaboo)."

### Step 2: Check Permissions

First, detect which app needs permissions. macOS grants Accessibility and Screen
Recording to the **host app** (the terminal or IDE), not to CLI tools like Peekaboo.

```bash
echo "${__CFBundleIdentifier:-unknown}"
```

Map the bundle ID to a friendly name:
- `com.apple.Terminal` → Terminal
- `com.mitchellh.ghostty` → Ghostty
- `com.googlecode.iterm2` → iTerm2
- `net.kovidgoyal.kitty` → kitty
- `dev.warp.Warp-Stable` → Warp
- `com.conductor.app` → Conductor
- `com.microsoft.VSCode` → Visual Studio Code
- `com.todesktop.230313mzl4w4u92` → Cursor
- `com.anthropic.claudedesktop` → Claude for Desktop
- `com.anthropic.claudecode.desktop` → Claude Code
- `unknown` or unrecognized → "your terminal app"

Save the resolved name as `$HOST_APP`.

Then check permission status:

```bash
peekaboo permissions --json
```

Parse the JSON output. For each permission where `isGranted` is `false`:
- Tell the user: "**$HOST_APP** needs $PERMISSION_NAME permission."
- Print the `grantInstructions` path (e.g., System Settings > Privacy & Security > Screen Recording)
- Clarify: "Add **$HOST_APP** (not Peekaboo) to the list."
- Ask the user to grant it, then re-check after they confirm

Required permissions:
- **Screen Recording** — needed for screenshots and UI capture
- **Accessibility** — needed for element detection and interaction

### Step 3: Read App Config

Check CLAUDE.md for native app configuration:

```yaml
## Native App
native_app_bundle_id: "com.example.MyApp"
native_app_scheme: "MyApp"
# Optional:
# native_workspace_path: "MyApp.xcworkspace"
# native_build_configuration: "Debug"
# native_launch_args: ""
# native_build_timeout: 120
```

If `native_app_bundle_id` is missing, ask the user:
- What is the bundle ID? (e.g., `com.example.MyApp`)
- What is the Xcode scheme name?
- Save to CLAUDE.md for future runs.

## Session Setup

At the start of each interaction session:

```bash
SESSION_DIR="/tmp/native-browse-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$SESSION_DIR/screenshots"
echo "$SESSION_DIR"
```

Save the dark mode state for later restoration:

```bash
defaults read -g AppleInterfaceStyle 2>/dev/null
```

If output is "Dark", save "Dark". If command fails (exit 1), save "Light".
Write the result to `$SESSION_DIR/original-appearance.txt`.

## Build & Launch

### Build from Source

Only if the user asks to build, or the app isn't running:

```bash
xcodebuild \
  -workspace "PATH_TO_WORKSPACE" \
  -scheme "SCHEME_NAME" \
  -destination 'platform=macOS' \
  -configuration Debug \
  build \
  -derivedDataPath "$SESSION_DIR/DerivedData" \
  2>&1
```

- Replace `PATH_TO_WORKSPACE` and `SCHEME_NAME` from CLAUDE.md config
- If `native_workspace_path` is not set, auto-detect: `find . -name "*.xcworkspace" -not -path "*/Pods/*" | head -1`
- Timeout: 120s (or `native_build_timeout` from CLAUDE.md)
- If build fails, read the stderr output and troubleshoot naturally

### Launch the App

```bash
peekaboo app launch --bundle-id "BUNDLE_ID" --wait-until-ready --json
```

### Capture Target Identity

After launch, capture the PID and window ID for deterministic targeting:

```bash
peekaboo window list --app "APP_NAME" --json
```

From the JSON response, extract:
- `data.target_application_info.pid` → save as `$APP_PID`
- `data.windows[0].window_id` → save as `$WINDOW_ID`

### Capability Probe

**Run this immediately after launch, before any interaction.** This determines
which interaction mode to use for the session.

```bash
peekaboo see --window-id $WINDOW_ID --json --path "$SESSION_DIR/screenshots/probe.png"
```

Evaluate the result:

1. **Did `--window-id` work?** If it failed with "Failed to focus frontmost window"
   or similar, set `$TARGET_MODE=app` and use `--app "APP_NAME"` for all subsequent
   commands. Otherwise set `$TARGET_MODE=window`.

2. **Count interactive elements.** From the JSON, count elements with IDs (B1, T2, etc.):
   - **≥5 interactive elements** → `$INTERACTION_MODE=element` (use click --on ID)
   - **<5 interactive elements** → `$INTERACTION_MODE=keyboard` (use hotkeys, type, press)

3. **Test keyboard delivery.** Send a no-op key and screenshot:
   ```bash
   peekaboo hotkey --keys "cmd,l" --app "APP_NAME"
   ```
   Screenshot and verify the app responded. If it did, keyboard input works.
   If not, note that keystroke delivery is unreliable for this app.

Log the probe results to `$SESSION_DIR/probe-results.txt`:
```
target_mode: window|app
interaction_mode: element|keyboard
keyboard_delivery: verified|unreliable
element_count: N
```

## Interaction Modes

### Element Mode (`$INTERACTION_MODE=element`)

Use when the AX tree returns rich element maps. This is the ideal path.

Follow the See-Act-See pattern (see below), clicking elements by their IDs.

### Keyboard Mode (`$INTERACTION_MODE=keyboard`)

Use when element detection is sparse (common with SwiftUI apps). Interact
primarily through keyboard shortcuts, typing, and tab navigation.

**Strategy:**
- Use `peekaboo hotkey` for app-level actions (cmd+n, cmd+s, cmd+comma, etc.)
- Use `peekaboo type` for text input (verify delivery via screenshot)
- Use `peekaboo press Tab` to move between controls
- Use `peekaboo press Enter` / `peekaboo press Space` to activate focused elements
- Use `peekaboo menu --app "APP_NAME" --path "Menu > Item"` for menu bar actions
- Use `peekaboo click --x X --y Y` for coordinate-based clicking as a last resort
  (identify coordinates from the annotated screenshot)

**Establishing focus:** Before typing, ensure the target field has focus. Either:
1. Click the field by coordinates (from the screenshot)
2. Tab to the field
3. Use a shortcut that focuses it (e.g., cmd+L for address bars)

Always screenshot after typing to verify the text appeared where expected.

## Core Pattern: See-Act-See

Every interaction follows this cycle:

### 1. See — Capture the current UI state

Use the targeting flag from your probe results:

```bash
# If target_mode=window:
peekaboo see --window-id $WINDOW_ID --json --annotate --path "$SESSION_DIR/screenshots/STATE_NAME.png"

# If target_mode=app:
peekaboo see --app "APP_NAME" --json --annotate --path "$SESSION_DIR/screenshots/STATE_NAME.png"
```

This returns a JSON element map with IDs like `B1` (button 1), `T2` (text field 2),
`S3` (static text 3), etc. The annotated screenshot marks each element with its ID.

### 2. Act — Interact with the app

Choose the right tool based on your interaction mode:

**Element mode:**
```bash
peekaboo click --on B1 --window-id $WINDOW_ID
peekaboo type "Hello world" --window-id $WINDOW_ID
peekaboo press Enter --window-id $WINDOW_ID
peekaboo scroll --direction down --amount 3 --window-id $WINDOW_ID
```

**Keyboard mode:**
```bash
peekaboo hotkey --keys "cmd,n" --app "APP_NAME"
peekaboo type "Hello world" --app "APP_NAME"
peekaboo press Tab --app "APP_NAME"
peekaboo press Enter --app "APP_NAME"
peekaboo menu --app "APP_NAME" --path "File > New"
peekaboo click --x 200 --y 150 --app "APP_NAME"
```

**Batching actions:** When performing a sequence of actions where intermediate
state doesn't matter, batch them with a single screenshot at the end:

```bash
peekaboo hotkey --keys "cmd,n" --app "APP_NAME"
sleep 0.2
peekaboo type "Document title" --app "APP_NAME"
sleep 0.2
peekaboo press Tab --app "APP_NAME"
peekaboo type "Document body" --app "APP_NAME"
# NOW screenshot to verify the whole sequence
peekaboo see --app "APP_NAME" --json --annotate --path "$SESSION_DIR/screenshots/after-sequence.png"
```

This turns 5 See-Act-See cycles into 1 — much faster.

### 3. See Again — Verify the state changed

```bash
peekaboo see --app "APP_NAME" --json --annotate --path "$SESSION_DIR/screenshots/AFTER_ACTION.png"
```

Compare the before and after screenshots to verify the action took effect.

### Important Notes

- **Always re-see after acting.** Element IDs are tied to snapshots. After any UI
  state change, the old IDs may be stale. Re-see to get fresh IDs.
- **Batch when possible.** Only screenshot when you need to verify or make a decision.
  Don't screenshot between every keystroke in a sequence.
- **Start with short waits.** Use `sleep 0.2` between rapid actions. Only increase
  to `sleep 0.5` or `sleep 1` if the UI hasn't updated (e.g., after launching a
  window, opening a sheet, or triggering an animation).

## Error Recovery

When something goes wrong, follow these patterns:

### Window targeting fails
```
Error: "Failed to focus frontmost window"
```
**Recovery:** Switch `$TARGET_MODE` to `app`. Use `--app "APP_NAME"` for all
subsequent commands. Re-probe to get fresh state.

### Element click does nothing
The click reported success but the UI didn't change.
**Recovery:**
1. The element may be decorative, not interactive. Check the element role in the JSON.
2. Try double-click: `peekaboo click --on B1 --window-id $WINDOW_ID --double`
3. Fall back to keyboard: use Tab to reach the element, then press Enter/Space.
4. Fall back to coordinate click from the annotated screenshot.

### Keystrokes not received
`peekaboo type` reported success but text didn't appear.
**Recovery:**
1. The wrong view likely has focus. Click the target field by coordinates first.
2. Try `peekaboo hotkey --keys "cmd,a"` then `peekaboo type` to select-all and replace.
3. If the app is in a modal state (dialog, sheet), dismiss it first.

### App becomes unresponsive
Actions succeed but the UI doesn't update across multiple attempts.
**Recovery:**
1. Check if the app is still running: `kill -0 $APP_PID 2>/dev/null`
2. Check for modal dialogs blocking input — screenshot to see current state.
3. Try Escape to dismiss any hidden modals.
4. Last resort: re-launch the app and re-probe.

### AX tree suddenly empty
Previously working element detection stops returning results.
**Recovery:** The app likely changed windows (opened a sheet, dialog, or popover).
1. Re-list windows: `peekaboo window list --app "APP_NAME" --json`
2. Update `$WINDOW_ID` if a new window appeared.
3. If no new window, the view hierarchy changed — switch to keyboard mode.

## Output Management

For apps with complex UIs (>500 elements in the `see` output):
- Scope to a specific window using `--window-id`
- If still too large, focus on a specific area by describing what you're looking for
- Known limitation: Very complex AX trees may exceed context. In that case, target
  specific windows or use `--window-title` to narrow scope.

## Additional Capabilities

Use these only when the user's target specifically calls for them (e.g., "check
dark mode on the settings screen", "test how the sidebar resizes"). Do not run
these unprompted.

### Dark Mode Testing

**WARNING: This toggles the SYSTEM-WIDE appearance. Always restore after testing.**

```bash
# 1. Save current state (already done in session setup)
ORIGINAL=$(cat "$SESSION_DIR/original-appearance.txt")

# 2. Print restore command BEFORE toggling (crash recovery)
if [[ "$ORIGINAL" == "Dark" ]]; then
  echo "RESTORE COMMAND: defaults write -g AppleInterfaceStyle -string Dark"
else
  echo "RESTORE COMMAND: defaults delete -g AppleInterfaceStyle"
fi

# 3. Toggle to Dark
defaults write -g AppleInterfaceStyle -string Dark

# 4. Wait for apps to respond
sleep 1

# 5. Screenshot in dark mode
peekaboo see --app "APP_NAME" --json --annotate --path "$SESSION_DIR/screenshots/dark-mode.png"

# 6. Toggle to Light
defaults delete -g AppleInterfaceStyle

# 7. Wait and screenshot in light mode
sleep 1
peekaboo see --app "APP_NAME" --json --annotate --path "$SESSION_DIR/screenshots/light-mode.png"

# 8. Restore original
# If ORIGINAL was "Dark": defaults write -g AppleInterfaceStyle -string Dark
# If ORIGINAL was "Light": defaults delete -g AppleInterfaceStyle
```

Compare the dark and light screenshots for:
- Text readability (contrast issues)
- Missing dark mode adaptations (bright backgrounds, invisible text)
- Asset issues (images not adapting to dark mode)

### Window Resize Testing

Test layout at different sizes:

```bash
# Save original bounds
peekaboo window list --app "APP_NAME" --json
# Extract bounds from response

# Test predefined sizes
peekaboo window set-bounds --app "APP_NAME" --width 1280 --height 800
peekaboo see --app "APP_NAME" --json --annotate --path "$SESSION_DIR/screenshots/resize-1280x800.png"

peekaboo window set-bounds --app "APP_NAME" --width 800 --height 600
peekaboo see --app "APP_NAME" --json --annotate --path "$SESSION_DIR/screenshots/resize-800x600.png"

# Test minimum size (resize very small, see what happens)
peekaboo window set-bounds --app "APP_NAME" --width 400 --height 300
peekaboo see --app "APP_NAME" --json --annotate --path "$SESSION_DIR/screenshots/resize-min.png"

# Restore original bounds
peekaboo window set-bounds --app "APP_NAME" --x ORIG_X --y ORIG_Y --width ORIG_W --height ORIG_H
```

Look for: truncated content, overlapping elements, broken layouts, missing scroll bars.

### Keyboard Navigation Audit

Test that all focusable elements are reachable via Tab:

```bash
# Click the first interactive area to establish focus
peekaboo click --x 200 --y 200 --app "APP_NAME"

# Tab through elements, capturing each focus state
peekaboo press Tab --app "APP_NAME"
peekaboo see --app "APP_NAME" --json --path "$SESSION_DIR/screenshots/tab-1.png"

peekaboo press Tab --app "APP_NAME"
peekaboo see --app "APP_NAME" --json --path "$SESSION_DIR/screenshots/tab-2.png"

# Repeat until focus returns to the first element or gets stuck
```

Check for:
- **Focus traps** — Tab stops cycling (stuck on one element)
- **Unreachable elements** — Interactive elements that Tab never reaches
- **Missing focus rings** — No visual indicator of which element is focused

### Accessibility Audit

Parse the `see --json` output to check for accessibility issues.

**Note:** This audit is only meaningful in element mode. If the AX tree is sparse
(keyboard mode), report: "AX tree too sparse for accessibility audit — SwiftUI app
may need explicit .accessibilityLabel() and .accessibilityRole() modifiers."

From the element map, check each interactive element (buttons, text fields, etc.):
- **Missing labels** — elements with no `label` or `accessibilityLabel`
- **Missing roles** — elements with no `role` specified
- **Generic labels** — labels like "button", "image", or empty strings

Report findings as:
```
ACCESSIBILITY AUDIT
===================
[PASS] B1: "Save" button — has label and role
[FAIL] B3: button — missing label (add .accessibilityLabel("description"))
[FAIL] I2: image — generic label "image" (add .accessibilityLabel("description"))
[PASS] T1: "Username" text field — has label and role
```

### Screenshot Gallery

Organize screenshots by state in the session directory:

```
$SESSION_DIR/screenshots/
├── probe.png
├── initial-state.png
├── after-sequence.png
├── dark-mode.png
├── light-mode.png
├── resize-1280x800.png
├── resize-800x600.png
├── resize-min.png
├── tab-1.png
├── tab-2.png
└── ...
```

Use descriptive filenames that reflect the app state at capture time.

### Crash Detection

After any interaction, check if the app is still running:

```bash
kill -0 $APP_PID 2>/dev/null
```

If exit code is non-zero (app crashed):
1. Note the last action that was performed
2. Check for crash logs:

```bash
find ~/Library/Logs/DiagnosticReports -name "*.ips" -newer "$SESSION_DIR" -maxdepth 1 2>/dev/null
```

3. If a crash log is found, read the first 50 lines for the crash reason
4. If no log found: "Crash detected but log not yet available. Check
   ~/Library/Logs/DiagnosticReports/ manually."
5. Report the crash with the last action as likely trigger

## Reporting

When done with the targeted interaction, report:

1. **What was tested** — restate the target and what steps were taken
2. **What worked** — interactions that succeeded as expected
3. **What didn't work** — interactions that failed or produced unexpected results
4. **Screenshots** — reference the before/after screenshots in `$SESSION_DIR`

Keep the report scoped to the target. Do not extrapolate findings to untested
areas of the app.
