# Inside-Out Debug Infrastructure: Implementation Guide

How to add Claude Code-compatible debug infrastructure to a SwiftUI macOS app.
Reference implementation: Bolt (email client).

## Overview

The inside-out pattern means the app instruments itself. Instead of an external
tool inspecting the accessibility tree (unreliable, especially for SwiftUI), the
app captures its own screenshots, measures its own layout, dumps its own state,
and writes everything to the filesystem. Claude Code reads these structured files
and reasons with them.

Think of it as browser DevTools for native apps. Screenshots are ground truth
(what actually rendered). Structured JSON enables precise reasoning (exact hex
colors, exact coordinates). The combination is the power.

## What You're Building

Six components, all guarded with `#if DEBUG` (zero presence in release builds):

| Component | Purpose | ~Lines |
|-----------|---------|--------|
| DebugSnapshotService | Orchestrates capture: screenshots + probes + state + logs | ~150 |
| DebugSnapshotTrigger | Filesystem watcher — CC triggers snapshots via `touch` | ~40 |
| InspectableModifier | SwiftUI view modifier that registers geometry probes | ~100 |
| InspectorRegistry | Pull-based probe registry, queried at snapshot time | ~30 |
| LayoutProbe | Data model for a single UI element measurement | ~25 |
| State dump | App-specific Encodable struct with navigation/selection state | ~50 |

Total: ~400 lines of Swift. Estimated effort: ~2-4 hours for a human, ~15 min
for CC with this guide.

## The Snapshot Bundle

Every snapshot produces a timestamped directory:

```
{snapshot_base_dir}/{ISO8601-timestamp}/
  manifest.json       — Window list, probe count, metadata
  windows/
    main.png          — Main window screenshot
    compose-1.png     — Additional windows (named by content)
    settings.png
  probes.json         — Layout measurements for instrumented views
  state.json          — App-specific state dump
  recent-log.txt      — Last 100 lines of debug log
```

A `latest` symlink always points to the most recent snapshot directory.

## Component 1: DebugSnapshotService

The orchestrator. Captures everything and writes the bundle.

### Key responsibilities:
1. Create timestamped directory
2. Capture screenshots of all visible windows via ScreenCaptureKit
3. Collect layout probes from InspectorRegistry
4. Build app-specific state dump
5. Copy recent debug log lines
6. Write manifest.json
7. Update the `latest` symlink

### Snapshot base directory

Use an environment variable so the agent's workspace can control where snapshots
land. Fall back to a sensible default.

```swift
#if DEBUG
import AppKit
import ScreenCaptureKit

@MainActor
final class DebugSnapshotService {

    /// Prefers YOUR_APP_SNAPSHOT_DIR env var (set by workspace launch script),
    /// falls back to sandbox container.
    static let snapshotBaseDir: String = {
        if let envDir = ProcessInfo.processInfo.environment["YOUR_APP_SNAPSHOT_DIR"] {
            return envDir
        }
        return NSHomeDirectory() + "/your-app-snapshots"
    }()
```

### Multi-window screenshot capture

Use ScreenCaptureKit (SCK) to capture individual windows. This requires Screen
Recording permission (System Settings > Privacy & Security > Screen Recording).

```swift
    private static func captureWindow(_ window: NSWindow, to path: String) async -> Bool {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false, onScreenWindowsOnly: true
            )
            guard let scWindow = content.windows.first(where: {
                $0.windowID == CGWindowID(window.windowNumber)
            }) else { return false }

            let filter = SCContentFilter(desktopIndependentWindow: scWindow)
            let config = SCStreamConfiguration()
            config.width = Int(window.frame.width * window.backingScaleFactor)
            config.height = Int(window.frame.height * window.backingScaleFactor)
            config.scalesToFit = false
            config.showsCursor = false
            config.captureResolution = .best

            let image = try await SCScreenshotManager.captureImage(
                contentFilter: filter, configuration: config
            )
            let bitmapRep = NSBitmapImageRep(cgImage: image)
            guard let png = bitmapRep.representation(using: .png, properties: [:]) else {
                return false
            }
            try png.write(to: URL(fileURLWithPath: path))
            return true
        } catch {
            // Log Screen Recording permission denial separately for clarity
            return false
        }
    }
```

