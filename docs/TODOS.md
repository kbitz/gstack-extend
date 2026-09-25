# TODOS

## Unprocessed

### [plan-ceo-review:track=16A,defer=true] Version stage-runs rows and publish their schema
**What:** Add a schema version and a gstack-extend producer version to every stage-runs row, publish a machine-readable schema, and record whether `model`/`effort` came from flags or from logs.
**Why:** 8 of 10 captured rows lack `route` and `entrypoint_raw`; readers can only infer the writer release from key presence, and `agent: cursor` arrived without a marker.
**Context:** Found by Track 16A. `route` values are written inline in `route_for` (bin/lib/telemetry.py) with no constant. docs/telemetry.md holds the field and value version notes this would replace.
**Effort:** S
**Priority:** P1
**Depends on:** None

### [plan-ceo-review:track=16A,defer=true] Doctor coverage report over stage-runs and leftover handoffs
**What:** Teach `gstack-extend doctor telemetry` to read stage-runs and leftover handoffs, warn when gstack's tier is off, record the skill in each handoff, and give the deferred marker work a tier-independent trigger.
**Why:** On a tier-off machine the doctor reports insufficient evidence for every skill and the 95% decision rule never fires; orphaned handoffs name neither skill nor repository.
**Context:** Track 16A's observed-coverage record was captured by a private script; this report would make it re-runnable anywhere. Define the independent invocation evidence a capture-completeness claim needs.
**Effort:** M
**Priority:** P2
**Depends on:** None

### [plan-ceo-review:track=16A,defer=true] Collision-safe and idempotent run identity
**What:** Two starts of one skill in one checkout must produce two correctly attributed rows, and repeating a finish (an explicit retry with the original IDs, or a retry after a logger timeout that already wrote) must not duplicate rows.
**Why:** Today the later start replaces the handoff slot, so the earlier run's finish is recorded under the later run's identity and the later run has no row; a repeated explicit finish appends a second stage-runs row and a second skill_run.
**Context:** Characterized as current behavior by the collision and explicit-retry tests in tests/telemetry-contract.test.ts; acceptance is those sequences producing exactly one correctly attributed row per run.
**Effort:** M
**Priority:** P2
**Depends on:** None

### [plan-ceo-review:track=16A,defer=true] Decide the repository identity in skill_start rows
**What:** Decide whether `skill_start.repo` should carry origin `owner/name` instead of the checkout directory name.
**Why:** The three datasets use three repository identities, so `repo` never joins; under a workspace manager the directory name is the workspace name.
**Context:** gstack's sync strips `repo` before upload on its jq path (its sed fallback mis-strips a value containing an escaped quote), so the decision mainly affects local consumers. Track 16A documents the divergence and locks it as current behavior.
**Effort:** S
**Priority:** P3
**Depends on:** None

## Completed

### [manual] Keep gstack-extend independent of the maintainer's personal tooling
- **Description:** gstack-extend should stand on its own. Its features must be usable by any caller, and no shipped artifact (code, docs, tests, TODOS entries, CHANGELOG, commit or PR text) should require or name the maintainer's private orchestrator or personal cross-machine tooling. Reword references generically and add a consumer-agnostic rule to `CLAUDE.md`.
- **Effort:** S (human: ~2h / CC: ~15min)
- **Priority:** P2
- **Context:** Raised by the maintainer on 2026-09-23 during /autoplan of the quota ledger (plan requirements G-01 and G-02).
- **Completed:** v0.29.0.0 (2026-09-24). Discharged at /roadmap@a646c94: no live `*.md`/`*.py`/`*.ts`/`*.sh`/`setup` artifact names the tooling, `CLAUDE.md` carries the "Consumer independence" section, and the P0 inbox entries already read "an external consumer". A local-only regression check is by design never committed. Release history in CHANGELOG, PROGRESS, and roadmap-shipped was left as-is at discharge, then reworded to generic cross-machine wording on this branch.

### [manual] Quota ledger, with Cursor capacity as an open question

- **Description:** Nothing measures quota spent per stage per configuration; all current figures are wall-clock. Codex and Claude expose readable remaining-capacity endpoints. The Grok Build endpoint is unusable for this purpose because Grok now runs through Cursor (`cursor-agent` or natively in Conductor). Whether Cursor capacity is readable, and whether the CLI and Conductor routes share a pool, are open questions. Acceptance requires evidence of consumption attributable to stage and configuration, documented capacity-read results and pool relationships, and distinct model-vendor and capacity-pool fields: review independence follows the vendor, while capacity follows the pool, which may serve several vendors. A failed capacity read must degrade to a local consumption ledger and must never be interpreted as "no quota."
- **Effort:** L (human: ~3d / CC: ~1.5h; provisional pending planning)
- **Priority:** P0
- **Depends on:** None
- **Context:** Unblocks 4 downstream tracks for an external consumer, making this the most blocking of the four P0 dependencies. A separate planning session is underway; this entry records the problem and required acceptance evidence, leaving the design to that session.
- **Completed:** v0.29.0.0 (2026-09-24)

### Failed-ledger retry with non-semver NEW aborts the helper

**What:** Do not call `version_gt` / `semver_lte` unless NEW is semver. If NEW is `unknown` (or any letter-bearing string), skip the compare and either retry every failed name or leave them queued.

**Why:** After 15B, the window skip refuses non-semver OLD/NEW, then the failed-ledger path still calls `semver_lte VER unknown`. Under `set -u`, `(( 1 > unknown ))` is unbound and the EXIT trap kills the helper before the retry runs.

**Context:** Red-team finding after v0.24.5.0 landed (PR #96). Reproduced: `bash -c 'set -u; bi=unknown; (( 1 > bi ))'`. File: `bin/lib/run-migrations.sh` failed-path `semver_lte`. No production `migrations/v*.sh` yet — fix before the first real script.

**Effort:** S
**Priority:** P1
**Depends on:** None
**Completed:** v0.24.6.0 (2026-08-15)

### Setup-fail after pull drops in-window migrations forever

**What:** Persist the pre-pull version (or pre-register in-window names into `migrations-failed`) before `./setup`. A later `update-run` must still see those names when OLD==NEW.

**Why:** Pull advances VERSION, then setup can exit 1 (`no bun`, install-safety). The helper never runs. Next hop reads OLD==NEW, so unstarted in-window scripts are not in the failed ledger and never execute. Same hole if the helper aborts mid-scan.

**Context:** Red-team finding after v0.24.5.0. Not the deferred first-hop chicken-and-egg (old binary missing the call site). This is every post-15B hop whose helper does not finish after VERSION already moved. `bin/update-run` setup is ~line 122; helper only runs if setup returned.

**Effort:** S
**Priority:** P1
**Depends on:** None
**Completed:** v0.24.6.0 (2026-08-15)

### Helper-path tests before the first real `v*.sh`

**What:** Add fixtures for: helper missing-args / missing semver.sh / bad-version; empty `migrations/` (`.gitkeep` only); symlink and non-semver name skip; fail-then-succeed clears `migrations-failed`; unexpected helper abort emits `MIGRATION_WARN helper`.

**Why:** Post-ship coverage audit scored 69% on the 15B hook. Those branches are how the two P1 holes hide. Tests should exist before any install-mutating script ships.

**Context:** Coverage audit after PR #96. Do not file each gap as its own item. Bundle lives here; implement with the P1 fixes.

**Effort:** S
**Priority:** P2
**Depends on:** The two P1 upgrade items above (same PR is fine)
**Completed:** v0.24.6.0 (2026-08-15)
