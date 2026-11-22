# TODOS

## Unprocessed

### [review:files=bin/lib/quota/cli.py|bin/lib/quota/samples.py|tests/quota_cases.py] Test gap: refresh with a legacy quota pool list

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** Existing fixtures check supported-pool gating and retired CLI input. They do not cover a saved `quota_pools=claude,codex,cursor` list.
- **Hypothesis (untested):** Keep that preference in an isolated fixture and check that refresh and doctor still report the two supported pools.
- **Upstream severity:** INFORMATIONAL
- **Found in:** Track 93B structured review on `256ef38`.
- **Evidence:** The active pool selection uses `KINDS`. The reviewer found a missing direct fixture and showed no failing command.
- **Context:** Filed by /review-and-prep for Track 93B (2026-11-22).
- **Effort:** ? (user triages in /roadmap)

### [review:files=setup|tests/setup-hosts.test.ts] Test gap: preserve copies when checkout access fails

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The orphan fixtures cover missing, foreign and malformed paths. Checkout access errors and oversized markers remain untested.
- **Hypothesis (untested):** Use an unsearchable checkout parent or oversized marker and check that explicit cleanup preserves the copy.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `setup`, `retired_copy_owner`
- **Evidence:** Track 92A coverage audit at `84ce65c`.
- **Context:** Filed by /review-and-prep for Track 92A host retirement.
- **Effort:** ? (user triages in /roadmap)

### [review:files=setup|tests/setup-hosts.test.ts] Test gap: verify all retired notice owner groups

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The quiet notice fixture uses one spelling per known owner and omits the unknown-owner group.
- **Hypothesis (untested):** Add two spellings of one foreign checkout and an invalid pointer. Check that setup combines the aliases and reports the unknown count.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `setup`, `report_retired_host_leftovers`
- **Evidence:** Track 92A coverage audit at `84ce65c`.
- **Context:** Filed by /review-and-prep for Track 92A host retirement.
- **Effort:** ? (user triages in /roadmap)

