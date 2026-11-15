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

### [full-review:necessary] Run-state call shapes in the skill and docs still diverge from the helper
- **Description:** Beyond the two keys item fa720a73 fixes (`delegate.call_id`, `candidate.tree`) and Track 80A's `start policy.delegation.parts`, workers are still told to send shapes that `src/review-state/state.ts` refuses. Runs then fall back to `Run state: unavailable` for the rest of the invocation. Real runs: 29 of 47 orchestrated evidence directories with a `Run state:` line ended `unavailable`. Besides `call_id` (10) and `delegation.parts` (3), the refusals were `details.captures` (8), `findings[0].adjudication invalid-enum` (5), `required_voices` (7 or more), `start policy.source invalid-enum` (3) and a missing `record` subtype (3). Members: (1) The skill (363-366, 4720, 4812) and docs/telemetry.md:828-830 allow null delegate `wall_ms` and token counts, which the runner emits (`src/review-delegate/cli.ts:442`, `delegate.ts:231,237`), but state.ts:502-506 accepts null only for `cache_creation_input_tokens`. (2) The `finish stopped` shape in docs/review-run-state-calls.md:34 and 36 omits the required `base`, `stop_reason`, `full_review_evidence.{status,commit,tree}` and the unavailable `reason` (state.ts:44, 761, 767, 774-777), and tests/skill-protocols-review-and-prep.test.ts:4353 locks the incomplete sentence. (3) D12 (docs/designs/review-run-state.md:172) puts `scope` on every pass record, but the helper accepts it only on `started`. (4) skills/review-and-prep.md:1656-1657 asks for a fallback `record correction` the helper cannot express; derive already produces it (locked at test 2994). (5) docs/review-run-state-calls.md:28 and 59 never say that cycle 1's `candidate.commit` is B (HEAD), not snapshot S, so the fence precheck (skill 2590-2597) can loop on `write point not reached`. (6) Calls doc row 28 does not order `checkpoint before-fix` after the fence's baseline write, so an interrupted resume can skip the write.
- **Hypothesis (untested):** Make `bin/review-state <command> --help` plus D13 the single shape authority, have the skill and calls doc point to it instead of restating partial shapes, and add a test that feeds every documented example call to the helper's validator. Track 81A's per-shape `Example:` lines are the natural home; re-verify each member against the current helper first. — re-investigate before implementing; the reviewer agent did not verify this direction.
- **Found in:** skills/review-and-prep.md:363-366,1656-1657,4720,4812; docs/review-run-state-calls.md:28,34,36,51,59; docs/designs/review-run-state.md:172; docs/telemetry.md:828-830; src/review-state/state.ts:502-506; tests/skill-protocols-review-and-prep.test.ts:4353,2994
- **Context:** Run-state call shapes in the skill and docs still diverge from the helper
- **Effort:** ? (user triages in /roadmap)

### [full-review:necessary] Evidence-directory paths contradict each other
- **Description:** The skill names three different places for evidence. Members: (1) The runner command at skills/review-and-prep.md:1543 passes `--calls "<evidence-directory>/delegate-calls"`, a per-invocation directory, but 1555 and docs/delegated-review.md:147 require a branch-scoped calls directory kept across invocations. A continuation therefore loses the runner's claim against a second paid call and its stable call ID. Test 2965 locks only 1555. (2) skills/review-and-prep.md:3145-3150 copies the pregate record and documentation section to the evidence root, but under run-state `record gate pregate` and `record audit documentation` need relative paths inside the invocation `--dir` (calls doc :13; state.ts:211-212). Those gate records are then refused, or render as `not-run`. (3) D2 (docs/designs/review-run-state.md:18) cites a `### Evidence directory` heading that does not exist; the definition is in `### Capture evidence and commit`. (4) That definition (skill:3889) comes after the review text, and nothing creates the directory before cycle 1 when run-state is off. The baseline fence's write can then fail with ENOENT, an outcome the skill does not handle and that the write-once rule forbids retrying.
- **Hypothesis (untested):** Define the invocation evidence directory and its creation once, before Step 2. Point every site at it, branch-scope the delegate-calls path in the runner command, and repoint D2. — re-investigate before implementing; the reviewer agent did not verify this direction.
- **Found in:** skills/review-and-prep.md:1543,1555,3145-3150,3889; docs/designs/review-run-state.md:18; docs/delegated-review.md:147; tests/skill-protocols-review-and-prep.test.ts:2965
- **Context:** Evidence-directory paths contradict each other
- **Effort:** ? (user triages in /roadmap)

