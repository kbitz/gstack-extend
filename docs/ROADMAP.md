# Roadmap

Organized by lifecycle state: **In Progress**, **Current Plan**, **Future** and
**Shipped**. A Track is one PR/session. The packer assigns Groups of disjoint
file footprints and their launch dependencies. Explicit scheduling edges carry
the owner's priority order, and each card's **Scheduling:** line separates its
priority choices from technical prerequisites.

**Owner order.** The owner's 2026-10-30 efficiency-review order has shipped
(Tracks 47A, 48A, 33A, 49A, 50A and 51A, v0.53.0 to v0.59.0). On 2026-11-01 the
owner kept that order with the skill-test narrowing next; it shipped as Track
52A (v0.60.1). On 2026-11-02 the owner approved review-finding attribution
first, then the folded first cycle and caller-configured review delegation as
two measured arms, all ahead of the paused and resumed telemetry Track ("Yes -
your rec sounds good, let's fix" and "1"). That order ran Tracks 64A, 64B, 57A,
64C and 58A (v0.60.2 to v0.63.0). The edges from 57A and 58A to the bounded
documentation-audit Track (then 56A, shipped as 68A) were priority choices, and that
order superseded them. Groups 65 and 66 then shipped in full on 2026-11-03 and
2026-11-04 (Tracks 65C, 65A, 65D, 65B, 66A and 66B, v0.63.1 to v0.66.0), under
the owner's "Yes go" (65B, 2026-11-04), "Merge when ready and keep going"
(2026-11-04) and "Yes and then start 66b" (2026-11-04). Tracks 67A (run and
child usage telemetry, v0.67.0) and 68A (bounded documentation audits, v0.68.0)
followed on 2026-11-05 in the roadmap's own order. The roadmap's order continues
with first-cycle review overlap (69A), then docs-only test selection and
release-only proof (Group 70).

**Pause for the Linux move.** The owner froze new work while the development
setup moves to a new machine (the Linux move), then started Track 67A during
the move window: "let's just keep going, it's going to take all day for […] to
finish, so just start on the next thing" (2026-11-05); 68A followed. The owner
then set the next stop: "When this track is merged, you can do a docs pr, then
we need to pause for the Linux move" (2026-11-05). The regeneration of
2026-11-05 is that docs PR and starts no Track; after it merges, no new Track
starts until the owner says the move is done.

**Keep moving; park only what we should not do.** Owner rule (2026-11-05): "we
never want to 'park' something -- we always want to find a way to keep moving
forward". A stalled or blocked Track is unblocked, split or rerouted, not set
aside. "parking is an option when it turns out we shouldn't even do a track,
because it's counter to our objectives, then it would make sense to park and
re-evaluate". The Linux-move pause is the owner's schedule, not a parked Track.

**Conductor dropped.** Owner decision (2026-11-06): "we are dropping conductor".
[SPEC](SPEC.md) now names Paseo as the only supported workspace host. Track 72B
(the Conductor qualification) is retired unshipped, with its Conductor-only
obligations: the native Cursor receipt and row-interpretation check from
Track 23G and the Conductor host-attribution check deferred from Track 26A.
Its host-neutral obligations (cross-session handoff, an independently followed
onboarding attempt, and the Sonnet-class and `/roadmap` `/docs-ship` runs) move
to the Paseo Track 72C. Removing the Conductor code is the Future entry
"Remove Conductor support from the code".

**Labels.** The regeneration of 2026-11-03 relabelled the nine remaining Groups
53 to 56 and 59 to 63 as Groups 65 to 73 in packer order (`53A` became `65A`,
`56A` became `68A`, `63A` became `73A`; the full map is in that commit
message). The regenerations of 2026-11-04 and 2026-11-05 keep the remaining
Groups (now 69 to 73) and their letters unchanged: the packer's bins for the
remainder are the same. Shipped numbers 33, 47 to 52, 57, 58 and 64 to 68 are
reserved by tombstones; 64 was never a roadmap Group, and Tracks 65C and 65D
were added inside Group 65 when they were launched.

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

Target: [SPEC](SPEC.md) O1–O5, public-release 1.0.0, potentially-public users.
Paseo is the only supported workspace host. The owner-selected
[efficiency program](designs/workflow-efficiency-program.md), SPEC P1, is additional
work and does not gate 1.0. Implementation, installed/operator evidence and
owner acceptance remain distinct. No new spend or unattended merge is authorized.

## In Progress

Track 69A was declared in flight to this regeneration on 2026-11-06 (a working
session; no PR was open at its base), so Group 69 keeps its label and card.
Every shipped Track is recorded independently in shipped history; the latest
are 67A (v0.67.0) and 68A (v0.68.0). Track 28A's required published-release
upgrade acceptance remains in Future; its revisit trigger, the first published
three-part release, was met by v0.48.0 and the item awaits an owner
reassessment. O1 and O3–O5 remain pending.

### Group 69: Shorten the first review cycle

_Depends on: none_

**This group delivers:** Measured overlap of independent first-cycle review work without losing finding quality.

##### Track 69A: Overlap independent first-cycle review work
_1 tasks . ~230 LOC incl. tests . medium risk_
**Outcome:** A full first review cycle can finish sooner without losing independent coverage.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25
**Done when:** E1 establishes a baseline; one immutable scope feeds concurrent specialists, native adversarial and outside pair, with the pair internally sequential and Red Team after merged findings. Host-cap fallback and incomplete voices preserve holds. Before/after wall time and finding quality support activation.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, tests/workflow-metrics.test.ts, docs/acceptance/review-concurrency.md (new)_
_blocked-by: Track 31A, Track 29A, Track 68A, Track 57A_
**Scheduling:** Owner order, 2026-10-25: after the per-finding attribution Track (shipped as 57A, v0.61.0), whose per-part finding quality this Track's activation evidence needs. The folded first cycle shipped first as an opt-in arm (58A, `specialists=fold`, v0.63.0), beside caller-configured delegation (64C, `delegate=`, v0.62.0), the two measured arms of the owner's 2026-11-02 order. Settle at planning how overlap behaves when either value is set, and whether their measured runs still leave overlap worth building. Since installed gstack 1.94.39.0 both values stay off: Track 65C (v0.63.1) left their anchors unqualified because upstream `/review`'s "Done means" contract requires one Agent dispatch per selected specialist, and the Future entry "Reconcile `delegate=` and `specialists=fold` with upstream /review's specialist-dispatch contract" owns that reconciliation, so neither arm's measured run can happen until it lands.
_Source: program E5 / research R2_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Overlap only verified-independent inputs** -- Recheck upstream dependencies; preserve no-fix-before-collection, deduplication, cycle cap, stop and outside-call policy; qualify both hosts and retain the old default behind an option until public activation evidence exists. _~230 lines._ (M)

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 47, 48, 49, 50, 51, 52, 57, 58, 64, 65, 66, 67, 68_

### Group 70: Docs-only test selection ∥ release-only proof and full-run credit

_Depends on: Group 69_

**This group delivers:** A shared docs-only test map, an explained elapsed-time outlier, mechanical release-stamp proof and an opt-in credit for a prepared full run across a release-only delta.

##### Track 70A: Use pregate to select docs-only tests and explain long runs
_2 tasks . ~280 LOC incl. tests . medium risk_
**Outcome:** Docs-only shipping has one policy map for selected tests and attributable work/wait timing.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O3 documentation workflow.
**Done when:** With a usable base policy the nonexecuting pregate explanation owns selected tests and reasons for the exact delta; missing/invalid policy and legacy marker handling are explicit and conservative. Same-tree evidence reuse survives. The reported 211-minute outlier has an evidenced explanation; any unavailable intervals remain open unless the owner explicitly defers that obligation.
_touches: src/docs-ship/pinning.ts, src/docs-ship/cli.ts, src/docs-ship/config.ts, skills/docs-ship.md, docs/docs-ship.md, tests/docs-ship.test.ts, tests/skill-protocols-docs-ship.test.ts_
_blocked-by: Track 31A, Track 29A, Track 69A_
**Scheduling:** Prioritize the main review savings before the separate docs-only path and its long-run investigation; relative call frequency has not been established.
_Source: program E8 / research R8_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Adopt the policy map compatibly** -- Consume exact-delta/base-policy explanation, preserve no-lane and error semantics, and cover policy-backed, policy-less, configured-marker and bump-delta cases without silently losing coverage. _~210 lines._ (M)
- **Account for long docs-only runs** -- Separate active review/test work, host/tool stalls and human waits using E1; retain bounded evidence and unknowns, and attach installed-host qualification to the Paseo host Track (72C). _~70 lines._ (S)

##### Track 70B: Prove release-only reuse mechanically and credit a prepared full run across a release-only delta
_3 tasks . ~520 LOC incl. tests . medium risk_
**Outcome:** A policy-equipped repository gets mechanical stamp-hunk proof before release gate reuse, and an opted-in caller whose preparation already ran the full suite on the prepared head does not run it again for a release-only commit.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25 and owner-approved release-only credit, 2026-10-26; O3/O5 release integrity.
**Done when:** The verified base ship policy drives gstack-tree-receipt; eligible per-lane proof and current evidence are required; same-file functional edits, unreadable policy, stale evidence and stamp-sensitive tests cannot reuse improperly; repositories without policy keep the documented existing path. Under an opt-in policy value (named at planning), when `full-suite=final` is recorded `/ship-and-land` credits a verified full run of the prepared head (same tree, the documented full command, exit 0, tests ran, recorded in the ledger) across a release-only delta and runs only what that delta selects, instead of the full form a second time; without the value, `full-suite=final` keeps today's meaning. An opt-in per-repository list of extra release files keeps a release commit that also edits such a file (for example an acceptance record) on the release-only path; omitted, the release files stay VERSION, the CHANGELOG entry and the files `/ship`'s version tool writes. Under the same opt-in and `full-suite=final`, a verified pregate selection may stand as preparation's main-suite run when the main test command does not select from the diff (today `/review-and-prep`'s coverage rule then runs the full main command). Release edits follow one rule: only an opted-in release-only delta over a credited full run skips the full rerun, and any other or unknown change still runs it. Omitted-policy behavior and an older producer's fallback are documented, and before/after test time is measured on a real run.
_touches: skills/ship-and-land.md, skills/review-and-prep.md, tests/skill-protocols-ship-and-land.test.ts, tests/skill-protocols-review-and-prep.test.ts, docs/workflow-handoffs.md, tests/handoff-contract.test.ts, tests/fixtures/handoffs/, CLAUDE.md_
_blocked-by: Track 29A, Track 69A_
**Scheduling:** Land the main review speed improvements before optimizing release-only proof. **Reach, stated for the owner (2026-11-03):** the full-run credit and the pregate-selection allowance apply under `full-suite=final`, while this project's own reviews run under `full-suite=external` (PRs #191 to #196), so as written they would not shorten this project's releases. Whether the opt-in should also cover `full-suite=external` is settled at planning; the card's scope is unchanged. The mechanical proof and the full-run credit were two Tracks under the card-size rule; the credit edited the same ship-and-land and handoff files and consumed the proof's eligibility result, so the two would have run one after another anyway. Merged into one card under the rule's same-files exception (owner direction, 2026-10-26) and kept at ~520 lines for that reason: splitting it would cost a second full pipeline run for no parallelism.
_Source: program E7 / research R7; owner-approved release-only full-run credit, 2026-10-26_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Integrate mechanical eligibility** -- Record the exact upstream source and helper result, retain required checks and receipt compatibility, and demonstrate valid version-only changes versus invalid hunks without authoring any consumer ship policy. _~210 lines._ (M)
- **Credit a prepared full run across a release-only delta** -- Under the opt-in value, accept a verified full run of the prepared head plus the release-delta selection at Verification Gate (16); add the opt-in per-repository release-file list as a documented project setting; state that rule (only an opted-in release-only delta over a credited full run skips the full rerun, and any other or unknown change still runs it); update the handoff grammar and this repository's release-selection note in `CLAUDE.md`. _~230 lines incl. tests._ (M)
- **Let a verified pregate selection stand when the main command does not select** -- Under the same opt-in and `full-suite=final`, let preparation's verified pregate selection (complete selection retained, tests ran) satisfy its main-suite run when the main command is not a selector, instead of the full main command; partial or unknown coverage keeps today's rule. _~80 lines incl. tests._ (S)

