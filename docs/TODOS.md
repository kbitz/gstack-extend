# TODOS

## Unprocessed

### [review:files=tests/handoff-contract.test.ts] Test gap: Compare producer and consumer eligibility by meaning
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The eligible-row count check and neighboring exact-table and consumer cases cover the current contract, but the count check alone does not match each producer condition to its consumer input.
- **Hypothesis (untested):** Re-verify the table and model, then consider mapping their eligible cases directly when this suite next changes.
- **Upstream severity:** CRITICAL (delegated adversarial); P3 (outside reviews).
- **Found in:** tests/handoff-contract.test.ts:1500
- **Evidence:** Read-only reviews; the parent observed 1,971 passing selected tests, 20 skips and no failures. No consumer defect was reproduced.
- **Context:** Filed by /review-and-prep before PR creation at `a799fe4` (2026-11-16). Revisit in the next Track touching this file.
- **Effort:** ? (user triages in /roadmap)

### [review:files=tests/skill-protocols-review-and-prep.test.ts] Test gap: Anchor baseline token checks to their owning bullets
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The full-scope and checkpoint token assertions search the baseline section. Searching each owning bullet could reject a token moved elsewhere without restoring brittle sentence locks.
- **Hypothesis (untested):** Re-verify the published requirements, then extend the existing structural assertions when the suite next changes.
- **Upstream severity:** P3
- **Found in:** tests/skill-protocols-review-and-prep.test.ts:1487
- **Evidence:** Read-only outside challenge; the current protocol suite passed. No wrong instruction or runtime failure was demonstrated.
- **Context:** Filed by /review-and-prep before PR creation at `a799fe4` (2026-11-16). Revisit in the next Track touching this file.
- **Effort:** ? (user triages in /roadmap)

### [review:files=skills/review-and-prep.md] Test gap: Installed-agent full-scope second-cycle continuation
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Executable fences and handoff fixtures do not establish that an installed agent follows the full-scope cycle-2 snapshot, reproduced-probe rerun and record sequence.
- **Hypothesis (untested):** Retain an installed run with a reproduced first-cycle defect, a full second cycle, its actual records and the continuation outcome.
- **Upstream severity:** INFORMATIONAL
- **Found in:** skills/review-and-prep.md:2433
- **Evidence:** Read-only coverage audit; fixture/static coverage was 18 of 20 paths. No installed-agent result or product defect is claimed.
- **Context:** Filed by /review-and-prep before PR creation at `a799fe4` (2026-11-16). Revisit in the next Track touching this file.
- **Effort:** ? (user triages in /roadmap)

### [review:files=skills/review-and-prep.md] Test gap: Installed-agent test-tooling classification and final gates
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Protocol assertions do not establish live classification of eligible test-tooling changes, a documented runner, excluded manifest or CI changes, and final-head test freshness.
- **Hypothesis (untested):** Retain an installed-agent evaluation covering eligible and excluded cases and the final test gates.
- **Upstream severity:** INFORMATIONAL
- **Found in:** skills/review-and-prep.md:3239
- **Evidence:** Read-only coverage audit; the published class, exclusions and freshness rules have fixture/static coverage. No failed classification or skipped gate was reproduced.
- **Context:** Filed by /review-and-prep before PR creation at `a799fe4` (2026-11-16). Revisit in the next Track touching this file.
- **Effort:** ? (user triages in /roadmap)

### [review:files=docs/delegated-review.md|tests/review-delegate.test.ts] Test gap: Delegate evidence-directory documentation pointer
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The explanatory delegate-review document names the branch-scoped calls directory and points to the skill's Evidence directory section, but its existing owning test suite does not lock that pointer.
- **Hypothesis (untested):** Re-verify the published directory contract, then consider extending the existing delegate-document test and its existing dependency rather than adding another cross-suite read.
- **Upstream severity:** INFORMATIONAL
- **Found in:** docs/delegated-review.md:148
- **Evidence:** Static adversarial delta review; no wrong path, failed runtime command or other product defect reproduced. The unplanned protocol-suite read was removed to preserve Track 83A's approved test-file read set and one-path touchfile change.
- **Context:** Filed by /review-and-prep before PR creation at `5448ef2` (2026-11-16). Revisit in the next Track touching these files.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: Optional candidate tree malformed and null boundaries
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Add table rows for null and malformed optional tree values across pass/gate/audit; no defect demonstrated.
- **Hypothesis (untested):** Re-verify behavior first, then extend the existing contract fixture or retained agent-eval evidence.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/state.ts
- **Evidence:** Read-only coverage audit, 21 of 24 paths covered; no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep before PR creation at `112c39c` (2026-11-15). Revisit in the next Track touching these files.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: Malformed optional runner diagnostics
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Exercise wrong types for dispatched, timestamps, parse, verdict and findings, plus omission/null timestamp consistency; no defect demonstrated.
- **Hypothesis (untested):** Re-verify behavior first, then extend the existing contract fixture or retained agent-eval evidence.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/state.ts
- **Evidence:** Read-only coverage audit, 21 of 24 paths covered; no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep before PR creation at `112c39c` (2026-11-15). Revisit in the next Track touching these files.
- **Effort:** ? (user triages in /roadmap)

