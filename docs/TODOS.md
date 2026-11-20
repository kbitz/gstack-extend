# TODOS

## Unprocessed

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: Lock derive subcommand help wording

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The live `derive --help` output describes an experimental internal helper and the default caller. No test pins both claims at the subcommand boundary.
- **Hypothesis (untested):** Assert both claims using the telemetry launcher without starting a telemetry run.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/telemetry.py`
- **Evidence:** The coverage audit traced the help branch and the parent checked its output directly.
- **Context:** Filed by /review-and-prep on PR #281 at `0c5a42f` (2026-11-19).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** Derive help or review-state activation changes.

### [review:files=skills/review-and-prep.md|tests/handoff-contract.test.ts] Test gap: Default recording across an installed-agent resume

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The protocol checks pin default activation and resume instructions separately. They do not exercise an installed agent that starts without `run-state=record`, pauses, and resumes the same recorded run.
- **Hypothesis (untested):** Exercise the default path in an isolated workflow with a controlled pause and verify the resumed checkpoint and retained receipt fields.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/review-and-prep.md`
- **Evidence:** The coverage audit found the activation and resume locks. The focused suite passed.
- **Context:** Filed by /review-and-prep on PR #281 at `0c5a42f` (2026-11-19).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The project next changes default activation or qualifies resume on an installed harness.

### [review:files=docs/review-run-state-calls.md|skills/review-and-prep.md|tests/handoff-contract.test.ts] Test gap: Inline receipt output under installed version skew

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The tests exercise renderer output and pin the fallback instructions separately. They do not drive an installed agent through a missing calls document and compare its inline output to the versioned handoff grammar.
- **Hypothesis (untested):** Use a controlled older install and a draft fixture. Check the inline markers, evidence locator and the applicable stop or pause line.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `docs/review-run-state-calls.md`
- **Evidence:** The coverage audit checked the protocol and renderer suites. The focused suite passed.
- **Context:** Filed by /review-and-prep on PR #281 at `0c5a42f` (2026-11-19).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The installed compatibility checks exercise older helper or calls-document combinations.

### [review:files=src/review-state/export.ts|tests/workflow-metrics.test.ts] Test gap: Read back metrics for two voices reporting one finding

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The shared-finding fixture verifies both reports at export. It does not check that a later telemetry derive and read preserves the separate reports and attribution in the metrics sink.
- **Hypothesis (untested):** Use an isolated sink with two selected attempts that report the same finding ID. Compare the derived event rows and the read result with the export contract.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/export.ts`
- **Evidence:** The coverage audit traced the repeated-report fixture and the telemetry tests. The shared-finding fixture passed.
- **Context:** Filed by /review-and-prep on PR #281 at `0c5a42f` (2026-11-19).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** Per-report metrics attribution or its reader changes.

### [review:files=src/review-state/cli.ts|tests/review-state.test.ts] Test gap: Lock fence fallback wording in top-level review-state help

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The help test locks default recording and the fence command. It does not assert the top-level help's explanation of when the fence runs without `REVIEW_STATE_DIR`.
- **Hypothesis (untested):** Extend the existing help test to catch a return to wording that ties the fence to the old opt-in flag.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/cli.ts`
- **Evidence:** The coverage audit read the help test, ran `bin/review-state --help` and confirmed the current wording.
- **Context:** Filed by /review-and-prep on `mmm/47c5f95a` at `6d18433` on 2026-11-18, before draft creation.
- **Effort:** ? (user triages in /roadmap)

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: Muse log lookup with a valid harness-only ID

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The invalid-marker fixture stops before the narrower Muse log lookup check.
- **Hypothesis (untested):** Use a marker that passes fingerprint validation and falls outside the log ID grammar. Verify `agent: muse` and a null model.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/telemetry.py:1173`
- **Evidence:** Muse coverage audit on `86ceda5`. The existing marker tests passed.
- **Context:** Filed by /review-and-prep before draft creation (2026-11-18).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The Muse marker or log ID format changes.

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: Muse canonical log path

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The relocated-store fixture proves that a valid store root can resolve to its canonical location. The descendant path and regular-file checks have static review coverage.
- **Hypothesis (untested):** Exercise the descendant path validation in an isolated filesystem fixture and verify that ineligible candidates leave model attribution unknown.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/telemetry.py:1183`
- **Evidence:** Muse testing specialist and coverage audit on `86ceda5`. The relocated-store replay passed.
- **Context:** Filed by /review-and-prep before draft creation (2026-11-18).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The Muse session log locator changes.

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: duplicate dated Muse session logs

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The existing fixture separates named, sibling and subagent logs. It uses a single date directory for the named session.
- **Hypothesis (untested):** Write two dated copies of one synthetic session with different modification times and verify that the newer copy supplies the model.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/telemetry.py:1191`
- **Evidence:** Muse coverage audit on `86ceda5`. The named-session fixture passed.
- **Context:** Filed by /review-and-prep before draft creation (2026-11-18).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The date sharding or newest-log selection changes.

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: wrong-shaped Muse event envelopes

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The parse fixtures reject malformed timestamps and missing models within valid event containers.
- **Hypothesis (untested):** Put a wrong-shaped payload or event before a valid completion and verify the valid model is still attributed.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/telemetry.py:1194`
- **Evidence:** Muse coverage audit on `86ceda5`. The timestamp and malformed-log probes passed.
- **Context:** Filed by /review-and-prep before draft creation (2026-11-18).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The Muse event envelope or parser changes.

