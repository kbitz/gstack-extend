# TODOS

## Unprocessed

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: requested telemetry lifecycle and mixed-field variants
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Direct cases do not vary requested values between start and first finish or after a saved failed finish, combine requests with a different valid `--agent`, or cover requested model with independently detected/flagged effort.
- **Hypothesis (untested):** Extend existing provenance and retry fixtures to check finish-time sampling, immutable saved rows, agent reset before fallback, and reverse mixed-field precedence. Re-verify behavior before adding cases.
- **Upstream severity:** INFORMATIONAL
- **Found in:** bin/lib/telemetry.py:1973; tests/telemetry.test.ts:6119
- **Evidence:** Track 66B outside structured review and coverage audit (12 of 16 behavior paths covered). Source and existing tests inspected; no failure reproduced. Existing preservation tests remain unchanged; these combinations were not required new tests in the approved plan.
- **Context:** /review-and-prep, branch mmm/97a7264a at ee52a8c, 2026-11-05; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=tests/skill-protocols.test.ts|tests/update.test.ts] Test gap: spawned-skip wording and update-check state notes
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** No assertion pins the shared upgrade flow's sentence that the guard's `UPGRADE_SKIPPED spawned-session` line is not `bin/update-run` output, or the installation guide's clauses about `bin/update-check` consuming the just-upgraded marker. The twelve copies stay byte-identical, so the sentences could be removed from all of them at once without a failing test.
- **Hypothesis (untested):** Add `toContain` checks for both sentences next to the existing spawned-session ordering lock and the installation-guide lock; re-verify the wording first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** tests/skill-protocols.test.ts:733 and tests/update.test.ts:276
- **Evidence:** Track 66A /review-and-prep cycle 3 native adversarial pass; both sentences read in place, the lock suites inspected, no failure reproduced.
- **Context:** /review-and-prep, branch mmm/6598a207 at 0b75aa1, 2026-11-04; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=tests/skill-protocols.test.ts] Test gap: update-check trigger lines, notice placement and output echo
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Three text paths around the shared upgrade flow have no lock of their own. The `If output shows UPGRADE_AVAILABLE` and `If JUST_UPGRADED` lines that send eight skills into the flow are not asserted per skill. The spawned branch's placement clause (before any fenced prompt, never inside a fence or a versioned receipt field) is not pinned. No test shows `bin/update-check` output reaching stdout through the preamble's `echo "$_UPD"` line; only the verbatim tail lock covers it.
- **Hypothesis (untested):** Loop over the skills that run update-check and assert both trigger lines precede `<!-- SHARED:upgrade-flow -->`; add the placement clause to the spawned-paragraph assertions; have the Track 16D stub print `UPGRADE_AVAILABLE 1.0.0 2.0.0` and assert it reaches stdout. Re-verify the wording first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** tests/skill-protocols.test.ts (Track 10A and Track 16D describes)
- **Evidence:** Track 66A /review-and-prep coverage audit (audit-only, 86% value-weighted); 580 tests run green, no failure reproduced.
- **Context:** /review-and-prep, branch mmm/6598a207 at 697f811, 2026-11-04; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=skills/gstack-extend-upgrade.md|skills/project-spec.md|bin/update-run] Decide whether an interactive upgrade at stage start should wait until the stage ends

- **Description:** Track 66A runs the shared upgrade flow at the start of all twelve skills. An interactive stage that upgrades there (an answered question, or `auto_upgrade=true`) keeps the skill text it already loaded but calls helpers and reads docs from the upgraded checkout for the rest of the run, so a release that changes a helper's output (`docs-ship`, `secret-dispositions`, `outside-review`) can be misread mid-stage. `/project-spec` already defers `/roadmap`'s upgrade until composition finishes, but its own start-of-run flow can now upgrade before composition.
- **Hypothesis (untested):** After `UPGRADE_OK` in a workflow stage, either stop and ask for a fresh invocation, or defer the upgrade until the stage's final message, as `/project-spec` does for `/roadmap`.
- **Effort:** ? (user triages in /roadmap)
- **Context:** Native adversarial and Red Team findings during /review-and-prep of Track 66A, 2026-11-04. The approved plan keeps interactive behavior unchanged in every skill (criteria 2 and 3), so changing when an interactive upgrade happens was out of scope.
- **Revisit when:** A release changes the output format of a helper that stage skills read, or a user reports a stage failing right after an upgrade at its start.