### [review:files=skills/implement.md|src/review-state/state.ts] Test gap: Installed-agent handoff and delegated recording evaluation
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Evaluate zero-count and long-checklist handoffs in an installed agent and retain the documented next-three-run recording measurement; static grammar tests and fixtures do not establish agent compliance.
- **Hypothesis (untested):** Re-verify behavior first, then extend the existing contract fixture or retained agent-eval evidence.
- **Upstream severity:** INFORMATIONAL
- **Found in:** skills/implement.md
- **Evidence:** Read-only coverage audit, 21 of 24 paths covered; no failure reproduced for this gap.
- **Context:** Filed by /review-and-prep before PR creation at `112c39c` (2026-11-15). Revisit in the next Track touching these files.
- **Effort:** ? (user triages in /roadmap)


## Completed

### [manual] Cut repeated review work in /review-and-prep without changing gstack

- **Why:** Repeated reviewer fan-out on the whole branch diff is most of a review's usage. Private review observations found repeated whole-branch sweeps, lower usage in a repair-only continuation, and later full sweeps whose specialists returned no findings. The defects came from the native adversarial pass and the outside voices. When `/review` stops at its three-cycle cap (`converged:false`), `/review-and-prep` has no instruction at all, so a person decides each continuation ad hoc.
- **Effort:** M (~560 lines incl. tests)
- **Priority:** P2
- **Context:** Owner request, 2026-10-20; plan `plans/2026-10-20-review-and-prep-repeat-work.md` in the project's gstack notes. Scope, wrapper-only: (1) a cycle-stop exit that commits and pushes the draft, writes a STOPPED receipt, never runs a fourth pass or a new `/review` in that invocation, and prints a continuation prompt for a fresh session; an optional, versioned caller policy line (`Review policy: review-and-prep-policy/v1; in-cap=delta|full; continuation=repair-only|full|stop; documentation-audit=final; full-suite=final; max-continuations=<n>`) that the prompt carries verbatim, which hand runs omit (they get a three-option question instead), and which never waives a gate; documented as the additive H-E continuation shape in `docs/workflow-handoffs.md`. (2) Delta-scoped wrapper re-reviews, opt-in through that policy or a direct request: substitute the last reviewed commit for every diff and scope command of the nested `/review` so gstack's own gates pick reviewers for the delta, record each skip with gstack's reason, keep the native adversarial pass and the outside challenge, and use full scope for conflicted base merges, scope changes, rewritten history and unknown dependencies. (3) Final messages restate no receipt or matrix; long evidence goes to files; independent Step 1 reads run in parallel. (4) A local-only `voices.jsonl` naming each reviewer subagent's host identifier and parent-observed dispatch/return times, never in the PR body. (5) With `in-cap=delta` and a passing drift check (the installed `/review` still carries the exact Step 5.8 text it narrows), `/review`'s own cycles 2–3 review only the previous cycle's fixes: a dangling snapshot commit built through a temporary index marks each cycle's candidate, gstack's gates pick reviewers for the delta, specialists whose findings were fixed are force-included, the native adversarial pass and the outside challenge run every cycle, and the receipt records each delta cycle as a partial pass. A failed drift check runs `/review` unmodified. Upstream will not change Step 5.8, so the wrapper carries this opt-in. Apply (3) and (4) to `/ship-and-land`'s own readers. No gstack file changes; gstack's cycle cap and stop, specialist prompts, outside voice, parser and documentation-audit bound stay as they are. MINOR under the 0.x policy. Proposed `_touches:` `skills/review-and-prep.md`, `skills/ship-and-land.md`, `docs/workflow-handoffs.md`, `docs/telemetry.md`, `tests/skill-protocols.test.ts`, `tests/handoff-contract.test.ts`, `tests/fixtures/handoffs/`, `tests/workflow-metrics.test.ts`, `tests/helpers/touchfiles.ts` (collides with Tracks 26A and 27A). Track 30A can consume the join file; Track 31A keeps its section-loading and voice-yield questions. Changes no review gate by default.
- **Completed:** v0.38.0.0 (2026-10-21). The stop, continuation prompt, opt-in delta review, and local reviewer join are in the wrapper skills, the handoff contract, and the tests. Installed-agent proof of a real continuation stays on the first post-release run. The separate default-flip comparison stays open.