### [review:files=bin/lib/telemetry.py|tests/telemetry.test.ts] Test gap: Muse stage with only pre-start completions

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The existing stage-window fixture gives the in-window model two votes. It would still win if a pre-start completion entered the vote.
- **Hypothesis (untested):** Give an idle stage only one valid pre-start completion and verify its model stays null.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/telemetry.py:1399`
- **Evidence:** Muse testing specialist and coverage audit on `86ceda5`. The existing window fixture passed.
- **Context:** Filed by /review-and-prep before draft creation (2026-11-18).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** Muse model selection or the stage-window policy changes.

### [review:files=src/review-state/render.ts|tests/review-state.test.ts] Test gap: Conflicting initial finding dispositions

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The folding fixture varies severity across selected reports and gives both reports the same initial disposition.
- **Hypothesis (untested):** Give selected reports of one finding different initial adjudications and resolutions. Verify the later report in voice order supplies each field.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/render.ts:142`
- **Evidence:** Coverage audit on `61cb108` traced the voice-order fold and found no matching regression test.
- **Context:** Filed by /review-and-prep before draft creation (2026-11-18).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The selected-report fold or its test fixtures change.

### [review:files=src/review-state/render.ts|tests/review-state.test.ts] Test gap: Correction order across governing reports

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The committed fixtures apply one correction at a time across the governing reports. A one-off CLI probe exercised several corrections in record order.
- **Hypothesis (untested):** Add a fixture with corrections to different reports in one pass. Check that an omitted field preserves its prior value and that correction record order wins over voice order.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/render.ts:147`
- **Evidence:** Coverage audit and passing synthetic CLI correction probe on `61cb108`.
- **Context:** Filed by /review-and-prep before draft creation (2026-11-18).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** The correction fold or target lookup changes.

### [review:files=src/review-state/render.ts|tests/review-state.test.ts] Test gap: Correction targeting an unselected attempt

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The fold tests correct a report from an older pass and cover selected reports in the current pass. They do not correct a replaced attempt in the current pass.
- **Hypothesis (untested):** Select a replacement attempt that reports the same finding, then correct the earlier attempt on that voice. Verify the selected report still determines the receipt.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/review-state/render.ts:148`
- **Evidence:** Coverage audit on `61cb108` traced selection and the full target tuple. No failure was reproduced.
- **Context:** Filed by /review-and-prep before draft creation (2026-11-18).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** Attempt selection or correction targeting changes.

