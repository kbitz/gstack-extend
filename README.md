# browse-native

Interact with native macOS apps from Claude Code using inside-out debug infrastructure.

## How It Works

Instead of using external tools to inspect the app from outside, the app instruments
itself and exposes structured data to the agent:

1. **App captures its own screenshots** via ScreenCaptureKit (per-window PNGs)
2. **App measures its own layout** via probe modifiers (exact coordinates, colors)
3. **App dumps its own state** via ViewModel serialization (JSON)
4. **Agent triggers snapshots** by writing a trigger file (filesystem-based)
5. **Agent interacts** via osascript (window management, menus, keystrokes)

The agent reads the snapshot bundle (screenshots + structured JSON) to understand
what's happening, then acts. The combination of visual ground truth and structured
data lets the agent reason precisely about colors, alignment, and state.

## Three Instrumentation Tiers

| Tier | What the app provides | Agent capability |
|------|----------------------|-----------------|
| **Full** | Screenshots + probes + state dumps + events | Best: precise colors, alignment, state reasoning |
| **Partial** | Screenshots + state dumps (no probes) | Good: visual + state, no precise measurements |
| **None** | Nothing (degraded mode) | Basic: osascript + screencapture, no structured data |

## Installation

Clone this repo into your project's `.claude/skills/` directory:

```bash
git clone git@github.com:kbitz/gstack-native.git .claude/skills/browse-native
```

Add `.claude/skills/browse-native` to your `.gitignore`:

```bash
echo ".claude/skills/browse-native" >> .gitignore
```

## Configuration

Add your app's details to your project's `CLAUDE.md`:

```yaml
## Native App
native_app_bundle_id: "com.example.MyApp"
native_app_scheme: "MyApp"
native_snapshot_dir: ".context/snapshots"
native_trigger_file: ".context/snapshot-trigger"
```

## Usage

Use `/browse-native` in Claude Code to interact with your macOS app:

- **See-Act-See loop** — trigger snapshot, read structured data + screenshots, act, verify
- **Color comparison** — exact hex values from probes, not guessing from pixels
- **Alignment checking** — exact frame coordinates from probes
- **Multi-window awareness** — reads ALL windows, not just the main one
- **State reasoning** — knows app state from JSON, not just visual inspection

## Validation

```bash
./scripts/validate.sh                    # Run all gates
./scripts/validate.sh --app "MyApp"      # Test specific app
./scripts/validate.sh --gate 1           # Snapshot bundle validity
./scripts/validate.sh --gate 2           # osascript interaction
./scripts/validate.sh --gate 3           # Cycle latency
```

## Design

See [docs/designs/inside-out-debugging.md](docs/designs/inside-out-debugging.md) for the
full design document, including snapshot bundle spec, trigger protocol, and architectural
decisions.
