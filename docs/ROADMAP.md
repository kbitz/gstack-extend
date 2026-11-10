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
attacker parts is first priorities") have shipped: the fixed stage exit lines
(Track 72A, v0.74.0), the attacker parts (Track 72B's code, v0.75.0), docs-only
test selection (Track 72C, v0.76.0), the Codex sandbox suites (Track 72D,
v0.76.1), hand-use telemetry (Track 73A's code, v0.77.0), the human-judgment
pair-review (Track 74A, v0.78.0), release disclosures (Track 73B, v0.82.0), the
review evidence map (Track 75B, documentation) and the review stop rules (Track
75A, v0.83.0). Track 72B's and Track 73A's real-run records are still owed,
together in Track 76D. Track 76A (the contract's workspace signal) is in flight,
started ahead of the Group order with the owner's approval ("yes re 76a",
2026-11-10). The review run-state redesign (owner, 2026-11-10: "2 sure", then
"yes re: card rewrite") follows as four Tracks: its design and helper (Track
76B) can start now beside 76A, then the skill wiring with the telemetry it
derives (77B, which carries the post-merge revert of the orchestrator's
temporary sandbox grant), the receipt and handoff rendering (78A) and resume
and the slimmer skill (79A). The two-driver workflow
qualification (Track 80A) runs on that final review behavior, then the O6
measurement and decisions (Track 81A) beside the stable update channel the
owner placed "right before 1.0" (Track 81B), then aligning install and upgrade
with gstack (Track 82A). The owner-run records (Tracks 76C and 76D) can run
whenever the owner has time and gate only Track 81B, which appends to the
install record. Owner, 2026-11-08: "A but keep 72c and 78a for 1.0", approving a
proposal that moved the review-finding records to Future and kept docs-only
test selection (since shipped) and the gstack alignment (now Track 82A) as 1.0
work.

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

**Labels.** This regeneration (2026-11-10, the day's second) recorded Tracks
75A and 75B, retired Group 75 by tombstone, kept Group 76 for Track 76A in
flight, merged the two owner-run record Tracks into 76D, folded the last
Conductor code into the catalog Track and relabelled the remaining work from
there in packer order; the renames are in its commit message. Shipped numbers through 75 are reserved by
tombstones; 64 was never a roadmap Group.

Target: [SPEC](SPEC.md) O1–O6, 1.0.0 as the owner's own real use by hand and
through an orchestrator; audience ceiling potentially-public. No workspace host
or orchestrator is required; support claims name only exercised combinations.
Implementation, installed/operator evidence and owner acceptance remain
distinct. No new spend or unattended merge is authorized.

## In Progress

Track 76A is in flight, started ahead of the Group order with the owner's approval ("yes re 76a", 2026-11-10) because its technical blockers (Tracks 71C, 70A and 75A) had shipped. It keeps its ID; its Group keeps label 76 and takes the other Tracks the packer put in its batch, all idle. Tracks 75A (v0.83.0) and 75B (documentation, no version) shipped since the last regeneration and are recorded in shipped history. O1 and O3–O6 remain pending; O2 was accepted on 2026-10-23.

### Group 76: Workspace signal ∥ run-state design ∥ owner-run qualification records

_Depends on: none_

**This group delivers:** Stage skills that read the contract's workspace signal with the Conductor code removed (in flight); an approved design and tested helper for one machine-owned review run state; and, whenever the owner runs them, the install/upgrade/recovery qualification and the dated records of real review runs and hand-use telemetry.

##### Track 76A: Honor the contract's workspace signal in the skills
_4 tasks . ~250 LOC incl. tests . medium risk_
**Outcome:** Every stage leaves branch and worktree lifecycle to whatever host or orchestrator marks the workspace as its own, without detecting Paseo or Conductor by name.
**Supports:** [SPEC](SPEC.md) O4.2 and O3.2 (host ownership of branches and worktrees); owner, 2026-11-07, approving that the Future entry "Remove Conductor support from the code" become a 1.0 Track.
**Done when:** The host-managed-workspace guards in `/implement`, `/review-and-prep` and `/ship-and-land` read the contract's worktree-ownership signal, with Paseo documented as one provider if the contract keeps it; the `SHARED:conductor-visibility-head` block, its `CONDUCTOR_SKILLS` cohort and the Conductor `.context/` storage fallbacks are gone from `/full-review`, `/pair-review` and `/roadmap`, which store under the state root, then `~/scratch/`; protocol tests lock the new guards and the removal; the release notes disclose the incompatible change under the 0.x policy.
_touches: skills/implement.md, skills/review-and-prep.md, skills/ship-and-land.md, skills/full-review.md, skills/pair-review.md, skills/roadmap.md, tests/skill-protocols.test.ts, tests/skill-protocols-implement.test.ts, tests/skill-protocols-review-and-prep.test.ts, tests/skill-protocols-ship-and-land.test.ts, tests/skill-protocols-roadmap.test.ts, tests/skill-protocols-plan-track.test.ts, tests/skill-protocols-pair-review.test.ts, tests/helpers/parse-setup-skills.ts, docs/orchestration-contract.md, tests/handoff-contract.test.ts_
_blocked-by: Track 71C, Track 70A, Track 75A_
**Scheduling:** Technical edge on Track 71C (it implements the contract's signal). The edge on Track 75A is a priority choice that orders edits to `skills/review-and-prep.md` and its protocol test behind the review stop-rules Track; the edge on Track 70A (shipped, v0.72.0) is satisfied. The pair-review edges are gone: Track 74A shipped (v0.78.0).
_read-first: docs/orchestration-contract.md_
- **Read the contract's signal in the workspace guards** -- Replace the Paseo- and Conductor-named guards in the three stage skills. _~90 lines._ (M)
- **Remove the Conductor visibility block and `.context/` fallbacks** -- Remove the shared block, its cohort and the fallbacks, keeping each cohort's other members exact. _~110 lines incl. tests._ (M)
- **Lock the CLAUDE.md never-shared sentence** -- Add the missing drift lock for `/roadmap`'s sentence that `CLAUDE.md` is never shared and only one Track per Group may declare it, with a negative case. _~20 lines._ (S)
- **Lock the pair-review stage-line value bindings** -- Lock the producer clauses that derive the stage line's status from the session rollup, give a BLOCKED rollup precedence and bind `head` to the current HEAD (`[review:files=skills/pair-review.md|tests/skill-protocols-pair-review.test.ts]`, recorded on Track 72A's review, 2026-11-08). _~30 lines._ (S)

##### Track 76B: Design the review run state and ship its recording helper
_3 tasks . ~480 LOC incl. tests . medium risk_
**Outcome:** A maintainer has an approved design for one helper-owned state file per review run, and a tested helper that records it, so the following Tracks can derive every review output from one place.
**Supports:** [SPEC](SPEC.md) O6.1 (stage records that are complete, with unavailable values explicit rather than silently missing) and the optimization evidence rules (P1: caller-specific behavior through a documented option, measured before and after). Owner, 2026-11-10, in the project manager's chat: "2 sure" (carding the measurement), then "yes re: card rewrite" (this design, which supersedes the bookkeeping-script card).
**Done when:** (1) `docs/designs/review-run-state.md` passes a full novel-tier `/autoplan` design review before any code, and specifies the state schema (head, tree and base, the policy, each pass with its structured findings and `found_by`, delegate attempts, gate and audit results, continuation counts and stop reasons), the start, record, checkpoint and finish contracts, and the map from the state to every derived output (receipt and markers, compact comment and PR body, handoff and stage lines, stage-runs row, workflow metrics and attribution), keeping the kept marker set in `docs/workflow-handoffs.md` and every field the orchestrator's gates read byte-compatible until an explicit, documented migration, as confirmed with that orchestrator's manager at design time. (2) The design cites the review evidence map (`docs/designs/review-evidence-envelope.md`) for the facts the state records, giving that map its first incoming link, and says how the state's findings relate to the Future entry on stable cross-cycle finding identity without adopting it. (3) The efficiency program lists the redesign as a candidate, with the before figures and the measurement procedure (the same scripts, on real runs). (4) `bin/review-state` implements the four commands with input-shape validation, one state file per run in the evidence directory, and an explicit nonzero result when that directory is unwritable; `--help` is the contract; tests cover each command's accepted and refused input, an interrupted start followed by a record, two concurrent writers, strict fields and key serialization (the record writer and validator the Future entry "Reproduced-defect baseline follow-ups" asked for in its item 10). No skill calls the helper yet, so every review output is unchanged.
_touches: docs/designs/review-run-state.md (new), docs/designs/workflow-efficiency-program.md, bin/review-state (new), src/review-state/ (new), tests/review-state.test.ts (new), tests/helpers/touchfiles.ts, .gstack/pregate.json_
_blocked-by: Track 75B, Track 74C_
**Scheduling:** Startable now, beside Track 76A: it shares no file with it, and both edges are on shipped Tracks (technical: the state maps onto the evidence map and the write-once baseline record). Novel tier. Kept as one card above ~300 lines: the helper is the design's executable form, and a design-only Track would run the novel-tier review twice for one contract; the owner expected three or four Tracks. The skill wiring is in Track 77B, so this Track never edits `skills/review-and-prep.md` while Track 76A does. Fact checked 2026-11-10: `bin/lib/telemetry.py` reports an unwritable state directory only through its debug line ("state handoff unwritable"), so an ordinary `start` stays silent.
_Source: owner-approved card "One machine-owned review run state, everything else derived from it" (2026-11-10), from four measured review runs (two in this repository, two in a consumer project): bookkeeping and resume took 36–54% of output and 21–55% of active wall time, reading the skill took 16–31% of uncached input, and in a sandbox that cannot write the telemetry directory the first segment (the review pass) went unrecorded. PR #233's optional documentation debt (no incoming link to the evidence map); item 10 of the Future entry "Reproduced-defect baseline follow-ups" (a record writer and validator), re-pointed here._
_read-first: docs/designs/review-evidence-envelope.md, docs/workflow-handoffs.md, docs/telemetry.md, docs/designs/workflow-efficiency-program.md_
- **Design the run state** -- Schema, helper contracts, the derivation map with its compatibility constraints, the consumer's read fields, the evidence-map citation and the efficiency-program candidate with before figures. _~150 lines._ (M)
- **Ship the recording helper** -- `bin/review-state` and `src/review-state/`: start, record (pass, gate, audit), checkpoint and finish, validating input and failing loudly on an unwritable directory. _~180 lines._ (M)
- **Lock the helper's contract** -- Tests for each command, the interrupted start, concurrent writers and the unwritable directory; the touchfiles entry and pregate sync. _~150 lines._ (M)

##### Track 76C: Qualify install, upgrade and recovery on the owner's machines
_2 tasks . ~160 LOC . medium risk_
**Outcome:** The owner can install, onboard, upgrade and recover a working skill set on a fresh machine from the published instructions, with evidence of what was actually installed.
**Supports:** [SPEC](SPEC.md) O1 (all three criteria) and O5.2; the preserved published three-part upgrade obligation from Track 28A planning (2026-10-23), whose trigger was met by v0.48.0.
**Done when:** A dated record names the OS, host, harnesses and versions of a fresh install and project onboarding on the owner's machine, actionable failures for a missing prerequisite, an upgrade with user-owned files preserved and stale copies reported, a working recovery path, and a real legacy four-part install upgraded through the default remote with offered and installed commit/tag identity, reader compatibility and unchanged user state; it records the actual installed commit and discloses that upgrade offers follow main rather than a release identity; failures stay open; the owner confirms before O1 counts.
_touches: docs/acceptance/install-upgrade.md (new)_
_blocked-by: Track 70A, Track 28A_
**Scheduling:** Technical edge on Track 70A (shipped, v0.72.0): the qualified upgrade includes removing the retired skill. Candidate or file-remote proof does not satisfy the published-upgrade obligation. It waits on the owner's time and gates only the stable-channel Track 81B, which appends to its record.
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Fresh install, onboarding, upgrade and recovery** -- Run them on the owner's machine from the published instructions and record each step, intervention and result. _~90 lines._ (M)
- **Published three-part upgrade from a legacy install** -- Upgrade a real four-part install through the default remote and record offered and installed identity, reader compatibility, recovery and unchanged state beside `docs/acceptance/release-compatibility.md`. _~70 lines._ (M)

##### Track 76D: Record the owner's real review runs and hand use
_4 tasks . ~140 LOC . low risk_
**Outcome:** The owner can see from dated records that a by-hand review with no caller lines still runs as before, that the attacker parts run with per-part models when an orchestrator delegates them, that tools-mode delegation works on an installed release, and that telemetry counts the stages run by hand on each machine as `user-directed` and an orchestrated run as `orchestrated`.
**Supports:** [SPEC](SPEC.md) O6 and the optimization evidence rules (P1), O6.1 and O3.3 (the by-hand driver's evidence) and O4.4. The open acceptance of Track 72B (code merged in PR #221, v0.75.0; its receipt verified the dated-record criterion only within the PR, with PM1 and PM2 "post-merge"), the post-release run (PM1) of the owner-approved tools-mode plan (PR #229, v0.81.0), and the open acceptance of Track 73A (code merged in PR #226, v0.77.0; real runs PM1–PM4 "explicitly post-release"). Owner, 2026-11-07: "we need to make sure telemetry captures my use by hand".
**Done when:** (1) `docs/acceptance/attacker-parts.md` records PM1 (one real by-hand `/review-and-prep` with no `Review policy:` or `Review delegates:` line, read back as unchanged) and PM2 (one orchestrated run with `delegate=adversarial,red-team` mapping the two parts to different providers or models, with its `Delegated part:` lines, v3 attempts, `found_by` labels and any fallbacks), each with date, revision, host and harness versions and PR. (2) `docs/acceptance/delegate-tools-mode.md` records its PM1 installed run and names the exact reviewed content its earlier dry-run evidence covers. (3) `docs/acceptance/hand-use-telemetry.md` records real by-hand runs on each of the owner's machines read back as `user-directed` (the Paseo entrypoint, and `cli` where the owner uses it) and one orchestrated interactive run read back as `orchestrated`, through `gstack-extend-telemetry report --by-host`, without session ids, paths or repository names; its `Status:` line and the pending notice in `docs/telemetry.md` change only when every required row is recorded. (4) A failed, unavailable or wrongly read-back run stays recorded as open, never as passed, and a wrong read-back is filed as a defect.
_touches: docs/acceptance/attacker-parts.md, docs/acceptance/delegate-tools-mode.md, docs/acceptance/hand-use-telemetry.md, docs/telemetry.md_
**Scheduling:** No edges; it gates no other Track. Merged from the two owner-run record Tracks (the former 75D and 75E) because one set of runs feeds both: the by-hand review for attacker-parts PM1 is also a by-hand stage for the hand-use record, and the orchestrated PM2 review is also its orchestrated interactive row; one docs PR instead of two. The orchestrator sets `GSTACK_EXTEND_RUN_MODE=orchestrated` on every stage it launches (cutover about 2026-11-09 15:58Z, as recorded in the hand-use acceptance record). PR #231's receipt delegated both attacker parts to one provider and model, and PR #234's (2026-11-10) did again, with only the maintainability part on a second provider, so neither meets PM2's different-models condition. It shares `docs/telemetry.md` with Track 77B, which is no ordering edge.
_Source: Track 72B's preparation receipt (PR #221) and `docs/acceptance/attacker-parts.md` (PM1 and PM2 pending); PR #229's user-deferred criterion AC7 and the inbox item "Delegate tools: Refresh visible qualification provenance and finish PM1 after release" (`[review:files=docs/acceptance/delegate-tools-mode.md]`, 2026-11-09); Track 73A's preparation receipt (PR #226) and `docs/acceptance/hand-use-telemetry.md` (status pending, no rows)._
_read-first: docs/delegated-review.md, docs/telemetry.md_
- **Attacker parts PM1 and PM2** -- Run and read back one by-hand review with no caller lines and one orchestrated review with per-part models; record each row. _~50 lines._ (S)
- **Tools-mode PM1 and provenance** -- Run tools mode on the installed release, record the result and name the content the committed dry-run record covers. _~40 lines._ (S)
- **By-hand runs on each machine** -- Read back what the report shows for the owner's by-hand stages on each machine, reusing the PM1 review where it applies. _~30 lines._ (S)
- **One orchestrated interactive run** -- Read back one post-cutover orchestrated interactive stage (the PM2 review can serve), record it and update the status and pending notice once every row exists. _~20 lines._ (S)

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75_

### Group 77: Compatibility catalog ∥ run-state telemetry in /review-and-prep

_Depends on: Group 76_

**This group delivers:** The stable compatibility and recovery catalog with the last Conductor route removed, and opted-in reviews that record their run state and always leave their stage-runs row, metrics and finding attribution, with telemetry that says when it cannot write.

##### Track 77A: Retire the last Conductor route and publish the stable compatibility and recovery catalog
_3 tasks . ~230 LOC incl. tests, plus ~120 deleted lines . medium risk_
**Outcome:** The owner and an orchestrator can identify stable interfaces, experimental exclusions and recovery obligations before relying on them, and no code path for the dropped Conductor host remains to be cataloged.
**Supports:** [SPEC](SPEC.md) O5.1; preserved required inbox obligation, 2026-10-23; confirmed by the owner, 2026-11-07. The Conductor removal: O4.2 (host-specific branches are removed or documented as one provider of a contract signal; Conductor was dropped on 2026-11-06, so it can be neither) and the owner's 2026-11-06 decision "Remove Conductor support from the code".
**Done when:** (1) A catalog names every promised surface (including the orchestration contract), version/compatibility rules, support conditions and recovery links; stage-runs v2 is one checked example, not the whole catalog. Experimental surfaces stay explicitly excluded; no checkpoint is awarded by documentation alone. (2) The quota ledger's `conductor-store` input and `conductor` route are gone from `bin/lib/quota/`, with the comment in `bin/lib/projects-registry.sh`, the Conductor cases in `tests/quota_cases.py` and `tests/fixtures/quota/`, and `docs/quota-ledger.md` updated; existing quota rows that name the route stay readable, shown by a test; the release notes disclose the removal as an incompatible change under the 0.x policy.
_touches: docs/compatibility.md (new), docs/SPEC.md, README.md, docs/installation.md, bin/lib/quota/cli.py, bin/lib/quota/common.py, bin/lib/quota/index.py, bin/lib/quota/ledger.py, bin/lib/projects-registry.sh, tests/quota_cases.py, tests/quota.test.ts, tests/fixtures/quota/, docs/quota-ledger.md_
_blocked-by: Track 28A, Track 71C, Track 76A_
**Scheduling:** The edges on the contract and host-signal Tracks keep the catalog from freezing host-specific behavior as stable; with Track 76A removing Conductor from the skills, this Track removes the last Conductor code, so the catalog lists no dropped-host route. Merged in by the 2026-11-10 combine pass; the removal is mostly deletion (weight S), session weight 4.
_Source: [plan-ceo-review] stable compatibility surfaces (O5.1); the Future entry "Remove Conductor's quota store reader and route" (owner decision for the 2026-11-06 spec amendment, narrowed 2026-11-07), promoted because its trigger (the catalog being planned) is met and Track 76A leaves it as the only Conductor code._
_read-first: docs/orchestration-contract.md, docs/quota-ledger.md_
- **Catalog the promised surfaces** -- Trace CLI/config, skills, the orchestration contract, handoffs, provenance and install ownership against shipped code and public instructions. Carry the existing stable promises and disclose unknown qualification; retain O5 acceptance as an owner gate. _~180 lines._ (M)
- **Remove the Conductor quota route** -- Delete the `conductor-store` input and `conductor` route and their cases and fixtures. _~120 lines (del)._ (S)
- **Keep old quota rows readable** -- A test reading a row that names the removed route, the `docs/quota-ledger.md` update and the disclosure. _~50 lines incl. tests._ (S)

##### Track 77B: Record the review run state in /review-and-prep and derive its telemetry and finding attribution
_4 tasks . ~420 LOC incl. tests . medium risk_
**Outcome:** Under an opt-in review-policy value, a `/review-and-prep` run records its state through the helper at fixed points instead of streaming metrics, and every opted-in review leaves its stage-runs row, workflow metrics and `found_by` attribution, derived from the state at finish, even when its first segment ran where the telemetry directory is unwritable; where a sink is unwritable, telemetry says so instead of staying silent.
**Supports:** [SPEC](SPEC.md) O6.1 (each stage records its work and run mode, with unavailable values explicit) and O3.3 (each driver's runs read back in telemetry), and P1 (caller-specific behavior through a versioned review-policy value, today's default kept). Manifested: most of a consumer's sandboxed reviews have no `found_by` attribution, and resumed segments' hand-built payloads were rejected (`invalid-input` on `context`). Owner-approved card, 2026-11-10.
**Done when:** (1) A named opt-in value in `review-and-prep-policy/v1`, with a capability check a caller can run against the installed skill, makes the skill call the helper's start, record, checkpoint and finish at the design's fixed points in place of the model-streamed metrics writes and hand-built run `begin` and override payloads, the model supplying only judgment (scope, findings, adjudication and stop decisions); without the value nothing changes, and by-hand runs with no caller lines are unchanged. (2) Under the value, finish derives the stage-runs row, the workflow-metrics records and finding attribution from the state through one write path; a fixture whose first segment could not write telemetry still yields the attributed review pass; existing readers still read every record (stage-runs v2 and the workflow-metrics schema), shown by the telemetry and workflow-metrics suites. (3) `telemetry-call start` prints an explicit unavailable line with its reason when the state directory is unwritable, instead of exiting 0 with no output, with a test. (4) The four recorded run-usage test gaps have tests. (5) The plan's `## Post-merge` section carries the obligation below. The receipt, PR text and handoff lines are still written as today; Track 78A renders them. Upstream `/review` is wrapped, not edited; the release notes disclose the new value.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, docs/workflow-handoffs.md, tests/handoff-contract.test.ts, src/review-state/, tests/review-state.test.ts, bin/lib/telemetry.py, bin/lib/workflow_metrics.py, bin/lib/telemetry_usage.py, docs/telemetry.md, tests/telemetry.test.ts, tests/workflow-metrics.test.ts_
_blocked-by: Track 76B, Track 76A_
**Post-merge:** once this Track lands, ask the orchestrator's manager to revert the temporary Codex `writable_roots` grant for `~/.gstack-extend/{analytics,telemetry,telemetry-completed,telemetry-locks,workflow-metrics-locks}` (applied 2026-11-10). Owner, 2026-11-10: "1 - just make sure to revert this temp change once the track lands". The plan writes this as a `## Post-merge` row, and this design must not depend on that grant.
**Scheduling:** Both edges are technical: it wires the helper Track 76B ships, and Track 76A is editing `skills/review-and-prep.md` and its protocol and handoff tests now. Telemetry comes before rendering (card parts B and C swapped) because the lost records are the manifested defect and the post-merge revert waits on it. It shares `docs/telemetry.md` with Track 76D (that Track only changes the hand-use pending notice), which is no ordering edge; whichever lands second merges the base. Kept as one card above ~300 lines under the card-size rule's same-files exception: the record calls replace the streamed writes in the same skill sections the derivation reads; session weight 6 (the configured `roadmap_max_session_weight`).
_Source: owner-approved card "One machine-owned review run state, everything else derived from it" (2026-11-10), outcome items 2 and 3 and its post-merge obligation; the Future entry "Recorded test gaps: run-usage capture and projection" (PR #206, 2026-11-05), promoted because this Track's `_touches:` meet its trigger._
_read-first: docs/designs/review-run-state.md, docs/telemetry.md, docs/workflow-handoffs.md_
- **Wire the helper under the opt-in value** -- The policy value and its capability check, and the start, record, checkpoint and finish calls replacing the streamed metrics writes and hand-built payloads. _~150 lines incl. tests._ (M)
- **Derive the row, metrics and attribution at finish** -- One write path from the state for the stage-runs row, workflow-metrics records and `found_by`, with the unwritable-first-segment fixture. _~170 lines incl. tests._ (M)
- **Say so when telemetry cannot write** -- An explicit unavailable line from `start` with its reason (`bin/lib/telemetry.py`). _~40 lines incl. tests._ (S)
- **Cover the run-usage test gaps** -- Nested containing steps in `bin/lib/telemetry_usage.py`, the missing-usage projection, conflicting and dangling usage rows, and the 16-model and 32-pass projection limits in `tests/workflow-metrics.test.ts`; re-verify each contract first. _~60 lines._ (S)

### Group 78: Review outputs rendered from the run state

_Depends on: Group 77_

**This group delivers:** Opted-in reviews whose receipt, PR text and handoff lines are rendered from the recorded run state, byte-compatible with today's.

##### Track 78A: Render the review receipt, PR text and handoff lines from the run state
_3 tasks . ~270 LOC incl. tests . medium risk_
**Outcome:** Under the opt-in value, a review's receipt, compact PR comment and body, and handoff and stage lines are rendered from the recorded state through one write path, unchanged byte for byte, so the model no longer builds and reads them back by hand.
**Supports:** [SPEC](SPEC.md) O6 and P1 (bookkeeping cost, measured; published handoffs and receipt formats kept compatible) and O3.2 (no lost records on resume). Owner-approved card, 2026-11-10.
**Done when:** (1) Under the value, one helper command renders the receipt and its markers, the compact receipt comment, the PR body and the handoff and stage lines from the state and reads them back. (2) Fixtures show the kept markers and every field the orchestrator's gates read (the receipt marker and binding lines, `Delegated part:`, `Unresolved:`, `Checks not run:`, the stopped comment's `Skipped pregate lanes:` and `Ship gates:` lines, the external-gate pause line and the stage handoff line) byte-identical to the inline path's. (3) The recorded test gap on neighboring review-policy bullet slices has its owning-bullet tests. Without the value nothing changes.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, docs/workflow-handoffs.md, tests/handoff-contract.test.ts, tests/fixtures/handoffs/, src/review-state/, tests/review-state.test.ts_
_blocked-by: Track 77B_
**Scheduling:** Technical edge on Track 77B: it renders from the state that Track wires, in the same skill sections and tests. Session weight 4. The inbox test gap lands here: Track 76A (in flight on its approved plan) and Track 77B (at weight 6) come first in plan order but have no room.
_Source: owner-approved card (2026-11-10), outcome item 3; recorded test gap `[review:files=tests/skill-protocols-review-and-prep.test.ts|skills/review-and-prep.md]` (PR #234, 2026-11-10)._
_read-first: docs/designs/review-run-state.md, docs/workflow-handoffs.md_
- **Render the review outputs from the state** -- Receipt, compact comment, PR body and handoff and stage lines through one write path, with readback. _~180 lines incl. tests._ (M)
- **Prove byte compatibility** -- Fixtures comparing the rendered and inline outputs for the kept markers and the consumer's read fields. _~60 lines._ (S)
- **Isolate neighboring review-policy bullet assertions** -- Bound the test-gaps and documentation-scope bullet slices at their next policy bullet and show by mutation that removing a phrase from its owning bullet fails that bullet's test; re-verify the slices first (`tests/skill-protocols-review-and-prep.test.ts`). _~30 lines._ (S)

### Group 79: Resume from the run state and slim /review-and-prep

_Depends on: Group 78_

**This group delivers:** Resumes that read the run state, and a judgment-only review skill once measured runs justify it.

##### Track 79A: Resume from the run state and slim /review-and-prep on measured evidence
_4 tasks . ~310 LOC incl. tests, plus ~600 deleted lines . medium risk_
**Outcome:** A resumed review reads its state instead of rebuilding records or rereading the whole skill, and once real runs show the state path keeps every output compatible, the skill a reviewer loads holds only judgment, with the mechanics behind helper `--help` contracts.
**Supports:** [SPEC](SPEC.md) O6.2–O6.3 and P1 (a public default changes only on measured evidence, keeping published handoffs and receipt formats compatible) and O3.1–O3.2 (interrupted resume). Owner-approved card, 2026-11-10.
**Done when:** (1) Resume reads the state and continues at its last checkpoint without rebuilding receipts or gate evidence; tests cover resume after each checkpoint and a missing or mismatched state. (2) `docs/acceptance/review-run-state.md` records the before figures and after figures from real opted-in runs made after Tracks 77B and 78A were released, by hand and orchestrated, with sample size and unknowns, using the same measurement scripts. (3) Only if that record shows compatible outputs does the state path become the default and the inline mechanics leave `skills/review-and-prep.md` for helper contracts; otherwise the value stays opt-in and the record says insufficient evidence and names the missing data. Kept markers stay byte-compatible, and the release notes disclose any default change under the 0.x policy.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, src/review-state/, tests/review-state.test.ts, docs/acceptance/review-run-state.md (new)_
_blocked-by: Track 78A_
**Scheduling:** Technical edge on Track 78A: the inline mechanics can leave only once telemetry is derived. It needs real opted-in runs, which the orchestrator can supply once Tracks 77B and 78A are released. The deletions are cheap (weight S); session weight 6.
_Source: owner-approved card (2026-11-10), outcome items 4 and 5 and its constraint "measure before and after on real runs with the same scripts"; the Future entry "Load /review-and-prep's rarely used sections on demand" (owner, 2026-10-22), promoted because this Track slims the same skill for the same cost (the card measured skill reads at 16–31% of uncached input)._
_read-first: docs/designs/review-run-state.md, docs/designs/workflow-efficiency-program.md_
- **Resume from the state** -- Continue at the last checkpoint and refuse a missing or mismatched state. _~150 lines incl. tests._ (M)
- **Remove the inline mechanics** -- Delete the receipt, publication and metrics procedures the helpers now own. _~600 lines (del)._ (S)
- **Point the skill at the helper contracts** -- Replace each removed procedure with its helper call and `--help` reference, keeping every handoff label and marker. _~100 lines incl. tests._ (M)
- **Record before and after, and decide the default** -- The acceptance record and the default decision with its evidence. _~60 lines._ (S)

### Group 80: Two-driver workflow qualification

_Depends on: Group 76, Group 79_

**This group delivers:** Real by-hand and orchestrated workflow evidence on the final stage behavior.

##### Track 80A: Qualify the workflow with two real drivers
_2 tasks . ~240 LOC . medium risk_
**Outcome:** The owner can carry real work through every stage both by hand and through a real external orchestrator, and the evidence shows what the documented contract actually supports.
**Supports:** [SPEC](SPEC.md) O3.3 and O4.5 (reshaped from the Paseo host Track by the owner, 2026-11-07: "72c ok").
**Done when:** A dated record names host, harness and versions for real runs by both drivers (the owner by hand, and one real external orchestrator), each run read back in telemetry with the correct run mode, covering, between them, a complete plan-to-authorized-release workflow, interrupted resume, manual-testing pause/resume, `/full-review` finish/restart, an explicit negative hold, an external-consumer handoff consumed from artifacts, a cross-session handoff and stale/partial/held handoffs; it counts operator interventions and keeps pending approvals or failures as holds; it includes the installed `/docs-ship` acceptance below; no unexercised combination is claimed.
_touches: docs/acceptance/workflow-drivers.md (new)_
_blocked-by: Track 70A, Track 72C, Track 71E, Track 74A, Track 76A, Track 75A, Track 26A, Track 23I, Track 23A, Track 26B, Track 65A, Track 66A, Track 66B, Track 72A, Track 79A_
**Scheduling:** Runs on the final behavior of the stages it qualifies, so it follows every Track that changes them, including the review stop-rules and workspace-signal Tracks and the review run-state Tracks (76B–79A), whose last one may change `/review-and-prep`'s default; qualifying before them would spend the owner's by-hand runs on behavior about to change (owner, 2026-11-10: wait for the run-state Tracks). The exit-line, attacker-parts, docs-only selection, pair-review and hand-use code has shipped or merged (PRs #220–#227), so the Tracks that only record real runs of it (Track 76D) do not gate this one; a run here can supply its rows. The external orchestrator may stop at a ready PR; a separate authorized run by hand proves landing. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. The independently followed onboarding attempt moved to the public-release stage (Future).
- **Exercise both drivers** -- Use real host-managed workspaces and approved accounts with the harnesses the owner uses for each stage; retain the bound PR and workspace, test stale/partial/held handoffs, confirm next-stage consumption from artifacts across sessions, include the host-attribution check deferred from Track 26A, and count operator interventions. _~200 documentation lines._ (L)
- **Include installed `/docs-ship` acceptance** -- Run a real docs-only PR through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging; include one Sonnet-class run and one `/roadmap` handoff, and compare work/wait wall time with a recent docs PR shipped through the ordinary path. _~40 lines._ (S)

### Group 81: Measured stage cost ∥ stable update channel

_Depends on: Group 76, Group 77, Group 80_

**This group delivers:** Expected cost per stage with an adopt, reject or insufficient-evidence decision for every candidate optimization, the opted-in policy records' after fields filled, and upgrades that follow a stable release channel with a non-interactive auto-upgrade switch.

##### Track 81A: Measure each stage's cost and decide each optimization
_4 tasks . ~500 LOC incl. tests . medium risk_
**Outcome:** The owner can reproduce an offline report of each stage's measured cost (model work, tool/CI/human waits, reuse and rework), read a documented expected cost per stage, and see an adopt, reject or insufficient-evidence decision for every candidate optimization.
**Supports:** [SPEC](SPEC.md) O6.1–O6.3 (owner, 2026-11-07: P1 joins the 1.0 outcomes with this finish line, and this Track gains the expected stage cost).
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, run mode, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. A documented expected cost per stage (wall time and model usage, with sample size and unknowns) is published. Each efficiency-program candidate, including first-cycle overlap (69A), fold, delegation, the docs-only selection and the review run-state redesign (Tracks 76B–79A), has measured evidence or a named evidence gap and an adopt, reject or insufficient-evidence decision with its follow-up mapped to existing Future items. The after fields that opted-in review-policy records still hold as unknown are filled from real opted-in runs where they exist, or named as evidence gaps: `docs/acceptance/review-fix-policy.md` for Tracks 33A, 51A and 75A (including whether an installed agent judged 75A's shown evidence and post-audit change classes as the skill asks) and the three after wall times in `docs/acceptance/external-gate.md`. No review gate, model choice or default changes through the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new), docs/acceptance/review-fix-policy.md, docs/acceptance/external-gate.md_
_blocked-by: Track 67A, Track 52A, Track 77A, Track 75A, Track 75B, Track 80A_
**Scheduling:** Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the evaluation edits the same script, test and fixture files and reads the report the baseline builds. It follows the workflow qualification, whose real runs supply most of its rows. The 2026-11-10 combine pass added the after-field task, promoting four Future entries, because those records are the evidence its decisions read; session weight 6.
_Source: the Future entries "Fill the external-gate record's three "after" wall times from a real opted-in run", "Fill Track 51A's criterion-7 "after" count at the first opted-in run after a release" and "Fill Track 33A's "after" measurement and pair it with a run without the values"; PR #234's receipt (Track 75A: installed-agent judgment unmeasured, "after" unknown), 2026-11-10._
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
- **Build a comparable baseline and expected stage costs** -- Produce the offline report and the per-stage expected cost from it; reuse eligible release-only receipts and preserve the first-installed-no-CI timing obligation and 15-minute target; report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~200 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs; investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Define corpus, quality bars, fixed budgets and stop rules before any model trial; offline analysis only, and any paid trial needs a separately approved pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- Adopt/reject/insufficient-evidence per candidate with expected benefit, observed limitations and the smallest follow-up, mapped to existing Future items; an insufficient-evidence result names missing data and a bounded next measurement and never silently removes a review or acceptance gate. _~80 lines._ (S)
- **Fill the opted-in policy records' after fields** -- From the receipts and ledger records of real opted-in runs (PRs #233 and #234 already carry `test-gaps=record`; record which values each run carried), fill or name as gaps the after fields of the 33A, 51A and 75A sections and the external-gate record, pairing with runs without the values where the records ask. _~40 lines._ (S)

##### Track 81B: Follow a stable release channel and let a bootstrap turn on auto-upgrade
_4 tasks . ~280 LOC incl. tests . medium risk_
**Outcome:** gstack-extend upgrades follow a stable release channel rather than main, each upgrade installs the release it offered, and a bootstrap script can turn on auto-upgrade on that channel without a prompt, mirroring gstack's `auto_upgrade` and `update_channel` settings.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover) and O5 (release promise). Required before 1.0. Owner, 2026-11-07: "Another we need here for 1.0 (if not already done) - on install, we should check for gstack and extend and install them if missing + turn on auto upgrade on stable for both — they are dependencies" and "This can be deferred to be done right before 1.0".
**Done when:** An `update_channel` setting selects a stable channel (release tags, or a stable branch the release step advances, chosen in the plan) and keeps today's main-tracking behavior available, with existing main-tracking installs and the rollback recipe documented in `docs/installation.md`; `bin/update-check` offers and `bin/update-run` installs the same release identity, or reports the mismatch; a documented non-interactive command enables auto-upgrade on the channel; `setup` reports a missing gstack install actionably (installing it stays the bootstrap's job unless the plan shows otherwise); `bin/update-check`'s published output and install-safety stay compatible; the compatibility catalog lists the setting; a dated upgrade through the stable channel on the owner's machine is added to the install qualification record.
_touches: bin/update-check, bin/update-run, bin/config, setup, docs/installation.md, docs/compatibility.md, tests/update.test.ts, docs/acceptance/install-upgrade.md_
_blocked-by: Track 80A, Track 77A, Track 76C_
**Scheduling:** Placed "right before 1.0" (owner): the edge on the workflow qualification is a priority choice; the edges on the catalog and install qualification Tracks are technical (it adds the setting to the catalog and appends to the install record). Facts checked 2026-11-08: `bin/update-check` reads `main`'s VERSION from the remote and `bin/update-run` fast-forwards `origin main`; there is no channel setting; `setup` checks only that `bun` exists; `bin/config set auto_upgrade true` is honored only by interactive upgrade flows, and spawned sessions never upgrade. An orchestrator's bootstrap does its own install-if-missing; this repository owes the channel, the setting and the non-interactive enable path.
_Source: owner-approved card (2026-11-07); merges the Future entry "Bind upgrade offers to the installed release identity" (raised during Track 28A planning, 2026-10-23), which the owner's word pulls into 1.0._
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Stable channel and offered-equals-installed identity** -- The `update_channel` key and its values, the channel mechanism, and binding the installed release to the offered one, with update tests. _~170 lines incl. tests._ (M)
- **Non-interactive enable and rollback** -- Document and test the bootstrap command and the return to main tracking. _~50 lines incl. tests._ (S)
- **Report a missing gstack at setup** -- An actionable result when installed gstack is absent. _~30 lines incl. tests._ (S)
- **Record a real channel upgrade** -- Upgrade the owner's install through the stable channel and record offered and installed identity in the install qualification record; list the setting in the catalog. _~30 lines._ (S)

### Group 82: Install and upgrade aligned with upstream gstack

_Depends on: Group 81_

**This group delivers:** An install and upgrade flow that looks and behaves like upstream gstack's, with a What's-new summary after every upgrade.

##### Track 82A: Align install and upgrade with upstream gstack
_3 tasks . ~280 LOC incl. tests, plus byte-copied shared blocks . medium risk_
**Outcome:** Installing and upgrading gstack-extend looks and behaves like upgrading upstream gstack: the same flow shape and output style, and a "What's new" summary shown after every upgrade.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover a working skill set). Included in 1.0 by the owner on 2026-11-08: "A but keep 72c and 78a for 1.0". Owner, 2026-11-07: "One thing I want to do at some point is re-align our install and upgrade process with gstack. Both visually and functionally, including the nice release notes presented to the user".
**Done when:** The upgrade flow's steps, prompts and output match upstream `/gstack-upgrade`'s shape, including snooze, auto-upgrade and just-upgraded handling; after every upgrade the user sees a What's-new summary drawn from `CHANGELOG.md` between the old and new versions (or the commit log on a main-tracking install) and a per-host upgrade summary; fresh-install onboarding is compared with gstack's and any gap recorded; install-safety rules, the `UPGRADE_OK`, `UPGRADE_FAILED`, `MIGRATION_WARN` and `INSTALL_WARN` tokens and `bin/update-check`'s published output stay compatible or migrate explicitly with disclosure; the two recorded update-check test gaps from Track 66A's review have tests.
_touches: skills/gstack-extend-upgrade.md, skills/gstack-extend-init.md, skills/full-review.md, skills/implement.md, skills/plan-track.md, skills/project-spec.md, skills/pair-review.md, skills/ship-and-land.md, skills/roadmap.md, skills/review-and-prep.md, skills/docs-ship.md, bin/update-run, setup, docs/installation.md, tests/skill-protocols.test.ts, tests/update.test.ts, tests/setup-hosts.test.ts_
_blocked-by: Track 81B_
**Scheduling:** The owner first said "at some point" (2026-11-07), then included it in 1.0 (2026-11-08). The edge on the stable-channel Track orders edits to the same upgrade files behind it. It lists every skill file because the shared upgrade-flow block is byte-copied into each of them; those copies do not count toward the card size. Facts checked 2026-11-08: `skills/gstack-extend-upgrade.md` only points the user at `CHANGELOG.md` and shows no summary, while upstream `/gstack-upgrade` shows a grouped What's-new summary; release text from 0.68.0 to 0.72.0 is thin, so the summary is only as good as the CHANGELOG.
_Source: owner-approved card (2026-11-07); Future entry "Recorded test gaps: update-check wording, trigger lines and notice placement" (its trigger, a Track whose `_touches:` cover `tests/skill-protocols.test.ts` and `tests/update.test.ts`, is met here)._
_read-first: skills/gstack-extend-upgrade.md, docs/installation.md_
- **Match upstream's upgrade flow and output** -- Steps, prompts and output format across the shared upgrade flow and `/gstack-extend-upgrade`, keeping the result tokens and install-safety rules. _~150 lines incl. tests, plus shared copies._ (M)
- **What's-new and per-host upgrade summaries** -- Summarize `CHANGELOG.md` (or the commit log) between versions and print one row per host install. _~100 lines incl. tests._ (M)
- **Cover the recorded update-check test gaps** -- Pin the `UPGRADE_SKIPPED spawned-session` sentence and the installation guide's just-upgraded clauses, assert the per-skill `UPGRADE_AVAILABLE` and `JUST_UPGRADED` lines and the spawned branch's placement, and show `bin/update-check` output reaching stdout (`[review:files=tests/skill-protocols.test.ts|tests/update.test.ts]` and `[review:files=tests/skill-protocols.test.ts]`, Track 66A, 2026-11-04). _~30 lines._ (S)

### Execution Map

Launch is decided per Track: a Track may start once every Track in its
`_blocked-by:` has landed, as Track 76A did. Tracks in one Group share no
files, and wherever a Track shares a file with a Track in an earlier Group, the
packer has already turned that into an edge here. The adjacency below is the
packer's DEPENDS output with bin numbers replaced by Group numbers; the Track
IDs after each set are the packer's own list of the Tracks that cause the edge,
so a Group never waits on a blocker's siblings. In particular, the owner-run
Tracks 76C and 76D gate only Track 81B (through Track 76C). Document order is
priority, not a gate. The cards label priority choices separately from
technical prerequisites.

```
- Group 76 ← {}
- Group 77 ← {76}: Tracks 76A, 76B
- Group 78 ← {77}: Track 77B
- Group 79 ← {78}: Track 78A
- Group 80 ← {76, 79}: Tracks 76A, 79A
- Group 81 ← {76, 77, 80}: Tracks 76C, 77A, 80A
- Group 82 ← {81}: Track 81B
```

Track detail per group:
```
Group 76: Workspace signal ∥ run-state design ∥ owner-run records   (in progress)
  +-- Track 76A ........... ~M . 4 tasks   (in flight)
  +-- Track 76B ........... ~L . 3 tasks   (startable now)
  +-- Track 76C ........... ~M . 2 tasks   (owner's runs)
  +-- Track 76D ........... ~M . 4 tasks   (owner's runs)
Group 77: Compatibility catalog ∥ run-state telemetry in /review-and-prep
  +-- Track 77A ........... ~M . 3 tasks
  +-- Track 77B ........... ~L . 4 tasks
Group 78: Review outputs rendered from the run state
  +-- Track 78A ........... ~M . 3 tasks
Group 79: Resume from the run state and slim /review-and-prep
  +-- Track 79A ........... ~L . 4 tasks
Group 80: Two-driver workflow qualification
  +-- Track 80A ........... ~L . 2 tasks
Group 81: Measured stage cost ∥ stable update channel
  +-- Track 81A ........... ~L . 4 tasks
  +-- Track 81B ........... ~M . 4 tasks
Group 82: Install and upgrade aligned with upstream gstack
  +-- Track 82A ........... ~M . 3 tasks
```

**7 Groups / 13 Tracks remaining**: 4 in progress (one in flight), 9 in the Current Plan.

Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.


## Future

Deferred: docs/roadmap-future.md (80 items)

## Shipped

History: docs/roadmap-shipped.md