### [review:files=tests/telemetry.test.ts|bin/lib/telemetry.py] Test gap: FIFO launch log for the bounded head read

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The launch-surface head read opens the log without blocking and refuses anything but a regular file. No matrix case names a FIFO as a Codex rollout or Muse `session.jsonl`, so dropping the non-blocking open would not fail a test.
- **Hypothesis (untested):** Add a shared-matrix case per harness where the named log is a FIFO, expecting `unknown` / `entrypoint-unavailable` and a prompt finish.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/telemetry.test.ts:5540`
- **Evidence:** The testing specialist raised it in two review cycles. A FIFO check on the CLI finished promptly with `entrypoint-unavailable` for both harnesses, so no failure was reproduced.
- **Context:** Filed by /review-and-prep during the Track 90B review at `cf9604b` (2026-11-19).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** `head_records` or the launch-surface readers change.

### [review:files=tests/telemetry.test.ts|bin/lib/telemetry.py] Test gap: Launch reader edge branches

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** The readers' malformed-evidence branches have no case: a `session_meta` payload that is not an object, an empty or non-object Codex `source`, and a Muse open record that ends exactly at the 64 KiB head bound.
- **Hypothesis (untested):** Add small cases to the shared matrix with `writeCodexMeta` and `writeMuseOpen`, expecting `entrypoint-unavailable` for malformed evidence and `host-app-session` for the Muse boundary record.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/telemetry.test.ts:5497`
- **Evidence:** A review grep found no case for these branches. The `codex-tui` mapping it also named is pinned by the audit-script reader test. No failure was reproduced.
- **Context:** Filed by /review-and-prep during the Track 90B review at `cf9604b` (2026-11-19).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** `codex_launch_surface` or `muse_launch_surface` changes.

### [review:files=tests/telemetry.test.ts|bin/lib/telemetry.py] Test gap: Linked Muse data home

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** No run-mode case sets `XDG_DATA_HOME` to a symlink. The Muse reader rebuilds the log path under the unresolved data home before its no-follow walk, so a linked data home stays trusted, like a linked `CODEX_HOME`, but no test pins that.
- **Hypothesis (untested):** Add a matrix case whose `XDG_DATA_HOME` is a symlink to a store holding a `paseo` open record, expecting `user-directed` / `host-app-session`.
- **Upstream severity:** CRITICAL
- **Found in:** `bin/lib/telemetry.py:1597`
- **Evidence:** The native adversarial pass and the coverage audit both named the missing case, and the adversarial pass's own probe classified a linked data home as `host-app`. No failure was reproduced.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/283 at `abb2c11` (2026-11-19).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** `muse_launch_surface`, `muse_log_store` or `head_records` changes.

### [review:files=tests/telemetry.test.ts|bin/lib/telemetry.py] Test gap: Launch reader malformed records and raised errors

- **Test gap:** No demonstrated defect. Filed under `test-gaps=record`.
- **Description:** More malformed-input branches have no direct case: a padded or otherwise unclean Codex `originator` or `source`; a Muse open record whose payload is not an object, names another `kind` or holds a non-object `record`; a malformed JSON line inside the head read; and a reader that raises something other than an `OSError`, which `run_mode` still maps to `entrypoint-unavailable`.
- **Hypothesis (untested):** Add rows beside the existing edge cases in the shared run-mode matrix, expecting `entrypoint-unavailable`. For the raising reader, patch one reader in a Python check and assert `run_mode` returns `unknown` / `entrypoint-unavailable`.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `bin/lib/telemetry.py:1557`
- **Evidence:** The coverage audit at `abb2c11` traced these branches and found no test. The linked-directory cases reach the raise path only through real `OSError` reads. No failure was reproduced.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/283 at `abb2c11` (2026-11-19).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** `codex_launch_surface`, `muse_launch_surface` or `run_mode` changes.

### [review:files=bin/lib/telemetry.py] Base issue: Model readers trust suffix-matched and relative-home session logs
- **Base issue:** present at merge base `1782cb0`; filed under `blocking=shown`
- **Description:** `codex_turns` reads model and effort from any rollout whose file name only ends with the thread ID, and from a `CODEX_HOME` that is relative to the working directory. The launch-surface reader refuses both, but the model and effort fields still use them, so a row can carry a detected model from a log its own run-mode reader rejected. `muse_logs` may resolve a relative data home the same way; that part is unverified.
- **Evidence:** A bounded probe of `codex_turns` returned the foreign model for a suffix-matched rollout and the planted model for a relative `CODEX_HOME`, identically at `abb2c11` and at merge base `1782cb0` (disposable copies; no work-tree change).
- **Upstream severity:** CRITICAL
- **Found in:** bin/lib/telemetry.py:1220
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/283 at abb2c11 (2026-11-19).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** `codex_logs`, `muse_logs` or the model readers change.

### [review:files=tests/outside-review.test.ts] Base issue: installed-only classifier tests lack the closing verdict line