### Group 71: Machine-readable planning artifacts

_Depends on: Group 70_

**This group delivers:** Validated upstream-compatible decisions and findings artifacts alongside the current lean sidecar.

##### Track 71A: Publish upstream-schema lean planning artifacts
_1 tasks . ~240 LOC incl. tests . medium risk_
**Outcome:** An orchestrator can inspect decisions and findings without parsing the review prose.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O4 compatible artifacts.
**Done when:** decisions.jsonl and findings.jsonl validate with installed upstream schemas, carry auto/approval/user_challenge decisions and attributed findings beside the sidecar, and remain consistent on sealing, retries and phase replacement; existing prompt/handoff consumers are unchanged.
_touches: src/autoplan-lean/sidecar.ts, src/autoplan-lean/cli.ts, src/autoplan-lean/history.ts, skills/autoplan-lean.md, docs/workflow-handoffs.md, tests/autoplan-lean.test.ts, tests/autoplan-lean-history.test.ts, tests/skill-protocols-autoplan-lean.test.ts_
_blocked-by: Track 29A, Track 32B, Track 70B, Track 70A_
**Scheduling:** Land direct test, audit, review and shipping efficiency changes before the planning-artifact producer.
_Source: program E9 / research R10_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Emit and validate machine artifacts** -- Map the current sidecar semantics to upstream schemas; preserve IDs and source provenance and report unknowns; bind records to the sealed plan/review without inventing decisions or adding a parallel format. _~240 lines._ (M)