### [review:files=src/pregate-deps/cli.ts|tests/pregate-deps.test.ts] Test gap: CLI option combinations
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Equivalent root spellings, duplicate roots, short help, and check/prune precedence lack dedicated cases.
- **Hypothesis (untested):** Extend existing fixture cases at the public boundary with the audit proposal; re-verify the behavior first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/pregate-deps/cli.ts:85:optional-flag-combinations
- **Evidence:** Coverage audit G01; source and existing tests inspected, no failure reproduced.
- **Context:** /review-and-prep, branch mmm/ea9b305e at 27ad120, 2026-11-04; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=src/pregate-deps/cli.ts|tests/pregate-deps.test.ts] Test gap: Root and policy file kinds
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Root files, root symlinks, and a policy directory lack boundary cases; escaping policy symlinks are already covered.
- **Hypothesis (untested):** Extend existing fixture cases at the public boundary with the audit proposal; re-verify the behavior first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/pregate-deps/cli.ts:172:root-and-config-file-kinds
- **Evidence:** Coverage audit G02; source and existing tests inspected, no failure reproduced.
- **Context:** /review-and-prep, branch mmm/ea9b305e at 27ad120, 2026-11-04; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=src/pregate-deps/cli.ts|tests/pregate-deps.test.ts] Test gap: Nested dependency shapes
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Nested null, array, scalar and mixed-type dependency values lack dedicated refusal cases; top-level nonobject and non-array values are tested.
- **Hypothesis (untested):** Extend existing fixture cases at the public boundary with the audit proposal; re-verify the behavior first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/pregate-deps/cli.ts:207:nested-dependency-shapes
- **Evidence:** Coverage audit G03; source and existing tests inspected, no failure reproduced.
- **Context:** /review-and-prep, branch mmm/ea9b305e at 27ad120, 2026-11-04; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=src/pregate-deps/graph.ts|tests/pregate-deps.test.ts] Test gap: Python reader filter boundaries
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Per-file size, type, symlink and Git-redirection filters lack direct cases; global ignores are tested.
- **Hypothesis (untested):** Extend existing fixture cases at the public boundary with the audit proposal; re-verify the behavior first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/pregate-deps/graph.ts:199:reader-filter-boundaries
- **Evidence:** Coverage audit G04; source and existing tests inspected, no failure reproduced.
- **Context:** /review-and-prep, branch mmm/ea9b305e at 27ad120, 2026-11-04; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=src/pregate-deps/graph.ts|tests/pregate-deps.test.ts] Test gap: Cyclic and terminal import closure
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Self/cyclic imports and test-to-test traversal lack direct cases; helper transitivity is tested.
- **Hypothesis (untested):** Extend existing fixture cases at the public boundary with the audit proposal; re-verify the behavior first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/pregate-deps/graph.ts:133:cyclic-and-terminal-closure
- **Evidence:** Coverage audit G06; source and existing tests inspected, no failure reproduced.
- **Context:** /review-and-prep, branch mmm/ea9b305e at 27ad120, 2026-11-04; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=src/pregate-deps/graph.ts|src/pregate-deps/cli.ts|tests/pregate-deps.test.ts] Test gap: Empty Python source closure
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Empty source sets lack a dedicated check/write/prune lifecycle case; orphan omission in populated graphs is tested.
- **Hypothesis (untested):** Extend existing fixture cases at the public boundary with the audit proposal; re-verify the behavior first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/pregate-deps/graph.ts:123:empty-source-closure
- **Evidence:** Coverage audit G07; source and existing tests inspected, no failure reproduced.
- **Context:** /review-and-prep, branch mmm/ea9b305e at 27ad120, 2026-11-04; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=src/pregate-deps/cli.ts|tests/pregate-deps.test.ts] Test gap: Dependency value length boundaries
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Test-path value lengths at 256 and 257 lack direct cases; key length and entry-count refusals are tested.
- **Hypothesis (untested):** Extend existing fixture cases at the public boundary with the audit proposal; re-verify the behavior first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/pregate-deps/cli.ts:266:test-path-length-limit
- **Evidence:** Coverage audit G08; source and existing tests inspected, no failure reproduced.
- **Context:** /review-and-prep, branch mmm/ea9b305e at 27ad120, 2026-11-04; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=src/pregate-deps/cli.ts|tests/pregate-deps.test.ts] Test gap: Kept dependency collisions
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** An imported module colliding with an unowned empty declaration and source-root test-file keys lack direct cases.
- **Hypothesis (untested):** Extend existing fixture cases at the public boundary with the audit proposal; re-verify the behavior first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/pregate-deps/cli.ts:243:kept-entry-precedence
- **Evidence:** Coverage audit G09; source and existing tests inspected, no failure reproduced.
- **Context:** /review-and-prep, branch mmm/ea9b305e at 27ad120, 2026-11-04; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=src/pregate-deps/cli.ts|tests/pregate-deps.test.ts] Test gap: Ordinary filesystem error output
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Ordinary caught I/O failures lack a direct ERROR/FIX and cleanup assertion; partial-write preservation is tested.
- **Hypothesis (untested):** Extend existing fixture cases at the public boundary with the audit proposal; re-verify the behavior first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** src/pregate-deps/cli.ts:345:internal-error-contract
- **Evidence:** Coverage audit G10; source and existing tests inspected, no failure reproduced.
- **Context:** /review-and-prep, branch mmm/ea9b305e at 27ad120, 2026-11-04; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=tests/helpers/touchfiles.ts|tests/pregate-deps.test.ts] Test gap: Pregate helper selection edges
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Generic reachability and sync invariants do not independently pin all four new manual selection edges.
- **Hypothesis (untested):** Extend existing fixture cases at the public boundary with the audit proposal; re-verify the behavior first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** tests/helpers/touchfiles.ts:104:pregate-deps-selection-edges
- **Evidence:** Coverage audit W01; source and existing tests inspected, no failure reproduced.
- **Context:** /review-and-prep, branch mmm/ea9b305e at 27ad120, 2026-11-04; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches these files.