- **Base issue:** present at merge base `1782cb0`; filed under `blocking=shown`
- **Description:** With `GSTACK_OUTSIDE_TEST_ROOT` pointing at installed gstack 1.101.0.0, five installed-only tests fail: the three qualified severity label cases, the golden verdicts through recovery and the installed transport check. Their advisory-only replies end on the Recommendation with no closing `VERDICT:` line, so the installed classifier reads them as `missing_verdict` (the closing verdict-line rule from 1.99.0.0). The default suite skips these tests.
- **Evidence:** The installed-only run of `tests/outside-review.test.ts` and `tests/review-delegate.test.ts` fails the same five tests with the same assertions at `1782cb0` and at `15da31e`. The same reply with `VERDICT: FINDINGS` appended is credited.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/outside-review.test.ts`
- **Context:** Filed by /review-and-prep on `mmm/41e6e394` at `15da31e` on 2026-11-19, before draft creation.
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/outside-review/recovery.ts] Base issue: context requests the marker detection misses

- **Base issue:** present at merge base `b48054a`; filed under `blocking=shown`
- **Description:** A `NEEDS_CONTEXT` request written with a fullwidth colon, as `NEEDS CONTEXT`, `Needs context`, `NEEDS-CONTEXT` or with an escaped underscore (`NEEDS\_CONTEXT`), after a task-list checkbox, with no colon or dash after the marker (`NEEDS_CONTEXT the callers …`, `NEEDS_CONTEXT (the callers …)`, `NEEDS_CONTEXT, …`, `NEEDS_CONTEXT. The callers … are missing.`, `NEEDS_CONTEXT = …`), on a line that a U+2028 separator or a lone CR splits from the text before it, as one inline code span covering the whole line (`` `NEEDS_CONTEXT: the callers of save()` ``, which the code-span rule blanks), or as a code span around the marker and `none` followed by plain text naming the gap (`` `NEEDS_CONTEXT: none` (the callers of save() are missing) ``) is never seen as a context request, so a reply carrying it is credited clean with `needs_context: false`. The delegated path falls back as `unparsed-finding` instead. Reading every line that starts with the marker as a request would also fail closed on prose lines that begin with it.
- **Evidence:** Synthetic replies through `recover()` with installed gstack 1.101.0.0 were credited the same way at the merge base and at `cd5a7c1`, the forms without a delimiter at the merge base and at `d0e2a9a`, and the whole-line code span and the hyphenated and escaped markers at the merge base and at `973d453`, and the code span around the marker and `none` at the merge base and at `6644358`; the code-span reading, marker detection and line split are unchanged on this branch. A plain `\n` line break fails closed as intended.
- **Upstream severity:** CRITICAL
- **Found in:** `src/outside-review/recovery.ts:75` (code-span reading), `:79` (marker detection) and `:170` (line split)
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 at `cd5a7c1` (2026-11-19); the forms without a delimiter were added at `d0e2a9a`, the whole-line code span and the hyphenated and escaped markers at `973d453`, and the code span around the marker and `none` at `6644358` (2026-11-20).
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/upstream-check/probe.ts] Base issue: upstream-check golden advisory cases lack the closing verdict line

- **Base issue:** present at merge base `b48054a`; filed under `blocking=shown`
- **Description:** The two advisory cases in `GOLDEN_CASES` end on the Recommendation with no closing `VERDICT:` line, so installed gstack 1.101.0.0 reads them as `missing_verdict` and `bin/upstream-check` reports classifier drift for `review-advisory` and `structured-advisory` against the current upstream. This is the same root cause as the installed-only test entry above, but it also affects a shipped diagnostic.
- **Evidence:** Both cases came back `unverified` and uncredited through `recover()` at the merge base and at this branch's head; the two not-ready cases still match.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/upstream-check/probe.ts:31`
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 at `cd5a7c1` (2026-11-19).
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/outside-review/recovery.ts] Base issue: numbered criterion lines without a Recommendation stay uncredited on the challenge gate

- **Base issue:** present at merge base `b48054a`; filed under `blocking=shown`
- **Description:** A challenge (review-gate) reply whose criteria are numbered `… Met` lines and that omits the Recommendation line stays `unverified` (`missing_markers`), while the same reply with bulleted lines is credited through the structured fallback. The met-criterion rewrite reclassifies on the original gate only, so it does not reach this case.
- **Evidence:** The reply returned `unverified` with `missing_markers` at the merge base and at this branch's head; on the structured gate it is credited clean.
- **Upstream severity:** CRITICAL
- **Found in:** `src/outside-review/recovery.ts:193` (structured fallback) and `:199` (met-criterion rewrite)
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 at `cd5a7c1` (2026-11-19).
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/outside-review/recovery.ts|docs/outside-review.md] Wording gap: complete replies that the allowed forms leave uncredited

