# TODOS

## Unprocessed

### [review:severity=necessary] Harden /review-and-prep Greptile-once and pause/resume edge cases
- **Description:** The /ship Claude adversarial pass on PR #102 (v0.26.2.0) found workflow-logic gaps in `skills/review-and-prep.md` that the GPT-6 in-host review did not raise. Under Greptile's default trigger settings, marking a draft ready can start a second run that the Greptile-once rule forbids, and the skill offers no resolution beyond "resolve the trigger conflict." A failed or cancelled run consumes the allowance, cannot be retried, and cannot use the no-response fallback, so the PR has no path to ready unless a policy skip is offered. The PAUSED receipt lives only in the PR body, which /ship regenerates, and /pair-review's own completion path recommends /ship directly. An ambiguous MCP trigger with no visible run and no comment has no bounded exit. A session that dies between an MCP trigger and the first receipt write loses the reservation. The post-fallback rules disagree when a run becomes visible as queued/running before ready. A reviewed SHA that is no longer an ancestor of HEAD still satisfies the gate.
- **Hypothesis (untested):** Offer a user decision on failure/cancellation and at the fallback boundary instead of a silent block or pass; post the receipt comment at the PAUSED checkpoint and record trigger comment IDs before calling MCP; bound "uncertain" MCP status with a run-history check; require the reviewed SHA to be an ancestor of HEAD or treat the PR as having no usable run.
- **Effort:** M (human: ~1 day / CC: ~30 min)
- **Priority:** P2
- **Context:** Deferred at /ship on 2026-09-06. Each item changes designed behavior the user specified for PR #102 (Greptile-once, the 10-minute fallback), so it needs a product decision rather than a mechanical fix. The full finding list is in the PR #102 body under Adversarial Review.

### [plan-ceo-review:severity=necessary] In-flight marker and crash detection for extend telemetry

- **Description:** Persist start state durably so a finish that loses its arguments can still be paired, and so an abandoned session is finalized rather than vanishing. The originally proposed form wrote `~/.gstack/analytics/extend-inflight/<session-id>` and swept stale markers. A narrower form (start/finish state handoff under `~/.gstack-extend/`, no sweep) was accepted into the telemetry track itself; this TODO covers only the remaining crash-detection half.
- **Hypothesis (untested):** With the state handoff landed, pairing is already high enough that crash detection adds little; measure before building.
- **Pros:** Closes the last gap where an abandoned run leaves no honest record.
- **Cons:** Rebuilds the phantom-row failure class that Track 13A finding R2 (commit `bc9f9f9`) deliberately removed. Concurrent same-skill sessions have no defined marker-selection rule. A legitimate 4.6-hour run exists in the live data, so any age bound is a guess. Cannot observe an invocation whose start never ran.
- **Effort:** L (human: ~3d / CC: ~1.5h)
- **Priority:** P3
- **Depends on:** the telemetry track's doctor command, which supplies the baseline that decides whether this is needed
- **Context:** Deferred at /autoplan on 2026-09-20. Gate it on measured per-skill pairing. Note that `pair-review`, `review-and-prep` and `test-plan` are resumable by design and legitimately show more starts than finishes, so a low ratio for those is not evidence for this work.

### [plan-ceo-review:severity=nice-to-have] Spike a gstack-extend-shipped PreToolUse Skill hook

- **Description:** Test whether a hook shipped by gstack-extend's `setup` can capture skill activation deterministically, independent of whether the model executes a bash block. gstack already ships five hooks under `hosts/claude/hooks/`, so the pattern is established in this ecosystem.
- **Hypothesis (untested):** A hook is the only mechanism that fixes "the model skipped the block," which is the one failure mode no in-skill instrumentation can catch.
- **Pros:** Structural fix rather than a shorter instruction. Would also cover gstack's own skills.
- **Cons:** Claude Code only. `hosts/grok/config.toml` sets `hooks = false`, and Codex and OpenCode have no equivalent surface, while `setup` installs to all of them. It would be an additive layer, not a replacement, so total mechanisms increase.
- **Effort:** M (human: ~1d / CC: ~30min)
- **Priority:** P2
- **Depends on:** None
- **Context:** Deferred at /autoplan on 2026-09-20. Verified during that review: `~/.claude/settings.json` already registers `PreToolUse matcher:"Skill"` pointing at the personal config repo's `log-skill-usage`, and that script works when fed a correct event. But its output file has never persisted on this machine even though `full-review` is allowlisted and has run, and its `analytics/` directory is gitignored so there is no history to audit. Prove it fires in situ before designing on it.

### [plan-ceo-review:severity=minor] Price the upstream gstack patch before forking telemetry state

- **Description:** Evaluate patching gstack's finalize loop to skip extend-namespaced markers instead of routing extend state around it.
- **Hypothesis (untested):** The upstream change is a one-line `-not -name '.pending-extend-*'`, which would be cheaper than maintaining divergence.
- **Pros:** Keeps extend on gstack's shared state model.
- **Cons:** Cross-repo coordination; needs a gstack release before extend can depend on it.
- **Effort:** S (human: ~4h / CC: ~20min)
- **Priority:** P3
- **Depends on:** the marker TODO above; if that is dropped, this closes with it
- **Context:** Deferred at /autoplan on 2026-09-20. Track 13A R2 explicitly anticipated "a future cross-repo Track that namespaces markers and patches gstack proper to skip them." Both repos have the same owner.

### [plan-eng-review:severity=nice-to-have] Replace the five SHARED-block cohorts with a per-skill capability table

- **Description:** `tests/skill-protocols.test.ts` maintains PROTOCOL, PREAMBLE, CONDUCTOR and NON_PREAMBLE_SETUP cohorts, plus a TELEMETRY cohort after the telemetry track lands, plus an independently hardcoded expected list. Replace them with one declarative table: one row per skill, one column per SHARED block.
- **Hypothesis (untested):** One table removes the class of bug where two overlapping cohorts disagree about the same skill.
- **Pros:** Adding a SHARED block becomes a column rather than a cohort plus three invariants.
- **Cons:** Refactors the file that guards every skill contract, and it is the most-churned file in the repo (11 touches in 30 days).
- **Effort:** M (human: ~1d / CC: ~30min)
- **Priority:** P3
- **Depends on:** the telemetry track's cohort edits
- **Context:** Deferred at /autoplan on 2026-09-20 as FINDING 10.1. Deliberately out of that track's blast radius. Related trap found in the same review: the exclusion invariant at `tests/skill-protocols.test.ts:1503` asserts three skills carry no SHARED marker at all, so it must be narrowed rather than deleted when telemetry lands.


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
