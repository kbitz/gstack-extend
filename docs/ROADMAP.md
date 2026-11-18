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



**Order.** The review run-state redesign is nearly done. Track 86A recorded the
developer's decision to adopt the recorded path on reliability grounds (PR #276,
2026-11-18, "2 b"; the measured cost cut was 27.3%, short of the original 50%
target), Track 88A finished the helper's default prerequisites (v0.101.0), and
Track 89A, which makes the recorded path the default and slims
`/review-and-prep`, is in flight. The skill diet's Tracks 86B and 87A have
shipped (v0.98.2 and v0.100.0). Two defects an orchestrator consumer hit in real
reviews go next (Track 90A), then that consumer's opt-in documentation-audit gap
value (91A), both relayed on the developer's word on 2026-11-18 ("1 - let's do
this"). Telemetry provider parity runs beside them: Muse detection (89B) is in
review, and the run-mode parity Track (90B) follows it, as the developer chose
on 2026-11-18. Track 90C remeasures the recorded path's cost once 89A ships, as
86A's record commits. The two-driver workflow qualification (Track 92A) stays
behind every Track that changes the stages it qualifies, as the owner chose
("Wait for run-state"), then the O6 measurement and decisions (93A) beside the
stable update channel the owner placed "right before 1.0" (93B), then aligning
install and upgrade with gstack (94A). The developer-run records (Tracks 89C and
89D) can run whenever the developer has time; only 89C gates anything (Track 93B,
which appends to its record). Owner, 2026-11-08: "A but keep 72c and 78a for
1.0", approving a proposal that moved the review-finding records to Future and
kept docs-only test selection (since shipped) and the gstack alignment (now
Track 94A) as 1.0 work.

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