### [review:files=CLAUDE.md] Test gap: working-rule agent scenarios
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Reader suites preserve existing contracts but do not exercise the new priority reporting, README-only handoff, judgment/mechanics boundary, two-host storage, timeout diagnosis or near-full pregate selection instructions.
- **Hypothesis (untested):** Evaluate these six agent scenarios against their observable outcomes; string-presence tests would only mirror the prose. Re-verify first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** CLAUDE.md, Product scope and releases / Design / Testing
- **Evidence:** Coverage audit read the diff and reader assertions; no executable regression was demonstrated.
- **Context:** /review-and-prep on branch mmm/e3debc6c at 57983ef, 2026-11-04; PR pending.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The next Track touches CLAUDE.md working rules.

### [review:files=bin/lib/telemetry.py|bin/lib/telemetry-doctor.py] Guard resumable telemetry adoption against stale and in-progress handoffs

- **Description:** A start-less finish of a resumable skill adopts any open handoff of that skill in its root, at any age and from any session. Since paused runs finish their segment `blocked`, a continuation whose agent skips its restart has no handoff of its own, so its finish takes an older abandoned start's `session_id`, `started_at` and saved `work_item` (or writes nothing). A start-less retry of a failed `blocked` finish can likewise land on the newer resumed segment. The doctor files every unmatched resumable start as a deferred finish, so neither case is visible. The skill prose now says to restart; nothing in code enforces it.
- **Hypothesis (untested):** Record the newest `blocked` completion per root, skill and harness fingerprint, and refuse a cross-session resumable candidate whose start predates it, with a debug line naming the missed restart; give the doctor a count for it.
- **Effort:** M
- **Priority:** P2
- **Context:** Native adversarial and Red Team findings during /review-and-prep of Track 65A ("Record paused, blocked and resumed runs"), 2026-11-04; reproduced with the real wrapper under an isolated HOME. The plan kept unbounded resumable adoption as the documented fallback, so the guard was deferred rather than built in that PR.
- **Revisit when:** The Future cards "Recover a telemetry finish run from a different repository root" or "In-flight marker and crash detection for extend telemetry" are planned, or a stage-runs row shows a resumable segment whose `started_at` predates its root's previous `blocked` finish.