### [review] install-safety.sh reads ownership through GNU stat's -f output

- **Description:** `bin/lib/install-safety.sh:_path_owner_uid` runs `stat -f '%u' path || stat -c '%u' path`. With GNU coreutils ahead of `/usr/bin` in PATH, GNU `stat -f` prints file-system details and fails, the fallback appends the uid, and the captured value no longer equals `id -u`. Every host directory then fails the ownership check, so setup skips all hosts. Track 23C's own stat calls try BSD `-f` first and keep the output only when it has the expected shape, otherwise use `-c` (`setup:_is_stat_id`, `_is_stat_size`); reuse that pattern here. This pre-existing helper sits outside that track's files.
- **Effort:** S (human: ~30min / CC: ~10min)
- **Context:** Found during Track 23C review and prep on 2026-10-09 while confirming the same ordering bug in the new install-status code. A probe with `/opt/homebrew/bin/gstat` first in PATH showed the multi-line capture.
- **Priority:** P2
- **Revisit when:** The next change to `bin/lib/install-safety.sh`, or a report of setup skipping every host on a machine with GNU coreutils on PATH.
- **Completed:** v0.36.5.0 (2026-10-09). The impact was wider than described: every stock GNU/Linux host has refused every skills directory since v0.18.14.0. `_path_owner_uid` now asks GNU `stat -c` first and falls back to BSD `stat -f`. That needs no shape check, because BSD `stat -c` fails with empty stdout. Stat-shim unit tests cover both flavors, foreign-uid refusal and unreadable ownership.

### [investigate] The Cursor and quota sentence overstates what the store reader can read

- **Symptom:** `docs/telemetry.md` section "Cursor and quota" says local native SDK runs supply model and effort when readable, otherwise null. The live Conductor store shape is never readable by `cursor_turns()`, so the null is structural, not an occasional miss. A reader can think a null model means the run did not name one.
- **Repro:** Read the "Cursor and quota" paragraph, then run the repro on `cursor_turns() cannot read the Conductor store shape`. The store record's `model.id` is `grok-4.7` while the reader returns no turn. Update the sentence, and link `docs/designs/review-independence.md` from that section. Track 16B does not edit `docs/telemetry.md`.
- **Effort:** S (human: ~1h / CC: ~15min)
- **Priority:** P2
- **Depends on:** The reader fix above, or a doc change that describes the current failure without waiting for it. Owner of `docs/telemetry.md`. Track 16A had not corrected this sentence as of 2026-09-25.
- **Context:** `docs/designs/review-independence.md` section 8.
- **Completed:** v0.32.1.0 (2026-09-28). The Cursor section now says the current reader cannot parse numeric timestamps and list-valued model parameters, so model and effort stay null even when the store names a model, and it links the review-independence evidence. The separate `cursor_turns()` reader TODO stays open.

### [manual] Native Cursor host installation
- **Description:** Add `setup --host cursor` and auto-detection through the Cursor command or home directory. Generate native skill copies with ownership-safe refresh and uninstall, verified home-root probes, and telemetry pointer discovery.
- **Scope:** Included in Track 16D's PR #113 on 2026-09-25. This explicitly expands its original fence to `setup`, the two additional telemetry-only skills, `tests/telemetry.test.ts`, and the canonical blocks in `docs/telemetry.md`; coordinate the setup overlap with Track 16E during review and prep.
- **Decision:** When `cursor` is on PATH but `~/.cursor` is absent, create the skill directory. When Cursor is absent, leave it absent. Strip `allowed-tools` as Codex does.
- **Review decisions (2026-09-26):** Setup preserves a `SKILL.md` symlink that points outside a gstack-extend checkout on every host, skips Cursor when `~/.cursor/skills` is another host's skills directory, and in `--host auto` skips a detected host whose skills directory fails the install-path check. Track 16D's `_touches:` now lists the Cursor files. Track 16E shipped first (#110), so `setup` merged cleanly. The resulting Group 16 COLLISIONS and PACKING failures (shared `docs/telemetry.md` with 16A, and 16E still listed in Current Plan) are deferred by the user to the next `/roadmap` run.
- **Completed:** v0.29.4.0 (2026-09-26)

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
