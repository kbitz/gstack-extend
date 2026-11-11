# TODOS

## Unprocessed

### [review:files=docs/designs/review-run-state.md] File the review-run-state SPEC anchor correction for the next design edit

- **Description:** The documentation audit found the opening link targets the prior O6 heading anchor. The current SPEC heading is O6: Bounded, measured stage effort. This source-pointer issue does not alter the documented helper behavior or D9 wire derivations.
- **Classification:** non-blocking and filed; owner convergence approval "Approved". Leave the design unchanged in this continuation.
- **Source severity:** Low / documentation audit.
- **Context:** PR #238, initial documentation audit on cb15aff.
- **Revisit when:** The next edit to docs/designs/review-run-state.md, or Track 77B adoption.

### [review:files=docs/designs/review-run-state.md] File the D9 status-vocabulary source-heading correction

- **Description:** D9 cites a PR body status vocabulary heading that no longer exists. The vocabulary currently lives under Receipt layout and kept marker set in docs/workflow-handoffs.md. The derivation bytes were verified; only the source locator is stale.
- **Classification:** non-blocking and filed; owner convergence approval "Approved". Leave the design unchanged in this continuation.
- **Source severity:** Low / documentation audit.
- **Context:** PR #238, initial documentation audit on cb15aff.
- **Revisit when:** Track 78A consumes D9, or that producer section is renamed.


### [review:files=src/review-state/state.ts] Pass completion remains a recording fact until renderers enforce review coverage

- **Description:** Carried review suggested refusing incomplete required-voice closure. D1/D5 assign workflow judgment to skill prose and D13 deliberately allows recording completed passes without voice selection; no current recorder contract is broken.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** INFORMATIONAL (original red-team and native adversarial notes)
- **Context:** PR #238 repair-only continuation; carried: incomplete pass closure / explicit N-A selection.
- **Revisit when:** Track 78A starts rendering readiness or a skill begins treating a completed recorded pass as sufficient review coverage.

### [review:files=src/review-state/state.ts] Clarify composite replay identity and global attempt-ID uniqueness before export

- **Description:** Carried review contrasted composite pass/voice/attempt replay keys with global uniqueness refusal. Different composite keys are distinct requests; no immutable replay defect remains. Keep the distinction explicit when a caller is written.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** Original label not present in the compact carried disposition; original review artifacts retained; no severity inferred
- **Context:** PR #238 repair-only continuation; carried: reused attempt ID under another voice/pass.
- **Revisit when:** Track 77B projects attempts to workflow metrics or a real caller needs to reuse an attempt UUID across voices.

### [review:files=docs/designs/review-run-state.md] Define rendered-line handling for Unicode separators

- **Description:** Carried review raised C1/Unicode line separators. D7 currently forbids C0 and DEL, and this Track ships no receipt renderer; no forged output is produced by this helper.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** INFORMATIONAL (original red-team note)
- **Context:** PR #238 repair-only continuation; carried: C1 / Unicode line separators.
- **Revisit when:** Track 78A writes the first receipt/handoff renderer.

### [review:files=src/review-state/store.ts] Revisit evidence-root exclusions when a skill chooses directories

- **Description:** Carried review proposed excluding ancestor and sibling worktree roots in addition to D2's current-worktree exclusion. The skill currently owns selecting a dedicated per-invocation directory; stricter exclusions change that location contract.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** INFORMATIONAL (original red-team note)
- **Context:** PR #238 repair-only continuation; carried: ancestor/sibling evidence directory.
- **Revisit when:** Track 77B selects the first live run directory, or a real run places state in an ancestor or sibling checkout.

### [review:files=src/review-state/store.ts] Revisit isolated Git account configuration for trusted repositories

