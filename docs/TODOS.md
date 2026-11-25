# TODOS

## Unprocessed

### [review:files=src/audit/lib/todo-patterns.ts|src/audit/checks/scattered-todos.ts] Base issue: Count scattered TODOs after indented code examples
- **ID:** wi-331497
- **Base issue:** Present at merge base `beb8956`. Filed under `blocking=shown`.
- **Description:** A four-space-indented literal backtick marker in a Markdown note makes `countTodoPatterns` skip the rest of the file, including later checklist items.
- **Evidence:** In a small `notes.md` fixture, `bin/roadmap-audit` reports zero scattered TODOs on main and the PR when the literal precedes the checklist. Both report one after removing the example.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/audit/lib/todo-patterns.ts:22`
- **Context:** Filed during /review-and-prep for PR #311.
- **Effort:** ?

### [review:files=skills/references/roadmap/conditional-candidate-validation.md|tests/skill-protocols-roadmap.test.ts] Test gap: Exercise the closure-only roadmap validator

- **ID:** wi-77c617
- **Test gap:** no demonstrated defect
- **Description:** Run the documented closure-only validation recipe against a small draft whose descriptive Future section changed and an archive receipt without an ID. Assert the refusal and the missing-ID report.
- **Hypothesis (untested):** A change to the recipe could miss one of the two findings even while its helper and prompt-text tests pass.
- **Upstream severity:** INFORMATIONAL
- **Found in:** The closure-only branch of `conditional-candidate-validation.md`.
- **Evidence:** The local exact-recipe fixture passed both cases during review.
- **Context:** Revisit when the draft-validation recipe or its Future section boundary changes.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/audit/lib/work-item-id.ts|tests/roadmap-id.test.ts] Simplify the work-item migration parser

- **ID:** wi-3a4422
- **Description:** Reuse parsed Future bullet offsets to mask inline code once, and share TODO entry finalization across section headings.
- **Found in:** `migrateFutureText`, `splitInlineBullet`, `locateInlineId` and `migrateTodosText`.
- **Context:** Revisit when editing the migration parser. Preserve deterministic ID seeds, section boundaries and byte-exact field placement.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/audit/checks/work-item-ids.ts|src/audit/parsers/todos.ts] Improve work-item ID audit diagnostics

- **ID:** wi-2f107b
- **Description:** Give each duplicate record its actual filename and line, include cross-record duplicates involving a second field, and point the migration hint to the installed launcher.
- **Found in:** The `WORK_ITEM_IDS` findings and recovery hint.
- **Context:** Revisit with the next audit-output change. Lock the diagnostic text in fixtures for root and archived planning documents.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/audit/lib/state.ts|src/audit/checks/structure.ts] Point out unclosed fences in planning documents

- **ID:** wi-45d911
- **Description:** Report the line of a Markdown fence that reaches the end of a planning document without a closer. Keep fenced examples outside the record count.
- **Found in:** `planningLines` and the structure checks that use it.
- **Context:** Revisit with the next Markdown diagnostics update. Use a small fixture with an unfinished example before a planning heading.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/audit/id-cli.ts|src/audit/lib/work-item-id.ts] Bound large work-item ID mint requests

- **ID:** wi-8dc6d5
- **Description:** Define a practical request size or bounded-output strategy for `roadmap-id mint --count`. The CLI currently gathers each generated ID before writing the batch.
- **Found in:** `MINT_ID_SPACE` and the mint loop in `id-cli.ts`.
- **Context:** Revisit when consumers ask for bulk generation. Verify that batches still reserve live and historical IDs.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/audit/lib/work-item-id.ts|src/audit/checks/structure.ts] Keep the original metadata diagnosis during ID migration

- **ID:** wi-314a41
- **Description:** For an active card that already has incomplete metadata, keep its missing task or risk detail actionable after migration inserts an ID field.
- **Found in:** Active Track field placement and `STRUCTURE` metadata validation.
- **Context:** Revisit with malformed-card recovery guidance. Exercise a small card whose metadata only reports LOC.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/audit/lib/git.ts|tests/roadmap-id.test.ts] Check historical planning links on case-insensitive filesystems

- **ID:** wi-d0b251
- **Description:** Exercise an old planning-directory link whose target case differs from the tracked path. Verify retirement still reserves the ID after the link moves.
- **Found in:** Literal Git history path selection in `historicalPlanningPaths`.
- **Context:** Revisit when a case-insensitive test runner is available. The source review identified a platform-specific path match.
- **Effort:** ? (user triages in /roadmap)

### [review:files=bin/gstack-extend|tests/init-bin.test.ts] Make starter ID failures clearer during init

- **ID:** wi-4f2b09
- **Description:** Distinguish the minimal-mirror fallback from an incomplete installation and clean up the temporary starter-ID directory on interruption. Report cleanup errors with the selected project path.
- **Found in:** The fresh starter-ID setup and cleanup in gstack-extend init.
- **Context:** Revisit with an init recovery update. Keep the approved dry-run and minimal test mirror behavior.
- **Effort:** ? (user triages in /roadmap)

### [review:files=skills/roadmap.md|docs/source-tag-contract.md] Explain how to assign IDs to legacy inbox bullets

- **ID:** wi-6acd47
- **Description:** Show how to normalize an older standalone inbox bullet into a heading entry and mint its first ID before promotion.
- **Found in:** Roadmap promotion guidance and the TODO_FORMAT finding for legacy bullets.
- **Context:** Revisit with the next consumer migration guidance update. Include a small legacy-bullet example and its resulting heading.
- **Effort:** ? (user triages in /roadmap)

### [review:files=skills/references/roadmap/conditional-candidate-validation.md|tests/skill-protocols-roadmap.test.ts] Test gap: Check the advisory audit for a first inbox draft

- **ID:** wi-d89d99
- **Test gap:** no demonstrated defect
- **Description:** Validate a small proposed TODO draft when the live project has no inbox file. Check advisory location and taxonomy output alongside work-item IDs.
- **Hypothesis (untested):** The first drafted inbox may leave advisory file-existence state describing the live project.
- **Upstream severity:** INFORMATIONAL
- **Found in:** The full-regeneration TODO overlay in `conditional-candidate-validation.md`.
- **Evidence:** The current promotion tests cover replacing an existing inbox and Future satellite.
- **Context:** Revisit when the first-inbox generation path or other audit existence inputs are changed.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/audit/lib/git.ts|tests/roadmap-id.test.ts] Stream the work-item ID history scan

- **ID:** wi-68e7cc
- **Description:** The Git history scan reads patch output into a 64 MiB buffer. The planning-file patch history measured 994,058 bytes during review. As history grows, stream the output while preserving retired ID reservations and clear read errors. The raw link scan measured 330,333 bytes across the docs tree. Limit each path lookup to its link component where practical, and check that caller Git formatting preferences preserve the parsed output.
- **Found in:** `src/audit/lib/git.ts`, `historicalWorkItemIds` and planning-link history.
- **Context:** Filed during review of PR #311.
- **Revisit when:** A project approaches the history buffer limit or a Track changes the work-item history reader.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=src/secret-dispositions/evaluate.ts|tests/secret-dispositions.test.ts] Test gap: Refuse a finding with no matching part

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The matching tests cover one candidate, ambiguous candidates, malformed locations and source-line mismatches. They do not isolate a well-formed finding with zero candidates in an otherwise valid record.
- **Hypothesis (untested):** Extend the evaluator fixture with a finding on an absent path. Check that evaluation stays unsatisfied, reports the path refusal and produces no match.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** `src/secret-dispositions/evaluate.ts`, `evaluate`.
- **Evidence:** The coverage audit traced the candidate check and the existing tests. It demonstrated no runtime failure.
- **Context:** Review of quoted secret finding paths at `925b776` (2026-11-24).
- **Revisit when:** A Track changes finding-path matching or the evaluator fixtures.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=scripts/skill-references.ts|tests/skill-references.test.ts] Test gap: Keep multiple machine-read clauses from one move

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The manifest and its fixture each carry one clause and pointer pair. They leave a future change that processes only the first pair undetected.
- **Hypothesis (untested):** Extend the conservation fixture with two distinct pairs and assert that both clauses stay in core and both pointers appear in the reference.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** `scripts/skill-references.ts`, `extractManifestSlice`.
- **Evidence:** The coverage audit traced the loop and the passing single-pair fixture.
- **Context:** Review of the delegate clause restoration at `d30f79e` (2026-11-24).
- **Revisit when:** A Track adds a second clause to a reference move or changes clause extraction.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=skills/review-and-prep.md|tests/skill-references.test.ts] Test gap: Pin the first delegate grammar marker

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** A caller can read from the first delegate grammar marker to its closing parenthesis. Finding one exact clause still passes if an earlier marker points to different text.
- **Hypothesis (untested):** Assert that the first marker in the core skill starts the exact historical clause, then verify that an earlier lookalike fails the assertion.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** `skills/review-and-prep.md`, **Read an optional review policy**.
- **Evidence:** The consumer probe reads both conditional parts on the reviewed candidate. The permanent lock checks the clause's bytes and count.
- **Context:** Review of the delegate clause restoration at `d30f79e` (2026-11-24).
- **Revisit when:** A Track changes the delegation grammar or how it is generated in core.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=skills/review-and-prep.md|skills/references/review-and-prep/conditional-policy-values.md] Test gap: Exercise the delegate policy on installed hosts

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The setup fixtures verify the skill bytes and reference reads. They leave actual policy interpretation on both installed hosts unobserved.
- **Hypothesis (untested):** On Codex and Claude Code, use an isolated delegate fixture to observe the selected parts, host fallback, conflicting policy status and suite route.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** `skills/review-and-prep.md` and `conditional-policy-values.md`.
- **Evidence:** Both generated host copies carry the clause. Static policy checks passed, and no live host failure was shown.
- **Context:** Review of the delegate clause restoration at `d30f79e` (2026-11-24).
- **Revisit when:** A Track changes delegate policy execution or qualifies the installed workflow on either host.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: Cover the Antigravity model tail boundary

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The launch fixture covers the opening-line size limit. Model selection reads a separate 8 MiB tail and discards a line cut by the seek.
- **Hypothesis (untested):** Extend the provenance fixture with a transcript that exceeds the tail limit and assert that only complete planner rows inside the read can determine the model.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** `bin/lib/telemetry.py`, `antigravity_turns`.
- **Evidence:** The coverage audit traced the bounded read and the existing fixture inputs.
- **Context:** Antigravity telemetry review at `1641c42` (2026-11-24).
- **Revisit when:** A Track changes the Antigravity model reader or its fixtures.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: Skip invalid Antigravity planner rows

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The provenance fixtures exercise valid planner responses. The malformed opening-line case exercises launch classification.
- **Hypothesis (untested):** Combine a valid planner response with invalid JSON, an invalid timestamp and an invalid model in a synthetic tail. Check that the valid response determines the model.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** `bin/lib/telemetry.py`, `antigravity_turns`.
- **Evidence:** The coverage audit compared the model parser branches with the planner fixtures.
- **Context:** Antigravity telemetry review at `1641c42` (2026-11-24).
- **Revisit when:** A Track changes Antigravity provenance parsing.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: Check explicit Antigravity discovery roots

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The audit hook checks successful discovery. The existing finish fixtures exercise the live readers for missing, linked and nonregular logs.
- **Hypothesis (untested):** Check that an explicit discovery root takes precedence over an inherited override and that discovery returns an empty list after refusing a candidate.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** `bin/lib/telemetry.py`, `antigravity_logs`.
- **Evidence:** The coverage audit traced the helper's explicit-root path and its audit-hook caller.
- **Context:** Antigravity telemetry review at `1641c42` (2026-11-24).
- **Revisit when:** A Track changes Antigravity resolver inputs or discovery.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=tests/helpers/telemetry-env.ts|tests/telemetry.test.ts] Test gap: Pin the Antigravity resolver inventory

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The test guard registers `ANTIGRAVITY_APP_DATA_DIR`. The fixture checks do not assert that this variable appears by name in the inherited resolver inventory.
- **Hypothesis (untested):** Run the guard with an isolated synthetic override and require the inventory to include the variable name while omitting its value.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** `tests/helpers/telemetry-env.ts`, `OTHER_RESOLVER_VARS`.
- **Evidence:** The coverage audit traced the registered variable through the snapshot inventory.
- **Context:** Antigravity telemetry review at `1641c42` (2026-11-24).
- **Revisit when:** A Track changes the telemetry fixture guard or its resolver inventory.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=skills/review-and-prep.md|skills/references/review-and-prep/conditional-pregate-and-final-repair.md] Test gap: Exercise narrowed pregate after a matching external pass

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The anchor and command tests verify the text that enables narrowing. They leave execution with a matching external pass and covered test lanes unverified.
- **Hypothesis (untested):** With a disposable candidate and an accepted full-suite result, verify that qualified anchors select `pregate-preflight` and that the receipt names the omitted lanes.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** `skills/review-and-prep.md`, **Narrow the pregate after an accepted pass**.
- **Evidence:** The Track 96A coverage audit traced the protocol tests and live anchor outputs. No failed workflow execution was observed.
- **Context:** Track 96A review at `73aa356` (2026-11-24).
- **Revisit when:** A Track changes pregate narrowing or qualifies this workflow on an installed host.
- **Effort:** ? (user triages in `/roadmap`)

### [review:files=skills/review-and-prep.md|skills/references/review-and-prep/conditional-pregate-and-final-repair.md] Test gap: Exercise ordinary pregate when a narrowing anchor fails

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** CLI fixtures cover anchor drift and its reported effect. They leave the workflow's exact-once check and ordinary pregate fallback unverified after a matching external pass.
- **Hypothesis (untested):** In isolated fixtures with an otherwise eligible external pass, try the prior registry text, an absent anchor and a duplicate anchor. Verify the inactive receipt and ordinary pregate command for each case.
- **Upstream severity:** INFORMATIONAL.
- **Found in:** `skills/review-and-prep.md`, **Activation (narrowed pregate)**.
- **Evidence:** The Track 96A coverage audit traced the CLI fallback diagnostics and the workflow instructions. No failed fallback execution was observed.
- **Context:** Track 96A review at `73aa356` (2026-11-24).
- **Revisit when:** A Track changes the narrowing anchor rules or adds a workflow fixture for external passes.
- **Effort:** ? (user triages in `/roadmap`)

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
