# TODOS

## P1 — After validation

### osascript validation spike
Validate that osascript menu access and keystroke sending work reliably with
Bolt's specific window configuration. Catalog which commands work, which fail,
and document workarounds.
- **Why:** The inside-out skill uses osascript as the primary interaction
  mechanism. Before the skill is production-ready, we need confidence that
  the core primitives (activate, menu click, keystroke) work reliably.
- **Effort:** S (human: ~1 day / CC: ~15 min)
- **Depends on:** Bolt running with debug infrastructure

### Bolt probe enrichment (Workstream 1)
Add foreground/background hex color values to LayoutProbe. Add z-order, focus
state, and route identifier to manifest.json window entries. Add summary.md
generation to DebugSnapshotService.
- **Why:** The agent can't reliably distinguish colors or determine window
  focus from screenshots alone. Structured data in probes and manifest solves
  this. Implementation plan: docs/archive/inside-out-debugging.md (Workstream 1).
- **Effort:** S (human: ~2 days / CC: ~30 min)
- **Depends on:** osascript spike, runs in Bolt repo (not this repo)

### ~~Pattern documentation for future apps~~ ✓ DONE (v0.3.1)
Completed: `docs/debug-infrastructure-guide.md`. Covers all six
components (DebugSnapshotService, DebugSnapshotTrigger, InspectableModifier,
InspectorRegistry, LayoutProbe, state dumps), wiring, CLAUDE.md config,
workspace integration, and a verification checklist. Skill updated to detect
missing infrastructure and point users to the guide.

### Manual test review skill
New skill for structured manual test review process. Agent guides a human
through testing steps and processes their results. Needs design work to define
the workflow (checklist generation, result capture, report format).
- **Why:** Not all native app testing can be automated. A structured manual
  review process fills the gap between fully automated QA and ad-hoc testing.
- **Effort:** TBD (needs design via /office-hours)
- **Depends on:** Workflow design

## P2 — Phase 2

### UI Truth Layer (Approach C)
Full implementation of semantic scene graph, Delta E color comparisons,
before/after diffs, summary.md briefings, events.jsonl structured logging.
The "hardcore mode" version of inside-out debugging.
- **Why:** Takes the current snapshot-based approach to its logical conclusion.
  The agent never guesses about UI state. See design doc cross-model perspective
  (Codex's "UI Truth Layer" proposal).
- **Effort:** M (human: ~2 weeks / CC: ~1-2 hours)
- **Depends on:** P1 items complete, pattern validated

### /qa-native redesign
Redesign the autonomous QA skill around the inside-out pattern. The original
/qa-native assumed an external CLI tool as transport. Needs fresh design with
inside-out infrastructure as the foundation.
- **Why:** Full autonomous QA (explore app, find bugs, fix code, rebuild,
  re-verify) is the 10x version. /browse-native is the foundation.
- **Effort:** M (human: ~2 weeks / CC: ~2-3 hours)
- **Depends on:** UI Truth Layer, pattern documentation

### Contrast ratio + VoiceOver order analysis
Extend accessibility reporting with pixel-level contrast analysis (using probe
color data) and VoiceOver navigation order verification.
- **Why:** Important accessibility metrics not available from probes alone.
  Apple requires these for App Store review.
- **Effort:** M (human: ~1 week / CC: ~30 min)
- **Depends on:** Bolt probe enrichment (color hex data)
