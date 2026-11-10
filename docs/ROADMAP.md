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
pair-review (Track 74A, v0.78.0) and release disclosures (Track 73B, v0.82.0).
Track 72B's and Track 73A's real-run records are still owed, as Tracks 75D and
75E. The review stop rules lead the plan (owner, 2026-11-08, folding the
blocking-bar and post-audit-stop cards into the review-evidence Track, now
Track 75A), then the skills move onto the contract's workspace signal, the
catalog and the two-driver workflow qualification run on that final behavior,
and the O6 measurement and decisions follow beside the stable update channel
the owner placed "right before 1.0" (Track 78B), then aligning install and
upgrade with gstack (Track 79A). The install qualification (Track 75C) can run
whenever the owner has time. Owner, 2026-11-08: "A but keep 72c and 78a for
1.0", approving a proposal that moved the review-finding records to Future and
kept docs-only test selection (since shipped) and the gstack alignment (now
Track 79A) as 1.0 work.

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

**Labels.** This regeneration (2026-11-10) recorded Tracks 72A, 72C, 72D, 73B
and 74A, numbered four shipped PRs that never had a Track (74B–74E), retired
Groups 72–74 and relabelled the remaining work from Group 75 in packer order;
the renames are in its commit message. Shipped numbers through 74 are reserved
by tombstones; 64 was never a roadmap Group.

Target: [SPEC](SPEC.md) O1–O6, 1.0.0 as the owner's own real use by hand and
through an orchestrator; audience ceiling potentially-public. No workspace host
or orchestrator is required; support claims name only exercised combinations.
Implementation, installed/operator evidence and owner acceptance remain
distinct. No new spend or unattended merge is authorized.

## In Progress

No Track is declared in flight. Tracks 72A, 72C, 72D, 73B and 74A and the
un-numbered PRs #223, #228, #229 and #230 (now Tracks 74B–74E) shipped after the
last regeneration and are recorded in shipped history. Tracks 72B and 73A
merged their code but not their real-run records, so those records stay in the
plan as Tracks 75D and 75E. O1 and O3–O6 remain pending; O2 was accepted on
2026-10-23.

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74_

### Group 75: Review stop rules ∥ review evidence map ∥ install qualification ∥ real-run records

_Depends on: none_

**This group delivers:** Review stop rules (a finding blocks only when shown, post-audit changes re-audited before an owner stop, and the capped-review recovery path), a portable map of what proves a completed review, the owner's install/upgrade/recovery evidence including the published three-part upgrade, and dated real runs of the attacker parts, tools mode and hand-use telemetry.