### Group 72: Supporting contracts and Paseo host acceptance

_Depends on: Group 71_

**This group delivers:** A stable-interface catalog, evidence/recovery design and qualification on Paseo.

##### Track 72A: Publish the stable compatibility and recovery catalog
_1 tasks . ~180 LOC incl. tests . medium risk_
**Outcome:** Public users can identify stable interfaces, experimental exclusions and recovery obligations.
**Supports:** [SPEC](SPEC.md) O5.1; preserved required inbox obligation, 2026-10-23
**Done when:** A catalog names every promised surface, version/compatibility rules, support conditions and recovery links; stage-runs v2 is one checked example, not the whole catalog. Experimental surfaces stay explicitly excluded; no checkpoint is awarded by documentation alone.
_touches: docs/compatibility.md (new), docs/SPEC.md, README.md, docs/installation.md_
_blocked-by: Track 28A, Track 71A_
**Scheduling:** The stable-interface catalog remains a 1.0 obligation but does not delay the selected efficiency work.
_Source: [plan-ceo-review] stable compatibility surfaces (O5.1)_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Catalog the promised surfaces** -- Trace CLI/config, skills, handoffs, provenance and install ownership against shipped code and public instructions. Carry the existing stable promises and disclose unknown qualification; retain O5 acceptance as an owner gate. _~180 lines._ (M)

