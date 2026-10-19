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
regeneration on 2026-10-16.

---

## In Progress

### Group 23: Task sizing ∥ telemetry run identity ∥ stage handoffs

_Depends on: none_

**This group delivers:** Correct task sizing and visible revisit triggers, one correctly attributed provenance row per invocation that a launcher can tag with its own work item, and a versioned stage-handoff contract an external caller can consume.

_Active: Track 23E on PR #145 (branch `focused-jaguar`), observed open and ready on 2026-10-16. Tracks 23A–23D, 23F and 23G have shipped (see `docs/roadmap-shipped.md`)._

##### Track 23E: Keep task sizing and deferred revisit triggers visible
_2 tasks . ~180 LOC incl. tests . medium risk_
**Outcome:** Roadmap sizing counts ordinary task titles correctly and deferred work without an indexed trigger stays discoverable.
**Supports:** [SPEC](SPEC.md) O2 — task sizing and discoverable revisit triggers are promised planning behavior.
**Done when:** Ordinary words containing CUT remain weighted tasks, genuine completion markers retain their behavior, and the Future index identifies missing inline triggers with an approved context-preserving migration path.
_touches: src/audit/parsers/roadmap.ts, src/audit/lib/task-line.ts, tests/lib-task-line.test.ts, tests/parsers-roadmap.test.ts, tests/audit-cli-contract.test.ts, tests/skill-protocols.test.ts, skills/roadmap.md_
- **Count ordinary task titles** -- Make completion-marker detection distinguish whole markers from substrings. At 6016449, `isDoneMarkerTitle` matches CUT within executable; a two-task card was parsed as one task and SIZE passed. Cover the ordinary-word case and genuine completion controls. Source: observed candidate validation, 2026-10-08. _~60 lines._ (S)
- **Make absent triggers visible and define the migration** -- Keep existing marker parsing, add explicit missing-trigger output and regression cases, and scope an approved migration that lifts existing prose triggers without promoting entries automatically. 25 of the 26 older Future entries currently lack the indexed marker (only "Major version boundary detection" carries one); leave their full text unchanged until that migration is approved. Source: `[review] Migrate legacy Future triggers into the inline marker`. _~120 lines._ (M)

##### Track 23H: Collision-safe and idempotent telemetry run identity
_2 tasks . ~320 LOC incl. tests . medium risk_
**Outcome:** Each invocation keeps its own attribution, repeated finishes do not duplicate recorded runs, and a launcher can tag each row with its own work item.
**Supports:** [SPEC](SPEC.md) O4 — concurrent invocations and retried finishes currently misattribute or duplicate records, and `work_item` is null unless an agent passes `--work-item`, so an external caller has no key that joins a row to its invocation.
**Done when:** The same-root collision and explicit-retry contract cases demonstrate one correctly attributed stage-runs row and skill_run per invocation, including logger timeouts that already wrote; `GSTACK_EXTEND_WORK_ITEM` fills `work_item` when the flag is absent and survives a finish in a later session, while hand-run rows stay null.
_touches: bin/lib/telemetry.py, tests/telemetry-contract.test.ts, tests/telemetry.test.ts, docs/telemetry.md, docs/stage-runs.schema.json_
_blocked-by: Track 23B, Track 23G_
_read-first: 23G, 23B, 22A_
- **Give each invocation a durable identity** -- Replace the shared-slot overwrite behavior while retaining harness/session refusal rules and saved retry metadata. Convert both `(current behavior)` tests to the accepted behavior and update the schema only if the row shape changes. Source: 2026-10-08 accepted Track 25B and the two named telemetry contract tests. _~240 lines._ (M)
- **Read the work item from the launch environment** -- Add an optional `GSTACK_EXTEND_WORK_ITEM` beside `--work-item`: the flag wins, the same `clean()` bounds apply, absent means null, and start saves the value in its handoff so a later-session finish keeps it. The `GSTACK_EXTEND_` prefix leaves upstream gstack's `GSTACK_*` namespace alone. v1's field and type are unchanged; update the field table in `docs/telemetry.md`. Evidence: `work_item` was null in 226 of 228 local rows on 2026-10-16, and only the `--work-item` flag in `provenance_row` sets it. Source: `[manual] Fill work_item and the host's agent ID from the launch environment`. _~80 lines._ (S)

