# Roadmap

Organized by lifecycle state: **In Progress** (active Tracks), **Current
Plan** (next-up work), **Future** (`docs/roadmap-future.md`), **Shipped**
(`docs/roadmap-shipped.md`). A Track is one PR; Groups are equivalence
classes of "can run in parallel" — Tracks within a Group must have
set-disjoint `_touches:_` footprints. Execution order follows the
adjacency list in the Execution Map under Current Plan.

Target: [SPEC](SPEC.md) O1–O5, public-release 1.0.0. Paseo and Conductor
have equal priority. Code completion and installed/operator acceptance remain
separate gates. The owner approved this plan on 2026-10-08 and its
regeneration on 2026-10-16. The 2026-10-19 amendment schedules
workflow measurement and an efficiency investigation alongside that target;
it does not add them to the 1.0 acceptance gates.


---

## In Progress

No active Track is declared. Merged Tracks 24A, 25A, 26A and 26B are recorded in
`docs/roadmap-shipped.md`. Installed host acceptance and the release transition
that the user deferred from 26A stay with Tracks 28A, 30B and 30C.

---

## Current Plan

_tombstone: 17, 19, 20, 22, 23, 24, 25, 26_

### Group 27: Paused and resumed workflow segments

_Depends on: none_

**This group delivers:** Linked, truthful provenance for deliberate holds and later completions across checkouts.

