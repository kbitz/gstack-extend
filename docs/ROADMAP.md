# Roadmap

Organized by lifecycle state: **In Progress** (active Tracks), **Current
Plan** (next-up work), **Future** (`docs/roadmap-future.md`), **Shipped**
(`docs/roadmap-shipped.md`). A Track is one PR; Groups are equivalence
classes of "can run in parallel" — Tracks within a Group must have
set-disjoint `_touches:_` footprints. Execution order follows the
adjacency list in the Execution Map under Current Plan.

Target: [SPEC](SPEC.md) O1–O5, public-release 1.0.0. Paseo and Conductor
have equal priority. Code completion and installed/operator acceptance remain
separate gates. The owner approved this plan on 2026-10-08.

---

## In Progress

_(no Tracks declared active in this invocation)_

---

## Current Plan

_tombstone: 17, 19, 20, 22_

### Group 23: Repair supported install, planning and recovery paths

_Depends on: none_

**This group delivers:** A working first audit and upgrade path, correctly sized tasks, reliable manual-test continuation, usable Conductor metadata and a quota suite that runs under Paseo paths.

##### Track 23A: Repair quota fixture paths for Paseo worktrees
_1 task . ~80 LOC incl. tests . medium risk_
**Outcome:** The quota suite can verify a supported dot-directory checkout without a path-key failure.
**Supports:** [SPEC](SPEC.md) O1/O3 — the full-suite qualification gate must run from the actual Paseo worktree path.
**Done when:** The retained KeyError case passes from ordinary and dot-directory paths while the product normalization contract and identity/unknown-token assertions remain intact.
_touches: tests/quota_cases.py, tests/quota.test.ts, bin/lib/quota/index.py_
- **Align the fixture with the supported identity contract** -- Investigate the differing single-character versus run-collapsing path normalization before fixing it; change production behavior only if it violates its contract. Preserve the original assertion strength and run the relevant suite in both path profiles. Source: the user-deferred 2026-10-07 investigation, approved on 2026-10-08 for 1.0 qualification. _~80 lines._ (S)

##### Track 23B: Read the Conductor store shape in `cursor_turns()`
_1 task . ~160 LOC incl. tests . medium risk_
**Outcome:** Conductor Cursor runs record available model and effort instead of losing them during store parsing.
**Supports:** [SPEC](SPEC.md) O4 — equal-priority Conductor attribution; available store metadata is currently lost.
**Done when:** Store fixtures with epoch-millisecond timestamps and list-valued model params select only the correct run window and emit the available model/effort; unknown values stay unknown.
_touches: bin/lib/telemetry.py, tests/telemetry.test.ts, docs/telemetry.md_
_blocked-by: Track 22A_
_read-first: 22A, docs/designs/review-independence.md_
- **Parse the supported store representation** -- `parse_ts` still accepts only ISO strings and `cursor_turns` still requires dict params. Support epoch milliseconds in both model extraction and native-route time-window checks, read model.id independently of params shape, test list and dict params, and update the documented limit. Source: 2026-10-08 prior Track 24A and `docs/designs/review-independence.md` E4. _~160 lines._ (M)

##### Track 23C: Make preserved skill copies visible to older upgrade sessions
_2 tasks . ~170 LOC incl. tests . medium risk_
**Outcome:** Users of shared host directories learn that their preserved skills are stale and receive a usable migration path.
**Supports:** [SPEC](SPEC.md) O1 — an upgrade can leave users running stale preserved skill copies.
**Done when:** Older loaded skill text receives a persistent warning through executable output; preserved Claude copies are identified, and clean migration clears the warning without overwriting custom files.
_touches: setup, bin/update-check, bin/update-run, skills/gstack-extend-upgrade.md, docs/installation.md, tests/setup-hosts.test.ts, tests/update.test.ts_
_blocked-by: Track 22F_
- **Expose stale and preserved installs through updater state** -- Persist and expose skipped hosts plus owned regular copies that Claude preserves, including half-migrated directories. Clear state when resolved and exercise an upgrade followed by an older preamble. Source: `[review]` skipped-host and preserved-copy findings from PR #129. _~100 lines._ (M)
- **Make recovery instructions match the preserved-copy policy** -- Cover moved/deleted pointers and legacy skill copies; direct users to Shared-directory migration when setup cannot heal them. Preserve current customized files and decide legacy-only cleanup explicitly. Source: `[review] Frozen shared-directory copies never heal through setup`. _~70 lines._ (S)