- **Description:** Carried review noted global/system Git configuration is disabled. D2 now discloses this experimental limitation; no supported local-owner run requiring safe.directory was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** INFORMATIONAL (original red-team and native adversarial notes)
- **Context:** PR #238 repair-only continuation; carried: global Git config.
- **Revisit when:** A real intended-user repository requires account-level safe.directory configuration, or helper adoption in Track 77B expands that support contract.

### [review:files=src/review-state/store.ts] Distinguish Git execution failures from invalid commit input at adoption

- **Description:** The carried red-team note concerns existing timeout, spawn and signal failures being reported as commit-not-found or not-ancestor, plus inaccessible-input diagnostics. Git calls already have a five-second timeout; D14 defers an internal-error envelope. No incorrect successful record or data loss was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** INFORMATIONAL (original red-team note)
- **Context:** PR #238 repair-only continuation; carried: Git timeouts and input diagnostics.
- **Revisit when:** Track 77B writes a caller that must distinguish transient Git execution errors from invalid input, or a real run needs structured internal-error recovery.

### [review:files=src/review-state/store.ts] Define dot-suffixed directory symlink policy

- **Description:** Outside challenge P2/Low and structured P3/Low noted --dir /link/. resolves through link. D2 permits symlinked ancestors and the literal final component here is dot; realpath confinement remains enforced. Clarify the intended normalization boundary before changing accepted paths.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** P2/Low (outside challenge); P3/Low (outside structured); INFORMATIONAL confidence5 (red-team); CRITICAL confidence7 (native-adversarial)
- **Context:** PR #238 repair-only continuation; outside:challenge / outside:structured; red-team INFORMATIONAL confidence5; native-adversarial CRITICAL confidence7.
- **Revisit when:** Track 77B adopts the helper, or a real caller supplies dot-suffixed evidence paths.

### [review:files=src/review-state/store.ts] Choose stable supplied-versus-resolved state-path spelling for callers

- **Description:** Outside challenge P3/Low noted early refusals use the supplied state path and later outcomes use the real path. No existing caller or D8 requirement compares these spellings; rendering/adoption is deferred.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** P3/Low (outside challenge); INFORMATIONAL confidence3 (native-adversarial)
- **Context:** PR #238 repair-only continuation; outside:challenge; native-adversarial INFORMATIONAL confidence3.
- **Revisit when:** Track 77B writes a caller that consumes state_path, especially with a symlinked home or ancestor directory.

### [review:files=src/review-state/state.ts] Extend stored-state lifecycle consistency checks before foreign-state support

- **Description:** Outside challenge P3/Low noted manually inconsistent pass state and completion timestamps can satisfy independent field types. D3 currently promises keys, types and internal references; no helper-produced inconsistent state was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** P3/Low (outside challenge); INFORMATIONAL confidence6 (red-team); CRITICAL confidence5 (native-adversarial)
- **Context:** PR #238 repair-only continuation; outside:challenge; red-team INFORMATIONAL confidence6; native-adversarial CRITICAL confidence5.
- **Revisit when:** Track 77B adds compatibility or another writer, or Track 79A supports recovering edited/corrupt state.

### [review:files=tests/review-state.test.ts] Strengthen explicit correction replay binding assertions when fixtures change

- **Description:** Outside challenge P3/Low flagged nullish fallbacks in the correction head/tree assertion. Existing tests change Git binding and the reader requires these fields; no missed current defect or unmet plan-required test was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** P3/Low (outside challenge)
- **Context:** PR #238 repair-only continuation; outside:challenge.
- **Revisit when:** The correction fixture or replay binding changes next, or a demonstrated regression survives the current test.

### [review:files=tests/review-state.test.ts] Exercise writer-to-reader boundary parity beyond current cases

