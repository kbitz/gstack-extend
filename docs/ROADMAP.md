# Roadmap

Organized by lifecycle state: **In Progress**, **Current Plan**, **Future** and
**Shipped**. A Track is one PR/session. Explicit scheduling edges prioritize
efficiency and speed, with the owner-priority capped-review repair directly after
the upstream drift check and telemetry immediately after test savings; the packer
then assigns Groups of disjoint file footprints and their launch dependencies.

Target: [SPEC](SPEC.md) O1–O5, public-release 1.0.0, potentially-public users.
Paseo and Conductor retain equal priority. The owner-selected
[efficiency program](designs/workflow-efficiency-program.md), SPEC P1, is additional
work and does not gate 1.0. Implementation, installed/operator evidence and
owner acceptance remain distinct. No new spend or unattended merge is authorized.

## In Progress

Declared by the owner on 2026-10-25: Track 29A, in Group 29, is in progress on a
working branch. Its review is running and its pull request will open from that
branch. Group 29 holds only that Track, so its label stays pinned until the pull
request merges. Track 28A's candidate-only transition is recorded independently
in shipped history; its required published-release upgrade remains in Future until
the first three-part release exists. O1 and O3–O5 remain pending.

### Group 29: Launch-time upstream drift check

_Depends on: none_

**This group delivers:** Launch-time upstream compatibility checks that show contract drift before a stage takes a more expensive path.

##### Track 29A: Check installed upstream contracts at launch
_2 tasks . ~320 LOC incl. tests . medium risk_
**Outcome:** A caller sees contract drift before a stage silently takes a more expensive path.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O4 compatibility.
**Done when:** A local no-model check covers every wrapper anchor, imported export and lean criteria check, prints OK or DRIFT plus documented exit status, and completes in under one second on a named profile; malformed/missing inputs report drift. Golden tests cover advisory not-ready findings, and docs state the 120-minute lease limit.
_touches: bin/upstream-check (new), src/upstream-check/ (new), src/outside-review/cli.ts, tests/upstream-check.test.ts (new), tests/outside-review.test.ts, tests/helpers/touchfiles.ts, .gstack/pregate.json, docs/upstream-check.md (new), docs/outside-review.md_
_Source: program E2 / research R5_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Ship the read-only checker** -- Inventory anchors and adapter imports from source, call the current lean drift command, report installed versions and exact failures; no pin, hold, upgrade, network or model dispatch. Record copied upstream source. _~220 lines._ (M)
- **Qualify semantics and timing** -- Add missing/changed-anchor, export, classifier and criteria cases; measure startup-inclusive latency and document lease expiry without claiming an observed mid-run upgrade. _~100 lines._ (S)

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28_

### Group 30: Repair a capped review

_Depends on: Group 29_

**This group delivers:** A tests-or-docs-only final-gate repair that reaches readiness without capping the review, and a cap after a completed first cycle that its repair-only continuation can resume.

##### Track 30A: Repair a test-only final-gate failure without capping the review
_2 tasks . ~360 LOC incl. tests . medium risk_
**Outcome:** A prepared review that fails its final full test run on a tests-or-docs-only defect reaches readiness without a fourth review pass, and a cap after a completed first cycle can be continued by its repair-only continuation instead of refusing.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O3.2 (a stage never repeats a completed review without cause) and O4.2 (a stopped run stays explicit and recoverable).
**Done when:** When the final full test run fails and the repair changes no source file (tests or docs only), the skill repairs it, reruns the failed tests and then the full gate once, and continues to readiness; that repair is not a review cycle, does not count against `/review`'s three-cycle cap and needs no further review cycle. Because a test-only repair can make a real failure pass by weakening a test, the repair diff gets at least a native adversarial pass, and the receipt records the repair, its rerun and that no full review cycle covered it. A repair that changes a source file, a path the skill cannot classify, or a second failure of that gate keeps today's rule. Cycle 1 records its completed full-review baseline in the form the repair-only continuation guard reads, and a regression shows a cap after a completed cycle 1 continuing under `continuation=repair-only`; a cap without a completed cycle 1 still reads `Full-review evidence: unavailable` and holds. The repair rule would change a default for every caller, so it ships behind a documented `Review policy:` value unless the Track records the evidence a public default change needs; omitted-policy behavior and an older producer's fallback are documented. `/ship-and-land` keeps refusing a stopped draft, including one whose receipt says `Unresolved: none recorded`.
_touches: skills/review-and-prep.md, docs/workflow-handoffs.md, tests/skill-protocols-review-and-prep.test.ts, tests/handoff-contract.test.ts, tests/fixtures/handoffs/_
_blocked-by: Track 29A_
**Scheduling:** Owner priority, 2026-10-25: the next work after the upstream drift check and ahead of the timing work. The edge is a priority choice, not a technical prerequisite.
_Source: program E14; observed capped-review stops_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Repair test-only failures outside the cycle cap** -- Define how the skill classifies a repair as test or documentation versus source (an unknown path counts as source), the repair, failed-test rerun and single full-gate rerun sequence, the adversarial pass on the repair diff, the receipt lines and the policy value; document how an older producer reads it (the grammar is v1 with fixed keys, and an unknown value reads as `none supplied`). _~200 lines._ (M)
- **Record cycle 1's baseline for the continuation guard** -- Write the completed pass's full-review evidence from the actual cycle 1 record, never inferred from HEAD, in the form the stopped receipt and its guard already read; add the regression for a cap after a completed cycle 1 and the negative for an incomplete one; leave the guard's author, tree and count checks intact. This is a repair of the producer record and changes no default. _~160 lines._ (M)