- **Wording gap:** filed under the owner's decision of 2026-11-20 (fix only false credits; file other wording gaps as non-blocking work); owner decision A of 2026-11-20 (continuation 3) narrowed the reading to three forms and accepts the replies below as a limitation of Track 90A, so the parser stays closed to them
- **Description:** A nothing-missing context line is credited only as `none`, the observed sentence `none of the above depends on missing context` or `none` and one change statement (`docs/outside-review.md`, Recovery and storage); anything else fails closed and its voice reruns as missing coverage. Complete replies left uncredited include an explanation that says context was supplied, among them the cycle-1 observed form (`none (the context extension supplied all three requested interfaces)`); the observed sentence followed by any sentence, among them the cycle-2 observed shape and a change statement (`none of the above depends on missing context. The fix does not depend on any caller.`); `none` followed by two change statements or by a change statement and another sentence; and a nothing-missing line whose text carries on to the next line, including one followed directly by a finding label line (`[P2] …`), which reads as a continuation. The met-criterion reading fails closed outside its forms too: a negation within two words of `Met` that does not negate the status (`Callers don't change. Met.`) and a caveat word in an unwrapped statement used in a positive sense. Its checks also stay lexical in the other direction: a bold title is not read for caveats, a first status that uses no listed word on a two-criterion line (`Callers updated: Open — tests added: Met.`) is folded into the statement and credited, and a caveat word the lists leave out (`none`, `nothing`, `neither`, `nor`, `might`, `may`, `requires`) does not stop an unwrapped statement from being credited.
- **Evidence:** The continuation reviews of this PR read the earlier explanation forms through `contextLine()` and `recover()` at `d0e2a9a`, `973d453` and `6644358`; owner decision A (continuation 3) then replaced the explanation grammar with the three-form allowlist, and `tests/outside-review.test.ts` and `tests/review-delegate.test.ts` pin each listed context reply as uncredited.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/outside-review/recovery.ts:86` (the three forms) and `:134` (met-criterion rewrite)
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 at `d0e2a9a` (2026-11-20); extended at `973d453` and `6644358` (2026-11-20); rewritten for the three-form allowlist in continuation 3 (2026-11-20).
- **Effort:** ? (user triages in /roadmap)

### [review:files=skills/review-and-prep.md|src/review-state/fence.ts|src/outside-review/prompt.ts] Follow-up: the repair-only outside rerun rests on prose

- **Follow-up:** reviewer reading, not reproduced; filed under the owner's decision of 2026-11-20 as non-blocking work
- **Description:** A first-cycle baseline may now say `completed=true` while an outside voice stayed unverified, and only the free-text stage result `missing coverage (unverified: <reason>)` tells a repair-only continuation to rerun that voice at full scope. The fence accepts any non-empty stage result, so a paraphrased record skips the rerun without a trace. The rerun also cannot target the structured voice alone: `bin/outside-review` runs the challenge whenever `structured` is true, and the skill does not say whether that extra challenge counts toward readiness or replaces the voice's delta-scope call in the same continuation. Each later repair-only continuation also pays again for that full-scope call: the trigger is the carried evidence comment, which keeps its original stage results, so the voice stays recorded as missing coverage even after a credited rerun. The words "missing coverage" also describe unavailable voices (`bin/outside-review` exits 4 for any uncredited phase), so a record made from the exit code alone could mark an unavailable voice as unverified and write `completed=true`; the rule should name the per-phase `unverified` verdict.
- **Evidence:** Read from `skills/review-and-prep.md` (Completion values, Bound Claude Code outside calls and the continuation step), `src/review-state/fence.ts` (stage-result validation) and `src/outside-review/prompt.ts` (phase selection) at `d0e2a9a`, and the carried evidence comment's results at `973d453`; the plan's risks name the prose-only rule.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/review-and-prep.md:1224` and `src/review-state/fence.ts:115`
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 at `d0e2a9a` (2026-11-20).
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
