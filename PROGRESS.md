# Progress

## Phase 1: Core Adapter (current)

Build the /browse-native skill and validate it against real macOS apps.

| Version | Date | Summary |
|---------|------|---------|
| 0.1.1 | 2026-03-25 | Simplified to 3 gates, switched default to TextEdit, added close-button cleanup, fixed hotkey syntax |
| 0.1.0 | 2026-03-24 | Initial /browse-native skill, validation gates (4 gates), design doc, TODOs |

## Roadmap

- **Phase 2: Daemon Graduation** — Replace stateless CLI with persistent Bun/TS daemon for <500ms cycles
- **Phase 3: Browse-Contract Compatibility** — Compatibility layer for /qa-native and /design-review-native
- **Phase 4: /qa-native** — Full autonomous QA loop for native apps
