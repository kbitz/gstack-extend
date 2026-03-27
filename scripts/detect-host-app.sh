#!/usr/bin/env bash
#
# detect-host-app.sh — Detect which app is hosting the terminal session
#
# macOS grants Accessibility and Screen Recording permissions to the host app
# (e.g. Terminal, Ghostty, Conductor), not to CLI tools like peekaboo.
# This script identifies that host app so we can tell the user exactly
# which app to authorize in System Settings.
#
# Output (JSON):
#   { "bundle_id": "com.conductor.app", "name": "Conductor" }
#
# Usage:
#   source scripts/detect-host-app.sh
#   HOST_APP_NAME=$(detect_host_app_name)
#   HOST_APP_BUNDLE=$(detect_host_app_bundle)

detect_host_app_bundle() {
  # __CFBundleIdentifier is set by macOS for the hosting .app process
  if [[ -n "${__CFBundleIdentifier:-}" ]]; then
    echo "$__CFBundleIdentifier"
    return
  fi

  # Fallback: walk the process tree to find the nearest .app
  local pid=$$
  while [[ "$pid" -gt 1 ]]; do
    local exe
    exe=$(ps -o comm= -p "$pid" 2>/dev/null || echo "")
    # Check if this process lives inside a .app bundle
    if [[ "$exe" == *".app/"* ]]; then
      # Extract bundle ID from the .app's Info.plist
      local app_path
      app_path=$(echo "$exe" | sed 's|/Contents/.*||')
      local bid
      bid=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$app_path/Contents/Info.plist" 2>/dev/null || echo "")
      if [[ -n "$bid" ]]; then
        echo "$bid"
        return
      fi
    fi
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
  done

  echo "unknown"
}

detect_host_app_name() {
  local bundle_id
  bundle_id=$(detect_host_app_bundle)

  case "$bundle_id" in
    com.apple.Terminal)               echo "Terminal" ;;
    com.mitchellh.ghostty)            echo "Ghostty" ;;
    com.googlecode.iterm2)            echo "iTerm2" ;;
    net.kovidgoyal.kitty)             echo "kitty" ;;
    dev.warp.Warp-Stable)             echo "Warp" ;;
    com.conductor.app)                echo "Conductor" ;;
    com.microsoft.VSCode)             echo "Visual Studio Code" ;;
    com.todesktop.230313mzl4w4u92)    echo "Cursor" ;;
    com.anthropic.claudedesktop)      echo "Claude for Desktop" ;;
    com.anthropic.claudecode.desktop)  echo "Claude Code" ;;
    unknown)                          echo "your terminal app" ;;
    *)
      # Try to resolve the name via the bundle ID
      local app_name
      app_name=$(python3 -c "
import sys
from Foundation import NSWorkspace
bid = sys.argv[1]
ws = NSWorkspace.sharedWorkspace()
url = ws.URLForApplicationWithBundleIdentifier_(bid)
if url:
    import os
    name = os.path.basename(url.path()).replace('.app', '')
    print(name)
else:
    print(bid)
" "$bundle_id" 2>/dev/null || echo "$bundle_id")
      echo "$app_name"
      ;;
  esac
}

# When run directly (not sourced), output JSON
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  BUNDLE=$(detect_host_app_bundle)
  NAME=$(detect_host_app_name)
  echo "{\"bundle_id\": \"$BUNDLE\", \"name\": \"$NAME\"}"
fi
