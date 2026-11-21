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





**Order.** The review run-state redesign is done: Track 89A made the recorded
path `/review-and-prep`'s default (v0.103.0), after Track 86A recorded the
developer's adopt decision on reliability grounds (PR #276, 2026-11-18, "2 b").
Telemetry provider parity is done too: Muse detection (89B, v0.102.0) and the
shared by-hand run-mode rule (90B, v0.104.0) have shipped. Track 90A shipped its
baseline half only (v0.105.0); on the developer's word (2026-11-20, "1") its
credit half was reverted and is re-carded as Track 91B, which credits complete
outside and delegated replies only through an exact token from the producer.
The orchestrator consumer's documentation-audit gap value (91A) is in planning.
Track 91E remeasures the recorded path's cost once by-hand Codex or Muse reviews
on the default exist, as 86A's record commits. The two-driver workflow
qualification (Track 92A) stays behind every Track that changes the stages it
qualifies, as the owner chose ("Wait for run-state"), then the O6 measurement
and decisions (93A) beside the stable update channel the owner placed "right
before 1.0" (93B), then aligning install and upgrade with gstack (94A). The
developer-run records (Tracks 91C and 91D) can run whenever the developer has
time; only 91C gates anything (Track 93B, which appends to its record). Owner,
2026-11-08: "A but keep 72c and 78a for 1.0", approving a proposal that moved the
review-finding records to Future and kept docs-only test selection (since
shipped) and the gstack alignment (now Track 94A) as 1.0 work.

**Review-gate credit (developer-approved practices, 2026-11-20).** A review
gate's credit decision is a trust boundary, so work that changes it is planned
at novel tier. A gate never credits free-form model prose: prefer an exact token
or schema from the producer over interpreting wording variants, and do not
prescribe a Markdown parser as the fix.

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



