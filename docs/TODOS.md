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

- **Base issue:** present at merge base `b48054a`; filed under `blocking=shown`
- **Description:** With `GSTACK_OUTSIDE_TEST_ROOT` pointing at installed gstack 1.101.0.0, five installed-only tests fail: the three qualified severity label cases, the golden verdicts through recovery and the installed transport check. Their advisory-only replies end on the Recommendation with no closing `VERDICT:` line, so the installed classifier reads them as `missing_verdict` (the closing verdict-line rule from 1.99.0.0). The default suite skips these tests.
- **Evidence:** The installed-only run of `tests/outside-review.test.ts` and `tests/review-delegate.test.ts` fails the same five tests with the same assertions (182 pass, 5 fail) at `63854bb`, where both suites, `src/outside-review/` and `src/review-delegate/` equal merge base `b48054a`'s. When the entry was filed, the same reply with `VERDICT: FINDINGS` appended was credited.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `tests/outside-review.test.ts`
- **Context:** Filed by /review-and-prep on `mmm/41e6e394` on 2026-11-19, before draft creation, at `15da31e`, a credit-half commit that `63854bb` reverted; re-anchored to merge base `b48054a` and the identical files at `63854bb` (2026-11-20).
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/outside-review/recovery.ts] Base issue: context requests the marker detection misses

