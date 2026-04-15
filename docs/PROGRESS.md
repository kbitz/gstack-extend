# Progress

## Phase 1: Core Adapter (current)

Build the /browse-native skill and validate it against real macOS apps.

| Version | Date | Summary |
|---------|------|---------|
| 0.8.8.1 | 2026-04-14 | Public-ready cleanup: MIT license, gist-to-raw-GitHub version check migration, removed archived design docs with internal references, anonymized app name across docs and skill, SSH→HTTPS clone URL. |
| 0.8.8 | 2026-04-13 | /roadmap triage mode now runs the freshness scan (Step 3.5) before classifying items into groups. Previously, triage slotted new items into potentially-complete groups because the scan was gated to update mode only. Stale/completed tasks are now always cleaned before new items get placed. Early exit no longer skips the freshness check. |
| 0.8.7 | 2026-04-12 | /pair-review latency optimization: lookahead display (next item preview inline with current), batch mode (3 items at once with "All pass"), PASS/SKIP fast path (cached lookahead + parallel state writes). Reduces perceived wait and actual round-trips. |
| 0.8.4 | 2026-04-07 | /roadmap doc discovery: scans all .md files for scattered TODOs, extracts actionable items with one-by-one triage, deduplicates against existing TODOS.md/ROADMAP.md, merges with [discovered:filepath] provenance tags, and offers doc reclassification (rewrite as spec, delete TODO sections, or leave with drift detection). Hybrid architecture: deterministic bash audit for discovery, LLM for semantic extraction and dedup. 17 new tests (65 total). |
| 0.8.1 | 2026-04-06 | /roadmap phase triage step: keep/kill + phase assignment before Group/Track placement. Items triaged to current phase or deferred to Future. Version history audit: removed invalid 0.4.2 (doc-only rename folded into 0.4.1), added missing 0.8.0 CHANGELOG entry. |
| 0.8.0 | 2026-04-06 | New /full-review skill: weekly codebase review pipeline with 3 specialized agents (reviewer, hygiene, consistency-auditor) dispatched in parallel, root-cause clustering for triage UX, human approve/reject/defer per cluster, approved findings written to TODOS.md as `[full-review]` source-tagged items. Dedup against ROADMAP.md prevents re-flagging tracked issues. Incremental state checkpointing for resume support. Designed to feed into /roadmap for execution topology. |
| 0.7.0 | 2026-04-06 | New /roadmap skill: deterministic audit script (8 checks, 28 tests) + skill prompt for doc restructuring into Groups > Tracks > Tasks. TODOS.md/ROADMAP.md split (inbox vs execution plan). Two modes: overhaul (first run) and triage (process unprocessed items). /pair-review writes to TODOS.md Unprocessed section with source tags. Shared semver lib extracted. |
| 0.6.3 | 2026-04-06 | browse-native gated as opt-in beta: `./setup` only installs stable skills by default, `--with-native` flag for beta. Unknown flags now rejected. README updated with maturity status. Test suite expanded to 24 tests. |
| 0.6.2 | 2026-04-05 | Bug fixes: `update-run` safe branch handling, preamble update-check guard works from any clone location. Smart next-step suggestion at pair-review completion (nudges `/review` before `/ship` for non-trivial changes). New test suite `scripts/test-update.sh` (17 tests). |
| 0.6.1 | 2026-04-05 | /pair-review UX fixes: standardized all prompts to AskUserQuestion with explicit options (eliminates inconsistent question styles across workspaces), added Conductor visibility awareness with action receipt pattern (important status updates always visible in final message). |
| 0.6.0 | 2026-04-05 | Auto-update system: `bin/update-check` (gist-based remote VERSION, pure bash semver, caching, snooze) + `bin/update-run` (git pull + setup) + `bin/config` (key=value). Inline upgrade flow in skill preambles. GitHub Action syncs VERSION to gist. Global-install only. State in `~/.gstack-extend/`. |
| 0.5.0 | 2026-04-05 | Bug parking for /pair-review: park unrelated bugs during testing, triage at group completion (fix now / defer to TODOS.md / keep parked), post-testing fix queue (Phase 2.5). Avoids git add -u pollution by deferring TODOS.md writes to group boundaries. Design doc updated. |
| 0.4.1 | 2026-04-04 | Added `setup` script for skill symlink installation. Handles both global (~/.claude/skills/) and per-project installs, with --uninstall support. README updated with proper install instructions. Renamed project from gstack-native to gstack-extend. |
| 0.4.0 | 2026-04-04 | New /pair-review skill: pair testing session manager with deploy discovery, grouped test plans from diffs, test-fix-retest loop with group-level checkpoints, and cross-machine resume. General-purpose (web, native, CLI). Design doc: docs/designs/pair-review.md |
| 0.3.1 | 2026-04-04 | Implementation guide for adding debug infrastructure to new apps (docs/debug-infrastructure-guide.md). Skill now detects missing infrastructure and guides users to add it before proceeding in degraded mode. |
| 0.3.0 | 2026-04-04 | Replaced Peekaboo with inside-out debug pattern. App instruments itself (screenshots via ScreenCaptureKit, layout probes, state dumps). Agent communicates via filesystem triggers + osascript. Three-tier degraded mode (full/partial/screenshot-only). New validation gates. Design doc: docs/archive/inside-out-debugging.md |
| 0.2.0 | 2026-03-27 | Skill rewrite from hands-on feedback: reframed as focused interaction tool (not autonomous QA), mandatory target requirement before starting, capability probe at session start, keyboard-first mode for sparse AX trees (SwiftUI), --app fallback when --window-id fails, action batching, adaptive waits, error recovery patterns, honest limitations section, replaced QA checklist with scoped reporting. |
| 0.1.2 | 2026-03-25 | Gate 2 rewrite: element-ID targeting, state verification, button click by ID. Spec aligned with implementation. 20-step proof deferred to TODOS. |
| 0.1.1 | 2026-03-25 | Simplified to 3 gates, switched default to TextEdit, added close-button cleanup, fixed hotkey syntax |
| 0.1.0 | 2026-03-24 | Initial /browse-native skill, validation gates (4 gates), design doc, TODOs |

## Roadmap

- **Current: install pipeline + distribution** — Per-project install support, raw GitHub migration, phase transition detection
- **Future: multi-agent test orchestration** — Parallel testing across Conductor agents