##### Track 23D: `/pair-review` resume routing, safe archive and tag values
_3 tasks . ~180 LOC incl. tests . medium risk_
**Outcome:** Finish manual testing without losing the previous session or skipping a paused review preparation.
**Supports:** [SPEC](SPEC.md) O3 — a manual-test pause must resume the bound review safely.
**Done when:** A PAUSED PR receipt recommends `/review-and-prep resume`; a standalone archive block refuses collisions and failed moves without replacing the session; emitted tags obey the seven-character omit rule.
_touches: skills/pair-review.md, tests/skill-protocols.test.ts_
_blocked-by: Track 22D_
- **Resume the paused workflow** -- Check the branch PR for `review-and-prep:paused:` or a PAUSED Review and prep body receipt before the existing review-log routing. Preserve ordinary recommendations otherwise. _~50 lines._ (S)
- **Archive with resolved paths** -- Resolve the verified extend root, session helper, BRANCH and SESSION_DIR within the archive block; archive only a nonempty session, stop on existing destination or failed move, and execute the block in the existing shell-test pattern. Update the L7 guard count. Source: `[plan-ceo-review:track=22D,defer=true]`. _~80 lines._ (S)
- **Keep source tags valid** -- Inline the contract: omit `files=` for paths containing brackets, comma, semicolon, pipe, backtick or dollar-parenthesis; join safe paths with pipes. Add a focused lock now that Track 22D has landed. _~50 lines._ (S)

##### Track 23E: Keep task sizing and deferred revisit triggers visible
_2 tasks . ~180 LOC incl. tests . medium risk_
**Outcome:** Roadmap sizing counts ordinary task titles correctly and deferred work without an indexed trigger stays discoverable.
**Supports:** [SPEC](SPEC.md) O2 — task sizing and discoverable revisit triggers are promised planning behavior.
**Done when:** Ordinary words containing CUT remain weighted tasks, genuine completion markers retain their behavior, and the Future index identifies missing inline triggers with an approved context-preserving migration path.
_touches: src/audit/parsers/roadmap.ts, src/audit/lib/task-line.ts, tests/lib-task-line.test.ts, tests/parsers-roadmap.test.ts, tests/audit-cli-contract.test.ts, skills/roadmap.md_
- **Count ordinary task titles** -- Make completion-marker detection distinguish whole markers from substrings. At 6016449, `isDoneMarkerTitle` matches CUT within executable; a two-task card was parsed as one task and SIZE passed. Cover the ordinary-word case and genuine completion controls. Source: observed candidate validation, 2026-10-08. _~60 lines._ (S)
- **Make absent triggers visible and define the migration** -- Keep existing marker parsing, add explicit missing-trigger output and regression cases, and scope an approved migration that lifts existing prose triggers without promoting entries automatically. 25 of the 26 older Future entries currently lack the indexed marker (only "Major version boundary detection" carries one); leave their full text unchanged until that migration is approved. Source: `[review] Migrate legacy Future triggers into the inline marker`. _~120 lines._ (M)