##### Track 27A: Record paused, blocked and resumed runs
_2 tasks . ~300 LOC incl. tests . medium risk_
**Outcome:** An external caller can tell a run that stopped for a person from one that never ran, and a run resumed in another checkout still records its completion.
**Supports:** [SPEC](SPEC.md) O4 criteria 2–3 and O3 — blocked work must be explicit and starts and finishes must keep their run identity; today a deliberate pause defers finish, and a resume in a new worktree finds no handoff in its root and writes nothing.
**Done when:** A deliberate pause in `/review-and-prep`, `/pair-review` or `/full-review` writes one row with outcome `blocked`; a resumed run that completes writes its own row, including from a different checkout root; each start pairs with exactly one finish; every installed skill copy carries the same updated start/finish wording; the join contract describes how segments link, and v1, v2 and legacy rows stay readable.
_touches: bin/lib/telemetry.py, docs/telemetry.md, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, tests/skill-protocols.test.ts, skills/autoplan-lean.md, skills/docs-ship.md, skills/full-review.md, skills/gstack-extend-init.md, skills/gstack-extend-upgrade.md, skills/implement.md, skills/pair-review.md, skills/project-spec.md, skills/review-and-prep.md, skills/roadmap.md, skills/ship-and-land.md_
_blocked-by: Track 23H, Track 23I, Track 26A_
_read-first: 23H, 23I, 26A, docs/telemetry.md_
- **Close each paused segment with a blocked row** -- Replace "A deliberate pause defers finish" at the pause points of the three resumable skills with a finish that records `blocked`, the outcome stage-runs schema v2 has reserved since 0.37.0.0. Update the shared start/finish wording in all eleven skill copies, including `skills/autoplan-lean.md` (added in 0.40.0.0), and the `RESUMABLE` adoption rule with it. While editing, re-anchor two stale Track references to their current owners in words rather than IDs: `skills/pair-review.md` ("Track 24B owns the future canonical hold/resume detector", written when 24B was the stage-handoff contract Track, since shipped as 23I) and `docs/telemetry.md` ("receipt 2 or Track 27A evidence", which means the Conductor host qualification). Evidence (2026-10-16): no review-and-prep row for five of seven recent orchestrated PRs, and 5 review-and-prep handoffs among 24 leftover starts. Source: `[manual] Give paused and blocked /review-and-prep runs a stage-runs row`. _~180 lines._ (M)
- **Record a resumed completion in any checkout** -- A resume starts its own segment, linked to the paused one by an identifier settled at planning (run identity or the launcher's work item), so a resume in a new worktree records its completion; use the status words of the stage-handoff contract. Align step/pass boundaries with the companion ledger from Track 24A; interrupted or unobserved intervals stay unknown. Settle at planning how this relates to the Future cards "Recover a telemetry finish run from a different repository root" and "In-flight marker and crash detection for extend telemetry". _~120 lines._ (M)

### Group 28: Stable release compatibility

_Depends on: Group 27_

**This group delivers:** A verified legacy-to-three-part upgrade/release path and matching public compatibility guidance.

##### Track 28A: Verify the three-part release and upgrade transition
_1 task . ~180 LOC incl. tests . medium risk_
**Outcome:** Maintainers can publish and users can install stable SemVer releases through the existing release path.
**Supports:** [SPEC](SPEC.md) O1/O5 — the four-part instruction and tooling assumptions need an explicit verified transition.
**Done when:** Upgrading a named legacy install to a three-part candidate passes comparison, migration, audit and tag checks; the stage-runs v2 reader contract is confirmed on the stable-surface list; public instructions declare the new policy without changing old tags or assigning a release during this Track.
_touches: tests/update.test.ts, tests/checks-version.test.ts, tests/telemetry-contract.test.ts, bin/lib/semver.sh, .github/workflows/auto-tag.yml, CLAUDE.md, README.md, docs/installation.md_
_blocked-by: Track 26A, Track 23C, Track 23F_
- **Qualify release compatibility and document the transition** -- Exercise the existing three/four-part readers and change only demonstrated incompatibilities. Verify representative legacy-to-candidate upgrade and malformed-version controls, preserve tag history and schema guarantees, and reconcile this repo's maintained instructions. Carry the two release items the user deferred from Track 26A (PR #155): the full updater, tagging and three-part transition (DFR2), and the release owner's reader-compatibility check for stage-runs schema v2 (DFR3). The v2 writer already shipped in 0.37.0.0 with its reader-first rollback note, so DFR3 is now a post-release compatibility check on the stable surfaces, not a pre-release gate. This does not change consumers' init defaults or reinterpret their versions. VERSION/package assignment belongs to the eventual release workflow. _~180 lines._ (M)

### Group 29: Requested-model provenance

_Depends on: Group 27, Group 28_

**This group delivers:** Caller-requested model and effort values labeled separately from observed evidence.

##### Track 29A: Record a caller-requested model where detection finds none
_1 task . ~120 LOC incl. tests . low risk_
**Outcome:** A launcher can record the model and effort it requested for a stage whose harness log names none, and readers can tell that value from an observed one.
**Supports:** [SPEC](SPEC.md) O4 criterion 3 — requested-versus-observed model evidence must be distinguishable; every local `cursor-agent` row (29 ship-and-land rows, releases 0.34.2.0 to 0.36.8.0) has model null with source unknown.
**Done when:** `GSTACK_EXTEND_MODEL` and `GSTACK_EXTEND_EFFORT` fill only a null detected value and carry the requested source label, never `detected`; detection and finish flags still win; a `cursor-agent` fixture covers the route; `docs/telemetry.md` documents both variables.
_touches: bin/lib/telemetry.py, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, docs/telemetry.md, docs/stage-runs.schema.json_
_blocked-by: Track 26A_
_read-first: 26A, docs/telemetry.md_
- **Record the caller's requested model and effort** -- Stage-runs schema v2 (0.37.0.0) already reserves the `requested` source for non-null model and effort; this Track is its first producer. On Cursor's CLI route (`CURSOR_INVOKED_AS` set) `_observe_cursor_store()` skips the store and `cursor_turns()` returns only a transcript mtime. A local check on 2026-10-16 found no model in `cursor-agent` transcripts or chat-store metadata, and `~/.cursor/cli-config.json` holds only a configured default, which provenance must not record. Check whether `cursor-agent --output-format json` events name the model before relying on the environment alone. Source: `[manual] Accept a caller-supplied model when detection finds none, labeled as requested`. _~120 lines._ (S)

### Group 30: Workflow usage attribution ∥ equal host acceptance

_Depends on: Group 27, Group 28, Group 29_

**This group delivers:** Usage attributed from local logs with explicit uncertainty, alongside independent real Paseo and Conductor workflow qualification.

##### Track 30A: Attribute workflow and reviewer usage from local session logs
_3 tasks . ~600 LOC incl. tests . medium risk_
**Outcome:** The maintainer can compare total parent-and-child token usage by workflow, step and recorded model, with explicit uncertainty where a source cannot support attribution.
**Supports:** Owner-selected usage capture, 2026-10-19; promotes the two retained run-usage and outside-voice Future commitments without enabling quota routing or vendor usage API calls.
**Done when:** A local report combines step/pass events with disjoint token classes and available plan-window observations, distinguishes direct evidence from time/directory correlation, and excludes ambiguous or overlapping usage from exact totals; fixtures cover streaming copies, cumulative counter resets, nested children and concurrent sessions; unknown values remain null with reasons.
_touches: bin/lib/telemetry.py, bin/lib/workflow_metrics.py, bin/lib/quota/usage.py, docs/workflow-metrics.schema.json, docs/telemetry.md, docs/stage-runs.schema.json, tests/workflow-metrics.test.ts, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, tests/quota.test.ts, tests/fixtures/quota/, tests/helpers/touchfiles.ts_
_blocked-by: Track 24A, Track 26A, Track 27A, Track 29A_
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
_produces: comparable per-run and per-voice local usage projections, source/attribution grades and a replayable sanitized fixture corpus_
- **Reuse the local log parser for run usage** -- Absorb "Record each run's token usage and plan-window readings from the harness's own logs". Reuse or isolate the existing quota usage parser rather than introduce a third parser. Record uncached input, cache read/write and output; reasoning is a subset, never added twice. Retain logged start/end rate-limit readings with reset and concurrency caveats; account-wide percentage changes are not attributable stage consumption. Cursor/Grok sources remain unknown until verified. Read only session logs and CLI output: no credentials, identity/capacity readers or vendor usage services. _~240 lines._ (M)
- **Attribute child and outside-reviewer usage** -- Absorb "Record outside-voice calls' vendor, model, tokens and window readings". Join each recorded call to its invocation and pass using direct parent/session evidence when available, including the local `voices.jsonl` reviewer join (host subagent identifier, parent-observed dispatch/return times) that 0.38.0.0 added; mark directory/time matches as correlation and ambiguous shared-worktree matches as unknown. Deduplicate native subagents and cross-harness children, account for children that outlive the step, and preserve every contributing model/source. Do not modify upstream commands or claim observed/billed models from requested labels. _~240 lines._ (M)
- **Preserve schema and parser compatibility** -- Use the step ledger for detailed usage and retain immutable legacy/v1/v2 stage rows. Coordinate any stage-row reference fields with the stage-runs v2 schema shipped in 0.37.0.0; never add fields silently to a published closed schema. Preserve saved retry bytes and paused-segment linkage, publish only sanitized projections, and prove capture makes no credential or network calls. When editing `bin/lib/workflow_metrics.py`, weigh the Future item "Slim the workflow-metrics helper without dropping requirements"; adopting it is optional. _~120 lines._ (S)

##### Track 30B: Qualify the complete Conductor workflow and cross-session handoffs
_1 task . ~200 LOC incl. tests . medium risk_
**Outcome:** Conductor receives the same supported workflow and recovery guarantees as Paseo.
**Supports:** [SPEC](SPEC.md) O1/O3/O4 — equal priority requires current host evidence in addition to legacy usage.
**Done when:** A named release/profile has fresh install, upgrade/recovery, real plan-to-authorized-release, interrupted resume, manual-testing pause, full-review restart and cross-session handoff evidence; unknown model evidence remains unknown.
_touches: docs/acceptance/conductor.md (new)_
_blocked-by: Track 26A, Track 23I, Track 23A, Track 23G, Track 28A, Track 26B, Track 27A, Track 29A_
- **Exercise the supported Conductor profile** -- Run the same outcome matrix as Paseo using actual Conductor workspaces and the supported Codex, Cursor and Claude stage routes. Verify action receipts/final output, preserved work and stable artifact bindings after changing sessions. Include stale/partial/held controls and the SQLite store-reader fix from Track 23G, with its still-open owner gate: T42 native receipt 2 on an installed release and the 2-5 minute row-interpretation check (O4 stays unawarded until the owner confirms), plus the open owner note on receipt 1's expected effort. Include the installed Conductor host-attribution check the user deferred from Track 26A (DFR1). Record versions, operator interventions and sanitized receipts. At least one of the two onboarding attempts must be followed independently of the maintainer; do not claim cross-host or provider support from fixtures alone. _~200 documentation lines._ (L)

##### Track 30C: Qualify the complete Paseo workflow and external handoffs
_1 task . ~200 LOC incl. tests . medium risk_
**Outcome:** Paseo users and an external orchestrator can carry real work through the supported stages.
**Supports:** [SPEC](SPEC.md) O1/O3/O4 — workspace guard wording is shipped, but end-to-end host and consumer acceptance is not established.
**Done when:** A named release/profile has fresh install, upgrade/recovery, real plan-to-authorized-release, interrupted resume, manual-testing pause, full-review restart and external-consumer handoff evidence; pending approvals or failures remain holds.
_touches: docs/acceptance/paseo.md (new)_
_blocked-by: Track 26A, Track 23I, Track 23A, Track 28A, Track 26B, Track 27A, Track 29A_
- **Exercise the supported Paseo profile** -- Use the actual host-managed worktree and approved accounts with Codex implementation, Cursor review and Claude planning/release where supported. Retain the bound PR and worktree, test stale/partial/held handoffs, confirm next-stage consumption from artifacts, and count operator interventions. Include the installed Paseo host-attribution check the user deferred from Track 26A (DFR1). The real external consumer may stop at a ready PR; a separate authorized human-driven run proves landing. Confirm independent onboarding across the two host qualification Tracks. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. _~200 documentation lines._ (L)

### Group 31: Workflow efficiency assessment

_Depends on: Group 30_

**This group delivers:** A reproducible efficiency report with supported recommendations, rejected ideas and named evidence gaps.

##### Track 31A: Evaluate workflow efficiency and recommend only supported changes
_3 tasks . ~440 LOC incl. tests . medium risk_
**Outcome:** The maintainer gets an evidence-backed decision for each proposed optimization, including a valid conclusion that a change is not worthwhile or that evidence is insufficient.
**Supports:** Owner-selected investigation, 2026-10-19; empirical model comparison and review-policy changes remain outside the 1.0 acceptance gates.
**Done when:** A reproducible report separates model work, tools/CI/human waits, reuse and rework; each candidate has measured evidence or a named evidence gap; comparisons include total parent/child usage, quality and capture overhead; no model downgrade or review gate is changed by the study itself.
_touches: scripts/workflow-efficiency-report.py (new), tests/workflow-efficiency-report.test.ts (new), tests/fixtures/workflow-efficiency/ (new), tests/helpers/touchfiles.ts, docs/acceptance/workflow-efficiency.md (new)_
_blocked-by: Track 30A_
_read-first: docs/telemetry.md, docs/quota-ledger.md, docs/designs/review-independence.md_
- **Build a comparable baseline** -- Produce an offline report from sanitized projections. Separate DOCS/FULL/release-only paths, diff/task size, repo/host, skill version, waits and fresh versus resumed runs; report sample size and missingness. Reuse eligible existing release-only receipts and preserve the separate first-installed-no-CI timing obligation and 15-minute target. Report time to push and merge gate separately from human approval. Observational differences are not causal model comparisons. _~180 lines._ (M)
- **Assess the uncertain efficiency choices** -- Compare smaller models and lower effort for bounded drafting/extraction versus the main runner, including launch/context-transfer and parent-correction costs. Investigate repeated plan extraction, evidence reads, long-suite reruns, section loading, parallel scheduling and each reviewer voice's unique accepted findings. Use the existing eval/benchmark facilities where suitable; define corpus, quality bars, fixed budgets and stop rules before any model trial. Include known-defect controls and false positives; a saved success flag is not quality evidence. This Track authorizes offline analysis; any new paid/API trials need a separately approved concrete pilot and spend bound. _~180 lines._ (M)
- **Publish decisions and follow-up ownership** -- For each candidate give adopt/reject/insufficient-evidence, expected benefit, observed limitations and the smallest follow-up scope. Map recommendations to existing Future items rather than duplicating them: lifecycle helper, eval persistence, vendor diversity, the delta-scoped review default, on-demand `/review-and-prep` section loading and the `/autoplan-lean` measurement. Preserve the independent historical review-independence study and its unfulfilled evidence obligations. An insufficient-evidence result names missing data and a bounded next measurement; it never silently removes a review or acceptance gate. _~80 lines._ (S)

### Execution Map

Groups follow the packer dependency graph. Both hosts retain equal priority.
The owner-selected measurement and efficiency Tracks are additional work,
not new stable-release acceptance gates.

```
- Group 27 ← {}
- Group 28 ← {27}
- Group 29 ← {27, 28}
- Group 30 ← {27, 28, 29}
- Group 31 ← {30}
```

**5 Groups / 7 Tracks remaining: 5 existing target Tracks and 2 owner-selected measurement/investigation Tracks.**

Track completion is not stage acceptance. O1–O5 need owner-confirmed evidence
in PROGRESS before the stable release. Operator acceptance Tracks remain open
while their required evidence is missing. Quota routing and unattended shipping
remain outside this target.

---

## Future

Deferred: docs/roadmap-future.md (51 items)

## Shipped

History: docs/roadmap-shipped.md
