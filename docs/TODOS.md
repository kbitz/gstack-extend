# TODOS

## Unprocessed

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: standalone Grok marker with an inner harness

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** Permanent nested-harness fixtures combine Claude and Codex markers, but not an inherited session-only Grok marker with an inner harness and competing or absent logs.
- **Hypothesis (untested):** Extend the existing nested-marker fixture after re-verifying nearest-ancestor and latest-turn selection.
- **Upstream severity:** INFORMATIONAL (outside review and coverage audit).
- **Found in:** tests/telemetry.test.ts:1637.
- **Evidence:** Read-only coverage audit; isolated synthetic nearest-ancestor and latest-turn probes passed. No failure was reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/21134ed5` at `60a0df4` (2026-11-15), before a PR exists.
- **Revisit when:** The next Track touches either tagged file.
- **Effort:** ? (user triages in /roadmap).

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: invalid Grok session name with an active sibling log

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** The invalid-marker fixture checks fingerprint creation without checking detection against a fresh sibling log; the missing-log fixture uses a valid session name.
- **Hypothesis (untested):** Extend the existing Grok log fixture with a nonempty invalid session name and one fresh sibling, asserting detected Grok with null model and effort.
- **Upstream severity:** INFORMATIONAL (coverage audit).
- **Found in:** bin/lib/telemetry.py:1221 and tests/telemetry.test.ts:1867.
- **Evidence:** Read-only coverage audit; an isolated invalid-name probe passed without using a sibling log. No failure was reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/21134ed5` at `60a0df4` (2026-11-15), before a PR exists.
- **Revisit when:** The next Track touches either tagged file.
- **Effort:** ? (user triages in /roadmap).

### [review:files=bin/lib/telemetry.py|tests/telemetry-contract.test.ts] Grok sessions launched by hand are not detected

