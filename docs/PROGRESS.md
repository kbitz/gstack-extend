# Progress

## Phase 1: Core Adapter (current)

Build the /browse-native skill and validate it against real macOS apps.

| Version | Date | Summary |
|---------|------|---------|
| 0.3.0 | 2026-04-04 | Replaced Peekaboo with inside-out debug pattern. App instruments itself (screenshots via ScreenCaptureKit, layout probes, state dumps). Agent communicates via filesystem triggers + osascript. Three-tier degraded mode (full/partial/screenshot-only). New validation gates. Design doc: docs/designs/inside-out-debugging.md |
| 0.2.0 | 2026-03-27 | Skill rewrite from hands-on feedback: reframed as focused interaction tool (not autonomous QA), mandatory target requirement before starting, capability probe at session start, keyboard-first mode for sparse AX trees (SwiftUI), --app fallback when --window-id fails, action batching, adaptive waits, error recovery patterns, honest limitations section, replaced QA checklist with scoped reporting. |
| 0.1.2 | 2026-03-25 | Gate 2 rewrite: element-ID targeting, state verification, button click by ID. Spec aligned with implementation. 20-step proof deferred to TODOS. |
| 0.1.1 | 2026-03-25 | Simplified to 3 gates, switched default to TextEdit, added close-button cleanup, fixed hotkey syntax |
| 0.1.0 | 2026-03-24 | Initial /browse-native skill, validation gates (4 gates), design doc, TODOs |

## Roadmap

- **Phase 2: UI Truth Layer** — Before/after semantic diffs, Delta E color comparisons, scene graph, events.jsonl
- **Phase 3: /qa-native Redesign** — Full autonomous QA loop built on inside-out pattern
- **Phase 4: Multi-App Validation** — Validate pattern against a second native app project