### Window naming convention

Name screenshot files by their content, not by index. This makes them
self-documenting for the agent:

```swift
    private static func windowFileName(for window: NSWindow) -> String {
        let title = window.title.lowercased()
        // Match by title first — a compose window can become isMainWindow when focused
        if title.contains("settings") || title.contains("preferences") { return "settings" }
        if title.contains("new message") || title.contains("compose") { return "compose" }

        // SwiftUI main app window
        let className = String(describing: type(of: window))
        if className == "AppKitWindow" || window.isMainWindow { return "main" }

        // Sanitized title fallback
        let sanitized = title
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: "-")
            .prefix(40)
        return sanitized.isEmpty ? "window" : String(sanitized)
    }
```

When multiple windows have the same base name (e.g., two compose windows),
append a counter: `compose.png`, `compose-2.png`.

### Filtering system windows

Exclude popover, tooltip, and status bar windows from capture:

```swift
    private static let excludedClassNames: Set<String> = [
        "_NSPopoverWindow",
        "NSStatusBarWindow",
        "NSToolTipPanel",
        "NSComboBoxWindow",
    ]
```

### Manifest format

```swift
struct SnapshotManifest: Encodable {
    let capturedAt: Date
    let windowCount: Int
    let probeCount: Int
    let windows: [WindowEntry]

    struct WindowEntry: Encodable {
        let fileName: String
        let title: String
        let className: String
        let frame: WindowFrame
        let isKey: Bool
        let isMain: Bool
        let captured: Bool   // false if Screen Recording permission denied
    }

    struct WindowFrame: Encodable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }
}
```

### Latest symlink

After writing the bundle, update a symlink for easy access:

```swift
    let latestLink = baseDir + "/latest"
    try? FileManager.default.removeItem(atPath: latestLink)
    try? FileManager.default.createSymbolicLink(atPath: latestLink, withDestinationPath: dir)
```

### Error file for failed captures

If any window screenshots fail (usually Screen Recording permission), write
an `error.txt` that the agent will see immediately:

```swift
    let failedWindows = windowEntries.filter { !$0.captured }
    if !failedWindows.isEmpty {
        let errorMsg = """
        SNAPSHOT CAPTURE FAILED — Screen Recording permission required.
        Grant: System Settings → Privacy & Security → Screen Recording → enable YourApp
        Failed windows: \(failedWindows.map(\.title).joined(separator: ", "))
        """
        try? errorMsg.write(toFile: dir + "/error.txt", atomically: true, encoding: .utf8)
    }
```

### Session file

On app launch, write a `session.json` to the snapshot directory so the agent
knows which app instance it's talking to:

```swift
    static func writeSessionFile() {
        let session: [String: String] = [
            "launchTime": ISO8601DateFormatter().string(from: Date()),
            "pid": "\(ProcessInfo.processInfo.processIdentifier)",
            "buildVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown",
            "workspace": ProcessInfo.processInfo.environment["YOUR_APP_WORKSPACE"] ?? "unknown",
        ]
        // Write to snapshotBaseDir/session.json
    }
```

## Component 2: DebugSnapshotTrigger

A filesystem watcher that lets Claude Code trigger snapshots externally.
CC runs `touch /path/to/trigger-file`, the app detects it and captures.

```swift
#if DEBUG
@MainActor
final class DebugSnapshotTrigger {
    private var timerSource: DispatchSourceTimer?

    /// Trigger file path. Prefers env var location, falls back to /tmp.
    private static let triggerPath: String = {
        if let envDir = ProcessInfo.processInfo.environment["YOUR_APP_SNAPSHOT_DIR"] {
            return (envDir as NSString).deletingLastPathComponent + "/your-app-snapshot-trigger"
        }
        return "/tmp/your-app-snapshot-trigger"
    }()

    func startWatching() {
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: .milliseconds(500))
        timer.setEventHandler { [weak self] in
            self?.checkTrigger()
        }
        timer.resume()
        timerSource = timer
    }

    func stopWatching() {
        timerSource?.cancel()
        timerSource = nil
    }

    private func checkTrigger() {
        let fm = FileManager.default
        guard fm.fileExists(atPath: Self.triggerPath) else { return }
        try? fm.removeItem(atPath: Self.triggerPath)
        NotificationCenter.default.post(name: .debugSnapshot, object: nil)
    }
}
#endif
```

