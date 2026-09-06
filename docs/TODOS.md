# TODOS

## Unprocessed

### [review:severity=necessary] Harden /review-and-prep Greptile-once and pause/resume edge cases
- **Description:** The /ship Claude adversarial pass on PR #102 (v0.26.2.0) found workflow-logic gaps in `skills/review-and-prep.md` that the GPT-6 in-host review did not raise. Under Greptile's default trigger settings, marking a draft ready can start a second run that the Greptile-once rule forbids, and the skill offers no resolution beyond "resolve the trigger conflict." A failed or cancelled run consumes the allowance, cannot be retried, and cannot use the no-response fallback, so the PR has no path to ready unless a policy skip is offered. The PAUSED receipt lives only in the PR body, which /ship regenerates, and /pair-review's own completion path recommends /ship directly. An ambiguous MCP trigger with no visible run and no comment has no bounded exit. A session that dies between an MCP trigger and the first receipt write loses the reservation. The post-fallback rules disagree when a run becomes visible as queued/running before ready. A reviewed SHA that is no longer an ancestor of HEAD still satisfies the gate.
- **Hypothesis (untested):** Offer a user decision on failure/cancellation and at the fallback boundary instead of a silent block or pass; post the receipt comment at the PAUSED checkpoint and record trigger comment IDs before calling MCP; bound "uncertain" MCP status with a run-history check; require the reviewed SHA to be an ancestor of HEAD or treat the PR as having no usable run.
- **Effort:** M (human: ~1 day / CC: ~30 min)
- **Priority:** P2
- **Context:** Deferred at /ship on 2026-09-06. Each item changes designed behavior the user specified for PR #102 (Greptile-once, the 10-minute fallback), so it needs a product decision rather than a mechanical fix. The full finding list is in the PR #102 body under Adversarial Review.

## Completed

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
