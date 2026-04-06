# Changelog

All notable changes to this project will be documented in this file.

## [0.8.2] - 2026-04-06

### Changed
- `/roadmap` triage now presents each TODO one-by-one instead of clustering by area. Each item gets its own AskUserQuestion with full description and git provenance (when introduced, which PR). Removes smart batching logic that forced extra round-trips to drill into clusters.

## [0.8.1] - 2026-04-06

### Added
- Phase-aware triage step in `/roadmap` (new Step 2 between audit and restructuring). Keep/kill decisions with auto-suggest kills (stale file refs, missed DONE markers), smart batching by area, and phase assignment (current vs future) before Group/Track structuring.
- `## Future` section in ROADMAP.md for items deferred to a future phase. Not organized into Groups/Tracks, just a flat list with deferral reasons.
- Phase header on ROADMAP.md title (`# Roadmap — Phase N (vX.x)`).
- Contextual vocabulary lint: "Phase" reclaimed for top-level scoping (title, Future section) while remaining banned inside Group/Track sections. State machine in `check_vocab_lint()` with whitelist approach.
- Future-only roadmap support: `check_structure()` and `detect_mode()` recognize ROADMAP.md with only a `## Future` section as valid (triage mode, not overhaul).
- Triage mode phase integration: new inbox items get phase-assigned before Group/Track placement.
- 9 new tests (37 total): contextual Phase vocab lint (6), Future section structure (2), Future-only mode detection (1).

### Changed
- Tighter `## Future` heading match in audit script (`^## Future($| \()`) to avoid matching `## Futures` or `## Future Work`.
- Triage mode sub-steps renumbered (3a-3f) to reflect new Step 2 insertion.
- Rule 8 updated: Unprocessed items are now drained by triage (Step 2), not preserved during overhaul.

## [0.7.0] - 2026-04-06

### Added
- New `/roadmap` skill for documentation restructuring. Reorganizes project docs into Groups > Tracks > Tasks with dependency-chain ordering and file-ownership grouping for parallel agent execution.
- Deterministic audit script (`bin/roadmap-audit`) with 8 checks: vocabulary lint, structure validation, staleness detection, version audit, taxonomy check, dependency integrity, unprocessed item detection, and mode detection.
- Two-mode behavior: overhaul (first run, full restructure) and triage (process only new items from the inbox).
- TODOS.md/ROADMAP.md split: TODOS.md is now a pure inbox where other skills dump unprocessed items. ROADMAP.md is the structured execution plan owned by `/roadmap`.
- `/pair-review` now writes bugs to TODOS.md's `## Unprocessed` section with `[pair-review]` source tags.
- Shared semver comparison library (`bin/lib/semver.sh`) extracted from `bin/update-check`.
- 28 new tests for the audit script (`scripts/test-roadmap-audit.sh`).

## [0.6.3] - 2026-04-06

### Changed
- `/browse-native` is now opt-in (beta). Default `./setup` only installs `/pair-review`. Use `./setup --with-native` to also install browse-native.
- README updated with skill maturity status table and separate beta install instructions.
- Setup script rejects unknown flags instead of silently falling through to default install.

## [0.6.2] - 2026-04-05

### Fixed
- `bin/update-run` no longer destroys non-main branch work. Replaced `git reset --hard origin/main` with `checkout main` + `pull --ff-only`. Safely switches back to the original branch after upgrade, restores stashed changes on the correct branch, and fails safely if main has diverged locally.
- Skill preamble update-check guard now fires regardless of where the repo is cloned. Replaced `$HOME/.claude/skills/` path prefix check with `[ -x "$_EXTEND_ROOT/bin/update-check" ]`.

### Added
- Smart next-step suggestion at pair-review completion. Checks `gstack-review-read` for existing review logs and diff size against main. If no review has been run and changes exceed 30 lines, nudges toward `/review` before `/ship`. Trivial changes or already-reviewed branches go straight to `/ship`.
- Test suite for update and install pipeline (`scripts/test-update.sh`): 17 tests covering update-run (happy path, non-main branch switch, dirty worktree restore, ff-only failure, missing args) and setup (default install, uninstall).

## [0.6.1] - 2026-04-05

### Fixed
- Standardized /pair-review question presentation: all user-facing prompts now use AskUserQuestion with explicit options instead of free-form text. Eliminates inconsistent question styles across workspaces (yes/no vs pass/fail/skip vs multiple choice).
- Added Conductor visibility awareness: new "action receipt" pattern ensures important status updates (bug parked, fix committed, build succeeded) are included in the visible prompt, not hidden in collapsed intermediate messages.

### Added
- New "Conductor Visibility Rule" section in pair-review skill defining the AskUserQuestion-first and action receipt conventions.

## [0.6.0] - 2026-04-05

### Added
- Auto-update system for all skills. Skills check for new versions on each invocation via `bin/update-check` (private gist VERSION comparison, pure bash semver, 60min/720min cache TTL, escalating snooze backoff). Inline upgrade flow in each skill preamble: auto-upgrade if configured, otherwise AskUserQuestion with 4 options (upgrade now, always auto-upgrade, snooze, disable checks). `bin/update-run` handles the upgrade (git stash + fetch + reset --hard + setup). `bin/config` provides simple key=value config management. GitHub Action syncs VERSION to gist on push to main. Global-install only (per-project installs skip update checks). State stored in `~/.gstack-extend/`.

## [0.5.0] - 2026-04-05

### Added
- Bug parking for /pair-review: note unrelated bugs during testing without interrupting the flow. Bugs are parked to `parked-bugs.md`, triaged at group completion (fix now, defer to TODOS.md, or keep parked), and remaining bugs are processed in a post-testing fix queue (Phase 2.5). Designed to avoid `git add -u` sweeping TODOS.md changes into fix commits by deferring classification to group boundaries.

### Fixed
- Corrected TODOS.md path reference in Phase 1 test plan generation (was `TODOS.md`, now `docs/TODOS.md`).

## [0.4.1.1] - 2026-04-05

### Changed
- Renamed project from gstack-native to gstack-extend across all in-repo references: README, CLAUDE.md, setup script, design docs, and TODOS.

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