**Labels.** This regeneration (2026-11-20) recorded Tracks 89A, 89B, 90A
(baseline half only; its credit half was descoped and re-carded) and 90B,
numbered one merged change carded outside the roadmap as 90D (PR #282), and
retired Groups 89 and 90 by tombstone. Group 91 keeps its label because its
Track 91A (the orchestrator's item 63521387) is in flight. The developer-run
records 89C and 89D and the held remeasurement 90C joined it as 91C, 91D and
91E, and the credit re-card is 91B; the renames are in this regeneration's
commit message. Shipped numbers through 90 are reserved by tombstones; 64 was
never a roadmap Group.

Target: [SPEC](SPEC.md) O1–O6, 1.0.0 as the owner's own real use by hand and
through an orchestrator; audience ceiling potentially-public. No workspace host
or orchestrator is required; support claims name only exercised combinations.
Implementation, installed/operator evidence and owner acceptance remain
distinct. No new spend or unattended merge is authorized.



## In Progress

Track 91A (the orchestrator's item 63521387, created 2026-11-21 at novel tier and now planning) is in flight, declared active by the manager on 2026-11-21; no PR was open for it at this regeneration. Its Group's other Tracks share no file with it: the exact-token reply credit (91B), the developer-run records (91C, 91D) and the held remeasurement (91E). Tracks 89A, 89B, 90A (baseline half only) and 90B, and one merged change carded outside the roadmap (now 90D), shipped since the last regeneration and are recorded in shipped history. O1 and O3–O6 remain pending; O2 was accepted on 2026-10-23.

### Group 91: Documentation-audit gap value ∥ exact-token reply credit ∥ developer-run records ∥ recorded-path remeasurement

_Depends on: none_

**This group delivers:** An opt-in way for an orchestrated review to reuse its last documentation audit when nothing documented changed after it; complete outside and delegated replies credited through an exact producer token instead of rejected; whenever the developer runs them, the install/upgrade/recovery qualification, the remaining real review records and the by-hand run-mode readbacks; and, once by-hand Codex or Muse reviews exist, the recorded path's cost measured again on the shipped default.

##### Track 91A: Let a caller accept a documentation-audit gap when nothing documented changed
_3 tasks . ~200 LOC incl. tests . medium risk_
**Outcome:** An orchestrated review whose documentation audit ran before its last changes, and whose later changes touch nothing documented, can reuse that audit under an opt-in `Review policy:` value instead of stopping to ask, while every other case still asks.
**Supports:** [SPEC](SPEC.md) O3.1 (an orchestrator carries a stage through the O4 contract) and O6 (bounded stage effort); an orchestrator consumer's request, which the developer approved on 2026-11-18 ("1 - let's do this").
**Done when:** (1) An opt-in policy value (for example `doc-audit-gap=auto`; the plan fixes the grammar) accepts the gap and reuses the last audit only when, after that audit, nothing changed under `docs/`, in README, AGENTS, CLAUDE, CHANGELOG or SPEC, or in any user-visible text, flag, help line or config key (a base merge of another reviewed PR excepted), and the external full suite still runs on the final head; (2) it authorizes one extra audit only when that audit would be the review's first and no SPEC changed; (3) anything else still asks, and a run without the value behaves as before; (4) `docs/workflow-handoffs.md`'s policy grammar and the parser cases in `tests/handoff-contract.test.ts` carry the value, the receipt names the reused audit, and how an older install treats the new key is disclosed; (5) the recorded handoff eligibility test gap has its test.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, docs/workflow-handoffs.md, tests/handoff-contract.test.ts_
_blocked-by: Track 90A_
**Scheduling:** Declared active (pinned): the orchestrator's item 63521387, created 2026-11-21 at novel tier and now planning, declared by the manager on 2026-11-21; this regeneration records it and does not re-plan it. Its edge on Track 90A (shipped, PR #284) was a priority choice and is satisfied. It shares no file with Track 91B. The plan checks whether this value also discharges the Future entry "Let a review with only documentation facts left finish past the documentation audit's attempt limit".
_Source: item (a) of an orchestrator consumer's request, relayed on the developer's word (2026-11-18); the Future entry "Recorded test gap: compare handoff producer and consumer eligibility by meaning" (PR #261's review), whose trigger this Track meets._
_read-first: docs/workflow-handoffs.md_
- **The policy value and its rule** -- The reuse conditions, the one extra first audit and the ask otherwise, in the skill with protocol tests. _~100 lines incl. tests._ (M)
- **Grammar, parser cases and receipt** -- The policy grammar, parser cases, the receipt line naming the reused audit and the older-install disclosure. _~70 lines incl. tests._ (M)
- **Handoff eligibility test gap** -- Map each producer condition to its consumer input directly in `tests/handoff-contract.test.ts`; re-verify the table and model first. _~30 lines._ (S)

##### Track 91B: Credit complete outside and delegated replies only through an exact token from the producer
_3 tasks . ~230 LOC incl. tests . high risk_
**Outcome:** A complete outside-challenge, structured or delegated reply that says nothing is missing, or that finds no defects, is credited because its producer emitted an exact token or schema field the gate checks, while every reply without that form still fails closed as it does today.
**Supports:** [SPEC](SPEC.md) O3.2 (a stage never repeats a completed review without cause) and O6 (bounded stage effort), for reviews an orchestrator consumer runs through the O4 contract; Track 90A's credit half, descoped on the developer's decision of 2026-11-20 ("1") and re-carded here under the two review-gate practices above.
**Done when:** (1) The outside-review and delegated-part prompts ask for an exact nothing-missing token or schema field, and `recover()` in `src/outside-review/recovery.ts` and `parseFindings` (read by `decide()` in `src/review-delegate/delegate.ts`) credit a nothing-missing context only when that exact form is present; a line that names missing context, any other context line and every free-form wording variant still fail closed, with fixtures for the outside challenge and for a delegated part. (2) A structured outside reply with `VERDICT: CLEAN` and numbered met criteria (the 2026-11-19 shape) is credited only through the producer's exact form, while a reply carrying real untagged findings still fails closed, with fixtures for both. (3) A delegated part's reply carrying the exact form is credited by `decide()`, falling back neither as `needs-context` nor as `unparsed-finding`, because `parseFindings` reads the same shared predicate as `recover()`. (4) No reply that today's reading fails closed is credited except through the exact form, and readiness and every other gate are unchanged for a reply that names missing context. (5) The two advisory classifier golden cases in `src/upstream-check/probe.ts` and the installed-only fixtures in `tests/outside-review.test.ts` carry the closing `VERDICT:` line installed gstack requires, so `bin/upstream-check` reports no classifier drift for them and the installed-only suites pass against installed gstack 1.101.0.0. (6) `docs/outside-review.md` and `docs/delegated-review.md` state the exact form, the plan records the developer's answer to the open question below for the chosen design, and the release notes disclose the prompt change. Criteria (1) to (4) carry Track 90A's criteria 1, 4's credit side, 5 and 7, reworded to the exact-token constraint.
_touches: src/outside-review/prompt.ts, src/outside-review/recovery.ts, src/review-delegate/delegate.ts, src/upstream-check/probe.ts, tests/outside-review.test.ts, tests/review-delegate.test.ts, docs/outside-review.md, docs/delegated-review.md_
_blocked-by: Track 90A_
**Scheduling:** Novel tier, because a review gate's credit decision is a trust boundary. The plan prefers an exact token or schema from the producer over interpreting wording variants, and this card does not prescribe a Markdown parser. Its edge on Track 90A (shipped) is technical: it builds on the baseline half's missing-coverage record. It shares no file with Track 91A; if the plan finds the `NEEDS_CONTEXT` sentence in `skills/review-and-prep.md` must change, it widens `_touches:` and runs after 91A. Track 92A waits for it. Meanwhile today's reading stays fail-closed: an affected review pays an extra outside call, which the baseline half reruns, and never a false credit; a prompt change cannot credit replies already returned, and it changes the shared prompt prefix, so a resumed review pays once for the new prefix. Open question for the developer, which the plan asks: does a gap named on the line before the exact nothing-missing form, or running into it from that line, make the reply fail closed? **Revisit when:** Track 92A's other blockers have landed and this Track has not merged: the developer then decides whether the qualification waits for it or qualifies today's fail-closed reading.
_Source: the inbox re-card `[review:files=src/outside-review/recovery.ts|src/review-delegate/delegate.ts]` "Credit complete outside and delegated replies without approximating Markdown line by line" (PR #284, 2026-11-20), whose Evidence records the twelve review cycles and 73 defects of the line-by-line reading; the Future entry "Credit a clear no-findings conclusion when a reviewer omits the `NO_FINDINGS: none` line" (PRs #196, #199 and #207, and again on PR #282's review, 2026-11-19), merged here because the practice rules out its prose-tolerance fix; the base issues "installed-only classifier tests lack the closing verdict line" and "upstream-check golden advisory cases lack the closing verdict line" (PR #284's review, re-anchored at `63854bb`); the consumer's six delegated `needs-context` fallbacks (2026-11-18). The recorded line-reading hazards are evidence against reading replies line by line, not a test list._
_read-first: docs/outside-review.md, docs/delegated-review.md, Track 90A's shipped receipt_
- **Exact form from the producer, read exactly** -- Ask both prompts for the nothing-missing token or schema field, credit only that form in the predicate `recover()` and `parseFindings` share, with outside-challenge and delegated-part fixtures including fail-closed variants, and state the form in both docs. _~130 lines incl. tests._ (M)
- **Structured reply with met criteria** -- Credit the 2026-11-19 structured shape only through the producer's exact form, and keep a reply with real untagged findings fail-closed. _~70 lines incl. tests._ (M)
- **Closing verdict line in the golden cases and installed-only fixtures** -- Add installed gstack's closing `VERDICT:` line to the two advisory golden cases and the five failing installed-only fixtures; confirm both failures at HEAD first. _~30 lines._ (S)

##### Track 91C: Qualify install, upgrade and recovery on the owner's machines
_2 tasks . ~160 LOC . medium risk_
**Outcome:** The owner can install, onboard, upgrade and recover a working skill set on a fresh machine from the published instructions, with evidence of what was actually installed.
**Supports:** [SPEC](SPEC.md) O1 (all three criteria) and O5.2; the preserved published three-part upgrade obligation from Track 28A planning (2026-10-23), whose trigger was met by v0.48.0.
**Done when:** A dated record names the OS, host, harnesses and versions of a fresh install and project onboarding on the owner's machine, actionable failures for a missing prerequisite, an upgrade with user-owned files preserved and stale copies reported, a working recovery path, and a real legacy four-part install upgraded through the default remote with offered and installed commit/tag identity, reader compatibility and unchanged user state; it records the actual installed commit and discloses that upgrade offers follow main rather than a release identity; failures stay open; the owner confirms before O1 counts.
_touches: docs/acceptance/install-upgrade.md (new)_
_blocked-by: Track 70A, Track 28A_
**Scheduling:** Technical edge on Track 70A (shipped, v0.72.0): the qualified upgrade includes removing the retired skill. Candidate or file-remote proof does not satisfy the published-upgrade obligation. It waits on the owner's time and gates only the stable-channel Track 93B, which appends to its record.
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Fresh install, onboarding, upgrade and recovery** -- Run them on the owner's machine from the published instructions and record each step, intervention and result. _~90 lines._ (M)
- **Published three-part upgrade from a legacy install** -- Upgrade a real four-part install through the default remote and record offered and installed identity, reader compatibility, recovery and unchanged state beside `docs/acceptance/release-compatibility.md`. _~70 lines._ (M)

##### Track 91D: Record the owner's remaining real review runs and by-hand run-mode readbacks
_3 tasks . ~120 LOC . low risk_
**Outcome:** The owner can see from dated records that a by-hand review with no caller lines still runs as before, that the attacker parts run with per-part models when an orchestrator delegates them, that tools-mode delegation works on an installed release, and that a stage run by hand in Codex, Muse, Grok or Cursor reads back with the run mode the shared rule promises.
**Supports:** [SPEC](SPEC.md) O6 and P1, O6.1, O3.3 (the by-hand driver's evidence) and O4.4. The remainder of the earlier Track 80D (PR #256, v0.94.2), which left attacker-parts PM1 and PM2 and tools-mode PM1 pending; the open acceptance of Track 72B (PR #221) and the post-release PM1 of the owner-approved tools-mode plan (PR #229); and the four post-merge by-hand readbacks Track 90B left pending (PR #283).
**Done when:** (1) `docs/acceptance/attacker-parts.md` records PM1 (one real by-hand `/review-and-prep` with no `Review policy:` or `Review delegates:` line, read back as unchanged, with its invocation and receipt retained) and PM2 (one orchestrated run with `delegate=adversarial,red-team` mapping the two parts to different providers or models, with its `Delegated part:` lines, v3 attempts, `found_by` labels and any fallbacks), each with date, revision, host and harness versions and PR. (2) `docs/acceptance/delegate-tools-mode.md` records its PM1 installed paired run and names the exact reviewed content its earlier dry-run evidence covers. (3) Each pending row in `docs/acceptance/hand-use-telemetry.md`'s "Pending post-merge by-hand readbacks" (Codex, Muse, Grok and Cursor) is run by hand and read back through `gstack-extend-telemetry report --by-host` and the ledger's `agent`, `run_mode` and `run_mode_source`, or stays pending with the reason. (4) A failed, unavailable or wrongly read-back run stays recorded as open, never as passed, and a wrong read-back is filed as a defect.
_touches: docs/acceptance/attacker-parts.md, docs/acceptance/delegate-tools-mode.md, docs/acceptance/hand-use-telemetry.md_
**Scheduling:** No edges; it gates no other Track. PM2 already has partial observations (PRs #250 and #253 and a consumer repository's review) and waits only on harness CLI version provenance, which the run's operator can record from the harness at run time; tools-mode PM1 waits on the orchestrator's paired tools-mode run, requested on 2026-11-15. A by-hand Codex or Muse review run for the readbacks can also count toward Track 91E's sample.
_Source: PR #256's receipt (2026-11-15: "attacker PM1/PM2 and paired tools-mode qualification remain pending"); `docs/acceptance/attacker-parts.md` and `docs/acceptance/delegate-tools-mode.md` (PM rows pending); PR #283's receipt ("post-merge hand-run readbacks PM1–PM4 in Codex, Muse, Grok and Cursor") and the four `pending` rows in `docs/acceptance/hand-use-telemetry.md` (verified@c602252)._
_read-first: docs/delegated-review.md, docs/acceptance/hand-use-telemetry.md_
- **Attacker parts PM1 and PM2** -- Run and read back one by-hand review with no caller lines, and finish PM2's harness version provenance. _~50 lines._ (S)
- **Tools-mode PM1 and provenance** -- Record the installed paired run and name the content the dry-run record covers. _~40 lines._ (S)
- **By-hand run-mode readbacks** -- Run one stage by hand in each installed non-Claude harness as its row describes and record the readback or the reason it stays pending. _~30 lines._ (S)

##### Track 91E: Remeasure the recorded review path's cost on the shipped default
_1 task . ~60 LOC . low risk_
**Outcome:** The developer can read whether making the recorded run state the default cut bookkeeping and resume cost against the measured baseline, with the same reliability guardrails.
**Supports:** [SPEC](SPEC.md) O6.2–O6.3 and P1; the follow-up Track 86A's record commits to (`docs/acceptance/review-run-state.md` §4.1, item 3: after Track 89A ships, re-run the same four caller-owned scripts unchanged).
**Done when:** The record appends after-default figures from real runs on the shipped default, measured with the same four caller-owned scripts unchanged, compared with the 77,560 mean-token baseline and the published 44.5% E15 share, with sample size, missingness and the three reliability guardrails (complete records in every segment, no lost findings, unchanged review outcomes); too few runs is recorded as insufficient evidence naming the missing data and a bounded next measurement. No default changes in this Track.
_touches: docs/acceptance/review-run-state.md_
_blocked-by: Track 89A_
**Scheduling:** Held. Its edge on Track 89A (shipped, v0.103.0) is satisfied, but its measurement scripts read each review's parent Codex or Muse rollout transcript, so it waits for at least two by-hand reviews on gstack-extend 0.103.0 or later, run on Codex or Muse, whose transcripts can be read. No review run on Claude counts. No Track supplies those reviews; Track 93A's E15 decision reads its result.
_Source: `docs/acceptance/review-run-state.md` §4.1 (Track 86A, PR #276, 2026-11-18); the manager's hold note (2026-11-21)._
_read-first: docs/acceptance/review-run-state.md_
- **Remeasure on the default** -- The after-default figures, guardrails and comparison, or insufficient evidence with its next measurement. _~60 lines._ (M)


## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90_

### Group 92: Two-driver workflow qualification

_Depends on: Group 91_

**This group delivers:** Real by-hand and orchestrated workflow evidence on the final stage behavior.

##### Track 92A: Qualify the workflow with two real drivers
_2 tasks . ~240 LOC . medium risk_
**Outcome:** The owner can carry real work through every stage both by hand and through a real external orchestrator, and the evidence shows what the documented contract actually supports.
**Supports:** [SPEC](SPEC.md) O3.3 and O4.5 (reshaped from the Paseo host Track by the owner, 2026-11-07: "72c ok").
**Done when:** A dated record names host, harness and versions for real runs by both drivers (the owner by hand, and one real external orchestrator), each run read back in telemetry with the correct run mode, covering, between them, a complete plan-to-authorized-release workflow, interrupted resume, manual-testing pause/resume, `/full-review` finish/restart, an explicit negative hold, an external-consumer handoff consumed from artifacts, a cross-session handoff and stale/partial/held handoffs; it counts operator interventions and keeps pending approvals or failures as holds; it includes the installed `/docs-ship` acceptance below; no unexercised combination is claimed.
_touches: docs/acceptance/workflow-drivers.md (new)_
_blocked-by: Track 70A, Track 72C, Track 71E, Track 74A, Track 76A, Track 75A, Track 26A, Track 23I, Track 23A, Track 26B, Track 65A, Track 66A, Track 66B, Track 72A, Track 79A, Track 80B, Track 87A, Track 89A, Track 90A, Track 91A, Track 90B, Track 91B_
**Scheduling:** Runs on the final behavior of the stages it qualifies, so it follows every Track that changes them: the run-state Tracks through 89A, which made the recorded path `/review-and-prep`'s default (shipped, v0.103.0), the review fixes, the `blocking=shown` probe and the skill diet (Tracks 82A–84D, 85D, 86B and 87A), the secret-disposition requalification (80B), the outside-voice baseline (90A, shipped), run-mode parity (90B, shipped), whose run-mode results this record reads back, and the two review Tracks still open: the documentation-audit gap value (91A) and exact-token reply credit (91B); qualifying before them would spend the developer's by-hand runs on behavior about to change (owner, 2026-11-10: wait for the run-state Tracks). If 91B is still open when the rest have landed, its revisit trigger asks the developer whether this Track waits. The Tracks that only record real runs of shipped code (91C, 91D) do not gate this one; a run here can supply their rows. The external orchestrator may stop at a ready PR; a separate authorized run by hand proves landing. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. The independently followed onboarding attempt moved to the public-release stage (Future).
- **Exercise both drivers** -- Use real host-managed workspaces and approved accounts with the harnesses the owner uses for each stage; retain the bound PR and workspace, test stale/partial/held handoffs, confirm next-stage consumption from artifacts across sessions, include the host-attribution check deferred from Track 26A, and count operator interventions. _~200 documentation lines._ (L)
- **Include installed `/docs-ship` acceptance** -- Run a real docs-only PR through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging, and its interactive merge question; include one Sonnet-class run and one `/roadmap` handoff, and compare work/wait wall time with a recent docs PR shipped through the ordinary path. _~40 lines._ (S)

### Group 93: Measured stage cost ∥ stable update channel

_Depends on: Group 91, Group 92_

**This group delivers:** Expected cost per stage with an adopt, reject or insufficient-evidence decision for every candidate optimization, the opted-in policy records' after fields filled, and upgrades that follow a stable release channel with a non-interactive auto-upgrade switch.

##### Track 93A: Measure each stage's cost and decide each optimization
_4 tasks . ~500 LOC incl. tests . medium risk_
**Outcome:** The owner can reproduce an offline report of each stage's measured cost (model work, tool/CI/human waits, reuse and rework), read a documented expected cost per stage, and see an adopt, reject or insufficient-evidence decision for every candidate optimization.
**Supports:** [SPEC](SPEC.md) O6.1–O6.3 (owner, 2026-11-07: P1 joins the 1.0 outcomes with this finish line, and this Track gains the expected stage cost).
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, run mode, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. A documented expected cost per stage (wall time and model usage, with sample size and unknowns) is published. Each efficiency-program candidate, including first-cycle overlap (69A), fold, delegation, the docs-only selection and the review run-state redesign (E15, whose decision is Track 86A's record and whose cost on the shipped default is Track 91E's), has measured evidence or a named evidence gap and an adopt, reject or insufficient-evidence decision with its follow-up mapped to existing Future items. The after fields that opted-in review-policy records still hold as unknown are filled from real opted-in runs where they exist, or named as evidence gaps: `docs/acceptance/review-fix-policy.md` for Tracks 33A, 51A and 75A (including whether an installed agent judged 75A's shown evidence and post-audit change classes as the skill asks) and the three after wall times in `docs/acceptance/external-gate.md`. No review gate, model choice or default changes through the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new), docs/acceptance/review-fix-policy.md, docs/acceptance/external-gate.md_
_blocked-by: Track 67A, Track 52A, Track 77A, Track 75A, Track 75B, Track 86A, Track 92A, Track 91E_
**Scheduling:** Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the evaluation edits the same script, test and fixture files and reads the report the baseline builds. It follows the workflow qualification, whose real runs supply most of its rows, and reads Track 86A's run-state decision and Track 91E's remeasurement instead of repeating them. Session weight 6.
_Source: the Future entries "Fill the external-gate record's three "after" wall times from a real opted-in run", "Fill Track 51A's criterion-7 "after" count at the first opted-in run after a release" and "Fill Track 33A's "after" measurement and pair it with a run without the values"; PR #234's receipt (Track 75A: installed-agent judgment unmeasured, "after" unknown), 2026-11-10._
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
- **Build a comparable baseline and expected stage costs** -- Produce the offline report and the per-stage expected cost from it; reuse eligible release-only receipts and preserve the first-installed-no-CI timing obligation and 15-minute target; report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~200 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs; investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Define corpus, quality bars, fixed budgets and stop rules before any model trial; offline analysis only, and any paid trial needs a separately approved pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- Adopt/reject/insufficient-evidence per candidate with expected benefit, observed limitations and the smallest follow-up, mapped to existing Future items; an insufficient-evidence result names missing data and a bounded next measurement and never silently removes a review or acceptance gate. _~80 lines._ (S)
- **Fill the opted-in policy records' after fields** -- From the receipts and ledger records of real opted-in runs (PRs #233 and #234 already carry `test-gaps=record`; record which values each run carried), fill or name as gaps the after fields of the 33A, 51A and 75A sections and the external-gate record, pairing with runs without the values where the records ask. _~40 lines._ (S)

##### Track 93B: Follow a stable release channel and let a bootstrap turn on auto-upgrade
_4 tasks . ~280 LOC incl. tests . medium risk_
**Outcome:** gstack-extend upgrades follow a stable release channel rather than main, each upgrade installs the release it offered, and a bootstrap script can turn on auto-upgrade on that channel without a prompt, mirroring gstack's `auto_upgrade` and `update_channel` settings.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover) and O5 (release promise). Required before 1.0. Owner, 2026-11-07: "Another we need here for 1.0 (if not already done) - on install, we should check for gstack and extend and install them if missing + turn on auto upgrade on stable for both — they are dependencies" and "This can be deferred to be done right before 1.0".
**Done when:** An `update_channel` setting selects a stable channel (release tags, or a stable branch the release step advances, chosen in the plan) and keeps today's main-tracking behavior available, with existing main-tracking installs and the rollback recipe documented in `docs/installation.md`; `bin/update-check` offers and `bin/update-run` installs the same release identity, or reports the mismatch; a documented non-interactive command enables auto-upgrade on the channel; `setup` reports a missing gstack install actionably (installing it stays the bootstrap's job unless the plan shows otherwise); the Bun 1.3.3 launcher lists in `docs/installation.md` and `CLAUDE.md` name every launcher that needs it (both omit `bin/review-state`, and the installation guide also `bin/review-delegate` and `bin/upstream-check`; verified 2026-11-13); `bin/update-check`'s published output and install-safety stay compatible; the compatibility catalog lists the setting; a dated upgrade through the stable channel on the owner's machine is added to the install qualification record.
_touches: bin/update-check, bin/update-run, bin/config, setup, docs/installation.md, docs/compatibility.md, tests/update.test.ts, docs/acceptance/install-upgrade.md, CLAUDE.md_
_blocked-by: Track 92A, Track 77A, Track 91C_
**Scheduling:** Placed "right before 1.0" (owner): the edge on the workflow qualification is a priority choice; the edges on the catalog (shipped) and install qualification Tracks are technical (it adds the setting to the catalog and appends to the install record). Facts rechecked 2026-11-13: `bin/update-run` fast-forwards `origin main`; there is no channel setting; `setup` checks only that `bun` exists; `bin/config set auto_upgrade true` is honored only by interactive upgrade flows, and spawned sessions never upgrade. An orchestrator's bootstrap does its own install-if-missing; this repository owes the channel, the setting and the non-interactive enable path.
_Source: owner-approved card (2026-11-07); merges the Future entry "Bind upgrade offers to the installed release identity" (raised during Track 28A planning, 2026-10-23), which the owner's word pulls into 1.0._
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Stable channel and offered-equals-installed identity** -- The `update_channel` key and its values, the channel mechanism, and binding the installed release to the offered one, with update tests. _~170 lines incl. tests._ (M)
- **Non-interactive enable and rollback** -- Document and test the bootstrap command and the return to main tracking. _~50 lines incl. tests._ (S)
- **Report a missing gstack at setup** -- An actionable result when installed gstack is absent, and complete the Bun 1.3.3 launcher lists in `docs/installation.md` and `CLAUDE.md`. _~35 lines incl. tests._ (S)
- **Record a real channel upgrade** -- Upgrade the owner's install through the stable channel and record offered and installed identity in the install qualification record; list the setting in the catalog. _~30 lines._ (S)

### Group 94: Install and upgrade aligned with upstream gstack

_Depends on: Group 93_

**This group delivers:** An install and upgrade flow that looks and behaves like upstream gstack's, with a What's-new summary after every upgrade.

##### Track 94A: Align install and upgrade with upstream gstack
_3 tasks . ~290 LOC incl. tests, plus byte-copied shared blocks . medium risk_
**Outcome:** Installing and upgrading gstack-extend looks and behaves like upgrading upstream gstack: the same flow shape and output style, and a "What's new" summary shown after every upgrade.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover a working skill set). Included in 1.0 by the owner on 2026-11-08: "A but keep 72c and 78a for 1.0". Owner, 2026-11-07: "One thing I want to do at some point is re-align our install and upgrade process with gstack. Both visually and functionally, including the nice release notes presented to the user".
**Done when:** The upgrade flow's steps, prompts and output match upstream `/gstack-upgrade`'s shape, including snooze, auto-upgrade and just-upgraded handling; after every upgrade the user sees a What's-new summary drawn from `CHANGELOG.md` between the old and new versions (or the commit log on a main-tracking install) and a per-host upgrade summary; fresh-install onboarding is compared with gstack's and any gap recorded; install-safety rules, the `UPGRADE_OK`, `UPGRADE_FAILED`, `MIGRATION_WARN` and `INSTALL_WARN` tokens and `bin/update-check`'s published output stay compatible or migrate explicitly with disclosure; the recorded update-check and removed-host detector test gaps have tests.
_touches: skills/gstack-extend-upgrade.md, skills/gstack-extend-init.md, skills/full-review.md, skills/implement.md, skills/plan-track.md, skills/project-spec.md, skills/pair-review.md, skills/ship-and-land.md, skills/roadmap.md, skills/review-and-prep.md, skills/docs-ship.md, bin/update-run, setup, docs/installation.md, tests/skill-protocols.test.ts, tests/update.test.ts, tests/setup-hosts.test.ts_
_blocked-by: Track 93B_
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
waits on a blocker's siblings. In particular, the developer-run Tracks 91C and
91D gate only Track 93B (through Track 91C), and Track 91E waits on by-hand
Codex or Muse reviews on the shipped default. Document order is priority, not a
gate. The cards label priority choices separately from technical prerequisites.

```
- Group 91 ← {}
- Group 92 ← {91}: Tracks 91B, 91A
- Group 93 ← {91, 92}: Tracks 91C, 91E, 92A
- Group 94 ← {93}: Track 93B
```

Track detail per group:
```
Group 91: Documentation-audit gap ∥ exact-token credit ∥ developer-run records ∥ remeasurement   (in progress)
  +-- Track 91A ........... ~M . 3 tasks   (in progress)
  +-- Track 91B ........... ~M . 3 tasks   (novel tier)
  +-- Track 91C ........... ~M . 2 tasks   (developer's runs)
  +-- Track 91D ........... ~S . 3 tasks   (developer's runs)
  +-- Track 91E ........... ~S . 1 task    (held: by-hand Codex or Muse reviews)
Group 92: Two-driver workflow qualification
  +-- Track 92A ........... ~L . 2 tasks
Group 93: Measured stage cost ∥ stable update channel
  +-- Track 93A ........... ~L . 4 tasks
  +-- Track 93B ........... ~M . 4 tasks
Group 94: Install and upgrade aligned with upstream gstack
  +-- Track 94A ........... ~M . 3 tasks
```

**4 Groups / 9 Tracks remaining**, one in progress.

Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.

## Future

Deferred: docs/roadmap-future.md (94 items)

## Shipped

History: docs/roadmap-shipped.md