**Labels.** This regeneration (2026-11-18) recorded Tracks 86A, 86B, 86E, 87A
and 88A, numbered two merged changes carded outside the roadmap as 88B and 88C
(PRs #274 and #278), and retired Groups 86, 87 and 88 by tombstone. Group 89
keeps its label because its Track 89A (the orchestrator's item 47c5f95a) is in
flight. The in-review Muse detection item joined it as 89B, the developer-run
records labelled 86C and 86D joined it as 89C and 89D, and the later Tracks were
renumbered from Group 90; the renames are in this regeneration's commit message.
Shipped numbers through 88 are reserved by tombstones; 64 was never a roadmap
Group.

Target: [SPEC](SPEC.md) O1–O6, 1.0.0 as the owner's own real use by hand and
through an orchestrator; audience ceiling potentially-public. No workspace host
or orchestrator is required; support claims name only exercised combinations.
Implementation, installed/operator evidence and owner acceptance remain
distinct. No new spend or unattended merge is authorized.


## In Progress

Tracks 89A (the orchestrator's item 47c5f95a, being implemented) and 89B (item 91804689, in review) are in flight, both declared active by the manager on 2026-11-18; no PR was open for either at this regeneration. Their Group's other two Tracks are the developer-run records, which share no file with them. Tracks 86A, 86B, 86E, 87A and 88A, and two merged changes carded outside the roadmap (now 88B and 88C), shipped since the last regeneration and are recorded in shipped history. O1 and O3–O6 remain pending; O2 was accepted on 2026-10-23.

### Group 89: Recorded review default ∥ Muse telemetry detection ∥ developer-run install and review records

_Depends on: none_

**This group delivers:** The recorded run state as `/review-and-prep`'s default with a judgment-only skill; Muse Code sessions recorded in telemetry like the other harnesses; and, whenever the developer runs them, the install/upgrade/recovery qualification and the remaining dated records of real review runs.

##### Track 89A: Make the recorded path the default and slim /review-and-prep
_4 tasks . ~210 LOC incl. tests, plus ~600 deleted lines . medium risk_
**Outcome:** With the recorded path as the default, the review skill a reviewer loads holds only judgment, with the mechanics behind helper `--help` contracts, and resumed or degraded runs keep every output.
**Supports:** [SPEC](SPEC.md) O6 and P1 (a public default changes only on measured evidence, keeping published handoffs and receipt formats compatible); the owner-approved 79A part 2 (2026-11-13), which carries the promoted Future entry "Load /review-and-prep's rarely used sections on demand".
**Done when:** Track 86A recorded adopt and Track 88A landed, and: (1) the recorded path is the default and the inline receipt, publication and metrics procedures leave `skills/review-and-prep.md` for helper calls and `--help` references, keeping every handoff label and marker byte-compatible; (2) the caller procedure states the recovery for refusals that carry no ID (an unreadable run state, a cycle-1 pass refusal) and the fallback when the calls document or the derive helper is missing under version skew; (3) the recorded fence and render test gaps have tests; (4) the release notes disclose the default change under the 0.x policy. If 86A did not adopt, this Track does not run and moves to Future with Track 88A.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, docs/review-run-state-calls.md, src/review-state/render.ts, tests/review-state.test.ts_
_blocked-by: Track 88A_
**Scheduling:** Declared active (pinned): implementing as the orchestrator's item 47c5f95a on 2026-11-18; Track 86A recorded adopt (PR #276) and Track 88A landed (PR #277), so this regeneration records it and does not re-plan it. Technical edge on Track 88A: removing the inline mechanics needs the corrupt-state and internal-error recovery D14 requires once they are gone. The deletions are cheap (weight S); session weight 5.
_Source: owner-approved card "Track 79A (part 2)", item 2 (2026-11-13); inbox wording items `[review:files=docs/review-run-state-calls.md|skills/review-and-prep.md]` (PR #244, 2026-11-12); recorded test gaps `[review:files=tests/skill-protocols-review-and-prep.test.ts|skills/review-and-prep.md]` (PR #244) and `[review:files=src/review-state/render.ts|tests/review-state.test.ts]` (PR #247, 2026-11-12)._
_read-first: docs/designs/review-run-state.md, docs/review-run-state-calls.md_
- **Remove the inline mechanics** -- Delete the receipt, publication and metrics procedures the helpers now own. _~600 lines (del)._ (S)
- **Point the skill at the helper contracts** -- Replace each removed procedure with its helper call and `--help` reference, and state the no-ID refusal recovery and the version-skew fallback. _~110 lines incl. tests._ (M)
- **Fence test gaps** -- Malformed fence inputs, the first full cycle-one pass in record order, failed-attempt and not-applicable voice results, and a same-name probe gate on another candidate; re-verify each contract first. _~40 lines._ (S)
- **Render test gaps** -- Remaining field and exit combinations, stale audit and latest-evidence selection, delegated fallback selection, correction folding, formatter refusal envelopes, summary rejection and CRLF normalization, output-name collisions and owned-write failures, and UTF-8 metadata and home-prefix display paths; re-verify each contract first. _~60 lines._ (S)


##### Track 89B: Detect Muse sessions in telemetry, like the other harnesses
_3 tasks . ~200 LOC incl. tests . medium risk_
**Outcome:** A Muse Code session, run by hand or orchestrated, records its agent, its model and effort when Muse exposes them, and a run mode as far as Muse's evidence allows, the same treatment Claude, Codex, Cursor and Grok sessions get.
**Supports:** [SPEC](SPEC.md) O6.1 (every stage records its model usage and run mode; unavailable values stay explicit unknowns) and O4.4 (harness and model evidence distinguishable); the developer's standing provider-parity direction (2026-11-15: "the providers should have parity -- of course that should be fixed, unless it's an upstream issue that would be challenging to work around", and "no upstream requests").
**Done when:** (1) A Muse session with its session marker set records the documented harness name instead of `no-harness`, and start/finish pairing works across a Muse session, tested with the real variable names; (2) model and effort are read from Muse's session log when present, with a fixture modeled on the real log shape that names no consumer or private path, and recorded as null otherwise; (3) Muse's `run_mode` and `run_mode_source` are documented and tested, including for an orchestrator-launched session; (4) `docs/telemetry.md`'s per-harness table has a Muse row with its version and limits; (5) existing harnesses' rows are unchanged, and the telemetry suites listed in `CLAUDE.md` pass.
_touches: bin/lib/telemetry.py, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, docs/telemetry.md, docs/acceptance/hand-use-telemetry.md_
**Scheduling:** Declared active (pinned): in review as the orchestrator's item 91804689 on 2026-11-18, carded outside the roadmap from the developer's provider-parity direction; this regeneration records it and does not re-plan it. It keeps Muse's run mode at `unknown` where Muse exposes no launch evidence; Track 90B then brings every harness to run-mode parity.
_Source: the developer's by-hand `/full-review` and `/gstack-extend-upgrade` runs in Muse Code on 2026-11-18, whose stage-runs rows recorded `agent: null`, `model: null`, `run_mode: unknown` and `run_mode_source: no-harness`; `bin/lib/telemetry.py`'s session markers name only Claude, Codex, Cursor and Grok (verified@d8b7576)._
_read-first: docs/telemetry.md_
- **Find Muse's session evidence** -- The session or thread variable, any entrypoint variable and the session log's location and model/effort fields, with the Muse version, from a real Muse run on the developer's machine. _~30 lines._ (S)
- **Detect Muse** -- Session marker, fingerprint and pairing, and model and effort from its log, following the Grok and Codex patterns, with fixtures. _~140 lines incl. tests._ (M)
- **Muse's per-harness row** -- Its run-mode classification as far as its evidence allows, and its row in `docs/telemetry.md`. _~30 lines._ (S)

##### Track 89C: Qualify install, upgrade and recovery on the owner's machines
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

##### Track 89D: Record the owner's remaining real review runs
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

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88_

### Group 90: Outside-reply parsing and cycle 1's baseline ∥ run-mode parity ∥ recorded-path remeasurement

_Depends on: Group 89_

**This group delivers:** Complete outside and delegated replies credited instead of rejected, and a capped review that keeps its repair-only continuation when only the outside voice is unverified; a by-hand run recorded as `user-directed` the same way in every harness; and the recorded path's cost measured again on the shipped default.

##### Track 90A: Credit complete outside replies that need no context, and keep cycle 1's baseline when only the outside voice is unverified
_4 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** A complete outside-challenge or delegated reply that says no context is missing is credited instead of rejected, and a cycle 1 whose only gap is an unverified outside voice still saves a usable baseline, so a capped review continues repair-only instead of paying for a full continuation.
**Supports:** [SPEC](SPEC.md) O3.2 (a stage never repeats a completed review without cause) and O6 (bounded stage effort), for reviews an orchestrator consumer runs through the O4 contract; encountered bugs relayed on the developer's word (2026-11-18, "1 - let's do this").
**Done when:** (1) `recover()` in `src/outside-review/recovery.ts` reads a `NEEDS_CONTEXT` line that says nothing is missing (the observed `NEEDS_CONTEXT: none of the above depends on missing context.` and its formatting variants) as no context needed, while a line that names missing context still fails closed; fixtures pin that reply shape and a `NO_FINDINGS` reply beside it, both for the outside challenge and for a delegated part, whose `decide()` reads the same parser. (2) The plan first establishes whether the consumer's missing first-cycle baseline came from that parse failure; either way, a cycle 1 whose every other selected reviewer completed and whose only incomplete reviewer is an unverified outside voice writes a usable baseline that records the voice as missing coverage, the continuation still runs the outside challenge, and `docs/workflow-handoffs.md` states what `completed=true` covers. (3) The recorded unavailable-template uniqueness test gap has its test. (4) Readiness and every other gate are unchanged for a reply that names missing context.
_touches: src/outside-review/recovery.ts, tests/outside-review.test.ts, tests/review-delegate.test.ts, skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, docs/workflow-handoffs.md_
_blocked-by: Track 89A_
**Scheduling:** Technical edge on Track 89A (in flight; same skill and test files). It leads the new review work because both defects manifested in real use: the parse failure on cycles 1 and 2 of one consumer review, and the lost baseline on that review and earlier on this repository's PRs #199, #206 and #207. A policy value for a first full continuation under the convergence rule is not built here; if asks remain after this fix, file it with the evidence.
_Source: items (c) and (d) of an orchestrator consumer's request, relayed on the developer's word (2026-11-18): a complete reply rejected as `parse: failed`, `needs_context: true` on cycles 1 and 2 of its review, and cycle 2's record "The first cycle had no usable complete outside coverage baseline"; `recover()` sets `needs_context` for any line whose body starts `NEEDS_CONTEXT:` (verified@d8b7576). The promoted Future entry "Record an unverified outside voice as missing coverage without marking cycle 1 incomplete". The same consumer's report that delegated maintainability and red-team parts on Antigravity fell back with reason `needs-context` on 6 of 6 attempts (about 78–79K input tokens each), which the plan checks against this reply shape. Inbox `[review:files=skills/review-and-prep.md|tests/skill-protocols-review-and-prep.test.ts]` "Test gap: unavailable-template uniqueness" (PR #272's review, 2026-11-17)._
_read-first: docs/delegated-review.md, docs/workflow-handoffs.md_
- **Credit a nothing-missing `NEEDS_CONTEXT` line** -- The parser change and fixtures for the observed reply and a `NO_FINDINGS` reply, keeping every missing-context line fail-closed. _~60 lines incl. tests._ (S)
- **Check the delegated fallbacks** -- A delegated-part fixture through `decide()` with the same reply, and the plan's finding on whether the consumer's six `needs-context` fallbacks had this shape. _~30 lines incl. tests._ (S)
- **Keep the baseline when only the outside voice is unverified** -- Confirm the consumer's cause, then the completion rule, its handoff-contract meaning and protocol tests. _~110 lines incl. tests._ (M)
- **Unavailable-template uniqueness gap** -- An occurrence-count mutation on the existing template guard; re-verify that a duplicate would escape the other checks first. _~20 lines._ (S)

##### Track 90B: Classify by-hand runs the same way for every provider
_4 tasks . ~260 LOC incl. tests . medium risk_
**Outcome:** A by-hand run in any detected harness is recorded as `user-directed`, and an orchestrated one as `orchestrated`, through one harness-neutral rule whose `run_mode_source` names the evidence; a harness stays `unknown` only where it really exposes nothing, and the per-harness table says why.
**Supports:** [SPEC](SPEC.md) O6.1 (a stage run by hand is recorded as `user-directed`, an orchestrated stage never is, and the record says `unknown` where the signals cannot tell them apart) and O3.3 (both drivers read back with the correct run mode); the developer, 2026-11-18: "which of these options is promoting all providers at parity? that is the goal", then "your rec sounds good"; the standing parity direction (2026-11-15) and "no upstream requests".
**Done when:** (1) `docs/telemetry.md` states one by-hand rule for every harness (a detected harness, launch-surface evidence of a terminal or orchestrator-host session, and no orchestration signal give `user-directed`, with `run_mode_source` naming the evidence), and its per-harness table shows each harness's status against the rule with the evidence or the reason it cannot qualify; (2) every harness whose evidence qualifies records `user-directed` for a by-hand run with no orchestration signal and `orchestrated` when one is present, with tests for each, including sessions an orchestrator's host launched; (3) Claude's rows and run-mode results are unchanged byte for byte; (4) no upstream request is filed, and a harness that exposes nothing is documented as such; (5) the recorded Grok session-marker test gaps have tests; (6) the telemetry suites listed in `CLAUDE.md` pass.
_touches: bin/lib/telemetry.py, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, docs/telemetry.md, docs/acceptance/hand-use-telemetry.md, docs/stage-runs.schema.json_
_blocked-by: Track 89B_
**Scheduling:** Technical edge on the Muse detection Track 89B (in review): it adds Muse as a harness, and this Track then qualifies it against the shared rule, as the developer chose (2026-11-18). It changes published telemetry fields in the compatibility-protected `bin/lib/telemetry.py`, so Claude's existing results are a byte-for-byte acceptance criterion.
_Source: the developer's card "Classify by-hand runs the same way for every provider" (2026-11-18). Its evidence, verified against `docs/telemetry.md` at d8b7576: the run-mode rules classify `user-directed` only for Claude, from `CLAUDE_CODE_ENTRYPOINT` (`cli`, or `Paseo` through Paseo's plugin), after the orchestration signals `GSTACK_SESSION_KIND`, `GSTACK_EXTEND_WORK_ITEM`, `GSTACK_EXTEND_RUN_MODE` and `GSTACK_EXTEND_WORKSPACE_OWNER`; Codex, Grok and Cursor record `unknown` / `harness-unqualified`. The card reports that Muse's session log records a client name, Codex records an app-server client name or its own originator, Cursor exposes `CURSOR_INVOKED_AS`, and Grok launched through ACP `terminal/create` exports no marker. Also the Future entry "Recorded test gaps: Grok session markers with an inner harness or an invalid name" (PR #257's review), whose trigger this Track meets._
_read-first: docs/telemetry.md, docs/acceptance/hand-use-telemetry.md_
- **Record each harness's launch-surface evidence** -- For Codex, Grok, Cursor and Muse, what a terminal launch and an orchestrator-host launch expose and whether they differ, from real logs and environments on the developer's machine, never credential or auth files. _~60 lines._ (S)
- **One by-hand rule in `run_mode()`** -- Define the rule once, keep Claude's `cli` and `paseo-entrypoint` results byte for byte, add each qualified harness through it with by-hand and orchestrated fixtures, and add any new `run_mode_source` value to the schema. _~140 lines incl. tests._ (M)
- **The rule and per-harness table** -- `docs/telemetry.md`'s rule and status table, and a post-merge by-hand readback row for each harness the developer can run in the hand-use record. _~30 lines._ (S)
- **Grok session-marker test gaps** -- The inherited session-only Grok marker beside an inner harness, and an invalid session name with a fresh sibling log; re-verify each first. _~30 lines._ (S)

##### Track 90C: Remeasure the recorded review path's cost on the shipped default
_1 task . ~60 LOC . low risk_
**Outcome:** The developer can read whether making the recorded run state the default cut bookkeeping and resume cost against the measured baseline, with the same reliability guardrails.
**Supports:** [SPEC](SPEC.md) O6.2–O6.3 and P1; the follow-up Track 86A's record commits to (`docs/acceptance/review-run-state.md` §4.1, item 3: after Track 89A ships, re-run the same four caller-owned scripts unchanged).
**Done when:** The record appends after-default figures from real runs on the shipped default, measured with the same four caller-owned scripts unchanged, compared with the 77,560 mean-token baseline and the published 44.5% E15 share, with sample size, missingness and the three reliability guardrails (complete records in every segment, no lost findings, unchanged review outcomes); too few runs is recorded as insufficient evidence naming the missing data and a bounded next measurement. No default changes in this Track.
_touches: docs/acceptance/review-run-state.md_
_blocked-by: Track 89A_
**Scheduling:** Technical edge on Track 89A: it measures the default 89A ships. It waits on real reviews on that default, which no Track supplies; Track 93A's E15 decision reads its result.
_Source: `docs/acceptance/review-run-state.md` §4.1 (Track 86A, PR #276, 2026-11-18)._
_read-first: docs/acceptance/review-run-state.md_
- **Remeasure on the default** -- The after-default figures, guardrails and comparison, or insufficient evidence with its next measurement. _~60 lines._ (M)

### Group 91: Documentation-audit gap value

_Depends on: Group 90_

**This group delivers:** An opt-in way for an orchestrated review to reuse its last documentation audit when nothing documented changed after it.

##### Track 91A: Let a caller accept a documentation-audit gap when nothing documented changed
_3 tasks . ~200 LOC incl. tests . medium risk_
**Outcome:** An orchestrated review whose documentation audit ran before its last changes, and whose later changes touch nothing documented, can reuse that audit under an opt-in `Review policy:` value instead of stopping to ask, while every other case still asks.
**Supports:** [SPEC](SPEC.md) O3.1 (an orchestrator carries a stage through the O4 contract) and O6 (bounded stage effort); an orchestrator consumer's request, which the developer approved on 2026-11-18 ("1 - let's do this").
**Done when:** (1) An opt-in policy value (for example `doc-audit-gap=auto`; the plan fixes the grammar) accepts the gap and reuses the last audit only when, after that audit, nothing changed under `docs/`, in README, AGENTS, CLAUDE, CHANGELOG or SPEC, or in any user-visible text, flag, help line or config key (a base merge of another reviewed PR excepted), and the external full suite still runs on the final head; (2) it authorizes one extra audit only when that audit would be the review's first and no SPEC changed; (3) anything else still asks, and a run without the value behaves as before; (4) `docs/workflow-handoffs.md`'s policy grammar and the parser cases in `tests/handoff-contract.test.ts` carry the value, the receipt names the reused audit, and how an older install treats the new key is disclosed; (5) the recorded handoff eligibility test gap has its test.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, docs/workflow-handoffs.md, tests/handoff-contract.test.ts_
_blocked-by: Track 90A_
**Scheduling:** The edge on Track 90A is a priority choice: the manifested defects go first, and both edit the same skill, test and contract files. The plan checks whether this value also discharges the Future entry "Let a review with only documentation facts left finish past the documentation audit's attempt limit".
_Source: item (a) of an orchestrator consumer's request, relayed on the developer's word (2026-11-18); the Future entry "Recorded test gap: compare handoff producer and consumer eligibility by meaning" (PR #261's review), whose trigger this Track meets._
_read-first: docs/workflow-handoffs.md_
- **The policy value and its rule** -- The reuse conditions, the one extra first audit and the ask otherwise, in the skill with protocol tests. _~100 lines incl. tests._ (M)
- **Grammar, parser cases and receipt** -- The policy grammar, parser cases, the receipt line naming the reused audit and the older-install disclosure. _~70 lines incl. tests._ (M)
- **Handoff eligibility test gap** -- Map each producer condition to its consumer input directly in `tests/handoff-contract.test.ts`; re-verify the table and model first. _~30 lines._ (S)

### Group 92: Two-driver workflow qualification

_Depends on: Group 89, Group 90, Group 91_

**This group delivers:** Real by-hand and orchestrated workflow evidence on the final stage behavior.

##### Track 92A: Qualify the workflow with two real drivers
_2 tasks . ~240 LOC . medium risk_
**Outcome:** The owner can carry real work through every stage both by hand and through a real external orchestrator, and the evidence shows what the documented contract actually supports.
**Supports:** [SPEC](SPEC.md) O3.3 and O4.5 (reshaped from the Paseo host Track by the owner, 2026-11-07: "72c ok").
**Done when:** A dated record names host, harness and versions for real runs by both drivers (the owner by hand, and one real external orchestrator), each run read back in telemetry with the correct run mode, covering, between them, a complete plan-to-authorized-release workflow, interrupted resume, manual-testing pause/resume, `/full-review` finish/restart, an explicit negative hold, an external-consumer handoff consumed from artifacts, a cross-session handoff and stale/partial/held handoffs; it counts operator interventions and keeps pending approvals or failures as holds; it includes the installed `/docs-ship` acceptance below; no unexercised combination is claimed.
_touches: docs/acceptance/workflow-drivers.md (new)_
_blocked-by: Track 70A, Track 72C, Track 71E, Track 74A, Track 76A, Track 75A, Track 26A, Track 23I, Track 23A, Track 26B, Track 65A, Track 66A, Track 66B, Track 72A, Track 79A, Track 80B, Track 87A, Track 89A, Track 90A, Track 91A, Track 90B_
**Scheduling:** Runs on the final behavior of the stages it qualifies, so it follows every Track that changes them: the run-state Tracks through 89A (in flight), which makes the recorded path `/review-and-prep`'s default, the review fixes, the `blocking=shown` probe and the skill diet (Tracks 82A–84D, 85D, 86B and 87A), the secret-disposition requalification (80B, shipped), the outside-reply and baseline fixes (90A), the documentation-audit gap value (91A) and run-mode parity (90B), whose run-mode results this record reads back; qualifying before them would spend the developer's by-hand runs on behavior about to change (owner, 2026-11-10: wait for the run-state Tracks). The Tracks that only record real runs of shipped code (89C, 89D) do not gate this one; a run here can supply their rows. The external orchestrator may stop at a ready PR; a separate authorized run by hand proves landing. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. The independently followed onboarding attempt moved to the public-release stage (Future).
- **Exercise both drivers** -- Use real host-managed workspaces and approved accounts with the harnesses the owner uses for each stage; retain the bound PR and workspace, test stale/partial/held handoffs, confirm next-stage consumption from artifacts across sessions, include the host-attribution check deferred from Track 26A, and count operator interventions. _~200 documentation lines._ (L)
- **Include installed `/docs-ship` acceptance** -- Run a real docs-only PR through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging, and its interactive merge question; include one Sonnet-class run and one `/roadmap` handoff, and compare work/wait wall time with a recent docs PR shipped through the ordinary path. _~40 lines._ (S)

### Group 93: Measured stage cost ∥ stable update channel

_Depends on: Group 89, Group 90, Group 92_

**This group delivers:** Expected cost per stage with an adopt, reject or insufficient-evidence decision for every candidate optimization, the opted-in policy records' after fields filled, and upgrades that follow a stable release channel with a non-interactive auto-upgrade switch.

##### Track 93A: Measure each stage's cost and decide each optimization
_4 tasks . ~500 LOC incl. tests . medium risk_
**Outcome:** The owner can reproduce an offline report of each stage's measured cost (model work, tool/CI/human waits, reuse and rework), read a documented expected cost per stage, and see an adopt, reject or insufficient-evidence decision for every candidate optimization.
**Supports:** [SPEC](SPEC.md) O6.1–O6.3 (owner, 2026-11-07: P1 joins the 1.0 outcomes with this finish line, and this Track gains the expected stage cost).
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, run mode, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. A documented expected cost per stage (wall time and model usage, with sample size and unknowns) is published. Each efficiency-program candidate, including first-cycle overlap (69A), fold, delegation, the docs-only selection and the review run-state redesign (E15, whose decision is Track 86A's record and whose cost on the shipped default is Track 90C's), has measured evidence or a named evidence gap and an adopt, reject or insufficient-evidence decision with its follow-up mapped to existing Future items. The after fields that opted-in review-policy records still hold as unknown are filled from real opted-in runs where they exist, or named as evidence gaps: `docs/acceptance/review-fix-policy.md` for Tracks 33A, 51A and 75A (including whether an installed agent judged 75A's shown evidence and post-audit change classes as the skill asks) and the three after wall times in `docs/acceptance/external-gate.md`. No review gate, model choice or default changes through the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new), docs/acceptance/review-fix-policy.md, docs/acceptance/external-gate.md_
_blocked-by: Track 67A, Track 52A, Track 77A, Track 75A, Track 75B, Track 86A, Track 92A, Track 90C_
**Scheduling:** Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the evaluation edits the same script, test and fixture files and reads the report the baseline builds. It follows the workflow qualification, whose real runs supply most of its rows, and reads Track 86A's run-state decision and Track 90C's remeasurement instead of repeating them. Session weight 6.
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
_blocked-by: Track 92A, Track 77A, Track 89C_
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
waits on a blocker's siblings. In particular, the developer-run Tracks 89C and
89D gate only Track 93B (through Track 89C), Track 90C waits on real reviews on
the shipped default, and Track 90B waits only on the Muse detection Track 89B.
Document order is priority, not a gate. The cards label priority choices
separately from technical prerequisites.

```
- Group 89 ← {}
- Group 90 ← {89}: Tracks 89B, 89A
- Group 91 ← {90}: Track 90A
- Group 92 ← {89, 90, 91}: Tracks 90B, 89A, 90A, 91A
- Group 93 ← {89, 90, 92}: Tracks 89C, 90C, 92A
- Group 94 ← {93}: Track 93B
```

Track detail per group:
```
Group 89: Recorded review default ∥ Muse detection ∥ developer-run records   (in progress)
  +-- Track 89A ........... ~L . 4 tasks   (in progress)
  +-- Track 89B ........... ~M . 3 tasks   (in review)
  +-- Track 89C ........... ~M . 2 tasks   (developer's runs)
  +-- Track 89D ........... ~S . 2 tasks   (developer's runs)
Group 90: Outside-reply parsing and baseline ∥ run-mode parity ∥ remeasurement
  +-- Track 90A ........... ~M . 4 tasks
  +-- Track 90B ........... ~M . 4 tasks
  +-- Track 90C ........... ~S . 1 task    (waits on real reviews on the default)
Group 91: Documentation-audit gap value
  +-- Track 91A ........... ~M . 3 tasks
Group 92: Two-driver workflow qualification
  +-- Track 92A ........... ~L . 2 tasks
Group 93: Measured stage cost ∥ stable update channel
  +-- Track 93A ........... ~L . 4 tasks
  +-- Track 93B ........... ~M . 4 tasks
Group 94: Install and upgrade aligned with upstream gstack
  +-- Track 94A ........... ~M . 3 tasks
```

**6 Groups / 12 Tracks remaining**, two in progress.

Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.

## Future

Deferred: docs/roadmap-future.md (92 items)

## Shipped

History: docs/roadmap-shipped.md