##### Track 23I: Publish and enforce the external stage-handoff contract
_1 task . ~360 LOC incl. tests . medium risk_
**Outcome:** An external caller can transfer completed work or a named hold to the next skill without retyping context.
**Supports:** [SPEC](SPEC.md) O3/O4 — consumers currently depend on a literal implement line and a separate review marker.
**Done when:** The public versioned contract binds stage/status, plan, repository/PR, checked revision, artifacts and next action; all producers preserve current consumers, and negative examples refuse stale, blocked and partially verified work.
_touches: docs/workflow-handoffs.md (new), skills/implement.md, skills/review-and-prep.md, skills/pair-review.md, skills/ship-and-land.md, tests/handoff-contract.test.ts (new), tests/fixtures/handoffs/ (new), tests/helpers/touchfiles.ts, README.md_
_blocked-by: Track 23D_
- **Stabilize the existing handoff boundary** -- Specify the human-readable and machine-consumed fields together and update the four producers. Retain Run /review-and-prep and review-and-prep/v1 compatibility; support a caller stopping at the prepared PR. Execute fixture consumers against success, PAUSED/manual hold, missing artifact, changed revision and approved-deferred scope outputs. No orchestration engine or automatic merge. _~360 lines._ (L)

---

## Current Plan

_tombstone: 17, 19, 20, 22_

### Group 24: Acceptance-record boundary ∥ host provenance

_Depends on: Group 23_

**This group delivers:** Planning updates that cannot award a checkpoint, and a versioned provenance format that names the Paseo or Conductor agent behind each row and keeps requested model names apart from observed ones.

##### Track 24A: Version provenance for both hosts and stable releases
_2 tasks . ~460 LOC incl. tests . medium risk_
**Outcome:** Users and orchestrators can distinguish Paseo launches from their agent harness, join a row to the host agent that ran it, and retain truthful provenance.
**Supports:** [SPEC](SPEC.md) O4/O5 — route_for has Conductor branches but no Paseo identity, and no code reads any `PASEO_*` variable; equal host support needs an explicit public representation.
**Done when:** Paseo markers and custom worktree roots are qualified, a Paseo row records `PASEO_AGENT_ID` and a Conductor row its equivalent identifier (null when absent), conflicting markers remain unknown, legacy rows stay readable, and requested model names never become observed proof; three-part producer releases validate without changing the historical v0/v1 branches.
_touches: bin/lib/telemetry.py, docs/stage-runs.schema.json, tests/telemetry-contract.test.ts, tests/telemetry.test.ts, docs/telemetry.md_
_blocked-by: Track 23H_
_read-first: 23H, docs/telemetry.md_
- **Represent the workspace host compatibly** -- Define host versus harness/launch-route semantics from actual Paseo and Conductor markers; preserve old readers through an explicit versioned schema branch if needed. Record `PASEO_AGENT_ID` when present and the matching Conductor identifier, null otherwise, so a caller can join a row to the agent it launched; hand-run rows stay null. Cover missing/conflicting markers and representative Codex, Claude and Cursor launches. Do not add routing, billing or independent-review claims. Source for the agent ID: `[manual] Fill work_item and the host's agent ID from the launch environment` (2026-10-16). _~280 lines._ (M)
- **Transition the producer contract before the release format** -- Do not weaken the historical v1 branch in place. Introduce the compatible reader/writer migration required by the public schema policy, cover 1.0.0 and legacy release rows, and retain original row construction metadata on retry. Use the same new schema branch as the host representation in this Track. That branch also defines the `blocked` outcome and a requested-value source label, which Tracks 25A and 27A write, so the row format changes once. _~180 lines._ (M)

