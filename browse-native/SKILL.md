---
name: browse-native
description: |
  See, interact with, and QA-test native macOS apps via Peekaboo CLI.
  Build from source, launch, navigate UI, find visual and interaction bugs,
  test dark mode, window resizing, keyboard navigation, and accessibility.
  Use when asked to "test the native app", "QA the macOS app", "check the UI",
  or "interact with the app".
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# /browse-native — Native macOS App Interaction & QA

Interact with native macOS apps using Peekaboo CLI. See the UI, click elements,
type text, test dark mode, resize windows, audit accessibility, and find bugs —
all autonomously.

## Setup & Onboarding

Before first use, verify Peekaboo is installed and permissions are granted.

### Step 1: Check Peekaboo

```bash
which peekaboo || echo "NOT_INSTALLED"
```

If not installed: "Peekaboo is required. Install from https://peekaboo.dev or
via `brew install peekaboo`."

### Step 2: Check Permissions

```bash
peekaboo permissions --json
```

Parse the JSON output. For each permission where `isGranted` is `false`:
- Print the permission name and `grantInstructions` path
- Ask the user to grant it in System Settings
- Re-check after they confirm

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
defaults read -g AppleInterfaceStyle 2>/dev/null || echo "Light"
```

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

Use `--window-id $WINDOW_ID` for ALL subsequent interaction commands. This prevents
targeting the wrong window when multiple windows, sheets, or dialogs are open.

If the app restarts (e.g., after a rebuild), re-acquire the window ID.

## Core Pattern: See-Act-See

Every interaction follows this cycle:

### 1. See — Capture the current UI state

```bash
peekaboo see --window-id WINDOW_ID --json --annotate --path "$SESSION_DIR/screenshots/STATE_NAME.png"
```

This returns a JSON element map with IDs like `B1` (button 1), `T2` (text field 2),
`S3` (static text 3), etc. The annotated screenshot marks each element with its ID.

### 2. Act — Interact with an element

```bash
# Click an element by ID
peekaboo click --on B1 --window-id WINDOW_ID

# Type text into the focused field
peekaboo type "Hello world" --window-id WINDOW_ID

# Press a key
peekaboo press Enter --window-id WINDOW_ID

# Scroll
peekaboo scroll --direction down --amount 3 --window-id WINDOW_ID

# Open a menu
peekaboo menu --app "APP_NAME" --path "File > New"

# Keyboard shortcut
peekaboo hotkey --keys "command+n" --app "APP_NAME"
```

### 3. See Again — Verify the state changed

```bash
peekaboo see --window-id WINDOW_ID --json --annotate --path "$SESSION_DIR/screenshots/AFTER_ACTION.png"
```

Compare the before and after element maps to verify the action took effect.

### Important Notes

- **Always re-see after acting.** Element IDs are tied to snapshots. After any UI
  state change, the old IDs may be stale. Re-see to get fresh IDs.
- **Use --window-id, not --app.** This prevents targeting wrong windows.
- **Use --pid as fallback** if window-id targeting fails: `--pid $APP_PID`

## Output Management

For apps with complex UIs (>500 elements in the `see` output):
- Scope to a specific window using `--window-id`
- If still too large, focus on a specific area by describing what you're looking for
- Known limitation: Very complex AX trees may exceed context. In that case, target
  specific windows or use `--window-title` to narrow scope.

## Expansion Features

### Dark Mode Testing

**WARNING: This toggles the SYSTEM-WIDE appearance. Always restore after testing.**

```bash
# 1. Save current state (already done in session setup)
ORIGINAL=$(cat "$SESSION_DIR/original-appearance.txt")

# 2. Print restore command BEFORE toggling (crash recovery)
echo "RESTORE COMMAND: defaults write -g AppleInterfaceStyle -string $ORIGINAL"
# (or: defaults delete -g AppleInterfaceStyle   if original was Light)

# 3. Toggle to Dark
defaults write -g AppleInterfaceStyle -string Dark

# 4. Wait for apps to respond
sleep 1