### [review:files=bin/update-check|tests/update.test.ts] Test gap: exercise retired warning scan input filters

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The live scan tests cover supported aliases and regular pointers. They do not exercise nonregular markers or unsafe retired directories.
- **Hypothesis (untested):** Add isolated ineligible entries and verify update-check preserves its version result and emits no retirement warning for them.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/update-check`, `_uc_scan_retired_hosts`
- **Evidence:** Track 92A coverage audit at `84ce65c`.
- **Context:** Filed by /review-and-prep for Track 92A host retirement.
- **Effort:** ? (user triages in /roadmap)

### [review:files=setup|tests/setup-hosts.test.ts] Test gap: exercise auto-uninstall with both retired hosts present

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** Managed uninstall and retired-copy preservation appear in separate fixtures.
- **Hypothesis (untested):** Leave copies in both retired directories, remove the last managed install through auto mode, and compare retired tree bytes and CLI links.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `setup`, auto host selection and uninstall
- **Evidence:** Track 92A coverage audit at `84ce65c`.
- **Context:** Filed by /review-and-prep for Track 92A host retirement.
- **Effort:** ? (user triages in /roadmap)

### [review:files=setup|bin/update-check|tests/update.test.ts] Test gap: verify ownership-scoped warning clearance

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The removal and warning fixtures do not run both commands against one retired directory with two owners.
- **Hypothesis (untested):** Remove one checkout's copies and verify update-check still reports the other checkout.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `setup`, retired uninstall, and `bin/update-check`, retired warning scan
- **Evidence:** Track 92A coverage audit at `84ce65c`.
- **Context:** Filed by /review-and-prep for Track 92A host retirement.
- **Effort:** ? (user triages in /roadmap)

### [review:files=setup|tests/setup-hosts.test.ts] Test gap: preserve the preamble after failed publication

- **Test gap:** no demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The failure fixtures cover helper path rejection and unwritable staging. They do not exercise failure after a replacement is staged.
- **Hypothesis (untested):** Inject a failed rename and check that the prior copy remains executable and the staging file is removed.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `setup`, `install_preamble`
- **Evidence:** Track 92A coverage audit read the setup failure tests at `e576de6`.
- **Context:** Filed by /review-and-prep for Track 92A start command (2026-11-21).
- **Effort:** ? (user triages in /roadmap)

### [review:files=setup|tests/setup-hosts.test.ts] Test gap: verify setup lock refusals

- **Test gap:** no demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The schedule fixtures cover a live lock holder. They do not pin the invalid lock and timeout diagnostics.
- **Hypothesis (untested):** Verify the refusal preserves the named lock and the existing skills, and explains how to retry.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `setup`, `acquire_helper_lock`
- **Evidence:** Track 92A coverage audit read the two lock outcomes at `e576de6`.
- **Context:** Filed by /review-and-prep for Track 92A start command (2026-11-21).
- **Effort:** ? (user triages in /roadmap)

### [review:files=setup|tests/setup-hosts.test.ts] Test gap: interleave setup and uninstall before helper state exists

- **Test gap:** no demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The two concurrency scenarios start with an existing install. A fresh HOME reaches the branch where uninstall sees no helper state directory.
- **Hypothesis (untested):** Start both operations in a fresh HOME and check that any surviving skill still has a usable preamble.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `setup`, native uninstall
- **Evidence:** Both existing-install race schedules passed. The Track 92A coverage audit identified the separate fresh-HOME path.
- **Context:** Filed by /review-and-prep for Track 92A start command (2026-11-21).
- **Effort:** ? (user triages in /roadmap)

### [review:files=docs/review-run-state-calls.md|tests/skill-protocols-review-and-prep.test.ts] Test gap: lock the Segments resume mapping

- **Test gap:** no demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The documentation validator checks backticked Markdown headings. The new Segments label is bold prose.
- **Hypothesis (untested):** Check the mapping still points to Segments and names `checkpoint resume` before `derive`.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `docs/review-run-state-calls.md`, Fixed points
- **Evidence:** The Track 92A coverage audit compared the row with the existing heading validator.
- **Context:** Filed by /review-and-prep for Track 92A start command (2026-11-21).
- **Effort:** ? (user triages in /roadmap)

### [review:files=README.md|docs/installation.md|tests/update.test.ts] Test gap: catch drift in start-command installation guidance

- **Test gap:** no demonstrated defect in the corrected guide. Filed under `test-gaps=record`.
- **Description:** The two-host resolver fixtures do not check that the first-run guidance follows the supported host list.
- **Hypothesis (untested):** Check the README and installation guide against the resolver and their shared root-only check.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `docs/installation.md`, Start command
- **Evidence:** Track 92A coverage re-rating checked the corrected documentation by inspection.
- **Context:** Filed by /review-and-prep for Track 92A start command (2026-11-21).
- **Effort:** ? (user triages in /roadmap)

### [review:files=docs/workflow-handoffs.md|skills/review-and-prep.md] Follow-up: H-E's section version and the release disclosure after the completed=true change

- **Follow-up:** owner questions from PR #284's review, not defects a check showed; filed on the developer's decision of 2026-11-20 as non-blocking work
- **Description:** PR #284 changes what the stopped receipt's `Full-review evidence:` row means by `completed=true` while it keeps every H-E label and the prompt byte-identical, as its plan requires. The contract's versioning rule calls a change of meaning breaking, which bumps the section's version, and says a section with no in-band token needs a contract revision that adds one before a breaking change, but it names only H-A, H-C and H-D; the `## Versions` table still lists H-E as version 1, `none; additive-only`. Separately, a release step reads both the plan's `Release note:` and `Upgrade risk:` lines and the review's `User-facing change:` lines, and the skill says nothing about which wins when they disagree. PR #284's plan `Release note:` still announces the descoped credit half, so its run restated the disclosure for the baseline half as `User-facing change:` text and recorded the plan line as superseded.
- **Open question:** Does a change of meaning in a tokenless section such as H-E bump its version, and so first need a token, or is it compatible because no label or case outcome changed? When the plan's disclosure lines and the review's `User-facing change:` lines disagree, which does a release step use?
- **Evidence:** Read from `docs/workflow-handoffs.md:22` (the H-E row), `:508-512` (what `completed=true` covers) and `:1741-1756` (the versioning rule), and `skills/review-and-prep.md:4878-4885` (the disclosure lines) at `e3a48bf`.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `docs/workflow-handoffs.md:22`
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 at `e3a48bf` (2026-11-20).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** the release that ships PR #284 is cut, or the handoff contract's versioning rule next changes.

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