##### Track 75A: Review stop rules: block on shown findings, re-audit post-audit changes, document capped-review recovery
_4 tasks . ~460 LOC incl. tests . medium risk_
**Outcome:** Under an opt-in review-policy value, a review finding blocks readiness only when it is shown against the PR; a change made after the documentation audit's attempts are spent stops for the owner only when it touches documented behavior; and callers know how a review stopped at its cycle cap reaches shipping.
**Supports:** [SPEC](SPEC.md) O6 and the optimization evidence rules (P1: caller-specific behavior through a documented option, today's default kept) and O3.2 stop preservation. Owner, 2026-11-08, in the project manager's chat, on the post-audit stop: "1" (fold it into this Track); on the blocking bar: "yes unless you can squeeze it into an existing track that's upcoming?". The capped-review recovery path comes from the original review-evidence card (owner, 2026-11-07, "72d confirmed as well").
**Done when:** (1) A named opt-in value in `review-and-prep-policy/v1`, with a check a caller can run against the installed skill, makes a finding block readiness only when it is shown at the reviewed head (a failing command, test or reproduction with its evidence reference, or a documentation line the PR's diff made wrong); a problem the base already has is filed as a TODOS item or test-gap record instead; an attacker-part finding, delegated or not, blocks only once a rerun shows it; non-blocking findings stay in the receipt with their attribution; upstream `/review`'s Fix-First, adversarial and red-team handling is wrapped, not edited; with the value absent nothing changes. (2) After the documentation audit's attempts are spent, a post-audit change gets one bounded re-audit of only its delta before the owner is asked; a change the receipt classifies as touching no documented behavior (a rename, a test- or TODOS-only change, a mechanically checkable count, pointer or link correction, or a fix whose behavior the docs already state) proceeds with that classification recorded; a change touching documented behavior keeps today's owner stop; the receipt names each post-audit change and why it did or did not need the owner; a blocked audit is never upgraded to updated; the plan states whether this rule is the default or opt-in. (3) Documentation walks stopped draft → authorized exact repair-only continuation → prepared readiness → ship, preserving all unavailable evidence and continuation counts, including a stop after a first cycle that reproduced defects, and cites the recorded rule that `/ship-and-land` keeps refusing a stopped draft, including one whose receipt says `Unresolved: none recorded` (`B-STOPPED-NONE-RECORDED`). (4) Protocol and handoff tests lock each rule, the two recorded preparation full-receipt test gaps and the recorded release-disclosure grammar boundaries; the release notes disclose the policy-contract change and its level; repair cycles and stalled reviews before the change are recorded, with "after" unknown until a real opted-in run. No envelope runtime or stop bypass is introduced.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, docs/workflow-handoffs.md, tests/handoff-contract.test.ts_
_blocked-by: Track 29A, Track 30A, Track 32A, Track 74E_
**Scheduling:** Kept as one card above ~300 lines under the card-size rule's same-files exception: the three rules edit the same skill sections, policy grammar and protocol and handoff tests and would run one after another anyway; session weight 6 (the configured `roadmap_max_session_weight`). The original card's upstream-proof mapping moved to Track 75B to stay under that cap. The edge on Track 74E (tools mode, shipped) is the blocking-bar card's sequencing ("after the delegated-parts-with-tools Track ships"); the capped-review edges are technical. Facts checked 2026-11-10: `skills/review-and-prep.md` still says a later edit "spends its one re-audit" and "Re-audit follows the fix delta"; `docs/workflow-handoffs.md` defines `B-STOPPED-NONE-RECORDED`; `tests/handoff-contract.test.ts` parses `review-and-prep-policy/v1`. The orchestrator's findings-across-cycles records and the deferred Future entry on cross-cycle finding identity are the measurement's data sources.
_Source: owner-approved fold-in cards "A review finding blocks only when it is shown" and "stop for the owner only when a post-audit change touches documented behavior" (2026-11-08; the second reports two owner stops, about 20 minutes each, in one 6.5-hour review for changes with no documented behavior); the Future entry "Let a mechanical count correction pass the documentation audit's attempt limit", promoted here because that report meets its trigger; the original review-evidence card's recovery path; recorded test gaps `[review:files=skills/review-and-prep.md|tests/skill-protocols-review-and-prep.test.ts]` (PR #230) and `[review:files=tests/handoff-contract.test.ts|docs/workflow-handoffs.md]` (PR #231), 2026-11-09._
_read-first: docs/designs/workflow-efficiency-program.md, docs/delegated-review.md_
- **Block only on shown findings** -- The opt-in policy value, its capability check, what counts as shown, base-only routing, the attacker-part rerun rule and the receipt's blocking and non-blocking lines. _~200 lines incl. tests._ (M)
- **Re-audit post-audit changes before stopping for the owner** -- One bounded delta re-audit with the no-documented-behavior classification as its fast path; record each post-audit change and its reason. _~120 lines incl. tests._ (M)
- **Document the capped-review recovery path** -- Use the stop receipt's own repair-only prompt and remaining budget, preserve the bound PR, and show why shipping cannot replace the continuation, including for a receipt that says `Unresolved: none recorded`. Keep manual holds and `Full-review evidence: unavailable` explicit. _~70 lines._ (S)
- **Cover the recorded receipt and disclosure test gaps** -- Pin preparation's exclusive full-receipt creation, invocation-local numbering and no-rewrite contract, and its author, edit-history and byte-hash provenance branches (PR #230); add release-disclosure grammar cases for block termination, four-space labels and wrong-character or short fence closers (PR #231). _~70 lines._ (S)

##### Track 75B: Map review facts to a portable evidence reference
_1 tasks . ~150 LOC . medium risk_
**Outcome:** An orchestrator can tell from one documented reference what proves a completed full review and which facts are missing, stale or unavailable.
**Supports:** [SPEC](SPEC.md) O4.3–O4.4 provenance (efficiency program E10–E11); from the original review-evidence card confirmed by the owner, 2026-11-07 ("72d confirmed as well").
**Done when:** A supporting design maps review facts (commit, tree, scope, completed, converged and cycles, the review binding, verified and imported lanes, and the write-once full-review baseline record added in v0.79.0) to a portable evidence-bundle reference, independently checks the review log's full-scope, completion, convergence and binding predicates, and specifies missing, stale and unavailable cases without claiming that a nonconverged full scope is a completed baseline. No envelope runtime is introduced.
_touches: docs/designs/review-evidence-envelope.md (new)_
_blocked-by: Track 29A, Track 30A, Track 32A, Track 74C_
**Scheduling:** Split from the review stop-rules Track (Track 75A) when the two fold-in cards took that card to the session-weight cap; its file is disjoint. The edge on Track 74C is technical: the mapping describes the shipped write-once baseline record.
_Source: program E10–E11 / research R11 and observed capped-review stops_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Map the existing upstream proof** -- Compare commit_full/tree/scope/completed/converged/cycles plus review_binding, verified/imported lane semantics and the baseline record; specify missing/stale/unavailable cases and identify gaps without claiming nonconverged full scope is a completed baseline. _~150 lines._ (M)

##### Track 75C: Qualify install, upgrade and recovery on the owner's machines
_2 tasks . ~160 LOC . medium risk_
**Outcome:** The owner can install, onboard, upgrade and recover a working skill set on a fresh machine from the published instructions, with evidence of what was actually installed.
**Supports:** [SPEC](SPEC.md) O1 (all three criteria) and O5.2; the preserved published three-part upgrade obligation from Track 28A planning (2026-10-23), whose trigger was met by v0.48.0.
**Done when:** A dated record names the OS, host, harnesses and versions of a fresh install and project onboarding on the owner's machine, actionable failures for a missing prerequisite, an upgrade with user-owned files preserved and stale copies reported, a working recovery path, and a real legacy four-part install upgraded through the default remote with offered and installed commit/tag identity, reader compatibility and unchanged user state; it records the actual installed commit and discloses that upgrade offers follow main rather than a release identity; failures stay open; the owner confirms before O1 counts.
_touches: docs/acceptance/install-upgrade.md (new)_
_blocked-by: Track 70A, Track 28A_
**Scheduling:** Technical edge on Track 70A (shipped, v0.72.0): the qualified upgrade includes removing the retired skill. Candidate or file-remote proof does not satisfy the published-upgrade obligation.
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Fresh install, onboarding, upgrade and recovery** -- Run them on the owner's machine from the published instructions and record each step, intervention and result. _~90 lines._ (M)
- **Published three-part upgrade from a legacy install** -- Upgrade a real four-part install through the default remote and record offered and installed identity, reader compatibility, recovery and unchanged state beside `docs/acceptance/release-compatibility.md`. _~70 lines._ (M)

##### Track 75D: Record real attacker-part and tools-mode review runs
_2 tasks . ~90 LOC . low risk_
**Outcome:** The owner can see from dated records that a by-hand review with no caller lines still runs as before, that the attacker parts run with per-part models when an orchestrator delegates them, and that tools-mode delegation works on an installed release.
**Supports:** [SPEC](SPEC.md) O6 and the optimization evidence rules (P1) and O4.4. The open acceptance of Track 72B: its code merged in PR #221 (v0.75.0), and its preparation receipt verified the dated-record criterion only within the PR (pending PM1 and PM2 rows; "the runs themselves are post-merge"). Also the post-release run (PM1) of the owner-approved tools-mode plan (PR #229, v0.81.0), which the owner deferred to after release.
**Done when:** `docs/acceptance/attacker-parts.md` records PM1 (one real by-hand `/review-and-prep` with no `Review policy:` or `Review delegates:` line, read back as unchanged) and PM2 (one orchestrated run with `delegate=adversarial,red-team` mapping the two parts to different providers or models, with its `Delegated part:` lines, v3 attempts, `found_by` labels and any fallbacks), each with date, revision, host and harness versions and PR; `docs/acceptance/delegate-tools-mode.md` records its PM1 installed run and names the exact reviewed content its earlier dry-run evidence covers; a failed or unavailable run stays recorded as open, never as passed.
_touches: docs/acceptance/attacker-parts.md, docs/acceptance/delegate-tools-mode.md_
**Scheduling:** No edges: the code it qualifies has merged (PRs #221 and #229). It needs one by-hand run by the owner and one orchestrated run. PR #231's receipt already records both attacker parts delegated and credited, but to one provider and model, so on its own it does not meet PM2's different-models condition.
_Source: Track 72B's preparation receipt (PR #221) and `docs/acceptance/attacker-parts.md` (PM1 and PM2 pending); PR #229's user-deferred criterion AC7 and the inbox item "Delegate tools: Refresh visible qualification provenance and finish PM1 after release" (`[review:files=docs/acceptance/delegate-tools-mode.md]`, 2026-11-09)._
_read-first: docs/delegated-review.md_
- **Attacker parts PM1 and PM2** -- Run and read back one by-hand review with no caller lines and one orchestrated review with per-part models; record each row through this Track's docs-only change. _~50 lines._ (S)
- **Tools-mode PM1 and provenance** -- Run tools mode on the installed release, record the result and name the content the committed dry-run record covers. _~40 lines._ (S)

##### Track 75E: Record the owner's real hand use in telemetry
_2 tasks . ~50 LOC . low risk_
**Outcome:** The owner can trust telemetry's count of the stages they run by hand on each machine, because real by-hand runs read back `user-directed` and an orchestrated run reads back `orchestrated`.
**Supports:** [SPEC](SPEC.md) O6.1 and O3.3 (the by-hand driver's evidence). The open acceptance of Track 73A: its code merged in PR #226 (v0.77.0), and its receipt left the real runs (PM1–PM4) "explicitly post-release". Owner, 2026-11-07: "we need to make sure telemetry captures my use by hand".
**Done when:** `docs/acceptance/hand-use-telemetry.md` records real by-hand runs on each of the owner's machines read back as `user-directed` (the Paseo entrypoint, and `cli` where the owner uses it) and one orchestrated interactive run read back as `orchestrated`, through `gstack-extend-telemetry report --by-host`, without session ids, paths or repository names; its `Status:` line and the pending notice in `docs/telemetry.md` change only when every required row is recorded; a run that reads back wrong stays open and is filed as a defect.
_touches: docs/acceptance/hand-use-telemetry.md, docs/telemetry.md_
**Scheduling:** No edges: the classifier and report it qualifies have merged. The orchestrator now sets `GSTACK_EXTEND_RUN_MODE=orchestrated` on every stage it launches (cutover about 2026-11-09 15:58Z, recorded in the acceptance record as its manager reported it), so a later orchestrated interactive stage can supply the orchestrated row.
_Source: Track 73A's preparation receipt (PR #226) and `docs/acceptance/hand-use-telemetry.md` (status pending, no rows)._
_read-first: docs/telemetry.md_
- **By-hand runs on each machine** -- Run stages by hand on each of the owner's machines and record what the report reads back. _~30 lines._ (S)
- **One orchestrated interactive run** -- Read back one post-cutover orchestrated interactive stage, record it and update the status and pending notice once every row exists. _~20 lines._ (S)

### Group 76: Contract workspace signal in the skills

_Depends on: Group 75_

**This group delivers:** Stage skills that read the contract's workspace signal with the Conductor code removed.

##### Track 76A: Honor the contract's workspace signal in the skills
_4 tasks . ~250 LOC incl. tests . medium risk_
**Outcome:** Every stage leaves branch and worktree lifecycle to whatever host or orchestrator marks the workspace as its own, without detecting Paseo or Conductor by name.
**Supports:** [SPEC](SPEC.md) O4.2 and O3.2 (host ownership of branches and worktrees); owner, 2026-11-07, approving that the Future entry "Remove Conductor support from the code" become a 1.0 Track.
**Done when:** The host-managed-workspace guards in `/implement`, `/review-and-prep` and `/ship-and-land` read the contract's worktree-ownership signal, with Paseo documented as one provider if the contract keeps it; the `SHARED:conductor-visibility-head` block, its `CONDUCTOR_SKILLS` cohort and the Conductor `.context/` storage fallbacks are gone from `/full-review`, `/pair-review` and `/roadmap`, which store under the state root, then `~/scratch/`; protocol tests lock the new guards and the removal; the release notes disclose the incompatible change under the 0.x policy.
_touches: skills/implement.md, skills/review-and-prep.md, skills/ship-and-land.md, skills/full-review.md, skills/pair-review.md, skills/roadmap.md, tests/skill-protocols.test.ts, tests/skill-protocols-implement.test.ts, tests/skill-protocols-review-and-prep.test.ts, tests/skill-protocols-ship-and-land.test.ts, tests/skill-protocols-roadmap.test.ts, tests/skill-protocols-plan-track.test.ts, tests/skill-protocols-pair-review.test.ts, tests/helpers/parse-setup-skills.ts_
_blocked-by: Track 71C, Track 70A, Track 75A_
**Scheduling:** Technical edge on Track 71C (it implements the contract's signal). The edge on Track 75A is a priority choice that orders edits to `skills/review-and-prep.md` and its protocol test behind the review stop-rules Track; the edge on Track 70A (shipped, v0.72.0) is satisfied. The pair-review edges are gone: Track 74A shipped (v0.78.0).
_read-first: docs/orchestration-contract.md_
- **Read the contract's signal in the workspace guards** -- Replace the Paseo- and Conductor-named guards in the three stage skills. _~90 lines._ (M)
- **Remove the Conductor visibility block and `.context/` fallbacks** -- Remove the shared block, its cohort and the fallbacks, keeping each cohort's other members exact. _~110 lines incl. tests._ (M)
- **Lock the CLAUDE.md never-shared sentence** -- Add the missing drift lock for `/roadmap`'s sentence that `CLAUDE.md` is never shared and only one Track per Group may declare it, with a negative case. _~20 lines._ (S)
- **Lock the pair-review stage-line value bindings** -- Lock the producer clauses that derive the stage line's status from the session rollup, give a BLOCKED rollup precedence and bind `head` to the current HEAD (`[review:files=skills/pair-review.md|tests/skill-protocols-pair-review.test.ts]`, recorded on Track 72A's review, 2026-11-08). _~30 lines._ (S)

### Group 77: Compatibility catalog ∥ two-driver workflow qualification

_Depends on: Group 75, Group 76_

**This group delivers:** The stable compatibility and recovery catalog, and real by-hand and orchestrated workflow evidence.

##### Track 77A: Publish the stable compatibility and recovery catalog
_1 tasks . ~180 LOC incl. tests . medium risk_
**Outcome:** The owner and an orchestrator can identify stable interfaces, experimental exclusions and recovery obligations before relying on them.
**Supports:** [SPEC](SPEC.md) O5.1; preserved required inbox obligation, 2026-10-23; confirmed by the owner, 2026-11-07.
**Done when:** A catalog names every promised surface (including the orchestration contract), version/compatibility rules, support conditions and recovery links; stage-runs v2 is one checked example, not the whole catalog. Experimental surfaces stay explicitly excluded; no checkpoint is awarded by documentation alone.
_touches: docs/compatibility.md (new), docs/SPEC.md, README.md, docs/installation.md_
_blocked-by: Track 28A, Track 71C, Track 76A_
**Scheduling:** The edges on the contract and host-signal Tracks keep the catalog from freezing host-specific behavior as stable.
_Source: [plan-ceo-review] stable compatibility surfaces (O5.1)_
_read-first: docs/orchestration-contract.md_
- **Catalog the promised surfaces** -- Trace CLI/config, skills, the orchestration contract, handoffs, provenance and install ownership against shipped code and public instructions. Carry the existing stable promises and disclose unknown qualification; retain O5 acceptance as an owner gate. _~180 lines._ (M)

##### Track 77B: Qualify the workflow with two real drivers
_2 tasks . ~240 LOC . medium risk_
**Outcome:** The owner can carry real work through every stage both by hand and through a real external orchestrator, and the evidence shows what the documented contract actually supports.
**Supports:** [SPEC](SPEC.md) O3.3 and O4.5 (reshaped from the Paseo host Track by the owner, 2026-11-07: "72c ok").
**Done when:** A dated record names host, harness and versions for real runs by both drivers (the owner by hand, and one real external orchestrator), each run read back in telemetry with the correct run mode, covering, between them, a complete plan-to-authorized-release workflow, interrupted resume, manual-testing pause/resume, `/full-review` finish/restart, an explicit negative hold, an external-consumer handoff consumed from artifacts, a cross-session handoff and stale/partial/held handoffs; it counts operator interventions and keeps pending approvals or failures as holds; it includes the installed `/docs-ship` acceptance below; no unexercised combination is claimed.
_touches: docs/acceptance/workflow-drivers.md (new)_
_blocked-by: Track 70A, Track 72C, Track 71E, Track 74A, Track 76A, Track 75A, Track 26A, Track 23I, Track 23A, Track 26B, Track 65A, Track 66A, Track 66B, Track 72A_
**Scheduling:** Runs on the final behavior of the stages it qualifies, so it follows every Track that changes them, including the review stop-rules and workspace-signal Tracks. The exit-line, attacker-parts, docs-only selection, pair-review and hand-use code has shipped or merged (PRs #220–#227), so the Tracks that only record real runs of it (Tracks 75D and 75E) do not gate this one; a run here can supply their rows. The external orchestrator may stop at a ready PR; a separate authorized run by hand proves landing. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. The independently followed onboarding attempt moved to the public-release stage (Future).
- **Exercise both drivers** -- Use real host-managed workspaces and approved accounts with the harnesses the owner uses for each stage; retain the bound PR and workspace, test stale/partial/held handoffs, confirm next-stage consumption from artifacts across sessions, include the host-attribution check deferred from Track 26A, and count operator interventions. _~200 documentation lines._ (L)
- **Include installed `/docs-ship` acceptance** -- Run a real docs-only PR through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging; include one Sonnet-class run and one `/roadmap` handoff, and compare work/wait wall time with a recent docs PR shipped through the ordinary path. _~40 lines._ (S)

### Group 78: Measured stage cost ∥ stable update channel

_Depends on: Group 75, Group 77_

**This group delivers:** Expected cost per stage with an adopt, reject or insufficient-evidence decision for every candidate optimization, and upgrades that follow a stable release channel with a non-interactive auto-upgrade switch.

##### Track 78A: Measure each stage's cost and decide each optimization
_3 tasks . ~460 LOC incl. tests . medium risk_
**Outcome:** The owner can reproduce an offline report of each stage's measured cost (model work, tool/CI/human waits, reuse and rework), read a documented expected cost per stage, and see an adopt, reject or insufficient-evidence decision for every candidate optimization.
**Supports:** [SPEC](SPEC.md) O6.1–O6.3 (owner, 2026-11-07: P1 joins the 1.0 outcomes with this finish line, and this Track gains the expected stage cost).
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, run mode, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. A documented expected cost per stage (wall time and model usage, with sample size and unknowns) is published. Each efficiency-program candidate, including first-cycle overlap (69A), fold, delegation and the docs-only selection, has measured evidence or a named evidence gap and an adopt, reject or insufficient-evidence decision with its follow-up mapped to existing Future items. No review gate, model choice or default changes through the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new)_
_blocked-by: Track 67A, Track 52A, Track 77A, Track 75A, Track 75B, Track 77B_
**Scheduling:** Kept as one card above ~300 lines under the card-size rule's same-files exception (owner direction, 2026-10-26): the evaluation edits the same script, test and fixture files and reads the report the baseline builds. It follows the workflow qualification, whose real runs supply most of its rows.
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
- **Build a comparable baseline and expected stage costs** -- Produce the offline report and the per-stage expected cost from it; reuse eligible release-only receipts and preserve the first-installed-no-CI timing obligation and 15-minute target; report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~200 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs; investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Define corpus, quality bars, fixed budgets and stop rules before any model trial; offline analysis only, and any paid trial needs a separately approved pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- Adopt/reject/insufficient-evidence per candidate with expected benefit, observed limitations and the smallest follow-up, mapped to existing Future items; an insufficient-evidence result names missing data and a bounded next measurement and never silently removes a review or acceptance gate. _~80 lines._ (S)

##### Track 78B: Follow a stable release channel and let a bootstrap turn on auto-upgrade
_4 tasks . ~280 LOC incl. tests . medium risk_
**Outcome:** gstack-extend upgrades follow a stable release channel rather than main, each upgrade installs the release it offered, and a bootstrap script can turn on auto-upgrade on that channel without a prompt, mirroring gstack's `auto_upgrade` and `update_channel` settings.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover) and O5 (release promise). Required before 1.0. Owner, 2026-11-07: "Another we need here for 1.0 (if not already done) - on install, we should check for gstack and extend and install them if missing + turn on auto upgrade on stable for both — they are dependencies" and "This can be deferred to be done right before 1.0".
**Done when:** An `update_channel` setting selects a stable channel (release tags, or a stable branch the release step advances, chosen in the plan) and keeps today's main-tracking behavior available, with existing main-tracking installs and the rollback recipe documented in `docs/installation.md`; `bin/update-check` offers and `bin/update-run` installs the same release identity, or reports the mismatch; a documented non-interactive command enables auto-upgrade on the channel; `setup` reports a missing gstack install actionably (installing it stays the bootstrap's job unless the plan shows otherwise); `bin/update-check`'s published output and install-safety stay compatible; the compatibility catalog lists the setting; a dated upgrade through the stable channel on the owner's machine is added to the install qualification record.
_touches: bin/update-check, bin/update-run, bin/config, setup, docs/installation.md, docs/compatibility.md, tests/update.test.ts, docs/acceptance/install-upgrade.md_
_blocked-by: Track 77B, Track 77A, Track 75C_
**Scheduling:** Placed "right before 1.0" (owner): the edge on the workflow qualification is a priority choice; the edges on the catalog and install qualification Tracks are technical (it adds the setting to the catalog and appends to the install record). Facts checked 2026-11-08: `bin/update-check` reads `main`'s VERSION from the remote and `bin/update-run` fast-forwards `origin main`; there is no channel setting; `setup` checks only that `bun` exists; `bin/config set auto_upgrade true` is honored only by interactive upgrade flows, and spawned sessions never upgrade. An orchestrator's bootstrap does its own install-if-missing; this repository owes the channel, the setting and the non-interactive enable path.
_Source: owner-approved card (2026-11-07); merges the Future entry "Bind upgrade offers to the installed release identity" (raised during Track 28A planning, 2026-10-23), which the owner's word pulls into 1.0._
_read-first: docs/installation.md, docs/acceptance/release-compatibility.md_
- **Stable channel and offered-equals-installed identity** -- The `update_channel` key and its values, the channel mechanism, and binding the installed release to the offered one, with update tests. _~170 lines incl. tests._ (M)
- **Non-interactive enable and rollback** -- Document and test the bootstrap command and the return to main tracking. _~50 lines incl. tests._ (S)
- **Report a missing gstack at setup** -- An actionable result when installed gstack is absent. _~30 lines incl. tests._ (S)
- **Record a real channel upgrade** -- Upgrade the owner's install through the stable channel and record offered and installed identity in the install qualification record; list the setting in the catalog. _~30 lines._ (S)

### Group 79: Install and upgrade aligned with upstream gstack

_Depends on: Group 78_

**This group delivers:** An install and upgrade flow that looks and behaves like upstream gstack's, with a What's-new summary after every upgrade.

##### Track 79A: Align install and upgrade with upstream gstack
_3 tasks . ~280 LOC incl. tests, plus byte-copied shared blocks . medium risk_
**Outcome:** Installing and upgrading gstack-extend looks and behaves like upgrading upstream gstack: the same flow shape and output style, and a "What's new" summary shown after every upgrade.
**Supports:** [SPEC](SPEC.md) O1 (install, update and recover a working skill set). Included in 1.0 by the owner on 2026-11-08: "A but keep 72c and 78a for 1.0". Owner, 2026-11-07: "One thing I want to do at some point is re-align our install and upgrade process with gstack. Both visually and functionally, including the nice release notes presented to the user".
**Done when:** The upgrade flow's steps, prompts and output match upstream `/gstack-upgrade`'s shape, including snooze, auto-upgrade and just-upgraded handling; after every upgrade the user sees a What's-new summary drawn from `CHANGELOG.md` between the old and new versions (or the commit log on a main-tracking install) and a per-host upgrade summary; fresh-install onboarding is compared with gstack's and any gap recorded; install-safety rules, the `UPGRADE_OK`, `UPGRADE_FAILED`, `MIGRATION_WARN` and `INSTALL_WARN` tokens and `bin/update-check`'s published output stay compatible or migrate explicitly with disclosure; the two recorded update-check test gaps from Track 66A's review have tests.
_touches: skills/gstack-extend-upgrade.md, skills/gstack-extend-init.md, skills/full-review.md, skills/implement.md, skills/plan-track.md, skills/project-spec.md, skills/pair-review.md, skills/ship-and-land.md, skills/roadmap.md, skills/review-and-prep.md, skills/docs-ship.md, bin/update-run, setup, docs/installation.md, tests/skill-protocols.test.ts, tests/update.test.ts, tests/setup-hosts.test.ts_
_blocked-by: Track 78B_
**Scheduling:** The owner first said "at some point" (2026-11-07), then included it in 1.0 (2026-11-08). The edge on the stable-channel Track orders edits to the same upgrade files behind it. It lists every skill file because the shared upgrade-flow block is byte-copied into each of them; those copies do not count toward the card size. Facts checked 2026-11-08: `skills/gstack-extend-upgrade.md` only points the user at `CHANGELOG.md` and shows no summary, while upstream `/gstack-upgrade` shows a grouped What's-new summary; release text from 0.68.0 to 0.72.0 is thin, so the summary is only as good as the CHANGELOG.
_Source: owner-approved card (2026-11-07); Future entry "Recorded test gaps: update-check wording, trigger lines and notice placement" (its trigger, a Track whose `_touches:` cover `tests/skill-protocols.test.ts` and `tests/update.test.ts`, is met here)._
_read-first: skills/gstack-extend-upgrade.md, docs/installation.md_
- **Match upstream's upgrade flow and output** -- Steps, prompts and output format across the shared upgrade flow and `/gstack-extend-upgrade`, keeping the result tokens and install-safety rules. _~150 lines incl. tests, plus shared copies._ (M)
- **What's-new and per-host upgrade summaries** -- Summarize `CHANGELOG.md` (or the commit log) between versions and print one row per host install. _~100 lines incl. tests._ (M)
- **Cover the recorded update-check test gaps** -- Pin the `UPGRADE_SKIPPED spawned-session` sentence and the installation guide's just-upgraded clauses, assert the per-skill `UPGRADE_AVAILABLE` and `JUST_UPGRADED` lines and the spawned branch's placement, and show `bin/update-check` output reaching stdout (`[review:files=tests/skill-protocols.test.ts|tests/update.test.ts]` and `[review:files=tests/skill-protocols.test.ts]`, Track 66A, 2026-11-04). _~30 lines._ (S)

### Execution Map

A Group may launch when every Group in its dependency set has landed;
document order is not an additional gate. The cards label priority choices
separately from technical prerequisites. Adjacency below is the packer's
DEPENDS output with bin numbers replaced by the assigned Group numbers.

```
- Group 75 ← {}
- Group 76 ← {75}
- Group 77 ← {75, 76}
- Group 78 ← {75, 77}
- Group 79 ← {78}
```

**5 Groups / 11 Tracks remaining**, all in the Current Plan.

Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.


## Future

Deferred: docs/roadmap-future.md (94 items)

## Shipped

History: docs/roadmap-shipped.md
