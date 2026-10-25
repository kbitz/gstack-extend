# Roadmap

Organized by lifecycle state: **In Progress**, **Current Plan**, **Future** and
**Shipped**. A Track is one PR/session. Explicit scheduling edges prioritize
efficiency and speed, with telemetry immediately after test savings; the packer
then assigns Groups of disjoint file footprints and their launch dependencies.

Target: [SPEC](SPEC.md) O1–O5, public-release 1.0.0, potentially-public users.
Paseo and Conductor retain equal priority. The owner-selected
[efficiency program](designs/workflow-efficiency-program.md), SPEC P1, is additional
work and does not gate 1.0. Implementation, installed/operator evidence and
owner acceptance remain distinct. No new spend or unattended merge is authorized.

## In Progress

None declared. Track 28A's candidate-only transition is recorded independently
in shipped history; its required published-release upgrade remains in Future
until the first three-part release exists. O1 and O3–O5 remain pending.

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26, 28_

### Group 29: Truthful timing and upstream drift checks

_Depends on: none_

**This group delivers:** Trustworthy work/wait attribution and launch-time upstream compatibility checks.

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

##### Track 29B: Record truthful timing and isolate synthetic metrics
_2 tasks . ~400 LOC incl. tests . medium risk_
**Outcome:** Operators can attribute stage work and waits without fixture rows contaminating real observations.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O4.3 provenance.
**Done when:** Events are stamped at the actual boundary; completion, pregate, tests, coverage, documentation and Greptile have spans; the fixture-shaped real-store writer is traced and its pollution path stopped, and isolated checks prove synthetic runs do not touch real analytics. An unresolved writer keeps this obligation open. Historical rows remain intact.
_touches: bin/lib/workflow_metrics.py, skills/review-and-prep.md, skills/ship-and-land.md, skills/autoplan-lean.md, skills/implement.md, skills/docs-ship.md, docs/telemetry.md, docs/workflow-metrics.schema.json, tests/workflow-metrics.test.ts, tests/telemetry-contract.test.ts, tests/helpers/telemetry-env.ts_
_Source: program E1 / research R3_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Capture boundaries as they happen** -- Add begin/end work and wait records at the owning skill boundaries with truthful interrupted/unknown handling; keep existing schema consumers and optional telemetry behavior compatible. _~240 lines._ (M)
- **Trace and fence synthetic writes** -- Find the producer of the observed fixture-shaped rows; qualify all test and shell-example entry points with isolated state and before/after real-store integrity checks. Do not claim current fixtures are at fault from UUID shape alone. _~160 lines._ (M)

### Group 30: Reduce repeated and overbroad test work

_Depends on: Group 29_

**This group delivers:** An opt-in full-suite policy and narrower skill-only test selection with required coverage preserved.

##### Track 30A: Narrow the remaining broad skill-test readers
_1 tasks . ~260 LOC incl. tests . medium risk_
**Outcome:** A skill prose edit runs the content rules it reaches without paying for unrelated installer mechanics.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; observed broad-suite cost from 2026-10-23
**Done when:** Measured skill-only selection removes unnecessary broad mechanics while every real-skill content rule still runs for its consumers, dependency-map parity and conservative full-suite fallback hold, and before/after test time and coverage are recorded.
_touches: tests/telemetry.test.ts, tests/setup-hosts.test.ts, tests/helpers/telemetry-env.ts, tests/helpers/touchfiles.ts, tests/touchfiles.test.ts, tests/skill-content.test.ts (new), .gstack/pregate.json_
_blocked-by: Track 29B, Track 29A_
**Scheduling:** Reduce recurring skill-test cost in the first savings batch, alongside the full-suite policy; requested-model provenance is not a technical prerequisite.
_Source: [manual] narrow the two broad skills suites_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Separate real-skill readers from fixture mechanics** -- Use existing cross-skill invariants to keep all content dependencies explicit, retain installer/telemetry behavior coverage, and sync the pregate dependency map. Measure a representative skill-only edit without weakening unknown-change fallback. _~260 lines._ (M)