### Group 31: Truthful timing and metric isolation

_Depends on: Group 30_

**This group delivers:** Trustworthy work/wait attribution without fixture rows contaminating real observations.

##### Track 31A: Record truthful timing and isolate synthetic metrics
_2 tasks . ~400 LOC incl. tests . medium risk_
**Outcome:** Operators can attribute stage work and waits without fixture rows contaminating real observations.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O4.3 provenance.
**Done when:** Events are stamped at the actual boundary; completion, pregate, tests, coverage, documentation and Greptile have spans; the fixture-shaped real-store writer is traced and its pollution path stopped, and isolated checks prove synthetic runs do not touch real analytics. An unresolved writer keeps this obligation open. Historical rows remain intact.
_touches: bin/lib/workflow_metrics.py, skills/review-and-prep.md, skills/ship-and-land.md, skills/autoplan-lean.md, skills/implement.md, skills/docs-ship.md, docs/telemetry.md, docs/workflow-metrics.schema.json, tests/workflow-metrics.test.ts, tests/telemetry-contract.test.ts, tests/helpers/telemetry-env.ts_
_blocked-by: Track 30A_
**Scheduling:** Owner priority, 2026-10-25: the capped-review repair runs before this Track; the edge is a priority choice, not a technical prerequisite.
_Source: program E1 / research R3_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Capture boundaries as they happen** -- Add begin/end work and wait records at the owning skill boundaries with truthful interrupted/unknown handling; keep existing schema consumers and optional telemetry behavior compatible. _~240 lines._ (M)
- **Trace and fence synthetic writes** -- Find the producer of the observed fixture-shaped rows; qualify all test and shell-example entry points with isolated state and before/after real-store integrity checks. Do not claim current fixtures are at fault from UUID shape alone. _~160 lines._ (M)

### Group 32: Reduce repeated and overbroad test work

_Depends on: Group 29, Group 31_

**This group delivers:** An opt-in full-suite policy and narrower skill-only test selection with required coverage preserved.

##### Track 32A: Narrow the remaining broad skill-test readers
_1 tasks . ~260 LOC incl. tests . medium risk_
**Outcome:** A skill prose edit runs the content rules it reaches without paying for unrelated installer mechanics.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; observed broad-suite cost from 2026-10-23
**Done when:** Measured skill-only selection removes unnecessary broad mechanics while every real-skill content rule still runs for its consumers, dependency-map parity and conservative full-suite fallback hold, and before/after test time and coverage are recorded.
_touches: tests/telemetry.test.ts, tests/setup-hosts.test.ts, tests/helpers/telemetry-env.ts, tests/helpers/touchfiles.ts, tests/touchfiles.test.ts, tests/skill-content.test.ts (new), .gstack/pregate.json_
_blocked-by: Track 31A, Track 29A_
**Scheduling:** Reduce recurring skill-test cost in the first savings batch, alongside the full-suite policy; requested-model provenance is not a technical prerequisite.
_Source: [manual] narrow the two broad skills suites_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Separate real-skill readers from fixture mechanics** -- Use existing cross-skill invariants to keep all content dependencies explicit, retain installer/telemetry behavior coverage, and sync the pregate dependency map. Measure a representative skill-only edit without weakening unknown-change fallback. _~260 lines._ (M)

##### Track 32B: Run the full suite before the documentation audit by policy
_2 tasks . ~330 LOC incl. tests . medium risk_
**Outcome:** An opted-in caller avoids a second full suite after documentation-audit-only edits.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O3 verification and O4 receipts.
**Done when:** before-audit is an explicit cross-stage policy value; the full-run tree and audit-owned delta are recorded; only that delta can select final pregate lanes, all other or unknown changes require a full rerun; receipts state which ran. final and omitted-policy behavior are unchanged.
_touches: skills/review-and-prep.md, skills/ship-and-land.md, docs/workflow-handoffs.md, tests/skill-protocols-review-and-prep.test.ts, tests/skill-protocols-ship-and-land.test.ts, tests/handoff-contract.test.ts, tests/fixtures/handoffs/_
_blocked-by: Track 31A_
_Source: program E3; owner-approved policy option_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Carry policy and evidence through all stages** -- Define parsing, continuation propagation and prepared/ship receipt semantics; bind the full suite to its reviewed tree and audit output; include release edits in the conservative rerun rule. _~190 lines._ (M)
- **Verify reuse and invalidation** -- Test docs-only audit delta, no changes, non-doc fixes, changed policy/base, missing evidence and stale trees; measure savings using E1 spans without changing public defaults. _~140 lines._ (M)

### Group 33: Paused and resumed telemetry

_Depends on: Group 31, Group 32_

**This group delivers:** Truthful blocked/completed segments with stable run identity across resumes.

