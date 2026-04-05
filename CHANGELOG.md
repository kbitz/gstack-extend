# Changelog

All notable changes to this project will be documented in this file.

## [0.4.1] - 2026-04-04

### Added
- Setup script (`setup`) for installing skill symlinks into `~/.claude/skills/`. Handles install and `--uninstall` with ownership verification (only removes symlinks it created).

### Changed
- Updated README installation instructions: two clear paths (global install and per-project install), both using the new setup script. Previously claimed skills were auto-discovered after cloning, which was incorrect.

### Fixed
- Renamed pair-review skill's context directory from `.context/test-session/` to `.context/pair-review/` to match the skill name.

## [0.4.0] - 2026-04-04

### Added
- New /pair-review skill (skills/pair-review.md): pair testing session manager that guides humans through manual testing with persistent state. Generates grouped test plans from diffs, manages the test-fix-retest loop with group-level checkpoints, discovers deploy recipes, and supports cross-machine resume. Works for any project type (web, native, CLI).
- Design doc: docs/designs/pair-review.md (approved via /office-hours, reviewed via /plan-ceo-review and /plan-eng-review).
- Skill routing for /pair-review in CLAUDE.md.
- New TODOs: PR comment integration (P1), validation script (P1), multi-agent orchestration (P2), repo rename (P2).

## [0.3.1] - 2026-04-04

### Added
- Implementation guide for adding debug infrastructure to new SwiftUI apps (docs/debug-infrastructure-guide.md). Documents all six components from Bolt's reference implementation with code examples, wiring instructions, and a verification checklist.
- Skill now detects missing infrastructure at setup and guides users to add it before falling back to degraded mode. Explains what's lost without instrumentation and offers to help implement it (~400 lines Swift, ~15 min with CC).

### Changed
- Moved skill to `skills/browse-native.md` (preparing for multi-skill layout).
- Moved design docs to `docs/archive/` (historical decision records, not active references).
- Promoted implementation guide to `docs/` root (living reference used by the skill).

## [0.3.0] - 2026-04-04

### Changed
- Replaced Peekaboo CLI with inside-out debug infrastructure. The app now instruments itself (screenshots, layout probes, state dumps) and the agent communicates via filesystem triggers and osascript.
- Rewrote /browse-native skill around the new interaction pattern: trigger snapshot, read structured data + screenshots, act via osascript/keyboard, verify.
- Rewrote validation gates: Gate 1 validates snapshot bundles, Gate 2 tests osascript interaction, Gate 3 measures see-act-see cycle latency (<3000ms).
- Three instrumentation tiers: full (probes + state + screenshots), partial (state + screenshots), and degraded (osascript + screencapture only).
- Updated TODOS.md: obsoleted 5 Peekaboo-era items, added new P1/P2 backlog.
- Updated roadmap: Phase 2 is now UI Truth Layer, Phase 3 is /qa-native redesign.

### Added
- Design doc: docs/archive/inside-out-debugging.md (approved, covers snapshot bundle spec, trigger protocol, osascript primitives, architectural decisions).
- Color and alignment rules: skill instructs the agent to always use probe data for precise comparisons, never rely on screenshot vision alone.
- Degraded mode: skill works with uninstrumented apps via osascript + screencapture.
- Skill routing rules in CLAUDE.md.

### Removed
- Peekaboo CLI dependency. No external tools required.
- scripts/detect-host-app.sh (Peekaboo permission detection).

## [0.2.0] - 2026-03-27

### Changed
- Skill rewrite from hands-on feedback: focused interaction tool, mandatory target, capability probe, keyboard-first mode for sparse AX trees.

## [0.1.0] - 2026-03-24

### Added
- Initial /browse-native skill with Peekaboo CLI, validation gates, design doc.