- **Defect:** Grok sessions launched by hand (Paseo, owner's `kb-xps`, `0.94.1`) record `agent=null` and `run_mode_source=no-harness`; harness detection misses Grok.
- **Evidence:** Owner's corrected raw-row readback for `docs-ship` at `2026-11-15T03:32:06Z`: `producer_version="0.94.1"`, `agent=null`, `run_mode="unknown"`, `run_mode_source="no-harness"`. The owner identifies the harness as Grok; the report paste independently shows that stage/time under `unknown`.
- **Expected / observed:** Detect the actual Grok harness without calling it Claude; observed agent is null. A detected non-Claude by-hand harness should still classify `unknown` / `harness-unqualified` until a trustworthy launch signal exists, so fixing detection alone must not claim `user-directed`.
- **Diagnosis:** `SESSION_MARKERS` and `harness_fingerprint()` count `GROK_SESSION_ID` only with `GROK_AGENT=1`, matching `detect()`. The missing marker is a hypothesis; the launch environment was not retained. No classifier or harness-detection fix is included here.
- **Context:** Owner-supplied evidence and correction, `2026-11-15`; see [hand-use qualification](acceptance/hand-use-telemetry.md).
- **Revisit when:** The next Track touches harness detection, or the next by-hand Grok/Paseo run supplies safe marker-presence evidence for reproduction. Never capture marker values or credentials.
- **Effort:** ? (user triages in /roadmap).

### [review:files=docs/designs/review-run-state.md|docs/review-run-state-calls.md|tests/skill-protocols-review-and-prep.test.ts] Test gap: diagnostic escaping contract drift

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** The diagnostic escaping rule is repeated in the design and calls documents, but the protocol assertion pins only the calls document. The design copy could drift independently.
- **Hypothesis (untested):** Extend the existing protocol test to pin the bound and escaping rule in both documents after re-verifying the contract.
- **Upstream severity:** INFORMATIONAL (adversarial; coverage audit agrees).
- **Found in:** docs/designs/review-run-state.md:10 and tests/skill-protocols-review-and-prep.test.ts:4391.
- **Evidence:** Read-only coverage audit found 18 of 19 paths covered; both documents currently agree. No failure was reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/a103285c` at `9df2a4c` (2026-11-15), before a PR exists.
- **Revisit when:** The next Track touches any tagged file.
- **Effort:** ? (user triages in /roadmap).

### [review:files=src/review-state/store.ts|tests/review-state.test.ts] Test gap: evidence recheck resolved target identity
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Equal-size, equal-mtime symlink retarget and regular-file replacement lack direct recheck regression cases.
- **Hypothesis (untested):** Extend the lock-acquisition mutation table after re-verifying the guard.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/store.ts:289
- **Evidence:** Testing specialist and coverage gap 06; no failure reproduced.
- **Context:** /review-and-prep, branch mmm/361563a7 at 6d2fc37, 2026-11-14, before a PR exists. Revisit when the next Track touches either tagged file.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/store.ts|tests/review-state.test.ts] Test gap: sweep identity and failure branches
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Hard links, legacy finish evidence, listing/unknown-stat failures, symlink/disappearing candidates, combined warnings and exact input/uppercase namespace refusals lack strong permanent assertions.
- **Hypothesis (untested):** Extend existing sweep/refusal tables; retain namespace cases only if the owner approves that restriction.
- **Upstream severity:** CRITICAL (adversarial test-gap claim); INFORMATIONAL (testing)
- **Found in:** src/review-state/store.ts:300-350
- **Evidence:** Coverage gaps 09/16/17/19/20/21/27 and weak 07; live hard-link/refusal probes passed, no defect reproduced.
- **Context:** /review-and-prep, branch mmm/361563a7 at 6d2fc37, 2026-11-14, before a PR exists. Revisit when the next Track touches either tagged file.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/render.ts|tests/review-state.test.ts] Test gap: render help examples through real validation
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Render example tests check keys and equality but do not execute nested validation with matching files and lifecycle.
- **Hypothesis (untested):** Feed each example through executeRender using valid evidence fixtures after re-verifying the validator.
- **Upstream severity:** CRITICAL (adversarial test-gap claim)
- **Found in:** src/review-state/render.ts:31
- **Evidence:** Coverage gap 30 and adversarial test-gap claim; the suspected summary-type defect was disproved, no failure reproduced.
- **Context:** /review-and-prep, branch mmm/361563a7 at 6d2fc37, 2026-11-14, before a PR exists. Revisit when the next Track touches either tagged file.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: root continuation type diagnostic advice

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** The continuation diagnostic tests use object inputs and dotted violation paths; they do not directly pin the shape advice for null, scalar or array continuation values at the root `continuation` path.
- **Hypothesis (untested):** Extend the existing continuation diagnostic table with those values, asserting the exact type violation, specific message/fix and absent state file after re-verifying the validator.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** `src/review-state/state.ts:319,391`.
- **Evidence:** The integrated-head read-only coverage audit found this healthy boundary; the root-path predicate handles it. No failure was reproduced.
- **Context:** Filed by /review-and-prep on PR #253 after merging base `36a66ad` (2026-11-14).
- **Revisit when:** The next Track touches either tagged file.
- **Effort:** ? (user triages in /roadmap).

### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: start delegation parts array shape
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** `start` has no direct refusal test for missing, non-array or empty active-delegation `parts`.
- **Hypothesis (untested):** Extend the CLI refusal table with these shapes; pin exact violations and absent state bytes after re-verifying the current validator.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/state.ts:377
- **Evidence:** Track 80A coverage audit G1; source and existing tests read, no failure reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/2fba785c` at `5fb7593` (2026-11-13); PR not yet created.
- **Revisit when:** The next Track touches either tagged file.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: start delegation non-string part entries
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Unknown-string refusal does not independently cover non-string `parts` entries becoming invalid labels.
- **Hypothesis (untested):** Add non-string entries to the CLI refusal table with exact violation and no-write assertions; re-verify the contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/state.ts:169
- **Evidence:** Track 80A coverage audit G2; existing real-policy/label tests pass, no failure reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/2fba785c` at `5fb7593` (2026-11-13); PR not yet created.
- **Revisit when:** The next Track touches either tagged file.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: omitted delegation tools default and replay
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Active-delegation fixtures explicitly supply `tools`; omission's default to `[]` and replay parity lack a direct test.
- **Hypothesis (untested):** Compare an omitted-tools start with explicit `tools: []`, checking stored labels and replay after re-verifying defaults.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/state.ts:376
- **Evidence:** Track 80A coverage audit G3; source defaults to an empty array, no failure reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/2fba785c` at `5fb7593` (2026-11-13); PR not yet created.
- **Revisit when:** The next Track touches either tagged file.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: malformed or unknown delegation tools
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The current tools refusal uses a recognized name outside `parts`; non-array, non-string and unknown-name inputs lack direct coverage.
- **Hypothesis (untested):** Extend tools refusal rows with those inputs, exact `subset-of-parts` violations and absent state bytes; re-verify first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/state.ts:379
- **Evidence:** Track 80A coverage audit G4; current mapper and subset check inspected, no failure reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/2fba785c` at `5fb7593` (2026-11-13); PR not yet created.
- **Revisit when:** The next Track touches either tagged file.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: normalized delegation tools uniqueness
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Parts alias-collision coverage does not protect tools' independent normalized-uniqueness check.
- **Hypothesis (untested):** Refuse repeated tools and name/label alias pairs with exact violations and no write, after re-verifying the current rule.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/review-state/state.ts:380
- **Evidence:** Track 80A coverage audit G5; uniqueness applies after normalization, no failure reproduced.
- **Context:** Filed by /review-and-prep on branch `mmm/2fba785c` at `5fb7593` (2026-11-13); PR not yet created.
- **Revisit when:** The next Track touches either tagged file.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/secret-dispositions/evaluate.ts|tests/secret-dispositions.test.ts] Test gap: added-line part type guards

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`.
- **Description:** The malformed-part table covers reading/key conflicts and invalid members, but does not independently pin null/primitive/array parts, a missing or non-string file, non-string legacy text, non-array `texts`, non-array `keep`, or a non-array collection passed to `evaluate()`.
- **Hypothesis (untested):** Extend the existing malformed-part table and add a collection-boundary case requiring `PART_SHAPE_ERROR`; re-verify the guards before writing the tests.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** `src/secret-dispositions/evaluate.ts:21-48,98`.
- **Evidence:** The outside challenge and read-only coverage audit found six uncovered guard paths; source inspection shows the guards reject them. No failure or regression was demonstrated. Existing shape/CLI fixtures passed in the targeted run.
- **Context:** Filed by /review-and-prep on branch `mmm/1edf4214` at `2c8cf1c` (2026-11-13), before a PR exists.
- **Revisit when:** The next Track touches either tagged file.
- **Effort:** ? (user triages in /roadmap).

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