##### Track 30B: Run the full suite before the documentation audit by policy
_2 tasks . ~330 LOC incl. tests . medium risk_
**Outcome:** An opted-in caller avoids a second full suite after documentation-audit-only edits.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O3 verification and O4 receipts.
**Done when:** before-audit is an explicit cross-stage policy value; the full-run tree and audit-owned delta are recorded; only that delta can select final pregate lanes, all other or unknown changes require a full rerun; receipts state which ran. final and omitted-policy behavior are unchanged.
_touches: skills/review-and-prep.md, skills/ship-and-land.md, docs/workflow-handoffs.md, tests/skill-protocols-review-and-prep.test.ts, tests/skill-protocols-ship-and-land.test.ts, tests/handoff-contract.test.ts, tests/fixtures/handoffs/_
_blocked-by: Track 29B_
_Source: program E3; owner-approved policy option_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Carry policy and evidence through all stages** -- Define parsing, continuation propagation and prepared/ship receipt semantics; bind the full suite to its reviewed tree and audit output; include release edits in the conservative rerun rule. _~190 lines._ (M)
- **Verify reuse and invalidation** -- Test docs-only audit delta, no changes, non-doc fixes, changed policy/base, missing evidence and stale trees; measure savings using E1 spans without changing public defaults. _~140 lines._ (M)

### Group 31: Paused and resumed telemetry

_Depends on: Group 29, Group 30_

**This group delivers:** Truthful blocked/completed segments with stable run identity across resumes.