- **Description:** Outside structured P3/Low could not demonstrate a writer/reader mismatch at PR strings, required voices, attribution, coverage thresholds or Greptile values. Challenge also suggested string thresholds, nonempty skipped lanes and model-label edges; keep these as unproven coverage work.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** P3/Low (outside structured); INFORMATIONAL confidence6 (red-team); CRITICAL confidence5 (native-adversarial)
- **Context:** PR #238 repair-only continuation; outside:structured / outside:challenge residual coverage note; red-team INFORMATIONAL confidence6; native-adversarial CRITICAL confidence5.
- **Revisit when:** Track 77B adds a caller or schema compatibility, or a real boundary input produces an unreadable helper-written state.

### [review:files=tests/review-state.test.ts] Keep Git-binding test fixtures independent of account identity

- **Description:** Outside structured P3/Low questioned whether makeEmptyRepo configures repository-local identity; tests/helpers/fixture-repo.ts does so. No current fixture failure is demonstrated. Retain the concern only for future fixture-helper changes.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** P3/Low (outside structured)
- **Context:** PR #238 repair-only continuation; outside:structured.
- **Revisit when:** makeEmptyRepo or Git-binding subprocess setup stops providing repository-local user.name/user.email.

### [review:files=src/review-state/store.ts] Make evidence-cache misses explicit when collectors evolve

- **Description:** The red team raised a fail-open cache-miss hypothesis. Current request validators and collectors use relative paths and exact hashes consistently; no unverified current record was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** red-team INFORMATIONAL confidence4; native-adversarial INFORMATIONAL confidence3
- **Context:** PR #238 repair-only continuation; red-team INFORMATIONAL confidence4; native-adversarial INFORMATIONAL confidence3.
- **Revisit when:** Track 77B changes canonicalization/evidence collection, or a real accepted record lacks a verified evidence pair.

### [review:files=src/review-state/state.ts] Preserve source JSON-path diagnostics for merged detail evidence

- **Description:** The red team inferred that merging detail references with the evidence array can produce synthetic indexes in a refusal. Current refusals still reject invalid evidence and preserve bytes; no incorrect successful record was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** red-team INFORMATIONAL confidence5
- **Context:** PR #238 repair-only continuation; red-team INFORMATIONAL confidence5.
- **Revisit when:** Pinned evidence diagnostics or the details collector changes next, or a real caller cannot identify a failed detail pin.

### [review:files=tests/review-state.test.ts] Assert that the pinned-tree fixture actually advances HEAD

- **Description:** The red team noted the no-wait fixture does not separately assert advance() ran. Current code does execute the injected advance; this is a future regression-detection weakness, not a demonstrated current defect or a missing plan-required test.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** red-team INFORMATIONAL confidence7
- **Context:** PR #238 repair-only continuation; red-team INFORMATIONAL confidence7.
- **Revisit when:** runGit changes process API/argv shape or the Git binding fixture is edited.

### [review:files=src/review-state/state.ts] Check stored-reader narrowing when adding a TypeScript compile gate

- **Description:** The adversarial voice reported a possible strict TypeScript closure-narrowing error at d.parts.includes. Bun runs this code, the repo has no typecheck script/dependency/gate, and the approved plan requires Bun tests; no currently required check fails.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** native-adversarial CRITICAL confidence4 (fixability label; owner non-blocking)
- **Context:** PR #238 repair-only continuation; native-adversarial CRITICAL confidence4 (fixability label; owner non-blocking).
- **Revisit when:** Track 77B imports this reader into compiled TypeScript, or the project adopts a strict typecheck gate.

### [review:files=src/review-state/store.ts] Revisit branch and commit sampling under concurrent checkout changes

- **Description:** The adversarial voice raised a branch-switch race between symbolic-ref and HEAD reads. The repaired contract pins a captured commit/tree after lock wait; no intended-use failure under concurrent workspace branch switching was demonstrated.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** native-adversarial CRITICAL confidence3 (unshown race hypothesis)
- **Context:** PR #238 repair-only continuation; native-adversarial CRITICAL confidence3 (unshown race hypothesis).
- **Revisit when:** A live caller permits concurrent checkout/branch changes, or a real run records mismatched branch/head.

