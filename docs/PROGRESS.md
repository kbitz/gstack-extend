# Progress

## Phase 1: Core Adapter (current)

Build the /browse-native skill and validate it against real macOS apps.

| Version | Date | Summary |
|---------|------|---------|
| 0.6.0 | 2026-04-05 | Auto-update system: `bin/update-check` (gist-based remote VERSION, pure bash semver, caching, snooze) + `bin/update-run` (git pull + setup) + `bin/config` (key=value). Inline upgrade flow in skill preambles. GitHub Action syncs VERSION to gist. Global-install only. State in `~/.gstack-extend/`. |
| 0.5.0 | 2026-04-05 | Bug parking for /pair-review: park unrelated bugs during testing, triage at group completion (fix now / defer to TODOS.md / keep parked), post-testing fix queue (Phase 2.5). Avoids git add -u pollution by deferring TODOS.md writes to group boundaries. Design doc updated. |
| 0.4.1 | 2026-04-04 | Added `setup` script for skill symlink installation. Handles both global (~/.claude/skills/) and per-project installs, with --uninstall support. README updated with proper install instructions. |
| 0.4.0 | 2026-04-04 | New /pair-review skill: pair testing session manager with deploy discovery, grouped test plans from diffs, test-fix-retest loop with group-level checkpoints, and cross-machine resume. General-purpose (web, native, CLI). Design doc: docs/designs/pair-review.md |
| 0.3.1 | 2026-04-04 | Implementation guide for adding debug infrastructure to new apps (docs/debug-infrastructure-guide.md). Skill now detects missing infrastructure and guides users to add it before proceeding in degraded mode. |
| 0.3.0 | 2026-04-04 | Replaced Peekaboo with inside-out debug pattern. App instruments itself (screenshots via ScreenCaptureKit, layout probes, state dumps). Agent communicates via filesystem triggers + osascript. Three-tier degraded mode (full/partial/screenshot-only). New validation gates. Design doc: docs/archive/inside-out-debugging.md |
| 0.2.0 | 2026-03-27 | Skill rewrite from hands-on feedback: reframed as focused interaction tool (not autonomous QA), mandatory target requirement before starting, capability probe at session start, keyboard-first mode for sparse AX trees (SwiftUI), --app fallback when --window-id fails, action batching, adaptive waits, error recovery patterns, honest limitations section, replaced QA checklist with scoped reporting. |
| 0.1.2 | 2026-03-25 | Gate 2 rewrite: element-ID targeting, state verification, button click by ID. Spec aligned with implementation. 20-step proof deferred to TODOS. |
| 0.1.1 | 2026-03-25 | Simplified to 3 gates, switched default to TextEdit, added close-button cleanup, fixed hotkey syntax |
| 0.1.0 | 2026-03-24 | Initial /browse-native skill, validation gates (4 gates), design doc, TODOs |

## Roadmap

- **Phase 2: UI Truth Layer** — Before/after semantic diffs, Delta E color comparisons, scene graph, events.jsonl
- **Phase 3: /qa-native Redesign** — Full autonomous QA loop built on inside-out pattern
- **Phase 4: Multi-App Validation** — Validate pattern against a second native app project