# 5. Screenshot in dark mode
peekaboo see --window-id WINDOW_ID --json --annotate --path "$SESSION_DIR/screenshots/dark-mode.png"

# 6. Toggle to Light
defaults delete -g AppleInterfaceStyle

# 7. Wait and screenshot in light mode
sleep 1
peekaboo see --window-id WINDOW_ID --json --annotate --path "$SESSION_DIR/screenshots/light-mode.png"

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
peekaboo see --window-id WINDOW_ID --json --annotate --path "$SESSION_DIR/screenshots/resize-1280x800.png"

peekaboo window set-bounds --app "APP_NAME" --width 800 --height 600
peekaboo see --window-id WINDOW_ID --json --annotate --path "$SESSION_DIR/screenshots/resize-800x600.png"

# Test minimum size (resize very small, see what happens)
peekaboo window set-bounds --app "APP_NAME" --width 400 --height 300
peekaboo see --window-id WINDOW_ID --json --annotate --path "$SESSION_DIR/screenshots/resize-min.png"

# Restore original bounds
peekaboo window set-bounds --app "APP_NAME" --x ORIG_X --y ORIG_Y --width ORIG_W --height ORIG_H
```

Look for: truncated content, overlapping elements, broken layouts, missing scroll bars.

### Keyboard Navigation Audit

Test that all focusable elements are reachable via Tab:

```bash
# Click the first element to establish focus
peekaboo click --on B1 --window-id WINDOW_ID

# Tab through elements, capturing each focus state
peekaboo press Tab --window-id WINDOW_ID
peekaboo see --window-id WINDOW_ID --json --path "$SESSION_DIR/screenshots/tab-1.png"

peekaboo press Tab --window-id WINDOW_ID
peekaboo see --window-id WINDOW_ID --json --path "$SESSION_DIR/screenshots/tab-2.png"

# Repeat until focus returns to the first element or gets stuck
```

Check for:
- **Focus traps** — Tab stops cycling (stuck on one element)
- **Unreachable elements** — Interactive elements that Tab never reaches
- **Missing focus rings** — No visual indicator of which element is focused

### Accessibility Audit

Parse the `see --json` output to check for accessibility issues:

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
├── initial-state.png
├── after-navigation.png
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
# Check if process is still alive
kill -0 $APP_PID 2>/dev/null && echo "RUNNING" || echo "CRASHED"
```

If the app crashed:
1. Note the last action that was performed
2. Check for crash logs:

```bash
# Look for recent crash reports (within last 10 seconds)
find ~/Library/Logs/DiagnosticReports -name "*.ips" -newer "$SESSION_DIR" -maxdepth 1 2>/dev/null
```

3. If a crash log is found, read the first 50 lines for the crash reason
4. If no log found: "Crash detected but log not yet available. Check
   ~/Library/Logs/DiagnosticReports/ manually."
5. Report the crash with the last action as likely trigger

## Visual QA Checklist

When doing a visual QA pass, check for:

**Layout:**
- [ ] Elements aligned properly (no sub-pixel misalignment)
- [ ] Consistent spacing between elements
- [ ] No overlapping or clipped content
- [ ] Proper resizing behavior at different window sizes

**Typography:**
- [ ] Consistent font sizes and weights
- [ ] No truncated text (ellipsis where there shouldn't be)
- [ ] Proper line height and letter spacing

**Colors & Theme:**
- [ ] Dark mode renders correctly
- [ ] Sufficient contrast for readability
- [ ] Consistent color usage (no off-brand colors)
- [ ] System accent color respected where appropriate

**Interaction:**
- [ ] All buttons are clickable and respond
- [ ] Text fields accept input
- [ ] Menus open and items are selectable
- [ ] Keyboard shortcuts work as expected
- [ ] Tab navigation reaches all interactive elements

**Accessibility:**
- [ ] All interactive elements have labels
- [ ] All elements have appropriate roles
- [ ] Focus indicators are visible during keyboard navigation

**Edge Cases:**
- [ ] Empty states render properly
- [ ] Long text wraps or truncates gracefully
- [ ] Error states are visible and clear
- [ ] Loading states appear when needed