##### Track 23F: Allow the first roadmap audit in an untagged project
_1 task . ~120 LOC incl. tests . medium risk_
**Outcome:** A newly initialized project can run the recommended planning workflow before its first release tag.
**Supports:** [SPEC](SPEC.md) O2 — fresh untagged projects cannot complete the recommended first audit.
**Done when:** An initialized, untagged project has a usable first roadmap audit, while invalid versions and mismatched existing tags retain their checks.
_touches: src/audit/checks/version.ts, tests/checks-version.test.ts (new), tests/init-bin.test.ts, tests/roadmap-audit/_
- **Distinguish a missing first tag from version drift** -- Choose a narrow no-tag baseline/advisory rule and cover fresh init plus existing mismatched-tag controls. Update only affected audit expectations. Source: `[investigate] Fresh init projects fail the audit's VERSION gate until tagged`; `runCheckVersion` currently adds the no-tag notice to failing findings. _~120 lines._ (M)

### Group 24: Stable run identity and workflow handoffs

_Depends on: Group 23_

**This group delivers:** Correct attribution for concurrent/retried invocations, a compatible external stage-handoff contract and protected acceptance records.

##### Track 24A: Collision-safe and idempotent telemetry run identity
_1 task . ~240 LOC incl. tests . medium risk_
**Outcome:** Each invocation keeps its own attribution and repeated finishes do not duplicate recorded runs.
**Supports:** [SPEC](SPEC.md) O4 — concurrent invocations and retried finishes currently misattribute or duplicate records.
**Done when:** The same-root collision and explicit-retry contract cases demonstrate one correctly attributed stage-runs row and skill_run per invocation, including logger timeouts that already wrote.
_touches: bin/lib/telemetry.py, tests/telemetry-contract.test.ts, tests/telemetry.test.ts, docs/telemetry.md, docs/stage-runs.schema.json_
_blocked-by: Track 23B_
_read-first: 23B, 22A_
- **Give each invocation a durable identity** -- Replace the shared-slot overwrite behavior while retaining harness/session refusal rules and saved retry metadata. Convert both `(current behavior)` tests to the accepted behavior and update the schema only if the row shape changes. Source: 2026-10-08 accepted Track 25B and the two named telemetry contract tests. _~240 lines._ (M)

##### Track 24B: Publish and enforce the external stage-handoff contract
_1 task . ~360 LOC incl. tests . medium risk_
**Outcome:** An external caller can transfer completed work or a named hold to the next skill without retyping context.
**Supports:** [SPEC](SPEC.md) O3/O4 — consumers currently depend on a literal implement line and a separate review marker.
**Done when:** The public versioned contract binds stage/status, plan, repository/PR, checked revision, artifacts and next action; all producers preserve current consumers, and negative examples refuse stale, blocked and partially verified work.
_touches: docs/workflow-handoffs.md (new), skills/implement.md, skills/review-and-prep.md, skills/pair-review.md, skills/ship-and-land.md, tests/handoff-contract.test.ts (new), tests/helpers/touchfiles.ts_
_blocked-by: Track 23D_
- **Stabilize the existing handoff boundary** -- Specify the human-readable and machine-consumed fields together and update the four producers. Retain Run /review-and-prep and review-and-prep/v1 compatibility; support a caller stopping at the prepared PR. Execute fixture consumers against success, PAUSED/manual hold, missing artifact, changed revision and approved-deferred scope outputs. No orchestration engine or automatic merge. _~360 lines._ (L)

##### Track 24C: Keep acceptance records separate from release-history appends
_1 task . ~80 LOC incl. tests . medium risk_
**Outcome:** Planning and documentation updates cannot accidentally award a checkpoint.
**Supports:** [SPEC](SPEC.md) O2/O5 — this spec creates the Acceptance table and meets the deferred finding's trigger.
**Done when:** Roadmap and template instructions name the release-history destination and preserve Acceptance bytes, including when Acceptance is the last table.
_touches: skills/roadmap.md, scripts/init-templates/PROGRESS.md.tmpl, tests/skill-protocols.test.ts_
_blocked-by: Track 23E, Track 23D_
- **Protect the acceptance boundary** -- Apply the retained 2026-10-07 red-team finding: replace the ambiguous existing-row-format append rule, preserve owner authority and lock both table orderings. Do not backfill or award stage evidence. _~80 lines._ (S)