### [review:files=skills/pair-review.md|skills/full-review.md|docs/telemetry.md] Tighten the status-check telemetry wording

- **Description:** `/pair-review status` and `/full-review status` finish `--outcome unknown` and say the paired start "is the one Telemetry start runs when this skill begins". Read literally inside an ongoing conversation, that names the skill's earlier start, so a STATUS action that ran no start of its own would still finish and take the live run's handoff. Separately, `docs/telemetry.md` "Bounds that remain" says the run's own finish "then writes nothing" in that reverse case, but it adopts another open handoff of that skill when one exists.
- **Hypothesis (untested):** Tie the start to the status invocation ("the one this `/pair-review status` invocation ran when it began; a STATUS action later in a conversation runs no start and skips this finish") and reuse the Segments bullet's "adopts another open handoff … or writes nothing when none is open" wording in the bound.
- **Effort:** S
- **Priority:** P3
- **Context:** Native adversarial findings in the last delta pass of /review-and-prep for Track 65A, 2026-11-04. Deferred under the stop rule for prose review tails; both affect only how an optional local telemetry row pairs.
- **Revisit when:** The next edit of either skill's status path, or when the wrapper adoption guard above is planned (it is the code fix for this pairing class).

### [review:files=docs/telemetry.md|skills/review-and-prep.md] Name the telemetry outcome for BLOCKED and NEEDS_CONTEXT exits that are not pauses

- **Description:** The shared finish block defines `blocked` as a deliberate pause that a later resume continues, and the join contract says other BLOCKED or NEEDS_CONTEXT exits "keep their actual outcome" without naming it. Some BLOCKED exits (for example `/review-and-prep`'s provider-failure stop) also end with a resume line, so agents may record `blocked` for them and consumers can no longer read `blocked` as a deliberate pause only.
- **Hypothesis (untested):** The owner picks one mapping (for example `error` for a non-pause BLOCKED exit, `unknown` for NEEDS_CONTEXT), states it once in the shared finish line and the join contract, and locks it.
- **Effort:** S
- **Priority:** P3
- **Context:** Native adversarial finding in the full re-review of Track 65A, 2026-11-04; needs an owner decision, so it was deferred rather than decided in that PR.
- **Revisit when:** The next change to the shared telemetry finish block, or the first consumer report that relies on `blocked` meaning a deliberate pause.

### [review:files=skills/full-review.md] full-review maps "stop for now" to DONE TRIAGING, which rejects the remaining clusters

- **Description:** `/full-review`'s conversational list routes "stop" to DONE TRIAGING ("Done triaging — reject remaining"), so a user who types "stop for now" meaning a pause loses the untriaged clusters' decisions. The new PAUSE route deliberately avoided overlapping words; `/pair-review` maps "stop for now" and "continue later" to PAUSE, so the two skills now differ.
- **Effort:** S
- **Priority:** P3
- **Context:** Native adversarial finding during /review-and-prep of Track 65A, 2026-11-04. Pre-existing: the same "stop" route is on `main`.
- **Revisit when:** The next edit of `/full-review`'s Conversational Interface.

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