##### Track 24B: Keep acceptance records separate from release-history appends
_1 task . ~80 LOC incl. tests . medium risk_
**Outcome:** Planning and documentation updates cannot accidentally award a checkpoint.
**Supports:** [SPEC](SPEC.md) O2/O5 — this spec creates the Acceptance table and meets the deferred finding's trigger.
**Done when:** Roadmap and template instructions name the release-history destination and preserve Acceptance bytes, including when Acceptance is the last table.
_touches: skills/roadmap.md, scripts/init-templates/PROGRESS.md.tmpl, tests/skill-protocols.test.ts_
_blocked-by: Track 23E, Track 23D_
- **Protect the acceptance boundary** -- Apply the retained 2026-10-07 red-team finding: replace the ambiguous existing-row-format append rule, preserve owner authority and lock both table orderings. Do not backfill or award stage evidence. _~80 lines._ (S)

### Group 25: Paused-run provenance ∥ installed planning acceptance

_Depends on: Group 23, Group 24_

**This group delivers:** Rows that show when a run stopped for a person and when a resumed run finished, plus real installed planning and adoption evidence.

##### Track 25A: Record paused, blocked and resumed runs
_2 tasks . ~300 LOC incl. tests . medium risk_
**Outcome:** An external caller can tell a run that stopped for a person from one that never ran, and a run resumed in another checkout still records its completion.
**Supports:** [SPEC](SPEC.md) O4 criteria 2–3 and O3 — blocked work must be explicit and starts and finishes must keep their run identity; today a deliberate pause defers finish, and a resume in a new worktree finds no handoff in its root and writes nothing.
**Done when:** A deliberate pause in `/review-and-prep`, `/pair-review` or `/full-review` writes one row with outcome `blocked`; a resumed run that completes writes its own row, including from a different checkout root; each start pairs with exactly one finish; the join contract describes how segments link, and v1 and legacy rows stay readable.
_touches: bin/lib/telemetry.py, docs/telemetry.md, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, tests/skill-protocols.test.ts, skills/full-review.md, skills/gstack-extend-init.md, skills/gstack-extend-upgrade.md, skills/implement.md, skills/pair-review.md, skills/project-spec.md, skills/review-and-prep.md, skills/roadmap.md, skills/ship-and-land.md_
_blocked-by: Track 23H, Track 23I, Track 24A_
_read-first: 23H, 23I, 24A, docs/telemetry.md_
- **Close each paused segment with a blocked row** -- Replace "A deliberate pause defers finish" at the pause points of the three resumable skills with a finish that records `blocked`, and update the shared start/finish wording in every skill copy and the `RESUMABLE` adoption rule with it. Evidence (2026-10-16): no review-and-prep row for five of seven recent orchestrated PRs, and 5 review-and-prep handoffs among 24 leftover starts. Source: `[manual] Give paused and blocked /review-and-prep runs a stage-runs row`. _~180 lines._ (M)
- **Record a resumed completion in any checkout** -- A resume starts its own segment, linked to the paused one by an identifier settled at planning (run identity or the launcher's work item), so a resume in a new worktree records its completion; use the status words of the stage-handoff contract. Settle at planning how this relates to the Future cards "Recover a telemetry finish run from a different repository root" and "In-flight marker and crash detection for extend telemetry". _~120 lines._ (M)

##### Track 25B: Qualify installed planning and adoption behavior
_1 task . ~180 LOC incl. tests . medium risk_
**Outcome:** Public users can establish a spec and regenerate a plan with the acceptance guarantees already promised.
**Supports:** [SPEC](SPEC.md) O2 — Track 22B's 18 attended cases and real project-spec adoption remain unproven.
**Done when:** Named installed-skill evidence covers new/untagged and existing-project adoption, retirement/link preservation and C14, DX8, DX9, E5, CP1, CP4–CP6, EC2, EC3, EC6–EC13; every row is passed or remains an explicit blocking hold.
_touches: docs/acceptance/planning.md (new)_
_blocked-by: Track 23E, Track 23F, Track 24B_
- **Run and retain the attended planning matrix** -- Recover the exact PR #126 matrix rather than infer its cases from titles. Include complete-candidate preview/approval, pins, Hold, stale inputs, interruption, historical identity, repeat runs and the bounded timing attempt separating reading, prerequisites, execution and human understanding. Add new-project/adoption checks for the current project-spec skill. Record versions and sanitized evidence; schedule any discovered defect before 1.0. This is an operator acceptance Track, not fixture proof. _~180 documentation lines._ (L)

### Group 26: Stable release compatibility

_Depends on: Group 24, Group 25_

**This group delivers:** A verified legacy-to-three-part upgrade/release path and matching public compatibility guidance.

##### Track 26A: Verify the three-part release and upgrade transition
_1 task . ~180 LOC incl. tests . medium risk_
**Outcome:** Maintainers can publish and users can install stable SemVer releases through the existing release path.
**Supports:** [SPEC](SPEC.md) O1/O5 — the four-part instruction and tooling assumptions need an explicit verified transition.
**Done when:** Upgrading a named legacy install to a three-part candidate passes comparison, migration, audit and tag checks; public instructions declare the new policy without changing old tags or assigning a release during this Track.
_touches: tests/update.test.ts, tests/checks-version.test.ts, tests/telemetry-contract.test.ts, bin/lib/semver.sh, .github/workflows/auto-tag.yml, CLAUDE.md, README.md, docs/installation.md_
_blocked-by: Track 24A, Track 23C, Track 23F_
- **Qualify release compatibility and document the transition** -- Exercise the existing three/four-part readers and change only demonstrated incompatibilities. Verify representative legacy-to-candidate upgrade and malformed-version controls, preserve tag history and schema guarantees, and reconcile this repo's maintained instructions. This does not change consumers' init defaults or reinterpret their versions. VERSION/package assignment belongs to the eventual release workflow. _~180 lines._ (M)

### Group 27: Requested-model provenance

_Depends on: Group 24, Group 25, Group 26_

**This group delivers:** A launcher-requested model and effort on routes whose own logs name none, labeled as requested rather than observed.

##### Track 27A: Record a caller-requested model where detection finds none
_1 task . ~120 LOC incl. tests . low risk_
**Outcome:** A launcher can record the model and effort it requested for a stage whose harness log names none, and readers can tell that value from an observed one.
**Supports:** [SPEC](SPEC.md) O4 criterion 3 — requested-versus-observed model evidence must be distinguishable; every local `cursor-agent` row (29 ship-and-land rows, releases 0.34.2.0 to 0.36.8.0) has model null with source unknown.
**Done when:** `GSTACK_EXTEND_MODEL` and `GSTACK_EXTEND_EFFORT` fill only a null detected value and carry the requested source label, never `detected`; detection and finish flags still win; a `cursor-agent` fixture covers the route; `docs/telemetry.md` documents both variables.
_touches: bin/lib/telemetry.py, tests/telemetry.test.ts, tests/telemetry-contract.test.ts, docs/telemetry.md, docs/stage-runs.schema.json_
_blocked-by: Track 24A_
_read-first: 24A, docs/telemetry.md_
- **Record the caller's requested model and effort** -- On Cursor's CLI route (`CURSOR_INVOKED_AS` set) `_observe_cursor_store()` skips the store and `cursor_turns()` returns only a transcript mtime. A local check on 2026-10-16 found no model in `cursor-agent` transcripts or chat-store metadata, and `~/.cursor/cli-config.json` holds only a configured default, which provenance must not record. Check whether `cursor-agent --output-format json` events name the model before relying on the environment alone. Source: `[manual] Accept a caller-supplied model when detection finds none, labeled as requested`. _~120 lines._ (S)

### Group 28: Equal host workflow acceptance

_Depends on: Group 23, Group 24, Group 25, Group 26, Group 27_

**This group delivers:** Separate real Paseo and Conductor qualification records, including recovery and external/cross-session handoffs.

##### Track 28A: Qualify the complete Conductor workflow and cross-session handoffs
_1 task . ~200 LOC incl. tests . medium risk_
**Outcome:** Conductor receives the same supported workflow and recovery guarantees as Paseo.
**Supports:** [SPEC](SPEC.md) O1/O3/O4 — equal priority requires current host evidence in addition to legacy usage.
**Done when:** A named release/profile has fresh install, upgrade/recovery, real plan-to-authorized-release, interrupted resume, manual-testing pause, full-review restart and cross-session handoff evidence; unknown model evidence remains unknown.
_touches: docs/acceptance/conductor.md (new)_
_blocked-by: Track 24A, Track 23I, Track 23A, Track 23G, Track 26A, Track 25B, Track 25A, Track 27A_
- **Exercise the supported Conductor profile** -- Run the same outcome matrix as Paseo using actual Conductor workspaces and the supported Codex, Cursor and Claude stage routes. Verify action receipts/final output, preserved work and stable artifact bindings after changing sessions. Include stale/partial/held controls and the SQLite store-reader fix from Track 23G, with its still-open owner gate: T42 native receipt 2 on an installed release and the 2-5 minute row-interpretation check (O4 stays unawarded until the owner confirms), plus the open owner note on receipt 1's expected effort. Record versions, operator interventions and sanitized receipts. At least one of the two onboarding attempts must be followed independently of the maintainer; do not claim cross-host or provider support from fixtures alone. _~200 documentation lines._ (L)

##### Track 28B: Qualify the complete Paseo workflow and external handoffs
_1 task . ~200 LOC incl. tests . medium risk_
**Outcome:** Paseo users and an external orchestrator can carry real work through the supported stages.
**Supports:** [SPEC](SPEC.md) O1/O3/O4 — workspace guard wording is shipped, but end-to-end host and consumer acceptance is not established.
**Done when:** A named release/profile has fresh install, upgrade/recovery, real plan-to-authorized-release, interrupted resume, manual-testing pause, full-review restart and external-consumer handoff evidence; pending approvals or failures remain holds.
_touches: docs/acceptance/paseo.md (new)_
_blocked-by: Track 24A, Track 23I, Track 23A, Track 26A, Track 25B, Track 25A, Track 27A_
- **Exercise the supported Paseo profile** -- Use the actual host-managed worktree and approved accounts with Codex implementation, Cursor review and Claude planning/release where supported. Retain the bound PR and worktree, test stale/partial/held handoffs, confirm next-stage consumption from artifacts, and count operator interventions. The real external consumer may stop at a ready PR; a separate authorized human-driven run proves landing. Confirm independent onboarding across the two host qualification Tracks. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. _~200 documentation lines._ (L)

### Execution Map

Groups follow the packer dependency graph. Both hosts have equal priority;
the two host acceptance Tracks may run in parallel after their prerequisites.

```
- Group 23 ← {}
- Group 24 ← {23}
- Group 25 ← {23, 24}
- Group 26 ← {24, 25}
- Group 27 ← {24, 25, 26}
- Group 28 ← {23, 24, 25, 26, 27}
```

**6 Groups / 11 Tracks remaining for the 1.0 target.**

Track completion is not stage acceptance. O1–O5 need owner-confirmed evidence
in PROGRESS before the stable release. Operator acceptance Tracks remain open
while their required evidence is missing. Quota routing and unattended shipping
are outside this target.

---

## Future

Deferred: docs/roadmap-future.md (46 items)

## Shipped

History: docs/roadmap-shipped.md