### Group 25: Host provenance and installed planning acceptance

_Depends on: Group 23, Group 24_

**This group delivers:** A versioned provenance format for both hosts and three-part releases, plus real installed planning/adoption evidence.

##### Track 25A: Version provenance for both hosts and stable releases
_2 tasks . ~420 LOC incl. tests . medium risk_
**Outcome:** Users and orchestrators can distinguish Paseo launches from their agent harness and retain truthful provenance.
**Supports:** [SPEC](SPEC.md) O4/O5 — route_for has Conductor branches but no Paseo identity; equal host support needs an explicit public representation.
**Done when:** Paseo markers and custom worktree roots are qualified, conflicting markers remain unknown, legacy rows stay readable, and requested model names never become observed proof; three-part producer releases validate without changing the historical v0/v1 branches.
_touches: bin/lib/telemetry.py, docs/stage-runs.schema.json, tests/telemetry-contract.test.ts, tests/telemetry.test.ts, docs/telemetry.md_
_blocked-by: Track 24A_
- **Represent the workspace host compatibly** -- Define host versus harness/launch-route semantics from actual Paseo and Conductor markers; preserve old readers through an explicit versioned schema branch if needed. Cover missing/conflicting markers and representative Codex, Claude and Cursor launches. Do not add routing, billing or independent-review claims. _~240 lines._ (M)
- **Transition the producer contract before the release format** -- Do not weaken the historical v1 branch in place. Introduce the compatible reader/writer migration required by the public schema policy, cover 1.0.0 and legacy release rows, and retain original row construction metadata on retry. Use the same new schema branch as the host representation in this Track. _~180 lines._ (M)

##### Track 25B: Qualify installed planning and adoption behavior
_1 task . ~180 LOC incl. tests . medium risk_
**Outcome:** Public users can establish a spec and regenerate a plan with the acceptance guarantees already promised.
**Supports:** [SPEC](SPEC.md) O2 — Track 22B's 18 attended cases and real project-spec adoption remain unproven.
**Done when:** Named installed-skill evidence covers new/untagged and existing-project adoption, retirement/link preservation and C14, DX8, DX9, E5, CP1, CP4–CP6, EC2, EC3, EC6–EC13; every row is passed or remains an explicit blocking hold.
_touches: docs/acceptance/planning.md (new)_
_blocked-by: Track 23E, Track 23F, Track 24C_
- **Run and retain the attended planning matrix** -- Recover the exact PR #126 matrix rather than infer its cases from titles. Include complete-candidate preview/approval, pins, Hold, stale inputs, interruption, historical identity, repeat runs and the bounded timing attempt separating reading, prerequisites, execution and human understanding. Add new-project/adoption checks for the current project-spec skill. Record versions and sanitized evidence; schedule any discovered defect before 1.0. This is an operator acceptance Track, not fixture proof. _~180 documentation lines._ (L)

### Group 26: Stable release compatibility

_Depends on: Group 23, Group 25_

**This group delivers:** A verified legacy-to-three-part upgrade/release path and matching public compatibility guidance.

##### Track 26A: Verify the three-part release and upgrade transition
_1 task . ~180 LOC incl. tests . medium risk_
**Outcome:** Maintainers can publish and users can install stable SemVer releases through the existing release path.
**Supports:** [SPEC](SPEC.md) O1/O5 — the four-part instruction and tooling assumptions need an explicit verified transition.
**Done when:** Upgrading a named legacy install to a three-part candidate passes comparison, migration, audit and tag checks; public instructions declare the new policy without changing old tags or assigning a release during this Track.
_touches: tests/update.test.ts, tests/checks-version.test.ts, tests/telemetry-contract.test.ts, bin/lib/semver.sh, .github/workflows/auto-tag.yml, CLAUDE.md, README.md, docs/installation.md_
_blocked-by: Track 25A, Track 23C, Track 23F_
- **Qualify release compatibility and document the transition** -- Exercise the existing three/four-part readers and change only demonstrated incompatibilities. Verify representative legacy-to-candidate upgrade and malformed-version controls, preserve tag history and schema guarantees, and reconcile this repo's maintained instructions. This does not change consumers' init defaults or reinterpret their versions. VERSION/package assignment belongs to the eventual release workflow. _~180 lines._ (M)