##### Track 72C: Qualify the complete Paseo workflow and external and cross-session handoffs
_1 task . ~200 LOC incl. tests . medium risk_
**Outcome:** Paseo users and an external orchestrator can carry real work through the supported stages.
**Supports:** [SPEC](SPEC.md) O1/O3/O4 — workspace guard wording is shipped, but end-to-end host and consumer acceptance is not established.
**Done when:** A named release/profile has fresh install, upgrade/recovery, real plan-to-authorized-release, interrupted resume, manual-testing pause, full-review restart, external-consumer handoff and cross-session handoff evidence; pending approvals or failures remain holds.
_touches: docs/acceptance/paseo.md (new)_
_blocked-by: Track 26A, Track 23I, Track 23A, Track 28A, Track 26B, Track 65A, Track 66A, Track 66B, Track 71A_
**Scheduling:** Retain broad host qualification after the direct efficiency changes and planning artifacts; moving telemetry earlier does not move or waive this acceptance gate. The update-check edge keeps the upgrade qualification on the final upgrade behavior.
- **Exercise the supported Paseo profile** -- Use the actual host-managed worktree and approved accounts with Codex implementation, Cursor review and Claude planning/release where supported. Retain the bound PR and worktree, test stale/partial/held handoffs, confirm next-stage consumption from artifacts, and count operator interventions. Include the installed Paseo host-attribution check the user deferred from Track 26A (DFR1). Verify preserved work and stable artifact bindings after changing sessions (the cross-session handoff moved from the retired Conductor Track 72B, 2026-11-06). The real external consumer may stop at a ready PR; a separate authorized human-driven run proves landing. At least one of the two onboarding attempts must be followed independently of the maintainer. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. _~200 documentation lines._ (L)
**Include installed `/docs-ship` acceptance** -- Run a real docs-only PR on Paseo through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging. Include one Sonnet-class run and one `/roadmap` handoff; compare work/wait wall time with a recent docs PR shipped through the ordinary path. Source: `[manual] Qualify /docs-ship on a real docs-only PR on both workspace hosts`, 2026-10-23 (Paseo only since 2026-11-06). This is part of the one host qualification task, not another release authorization.

