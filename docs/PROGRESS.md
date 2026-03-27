# Progress

## Phase 1: Core Adapter (current)

Build the /browse-native skill and validate it against real macOS apps.

| Version | Date | Summary |
|---------|------|---------|
| 0.2.0 | 2026-03-27 | Skill rewrite from hands-on feedback: reframed as focused interaction tool (not autonomous QA), mandatory target requirement before starting, capability probe at session start, keyboard-first mode for sparse AX trees (SwiftUI), --app fallback when --window-id fails, action batching, adaptive waits, error recovery patterns, honest limitations section, replaced QA checklist with scoped reporting. |
| 0.1.2 | 2026-03-25 | Gate 2 rewrite: element-ID targeting, state verification, button click by ID. Spec aligned with implementation. 20-step proof deferred to TODOS. |
| 0.1.1 | 2026-03-25 | Simplified to 3 gates, switched default to TextEdit, added close-button cleanup, fixed hotkey syntax |
| 0.1.0 | 2026-03-24 | Initial /browse-native skill, validation gates (4 gates), design doc, TODOs |

## Roadmap

- **Phase 2: Daemon Graduation** — Replace stateless CLI with persistent Bun/TS daemon for <500ms cycles
- **Phase 3: Browse-Contract Compatibility** — Compatibility layer for /qa-native and /design-review-native
- **Phase 4: /qa-native** — Full autonomous QA loop for native apps