### Group 27: Equal host workflow acceptance

_Depends on: Group 23, Group 24, Group 25, Group 26_

**This group delivers:** Separate real Paseo and Conductor qualification records, including recovery and external/cross-session handoffs.

##### Track 27A: Qualify the complete Conductor workflow and cross-session handoffs
_1 task . ~200 LOC incl. tests . medium risk_
**Outcome:** Conductor receives the same supported workflow and recovery guarantees as Paseo.
**Supports:** [SPEC](SPEC.md) O1/O3/O4 — equal priority requires current host evidence in addition to legacy usage.
**Done when:** A named release/profile has fresh install, upgrade/recovery, real plan-to-authorized-release, interrupted resume, manual-testing pause, full-review restart and cross-session handoff evidence; unknown model evidence remains unknown.
_touches: docs/acceptance/conductor.md (new)_
_blocked-by: Track 25A, Track 24B, Track 23A, Track 26A, Track 25B_
- **Exercise the supported Conductor profile** -- Run the same outcome matrix as Paseo using actual Conductor workspaces and the supported Codex, Cursor and Claude stage routes. Verify action receipts/final output, preserved work and stable artifact bindings after changing sessions. Include stale/partial/held controls and the store-reader fix. Record versions, operator interventions and sanitized receipts. At least one of the two onboarding attempts must be followed independently of the maintainer; do not claim cross-host or provider support from fixtures alone. _~200 documentation lines._ (L)

##### Track 27B: Qualify the complete Paseo workflow and external handoffs
_1 task . ~200 LOC incl. tests . medium risk_
**Outcome:** Paseo users and an external orchestrator can carry real work through the supported stages.
**Supports:** [SPEC](SPEC.md) O1/O3/O4 — workspace guard wording is shipped, but end-to-end host and consumer acceptance is not established.
**Done when:** A named release/profile has fresh install, upgrade/recovery, real plan-to-authorized-release, interrupted resume, manual-testing pause, full-review restart and external-consumer handoff evidence; pending approvals or failures remain holds.
_touches: docs/acceptance/paseo.md (new)_
_blocked-by: Track 25A, Track 24B, Track 23A, Track 26A, Track 25B_
- **Exercise the supported Paseo profile** -- Use the actual host-managed worktree and approved accounts with Codex implementation, Cursor review and Claude planning/release where supported. Retain the bound PR and worktree, test stale/partial/held handoffs, confirm next-stage consumption from artifacts, and count operator interventions. The real external consumer may stop at a ready PR; a separate authorized human-driven run proves landing. Confirm independent onboarding across the two host qualification Tracks. No consumer-repo edits, new spend, unattended release or acceptance-by-idle-status. _~200 documentation lines._ (L)

### Execution Map

Groups follow the packer dependency graph. Both hosts have equal priority;
the two host acceptance Tracks may run in parallel after their prerequisites.

```
- Group 23 ← {}
- Group 24 ← {23}
- Group 25 ← {23, 24}
- Group 26 ← {23, 25}
- Group 27 ← {23, 24, 25, 26}
```

**5 Groups / 14 Tracks remaining for the 1.0 target.**

Track completion is not stage acceptance. O1–O5 need owner-confirmed evidence
in PROGRESS before the stable release. Operator acceptance Tracks remain open
while their required evidence is missing. Quota routing and unattended shipping
are outside this target.

---

## Future

Deferred: docs/roadmap-future.md (41 items)

## Shipped

History: docs/roadmap-shipped.md