##### Track 31A: Record paused, blocked and resumed runs
_2 tasks . ~300 LOC incl. tests . medium risk_
**Outcome:** An external caller can tell a run that stopped for a person from one that never ran, and a run resumed in another checkout still records its completion.
**Supports:** [SPEC](SPEC.md) O4 criteria 2–3 and O3 — blocked work must be explicit and starts and finishes must keep their run identity; today a deliberate pause defers finish, and a resume in a new worktree finds no handoff in its root and writes nothing.
**Done when:** A deliberate pause in `/review-and-prep`, `/pair-review` or `/full-review` writes one row with outcome `blocked`; a resumed run that completes writes its own row, including from a different checkout root; each start pairs with exactly one finish; every installed skill copy carries the same updated start/finish wording; the join contract describes how segments link, and v1, v2 and legacy rows stay readable.
_touches: bin/lib/telemetry.py, docs/telemetry.md, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, tests/skill-protocols.test.ts, skills/autoplan-lean.md, skills/docs-ship.md, skills/full-review.md, skills/gstack-extend-init.md, skills/gstack-extend-upgrade.md, skills/implement.md, skills/pair-review.md, skills/project-spec.md, skills/review-and-prep.md, skills/roadmap.md, skills/ship-and-land.md_
_blocked-by: Track 23H, Track 23I, Track 26A, Track 29B, Track 30B, Track 30A_
**Scheduling:** Owner-selected order: telemetry follows test savings immediately. Complete paused/resumed segments before their dependent requested-model and usage work.
_read-first: 23H, 23I, 26A, docs/telemetry.md_
- **Close each paused segment with a blocked row** -- Replace "A deliberate pause defers finish" at the pause points of the three resumable skills with a finish that records `blocked`, the outcome stage-runs schema v2 has reserved since 0.37.0.0. Update the shared start/finish wording in all eleven skill copies, including `skills/autoplan-lean.md` (added in 0.40.0.0), and the `RESUMABLE` adoption rule with it. While editing, re-anchor two stale Track references to their current owners in words rather than IDs: `skills/pair-review.md` ("Track 24B owns the future canonical hold/resume detector", written when 24B was the stage-handoff contract Track, since shipped as 23I) and `docs/telemetry.md` (2026-10-25 source text: "receipt 2 or Track 27A evidence", which means the Conductor host qualification). Evidence (2026-10-16): no review-and-prep row for five of seven recent orchestrated PRs, and 5 review-and-prep handoffs among 24 leftover starts. Source: `[manual] Give paused and blocked /review-and-prep runs a stage-runs row`. _~180 lines._ (M)
- **Record a resumed completion in any checkout** -- A resume starts its own segment, linked to the paused one by an identifier settled at planning (run identity or the launcher's work item), so a resume in a new worktree records its completion; use the status words of the stage-handoff contract. Align step/pass boundaries with the companion ledger from Track 24A; interrupted or unobserved intervals stay unknown. Settle at planning how this relates to the Future cards "Recover a telemetry finish run from a different repository root" and "In-flight marker and crash detection for extend telemetry". _~120 lines._ (M)

### Group 32: Requested-model provenance

_Depends on: Group 31_

**This group delivers:** Requested model values recorded separately from observed and billed values.

##### Track 32A: Record a caller-requested model where detection finds none
_1 task . ~120 LOC incl. tests . low risk_
**Outcome:** A launcher can record the model and effort it requested for a stage whose harness log names none, and readers can tell that value from an observed one.
**Supports:** [SPEC](SPEC.md) O4 criterion 3 — requested-versus-observed model evidence must be distinguishable; every local `cursor-agent` row (29 ship-and-land rows, releases 0.34.2.0 to 0.36.8.0) has model null with source unknown.
**Done when:** `GSTACK_EXTEND_MODEL` and `GSTACK_EXTEND_EFFORT` fill only a null detected value and carry the requested source label, never `detected`; detection and finish flags still win; a `cursor-agent` fixture covers the route; `docs/telemetry.md` documents both variables.
_touches: bin/lib/telemetry.py, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, docs/telemetry.md, docs/stage-runs.schema.json_
_blocked-by: Track 26A, Track 31A_
**Scheduling:** This is the second telemetry step after test savings; preserve the paused-segment prerequisite.
_read-first: 26A, docs/telemetry.md_
- **Record the caller's requested model and effort** -- Stage-runs schema v2 (0.37.0.0) already reserves the `requested` source for non-null model and effort; this Track is its first producer. On Cursor's CLI route (`CURSOR_INVOKED_AS` set) `_observe_cursor_store()` skips the store and `cursor_turns()` returns only a transcript mtime. A local check on 2026-10-16 found no model in `cursor-agent` transcripts or chat-store metadata, and `~/.cursor/cli-config.json` holds only a configured default, which provenance must not record. Check whether `cursor-agent --output-format json` events name the model before relying on the environment alone. Source: `[manual] Accept a caller-supplied model when detection finds none, labeled as requested`. _~120 lines._ (S)

### Group 33: Workflow and reviewer usage telemetry

_Depends on: Group 29, Group 31, Group 32_

**This group delivers:** Attributable parent/child usage from local logs with explicit uncertainty.

##### Track 33A: Attribute workflow and reviewer usage from local session logs
_3 tasks . ~600 LOC incl. tests . medium risk_
**Outcome:** The maintainer can compare total parent-and-child token usage by workflow, step and recorded model, with explicit uncertainty where a source cannot support attribution.
**Supports:** [SPEC](SPEC.md) P1 and owner-selected usage capture, 2026-10-19; promotes the two retained run-usage and outside-voice Future commitments without enabling quota routing or vendor usage API calls.
**Done when:** A local report combines step/pass events with disjoint token classes and available plan-window observations, distinguishes direct evidence from time/directory correlation, and excludes ambiguous or overlapping usage from exact totals; fixtures cover streaming copies, cumulative counter resets, nested children and concurrent sessions; unknown values remain null with reasons.
_touches: bin/lib/telemetry.py, bin/lib/workflow_metrics.py, bin/lib/quota/usage.py, docs/workflow-metrics.schema.json, docs/telemetry.md, docs/stage-runs.schema.json, tests/workflow-metrics.test.ts, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, tests/quota.test.ts, tests/fixtures/quota/, tests/helpers/touchfiles.ts_
_blocked-by: Track 24A, Track 26A, Track 31A, Track 32A, Track 29B_
**Scheduling:** Complete parent/child usage attribution as the third telemetry step, before bounded audits and review overlap.
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
_produces: comparable per-run and per-voice local usage projections, source/attribution grades and a replayable sanitized fixture corpus_
- **Reuse the local log parser for run usage** -- Absorb "Record each run's token usage and plan-window readings from the harness's own logs". Reuse or isolate the existing quota usage parser rather than introduce a third parser. Record uncached input, cache read/write and output; reasoning is a subset, never added twice. Retain logged start/end rate-limit readings with reset and concurrency caveats; account-wide percentage changes are not attributable stage consumption. Cursor/Grok sources remain unknown until verified. Read only session logs and CLI output: no credentials, identity/capacity readers or vendor usage services. _~240 lines._ (M)
- **Attribute child and outside-reviewer usage** -- Absorb "Record outside-voice calls' vendor, model, tokens and window readings". Join each recorded call to its invocation and pass using direct parent/session evidence when available, including the local `voices.jsonl` reviewer join (host subagent identifier, parent-observed dispatch/return times) that 0.38.0.0 added; mark directory/time matches as correlation and ambiguous shared-worktree matches as unknown. Deduplicate native subagents and cross-harness children, account for children that outlive the step, and preserve every contributing model/source. Do not modify upstream commands or claim observed/billed models from requested labels. _~240 lines._ (M)
- **Preserve schema and parser compatibility** -- Use the step ledger for detailed usage and retain immutable legacy/v1/v2 stage rows. Coordinate any stage-row reference fields with the stage-runs v2 schema shipped in 0.37.0.0; never add fields silently to a published closed schema. Preserve saved retry bytes and paused-segment linkage, publish only sanitized projections, and prove capture makes no credential or network calls. When editing `bin/lib/workflow_metrics.py`, weigh the Future item "Slim the workflow-metrics helper without dropping requirements"; adopting it is optional. _~120 lines._ (S)

### Group 34: Bound audit effort and complete handoffs

_Depends on: Group 29, Group 30, Group 33_

**This group delivers:** Fewer irrelevant documentation reads and complete implementation handoffs after owned tests finish.

##### Track 34A: Bound documentation audits by changed contracts
_1 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** Reviews read the documentation relevant to their changed contracts and retain real drift detection.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25
**Done when:** The scope includes changed-path and contract references, linked authorities and safe broad fallback when relevance is uncertain; the one re-audit follows only the fix delta. Before/after time, read volume and retained finding quality are recorded before any default activation.
_touches: skills/review-and-prep.md, skills/ship-and-land.md, tests/skill-protocols-review-and-prep.test.ts, tests/skill-protocols-ship-and-land.test.ts, docs/acceptance/documentation-audit-efficiency.md (new)_
_blocked-by: Track 29B, Track 30B, Track 33A_
**Scheduling:** Owner-selected order places telemetry immediately after test savings, then bounded documentation audits; this added edge is a priority choice.
_Source: program E4 / research R4_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Constrain discovery and re-audit inputs** -- Keep current/updated/blocked truthful and the existing attempt bound; compare the bounded audit against representative known documentation drift. If public-quality evidence is insufficient, expose an explicit option and retain the default. _~220 lines._ (M)

##### Track 34B: Make implement handoffs explicit and await owned tests
_1 tasks . ~120 LOC incl. tests . medium risk_
**Outcome:** External callers receive complete handoffs with machine-readable counts after tests finish.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O3.1 and O4.1–2.
**Done when:** Every successful handoff prints DEFERRED BY USER <n>, BLOCKED <n>, zeros included; BLOCKED still refuses a handoff. A long owned test is followed inside the active turn through its terminal result, with progress updates and no partial success prompt.
_touches: skills/implement.md, docs/workflow-handoffs.md, tests/skill-protocols-implement.test.ts, tests/handoff-contract.test.ts, tests/fixtures/handoffs/_
_blocked-by: Track 29B, Track 30B, Track 33A_
**Scheduling:** Run after the telemetry block, alongside the disjoint bounded-audit work; the added edge implements the selected order.
_Source: program E6; observed missing-count and no-handoff incidents_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Pin the counts and waiting contract** -- Update the producer template and compatibility fixtures; cover zero/nonzero deferred rows and blocked refusal, and give the long-running-test lifecycle explicitly. _~120 lines._ (S)

### Group 35: Shorten the first review cycle

_Depends on: Group 29, Group 34_

**This group delivers:** Measured overlap of independent first-cycle review work without losing finding quality.

##### Track 35A: Overlap independent first-cycle review work
_1 tasks . ~230 LOC incl. tests . medium risk_
**Outcome:** A full first review cycle can finish sooner without losing independent coverage.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25
**Done when:** E1 establishes a baseline; one immutable scope feeds concurrent specialists, native adversarial and outside pair, with the pair internally sequential and Red Team after merged findings. Host-cap fallback and incomplete voices preserve holds. Before/after wall time and finding quality support activation.
_touches: skills/review-and-prep.md, tests/skill-protocols-review-and-prep.test.ts, tests/workflow-metrics.test.ts, docs/acceptance/review-concurrency.md (new)_
_blocked-by: Track 29B, Track 29A, Track 34A_
_Source: program E5 / research R2_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Overlap only verified-independent inputs** -- Recheck upstream dependencies; preserve no-fix-before-collection, deduplication, cycle cap, stop and outside-call policy; qualify both hosts and retain the old default behind an option until public activation evidence exists. _~230 lines._ (M)

### Group 36: Efficient docs-only and release-only paths

_Depends on: Group 29, Group 30, Group 35_

**This group delivers:** A shared docs-only test map, an explained elapsed-time outlier and mechanical release-stamp proof.

##### Track 36A: Use pregate to select docs-only tests and explain long runs
_2 tasks . ~280 LOC incl. tests . medium risk_
**Outcome:** Docs-only shipping has one policy map for selected tests and attributable work/wait timing.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O3 documentation workflow.
**Done when:** With a usable base policy the nonexecuting pregate explanation owns selected tests and reasons for the exact delta; missing/invalid policy and legacy marker handling are explicit and conservative. Same-tree evidence reuse survives. The reported 211-minute outlier has an evidenced explanation; any unavailable intervals remain open unless the owner explicitly defers that obligation.
_touches: src/docs-ship/pinning.ts, src/docs-ship/cli.ts, src/docs-ship/config.ts, skills/docs-ship.md, docs/docs-ship.md, tests/docs-ship.test.ts, tests/skill-protocols-docs-ship.test.ts_
_blocked-by: Track 29B, Track 29A, Track 35A_
**Scheduling:** Prioritize the main review savings before the separate docs-only path and its long-run investigation; relative call frequency has not been established.
_Source: program E8 / research R8_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Adopt the policy map compatibly** -- Consume exact-delta/base-policy explanation, preserve no-lane and error semantics, and cover policy-backed, policy-less, configured-marker and bump-delta cases without silently losing coverage. _~210 lines._ (M)
- **Account for long docs-only runs** -- Separate active review/test work, host/tool stalls and human waits using E1; retain bounded evidence and unknowns, and attach installed-host qualification to the two existing host Tracks. _~70 lines._ (S)

##### Track 36B: Prove release-only reuse with the upstream tree receipt
_1 tasks . ~210 LOC incl. tests . medium risk_
**Outcome:** A policy-equipped repository gets mechanical stamp-hunk proof before release gate reuse.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O3/O5 release integrity.
**Done when:** The verified base ship policy drives gstack-tree-receipt; eligible per-lane proof and current evidence are required; same-file functional edits, unreadable policy, stale evidence and stamp-sensitive tests cannot reuse improperly. Repositories without policy keep the documented existing path.
_touches: skills/ship-and-land.md, tests/skill-protocols-ship-and-land.test.ts, docs/workflow-handoffs.md, tests/handoff-contract.test.ts, tests/fixtures/handoffs/_
_blocked-by: Track 29A, Track 30B, Track 35A_
**Scheduling:** Land the main review speed improvements before optimizing release-only proof.
_Source: program E7 / research R7_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Integrate mechanical eligibility** -- Record the exact upstream source and helper result, retain required checks and receipt compatibility, and demonstrate valid version-only changes versus invalid hunks without authoring any consumer ship policy. _~210 lines._ (M)

### Group 37: Machine-readable planning artifacts

_Depends on: Group 29, Group 34, Group 36_

**This group delivers:** Validated upstream-compatible decisions and findings artifacts alongside the current lean sidecar.

##### Track 37A: Publish upstream-schema lean planning artifacts
_1 tasks . ~240 LOC incl. tests . medium risk_
**Outcome:** An orchestrator can inspect decisions and findings without parsing the review prose.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O4 compatible artifacts.
**Done when:** decisions.jsonl and findings.jsonl validate with installed upstream schemas, carry auto/approval/user_challenge decisions and attributed findings beside the sidecar, and remain consistent on sealing, retries and phase replacement; existing prompt/handoff consumers are unchanged.
_touches: src/autoplan-lean/sidecar.ts, src/autoplan-lean/cli.ts, src/autoplan-lean/history.ts, skills/autoplan-lean.md, docs/workflow-handoffs.md, tests/autoplan-lean.test.ts, tests/autoplan-lean-history.test.ts, tests/skill-protocols-autoplan-lean.test.ts_
_blocked-by: Track 29A, Track 34B, Track 36B, Track 36A_
**Scheduling:** Land direct test, audit, review and shipping efficiency changes before the planning-artifact producer.
_Source: program E9 / research R10_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Emit and validate machine artifacts** -- Map the current sidecar semantics to upstream schemas; preserve IDs and source provenance and report unknowns; bind records to the sealed plan/review without inventing decisions or adding a parallel format. _~240 lines._ (M)

### Group 38: Supporting contracts and equal host acceptance

_Depends on: Group 29, Group 31, Group 32, Group 37_

**This group delivers:** A stable-interface catalog, evidence/recovery design and independent qualification on both hosts.

##### Track 38A: Publish the stable compatibility and recovery catalog
_1 tasks . ~180 LOC incl. tests . medium risk_
**Outcome:** Public users can identify stable interfaces, experimental exclusions and recovery obligations.
**Supports:** [SPEC](SPEC.md) O5.1; preserved required inbox obligation, 2026-10-23
**Done when:** A catalog names every promised surface, version/compatibility rules, support conditions and recovery links; stage-runs v2 is one checked example, not the whole catalog. Experimental surfaces stay explicitly excluded; no checkpoint is awarded by documentation alone.
_touches: docs/compatibility.md (new), docs/SPEC.md, README.md, docs/installation.md_
_blocked-by: Track 28A, Track 37A_
**Scheduling:** The stable-interface catalog remains a 1.0 obligation but does not delay the selected efficiency work.
_Source: [plan-ceo-review] stable compatibility surfaces (O5.1)_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Catalog the promised surfaces** -- Trace CLI/config, skills, handoffs, provenance and install ownership against shipped code and public instructions. Carry the existing stable promises and disclose unknown qualification; retain O5 acceptance as an owner gate. _~180 lines._ (M)

##### Track 38B: Qualify the complete Conductor workflow and cross-session handoffs
_1 task . ~200 LOC incl. tests . medium risk_
**Outcome:** Conductor receives the same supported workflow and recovery guarantees as Paseo.
**Supports:** [SPEC](SPEC.md) O1/O3/O4 — equal priority requires current host evidence in addition to legacy usage.
**Done when:** A named release/profile has fresh install, upgrade/recovery, real plan-to-authorized-release, interrupted resume, manual-testing pause, full-review restart and cross-session handoff evidence; unknown model evidence remains unknown.
_touches: docs/acceptance/conductor.md (new)_
_blocked-by: Track 26A, Track 23I, Track 23A, Track 23G, Track 28A, Track 26B, Track 31A, Track 32A, Track 37A_
**Scheduling:** Retain broad host qualification after the direct efficiency changes and planning artifacts; moving telemetry earlier does not move or waive this acceptance gate.
- **Exercise the supported Conductor profile** -- Run the same outcome matrix as Paseo using actual Conductor workspaces and the supported Codex, Cursor and Claude stage routes. Verify action receipts/final output, preserved work and stable artifact bindings after changing sessions. Include stale/partial/held controls and the SQLite store-reader fix from Track 23G, with its still-open owner gate: T42 native receipt 2 on an installed release and the 2-5 minute row-interpretation check (O4 stays unawarded until the owner confirms), plus the open owner note on receipt 1's expected effort. Include the installed Conductor host-attribution check the user deferred from Track 26A (DFR1). Record versions, operator interventions and sanitized receipts. At least one of the two onboarding attempts must be followed independently of the maintainer; do not claim cross-host or provider support from fixtures alone. _~200 documentation lines._ (L)
**Include installed `/docs-ship` acceptance** -- Run a real docs-only PR on Conductor through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging. Across the two host records include one Sonnet-class run and one `/roadmap` handoff; compare work/wait wall time with a recent docs PR shipped through the ordinary path. Source: `[manual] Qualify /docs-ship on a real docs-only PR on both workspace hosts`, 2026-10-23. This is part of the one host qualification task, not another release authorization.

##### Track 38C: Qualify the complete Paseo workflow and external handoffs
_1 task . ~200 LOC incl. tests . medium risk_
**Outcome:** Paseo users and an external orchestrator can carry real work through the supported stages.
**Supports:** [SPEC](SPEC.md) O1/O3/O4 — workspace guard wording is shipped, but end-to-end host and consumer acceptance is not established.
**Done when:** A named release/profile has fresh install, upgrade/recovery, real plan-to-authorized-release, interrupted resume, manual-testing pause, full-review restart and external-consumer handoff evidence; pending approvals or failures remain holds.
_touches: docs/acceptance/paseo.md (new)_
_blocked-by: Track 26A, Track 23I, Track 23A, Track 28A, Track 26B, Track 31A, Track 32A, Track 37A_
**Scheduling:** Retain broad host qualification after the direct efficiency changes and planning artifacts; moving telemetry earlier does not move or waive this acceptance gate.
- **Exercise the supported Paseo profile** -- Use the actual host-managed worktree and approved accounts with Codex implementation, Cursor review and Claude planning/release where supported. Retain the bound PR and worktree, test stale/partial/held handoffs, confirm next-stage consumption from artifacts, and count operator interventions. Include the installed Paseo host-attribution check the user deferred from Track 26A (DFR1). The real external consumer may stop at a ready PR; a separate authorized human-driven run proves landing. Confirm independent onboarding across the two host qualification Tracks. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. _~200 documentation lines._ (L)
**Include installed `/docs-ship` acceptance** -- Run a real docs-only PR on Paseo through classification, a no-write classification hand-back, selected tests once, same-tree test-record reuse, final receipt hash, policy bump and `docs-ship/v1` without merging. Across the two host records include one Sonnet-class run and one `/roadmap` handoff; compare work/wait wall time with a recent docs PR shipped through the ordinary path. Source: `[manual] Qualify /docs-ship on a real docs-only PR on both workspace hosts`, 2026-10-23. This is part of the one host qualification task, not another release authorization.

##### Track 38D: Specify portable review evidence and capped-review recovery
_2 tasks . ~220 LOC incl. tests . medium risk_
**Outcome:** Callers know what proves a completed full review and how a stopped draft can reach shipping.
**Supports:** [SPEC](SPEC.md) P1, selected efficiency program 2026-10-25; O4 provenance and O3 stop preservation.
**Done when:** A supporting design maps review facts to a portable evidence-bundle reference and independently checks review-log full-scope/completion/convergence/binding predicates. Documentation walks stopped draft → authorized exact continuation → prepared readiness → ship with all unavailable evidence and continuation counts preserved; no envelope runtime or stop bypass is introduced.
_touches: docs/designs/review-evidence-envelope.md (new), docs/workflow-handoffs.md_
_blocked-by: Track 29A, Track 37A_
**Scheduling:** Preserve the evidence design and capped-review recovery work after the direct savings and artifact producer; this is priority ordering, not a claimed technical prerequisite.
_Source: program E10–E11 / research R11 and observed capped-review stop_
_read-first: docs/designs/workflow-efficiency-program.md_
- **Map the existing upstream proof** -- Compare commit_full/tree/scope/completed/converged/cycles plus review_binding and verified/imported lane semantics; specify missing/stale/unavailable cases and identify gaps without claiming nonconverged full scope is a completed baseline. _~150 lines._ (M)
- **Document the recovery path** -- Use the stop receipt’s own repair-only prompt and remaining budget, preserve the bound PR, and show why shipping cannot replace the continuation. Keep manual holds and Full-review evidence: unavailable explicit. _~70 lines._ (S)

### Group 39: Workflow efficiency decisions

_Depends on: Group 30, Group 33, Group 38_

**This group delivers:** A reproducible report that supports adoption, rejection or insufficient evidence for each optimization.

##### Track 39A: Evaluate workflow efficiency and recommend only supported changes
_3 tasks . ~440 LOC incl. tests . medium risk_
**Outcome:** The maintainer gets an evidence-backed decision for each proposed optimization, including a valid conclusion that a change is not worthwhile or that evidence is insufficient.
**Supports:** [SPEC](SPEC.md) P1 and owner-selected investigation, 2026-10-19; empirical model comparison and review-policy changes remain outside the 1.0 acceptance gates.
**Done when:** A reproducible report separates model work, tools/CI/human waits, reuse and rework; each candidate has measured evidence or a named evidence gap; comparisons include total parent/child usage, quality and capture overhead; no model downgrade or review gate is changed by the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new)_
_blocked-by: Track 33A, Track 30A, Track 38A, Track 38D, Track 38B, Track 38C_
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
- Group 31 ← {29, 30}
- Group 32 ← {31}
- Group 33 ← {29, 31, 32}
- Group 34 ← {29, 30, 33}
- Group 35 ← {29, 34}
- Group 36 ← {29, 30, 35}
- Group 37 ← {29, 34, 36}
- Group 38 ← {29, 31, 32, 37}
- Group 39 ← {30, 33, 38}
```

**11 Groups / 18 Tracks remaining: 6 retained Tracks and 12 new Tracks.**

The published-upgrade obligation is externally blocked, not waived. Only owner-confirmed acceptance in PROGRESS can satisfy a stage/checkpoint.

## Future

Deferred: docs/roadmap-future.md (58 items)

## Shipped

History: docs/roadmap-shipped.md