### [full-review:necessary,files=skills/review-and-prep.md] Repair-only continuation is structurally unreachable under in-cap=full
- **Description:** This is brief item A from mmm-factory's predictable-decisions audit (2026-11-14). The reviewer does save its cycle-1 baseline: 104 `cycle-1-baseline.json` records since 11-07 (45 `true`, 40 `pending-fix-review`, 19 `false`). Repair-only was refused for two separate reasons. (a) 11-08 (mmm-factory 55A, 103A): the records were hand-written in the wrong shape (uppercase `B`/`T`, boolean `completed`, `stages` as an object, `required_probes`), which makes them unreadable, and an unreadable record counts as `record-missing`. 34 of the 104 have this shape, all from 11-07 to 11-09; every record since 11-09 passes the fence shape. (b) 11-13 (the gstack-extend secret-scanner fix, evidence `mmm-4e1309bc-20261112T234241Z`) and 11-14 (mmm-factory 123A, `mmm-745b406c-…`): the policy was `in-cap=full; continuation=repair-only`. Cycle 1 reproduced a probe, so the record says `pending-fix-review`. `cycle-1-fix-review` is written only when cycle 2 runs as an in-cap delta from cycle 1's snapshot (skills/review-and-prep.md:2411-2441); a full-scope cycle 2 writes none. The stop table (2770-2779) therefore always gives `reviewer-incomplete`. Both stop records say this verbatim ("in-cap=full never wrote the delta fix-review"). A reproduced defect in cycle 1 is the usual reason a review reaches its cap, so under in-cap=full repair-only is unreachable exactly when it is needed. Contributing: the baseline section mixes wrapper and upstream step numbers without saying which (2330-2331, 2388-2390, 2416, 2444-2445: "before Step 5 applies any fix"). Secondary: most of the 19 `false` records come from an outside voice returning `unverified (untagged_review)`, or from required plan probes not yet run at the write point.
- **Hypothesis (untested):** Let a completed full-scope cycle 2 that reruns each cycle-1-reproduced probe by its key write `cycle-1-fix-review` with scope `full`, since a full pass covers the fixes at least as well as a delta, and add the matching stop-table row. Alternatively, callers that want repair-only send `in-cap=delta`. Either way, warn at policy activation when `in-cap=full` is combined with `continuation=repair-only`, and qualify upstream steps as "/review's Step N". This is the deferred producer-contract dependency named in docs/designs/review-continuation.md. — re-investigate before implementing; the reviewer agent did not verify this direction.
- **Found in:** skills/review-and-prep.md:2330-2331,2388-2390,2411-2441,2444-2445,2770-2779
- **Context:** Repair-only continuation is structurally unreachable under in-cap=full
- **Effort:** ? (user triages in /roadmap)