##### Track 72D: Specify portable review evidence and capped-review recovery
_2 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** Callers know what proves a completed full review and how a stopped draft can reach shipping.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O4 provenance and O3 stop preservation.
**Done when:** A supporting design maps review facts to a portable evidence-bundle reference and independently checks review-log full-scope/completion/convergence/binding predicates. Documentation walks stopped draft → authorized exact repair-only continuation → prepared readiness → ship with all unavailable evidence and continuation counts preserved, including a stop after a first cycle that reproduced defects; it cites the already recorded rule that `/ship-and-land` keeps refusing a stopped draft, including one whose receipt says `Unresolved: none recorded` (`B-STOPPED-NONE-RECORDED`). No envelope runtime or stop bypass is introduced.
_touches: docs/designs/review-evidence-envelope.md (new), docs/workflow-handoffs.md_
_blocked-by: Track 29A, Track 71A, Track 30A, Track 32A_
**Scheduling:** Preserve the evidence design and capped-review recovery work after the direct savings and artifact producer; the artifact producer edge is priority ordering, not a claimed technical prerequisite. The capped-review repair and baseline-repair edges are technical: the documented recovery path must describe the shipped repair-only continuation, including after a first cycle that reproduced defects. This Track specifies and checks the cycle 1 baseline record and does not write it.
_Source: program E10–E11 / research R11 and observed capped-review stops_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Map the existing upstream proof** -- Compare commit_full/tree/scope/completed/converged/cycles plus review_binding and verified/imported lane semantics; specify missing/stale/unavailable cases and identify gaps without claiming nonconverged full scope is a completed baseline. _~150 lines._ (M)
- **Document the recovery path** -- Use the stop receipt's own repair-only prompt and remaining budget, which the capped-review and baseline repairs make reachable after a completed first cycle, preserve the bound PR, and show why shipping cannot replace the continuation, including for a receipt that says `Unresolved: none recorded`. Keep manual holds and Full-review evidence: unavailable explicit. _~70 lines._ (S)