**Polling interval:** 500ms. This means worst-case latency from `touch` to
snapshot start is 500ms. Fast enough for debugging workflows.

**Why polling instead of FSEvents?** Simplicity. FSEvents adds complexity and
the 500ms overhead is acceptable. Upgrade to FSEvents if sub-100ms latency
becomes important (deferred to UI Truth Layer phase).

## Component 3: InspectableModifier

A SwiftUI view modifier that registers a view's geometry with InspectorRegistry.
Uses a GeometryReader overlay — zero layout cost.

```swift
#if DEBUG
import SwiftUI
import AppKit

struct InspectableModifier: ViewModifier {
    let id: String
    let metadata: [String: String]

    @State private var currentFrame: CGRect = .zero
    @State private var hostWindow: NSWindow?
    @State private var registeredId: String?

    func body(content: Content) -> some View {
        content
            .background {
                WindowFinder(window: $hostWindow)  // captures hosting NSWindow
            }
            .overlay {
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { currentFrame = proxy.frame(in: .global) }
                        .onChange(of: proxy.frame(in: .global)) { _, newFrame in
                            currentFrame = newFrame
                        }
                }
            }
            .onChange(of: hostWindow) { _, _ in registerProbe() }
            .onDisappear {
                if let registeredId {
                    InspectorRegistry.shared.deregister(registeredId)
                }
            }
    }

    /// Scoped by window number to avoid collisions (e.g., two compose windows
    /// both have a "compose.subject" probe).
    private var scopedId: String {
        if let windowNumber = hostWindow?.windowNumber {
            return "\(id)@w\(windowNumber)"
        }
        return id
    }

    private func registerProbe() {
        if let old = registeredId, old != scopedId {
            InspectorRegistry.shared.deregister(old)
        }
        guard hostWindow != nil else { return }
        let newId = scopedId
        registeredId = newId

        InspectorRegistry.shared.register(newId) { [self] in
            guard let window = hostWindow, let contentView = window.contentView else {
                return nil
            }
            // Convert SwiftUI global coords to window content coords
            let screenRect = NSRect(origin: currentFrame.origin, size: currentFrame.size)
            let windowRect = contentView.convert(screenRect, from: nil)

            // Flip Y to match PNG orientation (top-left origin)
            let contentHeight = contentView.bounds.height
            let flippedY = contentHeight - windowRect.origin.y - windowRect.size.height

            return LayoutProbe(
                id: id,
                viewType: .swiftui,
                frame: LayoutProbe.ProbeFrame(
                    x: windowRect.origin.x,
                    y: flippedY,
                    width: windowRect.size.width,
                    height: windowRect.size.height
                ),
                windowTitle: window.title,
                metadata: metadata
            )
        }
    }
}
```

### WindowFinder helper

A hidden NSViewRepresentable that captures the hosting NSWindow reference:

```swift
private struct WindowFinder: NSViewRepresentable {
    @Binding var window: NSWindow?

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async { self.window = view.window }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        if window == nil {
            DispatchQueue.main.async { self.window = nsView.window }
        }
    }
}
```

### View extension

```swift
extension View {
    func inspectable(id: String, metadata: [String: String] = [:]) -> some View {
        modifier(InspectableModifier(id: id, metadata: metadata))
    }
}
#endif
```

### Usage in views

Add `.inspectable(id:)` to key UI elements. Use a hierarchical naming convention:

```swift
// SettingsView.swift
var body: some View {
    Form { ... }
        .inspectable(id: "settings.accounts")

    GeneralTab()
        .inspectable(id: "settings.general")
}

// ComposeView.swift
TextField("To:", ...)
    .inspectable(id: "compose.to")
TextField("Subject:", ...)
    .inspectable(id: "compose.subject")
```

**What to instrument:** Key interactive elements, navigation landmarks, and
areas you'd want to verify visually. Don't over-instrument — 10-20 probes per
screen is plenty. The agent uses these for precise measurement, not for
enumerating every pixel.

## Component 4: InspectorRegistry

A pull-based registry. Views register closures; closures are called only at
snapshot time. This avoids continuous measurement overhead.

```swift
#if DEBUG
@MainActor
final class InspectorRegistry {
    static let shared = InspectorRegistry()
    private var probeProviders: [String: () -> LayoutProbe?] = [:]

    private init() {}

    func register(_ id: String, provider: @escaping () -> LayoutProbe?) {
        probeProviders[id] = provider
    }

    func deregister(_ id: String) {
        probeProviders.removeValue(forKey: id)
    }

    func captureAll() -> [LayoutProbe] {
        probeProviders.values.compactMap { $0() }
    }

    var count: Int { probeProviders.count }
}
#endif
```

## Component 5: LayoutProbe

The data model for a single UI element measurement:

```swift
#if DEBUG
struct LayoutProbe: Encodable {
    let id: String
    let viewType: ViewType
    let frame: ProbeFrame
    let windowTitle: String?
    let metadata: [String: String]

    enum ViewType: String, Encodable {
        case swiftui
        case appkit
    }

    struct ProbeFrame: Encodable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }
}
#endif
```

**Coordinate system:** Window-relative, top-left origin (matches PNG
orientation). Y-axis is flipped from SwiftUI's global coordinate space.

## Component 6: State Dump

An app-specific Encodable struct that captures navigation and selection state.
This is the most app-specific component — your schema will differ from Bolt's.

### Requirements:
- Always include `capturedAt: Date`
- Capture current navigation state (which screen, which selection)
- Capture relevant data counts (unread count, message count, etc.)
- Include sync/network state if applicable

### Example (Bolt's email client state):

```swift
struct SnapshotState: Encodable {
    let capturedAt: Date
    let selectedFolder: FolderSnapshot?
    let selectedThread: ThreadSnapshot?
    let messageList: MessageListSnapshot
    let conversation: ConversationSnapshot?
    let sync: SyncSnapshot

    struct FolderSnapshot: Encodable {
        let id: Int64
        let name: String
        let role: String?
        let unreadCount: Int
    }
    // ... nested types for each state area
}
```

### Principles:
- Dump what the agent needs to verify the UI matches the data
- Include IDs so the agent can cross-reference with the UI
- Include counts so the agent can verify list lengths
- Keep it flat and readable — the agent reads this as JSON

## Wiring It All Together

### App entry point (your @main App struct)

```swift
#if DEBUG
@State private var snapshotTrigger: DebugSnapshotTrigger?
#endif

// In your .task or .onAppear:
#if DEBUG
DebugSnapshotService.writeSessionFile()
let trigger = DebugSnapshotTrigger()
trigger.startWatching()
snapshotTrigger = trigger
#endif
```

### Keyboard shortcut (menu command)

Add a Debug Snapshot menu item with Cmd+Shift+D:

```swift
#if DEBUG
CommandGroup(after: .toolbar) {
    Button("Debug Snapshot") {
        NotificationCenter.default.post(name: .debugSnapshot, object: nil)
    }
    .keyboardShortcut("d", modifiers: [.command, .shift])
}
#endif
```

### Notification definition

```swift
extension Notification.Name {
    static let debugSnapshot = Notification.Name("YourAppDebugSnapshot")
}
```

### ContentView handler

Listen for the notification and call the capture service:

```swift
#if DEBUG
.onReceive(NotificationCenter.default.publisher(for: .debugSnapshot)) { _ in
    Task {
        let url = await DebugSnapshotService.capture(
            // Pass your app's ViewModels here
        )
        if let url {
            // Show a toast: "Snapshot saved"
        }
    }
}
#endif
```