### [full-review:necessary,files=skills/review-and-prep.md] post-audit=classify can't settle a tests/tooling/pregate-map repair
- **Description:** This is brief item B from mmm-factory's predictable-decisions audit (2026-11-14). The classify path's not-applied preconditions import **Bound the documentation audit** item 4's broad-fallback list (skills/review-and-prep.md:3166-3167). That list includes "a build, test or install entry point or configuration (… a test-selection map)". The `tests-only` class (3201) covers only test and fixture paths. So a repair confined to a test runner or pregate map stops for the owner even when no doc names it. Evidence: mmm-factory 121C, 11-14. Its two-file runner fix (`.gstack/pregate-tests.py` and `tests/test_pregate_tests.py`) recorded `post-audit: not applied — broad-fallback condition: build/test entry point changed.` and stopped (evidence `mmm-28ba1459-20261114T201508Z/documentation-blocked-pregate-repair.md`). Real runs show three stops with this reason. Classify otherwise works: 48 `post-audit: active` receipts, settling tests-only, todos-only, rename and already-documented changes.
- **Hypothesis (untested):** On the classify path only, drop the test-entry-point and test-selection-map clause from the not-applied preconditions. Add a closed `test-tooling` class for test runners, pregate maps (`.gstack/pregate.json`, pregate runner scripts), test-selection maps and test helpers, under the same literal-search conditions as `tests-only`: no inventoried doc names the changed path or a contract it changes, and no user-visible command, flag, help line or config key changes. A doc that names the runner still forces `documented-behavior`, or `already-documented` with a `path:line` cite. Package manifests, CI workflows and install entry points stay in broad fallback, and the external full-suite gate still runs on the final head. This widens what an opt-in value does, so per SPEC P1 disclose it in the release notes, or ship it as a new value. — re-investigate before implementing; the reviewer agent did not verify this direction.
- **Found in:** skills/review-and-prep.md:3166-3167,3201
- **Context:** post-audit=classify can't settle a tests/tooling/pregate-map repair
- **Effort:** ? (user triages in /roadmap)

### [full-review:necessary] Drift-lock suite mostly freezes wording; two locks keep stale Track refs alive
- **Description:** tests/skill-protocols-review-and-prep.test.ts has 233 tests and 1,672 matchers. About 163 tests (about 2,450 lines) are wording or mostly wording: sentences of guidance that no tool parses. About 15 tests (about 390 lines) guard real contracts or execute fences. Those contracts are the comment markers, the H-B/H-E/H-C fences, the policy grammar line, the capability `grep -F` lines, upstream anchors, receipt templates (`Prepared HEAD`, `Review handoff`, `Delegated part`, `Full-review evidence`, `Post-audit change`, `External gate`) and the baseline/snapshot/PR-body fences, and most of them are locked again in tests/handoff-contract.test.ts, src/review-state/render.ts or src/upstream-check/cli.ts. Stale: test 4282 locks skills/review-and-prep.md:1141 "until Track 79A's default decision" (also in docs/review-run-state-calls.md:5 and :72); the owner split 79A on 2026-11-13 and the decision is now Track 81B. Test 4452-4459 locks D14's placement in "79A part 2", now 81B/82A. Duplicates: 14 host-placeholder slice checks (audit-compliance group E covers every skill line); 48 repeated literals of 40+ characters; the policy line asserted 8+ times across two files; the H-B and `Delegated part` templates asserted twice; five capability tests that only test grep. Cross-skill: about 35 ship-and-land sentences and about 45 calls-doc sentences are locked from this suite, so a prose edit there fails it. Contradiction kept alive: tests 256-265 lock both the E6 "asked once" template and the re-ask rule. Cost: every prose cut in the skill trips several sentence locks, and one receipt-site list has already drifted while its locks stayed green.
- **Hypothesis (untested):** First delete the plain duplicates (about 285 test lines) and fix the 79A references (or drop Track IDs from shipped text). Then, during each section's skill diet, apply the consistency auditor's loosen list: keep contract tokens, fences and ordering checks, and delete or anchor the sentence locks (up to about 1,500 more test lines). The full loosen list is in the /full-review session report (`~/.gstack/projects/kbitz-gstack-extend/full-review/report.md`). — re-investigate before implementing; the reviewer agent did not verify this direction.
- **Found in:** tests/skill-protocols-review-and-prep.test.ts:4282,4452-4459,256-265,542,2595,2653,2869,3165-3166,3536-3537,4274,4363-4365; skills/review-and-prep.md:1141; docs/review-run-state-calls.md:5,72; docs/designs/review-run-state.md:241-244
- **Context:** Drift-lock suite mostly freezes wording; two locks keep stale Track refs alive
- **Effort:** ? (user triages in /roadmap)

