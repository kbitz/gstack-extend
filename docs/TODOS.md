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

### ~~Manual test review skill~~ ✓ DONE (v0.4.0)
Completed: `skills/pair-review.md`. Pair testing session manager with deploy
discovery, grouped test plans from diffs, test-fix-retest loop with group-level
checkpoints, and cross-machine resume. Design doc: `docs/designs/pair-review.md`.

### /pair-review PR comment integration
Post test session report as a PR comment via `gh pr comment` with
update-or-create idempotency. Deferred from v1 to prove the core loop first.
- **Why:** Connects manual testing evidence to the PR record
- **Effort:** S (human: ~1 day / CC: ~10 min)
- **Depends on:** /pair-review proven reliable through real usage

### /pair-review validation script
After the skill is battle-tested, add `scripts/validate-pair-review.sh` with
gates for state file validity, resume round-trip, and deploy recipe discovery.
- **Why:** Catches regressions when the skill file is modified
- **Effort:** S (human: ~1 day / CC: ~15 min)
- **Depends on:** /pair-review proven reliable through real usage

### Auto-update test script
Add `scripts/test-update.sh` exercising update-check with mock remotes
(env var overrides). Tests: remote > local, remote = local, remote < local
(semver), cache fresh/stale, snooze active/expired, config disable.
- **Why:** Catches regressions when update scripts are modified
- **Effort:** S (human: ~1 day / CC: ~10 min)
- **Depends on:** auto-update feature shipped (v0.6.0)

### setup script hardcodes global install path
`setup` always symlinks into `~/.claude/skills/`, even when invoked from a
per-project `.claude/skills/gstack-extend` checkout. This breaks project-scoped
installs: skills leak into unrelated repos and removing the project leaves
dangling global symlinks.
- **Why:** Found by Codex review. The setup script should detect whether it's
  being run for global or per-project install and target accordingly.
- **Effort:** S (human: ~2 hours / CC: ~10 min)
- **Depends on:** Nothing

### update-run destroys non-main branch work
`bin/update-run` uses `git reset --hard origin/main` which forcibly resets the
current branch to origin/main. If the gstack-extend checkout is on a development
branch, committed branch-only work is lost (git stash only preserves working-tree
changes). Should use `git pull` or check that we're on main first.
- **Why:** Found by Codex review. Unsafe for anyone developing on gstack-extend.
- **Effort:** S (human: ~1 hour / CC: ~5 min)
- **Depends on:** Nothing

### Skill preamble update-check guard too narrow
The update-check guard in `skills/pair-review.md` and `skills/browse-native.md`
only fires when the symlink target lives under `~/.claude/skills/`. Installs
from other directories (which `setup` allows) work but never report upgrades.
- **Why:** Found by Codex review. Low priority since most installs are global.
- **Effort:** XS (human: ~30 min / CC: ~5 min)
- **Depends on:** Nothing

### Migrate to raw.githubusercontent.com when repo goes public
Replace gist URL with `raw.githubusercontent.com/kbitz/gstack-extend/main/VERSION`
in `bin/update-check`. Remove GitHub Action sync workflow and GIST_TOKEN secret.
- **Why:** Eliminates gist indirection and PAT secret dependency
- **Effort:** XS (human: ~30 min / CC: ~5 min)
- **Depends on:** repo made public

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

### Multi-agent test orchestration (/pair-review Approach C)
Each test group assigned to a separate conductor agent. Session.yaml as
coordination point, groups as independent files so agents don't conflict.
Parallel testing across agents for large test suites.
- **Why:** Dramatically speeds up large test suites (15-20 items)
- **Effort:** L (human: ~2 weeks / CC: ~2 hours)
- **Depends on:** /pair-review v1 proven reliable, conductor agent API maturity

### ~~Repo rename: gstack-native → gstack-extend~~ ✅ Done
Renamed in-repo references. GitHub repo rename still needed.

### Contrast ratio + VoiceOver order analysis
Extend accessibility reporting with pixel-level contrast analysis (using probe
color data) and VoiceOver navigation order verification.
- **Why:** Important accessibility metrics not available from probes alone.
  Apple requires these for App Store review.
- **Effort:** M (human: ~1 week / CC: ~30 min)
- **Depends on:** Bolt probe enrichment (color hex data)