### [review:files=src/review-state/state.ts] Define schema compatibility before the first skill adopts the helper

- **Description:** The adversarial voice noted required additive fields retain the v1 schema name. This helper is new on an unreleased feature branch and no skill calls it; D14 explicitly assigns cross-version compatibility to Track 77B. Do not add a migration in Track 76B.
- **Classification:** non-blocking and filed; owner approval "Approved" applies to the convergence rule. No repair in this continuation.
- **Source severity:** native-adversarial INFORMATIONAL confidence5
- **Context:** PR #238 repair-only continuation; native-adversarial INFORMATIONAL confidence5.
- **Revisit when:** Track 77B ships the first caller or a subsequent release must read state from an earlier adopted helper.


### [review:files=src/review-state/cli.ts|tests/review-state.test.ts] Test gap: CLI flag refusals and error envelopes
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Duplicate and missing-value flags, plus exact one-line JSON, two-line stderr and exit-code agreement.
- **Hypothesis (untested):** Extend existing CLI rejection cases using otherwise valid input and exact stream/exit assertions. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/cli.ts:57`
- **Evidence:** Read-only coverage audit on `cecc16b`; no failure reproduced for this gap. The six gaps are separate from the repaired, demonstrated canonicalization defect.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `cecc16b`, before the draft's cycle-cap receipt.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** CLI parsing or error-envelope behavior changes, or Track 77B begins calling the helper.


### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: Attempt and finding semantic refusals
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Validly typed but inconsistent predecessor, duplicate finding/attempt, part, delegate outcome and attribution combinations.
- **Hypothesis (untested):** Add table rows that break one relationship guard while every shape and parent reference remains valid. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/state.ts:407`
- **Evidence:** Read-only coverage audit on `cecc16b`; no failure reproduced for this gap. The six gaps are separate from the repaired, demonstrated canonicalization defect.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `cecc16b`, before the draft's cycle-cap receipt.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** Attempt schemas, attribution or delegation wiring changes.


### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: Voice selection semantic refusals
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Both/neither completion selectors and selection of a missing or failed attempt.
- **Hypothesis (untested):** Extend the existing voice fixture with one invalid selector/reference per row. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/state.ts:485`
- **Evidence:** Read-only coverage audit on `cecc16b`; no failure reproduced for this gap. The six gaps are separate from the repaired, demonstrated canonicalization defect.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `cecc16b`, before the draft's cycle-cap receipt.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** Voice completion or selected-attempt handling changes.


### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: Correction chain semantic refusals
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Missing finding targets, stale supersedes, invalid effective adjudication/resolution and a missing fixed_in commit.
- **Hypothesis (untested):** Reuse the populated correction fixture and assert caller refusal plus unchanged bytes for each case. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/state.ts:522`
- **Evidence:** Read-only coverage audit on `cecc16b`; no failure reproduced for this gap. The six gaps are separate from the repaired, demonstrated canonicalization defect.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `cecc16b`, before the draft's cycle-cap receipt.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** Correction targeting, supersedes or effective-state handling changes.


### [review:files=src/review-state/state.ts|tests/review-state.test.ts] Test gap: Finish ancestry and checkpoint field refusals
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Nonancestor finish base, missing delta/full-review commit, resume on an open run and a non-resume checkpoint carrying session_id.
- **Hypothesis (untested):** Use isolated Git histories and table-driven checkpoint/finish requests, asserting the specific violation. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/state.ts:623`
- **Evidence:** Read-only coverage audit on `cecc16b`; no failure reproduced for this gap. The six gaps are separate from the repaired, demonstrated canonicalization defect.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `cecc16b`, before the draft's cycle-cap receipt.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** Track 79A resume/finish integration begins, or checkpoint/finish validation changes.


### [review:files=src/review-state/store.ts|tests/review-state.test.ts] Test gap: Temporary-state and postcommit failure handling
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** Temporary write/fsync/rename failures and lock-removal failure after the rename commit point; existing tests inject lock initialization failure only.
- **Hypothesis (untested):** Extend isolated subprocess fault injection: precommit failures preserve old bytes and clean owned files; postcommit unlink failure reports recorded with warnings. Re-verify the current contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/store.ts:150`
- **Evidence:** Read-only coverage audit on `cecc16b`; no failure reproduced for this gap. The six gaps are separate from the repaired, demonstrated canonicalization defect.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `cecc16b`, before the draft's cycle-cap receipt.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** A live caller depends on recorder recovery, or temporary commit/cleanup handling changes.