### [full-review:nice-to-have] Rules duplicated across sites have drifted
- **Description:** Several rules in skills/review-and-prep.md are written at several sites, and some copies already disagree. (1) The list of conditional receipt lines appears three times (cap stop 2704-2718, pause 4044-4050, readiness 4707-4729). The stop adds `Review arm:` and `Folded checklist:` unconditionally while readiness and the fold section (1827) gate them on `specialists=fold`, and the stop list omits the `repair-review:`, `Repair *` and `Final-gate repair` lines that test 2484 says it carries. The `Delegated part:` template is pasted twice (4720, 4812). (2) The light default has 11 "It never sets `<key>`" bullets with differing rationales (1182-1211), while run-state's sits in its own bullet (1139). (3) Caller-rollout boilerplate ("reads the whole line as `none supplied` … waives no gate") is repeated in 10 policy bullets (938-1156), though docs/workflow-handoffs.md:860-1060 owns caller rollout. (4) The readiness exceptions for test gaps and `blocking=shown` are stated twice (2192-2198 vs 4586-4591; 2312-2317 vs 4591-4595), although 1091-1092 says the section is the single statement. (5) The waiver procedure appears in delegate, fold and adversarial-pass (1610-1652, 1792-1810, 1834-1840). Upstream anchor lists appear 2-3 times (1462-1487, 1725-1752, 1844-1853). The run-state rules are stated three times (183-189, 1130-1145, calls doc). Eight `<extend-root>` resolution phrases chain cross-references, and the one at 1269 is wrong. (6) The cap stop has a prose ordering of unavailable reasons directly above the table that decides the same thing (2763-2768). (7) The E6 exit template prints "asked once for this PR" (4348, 4447) although E6 is re-asked after each wait (4354). Estimated skill cut: about 165 lines.
- **Hypothesis (untested):** One receipt-line table (line, condition, receipt kinds) that the three sites point to. One light-default allow-list sentence. One opt-in-value preamble that points to workflow-handoffs.md. Readiness points to each section's **Readiness** paragraph. Define the waiver procedure once and `<extend-root>` once (as the preamble's root). Keep the stop table and drop the prose ordering. Make the E6 template conditional. Check whether the stop and pause omissions are intentional before merging the lists. — re-investigate before implementing; the reviewer agent did not verify this direction.
- **Found in:** skills/review-and-prep.md:938-1156,1182-1211,1269,1462-1487,1610-1652,2192-2198,2312-2317,2704-2718,2763-2768,4044-4050,4348,4586-4595,4707-4729,4812
- **Context:** Rules duplicated across sites have drifted
- **Effort:** ? (user triages in /roadmap)

### [full-review:nice-to-have] Content the skill restates or carries instead of pointing to its owner
- **Description:** (1) A 140-line inline Bun program, the full-review record fence (skills/review-and-prep.md:2517-2658), validates the baseline schema and reads internals of `review-run-state.json` (`passes`, `gates`, `required_voices`). docs/review-run-state-calls.md:5 says that file is internal, and CLAUDE.md's Design rule puts mechanics in `bin/`/`src/`. A helper schema change can break the fence with no type check, and the tests have to extract it from markdown (test 1492-2051). (2) Workflow metrics (222-412, plus the span rules) restates docs/telemetry.md almost word for word, about 150 lines on every invocation. tests/skill-protocols.test.ts:1745-1784 enforces that copy on purpose (telemetry.md:1259). **Owner question:** whether to replace it with section pointers is decided when the skill is dieted (owner, 2026-11-15). (3) Maintainer and history notes are sent on every run (487-490, 4352-4361, 3565-3567). (4) The skill embeds the TODOS `Base issue:` entry form (2264-2275), which docs/source-tag-contract.md does not define, although producers are meant to match that contract. Estimated skill cut: about 300 lines (about 150 if the telemetry copy stays).
- **Hypothesis (untested):** Move the fence to a `bin/` helper with a `--help` contract and a one-line invocation. Move the history notes to docs/acceptance or the design record. Add the base-issue form to the source-tag contract and point to it. Decide the telemetry copy at diet time, measuring whether agents still place span boundaries correctly. — re-investigate before implementing; the reviewer agent did not verify this direction.
- **Found in:** skills/review-and-prep.md:222-412,487-490,2264-2275,2517-2658,3565-3567,4352-4361; tests/skill-protocols.test.ts:1745-1784; docs/source-tag-contract.md:213-221
- **Context:** Content the skill restates or carries instead of pointing to its owner
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
