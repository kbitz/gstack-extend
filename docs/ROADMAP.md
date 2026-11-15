# Roadmap

Organized by lifecycle state: **In Progress**, **Current Plan**, **Future** and
**Shipped**. A Track is one PR/session. The packer assigns Groups of disjoint
file footprints and their launch dependencies. Explicit scheduling edges carry
the owner's priority order, and each card's **Scheduling:** line separates its
priority choices from technical prerequisites.

**Spec revision, 2026-11-07.** The owner revised [SPEC](SPEC.md): 1.0.0 is the
owner's own real use, by hand and through an orchestrator, and the public
release (the owner's "2.0") is the next stage; no single workspace host is
required, because a published orchestration contract (O4) says what a host or
orchestrator must provide, and O3 is evidenced by two real drivers; bounded,
measured stage effort is outcome O6. The owner's answers that shaped this plan
(2026-11-07): "1 - a", "2 yes", "3 yes", "70b yes future", "71a yes kill",
"70a ok", "72c ok", "72a confirm" and "72d confirmed as well", using that day's
labels. The pair-review redesign ("pair-review design: yes"), the Codex sandbox
fix ("let's do everything under our control though to resolve this") and the
retirement of `/autoplan-lean` ("yes, kill autoplan-lean") were approved the
same day, as were capturing the owner's hand use in telemetry ("we need to make
sure telemetry captures my use by hand") and labelled release-note disclosures
in plans and review handoffs ("sure if necessary").


**Order.** The owner's first priorities (2026-11-08: "contract gaps and
attacker parts is first priorities") have shipped, and so has most of the review
run-state redesign (owner, 2026-11-10: "2 sure", then "yes re: card rewrite"),
through resume (Track 79A part 1, v0.93.0), the delegated-part fix (80A,
v0.93.2) and the helper hardening (81A, v0.94.0). The owner split Track 79A on
2026-11-13 ("1 - approved", "2 - sounds good"); what remains of it is the
measurement and default decision on real runs (Track 84B) and, only if that
decision adopts the recorded path, the default-promotion items (87A) and the
default with the slimmer skill (88A). The caller fix in flight (82A) and the
remaining run-state call-shape and evidence-directory fixes (83A) come first,
because the after-runs 84B counts cannot record while those refusals remain. On
2026-11-15 the owner approved a scoped clean-up pilot of `/review-and-prep`
("clean-up -- approve 1-4"; "5-7; approve as you recommend") and merged its
cards ("merge 83A with 84A and 86A with 87A", "1 - yes"): its manifested fixes
(83A, 84A) go first, then the skill diet, which loosens the wording locks before
the prose cuts they block (85A) and moves the record fence into a helper (86A).
The two-driver workflow qualification (Track 89A) stays behind the run-state and
review Tracks, as the owner chose ("Wait for run-state"), then the O6
measurement and decisions (90A) beside the stable update channel the owner
placed "right before 1.0" (90B), then aligning install and upgrade with gstack
(91A). The owner-run records (Tracks 82B and 82C) can run whenever the owner has
time; only 82B gates anything (Track 90B, which appends to its record). Owner,
2026-11-08: "A but keep 72c and 78a for 1.0", approving a proposal that moved
the review-finding records to Future and kept docs-only test selection (since
shipped) and the gstack alignment (now Track 91A) as 1.0 work.

**Keep moving; park only what we should not do.** Owner rule (2026-11-05): "we
never want to 'park' something -- we always want to find a way to keep moving
forward". A stalled or blocked Track is unblocked, split or rerouted, not set
aside. "parking is an option when it turns out we shouldn't even do a track,
because it's counter to our objectives, then it would make sense to park and
re-evaluate".

**Dropped: Track 35B.** The `full-suite=before-audit` value was dropped rather
than renumbered (2026-10-31): under `full-suite=final` and
`full-suite=external` the full suite already runs once on the final content,
after the documentation audit (`skills/review-and-prep.md`, Review policy
section and the external gate's slot), so that value has no second full suite
to avoid, and no caller has asked for it. Under `full-suite=external` the
pregate's selected test lanes ran a second time after the caller's accepted
full-suite pass (corrected 2026-11-01); the v0.60.0 pregate narrowing skips
that repeat when the attested command covers every selected test. That is a
different repetition from the one 35B targeted, so 35B stays dropped and its
design item E3 stays marked dropped in the
[efficiency program](designs/workflow-efficiency-program.md); reinstating it is
the owner's decision.

**Card size.** A Track estimated above about 300 authored lines, counting its
tests, is split into separate Tracks unless splitting would leave a Track that
cannot ship alone. Byte-copied shared blocks and generated text do not count
toward that threshold. Do not split when the resulting Tracks would edit the
same files and must run one after another anyway, because each Track costs a
full pipeline run. A card kept above the threshold says why on its
**Scheduling:** line, and a card with copied or generated lines states them
separately from authored ones (owner rule, 2026-10-26). Track 31A was already in
progress when the rule was adopted and has shipped. Applied 2026-10-26 to three
Track pairs that edit the same files and run in sequence: each pair is now one
card, with the reason on its Scheduling line; the review-fix policy pair stayed
split on purpose (both Tracks have shipped, 33A in v0.55.0 and 51A in v0.59.0;
the reason is on 51A's shipped receipt).


**Labels.** This regeneration (2026-11-15) recorded Tracks 80A, 80B and 81A,
numbered two merged changes that carried no Track ID as 80E and 80F, kept the
unfinished remainder of Track 80D active (now 82C), retired Groups 80 and 81 by
tombstone and relabelled the remaining work from Group 82 in packer order; the
renames are in its commit message. Shipped numbers through 81 are reserved by
tombstones; 64 was never a roadmap Group.

Target: [SPEC](SPEC.md) O1–O6, 1.0.0 as the owner's own real use by hand and
through an orchestrator; audience ceiling potentially-public. No workspace host
or orchestrator is required; support claims name only exercised combinations.
Implementation, installed/operator evidence and owner acceptance remain
distinct. No new spend or unattended merge is authorized.

## In Progress

Track 82A (the orchestrator's item fa720a73) is in flight, declared active by the manager on 2026-11-15. Its Group's other two Tracks are owner-run records that share no file with it. Tracks 80A, 80B and 81A, and two merged changes without a Track ID (now 80E and 80F), shipped since the last regeneration and are recorded in shipped history; Track 80D merged its hand-use record and left its review-run rows open (now 82C). O1 and O3–O6 remain pending; O2 was accepted on 2026-10-23.

### Group 82: Caller output reliability ∥ owner-run install and review records

_Depends on: none_

**This group delivers:** Orchestrated reviews that keep their run state when they send a runner entry or a candidate tree, an `/implement` handoff that always states its deferred and blocked counts, and, whenever the owner runs them, the install/upgrade/recovery qualification and the remaining dated records of real review runs.

##### Track 82A: Caller output reliability: run-state payloads and the implement coverage line
_4 tasks . ~260 LOC incl. tests . medium risk_
**Outcome:** Orchestrated reviews that send a delegated part's runner entry or a candidate's Git tree keep recording their run state, and every `/implement` handoff opens its `Coverage:` line with the deferred and blocked counts, zeros included.
**Supports:** [SPEC](SPEC.md) O6.1 (complete stage records) and O3.1 (`/implement` hands off complete scope); the owner's 2026-11-15 approval ("run state caller fix -- yes, unless it can fold int w/ another upcoming track"). In progress as the orchestrator's item fa720a73 (planned, implementing on 2026-11-15); declared active by the manager, so this regeneration records it and does not re-place it.
**Done when:** The item's approved plan holds: both observed refusals (`record pass` attempt `delegate.call_id`, `record pass` started `candidate.tree`) are classified in D15 and fixed or filed with a reason, with replay tests; a `candidate.tree` that differs from the commit's tree and a `delegate.part` that names another part are refused; every key the delegate runner prints in a `parts[]` entry is stored or a listed accepted extra, locked by a test; `/implement`'s handoff always carries `Coverage: <n> DEFERRED BY USER, <n> BLOCKED; ` and a check before emitting; output without `run-state=record` is byte-unchanged; D15 restates the success target (three consecutive recordings with delegated parts).
_touches: src/review-state/state.ts, tests/review-state.test.ts, docs/designs/review-run-state.md, docs/review-run-state-calls.md, tests/skill-protocols-review-and-prep.test.ts, skills/implement.md, tests/skill-protocols-implement.test.ts_
**Scheduling:** Declared active (pinned). Tracks 83A–86A edit the same files after it.
_Source: the orchestrator's item fa720a73 and its approved plan (2026-11-15)._
- **Accept `candidate.tree` when it is the commit's tree** -- Optional `tree` checked against the resolved tree on record and replay. _~60 lines incl. tests._ (S)
- **Accept the runner's `parts[]` entry as `delegate`** -- Validate the runner keys, store the eleven-key projection, add a delegated-attempt `--help` example and the `PART_KEYS` lock. _~110 lines incl. tests._ (M)
- **Classify both causes and restate the success target** -- D15 rows, the calls-doc sentences and their locks. _~50 lines._ (S)
- **Unconditional `/implement` coverage line** -- Fill-in wording, the unconditional rule and the pre-emit `grep` check, with tests. _~40 lines incl. tests._ (S)

##### Track 82B: Qualify install, upgrade and recovery on the owner's machines
_2 tasks . ~160 LOC . medium risk_
**Outcome:** The owner can install, onboard, upgrade and recover a working skill set on a fresh machine from the published instructions, with evidence of what was actually installed.
**Supports:** [SPEC](SPEC.md) O1 (all three criteria) and O5.2; the preserved published three-part upgrade obligation from Track 28A planning (2026-10-23), whose trigger was met by v0.48.0.
**Done when:** A dated record names the OS, host, harnesses and versions of a fresh install and project onboarding on the owner's machine, actionable failures for a missing prerequisite, an upgrade with user-owned files preserved and stale copies reported, a working recovery path, and a real legacy four-part install upgraded through the default remote with offered and installed commit/tag identity, reader compatibility and unchanged user state; it records the actual installed commit and discloses that upgrade offers follow main rather than a release identity; failures stay open; the owner confirms before O1 counts.
_touches: docs/acceptance/install-upgrade.md (new)_
_blocked-by: Track 70A, Track 28A_
**Scheduling:** Technical edge on Track 70A (shipped, v0.72.0): the qualified upgrade includes removing the retired skill. Candidate or file-remote proof does not satisfy the published-upgrade obligation. It waits on the owner's time and gates only the stable-channel Track 90B, which appends to its record.
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Fresh install, onboarding, upgrade and recovery** -- Run them on the owner's machine from the published instructions and record each step, intervention and result. _~90 lines._ (M)
- **Published three-part upgrade from a legacy install** -- Upgrade a real four-part install through the default remote and record offered and installed identity, reader compatibility, recovery and unchanged state beside `docs/acceptance/release-compatibility.md`. _~70 lines._ (M)

##### Track 82C: Record the owner's remaining real review runs
_2 tasks . ~90 LOC . low risk_
**Outcome:** The owner can see from dated records that a by-hand review with no caller lines still runs as before, that the attacker parts run with per-part models when an orchestrator delegates them, and that tools-mode delegation works on an installed release.
**Supports:** [SPEC](SPEC.md) O6 and P1, O3.3 (the by-hand driver's evidence) and O4.4. The remainder of the earlier Track 80D (PR #256, v0.94.2), which recorded and qualified the hand-use rows (`docs/acceptance/hand-use-telemetry.md`, `Status: qualified`, 2026-11-15) and left attacker-parts PM1 and PM2 and tools-mode PM1 pending; the open acceptance of Track 72B (PR #221) and the post-release PM1 of the owner-approved tools-mode plan (PR #229).
**Done when:** (1) `docs/acceptance/attacker-parts.md` records PM1 (one real by-hand `/review-and-prep` with no `Review policy:` or `Review delegates:` line, read back as unchanged, with its invocation and receipt retained) and PM2 (one orchestrated run with `delegate=adversarial,red-team` mapping the two parts to different providers or models, with its `Delegated part:` lines, v3 attempts, `found_by` labels and any fallbacks), each with date, revision, host and harness versions and PR. (2) `docs/acceptance/delegate-tools-mode.md` records its PM1 installed paired run and names the exact reviewed content its earlier dry-run evidence covers. (3) A failed, unavailable or wrongly read-back run stays recorded as open, never as passed, and a wrong read-back is filed as a defect.
_touches: docs/acceptance/attacker-parts.md, docs/acceptance/delegate-tools-mode.md_
**Scheduling:** No edges; it gates no other Track. PM2 already has partial observations (PRs #250 and #253 and a consumer repository's review) and waits only on harness CLI version provenance, which the run's operator can record from the harness at run time; tools-mode PM1 waits on the orchestrator's paired tools-mode run, requested on 2026-11-15.
_Source: PR #256's receipt (2026-11-15: "attacker PM1/PM2 and paired tools-mode qualification remain pending"); `docs/acceptance/attacker-parts.md` and `docs/acceptance/delegate-tools-mode.md` (PM rows pending)._
_read-first: docs/delegated-review.md_
- **Attacker parts PM1 and PM2** -- Run and read back one by-hand review with no caller lines, and finish PM2's harness version provenance. _~50 lines._ (S)
- **Tools-mode PM1 and provenance** -- Record the installed paired run and name the content the dry-run record covers. _~40 lines._ (S)

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81_

### Group 83: Run-state call shapes and evidence paths

_Depends on: Group 82_

**This group delivers:** Opted-in reviews whose documented calls and evidence paths match what the review-state helper and delegate runner accept, with each remaining refusal classified and delegate-call claims kept across continuations.

##### Track 83A: Make the documented run-state calls and evidence paths match the helper
_4 tasks . ~330 LOC incl. tests . medium risk_
**Outcome:** An orchestrated `/review-and-prep` that follows the skill and the calls document sends only shapes `bin/review-state` accepts and keeps its evidence where the helper and the delegate runner read it, so opted-in runs stop falling back to `Run state: unavailable` partway through, a continuation keeps its delegate-call claims, and the first baseline write never fails on a missing directory.
**Supports:** [SPEC](SPEC.md) O6.1 (complete stage records, unavailable values explicit), O3.2 (no repeated completed work, here a second paid delegate call; no lost records) and P1 (before and after on real runs, which Track 84B measures). Manifested: the 2026-11-15 `/full-review` pilot counted 29 of 47 orchestrated evidence directories with a `Run state:` line ending `unavailable`; besides `delegate.call_id` and `candidate.tree` (Track 82A) and `start policy.delegation.parts` (fixed in PR #253), the refusals were on `details.captures`, `findings[].adjudication`, `required_voices`, `start policy.source` and a missing `record` subtype, which D15 does not classify yet. The helper still accepts null only for `cache_creation_input_tokens` among a delegate's counts (`src/review-state/state.ts`, the attempt branch's `delegate` validator), while the skill and `docs/telemetry.md` allow null `wall_ms` and token counts, which the runner emits for a part it fell back on. On the supported path the runner command passes `--calls "<evidence-directory>/delegate-calls"`, a per-invocation directory, while the skill's next paragraph and `docs/delegated-review.md` require a branch-scoped one, and the pregate record and documentation section are copied outside the invocation `--dir` that `record gate pregate` and `record audit documentation` resolve against.
**Done when:** (1) Each refusal kind above that D15 and Track 82A do not already cover is classified in D15 against the current helper and fixed or documented, with a replay test for each fixed kind. (2) The skill, `docs/review-run-state-calls.md`, D12/D13 and `docs/telemetry.md` agree with the helper on: a delegated attempt's null `wall_ms` and token counts (stored as explicit unknowns and rendered `unknown`, or one documented refusal path; the plan chooses, under SPEC O6.1's unknowns-never-zeros rule); the complete `finish stopped` shape (`base`, `stop_reason`, `full_review_evidence` and the unavailable `reason`); which records carry `scope`; the fallback correction `derive` already produces, so the skill no longer asks for a `record correction` the helper cannot express; cycle 1's `candidate.commit` being B (HEAD), not snapshot S; and `checkpoint before-fix` ordered after the baseline fence's write. (3) The invocation evidence directory and its creation are defined once, before Step 2, whatever the run-state value, and every site points at that definition; the runner command's `--calls` path is the branch-scoped directory, so a continuation reuses its claims and call IDs; under `run-state=record` the pregate record and documentation section sit where `record gate pregate` and `record audit documentation` accept them; D2 cites the heading that defines the directory. (4) A test feeds every example call in the calls document and every `--help` example to the helper's validator, and tests lock the single directory definition and the corrected runner command. (5) The recorded test gaps in its tasks have tests. (6) The release notes disclose any newly accepted shape.
_touches: src/review-state/state.ts, src/review-state/render.ts, src/review-state/export.ts, tests/review-state.test.ts, skills/review-and-prep.md, docs/review-run-state-calls.md, docs/designs/review-run-state.md, docs/telemetry.md, docs/delegated-review.md, tests/skill-protocols-review-and-prep.test.ts_
_blocked-by: Track 82A_
**Scheduling:** Technical edge on Track 82A, which edits the helper, its tests, the calls document and D15 first; this card holds only the remainder of the pilot's call-shape finding, not the keys 82A fixes. Kept as one card above ~300 lines at the owner's direction (2026-11-15: "merge 83A with 84A", "1 - yes"), under the card-size rule's same-files exception: both parts edit the skill, the design and calls documents and the same test files in sequence. Track 84B's after-runs wait on it.
_Source: inbox `[full-review:necessary]` "Run-state call shapes in the skill and docs still diverge from the helper" and "Evidence-directory paths contradict each other" (owner approved, 2026-11-15); recorded test gaps `[review:files=src/review-state/state.ts|tests/review-state.test.ts]` (Track 80A's review, 2026-11-13, and PR #253's, 2026-11-14), `[review:files=docs/designs/review-run-state.md|docs/review-run-state-calls.md|tests/skill-protocols-review-and-prep.test.ts]` (PR #255's review, 2026-11-15) and `[review:files=src/review-state/render.ts|tests/review-state.test.ts]` (PR #254's review, 2026-11-14)._
_read-first: docs/review-run-state-calls.md, docs/designs/review-run-state.md, docs/delegated-review.md_
- **Classify the remaining refusals and settle null delegate counts** -- Re-verify each refusal kind against the current helper, fix or document it with a replay case, and make the null-count rule one rule across helper, renderer and export. _~100 lines incl. tests._ (M)
- **Correct the documented shapes and define the evidence directory once** -- The `finish stopped` shape, `scope` placement, the fallback correction, cycle 1's candidate and the `before-fix` ordering in the skill, the calls document and D12/D13; one evidence-directory definition before Step 2, the branch-scoped `--calls` path, in-directory gate and audit records, and D2's locator. _~120 lines incl. tests._ (M)
- **Validate every documented example** -- One test that runs each example call and `--help` example through the validator. _~40 lines._ (S)
- **Recorded test gaps** -- `start` delegation `parts` shapes and non-string entries, omitted, malformed and duplicate `tools`, and root `continuation` type advice; the diagnostic escaping rule pinned in both the design and calls documents; render `--help` examples run through real validation with matching evidence; re-verify each contract first. _~60 lines._ (S)

### Group 84: Capped-review continuation and test-tooling repairs ∥ run-state measurement and default decision

_Depends on: Group 83_

**This group delivers:** Repair-only continuations that are reachable after a full second cycle, test-tooling repairs that settle under `post-audit=classify`, and a measured adopt, reject or insufficient-evidence decision on making the recorded run state the review default.

##### Track 84A: Let a capped review continue after a full second cycle, and settle test-tooling repairs under classify
_3 tasks . ~180 LOC incl. tests . medium risk_
**Outcome:** Under `in-cap=full; continuation=repair-only`, a review whose first cycle reproduced a defect can still take the repair-only continuation, and under `post-audit=classify` a repair confined to a test runner, pregate map or test helper settles without an owner stop.
**Supports:** [SPEC](SPEC.md) O3.2 (no needless owner stop, with approval rules and stop conditions kept) and P1 (opt-in values keep today's default; a widened value is disclosed). Manifested: two real capped reviews (2026-11-13 and 2026-11-14) stopped `reviewer-incomplete` because a full-scope cycle 2 writes no `cycle-1-fix-review` record; three real post-audit stops recorded `broad-fallback condition: build/test entry point changed` for a repair confined to a test runner and its test (2026-11-14).
**Done when:** (1) A completed full-scope cycle 2 that reruns each cycle-1-reproduced probe by key writes `cycle-1-fix-review` with scope `full`, and the skill's stop table and `docs/workflow-handoffs.md` gain the matching row; or the plan shows why that is unsafe and the skill directs repair-only callers to `in-cap=delta`. Either way, activation warns when `in-cap=full` is combined with `continuation=repair-only`, and the baseline section names upstream steps as "/review's Step N". (2) On the classify path only, a closed `test-tooling` class covers test runners, pregate maps, test-selection maps and test helpers under the `tests-only` literal-search conditions; package manifests, CI workflows and install entry points stay broad fallback, a doc that names the runner still forces `documented-behavior` or a cited `already-documented`, and the external full-suite gate still runs on the final head. (3) Tests cover both. (4) The release notes disclose the widened opt-in values.
_touches: skills/review-and-prep.md, docs/workflow-handoffs.md, tests/handoff-contract.test.ts, tests/skill-protocols-review-and-prep.test.ts_
_blocked-by: Track 83A_
**Scheduling:** Kept as one card: both change review stop rules in the same skill sections and test files and would otherwise run one after the other (card-size rule). The edge on Track 83A is technical (same files); the run-state fixes go first because Track 84B waits on them.
_Source: inbox `[full-review:necessary,files=skills/review-and-prep.md]` "Repair-only continuation is structurally unreachable under in-cap=full" and "post-audit=classify can't settle a tests/tooling/pregate-map repair" (the orchestrator's predictable-decisions audit, items A and B, 2026-11-14; owner approved 2026-11-15); item (1) of the Future entry "Reproduced-defect baseline follow-ups", whose trigger these stops meet._
_read-first: docs/workflow-handoffs.md_
- **Fix review after a full second cycle** -- Write `cycle-1-fix-review` from a full-scope cycle 2 that reruns each reproduced probe, with its stop-table row, or route repair-only callers to `in-cap=delta`. _~90 lines incl. tests._ (M)
- **Warn on the unreachable combination and name upstream steps** -- Activation warning and "/review's Step N" in the baseline section. _~30 lines incl. tests._ (S)
- **Test-tooling class under classify** -- The closed class, its conditions and its tests. _~60 lines incl. tests._ (M)

##### Track 84B: Measure the recorded run-state path on real runs and decide its default
_2 tasks . ~120 LOC . low risk_
**Outcome:** The owner can read, from real opted-in runs, whether recording the review run state cut bookkeeping cost while keeping every output and finding, and see an adopt, reject or insufficient-evidence decision on making it the default.
**Supports:** [SPEC](SPEC.md) O6.2–O6.3 and P1 (a default changes only on measured evidence; individual optimizations do not gate 1.0); efficiency-program candidate E15; the owner-approved 79A part 2, 2026-11-13 ("1 - approved").
**Done when:** (1) `docs/acceptance/review-run-state.md` records E15's before figures and after figures from real opted-in runs within E15's bound (at least four, two by hand by the owner and two orchestrated, within six weeks of Track 78A's release in v0.92.0, so by about 2026-12-25), measured with the same caller-owned scripts identified by digest, with sample size, unknowns, each segment's record completeness and the adoption threshold the owner set before the after-runs started; it also reports what the opted-in reviews asked to measure: capture lost when the first derive cannot bind, whether a helper-missing activation suppresses Step 1's spans, the always-loaded pointer and fence overhead, and the installed caller journey (activation, start and derive, voice and probe records, pause and resume, degraded capture, finish) with unchanged outward lines. (2) The record states adopt (the recorded path becomes the default through Tracks 87A and 88A), reject, or insufficient evidence naming the missing data and a bounded next measurement, and decides whether a default needs per-record `seq` and `input_sha256` or records them as dropped with the reason. No default changes in this Track.
_touches: docs/acceptance/review-run-state.md (new), docs/designs/workflow-efficiency-program.md_
_blocked-by: Track 83A, Track 80A, Track 79A_
**Scheduling:** Technical edge on Track 83A, the last of the run-state fixes (Tracks 82A and 83A): until they land, orchestrated reviews keep refusing payloads and gate records, so after-runs would not record. It also waits on real runs, which no Track supplies: the orchestrator's opted-in reviews and the owner's by-hand ones. If the window closes short of the bound, the record says insufficient evidence. It shares no file with Tracks 84A–86A and runs beside them.
_Source: owner-approved card "Track 79A (part 2)", items 1, 2 and 5 (2026-11-13); E15 in `docs/designs/workflow-efficiency-program.md`; the opted-in reviews' measurement requests `[review:files=docs/review-run-state-calls.md|skills/review-and-prep.md]` and `[review:files=skills/review-and-prep.md|docs/designs/review-run-state.md]` (PR #244, owner "accept the reviews", 2026-11-12)._
_read-first: docs/designs/workflow-efficiency-program.md, docs/designs/review-run-state.md_
- **Record before and after on real runs** -- The acceptance record with every figure, unknown and requested measurement. _~90 lines._ (M)
- **Decide the default** -- The adopt, reject or insufficient-evidence decision with its evidence, and the `seq` and `input_sha256` decision. _~30 lines._ (S)

### Group 85: Review lock loosening and one statement per rule

_Depends on: Group 84_

**This group delivers:** A `/review-and-prep` whose tests lock contracts, not wording, and whose rules are each stated once, with restated content pointing to its owner.

##### Track 85A: Loosen /review-and-prep's wording locks and state each rule once
_4 tasks . ~210 LOC authored, plus ~1,800 deleted test lines and ~330 deleted skill lines . medium risk_
**Outcome:** An edit to `/review-and-prep`'s prose fails a test only when it breaks a contract a tool or caller reads, the skill loads about 300 fewer lines on every invocation, each of its rules is stated once, and the copies that had drifted agree.
**Supports:** [SPEC](SPEC.md) P1 and O6 (recurring model-work savings, keeping published handoffs, receipt formats, approval rules and stop conditions locked) and the owner's skill-diet pilot (2026-11-15, clusters "5-7; approve as you recommend"). The pilot found copies that already disagree: the stop's conditional receipt lines differ from readiness's, one `<extend-root>` resolution phrase is wrong, and the E6 exit template prints "asked once" although E6 is asked again after each wait.
**Done when:** (1) Plain duplicate locks are gone: host-placeholder slice checks that audit-compliance group E already covers, repeated long literals, the repeated policy-line, H-B and `Delegated part` assertions, and capability tests that only test `grep`. (2) Following the consistency auditor's loosen list, sentence locks are deleted or anchored, while every contract lock it names (comment markers, the H-B, H-E and H-C fences, the policy grammar line, capability `grep -F` lines, upstream anchors, receipt templates, Greptile status strings, executable fences and frontmatter) still fails when its contract is mutated; `/ship-and-land` and calls-document sentences are no longer locked from this suite; the stale Track 79A references in the skill, the calls document and D14, and their locks, name Track 84B or drop the Track ID. (3) One receipt-line table (line, condition, receipt kinds) replaces the three lists, after checking whether the stop and pause omissions are intentional; the light default has one allow-list sentence; one opt-in-value preamble points to `docs/workflow-handoffs.md`'s caller rollout; readiness points to each section's **Readiness** paragraph; the waiver procedure, the upstream anchor lists, the run-state rules and `<extend-root>` are each defined once; the stop table replaces its prose ordering; the E6 template says "asked once" only when it was. (4) Maintainer and history notes move to the design record or acceptance documents, and the `Base issue:` TODOS form is defined in `docs/source-tag-contract.md`, with the skill pointing there. (5) Every kept contract lock passes unedited after the cuts, and the PR states the suite's test and line counts and the skill's line and byte counts before and after (`wc -lc skills/review-and-prep.md`).
_touches: tests/skill-protocols-review-and-prep.test.ts, tests/skill-protocols.test.ts, skills/review-and-prep.md, docs/review-run-state-calls.md, docs/designs/review-run-state.md, docs/source-tag-contract.md, tests/audit-compliance.test.ts, docs/acceptance/review-fix-policy.md_
_blocked-by: Track 84A_
**Scheduling:** The pilot requires the lock loosening before the prose cuts it blocks; the owner merged the two into one card (2026-11-15: "merge 86A with 87A", "1 - yes"), so the locks go first within it. It follows the fixes because they are manifested and change locked sentences in the same files (technical edge on Track 84A). Deletions are cheap (weight S); session weight 6.
_Source: inbox `[full-review:necessary]` "Drift-lock suite mostly freezes wording; two locks keep stale Track refs alive", `[full-review:nice-to-have]` "Rules duplicated across sites have drifted" and items 2 and 4 of "Content the skill restates or carries instead of pointing to its owner" (owner approved, 2026-11-15); the loosen list in that `/full-review` session's report._
_read-first: docs/workflow-handoffs.md_
- **Delete duplicate and wording locks** -- Plain duplicates (~285 lines) and the sentence locks on the loosen list (~1,500 lines), keeping the named contract tokens. _~1,800 lines (del)._ (S)
- **Mutation-check the kept contracts and fix stale Track references** -- Each kept contract lock fails on a mutation of its contract; the shared suite's sentence locks become a negative named-host check; the 79A references and their locks. _~150 lines._ (M)
- **Delete the duplicate statements** -- Repeated lists, bullets, boilerplate and procedures in the skill. _~330 lines (del)._ (S)
- **One statement per rule** -- The receipt-line table, the allow-list sentence, the opt-in preamble, readiness pointers, the single waiver, anchor, run-state and `<extend-root>` definitions, the conditional E6 template, and the history notes and `Base issue:` form moved to their owners. _~110 lines._ (M)

### Group 86: Full-review record fence helper

_Depends on: Group 85_

**This group delivers:** The full-review record check as a helper command with a `--help` contract instead of an inline program, and the owner's decision on the skill's telemetry copy carried out.

##### Track 86A: Move the full-review record fence into a helper and decide the telemetry copy
_3 tasks . ~270 LOC incl. tests, plus ~140 deleted skill lines and the markdown-extraction tests it replaces . medium risk_
**Outcome:** The full-review record check runs as a helper command with a `--help` contract instead of a 140-line inline Bun program, so a run-state schema change fails a typed test rather than a real review, and the owner's decision on the skill's copy of the workflow-metrics rules is carried out.
**Supports:** [SPEC](SPEC.md) O3.2 (a stage never invents completion) and P1 (recurring savings), and `CLAUDE.md`'s Design rule (mechanics in helpers); the owner's skill-diet pilot (2026-11-15). Today the fence validates the baseline schema and reads `review-run-state.json`'s internal `passes`, `gates` and `required_voices` keys, which the calls document declares internal, and its tests extract it from the skill's markdown.
**Done when:** (1) The fence's checks run from one helper command (a `bin/review-state` subcommand or a separate `bin/` helper; the plan chooses, and a separate helper widens `_touches:` and re-packs) with `--help`, reading the run state through the state module; the skill calls it in one line; its accept and refuse cases, exit codes and the messages the skill reads are unchanged and tested directly; the tests that extract the fence from markdown are replaced. (2) The owner decides whether the Workflow metrics copy becomes section pointers to `docs/telemetry.md`; if so, the copy lock in `tests/skill-protocols.test.ts` changes with it and the PR shows span boundaries are still placed correctly; if not, the copy stays. (3) The PR states the skill's line count before and after.
_touches: src/review-state/fence.ts (new), src/review-state/cli.ts, tests/review-state.test.ts, skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, docs/designs/review-run-state.md, docs/telemetry.md, tests/skill-protocols.test.ts_
_blocked-by: Track 85A_
**Scheduling:** Technical edge on Track 85A (same skill and test files). The last diet Track; the owner question on the telemetry copy is asked here (owner, 2026-11-15: decided "when the skill is dieted"). Session weight 6.
_Source: items 1 and 3 of inbox `[full-review:nice-to-have]` "Content the skill restates or carries instead of pointing to its owner" (owner approved, 2026-11-15)._
_read-first: docs/designs/review-run-state.md_
- **Fence helper command** -- The checks, the `--help` contract and direct tests. _~250 lines incl. tests._ (L)
- **Decide the telemetry copy** -- Ask the owner, then point or keep, with its test. _~20 lines._ (S)
- **Replace the inline fence** -- One-line call in the skill; delete the inline program and the markdown-extraction tests. _~700 lines (del)._ (S)

### Group 87: Default-promotion prerequisites in the review-state helper

_Depends on: Group 84, Group 86_

**This group delivers:** If the measured decision adopts the recorded path, a helper that can run unattended by default.

##### Track 87A: Finish the review-state helper's default-promotion items
_3 tasks . ~360 LOC incl. tests . medium risk_
**Outcome:** If Track 84B adopts the recorded path as the default, the helper can run unattended by default: it reclaims stale locks, refuses cross-host state, moves a corrupt state aside, reports internal errors in their own result, and stamps records with `seq` and `input_sha256` if 84B requires them.
**Supports:** [SPEC](SPEC.md) O3.2 (no lost records or work on resume) and P1 (safety prerequisites before a public default); design D14's default-only items, each "required before any default promotion" (owner-approved 79A part 2, 2026-11-13).
**Done when:** Track 84B recorded adopt, and: (1) stale locks are reclaimed automatically; (2) cross-host access is detected and refused, or documented as supported; (3) a corrupt state is moved aside with a result naming it; (4) an internal-error result (exit 5, a trace file, a guarded launcher line) separates Git execution failures (timeout, spawn, signal) from invalid commit input; (5) `seq` and `input_sha256` are added or dropped as 84B decided; (6) the recorded version-ordering and store test gaps have tests; older helpers' behavior is disclosed in the release notes. If 84B recorded reject or insufficient evidence, this Track does not run, and the regeneration that records 84B moves it to Future with that record as its trigger.
_touches: src/review-state/store.ts, src/review-state/state.ts, src/review-state/cli.ts, tests/review-state.test.ts, docs/designs/review-run-state.md_
_blocked-by: Track 84B, Track 81A, Track 86A_
**Scheduling:** Technical edges: it runs only on 84B's adopt decision, and it edits the files Track 81A hardened. Building these items before the decision would be wasted if 84B rejects the default. The edge on Track 86A, which also edits the helper's CLI and tests, is a priority choice: the diet Tracks go first.
_Source: owner-approved card "Track 79A (part 2)", item 3 (2026-11-13); inbox `[review:files=src/review-state/store.ts]` "Distinguish Git execution failures from invalid commit input at adoption" (PR #238, 2026-11-11); recorded test gaps `[review:files=src/review-state/state.ts|tests/review-state.test.ts]` (PR #242, 2026-11-11) and `[review:files=src/review-state/store.ts|tests/review-state.test.ts]` (PR #254's review, 2026-11-14)._
_read-first: docs/designs/review-run-state.md_
- **Default-only D14 items** -- Stale-lock reclamation, cross-host refusal, corrupt-state move-aside, the internal-error result and the `seq`/`input_sha256` decision, each with tests. _~290 lines incl. tests._ (L)
- **Store test gaps** -- The evidence recheck against an equal-size, equal-mtime symlink retarget or regular-file replacement; sweep identity and failure branches (hard links, legacy finish evidence, listing and stat failures, symlinked or disappearing candidates, combined warnings, exact input-name refusals, keeping namespace cases only if the owner approves that restriction); re-verify each guard first. _~50 lines._ (S)
- **Version-ordering test gaps** -- Incompatible state when the local helper version is unavailable, and a writer version component above `Number.MAX_SAFE_INTEGER`; re-verify the documented refusal first. _~30 lines._ (S)

### Group 88: The recorded path as the review default

_Depends on: Group 87_

**This group delivers:** If adopted, a judgment-only `/review-and-prep` whose mechanics sit behind helper `--help` contracts, with every published output unchanged.

##### Track 88A: Make the recorded path the default and slim /review-and-prep
_4 tasks . ~210 LOC incl. tests, plus ~600 deleted lines . medium risk_
**Outcome:** With the recorded path as the default, the review skill a reviewer loads holds only judgment, with the mechanics behind helper `--help` contracts, and resumed or degraded runs keep every output.
**Supports:** [SPEC](SPEC.md) O6 and P1 (a public default changes only on measured evidence, keeping published handoffs and receipt formats compatible); the owner-approved 79A part 2 (2026-11-13), which carries the promoted Future entry "Load /review-and-prep's rarely used sections on demand".
**Done when:** Track 84B recorded adopt and Track 87A landed, and: (1) the recorded path is the default and the inline receipt, publication and metrics procedures leave `skills/review-and-prep.md` for helper calls and `--help` references, keeping every handoff label and marker byte-compatible; (2) the caller procedure states the recovery for refusals that carry no ID (an unreadable run state, a cycle-1 pass refusal) and the fallback when the calls document or the derive helper is missing under version skew; (3) the recorded fence and render test gaps have tests; (4) the release notes disclose the default change under the 0.x policy. If 84B did not adopt, this Track does not run and moves to Future with Track 87A.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, docs/review-run-state-calls.md, src/review-state/render.ts, tests/review-state.test.ts_
_blocked-by: Track 87A_
**Scheduling:** Technical edge on Track 87A: removing the inline mechanics needs the corrupt-state and internal-error recovery D14 requires once they are gone. The deletions are cheap (weight S); session weight 5.
_Source: owner-approved card "Track 79A (part 2)", item 2 (2026-11-13); inbox wording items `[review:files=docs/review-run-state-calls.md|skills/review-and-prep.md]` (PR #244, 2026-11-12); recorded test gaps `[review:files=tests/skill-protocols-review-and-prep.test.ts|skills/review-and-prep.md]` (PR #244) and `[review:files=src/review-state/render.ts|tests/review-state.test.ts]` (PR #247, 2026-11-12)._
_read-first: docs/designs/review-run-state.md, docs/review-run-state-calls.md_
- **Remove the inline mechanics** -- Delete the receipt, publication and metrics procedures the helpers now own. _~600 lines (del)._ (S)
- **Point the skill at the helper contracts** -- Replace each removed procedure with its helper call and `--help` reference, and state the no-ID refusal recovery and the version-skew fallback. _~110 lines incl. tests._ (M)
- **Fence test gaps** -- Malformed fence inputs, the first full cycle-one pass in record order, failed-attempt and not-applicable voice results, and a same-name probe gate on another candidate; re-verify each contract first. _~40 lines._ (S)
- **Render test gaps** -- Remaining field and exit combinations, stale audit and latest-evidence selection, delegated fallback selection, correction folding, formatter refusal envelopes, summary rejection and CRLF normalization, output-name collisions and owned-write failures, and UTF-8 metadata and home-prefix display paths; re-verify each contract first. _~60 lines._ (S)

### Group 89: Two-driver workflow qualification

_Depends on: Group 86, Group 88_

**This group delivers:** Real by-hand and orchestrated workflow evidence on the final stage behavior.

##### Track 89A: Qualify the workflow with two real drivers
_2 tasks . ~240 LOC . medium risk_
**Outcome:** The owner can carry real work through every stage both by hand and through a real external orchestrator, and the evidence shows what the documented contract actually supports.
**Supports:** [SPEC](SPEC.md) O3.3 and O4.5 (reshaped from the Paseo host Track by the owner, 2026-11-07: "72c ok").
**Done when:** A dated record names host, harness and versions for real runs by both drivers (the owner by hand, and one real external orchestrator), each run read back in telemetry with the correct run mode, covering, between them, a complete plan-to-authorized-release workflow, interrupted resume, manual-testing pause/resume, `/full-review` finish/restart, an explicit negative hold, an external-consumer handoff consumed from artifacts, a cross-session handoff and stale/partial/held handoffs; it counts operator interventions and keeps pending approvals or failures as holds; it includes the installed `/docs-ship` acceptance below; no unexercised combination is claimed.
_touches: docs/acceptance/workflow-drivers.md (new)_
_blocked-by: Track 70A, Track 72C, Track 71E, Track 74A, Track 76A, Track 75A, Track 26A, Track 23I, Track 23A, Track 26B, Track 65A, Track 66A, Track 66B, Track 72A, Track 79A, Track 80B, Track 86A, Track 88A_
**Scheduling:** Runs on the final behavior of the stages it qualifies, so it follows every Track that changes them, including the run-state Tracks (through 88A, whose last one may change `/review-and-prep`'s default), the review fixes and skill diet (Tracks 82A–86A) and the secret-disposition requalification (80B, shipped); qualifying before them would spend the owner's by-hand runs on behavior about to change (owner, 2026-11-10: wait for the run-state Tracks). If Track 84B does not adopt the default, the regeneration that records it moves Tracks 87A and 88A to Future and this Track follows 84B. The Tracks that only record real runs of shipped code (82B, 82C) do not gate this one; a run here can supply their rows. The external orchestrator may stop at a ready PR; a separate authorized run by hand proves landing. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. The independently followed onboarding attempt moved to the public-release stage (Future).
- **Exercise both drivers** -- Use real host-managed workspaces and approved accounts with the harnesses the owner uses for each stage; retain the bound PR and workspace, test stale/partial/held handoffs, confirm next-stage consumption from artifacts across sessions, include the host-attribution check deferred from Track 26A, and count operator interventions. _~200 documentation lines._ (L)
- **Include installed `/docs-ship` acceptance** -- Run a real docs-only PR through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging, and its interactive merge question; include one Sonnet-class run and one `/roadmap` handoff, and compare work/wait wall time with a recent docs PR shipped through the ordinary path. _~40 lines._ (S)

### Group 90: Measured stage cost ∥ stable update channel

_Depends on: Group 82, Group 84, Group 89_

**This group delivers:** Expected cost per stage with an adopt, reject or insufficient-evidence decision for every candidate optimization, the opted-in policy records' after fields filled, and upgrades that follow a stable release channel with a non-interactive auto-upgrade switch.

##### Track 90A: Measure each stage's cost and decide each optimization
_4 tasks . ~500 LOC incl. tests . medium risk_
**Outcome:** The owner can reproduce an offline report of each stage's measured cost (model work, tool/CI/human waits, reuse and rework), read a documented expected cost per stage, and see an adopt, reject or insufficient-evidence decision for every candidate optimization.
**Supports:** [SPEC](SPEC.md) O6.1–O6.3 (owner, 2026-11-07: P1 joins the 1.0 outcomes with this finish line, and this Track gains the expected stage cost).
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, run mode, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. A documented expected cost per stage (wall time and model usage, with sample size and unknowns) is published. Each efficiency-program candidate, including first-cycle overlap (69A), fold, delegation, the docs-only selection and the review run-state redesign (E15, whose decision is Track 84B's record), has measured evidence or a named evidence gap and an adopt, reject or insufficient-evidence decision with its follow-up mapped to existing Future items. The after fields that opted-in review-policy records still hold as unknown are filled from real opted-in runs where they exist, or named as evidence gaps: `docs/acceptance/review-fix-policy.md` for Tracks 33A, 51A and 75A (including whether an installed agent judged 75A's shown evidence and post-audit change classes as the skill asks) and the three after wall times in `docs/acceptance/external-gate.md`. No review gate, model choice or default changes through the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new), docs/acceptance/review-fix-policy.md, docs/acceptance/external-gate.md_
_blocked-by: Track 67A, Track 52A, Track 77A, Track 75A, Track 75B, Track 84B, Track 89A_
**Scheduling:** Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the evaluation edits the same script, test and fixture files and reads the report the baseline builds. It follows the workflow qualification, whose real runs supply most of its rows, and reads Track 84B's run-state decision instead of repeating it. Session weight 6.
_Source: the Future entries "Fill the external-gate record's three "after" wall times from a real opted-in run", "Fill Track 51A's criterion-7 "after" count at the first opted-in run after a release" and "Fill Track 33A's "after" measurement and pair it with a run without the values"; PR #234's receipt (Track 75A: installed-agent judgment unmeasured, "after" unknown), 2026-11-10._
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
- **Build a comparable baseline and expected stage costs** -- Produce the offline report and the per-stage expected cost from it; reuse eligible release-only receipts and preserve the first-installed-no-CI timing obligation and 15-minute target; report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~200 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs; investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Define corpus, quality bars, fixed budgets and stop rules before any model trial; offline analysis only, and any paid trial needs a separately approved pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- Adopt/reject/insufficient-evidence per candidate with expected benefit, observed limitations and the smallest follow-up, mapped to existing Future items; an insufficient-evidence result names missing data and a bounded next measurement and never silently removes a review or acceptance gate. _~80 lines._ (S)
- **Fill the opted-in policy records' after fields** -- From the receipts and ledger records of real opted-in runs (PRs #233 and #234 already carry `test-gaps=record`; record which values each run carried), fill or name as gaps the after fields of the 33A, 51A and 75A sections and the external-gate record, pairing with runs without the values where the records ask. _~40 lines._ (S)

##### Track 90B: Follow a stable release channel and let a bootstrap turn on auto-upgrade
_4 tasks . ~280 LOC incl. tests . medium risk_
**Outcome:** gstack-extend upgrades follow a stable release channel rather than main, each upgrade installs the release it offered, and a bootstrap script can turn on auto-upgrade on that channel without a prompt, mirroring gstack's `auto_upgrade` and `update_channel` settings.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover) and O5 (release promise). Required before 1.0. Owner, 2026-11-07: "Another we need here for 1.0 (if not already done) - on install, we should check for gstack and extend and install them if missing + turn on auto upgrade on stable for both — they are dependencies" and "This can be deferred to be done right before 1.0".
**Done when:** An `update_channel` setting selects a stable channel (release tags, or a stable branch the release step advances, chosen in the plan) and keeps today's main-tracking behavior available, with existing main-tracking installs and the rollback recipe documented in `docs/installation.md`; `bin/update-check` offers and `bin/update-run` installs the same release identity, or reports the mismatch; a documented non-interactive command enables auto-upgrade on the channel; `setup` reports a missing gstack install actionably (installing it stays the bootstrap's job unless the plan shows otherwise); the Bun 1.3.3 launcher lists in `docs/installation.md` and `CLAUDE.md` name every launcher that needs it (both omit `bin/review-state`, and the installation guide also `bin/review-delegate` and `bin/upstream-check`; verified 2026-11-13); `bin/update-check`'s published output and install-safety stay compatible; the compatibility catalog lists the setting; a dated upgrade through the stable channel on the owner's machine is added to the install qualification record.
_touches: bin/update-check, bin/update-run, bin/config, setup, docs/installation.md, docs/compatibility.md, tests/update.test.ts, docs/acceptance/install-upgrade.md, CLAUDE.md_
_blocked-by: Track 89A, Track 77A, Track 82B_
**Scheduling:** Placed "right before 1.0" (owner): the edge on the workflow qualification is a priority choice; the edges on the catalog (shipped) and install qualification Tracks are technical (it adds the setting to the catalog and appends to the install record). Facts rechecked 2026-11-13: `bin/update-run` fast-forwards `origin main`; there is no channel setting; `setup` checks only that `bun` exists; `bin/config set auto_upgrade true` is honored only by interactive upgrade flows, and spawned sessions never upgrade. An orchestrator's bootstrap does its own install-if-missing; this repository owes the channel, the setting and the non-interactive enable path.
_Source: owner-approved card (2026-11-07); merges the Future entry "Bind upgrade offers to the installed release identity" (raised during Track 28A planning, 2026-10-23), which the owner's word pulls into 1.0._
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Stable channel and offered-equals-installed identity** -- The `update_channel` key and its values, the channel mechanism, and binding the installed release to the offered one, with update tests. _~170 lines incl. tests._ (M)
- **Non-interactive enable and rollback** -- Document and test the bootstrap command and the return to main tracking. _~50 lines incl. tests._ (S)
- **Report a missing gstack at setup** -- An actionable result when installed gstack is absent, and complete the Bun 1.3.3 launcher lists in `docs/installation.md` and `CLAUDE.md`. _~35 lines incl. tests._ (S)
- **Record a real channel upgrade** -- Upgrade the owner's install through the stable channel and record offered and installed identity in the install qualification record; list the setting in the catalog. _~30 lines._ (S)

### Group 91: Install and upgrade aligned with upstream gstack

_Depends on: Group 90_

**This group delivers:** An install and upgrade flow that looks and behaves like upstream gstack's, with a What's-new summary after every upgrade.

##### Track 91A: Align install and upgrade with upstream gstack
_3 tasks . ~290 LOC incl. tests, plus byte-copied shared blocks . medium risk_
**Outcome:** Installing and upgrading gstack-extend looks and behaves like upgrading upstream gstack: the same flow shape and output style, and a "What's new" summary shown after every upgrade.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover a working skill set). Included in 1.0 by the owner on 2026-11-08: "A but keep 72c and 78a for 1.0". Owner, 2026-11-07: "One thing I want to do at some point is re-align our install and upgrade process with gstack. Both visually and functionally, including the nice release notes presented to the user".
**Done when:** The upgrade flow's steps, prompts and output match upstream `/gstack-upgrade`'s shape, including snooze, auto-upgrade and just-upgraded handling; after every upgrade the user sees a What's-new summary drawn from `CHANGELOG.md` between the old and new versions (or the commit log on a main-tracking install) and a per-host upgrade summary; fresh-install onboarding is compared with gstack's and any gap recorded; install-safety rules, the `UPGRADE_OK`, `UPGRADE_FAILED`, `MIGRATION_WARN` and `INSTALL_WARN` tokens and `bin/update-check`'s published output stay compatible or migrate explicitly with disclosure; the recorded update-check and removed-host detector test gaps have tests.
_touches: skills/gstack-extend-upgrade.md, skills/gstack-extend-init.md, skills/full-review.md, skills/implement.md, skills/plan-track.md, skills/project-spec.md, skills/pair-review.md, skills/ship-and-land.md, skills/roadmap.md, skills/review-and-prep.md, skills/docs-ship.md, bin/update-run, setup, docs/installation.md, tests/skill-protocols.test.ts, tests/update.test.ts, tests/setup-hosts.test.ts_
_blocked-by: Track 90B_
**Scheduling:** The owner first said "at some point" (2026-11-07), then included it in 1.0 (2026-11-08). The edge on the stable-channel Track orders edits to the same upgrade files behind it. It lists every skill file because the shared upgrade-flow block is byte-copied into each of them; those copies do not count toward the card size. Facts rechecked 2026-11-13: `skills/gstack-extend-upgrade.md` only points the user at `CHANGELOG.md` and shows no summary, while upstream `/gstack-upgrade` shows a grouped What's-new summary; release text from 0.68.0 to 0.72.0 is thin, so the summary is only as good as the CHANGELOG.
_Source: owner-approved card (2026-11-07); Future entry "Recorded test gaps: update-check wording, trigger lines and notice placement" (its trigger, a Track whose `_touches:` cover `tests/skill-protocols.test.ts` and `tests/update.test.ts`, is met here); recorded test gap `[review:files=tests/skill-protocols.test.ts]` "Exercise the remaining removed-host detector branches" (PR #236, 2026-11-10)._
_read-first: skills/gstack-extend-upgrade.md, docs/installation.md_
- **Match upstream's upgrade flow and output** -- Steps, prompts and output format across the shared upgrade flow and `/gstack-extend-upgrade`, keeping the result tokens and install-safety rules. _~150 lines incl. tests, plus shared copies._ (M)
- **What's-new and per-host upgrade summaries** -- Summarize `CHANGELOG.md` (or the commit log) between versions and print one row per host install. _~100 lines incl. tests._ (M)
- **Cover the recorded skill-protocol test gaps** -- Pin the `UPGRADE_SKIPPED spawned-session` sentence and the installation guide's just-upgraded clauses, assert the per-skill `UPGRADE_AVAILABLE` and `JUST_UPGRADED` lines and the spawned branch's placement, and show `bin/update-check` output reaching stdout (`[review:files=tests/skill-protocols.test.ts|tests/update.test.ts]` and `[review:files=tests/skill-protocols.test.ts]`, Track 66A, 2026-11-04); add negative cases for an unguarded Paseo mention and the removed Conductor marker in the removed-host detector. _~45 lines._ (S)

### Execution Map

Launch is decided per Track: a Track may start once every Track in its
`_blocked-by:` has landed. Tracks in one Group share no files, and wherever a
Track shares a file with a Track in an earlier Group, the packer has already
turned that into an edge here. The adjacency below is the packer's DEPENDS
output with bin numbers replaced by Group numbers; the Track IDs after each set
are the packer's own list of the Tracks that cause the edge, so a Group never
waits on a blocker's siblings. In particular, the owner-run Tracks 82B and 82C
gate only Track 90B (through Track 82B), and Tracks 87A and 88A run only if
Track 84B adopts the default. Document order is priority, not a gate. The cards
label priority choices separately from technical prerequisites.

```
- Group 82 ← {}
- Group 83 ← {82}: Track 82A
- Group 84 ← {83}: Track 83A
- Group 85 ← {84}: Track 84A
- Group 86 ← {85}: Track 85A
- Group 87 ← {84, 86}: Tracks 84B, 86A
- Group 88 ← {87}: Track 87A
- Group 89 ← {86, 88}: Tracks 86A, 88A
- Group 90 ← {82, 84, 89}: Tracks 82B, 84B, 89A
- Group 91 ← {90}: Track 90B
```

Track detail per group:
```
Group 82: Caller output reliability ∥ owner-run records   (in progress)
  +-- Track 82A ........... ~L . 4 tasks   (in progress)
  +-- Track 82B ........... ~M . 2 tasks   (owner's runs)
  +-- Track 82C ........... ~S . 2 tasks   (owner's runs)
Group 83: Run-state call shapes and evidence paths
  +-- Track 83A ........... ~L . 4 tasks
Group 84: Capped-review continuation ∥ run-state measurement
  +-- Track 84A ........... ~L . 3 tasks
  +-- Track 84B ........... ~M . 2 tasks   (waits on real runs)
Group 85: Review lock loosening and one statement per rule
  +-- Track 85A ........... ~L . 4 tasks
Group 86: Full-review record fence helper
  +-- Track 86A ........... ~L . 3 tasks
Group 87: Default-promotion prerequisites (only on adopt)
  +-- Track 87A ........... ~L . 3 tasks
Group 88: The recorded path as the review default (only on adopt)
  +-- Track 88A ........... ~L . 4 tasks
Group 89: Two-driver workflow qualification
  +-- Track 89A ........... ~L . 2 tasks
Group 90: Measured stage cost ∥ stable update channel
  +-- Track 90A ........... ~L . 4 tasks
  +-- Track 90B ........... ~M . 4 tasks
Group 91: Install and upgrade aligned with upstream gstack
  +-- Track 91A ........... ~M . 3 tasks
```

**10 Groups / 14 Tracks remaining**, one in progress; Tracks 87A and 88A are conditional on Track 84B.

Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.


## Future

Deferred: docs/roadmap-future.md (84 items)

## Shipped

History: docs/roadmap-shipped.md