- **Base issue:** present at merge base `b48054a`; filed under `blocking=shown`
- **Description:** A `NEEDS_CONTEXT` request written with a fullwidth colon, as `NEEDS CONTEXT`, `Needs context`, `NEEDS-CONTEXT` or with an escaped underscore (`NEEDS\_CONTEXT`), after a task-list checkbox, with no colon or dash after the marker (`NEEDS_CONTEXT the callers …`, `NEEDS_CONTEXT (the callers …)`, `NEEDS_CONTEXT, …`, `NEEDS_CONTEXT. The callers … are missing.`, `NEEDS_CONTEXT = …`), on a line that a U+2028 separator or a lone CR splits from the text before it, as one inline code span covering the whole line (`` `NEEDS_CONTEXT: the callers of save()` ``, which the code-span rule blanks), or as a code span around the marker and `none` followed by plain text naming the gap (`` `NEEDS_CONTEXT: none` (the callers of save() are missing) ``) is never seen as a context request, so a reply carrying it is credited clean with `needs_context: false`. A lone CR before a closing fence marker (```` code\r``` ````) also ends the fence for CommonMark while recovery's fence reading keeps it as one line, so a request after it stays hidden. The delegated path falls back as `unparsed-finding` instead. Reading every line that starts with the marker as a request would also fail closed on prose lines that begin with it.
- **Evidence:** Synthetic replies through `recover()` with installed gstack 1.101.0.0 were credited at the merge base, whose `recovery.ts` this branch restored at `63854bb`, as they were on the reverted line-based reading (`cd5a7c1`, `8099fec`, `b8b9fdb`, `2e78c5a` and `0a6af1a`). A plain `\n` line break fails closed as intended.
- **Upstream severity:** CRITICAL
- **Found in:** `src/outside-review/recovery.ts:27` (code-span reading), `:31` (marker detection) and `:20` (line split)
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 at `cd5a7c1` (2026-11-19); extended at `8099fec`, `b8b9fdb`, `2e78c5a` and `0a6af1a` (2026-11-20); re-anchored to main's `recovery.ts` at `63854bb` (2026-11-20).
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/upstream-check/probe.ts] Base issue: upstream-check golden advisory cases lack the closing verdict line

- **Base issue:** present at merge base `b48054a`; filed under `blocking=shown`
- **Description:** The two advisory cases in `GOLDEN_CASES` end on the Recommendation with no closing `VERDICT:` line, so installed gstack 1.101.0.0 reads them as `missing_verdict` and `bin/upstream-check` reports classifier drift for `review-advisory` and `structured-advisory` against the current upstream. This is the same root cause as the installed-only test entry above, but it also affects a shipped diagnostic.
- **Evidence:** Both cases came back `unverified` and uncredited through `recover()` at the merge base and at this branch's head; the two not-ready cases still match.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `src/upstream-check/probe.ts:31`
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 at `cd5a7c1` (2026-11-19).
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/outside-review/recovery.ts] Base issue: the classifier's fence pairing can hide a finding

- **Base issue:** reproduced at the merge base `b48054a` and at `6aeedbb`, not introduced by PR #284; filed under the review policy's base-only rule as non-blocking work
- **Description:** Recovery joins a bare `Recommendation:` or `Verdict:` line to the line after it. When that line is a fence marker, the joined line no longer opens a fence for the installed classifier, so its fence pairing flips for the rest of the reply and can hide a finding that the raw reply's classification reports: `Recommendation:` / ```` ``` ```` / `x` / ```` ```` ```` / `[P1] src/store.ts:10 the save path drops data on retry` / ```` ``` ```` / `y` / ```` ```` ```` / `Recommendation: ship because no defects were found` / `VERDICT: CLEAN` reads `findings` (P1) before recovery and `clean` after it. The join also folds a numbered finding after a bare `Recommendation:` line into it, so the numbered-item rule no longer counts it (`Recommendation:` / `1. The retry path writes the record twice when save() times out.` / … reads `untagged_review` before recovery and `clean` after), and its pattern (`^(\s*` under the `m` flag) rescans runs of blank lines, so its time grows with the square of their length (20,000 blank lines take about 3 s). Separately, the installed classifier opens a fence on a line that starts with triple-backtick inline code (```` ```save()``` is called from three places. ````), which CommonMark reads as text, so a finding between that line and a later marker line is hidden from the classifier itself; recovery passes that verdict through and fails closed only when its own fence reading is still open at the end, so a pairing that reading also closes still hides it. A fix could skip the join before a fence marker or a numbered line, read the join's leading space as `[\t ]*`, refuse a recovered classification whose highest severity or numbered-item count is lower than the raw reply's, and fail closed when the classifier's fences hide a line that CommonMark shows as text (option (b) of the credit-half re-card entry below, a real Markdown parser, would supply that reading).
- **Evidence:** The Red Team of the third continuation review's cycle 2 on PR #284 reproduced the fence flip and the inline-code fence through `recover()` with the installed classifier, credited at `b48054a` (main's `recovery.ts`, restored on this branch at `63854bb`), at `6aeedbb` and with that cycle's fixes; cycle 3's Red Team reproduced the numbered fold and its adversarial reviewer timed the blank-line scan, both the same at `b48054a` and `0a6af1a`.
- **Upstream severity:** CRITICAL
- **Found in:** `src/outside-review/recovery.ts:39` (Recommendation join) and `:41` (end-of-reply fence check)
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 at `6aeedbb` (2026-11-20); extended at `0a6af1a` (2026-11-20); re-anchored to main's `recovery.ts` at `63854bb` (2026-11-20).
- **Effort:** ? (user triages in /roadmap)

### [review:files=src/outside-review/recovery.ts|src/review-delegate/delegate.ts] Credit complete outside and delegated replies without approximating Markdown line by line

- **Descoped:** moved out of Track 90A on the developer's decision of 2026-11-20 at PR #284's fourth cycle-cap stop. The line-by-line credit reading was reverted to main at `63854bb`, and the PR ships only the baseline half (criteria 2, 3, 4's readiness side, 6, 8 and 9). Until this lands, main's reading stays fail-closed: a complete reply with a nothing-missing context line or numbered met criteria is rejected, and the baseline half records that outside voice as missing coverage for a repair-only continuation to rerun. That costs an extra outside call, never a false credit.
- **Description:** Stop approximating CommonMark line by line, which leaked in every cycle (Evidence). Credit a nothing-missing context line or a met criterion only when the reading is certain the reply states it, and fail closed on everything else, as main does today; the Hypothesis names two ways to get that certainty. The same reading has to serve `recover()` for the outside challenge and structured voices and `parseFindings` for delegated parts. A challenge reply whose numbered met criteria omit the `Recommendation` line also stays `missing_markers` on the review gate today, so the structured fallback must reach that case too.
- **Scope:** Track 90A's criteria 1, 4 (its credit side), 5 and 7 (the plan marks 7, like 8 and 9, as added to the card's criteria 1 to 6), verbatim:
  1. `recover()` in `src/outside-review/recovery.ts` reads a `NEEDS_CONTEXT` line that says nothing is missing (the observed `NEEDS_CONTEXT: none of the above depends on missing context.` and its formatting variants) as no context needed, while a line that names missing context still fails closed; fixtures pin that reply shape and a `NO_FINDINGS` reply beside it, both for the outside challenge and for a delegated part, whose `decide()` reads the same parser.
  4. Readiness and every other gate are unchanged for a reply that names missing context.
  5. A structured outside reply with `VERDICT: CLEAN` and numbered criterion lines (the 2026-11-19 shape, below) is credited as clean, while a reply carrying real untagged findings still fails closed, with fixtures for both.
  7. A delegated part's reply that carries a nothing-missing context line is credited by `decide()` (it neither falls back as `needs-context` nor as `unparsed-finding`), because `parseFindings` reads the same shared predicate as `recover()`. (added)
- **Observed shapes:** two context-line value forms, each followed by a trailing explanation: `NEEDS_CONTEXT: none of the above depends on missing context.` plus one sentence, and `NEEDS_CONTEXT: none (<what a context extension supplied>).` The 2026-11-19 structured reply: a bold title, a bold `Criteria assessment` heading, eight numbered `**<statement>.** Met.` lines (one ending `Met, by inspection.`, one `Met. <sentence>`), indented sub-bullets, a bold section with bullets, `NO_FINDINGS: none`, `Recommendation: … because …` and `VERDICT: CLEAN`. Installed gstack counts column-0 numbered items without a severity as findings (`4ed1711d`) and reads `VERDICT: CLEAN` beside them as `untagged_review` (`7cb151bf`). A delegated `NEEDS_CONTEXT: review material truncated` reply names missing context and must stay `needs-context`.
- **Evidence:** Each of the twelve review cycles across PR #284's four invocations (2026-11-19 to 2026-11-20, `d0083f7` to `8610c32`) reproduced at least three new blocking defects in the line-based reading against the installed classifier, 73 in all. Most were false credits: a reply that names missing context, or one that carries a real finding, credited clean where the merge base fails it closed. Every fix closed the shapes it was shown, and the next cycle found more in the same CommonMark constructs. Those constructs were list items and their continuation and lazy lines, block-quote nesting (spacing, tabs, list markers), fenced code inside list items and quotes or after an HTML block, a fence left open at the end of a reply, code spans read as fences, and links, reference labels, images, entities, escapes and emphasis hiding a negator before `Met`. The clause, negation and name grammar of the nothing-missing line leaked the same way. Narrowing the reading to a three-form allowlist (owner decision A, the third continuation) did not stop it: its three cycles found 4, 10 and 6. PR #284's commits name each cycle's fixes.
- **Open question:** Should a gap named on the line before a `NEEDS_CONTEXT: none` line (for example `The callers of save() are not shown.`, then `NEEDS_CONTEXT: none`) make the reply fail closed? That includes a sentence that runs into the marker line from the line above, which CommonMark reads as one paragraph. Owner decision A accepted this case, and the same gap on the line after, as residual risk of the line-based reading. Either option in the Hypothesis reads that paragraph differently from the line-based reading, so the owner decides it again for the chosen design.
- **Hypothesis (untested):** two options for the planner. (a) The producer emits an exact token and the consumer credits only that token: a prompt or schema change, which Track 90A's plan rejected for a prompt change because it changes the shared prompt prefix's hash, so a resumed review pays for the prefix again, and it cannot credit replies already returned. (b) A real Markdown parser that reads blocks first, then inlines: the package has no runtime dependencies today (`package.json` lists only Ajv, as a development dependency), and its `bin/` launchers run Bun with `--no-install`, so a pinned parser would have to ship with the checkout.
- **Found in:** `src/outside-review/recovery.ts:20` (the line reading in `recover()`) and `src/review-delegate/delegate.ts` (`parseFindings`)
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 after the revert at `63854bb` (2026-11-20). It replaces this branch's wording-gap and uncredited-reply entries for the reverted reading. Reworded on 2026-11-20 to name both options rather than prescribe a parser.
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** the developer re-cards the credit half (decision "1", 2026-11-20); the planner chooses between the Hypothesis's two options.

### [review:files=skills/review-and-prep.md|src/review-state/fence.ts|src/outside-review/prompt.ts|docs/review-run-state-calls.md] Follow-up: the repair-only outside rerun rests on prose

- **Follow-up:** reviewer reading, not reproduced; filed under the owner's decision of 2026-11-20 as non-blocking work
- **Description:** A first-cycle baseline may now say `completed=true` while an outside voice stayed unverified, and only the free-text stage result `missing coverage (unverified: <reason>)` tells a repair-only continuation to rerun that voice at full scope. The fence accepts any non-empty stage result, so a paraphrased record skips the rerun without a trace. The rerun also cannot target the structured voice alone: `bin/outside-review` runs the challenge whenever `structured` is true, and the skill does not say whether that extra challenge counts toward readiness or replaces the voice's delta-scope call in the same continuation. Each later repair-only continuation also pays again for that full-scope call: the trigger is the carried evidence comment, which keeps its original stage results, so the voice stays recorded as missing coverage even after a credited rerun. The words "missing coverage" also describe unavailable voices (`bin/outside-review` exits 4 for any uncredited phase), so a record made from the exit code alone could mark an unavailable voice as unverified and write `completed=true`; the rule should name the per-phase `unverified` verdict. Within one continuation the trigger does not change either, so each of its up to three `/review` cycles may pay another full-scope outside call (two with structured), more than the plan's accepted one or two extra calls per continuation; running the rerun once per continuation, in its first cycle or until a credited result exists, would bound it. A gap from cycle 2's fix review has no defined place in the evidence comment, which carries "cycle 2's fix-review results", and the trigger cannot tell such a gap, whose range the continuation's delta call already covers, from a cycle-1 gap. Nothing says how the rerun's findings on the range from the merge base to B reach the delta `/review`'s synthesis, Fix-First or `Unresolved:`, so they can be dropped as outside the delta. Nor does anything say how the run state records the rerun: once the delta-scope result's `voice-complete` is recorded, a second attempt on that voice is refused (`voice-completed`), and the calls document's degraded path then stops run-state recording for the rest of the continuation, while recording the rerun inside the delta pass attributes a merge-base-to-S call to a delta pass. The stop's output and its repair-only, full or stop question also do not say that repair-only will pay for that full-scope call.
- **Evidence:** Read from `skills/review-and-prep.md` (Completion values, Bound Claude Code outside calls and the continuation step), `src/review-state/fence.ts` (stage-result validation) and `src/outside-review/prompt.ts` (phase selection) at `8099fec`, and the carried evidence comment's results at `b8b9fdb`; the plan's risks name the prose-only rule. PR #284's fourth continuation added readings at `e3a48bf`: the per-cycle cost from its cycle 1 Red Team, and the cycle-2 gap, the rerun's findings, its run-state recording and the stop's silence from its adversarial reviewers, citing `skills/review-and-prep.md:1224-1227`, `:2604`, `:2691-2693` and `:2809-2815`, `docs/review-run-state-calls.md:72` and `:117`, and `src/review-state/state.ts:596`; none was reproduced.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/review-and-prep.md:1224`, `src/review-state/fence.ts:115` and `docs/review-run-state-calls.md:72`
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 at `8099fec` (2026-11-20); extended at `e3a48bf` (2026-11-20).
- **Effort:** ? (user triages in /roadmap)

### [review:files=skills/review-and-prep.md|docs/workflow-handoffs.md] Follow-up: loose ends of the unverified-outside-voice baseline rule

- **Follow-up:** reviewer readings, not reproduced; filed on the developer's decision of 2026-11-20 as non-blocking work. Within a release that carries this rule, each fails closed: the stop holds or the voice is rerun. The exception is version skew: a stop written by this release and continued by an older install skips the full-scope rerun, so that continuation's readiness can rest on outside coverage of the delta alone; continue such a stop with this release or a later one.
- **Description:** The baseline rule keys on an outside voice whose completed reply stayed `unverified`, the label `bin/outside-review` gives an uncredited parse. Upstream `/review`'s own outside block, used where **Bound Claude Code outside calls** does not apply (including the continuation's fallback rerun), labels a completed reply that lacks its markers `outside_status: unavailable` (reason `missing_markers`) instead, so the same reply keeps the baseline through one path and makes it `reviewer-incomplete` through the other, and two agents can write different write-once records. A voice whose reply stayed unverified and whose later context-extension call did not run (or the reverse) is both, and the rule does not say which attempt decides. The stage result's `<reason>` is free text that now reaches the running account's evidence comment; copied from a reply's context line, it could carry a hidden HTML-comment stop marker that a consumer miscounts as a stop, a fail-closed hold. Sentences that predate the rule can still be read as holding such a stop: the cap entry sends failed or missing coverage down the BLOCKED path, the continuation step holds on missing or incomplete evidence, the dedicated evidence comment states that `completed=true` records coverage without naming the exception, and the published consumer binding (`E-REVIEW-INCOMPLETE`) holds on an incomplete review; a change to that binding needs the owner. A stop written by this version and continued by an older install reads `completed=true` and runs its delta re-review without the full-scope rerun, so that continuation's readiness can rest on outside coverage of the delta alone.
- **Hypothesis (untested):** key the rule on an outside process that ran and whose reply was not credited, naming upstream's marker failures, or state that they stay `reviewer-incomplete`; let a voice's last attempt decide; limit `<reason>` to the adapter's reason code; name the exception in the older sentences; and tell users to continue such a stop with the release that wrote it or a later one.
- **Evidence:** Read from `skills/review-and-prep.md:2420-2428` (the baseline rule), `:2588` (the cap entry), `:2692-2693` (the evidence comment) and `:2700` (evidence holds), `docs/workflow-handoffs.md:310` (`E-REVIEW-INCOMPLETE`) and `src/outside-review/recovery.ts` at `e3a48bf`, and from installed gstack 1.101.0.0's outside block; the plan's risks name version skew.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/review-and-prep.md:2420`
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 at `e3a48bf` (2026-11-20).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** the outside-voice result labels or the H-E consumer binding next change.

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

### [review:files=skills/review-and-prep.md|tests/skill-protocols-review-and-prep.test.ts] Test gap: Lock the delta re-review exceptions for the full-scope outside rerun

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The delta re-review section now names a `repair-only` continuation's full-scope outside rerun twice: as the one diff that compares the verified merge base to S instead of B to S, and as the third exception in its closed list of reviewer-selection exceptions. No lock reads either clause, so an edit that drops one passes the suite and brings back the contradiction with the rerun rule.
- **Hypothesis (untested):** extend `checkUnverifiedOutsideBaselineLock`, or add a sibling lock over **Scope a re-review to its delta**, to require both clauses, with one mutation entry per clause in the kept-contract mutation table.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `skills/review-and-prep.md:1320` and `:1354`
- **Evidence:** The cycle 3 Red Team and the coverage audit of PR #284's fourth continuation read both clauses and the lock at `e3a48bf`; the two suites passed (554 tests) and no failure was reproduced.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 at `e3a48bf` (2026-11-20).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** the delta re-review section or the rerun rule next changes.

### [review:files=docs/designs/review-evidence-envelope.md] Test gap: Lock the evidence map's unverified-outside-voice exception

- **Test gap:** no demonstrated defect; filed under `test-gaps=record`
- **Description:** The evidence map now records the drift and states the unverified-outside-voice exception in its baseline rows and its coverage bullet, but no test reads them, so the map could drift back to the old `completed=true` meaning unnoticed. The coverage audit rated a test here low value, because the map describes contracts that the skill's and the handoff contract's locks already hold.
- **Hypothesis (untested):** a phrase check beside `tests/handoff-contract.test.ts`'s check of what `completed=true` covers, or none while the map stays descriptive.
- **Upstream severity:** INFORMATIONAL
- **Found in:** `docs/designs/review-evidence-envelope.md:16`
- **Evidence:** The coverage audit at `e3a48bf` found no test that reads the map; no failure was reproduced.
- **Context:** Filed by /review-and-prep on https://github.com/kbitz/gstack-extend/pull/284 at `e3a48bf` (2026-11-20).
- **Effort:** ? (user triages in /roadmap)
- **Revisit when:** the evidence map is next edited.

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