### [review:files=tests/quota_cases.py|bin/lib/quota/index.py|bin/lib/quota/cli.py] Test gap: Exercise a complete pre-upgrade native SDK store
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The legacy route test seeds native source and usage facts and finishes with the current code. It does not seed a fully persisted historical run, receipt and file checkpoint with the old source key and root metadata.
- **Hypothesis (untested):** Prepare a finished store using the old reader, then query it after upgrade with the retired files unreadable. Compare the route and token totals and verify no retired-file rescan. Re-verify the contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/quota_cases.py:1291`
- **Evidence:** Outside reviews and coverage audit source reads; the current legacy-readback test and selected suites pass, and no product defect was reproduced. The approved T2 fixture is complete; this is additional hardening.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `088b064`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=bin/lib/quota/index.py|tests/quota_cases.py] Test gap: Ignore retired NDJSON filenames inside active roots
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The retirement test plants the old SDK directory outside supported roots. It does not separately put a `runs.ndjson` file beside a supported JSONL log inside an active root.
- **Hypothesis (untested):** Extend the existing fixture with both files and assert that only the supported log is indexed. Re-verify the discovery contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/quota/index.py:54`
- **Evidence:** Coverage audit path 05; source inspection confirms the filename clause was removed, existing discovery tests pass, and no failure was reproduced.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `088b064`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=tests/skill-protocols.test.ts] Test gap: Exercise the remaining removed-host detector branches
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The removal lock has synthetic Conductor and `.context/` cases, while an unguarded Paseo mention and the removed marker lack dedicated negative inputs.
- **Hypothesis (untested):** Add cases to the existing detector test that splice each remaining forbidden form into a skill and verify its reported violation. Re-verify the matcher first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/skill-protocols.test.ts:1047`
- **Evidence:** Outside challenge and coverage audit source reads; the current tests pass and no detector defect was reproduced.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `107b814`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=tests/handoff-contract.test.ts] Test gap: Lock the contract's optional Paseo provider paragraph
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The contract test locks the honored ownership row and its three skill sections; it does not separately pin the paragraph retaining Paseo as an optional provider.
- **Hypothesis (untested):** Extend the existing contract test with a provider-paragraph assertion and a deletion case. Re-verify the documented provider contract first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/handoff-contract.test.ts:2295`
- **Evidence:** Outside challenge and coverage audit source reads; the paragraph is present, the contract suite passes, and no product failure was reproduced.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `107b814`, before draft creation at the external full-suite gate.
- **Effort:** ? (user triages in /roadmap)

### [review:files=tests/skill-protocols-roadmap.test.ts] Test gap: Exercise contradictory shared-document inputs
- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The never-shared test rejects deletion of the required sentence, but does not separately mutate the default shared-docs list or insert a contradictory sharing sentence.
- **Hypothesis (untested):** Add those synthetic inputs to the existing never-shared matcher test, checking each rejection independently. Re-verify the grouping rule first.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/skill-protocols-roadmap.test.ts:388`
- **Evidence:** Outside challenge and coverage audit source reads; the current rule and its deletion case pass, and no grouping defect was reproduced.
- **Context:** Filed by `/review-and-prep` on 2026-11-10 at `107b814`, before draft creation at the external full-suite gate.
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
