# gstack-extend

Extension skills for [gstack](https://github.com/anthropics/gstack).

| Skill | What it does | Works with | Status |
|-------|-------------|------------|--------|
| `/pair-review` | Pair testing session manager | Any project (web, native, CLI) | Stable |
| `/roadmap` | Documentation restructuring | Any project | Stable |
| `/full-review` | Weekly codebase review pipeline | Any project | Stable |
| `/browse-native` | Native macOS app interaction | macOS SwiftUI/AppKit apps | **Beta** |

## Installation

Clone and run setup:

```bash
git clone https://github.com/kbitz/gstack-extend.git ~/.claude/skills/gstack-extend
~/.claude/skills/gstack-extend/setup
```

This installs stable skills (`/pair-review`, `/roadmap`, `/full-review`) into `~/.claude/skills/`.
To uninstall: `~/.claude/skills/gstack-extend/setup --uninstall`

### Beta skills

`/browse-native` is in beta. It requires adding debug infrastructure to your app
(6+ Swift components) and has unfinished validation work. To install it:

```bash
~/.claude/skills/gstack-extend/setup --with-native
```

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

## /roadmap — Documentation Restructuring

Restructures TODOS.md into a clean execution plan (ROADMAP.md) with consistent
vocabulary, dependency ordering, and file-ownership grouping for parallel agent
execution. Audits versioning, validates doc taxonomy, and recommends version bumps.

- **Two files, one flow** — TODOS.md is the inbox (other skills write here), ROADMAP.md is the structured execution plan
- **Two modes** — Overhaul (first run: full restructure) and Triage (subsequent runs: process only new items)
- **Deterministic audit** — 8 automated checks (vocabulary lint, structure validation, staleness, version audit, taxonomy, dependencies, unprocessed detection, mode detection)
- **Parallel-agent friendly** — Groups > Tracks > Tasks organized by file ownership to minimize merge conflicts

```
/roadmap              # Audit + restructure (auto-detects overhaul vs triage mode)
```

### How It Works

1. **Audit** — Runs `bin/roadmap-audit` against repo docs. Reports vocabulary drift, structural violations, stale items, version mismatches, and taxonomy issues.
2. **Build/Update ROADMAP.md** — In overhaul mode, reorganizes everything from scratch. In triage mode, classifies unprocessed items from TODOS.md into existing Groups/Tracks.
3. **Update PROGRESS.md** — Appends version history rows, verifies phase status.
4. **Version recommendation** — Suggests a bump based on changes since last tag (does not write VERSION).

### Documentation Taxonomy

| Doc | Purpose | Written by |
|-----|---------|------------|
| TODOS.md | Inbox — unprocessed items | /pair-review, /investigate, manual |
| ROADMAP.md | Execution plan — Groups > Tracks > Tasks | /roadmap |
| PROGRESS.md | Version history + phase status | /roadmap, /document-release |
| CHANGELOG.md | User-facing release notes | /document-release |
| VERSION | SemVer source of truth | /ship |

---

## /full-review — Weekly Codebase Review Pipeline

Dispatches 3 specialized review agents (reviewer, hygiene, consistency-auditor) in
parallel, synthesizes findings into root-cause clusters, guides you through triage,
and writes approved findings to TODOS.md for /roadmap to organize.

- **3 specialized agents** — implementation gaps, code waste, and pattern drift reviewed simultaneously
- **Root-cause clustering** — findings grouped by theme for efficient triage (approve/reject/defer per cluster)
- **TODOS.md integration** — approved items tagged `[full-review]` under `## Unprocessed` for /roadmap
- **ROADMAP.md dedup** — skips findings already tracked in the roadmap
- **Resume support** — state checkpointed after each phase, pick up where you left off

```
/full-review          # Start a fresh codebase review
/full-review resume   # Resume where you left off
/full-review status   # See the session dashboard
```

### How It Works

1. **Scoping** — Identifies hot areas from recent git history to help agents prioritize
2. **Agent dispatch** — 3 agents review the codebase in parallel with different lenses
3. **Synthesis** — Findings merged, deduped, and clustered by root cause (target: 3-8 clusters)
4. **Dedup** — Clusters matched against ROADMAP.md tracks to skip already-tracked issues
5. **Triage** — You approve, reject, or defer each cluster via AskUserQuestion
6. **Persist** — Approved findings written to TODOS.md, summary report saved to `.context/full-review/`

### Documentation Taxonomy Update

| Doc | Purpose | Written by |
|-----|---------|------------|
| TODOS.md | Inbox | /pair-review, /full-review, /investigate, manual |
| ROADMAP.md | Execution plan | /roadmap |

---

## /browse-native — Native App Interaction [BETA]

> **Beta:** This skill requires adding [debug infrastructure](docs/debug-infrastructure-guide.md)
> to your app before it can do anything useful. It's not installed by default...
> use `setup --with-native` if you want to try it.

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

- [Implementation Guide](docs/debug-infrastructure-guide.md) — How to add debug infrastructure to a new SwiftUI app

## License

[MIT](LICENSE)
