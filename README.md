# gstack-native

Extension skills for [gstack](https://github.com/anthropics/gstack). Currently ships two skills:

| Skill | What it does | Works with |
|-------|-------------|------------|
| `/pair-review` | Pair testing session manager | Any project (web, native, CLI) |
| `/browse-native` | Native macOS app interaction | macOS SwiftUI/AppKit apps |

## Installation

Clone this repo into your project's `.claude/skills/` directory:

```bash
git clone git@github.com:kbitz/gstack-native.git .claude/skills/gstack-native
```

Add it to your `.gitignore`:

```bash
echo ".claude/skills/gstack-native" >> .gitignore
```

Both skills are now available in Claude Code. No additional setup needed for
`/pair-review`. For `/browse-native`, see the [Configuration](#browse-native-configuration) section below.

---

## /pair-review — Pair Testing Session Manager

Manages the test-fix-retest loop for manual testing. The agent generates grouped
test plans from diffs, tracks pass/fail, checkpoints before fixes, rebuilds/redeploys,
and supports resume. Works for any project type.

- **Persistent state** — test progress survives context compaction
- **Deploy discovery** — finds your build/run process and reuses it across sessions
- **Group-level checkpoints** — auto-commits before fix attempts for clean reverts
- **Resume** — pick up exactly where you left off

```
/pair-review          # Start a new test session
/pair-review resume   # Resume where you left off
/pair-review status   # See the dashboard
/pair-review done     # Complete and generate report
```

---

## /browse-native — Native App Interaction

Interact with native macOS apps using inside-out debug infrastructure. The app
instruments itself (screenshots, layout probes, state dumps) and the agent
communicates via filesystem triggers and osascript.

### How It Works

1. **App captures its own screenshots** via ScreenCaptureKit (per-window PNGs)
2. **App measures its own layout** via probe modifiers (exact coordinates, colors)
3. **App dumps its own state** via ViewModel serialization (JSON)
4. **Agent triggers snapshots** by writing a trigger file (filesystem-based)
5. **Agent interacts** via osascript (window management, menus, keystrokes)

### Three Instrumentation Tiers

| Tier | What the app provides | Agent capability |
|------|----------------------|-----------------|
| **Full** | Screenshots + probes + state dumps + events | Best: precise colors, alignment, state reasoning |
| **Partial** | Screenshots + state dumps (no probes) | Good: visual + state, no precise measurements |
| **None** | Nothing (degraded mode) | Basic: osascript + screencapture, no structured data |

### Browse-Native Configuration

Add your app's details to your project's `CLAUDE.md`:

```yaml
## Native App
native_app_bundle_id: "com.example.MyApp"
native_app_scheme: "MyApp"
native_snapshot_dir: ".context/snapshots"
native_trigger_file: ".context/snapshot-trigger"
```

### Validation

```bash
./scripts/validate.sh                    # Run all gates
./scripts/validate.sh --app "MyApp"      # Test specific app
./scripts/validate.sh --gate 1           # Snapshot bundle validity
./scripts/validate.sh --gate 2           # osascript interaction
./scripts/validate.sh --gate 3           # Cycle latency
```

---

## Documentation

- [/pair-review Design Doc](docs/designs/pair-review.md) — Design decisions, state format, workflow
- [Implementation Guide](docs/debug-infrastructure-guide.md) — How to add debug infrastructure to a new SwiftUI app
- [Inside-Out Design Doc](docs/archive/inside-out-debugging.md) — Architectural decisions and snapshot bundle spec