##### Track 33A: Record paused, blocked and resumed runs
_2 tasks . ~300 LOC incl. tests . medium risk_
**Outcome:** An external caller can tell a run that stopped for a person from one that never ran, and a run resumed in another checkout still records its completion.
**Supports:** [SPEC](SPEC.md) O4 criteria 2–3 and O3 — blocked work must be explicit and starts and finishes must keep their run identity; today a deliberate pause defers finish, and a resume in a new worktree finds no handoff in its root and writes nothing.
**Done when:** A deliberate pause in `/review-and-prep`, `/pair-review` or `/full-review` writes one row with outcome `blocked`; a resumed run that completes writes its own row, including from a different checkout root; each start pairs with exactly one finish; every installed skill copy carries the same updated start/finish wording; the join contract describes how segments link, and v1, v2 and legacy rows stay readable.
_touches: bin/lib/telemetry.py, docs/telemetry.md, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, tests/skill-protocols.test.ts, skills/autoplan-lean.md, skills/docs-ship.md, skills/full-review.md, skills/gstack-extend-init.md, skills/gstack-extend-upgrade.md, skills/implement.md, skills/pair-review.md, skills/project-spec.md, skills/review-and-prep.md, skills/roadmap.md, skills/ship-and-land.md_
_blocked-by: Track 23H, Track 23I, Track 26A, Track 31A, Track 32B, Track 32A_
**Scheduling:** Owner-selected order: telemetry follows test savings immediately. Complete paused/resumed segments before their dependent requested-model and usage work.
_read-first: 23H, 23I, 26A, docs/telemetry.md_
- **Close each paused segment with a blocked row** -- Replace "A deliberate pause defers finish" at the pause points of the three resumable skills with a finish that records `blocked`, the outcome stage-runs schema v2 has reserved since 0.37.0.0. Update the shared start/finish wording in all eleven skill copies, including `skills/autoplan-lean.md` (added in 0.40.0.0), and the `RESUMABLE` adoption rule with it. While editing, re-anchor two stale Track references to their current owners in words rather than IDs: `skills/pair-review.md` ("Track 24B owns the future canonical hold/resume detector", written when 24B was the stage-handoff contract Track, since shipped as 23I) and `docs/telemetry.md` (2026-10-25 source text: "receipt 2 or Track 27A evidence", which means the Conductor host qualification). Evidence (2026-10-16): no review-and-prep row for five of seven recent orchestrated PRs, and 5 review-and-prep handoffs among 24 leftover starts. Source: `[manual] Give paused and blocked /review-and-prep runs a stage-runs row`. _~180 lines._ (M)
- **Record a resumed completion in any checkout** -- A resume starts its own segment, linked to the paused one by an identifier settled at planning (run identity or the launcher's work item), so a resume in a new worktree records its completion; use the status words of the stage-handoff contract. Align step/pass boundaries with the companion ledger from Track 24A; interrupted or unobserved intervals stay unknown. Settle at planning how this relates to the Future cards "Recover a telemetry finish run from a different repository root" and "In-flight marker and crash detection for extend telemetry". _~120 lines._ (M)

### Group 34: Requested-model provenance

_Depends on: Group 33_

**This group delivers:** Requested model values recorded separately from observed and billed values.

##### Track 34A: Record a caller-requested model where detection finds none
_1 task . ~120 LOC incl. tests . low risk_
**Outcome:** A launcher can record the model and effort it requested for a stage whose harness log names none, and readers can tell that value from an observed one.
**Supports:** [SPEC](SPEC.md) O4 criterion 3 — requested-versus-observed model evidence must be distinguishable; every local `cursor-agent` row (29 ship-and-land rows, releases 0.34.2.0 to 0.36.8.0) has model null with source unknown.
**Done when:** `GSTACK_EXTEND_MODEL` and `GSTACK_EXTEND_EFFORT` fill only a null detected value and carry the requested source label, never `detected`; detection and finish flags still win; a `cursor-agent` fixture covers the route; `docs/telemetry.md` documents both variables.
_touches: bin/lib/telemetry.py, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, docs/telemetry.md, docs/stage-runs.schema.json_
_blocked-by: Track 26A, Track 33A_
**Scheduling:** This is the second telemetry step after test savings; preserve the paused-segment prerequisite.
_read-first: 26A, docs/telemetry.md_
- **Record the caller's requested model and effort** -- Stage-runs schema v2 (0.37.0.0) already reserves the `requested` source for non-null model and effort; this Track is its first producer. On Cursor's CLI route (`CURSOR_INVOKED_AS` set) `_observe_cursor_store()` skips the store and `cursor_turns()` returns only a transcript mtime. A local check on 2026-10-16 found no model in `cursor-agent` transcripts or chat-store metadata, and `~/.cursor/cli-config.json` holds only a configured default, which provenance must not record. Check whether `cursor-agent --output-format json` events name the model before relying on the environment alone. Source: `[manual] Accept a caller-supplied model when detection finds none, labeled as requested`. _~120 lines._ (S)

### Group 35: Workflow and reviewer usage telemetry

_Depends on: Group 31, Group 33, Group 34_

**This group delivers:** Attributable parent/child usage from local logs with explicit uncertainty.

##### Track 35A: Attribute workflow and reviewer usage from local session logs
_3 tasks . ~600 LOC incl. tests . medium risk_
**Outcome:** The maintainer can compare total parent-and-child token usage by workflow, step and recorded model, with explicit uncertainty where a source cannot support attribution.
**Supports:** [SPEC](SPEC.md) P1 and owner-selected usage capture, 2026-10-19; promotes the two retained run-usage and outside-voice Future commitments without enabling quota routing or vendor usage API calls.
**Done when:** A local report combines step/pass events with disjoint token classes and available plan-window observations, distinguishes direct evidence from time/directory correlation, and excludes ambiguous or overlapping usage from exact totals; fixtures cover streaming copies, cumulative counter resets, nested children and concurrent sessions; unknown values remain null with reasons.
_touches: bin/lib/telemetry.py, bin/lib/workflow_metrics.py, bin/lib/quota/usage.py, docs/workflow-metrics.schema.json, docs/telemetry.md, docs/stage-runs.schema.json, tests/workflow-metrics.test.ts, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, tests/quota.test.ts, tests/fixtures/quota/, tests/helpers/touchfiles.ts_
_blocked-by: Track 24A, Track 26A, Track 33A, Track 34A, Track 31A_
**Scheduling:** Complete parent/child usage attribution as the third telemetry step, before bounded audits and review overlap.
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
_produces: comparable per-run and per-voice local usage projections, source/attribution grades and a replayable sanitized fixture corpus_
- **Reuse the local log parser for run usage** -- Absorb "Record each run's token usage and plan-window readings from the harness's own logs". Reuse or isolate the existing quota usage parser rather than introduce a third parser. Record uncached input, cache read/write and output; reasoning is a subset, never added twice. Retain logged start/end rate-limit readings with reset and concurrency caveats; account-wide percentage changes are not attributable stage consumption. Cursor/Grok sources remain unknown until verified. Read only session logs and CLI output: no credentials, identity/capacity readers or vendor usage services. _~240 lines._ (M)
- **Attribute child and outside-reviewer usage** -- Absorb "Record outside-voice calls' vendor, model, tokens and window readings". Join each recorded call to its invocation and pass using direct parent/session evidence when available, including the local `voices.jsonl` reviewer join (host subagent identifier, parent-observed dispatch/return times) that 0.38.0.0 added; mark directory/time matches as correlation and ambiguous shared-worktree matches as unknown. Deduplicate native subagents and cross-harness children, account for children that outlive the step, and preserve every contributing model/source. Do not modify upstream commands or claim observed/billed models from requested labels. _~240 lines._ (M)
- **Preserve schema and parser compatibility** -- Use the step ledger for detailed usage and retain immutable legacy/v1/v2 stage rows. Coordinate any stage-row reference fields with the stage-runs v2 schema shipped in 0.37.0.0; never add fields silently to a published closed schema. Preserve saved retry bytes and paused-segment linkage, publish only sanitized projections, and prove capture makes no credential or network calls. When editing `bin/lib/workflow_metrics.py`, weigh the Future item "Slim the workflow-metrics helper without dropping requirements"; adopting it is optional. _~120 lines._ (S)

### Group 36: Bound audit effort and complete handoffs

_Depends on: Group 31, Group 32, Group 35_

**This group delivers:** Fewer irrelevant documentation reads and complete implementation handoffs after owned tests finish.

##### Track 36A: Bound documentation audits by changed contracts
_1 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** Reviews read the documentation relevant to their changed contracts and retain real drift detection.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25
**Done when:** The scope includes changed-path and contract references, linked authorities and safe broad fallback when relevance is uncertain; the one re-audit follows only the fix delta. Before/after time, read volume and retained finding quality are recorded before any default activation.
_touches: skills/review-and-prep.md, skills/ship-and-land.md, tests/skill-protocols-review-and-prep.test.ts, tests/skill-protocols-ship-and-land.test.ts, docs/acceptance/documentation-audit-efficiency.md (new)_
_blocked-by: Track 31A, Track 32B, Track 35A_
**Scheduling:** Owner-selected order places telemetry immediately after test savings, then bounded documentation audits; this added edge is a priority choice.
_Source: program E4 / research R4_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Constrain discovery and re-audit inputs** -- Keep current/updated/blocked truthful and the existing attempt bound; compare the bounded audit against representative known documentation drift. If public-quality evidence is insufficient, expose an explicit option and retain the default. _~220 lines._ (M)

##### Track 36B: Make implement handoffs explicit and await owned tests
_1 tasks . ~120 LOC incl. tests . medium risk_
**Outcome:** External callers receive complete handoffs with machine-readable counts after tests finish.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O3.1 and O4.1–2.
**Done when:** Every successful handoff prints DEFERRED BY USER <n>, BLOCKED <n>, zeros included; BLOCKED still refuses a handoff. A long owned test is followed inside the active turn through its terminal result, with progress updates and no partial success prompt. The skill states how it waits past the host's foreground command cap (a foreground command caps at 10 minutes in Claude Code, while the full suite takes 30 to 70): it runs the test so its result stays readable after the cap, then keeps the turn open with repeated bounded foreground waits, each under the cap, on that run's completion marker, reporting progress between waits. A run still pending when the turn ends is a missing handoff, never a partial success; three observed incidents had an implementer start the suite in the background and end its turn waiting. The Track reconciles this with the existing rule against polling, and a drift-lock test pins the wording.
_touches: skills/implement.md, docs/workflow-handoffs.md, tests/skill-protocols-implement.test.ts, tests/handoff-contract.test.ts, tests/fixtures/handoffs/_
_blocked-by: Track 31A, Track 32B, Track 35A_
**Scheduling:** Run after the telemetry block, alongside the disjoint bounded-audit work; the added edge implements the selected order.
_Source: program E6; observed missing-count and no-handoff incidents_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Pin the counts and waiting contract** -- Update the producer template and compatibility fixtures; cover zero/nonzero deferred rows and blocked refusal, and give the long-running-test lifecycle explicitly, including the wait past the host's foreground cap and the pending-run turn end as a missing handoff. _~140 lines._ (S)

### Group 37: Attribute review findings to their source part

_Depends on: Group 29, Group 31, Group 36_

**This group delivers:** Every logged review finding names the specialist, Red Team, native adversarial pass or outside voice that found it.

##### Track 37A: Attribute every logged review finding to the part that found it
_1 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** A maintainer comparing review arms can see, finding by finding, which part found it, so the value of each part is measured instead of assumed.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25 (the first-cycle overlap's activation evidence needs per-part finding quality); O4.3 provenance.
**Done when:** Every finding the wrapper logs for a review names the part that found it: a named specialist, Red Team, the native adversarial pass or an outside voice. A finding several parts reported keeps every part, and one that cannot be attributed reads unknown with its reason, never a guess. The closed metrics finding record gains a new schema version branch rather than a silent field, and earlier rows stay readable as unknown. Fixtures cover each part and a merged finding. Upstream's review log is read, not edited.
_touches: skills/review-and-prep.md, bin/lib/workflow_metrics.py, docs/workflow-metrics.schema.json, docs/telemetry.md, tests/workflow-metrics.test.ts, tests/skill-protocols-review-and-prep.test.ts_
_blocked-by: Track 31A, Track 29A, Track 36A_
**Scheduling:** Owner order, 2026-10-25: after the timing Track and before the first-cycle overlap, whose activation evidence needs it. Placing it with the review-cycle work, after the audit Track, follows the efficiency program's delivery order and is a priority choice.
_Source: program E13; observed unattributed review findings_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Name the part that found each finding** -- Carry the specialist name upstream's findings already hold, the Red Team tag and a native-adversarial or outside-voice source from each pass's own record into the wrapper's finding rows. The metrics finding record carries a severity class but no named part and rejects unknown keys, so add a schema branch and keep earlier rows readable. _~220 lines._ (M)

### Group 38: Opt-in folded first review cycle

_Depends on: Group 29, Group 31, Group 36, Group 37_

**This group delivers:** A measured alternative to specialist subagents in the first review cycle, with the arm that ran recorded and today's default unchanged.

##### Track 38A: Offer an opt-in first review cycle that folds specialist checklists into the main pass
_2 tasks . ~300 LOC incl. tests . medium risk_
**Outcome:** A caller can measure whether the specialist subagents pay for themselves by running a first cycle without them, with every other review part unchanged and the arm that ran recorded.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O3.2.
**Done when:** An opt-in mode, a documented `Review policy:` value or flag, runs cycle 1 without dispatching specialist subagents: the main review pass reads the selected specialists' checklists itself, loaded on demand. Red Team when its gate fires, the native adversarial pass and the outside voices run as today. Installed `/review` triggers Red Team on a diff over 200 lines or a specialist CRITICAL finding; with no specialist dispatches the mode restates that as the size arm or a CRITICAL finding from the folded pass. The mode activates only while the installed `/review` text it relies on matches byte for byte, as `in-cap=delta` does, and it edits no upstream file; if folding needs upstream text to change, the Track records that and stops. Its anchors join the upstream drift check's inventory. Today's default stays and the receipt records which arm ran. The policy grammar is v1 with fixed keys, so an older producer's fallback is documented, and the documentation notes that upstream's adaptive gating statistics learn only from specialist dispatches, so a folded review adds no sample. The quality comparison is a consumer-owned experiment outside this repository; this Track authorizes no spend and no default change.
_touches: skills/review-and-prep.md, docs/workflow-handoffs.md, src/upstream-check/, tests/upstream-check.test.ts, tests/skill-protocols-review-and-prep.test.ts, docs/acceptance/review-fold.md (new)_
_blocked-by: Track 31A, Track 29A, Track 36A, Track 37A_
**Scheduling:** Sits beside the first-cycle overlap Track as an alternative. The timing Track's measurements decide which runs first; the packer's order between them is a placeholder, not that decision. If folding wins, overlapping the specialists matters less.
_Source: program E12; observed zero-finding specialist reviews_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Define the folded cycle and its gate** -- Name the installed `/review` text the substitution relies on and check it byte for byte at launch; carry the policy value through preparation and continuations; restate Red Team's trigger for a review with no specialist dispatches; keep the native adversarial pass, outside voices, cap and stop unchanged. If upstream text would have to change, record it and stop. _~200 lines._ (M)
- **Record the arm and qualify the drift check** -- Name the arm that ran and the checklists the main pass read in the receipt and metrics; add the anchors to the drift inventory with missing and changed cases; document the value for older producers. _~100 lines._ (S)

### Group 39: Shorten the first review cycle

_Depends on: Group 29, Group 31, Group 36, Group 37, Group 38_

**This group delivers:** Measured overlap of independent first-cycle review work without losing finding quality.

##### Track 39A: Overlap independent first-cycle review work
_1 tasks . ~230 LOC incl. tests . medium risk_
**Outcome:** A full first review cycle can finish sooner without losing independent coverage.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25
**Done when:** E1 establishes a baseline; one immutable scope feeds concurrent specialists, native adversarial and outside pair, with the pair internally sequential and Red Team after merged findings. Host-cap fallback and incomplete voices preserve holds. Before/after wall time and finding quality support activation.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, tests/workflow-metrics.test.ts, docs/acceptance/review-concurrency.md (new)_
_blocked-by: Track 31A, Track 29A, Track 36A, Track 37A_
**Scheduling:** Owner order, 2026-10-25: after the per-finding attribution Track, whose per-part finding quality this Track's activation evidence needs. The folded first-cycle alternative sits beside this Track; the timing Track's measurements decide which runs first.
_Source: program E5 / research R2_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Overlap only verified-independent inputs** -- Recheck upstream dependencies; preserve no-fix-before-collection, deduplication, cycle cap, stop and outside-call policy; qualify both hosts and retain the old default behind an option until public activation evidence exists. _~230 lines._ (M)

### Group 40: Efficient docs-only and release-only paths

_Depends on: Group 29, Group 31, Group 32, Group 39_

**This group delivers:** A shared docs-only test map, an explained elapsed-time outlier and mechanical release-stamp proof.

##### Track 40A: Use pregate to select docs-only tests and explain long runs
_2 tasks . ~280 LOC incl. tests . medium risk_
**Outcome:** Docs-only shipping has one policy map for selected tests and attributable work/wait timing.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O3 documentation workflow.
**Done when:** With a usable base policy the nonexecuting pregate explanation owns selected tests and reasons for the exact delta; missing/invalid policy and legacy marker handling are explicit and conservative. Same-tree evidence reuse survives. The reported 211-minute outlier has an evidenced explanation; any unavailable intervals remain open unless the owner explicitly defers that obligation.
_touches: src/docs-ship/pinning.ts, src/docs-ship/cli.ts, src/docs-ship/config.ts, skills/docs-ship.md, docs/docs-ship.md, tests/docs-ship.test.ts, tests/skill-protocols-docs-ship.test.ts_
_blocked-by: Track 31A, Track 29A, Track 39A_
**Scheduling:** Prioritize the main review savings before the separate docs-only path and its long-run investigation; relative call frequency has not been established.
_Source: program E8 / research R8_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Adopt the policy map compatibly** -- Consume exact-delta/base-policy explanation, preserve no-lane and error semantics, and cover policy-backed, policy-less, configured-marker and bump-delta cases without silently losing coverage. _~210 lines._ (M)
- **Account for long docs-only runs** -- Separate active review/test work, host/tool stalls and human waits using E1; retain bounded evidence and unknowns, and attach installed-host qualification to the two existing host Tracks. _~70 lines._ (S)

##### Track 40B: Prove release-only reuse with the upstream tree receipt
_1 tasks . ~210 LOC incl. tests . medium risk_
**Outcome:** A policy-equipped repository gets mechanical stamp-hunk proof before release gate reuse.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O3/O5 release integrity.
**Done when:** The verified base ship policy drives gstack-tree-receipt; eligible per-lane proof and current evidence are required; same-file functional edits, unreadable policy, stale evidence and stamp-sensitive tests cannot reuse improperly. Repositories without policy keep the documented existing path.
_touches: skills/ship-and-land.md, tests/skill-protocols-ship-and-land.test.ts, docs/workflow-handoffs.md, tests/handoff-contract.test.ts, tests/fixtures/handoffs/_
_blocked-by: Track 29A, Track 32B, Track 39A_
**Scheduling:** Land the main review speed improvements before optimizing release-only proof.
_Source: program E7 / research R7_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Integrate mechanical eligibility** -- Record the exact upstream source and helper result, retain required checks and receipt compatibility, and demonstrate valid version-only changes versus invalid hunks without authoring any consumer ship policy. _~210 lines._ (M)

### Group 41: Machine-readable planning artifacts

_Depends on: Group 29, Group 36, Group 40_

**This group delivers:** Validated upstream-compatible decisions and findings artifacts alongside the current lean sidecar.

##### Track 41A: Publish upstream-schema lean planning artifacts
_1 tasks . ~240 LOC incl. tests . medium risk_
**Outcome:** An orchestrator can inspect decisions and findings without parsing the review prose.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O4 compatible artifacts.
**Done when:** decisions.jsonl and findings.jsonl validate with installed upstream schemas, carry auto/approval/user_challenge decisions and attributed findings beside the sidecar, and remain consistent on sealing, retries and phase replacement; existing prompt/handoff consumers are unchanged.
_touches: src/autoplan-lean/sidecar.ts, src/autoplan-lean/cli.ts, src/autoplan-lean/history.ts, skills/autoplan-lean.md, docs/workflow-handoffs.md, tests/autoplan-lean.test.ts, tests/autoplan-lean-history.test.ts, tests/skill-protocols-autoplan-lean.test.ts_
_blocked-by: Track 29A, Track 36B, Track 40B, Track 40A_
**Scheduling:** Land direct test, audit, review and shipping efficiency changes before the planning-artifact producer.
_Source: program E9 / research R10_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Emit and validate machine artifacts** -- Map the current sidecar semantics to upstream schemas; preserve IDs and source provenance and report unknowns; bind records to the sealed plan/review without inventing decisions or adding a parallel format. _~240 lines._ (M)

### Group 42: Supporting contracts and equal host acceptance

_Depends on: Group 29, Group 30, Group 33, Group 34, Group 41_

**This group delivers:** A stable-interface catalog, evidence/recovery design and independent qualification on both hosts.

##### Track 42A: Publish the stable compatibility and recovery catalog
_1 tasks . ~180 LOC incl. tests . medium risk_
**Outcome:** Public users can identify stable interfaces, experimental exclusions and recovery obligations.
**Supports:** [SPEC](SPEC.md) O5.1; preserved required inbox obligation, 2026-10-23
**Done when:** A catalog names every promised surface, version/compatibility rules, support conditions and recovery links; stage-runs v2 is one checked example, not the whole catalog. Experimental surfaces stay explicitly excluded; no checkpoint is awarded by documentation alone.
_touches: docs/compatibility.md (new), docs/SPEC.md, README.md, docs/installation.md_
_blocked-by: Track 28A, Track 41A_
**Scheduling:** The stable-interface catalog remains a 1.0 obligation but does not delay the selected efficiency work.
_Source: [plan-ceo-review] stable compatibility surfaces (O5.1)_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Catalog the promised surfaces** -- Trace CLI/config, skills, handoffs, provenance and install ownership against shipped code and public instructions. Carry the existing stable promises and disclose unknown qualification; retain O5 acceptance as an owner gate. _~180 lines._ (M)

##### Track 42B: Qualify the complete Conductor workflow and cross-session handoffs
_1 task . ~200 LOC incl. tests . medium risk_
**Outcome:** Conductor receives the same supported workflow and recovery guarantees as Paseo.
**Supports:** [SPEC](SPEC.md) O1/O3/O4 — equal priority requires current host evidence in addition to legacy usage.
**Done when:** A named release/profile has fresh install, upgrade/recovery, real plan-to-authorized-release, interrupted resume, manual-testing pause, full-review restart and cross-session handoff evidence; unknown model evidence remains unknown.
_touches: docs/acceptance/conductor.md (new)_
_blocked-by: Track 26A, Track 23I, Track 23A, Track 23G, Track 28A, Track 26B, Track 33A, Track 34A, Track 41A_
**Scheduling:** Retain broad host qualification after the direct efficiency changes and planning artifacts; moving telemetry earlier does not move or waive this acceptance gate.
- **Exercise the supported Conductor profile** -- Run the same outcome matrix as Paseo using actual Conductor workspaces and the supported Codex, Cursor and Claude stage routes. Verify action receipts/final output, preserved work and stable artifact bindings after changing sessions. Include stale/partial/held controls and the SQLite store-reader fix from Track 23G, with its still-open owner gate: T42 native receipt 2 on an installed release and the 2-5 minute row-interpretation check (O4 stays unawarded until the owner confirms), plus the open owner note on receipt 1's expected effort. Include the installed Conductor host-attribution check the user deferred from Track 26A (DFR1). Record versions, operator interventions and sanitized receipts. At least one of the two onboarding attempts must be followed independently of the maintainer; do not claim cross-host or provider support from fixtures alone. _~200 documentation lines._ (L)
**Include installed `/docs-ship` acceptance** -- Run a real docs-only PR on Conductor through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging. Across the two host records include one Sonnet-class run and one `/roadmap` handoff; compare work/wait wall time with a recent docs PR shipped through the ordinary path. Source: `[manual] Qualify /docs-ship on a real docs-only PR on both workspace hosts`, 2026-10-23. This is part of the one host qualification task, not another release authorization.

##### Track 42C: Qualify the complete Paseo workflow and external handoffs
_1 task . ~200 LOC incl. tests . medium risk_
**Outcome:** Paseo users and an external orchestrator can carry real work through the supported stages.
**Supports:** [SPEC](SPEC.md) O1/O3/O4 — workspace guard wording is shipped, but end-to-end host and consumer acceptance is not established.
**Done when:** A named release/profile has fresh install, upgrade/recovery, real plan-to-authorized-release, interrupted resume, manual-testing pause, full-review restart and external-consumer handoff evidence; pending approvals or failures remain holds.
_touches: docs/acceptance/paseo.md (new)_
_blocked-by: Track 26A, Track 23I, Track 23A, Track 28A, Track 26B, Track 33A, Track 34A, Track 41A_
**Scheduling:** Retain broad host qualification after the direct efficiency changes and planning artifacts; moving telemetry earlier does not move or waive this acceptance gate.
- **Exercise the supported Paseo profile** -- Use the actual host-managed worktree and approved accounts with Codex implementation, Cursor review and Claude planning/release where supported. Retain the bound PR and worktree, test stale/partial/held handoffs, confirm next-stage consumption from artifacts, and count operator interventions. Include the installed Paseo host-attribution check the user deferred from Track 26A (DFR1). The real external consumer may stop at a ready PR; a separate authorized human-driven run proves landing. Confirm independent onboarding across the two host qualification Tracks. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. _~200 documentation lines._ (L)
**Include installed `/docs-ship` acceptance** -- Run a real docs-only PR on Paseo through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging. Across the two host records include one Sonnet-class run and one `/roadmap` handoff; compare work/wait wall time with a recent docs PR shipped through the ordinary path. Source: `[manual] Qualify /docs-ship on a real docs-only PR on both workspace hosts`, 2026-10-23. This is part of the one host qualification task, not another release authorization.

##### Track 42D: Specify portable review evidence and capped-review recovery
_2 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** Callers know what proves a completed full review and how a stopped draft can reach shipping.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O4 provenance and O3 stop preservation.
**Done when:** A supporting design maps review facts to a portable evidence-bundle reference and independently checks review-log full-scope/completion/convergence/binding predicates. Documentation walks stopped draft → authorized exact repair-only continuation → prepared readiness → ship with all unavailable evidence and continuation counts preserved, and records the owner's 2026-10-25 decision that `/ship-and-land` keeps refusing a stopped draft, including one whose receipt says `Unresolved: none recorded`; no envelope runtime or stop bypass is introduced.
_touches: docs/designs/review-evidence-envelope.md (new), docs/workflow-handoffs.md_
_blocked-by: Track 29A, Track 41A, Track 30A_
**Scheduling:** Preserve the evidence design and capped-review recovery work after the direct savings and artifact producer; the artifact producer edge is priority ordering, not a claimed technical prerequisite. The capped-review repair edge is technical: the documented recovery path must describe the shipped repair-only continuation. The producer-side record of cycle 1's completed baseline moved to that repair Track; this Track specifies and checks that record and does not write it.
_Source: program E10–E11 / research R11 and observed capped-review stop_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Map the existing upstream proof** -- Compare commit_full/tree/scope/completed/converged/cycles plus review_binding and verified/imported lane semantics; specify missing/stale/unavailable cases and identify gaps without claiming nonconverged full scope is a completed baseline. _~150 lines._ (M)
- **Document the recovery path** -- Use the stop receipt’s own repair-only prompt and remaining budget, which the capped-review repair makes reachable after a completed first cycle, preserve the bound PR, and show why shipping cannot replace the continuation, including for a receipt that says `Unresolved: none recorded`. Keep manual holds and Full-review evidence: unavailable explicit. _~70 lines._ (S)

### Group 43: Workflow efficiency decisions

_Depends on: Group 32, Group 35, Group 42_

**This group delivers:** A reproducible report that supports adoption, rejection or insufficient evidence for each optimization.

##### Track 43A: Evaluate workflow efficiency and recommend only supported changes
_3 tasks . ~440 LOC incl. tests . medium risk_
**Outcome:** The maintainer gets an evidence-backed decision for each proposed optimization, including a valid conclusion that a change is not worthwhile or that evidence is insufficient.
**Supports:** [SPEC](SPEC.md) P1 and owner-selected investigation, 2026-10-19; empirical model comparison and review-policy changes remain outside the 1.0 acceptance gates.
**Done when:** A reproducible report separates model work, tools/CI/human waits, reuse and rework; each candidate has measured evidence or a named evidence gap; comparisons include total parent/child usage, quality and capture overhead; no model downgrade or review gate is changed by the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new)_
_blocked-by: Track 35A, Track 32A, Track 42A, Track 42D, Track 42B, Track 42C_
**Scheduling:** Keep the cross-run efficiency assessment after the selected changes and host-qualification work; individual changes still need their own before/after evidence before activation.
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
- **Build a comparable baseline** -- Produce an offline report from sanitized projections. Separate DOCS/FULL/release-only paths, diff/task size, repo/host, skill version, waits and fresh versus resumed runs; report sample size and missingness. Reuse eligible existing release-only receipts and preserve the separate first-installed-no-CI timing obligation and 15-minute target. Report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~180 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs. Investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Use the existing eval/benchmark facilities where suitable; define corpus, quality bars, fixed budgets and stop rules before any model trial. Include known-defect controls and false positives; a saved success flag is not quality evidence. This Track authorizes offline analysis; any new paid/API trials need a separately approved concrete pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- For each candidate give adopt/reject/insufficient-evidence, expected benefit, observed limitations and the smallest follow-up scope. Map recommendations to existing Future items rather than duplicating them: lifecycle helper, eval persistence, vendor diversity, the delta-scoped review default, on-demand `/review-and-prep` section loading and the `/autoplan-lean` measurement. Preserve the independent historical review-independence study and its unfulfilled evidence obligations. An insufficient-evidence result names missing data and a bounded next measurement; it never silently removes a review or acceptance gate. _~80 lines._ (S)

### Execution Map

A Group may launch when every Group in its dependency set has landed;
document order is not an additional gate. The cards label priority choices
separately from technical prerequisites. Adjacency below is the packer's
DEPENDS output with bin numbers replaced by the assigned Group numbers.

```
- Group 29 ← {}
- Group 30 ← {29}
- Group 31 ← {30}
- Group 32 ← {29, 31}
- Group 33 ← {31, 32}
- Group 34 ← {33}
- Group 35 ← {31, 33, 34}
- Group 36 ← {31, 32, 35}
- Group 37 ← {29, 31, 36}
- Group 38 ← {29, 31, 36, 37}
- Group 39 ← {29, 31, 36, 37, 38}
- Group 40 ← {29, 31, 32, 39}
- Group 41 ← {29, 36, 40}
- Group 42 ← {29, 30, 33, 34, 41}
- Group 43 ← {32, 35, 42}
```

**15 Groups / 21 Tracks remaining: 6 retained Tracks, 12 efficiency-program Tracks and 3 added on 2026-10-25.** Group 29 is declared In Progress; the other 14 Groups are in the Current Plan.

The published-upgrade obligation is externally blocked, not waived. Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.

## Future

Deferred: docs/roadmap-future.md (58 items)

## Shipped

History: docs/roadmap-shipped.md