### Debug logging (optional but recommended)

A simple file-based logger that writes to `~/your-app-debug.log`. The snapshot
service copies the last 100 lines into each bundle as `recent-log.txt`.

Structured events (JSON Lines format) are useful for the agent to understand
what happened between snapshots:

```swift
struct DebugEvent: Encodable {
    let timestamp: Date
    let type: String
    let data: [String: String]

    init(_ type: String, _ data: [String: String] = [:]) {
        self.timestamp = Date()
        self.type = type
        self.data = data
    }
}
```

### Enable/disable toggle

Add a UserDefaults toggle so debug tooling can be disabled without removing
the `#if DEBUG` code:

```swift
static var isDebugToolingEnabled: Bool {
    !UserDefaults.standard.bool(forKey: "debugToolingDisabled")
}
```

Guard the snapshot handler with this check. Default: enabled.

## CLAUDE.md Configuration

Add this to the project's CLAUDE.md so the /browse-native skill knows how to
interact with the app:

```yaml
## Native App
native_app_bundle_id: "com.yourcompany.YourApp"
native_app_scheme: "YourApp"
native_snapshot_dir: ".context/snapshots"
native_trigger_file: ".context/snapshot-trigger"

## App Keyboard Shortcuts
# native_shortcuts:
#   debug_snapshot: "cmd+shift+d"
#   new_window: "cmd+n"
#   settings: "cmd+,"
#   close_window: "cmd+w"
#   search: "cmd+f"
```

## Workspace Launch Script

If using Conductor or a workspace manager, set environment variables before
launching the app so snapshots land in the workspace:

```bash
export YOUR_APP_SNAPSHOT_DIR="$WORKSPACE_DIR/.context/snapshots"
export YOUR_APP_WORKSPACE="$WORKSPACE_NAME"
```

This lets the agent find snapshots at a predictable path relative to the
workspace, rather than in the user's home directory.

## Screen Recording Permission

ScreenCaptureKit requires Screen Recording permission. The first time the app
tries to capture, macOS will prompt the user. If denied, screenshots will fail
but the rest of the bundle (probes, state, logs) will still be captured.

The snapshot service writes an `error.txt` when captures fail, so the agent
sees the issue immediately and can tell the user how to fix it.

**Permission persists per bundle ID** — grant once, works across all workspaces
and builds (as long as the bundle ID stays the same).

## Checklist

Use this to verify the infrastructure is complete:

- [ ] `DebugSnapshotService` captures screenshots, probes, state, logs
- [ ] `DebugSnapshotTrigger` watches for trigger file, posts notification
- [ ] `InspectableModifier` + `InspectorRegistry` register view geometry
- [ ] `LayoutProbe` model with window-relative coordinates
- [ ] State dump struct with `capturedAt` and navigation state
- [ ] Keyboard shortcut (Cmd+Shift+D) wired to snapshot notification
- [ ] `latest` symlink updated after each snapshot
- [ ] `session.json` written on app launch
- [ ] `error.txt` written when captures fail
- [ ] All debug code guarded with `#if DEBUG`
- [ ] Environment variable for snapshot directory
- [ ] CLAUDE.md configured with app name, snapshot dir, trigger file
- [ ] Key views instrumented with `.inspectable(id:)`

## What This Enables

With this infrastructure in place, the /browse-native skill can:

1. **Trigger snapshots** via `touch $TRIGGER_FILE`
2. **Read structured data** (manifest, probes, state) for precise reasoning
3. **Compare exact colors and coordinates** from probes instead of guessing
4. **Verify app state** matches what rendered in screenshots
5. **Navigate via keyboard shortcuts** and osascript, then snapshot to verify
6. **Detect regressions** by comparing before/after snapshot bundles

Without this infrastructure, the skill falls back to **degraded mode**:
osascript + screencapture only. No structured data, no probes, no state.
Functional for basic visual checks but limited. See skills/browse-native.md for details.