### Group 73: Workflow efficiency baseline and decisions

_Depends on: Group 72_

**This group delivers:** A reproducible cross-run baseline report and an adopt, reject or insufficient-evidence decision for each optimization.

##### Track 73A: Build a comparable workflow-efficiency baseline and evaluate each optimization
_3 tasks . ~440 LOC incl. tests . medium risk_
**Outcome:** The maintainer can reproduce an offline report that separates model work, tool/CI/human waits, reuse and rework across runs, and gets an evidence-backed decision for each proposed optimization, including a valid conclusion that a change is not worthwhile or that evidence is insufficient.
**Supports:** [SPEC](SPEC.md) P1 and owner-selected investigation, 2026-10-19; empirical model comparison and review-policy changes remain outside the 1.0 acceptance gates.
**Done when:** A reproducible offline report from sanitized projections separates DOCS/FULL/release-only paths, diff/task size, repo/host, skill version, waits and fresh versus resumed runs, and reports sample size and missingness; fixtures cover each split. Each candidate has measured evidence or a named evidence gap; comparisons include total parent/child usage, quality and capture overhead; each candidate gets adopt, reject or insufficient evidence with its follow-up mapped to existing Future items. No review gate or model choice changes, and no model downgrade or review gate is changed by the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new)_
_blocked-by: Track 67A, Track 52A, Track 72A, Track 72D, Track 72C_
**Scheduling:** Keep the cross-run efficiency assessment after the selected changes and host-qualification work; individual changes still need their own before/after evidence before activation. The baseline report and the evaluation were two Tracks under the card-size rule; the evaluation edited the same script, test and fixture files and read the report the baseline builds, so the two would have run one after another anyway. Merged into one card under the rule's same-files exception (owner direction, 2026-10-26) and kept at ~440 lines for that reason: splitting it would cost a second full pipeline run for no parallelism.
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
- **Build a comparable baseline** -- Produce an offline report from sanitized projections. Separate DOCS/FULL/release-only paths, diff/task size, repo/host, skill version, waits and fresh versus resumed runs; report sample size and missingness. Reuse eligible existing release-only receipts and preserve the separate first-installed-no-CI timing obligation and 15-minute target. Report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~180 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs. Investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Use the existing eval/benchmark facilities where suitable; define corpus, quality bars, fixed budgets and stop rules before any model trial. Include known-defect controls and false positives; a saved success flag is not quality evidence. This Track authorizes offline analysis; any new paid/API trials need a separately approved concrete pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- For each candidate give adopt/reject/insufficient-evidence, expected benefit, observed limitations and the smallest follow-up scope. Map recommendations to existing Future items rather than duplicating them: lifecycle helper, eval persistence, vendor diversity, the delta-scoped review default and on-demand `/review-and-prep` section loading. Preserve the independent historical review-independence study and its unfulfilled evidence obligations. An insufficient-evidence result names missing data and a bounded next measurement; it never silently removes a review or acceptance gate. _~80 lines._ (S)


### Execution Map

A Group may launch when every Group in its dependency set has landed;
document order is not an additional gate. The cards label priority choices
separately from technical prerequisites. Adjacency below is the packer's
DEPENDS output with bin numbers replaced by the assigned Group numbers.

```
- Group 69 ← {}
- Group 70 ← {69}
- Group 71 ← {70}
- Group 72 ← {71}
- Group 73 ← {72}
```

**5 Groups / 8 Tracks remaining.** Group 69 is In Progress; Groups 70 to 73
are in the Current Plan.

The published-upgrade obligation remains open and is not waived; its revisit trigger has been met and it awaits owner reassessment. Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.


## Future

Deferred: docs/roadmap-future.md (85 items)

## Shipped

History: docs/roadmap-shipped.md
