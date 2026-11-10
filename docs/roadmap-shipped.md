# Shipped

## Shipped

### Phase 1: Bun Test Migration ✓ Shipped (v0.18.3 → v0.18.11.0)

**End-state:** `bun test` is the sole test entry point, all `scripts/test-*.sh` retired, `bin/roadmap-audit` is a 7-line POSIX-sh shim invoking `src/audit/cli.ts`, and the leverage patterns (touchfiles, audit-compliance) are adopted. Skill prose corpus + in-session judging shipped in Track 4C but was later removed in Track 7A as calibration theater (parent gstack project has no equivalent; the fixture genre didn't match real skill source-prose edits). Eval persistence was deferred to Future and remains deferred.

**Groups:** 1, 2, 3, 4 (sequential).

Suite 113s → 32s; audit snapshots 124s → 7.3s.

#### Group 1: Bun Test Toolchain ✓ Shipped (v0.18.3)
- Track 1A — _shipped (v0.18.3): bootstrap bun + port source-tag lib + tests_

#### Group 2: TypeScript Port of `bin/roadmap-audit` ✓ Shipped (v0.18.11.0)
- Track 2A — _shipped (v0.18.6.0): port `bin/roadmap-audit` to TypeScript_
- Track 2B — _shipped (v0.18.11.0): cut `bin/roadmap-audit` over to TS implementation_

#### Group 3: Test Runner Migration + Invariants ✓ Shipped (v0.18.7.0)
- Track 3A — _shipped (v0.18.7.0): migrate test runners + invariants test_

#### Group 4: Test Leverage Patterns ✓ Shipped (v0.18.11.0)
- Track 4A — _shipped (v0.18.9.0): touchfiles diff selection_
- Track 4C — _shipped (v0.18.11.0); removed in Track 7A: skill prose corpus + in-session judging routing rule_
- Track 4D — _shipped (v0.18.10.0): audit-compliance test for gstack-extend invariants_

#### Group 5: Install Pipeline ✓ Shipped (v0.18.14.0)
- Track 5A — _shipped (v0.18.14.0): install pipeline polish — 3 of 5 originally-planned tasks landed (preamble probe pattern, doc-type detection heuristic, setup symlink hardening); 2 deferred tasks (layout scaffolding, update-run dir propagation) routed to Project Bootstrapping (now Group 10 in Shipped, Group 12 in Current Plan)._

#### Group 6: Audit Polish + Track 5A Test Follow-ups + /roadmap v2 Cutover ✓ Shipped (v0.18.16.0 → v0.19.0.0)
- Track 6A — _shipped (v0.18.19.0): STALENESS → VERSION_TAG_STALENESS rename + STATUS warn fix_
- Track 6B — _shipped (v0.18.18.0): Track 5A test follow-ups_
- Track 6C — _shipped (v0.18.16.0–v0.18.17.0): /roadmap-new refactor + ID-renames helper + ROADMAP v2 migration_
- Track 6D — _shipped (v0.19.0.0): /roadmap-new → /roadmap cutover, drop v1 grammar_

#### Group 7: Hotfix: `/pair-review` Cross-Branch Resume ✓ Shipped (v0.19.0.1)
- Track 7A — _shipped (v0.19.0.1): /pair-review never offers to resume cross-branch sessions (#76)_

#### Group 8: `/pair-review` Concurrent Sessions Across Branches ✓ Shipped (v0.19.1.0)
- Track 8A — _shipped (v0.19.1.0): /pair-review supports concurrent sessions across branches (#77)_

#### Group 9: Tighten `git commit` Failure Handling ✓ Shipped (v0.19.2.0)
- Track 9A — _shipped (v0.19.2.0): surface git commit failure output + drop skill-prose-corpus (#78)_

#### Group 10: Project Bootstrapping — Layout Scaffolding ✓ Shipped (v0.19.3.0)
- Track 10A — _shipped (v0.19.3.0): Layout Scaffolding skill section + audit gap fixes (#79)_

#### Group 11: New Skill `/gstack-extend-upgrade` ✓ Shipped (v0.20.0.0)
- Track 11A — _shipped (v0.20.0.0): /gstack-extend-upgrade skill + consolidate upgrade flow (#80)_

#### Group 12: `gstack-extend init <project>` Scaffold ✓ Shipped (v0.21.0.0)
- Track 12A — _shipped (v0.21.0.0): gstack-extend init <project> + skill — full bootstrap (starter ROADMAP/CLAUDE/CHANGELOG/TODOS/PROGRESS/VERSION, docs/ layout, project registry, post-render audit gate), setup CLI symlink + self-registration (#83)_

#### Group 13: Telemetry Parity with Gstack ✓ Shipped (v0.22.0.0)
- Track 13A — _shipped (v0.22.0.0): bin/gstack-extend-telemetry wrapper + canonical preamble/epilogue blocks in 5 skill files. Every extend skill activation now writes start + end lines to ~/.gstack/analytics/skill-usage.jsonl with extend:<skill> name and source:gstack-extend field; cross-machine retro tooling and /retro pick up extend activity with zero downstream changes. Wrapper falls back silently when gstack isn't installed. Drift-lock test extracts canonical blocks from skills/full-review.md and asserts each other skill embeds the templated variant. Opportunistic contract test catches future gstack flag renames._

#### Group 14: Fix `parsers-roadmap` Group 6 Completeness Failure ✓ Shipped (v0.22.0.2)
- Track 14A — _shipped (v0.22.0.2): dropped volatile live-ROADMAP assertions; added a synthetic state-section enclosure fixture. Parser untouched._

#### Group 15: Canonical Locks ∥ Migrations ✓ Shipped (v0.24.3.0 → v0.24.6.0)
- Track 15A — _shipped (v0.24.3.0): SHARED:conductor-visibility-head lock in four skills, exact-set advisory/fail section-list drift test, shared `parseSetupSkills` helper with explicit SETUP/PROTOCOL/PREAMBLE/CONDUCTOR cohorts (#94)_
- Track 15B — _shipped (v0.24.5.0 → v0.24.6.0): `bin/lib/run-migrations.sh` version-windowed runner + applied/failed ledger + MIGRATION_WARN in /gstack-extend-upgrade (#96); hop-from persistence and non-semver failed-ledger retry (#98)_
- _Tracks 15C, 15D, 15E never shipped under this number; re-packed 2026-09-24 as 16F, 18A, 16E. The same regen moved earlier Current Plan IDs: 16A→17C (trim pair-review), 16B→17D (trim full-review), 16C→17E (trim review-apparatus), 16D→17F (trim test-plan), 16E→19A (layout-scaffold extract), 17A→19B (skill template)._

#### Group 16: Contract Revalidation ∥ Review Independence ∥ Merge Gate ∥ Preamble Hardening ∥ Init Polish ✓ Shipped (v0.29.2.0 → v0.32.1.0)
- Track 16A — _shipped (v0.32.1.0): telemetry and execution-provenance contracts revalidated against emitted rows; join contract and observed-coverage record in `docs/telemetry.md`, locked by `tests/telemetry-contract.test.ts` (#116)_
- Track 16B — _shipped at limited scope (v0.29.3.0): `docs/designs/review-independence.md` defines the independence rule, static voice map, reference evaluator and corrected metadata reconstruction. The measured composition was not established; the empirical study is deferred in `docs/roadmap-future.md` (#111)_
- Track 16C — _shipped (v0.30.0.0): shadow-only `bin/merge-gate` with a complexity budget, versioned verdicts and preserved decision-time evidence (#112)_
- Track 16D — _shipped (v0.29.4.0): upgrade and init preambles resolve only an absolute, verified extend root; test cleanup moved to `afterAll`; the native Cursor host landed in the same PR (#113)_
- Track 16E — _shipped (v0.29.2.0): init test coverage, shared `mkScope` helper, template selection from the canonical file list, fail-soft setup self-registration (#110)_
- _The 2026-09-26 re-pack (#115) relabeled these 16D→16A, 16E→17A, 16C→17B and 16A→17C, three of them after they had shipped. No PR shipped under the new labels; the Track 16D test names, the PROGRESS rows and the TODOS tags use the IDs above. Older test comments from #94 (2026-08-15) use an earlier numbering in which 16A–16D were skill-file trims and 17A was the skill template. No Group 17 shipped._

#### Group 18: Review-and-Prep Hardening ∥ Telemetry Follow-ups ∥ Skill-File Trims ∥ Layout Preflight ∥ Description Cap ✓ Shipped (v0.32.1.1 → v0.33.0.0)
- Track 18A — _shipped (v0.32.4.0): `/review-and-prep` asks when a Greptile run fails, never appears, stalls, or reviewed a commit no longer on the branch; each Greptile-once and pause/resume gap it took from the PR #102 adversarial pass ends in a user decision, with drift-locks (#120)_
- Track 18B — _shipped (v0.32.5.0): telemetry finds gstack's helpers on Codex, OpenCode and Cursor; a start-less finish no longer adopts another session's handoff; a cross-root finish writes nothing; uninstall removes both shared links (#118)_
- Track 18C — _shipped (v0.32.3.0): `/full-review` trimmed to current severity names and one closing question (#121)_
- Track 18D — _shipped (v0.32.1.1): duplicated `/pair-review` prose trimmed; behavior and protected blocks unchanged (#117)_
- Track 18E — _shipped (v0.32.2.0): realpath containment preflight in the Layout Scaffolding skill prose (#119)_
- Track 18F — _shipped (v0.33.0.0): compliance and setup tests share a bounded frontmatter reader and enforce the repository's normalized 1024 UTF-16-code-unit description cap, with parsing and boundary fixtures (#122)_
- _Planned on 2026-09-24 as 17A, 17B, 17D, 17C and 18A; the 2026-09-26 re-pack gave 18A–18E these IDs before any shipped, and carried 18F over from the retired 17F's description-cap task._

#### Group 21: Audit Gate ✓ Shipped (v0.29.1.0)
- Track 21A — _shipped (v0.29.1.0): DOC_LOCATION's `docs/`-absent finding fires only on a repo-local `bin/roadmap-audit` file; MIGRATION_NEEDED names the archived spec (#109). Planned as 16F._
- _Groups 19 and 20 never shipped under those numbers; re-packed 2026-09-30 as 22C + 25A (layout-scaffold helper, then its callers), 26B (skill template), 26A (capability table) and 22B (roadmap closure)._

## Individual Track history

### Track 22A: Version stage-runs rows and publish their schema ✓ Shipped (v0.33.4.0)
- 2026-10-02: merged [PR #127](https://github.com/kbitz/gstack-extend/pull/127) (commit `eb3bd7c`); verified land-time Track 22A, original Group 22. Introduced under this ID on 2026-09-30 in `756e566`; no later relabel before landing.
- 39/39 approved requirements verified; schema, writer, validator and selected-upstream compatibility delivered. Native onboarding time remains unmeasured, with no manual gate in the approved scope.

## Individual Track history

### Track 22B: Reconcile shipped-Track closure with PACKING ✓ Shipped (v0.33.5.0)
- 2026-10-02: merged [PR #126](https://github.com/kbitz/gstack-extend/pull/126) (commit `7af457b`); verified land-time Track 22B, original Group 22. Introduced under this ID on 2026-09-30 in `756e566`; no later relabel before landing.
- 38 verified and 18 attended-acceptance obligations explicitly deferred by the user. Policy and parser evidence are complete; the installed-skill acceptance cases are scheduled as Current Plan Track 25B and are not claimed as passed.

## Individual Track history

### Track 22C: Layout Scaffolding executable helper ✓ Shipped (v0.34.0.0)
- 2026-10-02: merged [PR #128](https://github.com/kbitz/gstack-extend/pull/128) (commit `217d630`); verified land-time Track 22C, original Group 22. Introduced under this ID on 2026-09-30 in `756e566`; no later relabel before landing.
- 126 verified requirements and three explicit deferrals: caller integration remains Future ("Route Layout Scaffolding and init through the helper"); archive routing (X10) and relative-link warnings (X11) remain Future. Native owned CLI fixtures support helper acceptance.

## Individual Track history

### Track 22D: `/full-review` run-state and template fixes ✓ Shipped (v0.33.2.0)
- 2026-10-02: merged [PR #125](https://github.com/kbitz/gstack-extend/pull/125) (commit `930d3d0`); verified land-time Track 22D, original Group 22. Introduced under this ID on 2026-09-30 in `756e566`; no later relabel before landing.
- All 22 approved ENG items completed, including release text. Shell block execution and structural locks support this prose contract; end-to-end agent resume/concurrency is deferred to the session helper.

## Individual Track history

### Track 22E: Greptile lifecycle decision core with scenario tests ✓ Shipped (v0.34.5.0)
- 2026-10-06: merged [PR #130](https://github.com/kbitz/gstack-extend/pull/130) (commit `ddb63cb`); verified land-time Track 22E, original Group 22. Introduced under this ID on 2026-09-30 in `756e566`; no later relabel before landing.
- 44 verified and 31 user-deferred matrix rows under the approved core-only scope. Adoption and retained findings remain active prerequisites; the dropped human first-use check has no timing claim. Core policy is still pre-0.34.4.0 until the deferred repair (Future, "Bring the Greptile core up to the current approved policy").

## Individual Track history

### Track 22F: Setup host-safety follow-ups ✓ Shipped (v0.34.2.0)
- 2026-10-06: merged [PR #129](https://github.com/kbitz/gstack-extend/pull/129) (commit `a289753`); verified land-time Track 22F, original Group 22. Introduced under this ID on 2026-09-30 in `756e566`; no later relabel before landing.
- 15/15 approved items verified. The user accepted the named final documentation-audit freshness limitation; three retained preserved-copy/reporting follow-ups remain active work. No claim that shared copies auto-heal.

## Individual Track history
_tombstone: 22_

- 2026-10-08: all six original Group 22 Tracks independently recorded above; no active pin declared. Prefix 22 is retired.

## Individual Track history

### Track 23A: Repair quota fixture paths for Paseo worktrees ✓ Shipped (v0.36.1.0)
- 2026-10-08: merged [PR #135](https://github.com/kbitz/gstack-extend/pull/135) (commit `a25f8f1`); verified land-time Track 23A, original Group 23. Introduced under this ID on 2026-10-08 in `5b6e516`; no later relabel before landing. The ID had earlier labeled the unrelated `/pair-review` resume Track (2026-09-30, `756e566`), which remains unshipped.
- Plan completion passed: 25 items done and 1 user-approved change (a `docs/TODOS.md` backlog note beyond the `tests/quota_cases.py` fence). Independent literal path profiles cover ordinary and dot-directory checkouts; production slug normalization is unchanged. Native host and provider acceptance stay with their SPEC/PROGRESS owners.

## Individual Track history

### Track 23B: Read the Conductor store shape in `cursor_turns()` ✓ Shipped (v0.36.2.0)
- 2026-10-09: merged [PR #136](https://github.com/kbitz/gstack-extend/pull/136) (commit `faa17ac`); verified land-time Track 23B, original Group 23. Introduced under this ID on 2026-10-08 in `5b6e516`; no later relabel before landing.
- 56/56 approved plan items verified (T01–T42, R01–R14). Fixtures cover epoch-millisecond times and list-valued params in the NDJSON store shape. T42's in-PR obligation (handoff and procedure) was met; its native receipt was a separate post-install gate. Receipt 1 (2026-10-09) was negative: current Conductor builds write SQLite shards this reader does not read. The follow-up is the SQLite store-reader Track (Track 23G as of 2026-10-09). O4 is not awarded.

## Individual Track history

### Track 23C: Make preserved skill copies visible to older upgrade sessions ✓ Shipped (v0.36.4.0)
- 2026-10-09: merged [PR #138](https://github.com/kbitz/gstack-extend/pull/138) (commit `d5dbf98`); verified land-time Track 23C, original Group 23. Introduced under this ID on 2026-10-08 in `5b6e516`; no later relabel before landing.
- Plan completion: 56 of 57 approved items done at review; the remaining partial item closed in `5d130df`. Tests cover an upgrade followed by an older preamble, and retired copies. Real-host upgrade and recovery acceptance stays with the host qualification Tracks (28A and 28B as of 2026-10-16).

## Individual Track history

### Track 23D: `/pair-review` resume routing, safe archive and tag values ✓ Shipped (v0.36.6.0)
- 2026-10-11: merged [PR #141](https://github.com/kbitz/gstack-extend/pull/141) (commit `7773b3f`); verified land-time Track 23D, original Group 23. Labeled Track 23A on 2026-09-30 (`756e566`) and relabeled 23D on 2026-10-08 (`5b6e516`).
- 58 of 58 approved items verified, none deferred. On 2026-10-09 the user approved one reworded task: pair-review tags carry no `files=` key, instead of joining safe paths with pipes. Installed-agent acceptance stays with the host qualification Tracks.

## Individual Track history

### Track 23G: Read the SQLite Conductor store shape in `cursor_turns()` ✓ Shipped (v0.36.7.0)
- 2026-10-12: merged [PR #140](https://github.com/kbitz/gstack-extend/pull/140) (commit `07412e5`); verified land-time Track 23G, original Group 23. Introduced under this ID on 2026-10-09 in `1c75186`; no later relabel before landing.
- 68 of 68 approved items verified, none deferred; the 0.36.7.0 CHANGELOG names both supported layouts (NDJSON and SQLite `index.db`). `active_run_id` is not used as a tiebreaker (plan decision D6). Coverage was 77% against an 80% target, a risk the user accepted. The owner-side gate that was never part of Done when stays open: T42 native receipt 2 and the row-interpretation check, now carried by the Conductor qualification Track (28A as of 2026-10-16). O4 is not awarded.

## Individual Track history

### Track 23F: Allow the first roadmap audit in an untagged project ✓ Shipped (v0.36.9.0)
- 2026-10-16: merged [PR #144](https://github.com/kbitz/gstack-extend/pull/144) (commit `73188a4`); verified land-time Track 23F, original Group 23. Introduced under this ID on 2026-10-08 in `5b6e516`; no later relabel before landing.
- 25 of 25 in-scope items verified, including a fresh-init audit assertion; invalid versions and mismatched existing tags still fail. User-approved edits to `skills/roadmap.md` and `tests/skill-protocols.test.ts` fell outside the declared footprint. The installed `/roadmap` check stays with the planning qualification Track (25B).

## Individual Track history

### Track 23E: Keep task sizing and deferred revisit triggers visible ✓ Shipped (v0.36.10.0)
- 2026-10-16: merged [PR #145](https://github.com/kbitz/gstack-extend/pull/145) (commit `7a887ef`); land-time Track 23E, original Group 23. Introduced under this ID on 2026-10-08 in `5b6e516`; no later relabel before landing.
- The approved-scope completion matrix reports 44/44 requirements verified. Merged code covers whole-marker task sizing and missing-trigger indexing; the skill includes the context-preserving migration. Installed-agent behavior is not claimed from fixtures: the existing planning qualification Track retains its 18 attended cases and now includes the trigger-migration inbox scenarios.

## Individual Track history

### Track 23H: Collision-safe and idempotent telemetry run identity ✓ Shipped (v0.36.11.0)
- 2026-10-17: merged [PR #146](https://github.com/kbitz/gstack-extend/pull/146) (commit `8f79dd2`); land-time Track 23H, original Group 23. Introduced as Track 24A on 2026-10-08 in `5b6e516`, relabeled 23H by the 2026-10-16 regeneration included in the merged change.
- The approved revision-1 completion matrix reports 55/55 requirements verified, including persistent launch work-item identity and explicit retry behavior. The approved limits for indistinguishable implicit finishes and uncertain delivery remain limits, not exact-attribution claims. Doctor and abandoned-handoff retention remain deferred; host identity, pause/resume and installed host acceptance remain Current Plan work.

## Individual Track history

### Track 23I: Publish and enforce the external stage-handoff contract ✓ Shipped (v0.36.13.0)
- 2026-10-19: merged [PR #148](https://github.com/kbitz/gstack-extend/pull/148) (commit `1f828ef`); land-time Track 23I, original Group 23. Introduced as Track 24B on 2026-10-08 in `5b6e516`, relabeled 23I by the 2026-10-16 regeneration in `8f79dd2`.
- The approved completion matrix reports 47/47 requirements verified with no in-scope deferrals. The versioned document, four producer references, compatibility anchors and fixture classifier are delivered. This was the owner-approved documentation/fixture scope; it does not establish live external-consumer or host acceptance, which remains with the two host qualification Tracks. Residual parser and pause-detector follow-ups remain in TODOS.

## Individual Track history
_tombstone: 23_

- 2026-10-19: all nine original Group 23 Tracks have individual landed receipts; no active pin is declared. Prefix 23 is retired. Existing owner acceptance obligations remain with their named qualification work.

## Individual Track history

### Track 24A: Measure review and release phases without changing their gates ✓ Shipped (v0.36.16.0)
- 2026-10-20: merged [PR #151](https://github.com/kbitz/gstack-extend/pull/151) (commit `edc5df5`); verified land-time Track 24A, original Group 24. Introduced under this ID on 2026-10-20 by the regeneration squashed into the same commit; no later relabel before landing. The ID had earlier labeled the host-provenance Track (2026-10-17 to 2026-10-19), which landed separately as 26A.
- The approved plan's completion matrix reports 66 VERIFIED and 0 deferred. The installed two-wrapper smoke, Linux paths and the five-minute first-user target were recorded as evidence limits, not requirements. Reader-cardinality follow-ups went to TODOS under the owner's stop rule; the helper-slimming advisories went there because the owner kept the new module unchanged before first use.

## Individual Track history

### Track 25A: Keep acceptance records separate from release-history appends ✓ Shipped (v0.36.17.0)
- 2026-10-20: merged [PR #152](https://github.com/kbitz/gstack-extend/pull/152) (commit `45a60d1`); verified land-time Track 25A, original Group 25. Introduced as Track 24C on 2026-10-08 in `5b6e516`, relabeled 24B on 2026-10-17 (`8f79dd2`) and 25A on 2026-10-20 (`edc5df5`).
- HOLD SCOPE approved plan plus in-session decisions D1–D7: `/roadmap` Step 4 names the release-history destination, preserves every `## Acceptance` byte in either table ordering, stops on a missing or ambiguous destination and checks the delegated append against a baseline; a protocol lock pins the rules. `tests/helpers/touchfiles.ts` was an intentional fourth file. The user deferred an executable Acceptance-byte guard, heading convergence and listed edge cases (D01, D02, D5/D6, D07). Installed-agent proof was carried by Track 26B.

## Individual Track history

### Track 26A: Version provenance for both hosts and stable releases ✓ Shipped (v0.37.0.0)
- 2026-10-21: merged [PR #155](https://github.com/kbitz/gstack-extend/pull/155) (commit `cffe446`); verified land-time Track 26A, original Group 26. Introduced as Track 25A on 2026-10-08 in `5b6e516`, relabeled 24A on 2026-10-17 (`8f79dd2`) and 26A on 2026-10-20 (`edc5df5`).
- 29 VERIFIED (28 approved plan items plus approved runner exception R1): stage-runs schema v2 with `workspace_host` and `host_agent_id` from explicit Paseo/Conductor markers (default and custom roots in fixtures), a three- or four-part `producer_version`, saved-row retry and reserved `blocked`/`requested` vocabulary. The user explicitly deferred three items: installed Paseo/Conductor host acceptance (DFR1, retained in Tracks 30B and 30C), the full updater, tagging and three-part transition (DFR2, retained in Tracks 28A and 30C) and the release owner's reader-compatibility check and schema publication (DFR3, scheduled in Track 28A by the 2026-10-23 regeneration). No acceptance checkpoint is awarded.

## Individual Track history

### Track 26B: Qualify installed planning and adoption behavior ✓ Shipped (v0.40.0.1)
- 2026-10-22: merged [PR #159](https://github.com/kbitz/gstack-extend/pull/159) (commit `e1b9605`); verified land-time Track 26B, original Group 26. Introduced as Track 25B on 2026-10-08 in `5b6e516`, relabeled 26B on 2026-10-20 (`edc5df5`).
- `docs/acceptance/planning.md` records 27 operator-executed rows (the 18 recovered PR #126 roadmap cases, TM1–TM7 and PS1–PS2), all passed with no blocking hold. On 2026-10-22 the owner replaced the human comprehension, effort and timing checkpoints with an independent adversarial technical review (DX8, DX9, E5, TM7, PS1 and PS2 deferred by the user); those human measurements stay unmeasured. PR #159 awarded no O2 acceptance; the owner accepted O2 separately on 2026-10-23 (PROGRESS `## Acceptance`).

## Individual Track history
_tombstone: 24, 25, 26_

- 2026-10-23: every original Group 24 (24A), Group 25 (25A) and Group 26 (26A, 26B) Track has an individual landed receipt; no active pin is declared. Prefixes 24, 25 and 26 are retired. Owner acceptance obligations stay with their named qualification work.

## Individual Track history
_tombstone: 28_

### Track 28A: Verify the three-part release and upgrade transition ✓ Shipped (v0.47.0.0)
- 2026-10-24: merged PR #168, commit `36546193f1957bd4c58e563ad09f607b3b154e35`; verified land-time Track 28A, Group 28. Introduced as the release-compatibility Track in the 2026-10-08 spec adoption (`5b6e516`), relabeled 28A in the 2026-10-23 regeneration (`f02bc51`).
- Approved candidate-only scope: legacy upgrade/migration/rollback, version and tag controls, stable-surface v2 reader check and policy instructions. The prepared receipt covers T1–T8, AC1–AC3 and U1/U2 (13 VERIFIED), corroborated by merged code and `docs/acceptance/release-compatibility.md`. The source record distinguishes isolated candidate/fixture proof from live publication and host acceptance.
- The owner confirmed the policy during shipping. The final full-suite run timed out under load and the owner directed the merge, as the merge commit records; this receipt does not relabel that run as passed. The published three-part upgrade, full O5.1 catalog and O1/O3/O4 host acceptance remain scheduled. O5 is not awarded. Historical version/tag records stay intact.

## Individual Track history
_tombstone: 29_

### Track 29A: Check installed upstream contracts at launch ✓ Shipped (v0.49.0)
- 2026-10-25: merged [PR #171](https://github.com/kbitz/gstack-extend/pull/171) (commit `02ecf9d`); verified land-time Track 29A, Group 29. Introduced under this ID in the 2026-10-25 efficiency-program regeneration (`3cd166c`) and unchanged through `18abba7`; declared In Progress by the owner on 2026-10-25.
- The preparation receipt reconciled 58 rows of the approved plan with no deferred scope: 56 VERIFIED and 2 PARTIAL, both waiting only on the head-policy pregate run, which the ship record shows ran (`--policy-from head`, `gstack-pregate verify` ok). `bin/upstream-check` reports OK/DRIFT for wrapper anchors, helper exports, classifier goldens and lean criteria with a documented exit table, a measured startup profile and the 120-minute lease limit (`docs/upstream-check.md`). Final full suite on the release head: 4220 passed, 0 failed. The check is advisory and caller-run; no skill invokes it yet.

## Individual Track history
_tombstone: 30_

### Track 30A: Repair a test-only final-gate failure without capping the review ✓ Shipped (v0.50.0)
- 2026-10-26: merged [PR #172](https://github.com/kbitz/gstack-extend/pull/172) (commit `669ce6b`); verified land-time Track 30A, Group 30. Introduced under this ID on 2026-10-25 (`18abba7`); no later relabel before landing.
- The preparation receipt's completion matrix reports 39/39 VERIFIED, 0 deferred by the user. The repair ships behind `final-gate-repair=tests-docs` on the `Review policy:` line (the light default does not enable it), with the older-producer fallback documented; cycle 1 records the full-review baseline the repair-only continuation guard reads, and `/ship-and-land` still refuses a stopped draft. Final full suite: 4252 passed, 0 failed. Installed-agent behavior and public-default evidence were excluded from scope and are not claimed.

## Individual Track history
_tombstone: 31, 32_

### Track 31A: Record truthful timing and isolate synthetic metrics ✓ Shipped (v0.51.0)
- 2026-10-26: merged [PR #174](https://github.com/kbitz/gstack-extend/pull/174) (commit `9d0c8dc`); verified land-time Track 31A, Group 31. Introduced under this ID and title in the 2026-10-25 efficiency-program regeneration (`3cd166c`); declared In Progress by the owner on 2026-10-26 with no relabel before landing.
- The preparation receipt's completion matrix reports 59 rows: 54 VERIFIED and 5 DEFERRED BY USER (owner, 2026-10-26). Wrapper span helpers, truthful read projection (untimed work reads as unknown, never a false zero), isolated examples and the real-store test guard shipped. The deferred rows are installed-wrapper span timing (AC1), the remaining host check (C10), live timestamp extraction (D9) and voice-dispatch timing (E11), all revisited on the first real wrapper runs after the release, plus AC4: the fixture-shaped writer was traced to production wrappers with no synthetic writer, and the ID-shape path is mitigated by a drift-locked rule that the same post-release check validates; the card's unresolved-writer clause is therefore not open. They remain in Future ("Track 31A installed-wrapper follow-up"). Final full suite: 4301 passed, 8 skipped, 0 failed; no CI ran on the head. The final outside voice stayed uncredited and the documentation audit stayed partial under the owner's recorded exception, so no installed-host or 1.0 acceptance is claimed.

### Track 32A: Record a usable full-review baseline when cycle 1 reproduced defects ✓ Shipped (v0.51.1)
- 2026-10-26: merged [PR #176](https://github.com/kbitz/gstack-extend/pull/176) (commit `2280a01`); verified land-time Track 32A, Group 32. Introduced under this title in the 2026-10-26 regeneration (`69d5ca5`); no relabel before landing.
- The completion matrix reports every row VERIFIED (AC1–AC5, D01–D25 and V01, no deferred scope): a full cycle 1 whose reviewers all completed and whose probes ran to a result keeps a usable baseline once a later in-cap delta reviews the fixes, a genuinely incomplete cycle 1 still holds repair-only, and the author, tree, count and anchor guards are unchanged. Final full suite on the release head: 4306 passed, 8 skipped, 0 failed. The ten follow-ups the approved plan left out of scope are in Future ("Reproduced-defect baseline follow-ups"). Static locks do not prove an installed agent executing the protocol; no such claim is made.

### Track 32B: Keep /implement on targeted checks inside its turn, with explicit handoff counts ✓ Shipped (v0.52.0)
- 2026-10-27T03:12Z (released as 0.52.0, dated 2026-10-26): merged [PR #177](https://github.com/kbitz/gstack-extend/pull/177) (commit `b448e2e`); verified land-time Track 32B, Group 32. Introduced as the `/implement` Track in the 2026-10-25 scheduling (`18abba7`) and retitled with the owner-approved `/implement` edits in the 2026-10-26 regeneration (`69d5ca5`); same label throughout.
- All seven Track 32B items and AC1–AC5 are VERIFIED in the preparation matrix; 0 deferred, 0 blocked. `/implement` waits for its own targeted check inside the turn and treats the plan's verify command as a selection, and every successful handoff prints `DEFERRED BY USER <n>` and `BLOCKED <n>`, zeros included. The release also graduated `/autoplan-lean`, `/docs-ship` and `/gstack-extend-init` from beta (owner decision, 2026-10-26), which supersedes the Future item that waited on a first measured `/autoplan-lean` run. Final full suite: 4367 passed, 8 skipped, 0 failed. Live Claude and Codex adoption is post-release observation under the accepted d38 decision; no installed-host acceptance is claimed.

## Individual Track history
_tombstone: 47_

### Track 47A: Let /docs-ship merge on the user's explicit word ✓ Shipped (v0.53.0)
- 2026-10-30: merged [PR #180](https://github.com/kbitz/gstack-extend/pull/180) (commit `769d306`, 23:59Z); verified land-time Track 47A, Group 47. Introduced under this ID and title in the 2026-10-30 efficiency-review order (`7064724`), the PR's reviewed base. An unrelated earlier card held the label 47A in the 2026-10-26 regeneration (`69d5ca5`) and was relabeled before `7064724`; this receipt is not about it.
- The preparation receipt's completion matrix reports 14/14 VERIFIED and 0 deferred: the twelve plan rows plus two owner amendments (a merged outcome requires the observed PR head to equal the approved head; only an unconditional answer for the stated PR, head and method counts). At `PASS` the skill asks once and runs the pinned `gh pr merge … --match-head-commit` only on that answer; with no way to ask it stops with the merge command as before, and the `docs-ship/v1` line keeps its bytes with the outcome on a separate line. `EVALS_ALL=1 bun run test` passed once on the release head. No live merge was attempted in review and no installed-host acceptance is claimed.

## Individual Track history
_tombstone: 48_

### Track 48A: Add the external full-suite gate and lean parent reads to the review policy ✓ Shipped (v0.54.0)
- 2026-10-31: merged [PR #181](https://github.com/kbitz/gstack-extend/pull/181) (commit `0a3a562`, 04:53Z); verified land-time Track 48A, Group 48. Introduced under this ID and title in the 2026-10-30 efficiency-review order (`7064724`); an unrelated earlier card held the label 48A before that regeneration.
- The preparation receipt's completion matrix reports 17/17 VERIFIED and 0 deferred (ten criteria, seven tasks). `Review policy:` gains `full-suite=external` (an `External gate: external-gate/v1` pause line and an `External gate result:` resume line, accepted only from the invocation prompt, with head and tree compared to the live checkout) and `parent-io=lean`; a pass is recorded as caller-attested, not observed, and `/ship-and-land` is unchanged. The review used its one owner-authorized repair-only continuation; the owner accepted the final outside challenge's parse failure for readiness (the record stays uncredited and `unverified`) and three advisory findings stayed as known issues. The costs of the pause and the colder resume are recorded as unknown in `docs/acceptance/external-gate.md`, and no saving is claimed. `EVALS_ALL=1 bun run test` passed once on the release head.

## Individual Track history

- 2026-10-31: not a Track. [PR #182](https://github.com/kbitz/gstack-extend/pull/182) (commit `778a265`, 11:50Z), released as v0.54.1: a complete outside-review response that labels a finding with a qualified severity such as `[P3, advisory]` is read at that severity instead of failing the severity parser and blocking with `GATE: MISSING COVERAGE`. A label that could name two severities (`[P1, P2]`, a qualifier holding a standalone severity word) and quoted forms stay unread. The preparation receipt reports 9/9 items VERIFIED; `EVALS_ALL=1 bun run test` passed once on the release head. It carried no Track ID and consumed no number.

## Individual Track history
_tombstone: 33_

### Track 33A: Reopen review only for behavior-changing repairs ✓ Shipped (v0.55.0)
- 2026-10-31: merged [PR #183](https://github.com/kbitz/gstack-extend/pull/183) (commit `a74abf4`, 16:09Z); verified land-time Track 33A, Group 33. Introduced under this ID and title in the 2026-10-26 regeneration (`69d5ca5`); the label had held a different card (now the paused and resumed telemetry Track) before that, and the classify-severity-once task joined on 2026-10-30 (`7064724`).
- The preparation receipt's completion matrix reports 17 rows: 15 VERIFIED and 2 DEFERRED BY USER (owner), 0 missing, partial or unverifiable. Two opt-in `Review policy:` values shipped: `repair-review=behavior-changing` (a repair that changes no behavior opens no further review cycle, an unclassifiable repair counts as behavior-changing, each batch is classified once with upstream's severity labels unchanged, and the value is inactive unless the installed `/review` Fix-First text matches byte for byte) and `repair-cycles=light`, which the approved plan added as a second, independent value (a delta repair cycle makes no outside call and skips the Red Team); the card text did not name it. The upstream drift inventory gained the Fix-First anchors, and `docs/acceptance/review-fix-policy.md` records the "before" sample. The review reached its three-cycle cap and used its one owner-authorized repair-only continuation.
- The two deferred rows: the "after" cycle-count and wall-time measurement, deferred by the owner to the first opted-in run after the release installs (`docs/acceptance/review-fix-policy.md` carries those fields as unknown and says how to fill them), and copying the release notes' exact value words and `grep -F` checks at ship, which the 0.55.0 changelog entry now carries. Static, fixture and installed-anchor checks do not show installed-agent behavior, and no saving is claimed. `EVALS_ALL=1 bun run test` passed once on the release head.

## Individual Track history
_tombstone: 49_

### Track 49A: Follow the state root, shrink the telemetry blocks and add one stage-handoff line ✓ Shipped (v0.56.0)
- 2026-10-31: merged [PR #184](https://github.com/kbitz/gstack-extend/pull/184) (commit `8771bf6`, 23:06Z); verified land-time Track 49A, Group 49. Introduced under this ID and title in the 2026-10-30 efficiency-review order (`7064724`); an unrelated earlier card held the label 49A before that regeneration.
- The preparation receipt's completion matrix reports 24/24 VERIFIED and 0 deferred. The five stage skills, `/full-review`, `/pair-review`, `/roadmap` and `bin/lib/session-paths.sh` resolve state paths with `${GSTACK_STATE_ROOT:-${GSTACK_HOME:-$HOME/.gstack}}`; the start and finish telemetry blocks in the eleven skills then installed became one call to the `telemetry-call` helper that `setup` installs (1,612 bytes saved per skill, `/plan-card` made twelve in v0.57.0); and `/autoplan-lean`, `/implement` and `/review-and-prep` end with a `stage-handoff/v1` line after their handoff, additive to the existing grammars. `EVALS_ALL=1 bun run test` passed once on the release head.
- Precedent for the single final line: `docs-ship/v1`, named in `docs/docs-ship.md` and `skills/docs-ship.md`, and `review-and-prep/v1`, in `docs/workflow-handoffs.md`. The card's source line cited `docs/workflow-handoffs.md` for both; `docs-ship/v1` is not defined there, and the owner accepted the correction.

## Individual Track history
_tombstone: 50_

### Track 50A: Add the /plan-card skill beside /autoplan-lean ✓ Shipped (v0.57.0)
- 2026-10-31 (merged 2026-11-01T01:32Z, released as v0.57.0 dated 2026-10-31): merged [PR #185](https://github.com/kbitz/gstack-extend/pull/185) (commit `55b48df`); verified land-time Track 50A, Group 50. Introduced under this ID in the 2026-10-30 efficiency-review order (`7064724`) as "Add a plan-prompt skill beside /autoplan-lean"; the name was settled at planning as `/plan-card`.
- The preparation receipt's completion matrix reports 15/15 VERIFIED and 0 deferred. `/plan-card` turns one approved card into a plan for `/implement` in a single session that works alone (no subagents, outside voices or other model CLI), takes `CARD_FILE`, `PLAN_FILE`, `VERIFY_COMMAND`, `FORK_LIST` and `NOTES` from the invocation prompt, reuses `/autoplan-lean`'s `Verify command:` label and ends with the `stage-handoff/v1` line. `/autoplan-lean` is unchanged and stays the default. It is registered in `setup`, the expected-skills list, the protocol and compliance suites, the README and the routing, and `docs/installation.md` says how to link it into a host `setup` does not manage. The release suite was an external full-suite run attested by the caller (78 files, 4,577 pass, 18 skip, 0 fail) plus an observed pregate selection, and `EVALS_ALL=1 bun run test` passed once on the release head. Its tests check the skill's text only; no installed agent has run it, so plan quality is unproven until first use.

## Individual Track history

- 2026-11-01: not a Track. [PR #187](https://github.com/kbitz/gstack-extend/pull/187) (commit `f3ed03a`, 05:39Z), released as v0.58.0: the skill `/plan-card` became `/plan-track`, the roadmap's word for one PR of work. A skill name is a stable surface, so the CHANGELOG marks the change incompatible: a caller that launches `/plan-card` by name must change. The skill's behavior is unchanged, and so are its inputs (`CARD_FILE` included), its `Verify command:` label and its `stage: plan` line; the fallback plan directory is now `~/scratch/gstack-plan-track/` and its telemetry rows use `extend:plan-track`. `setup` installs `plan-track` and removes a `plan-card` install this checkout owns. It carried no Track ID and consumed no number. The receipt for Track 50A above is frozen and keeps the original name.

## Individual Track history
_tombstone: 51_

### Track 51A: Record unproven test gaps for the next Track that touches them ✓ Shipped (v0.59.0)
- 2026-11-01: merged [PR #188](https://github.com/kbitz/gstack-extend/pull/188) (commit `9df3833`, 18:41Z); verified land-time Track 51A, Group 51. Introduced as a task of the review-fix policy card in `282a612`, split out as its own Track 34A in `69d5ca5` (2026-10-26) under the card-size rule, and relabelled 51A in `3ca8859` (2026-10-31).
- The preparation receipt's completion matrix reports 28 rows: 27 VERIFIED and 1 DEFERRED BY USER (owner), 0 partial, missing or unverifiable. The deferred row is the criterion-7 "after" count, the cycle counts of a real opted-in run, which the owner deferred to the first opted-in run after the release; `docs/acceptance/review-fix-policy.md` carries the before sample and the after fields as unknown, and no caller sets the value yet. `Review policy:` gains `test-gaps=record`: a test-gap finding with no demonstrated defect keeps its upstream severity and is recorded in TODOS as `[review:files=…]` for the next Track that touches those files instead of getting a test written, a reproduced defect still gets its regression test, and the coverage audit follows the same rule. `/roadmap` places a recorded gap as one small task on the first Track whose `_touches:` cover its files, or defers it to Future with a trigger. Seventeen new checks join `bin/upstream-check` (45 in all), and the value is inactive, with `test-gaps: inactive` in the receipt, whenever the installed text drifts.
- Files beyond its `_touches:`: `docs/source-tag-contract.md`, `docs/upstream-check.md`, `skills/roadmap.md`, `tests/audit-compliance.test.ts` and `tests/skill-protocols-roadmap.test.ts`, the five the owner accepted at review for this regeneration to record, plus `tests/docs-ship.test.ts`, changed by a test-only final-gate repair that separated 26 independent docs-ship fixtures (the review had not listed it).
- Kept as a separate card from Track 33A on purpose despite the shared files and serial order (owner direction, 2026-10-26): it adds a second review behavior, test-gap routing, that is activated and measured separately on the grammar 33A defined. Static, fixture and installed-anchor checks do not show installed-agent behavior, and no saving is claimed.

## Individual Track history

- 2026-11-01: not a Track. [PR #189](https://github.com/kbitz/gstack-extend/pull/189) (commit `18266f8`, 21:48Z), released as v0.60.0: under `full-suite=external`, after an accepted pass for the final head and tree, `/review-and-prep` runs the pregate's six preflight checks alone (ledger label `pregate-preflight`) when the attested command covers every test the diff selects and its log shows tests ran. Anything less runs the pregate as before and the receipt says why (partial or unknown coverage, an unmapped file, a remote obligation, head policy, a pending final-gate repair, or changed upstream text); narrowing is all-or-nothing because the installed pregate has no per-lane run. There is no new policy key or value. The receipt adds `pregate-narrowing:` and one `Pregate lane not run:` line per lane, `bin/upstream-check` tracks nine more anchors (55 checks), and an attested pass still never becomes a `tests` ledger record, so `/ship-and-land`'s test gate is unchanged and a narrowed head takes its `FULL` path. The preparation receipt's scope matrix covered every item of its approved plan with no scope decision left open. It was never a roadmap card, so there is no `_touches:` to compare; its files include `docs/acceptance/external-gate.md`, `docs/secret-dispositions.md` and `README.md` besides the skill, the upstream-check code, the handoff contract and their tests. The "after" wall times in `docs/acceptance/external-gate.md` stay unknown until a real opted-in run, and no saving is claimed. It carried no Track ID and consumed no number; this regeneration (2026-11-01) is where the roadmap first records it and corrects the 35B and E3 wording it contradicted.

## Individual Track history
_tombstone: 52_

### Track 52A: Narrow the remaining broad skill-test readers ✓ Shipped (v0.60.1)
- 2026-11-02 (merged 11:37Z, released as v0.60.1 dated 2026-11-01): merged [PR #191](https://github.com/kbitz/gstack-extend/pull/191) (commit `e0781e1`); verified land-time Track 52A, Group 52. Introduced 2026-10-25 as Track 30A (`3cd166c`), relabelled 32A (`282a612`), 35A (`69d5ca5`, 2026-10-26) and 52A (`3ca8859`, 2026-10-31).
- The preparation receipt's completion matrix reports 20/20 VERIFIED (criteria C1–C9, tasks T1–T8 and the owner-approved base-policy amendment A1–A3) and 0 deferred. The rules in `tests/setup-hosts.test.ts` and `tests/telemetry.test.ts` that read real skill text moved, with their assertions unchanged, to the new `tests/skill-content.test.ts` (19 tests), which every skill edit selects. `tests/setup-hosts.test.ts` no longer runs for a skill edit, and `tests/telemetry.test.ts` runs only for `skills/full-review.md`, the canonical source of the telemetry blocks. `docs/acceptance/skill-test-selection.md` records one sample per cell on a shared machine: an edit to `skills/roadmap.md` went from 583.6 s to 143.7 s under `bun run test` and from 601.9 s to 156.1 s under the pregate, and an edit to `skills/review-and-prep.md` from 561.8 s to 126.1 s and from 547.4 s to 119.0 s. The review's external full-suite run, a narrowed pregate's preflight-only run and the release's single `EVALS_ALL=1 bun run test` are unchanged, so no pipeline saving is claimed. The amendment states the `--policy-from head` exception: a PR that removes or renames a pregate lane, or drops a test edge from one, runs on the base policy and records the reason, the lane-gap probe and `gstack-pregate validate`, which fulfils the Future entry that asked for it.
- Files beyond its `_touches:`: `skills/review-and-prep.md` and `tests/skill-protocols-review-and-prep.test.ts`, for the owner-approved exception, and `README.md`, for a link.
- Correction to the card: its Scheduling line said selection also shortens `/docs-ship`'s selected tests. It does not. `/docs-ship` selects tests by their text naming a changed path (`src/docs-ship/pinning.ts`, header comment) and stops on `skills/` by default (`src/docs-ship/classify.ts`, header comment), and `/implement` writes its own targeted command. The owner agreed (2026-11-03).

## Individual Track history
_tombstone: 64_

### Track 64A: Accept upstream's whole-file secret finding locations ✓ Shipped (v0.60.2)
- 2026-11-02: merged [PR #192](https://github.com/kbitz/gstack-extend/pull/192) (commit `018b526`, 15:33Z); verified land-time Track 64A. It was never on the roadmap; its number was assigned when it was launched. It was released by hand because its card's `_release:` line lacked the SPEC mapping.
- The preparation receipt's completion matrix reports 15/15 VERIFIED (AC1–AC9 and the plan's tasks) and 0 deferred. `bin/secret-dispositions` accepts the `line N` location that installed gstack's secrets check writes for a Python or Dart file it reads whole, only when N is one of the file's added lines and the source line matches exactly; `added line N` keeps its meaning for every other file, HIGH findings stay unapprovable and the disposition format is unchanged. `upstream-check` gains two advisory anchors on the rendered location grammar (`secret-dispositions.location.1` and `.2`, qualified at 1.92.55.0). The receipt recorded the separate `criteria.dx.native` drift as unrelated and left it in place; it is now a Future entry.
- Files beyond its card: `tests/skill-protocols-implement.test.ts`, an owner-approved test cleanup that restores the completion receipt a fixture deletes, so a full run under load no longer fails in cleanup.

### Track 64B: Ask outside reviewers for the no-findings line the validator accepts ✓ Shipped (v0.60.3)
- 2026-11-02: merged [PR #193](https://github.com/kbitz/gstack-extend/pull/193) (commit `2221f8b`, 19:28Z); verified land-time Track 64B. Numbered at launch like 64A; it fulfils the Future entry "Align the outside-review prompt's no-findings wording with the validator's" (filed 2026-10-30, `7064724`).
- The preparation receipt's matrix reports 10/10 VERIFIED (criteria C1–C7 and the owner-approved amendment R1–R3) and 0 deferred. `src/outside-review/prompt.ts` now asks a reviewer with no findings to write `NO_FINDINGS: none` immediately before the `Recommendation:` line, with its reason in the because-clause; the recovery, classifier and skill gate rules are unchanged, and `docs/outside-review.md` states the line. Tests cover both review gates, the installed classifier and the reply shape that was rejected before.
- Files beyond its card: `tests/telemetry.test.ts`, two owner-approved test time budgets (120 s for a cleanup and 30 s for one named fallback case) with every assertion kept. Reviewers can still omit the line; that is a Future entry.

## Individual Track history
_tombstone: 57_

### Track 57A: Attribute every logged review finding to the part that found it ✓ Shipped (v0.61.0)
- 2026-11-03 (merged 00:36Z, released as v0.61.0 dated 2026-11-02): merged [PR #194](https://github.com/kbitz/gstack-extend/pull/194) (commit `d2be65f`); verified land-time Track 57A, Group 57. Introduced 2026-10-25 as Track 37A (`18abba7`), relabelled 38A (`282a612`), 41A (`69d5ca5`, 2026-10-26), 40A (`fd2e241`) and 57A (`3ca8859`, 2026-10-31). It ran ahead of the bounded-audit Track under the owner's 2026-11-02 order.
- The preparation receipt's completion matrix reports 18/18 VERIFIED and 0 deferred. Workflow metrics gain v2 `pass` findings that keep every review part that reported each finding, merged findings included, with explicit reasons when a source is missing, and the read reports per-part and unattributed totals. The owner's amendment added the `core`, `qa` and `greptile` labels; the proposed cap of 16 distinct parts became 24 to leave headroom, and above 24 `by_part` reads null with reason `too-many-parts`. Other operations and earlier rows stay v1 and readable. The labels are agent-written and grammar-checked; no installed-agent behavior is claimed. All six files are on its `_touches:`.

## Individual Track history

### Track 64C: Let a caller delegate review parts to configured commands ✓ Shipped (v0.62.0)
- 2026-11-03: merged [PR #195](https://github.com/kbitz/gstack-extend/pull/195) (commit `f7f13e7`, 05:29Z); verified land-time Track 64C. Numbered at launch like 64A, as one of the two measured arms of the owner's 2026-11-02 order; the owner approved its plan, a criterion 3 amendment and five forks.
- The preparation receipt's completion matrix reports 19/19 VERIFIED (criteria C1–C11, tasks T1–T8) and 0 deferred. A `Review policy:` value, `delegate=`, sends the testing, maintainability, performance and simplification review parts to commands named in a caller's configuration file through the new `bin/review-delegate`; it delegates nothing by default. A failed or uncredited call falls back to the host, a reply counts only when it matches the complete reply contract, and workflow metrics record delegated reviews with their token reporting. The value is active only while 16 `upstream-check` anchors match, and it works on both installed layouts, the nested and the sibling. `docs/delegated-review.md` documents it. Tests use fixtures and fake installs; no live delegate compliance and no saving is claimed, and the measured run stays outside the Track.

## Individual Track history
_tombstone: 58_

### Track 58A: Offer an opt-in first review cycle that folds specialist checklists into the main pass ✓ Shipped (v0.63.0)
- 2026-11-03: merged [PR #196](https://github.com/kbitz/gstack-extend/pull/196) (commit `cac8b93`, 21:07Z); verified land-time Track 58A, Group 58. Introduced 2026-10-25 as Track 38A (`18abba7`), relabelled 39A (`282a612`), 42A (`69d5ca5`, 2026-10-26), 41A (`fd2e241`) and 58A (`3ca8859`, 2026-10-31). It ran ahead of the bounded-audit Track under the owner's 2026-11-02 order, as the second measured arm.
- The preparation receipt's completion matrix reports 31/31 VERIFIED, and 35/35 with the repair rows, and 0 deferred. `specialists=fold` runs the original full-scope cycle 1 with the specialist checklists applied in the main pass instead of dispatched; Red Team (on the size arm or a CRITICAL finding), the native adversarial pass and the outside voices are unchanged, and later cycles and continuations run as before. It refuses to combine with `delegate=`, the receipt names the arm, the checklists read and their hashes, and `upstream-check` gains thirteen anchored checks plus an inventory check on both installed layouts. `docs/acceptance/review-fold.md` defines the caller-owned matched-head comparison; no spend, saving, quality or default change is claimed.
- Files beyond its `_touches:`, all named by its approved plan: `docs/delegated-review.md`, `docs/upstream-check.md`, `docs/designs/workflow-efficiency-program.md` (a factual correction to item E12), `tests/handoff-contract.test.ts` and `tests/fixtures/handoffs/cases.json`. The owner approved a 30 s cleanup timeout in `tests/upstream-check.test.ts`, replacing an earlier 10 s approval. One outside repair-review reply concluded with no findings but omitted the tagged line, and the owner accepted it by exception; the gap is a Future entry.

## Individual Track history
_tombstone: 65_

### Track 65C: Requalify the upstream anchors against installed gstack 1.94.39.0 ✓ Shipped (v0.63.1)
- 2026-11-03: merged [PR #198](https://github.com/kbitz/gstack-extend/pull/198) (commit `3b3cf73`, 23:50Z); verified land-time Track 65C. It was never on the roadmap: it was added inside Group 65 when it was launched.
- The preparation receipt's completion matrix reports 14/14 VERIFIED (criteria C1–C8, tasks T1–T6) and no user deferrals. The pregate-narrowing anchors in `skills/review-and-prep.md` and the dx criteria copy in `src/autoplan-lean/criteria.ts` were requalified against installed gstack 1.94.39.0, with positive and negative cases for every changed anchor; both installed layouts then reported only the two documented drifts (`RESULT drift checks=88 drift=2`). On the owner's word ("1"), the `delegate=` and `specialists=fold` anchors (`review-and-prep.delegate.review.1` and `.fold.review.1`) were left unqualified, because upstream `/review`'s "Done means" contract requires one Agent dispatch per selected specialist, which delegation replaces and the fold removes; both values stay off on that install. `docs/upstream-check.md` ("Anchors left unqualified") records why, and the Future entry this Track narrowed is replaced in this regeneration (2026-11-04) by "Reconcile `delegate=` and `specialists=fold` with upstream /review's specialist-dispatch contract".
- Its files: `docs/roadmap-future.md`, `docs/upstream-check.md`, `skills/review-and-prep.md`, `src/autoplan-lean/criteria.ts`, `src/upstream-check/cli.ts`, `tests/skill-protocols-review-and-prep.test.ts` and `tests/upstream-check.test.ts`, plus the release files.

### Track 65A: Record paused, blocked and resumed runs ✓ Shipped (v0.63.2)
- 2026-11-04: merged [PR #199](https://github.com/kbitz/gstack-extend/pull/199) (commit `5088666`, 11:58Z); verified land-time Track 65A (its plan heading still read 53A). Introduced 2026-10-17 as Track 25A (`8f79dd2`), relabelled 27A (`edc5df5`, 2026-10-20), 31A (`3cd166c`, 2026-10-25), 33A (`18abba7`, 2026-10-25), 36A (`69d5ca5`, 2026-10-26, where the update check split off as its own card under the card-size rule), 53A (`3ca8859`, 2026-10-31) and 65A (`be8f724`, 2026-11-03).
- The preparation receipt's completion matrix reports 18/18 VERIFIED (C1–C9, T1–T7, TC and the owner's scope decision D1) and 0 deferred. A deliberate pause in `/review-and-prep`, `/pair-review` or `/full-review` now finishes its telemetry segment `blocked`, and each resume, in whichever checkout it runs, starts and finishes its own segment, so a resume in another worktree records its completion; resumable start-less finishes pair newest first. All twelve skill copies and `docs/telemetry.md` carry the new start/finish wording, the join contract gains "Paused and resumed segments", `/pair-review` and `/full-review` gain a PAUSE route, their status checks finish `unknown`, and legacy, v1 and v2 rows stay readable. `docs/telemetry.md` records how the two Future cards relate: segments cover the resumable cross-checkout case, "Recover a telemetry finish run from a different repository root" keeps only a start-less finish whose own start ran in another root, and "In-flight marker and crash detection for extend telemetry" stays deferred.
- Release level: shipped as a patch although the SPEC release policy makes this a minor, because the item was re-created from its plan without a `_release:` line; the owner accepted v0.63.2 ("1").
- Review: the first invocation stopped at the three-cycle cap, and the owner approved one full continuation (`continuation=full`, 1 of 1), which completed and converged. The owner also approved an out-of-plan schema-vocabulary assertion change in `tests/telemetry-contract.test.ts`.
- Files beyond its `_touches:`: `tests/skill-protocols-full-review.test.ts`, `tests/skill-protocols-pair-review.test.ts` and `tests/skill-protocols-review-and-prep.test.ts`, the per-skill drift-lock suites for the three resumable skills.

### Track 65D: Record gstack-extend's own working rules ✓ Shipped (v0.63.3)
- 2026-11-04: merged [PR #200](https://github.com/kbitz/gstack-extend/pull/200) (commit `fafde12`, 14:26Z); verified land-time Track 65D. It was never on the roadmap: it was added inside Group 65 when it was launched.
- The preparation receipt's completion matrix reports 12/12 VERIFIED (AC1–AC7, T1–T5) and 0 deferred. `CLAUDE.md` gains a Design section (skill prose owns judgment, helpers do mechanics only; every workspace-host rule names both supported hosts), the `/roadmap` reporting rule (each inbox item's filed priority and placement in the proposal Summary and final report, plus a scoped README accuracy check with its own commit and `/docs-ship` handoff), and the load and pregate timeout rules. Its files are `CLAUDE.md` and the shared `docs/TODOS.md`, plus the release files.

### Track 65B: Generate and check pregate dependency maps for Python source-root layouts ✓ Shipped (v0.64.0)
- 2026-11-04: merged [PR #201](https://github.com/kbitz/gstack-extend/pull/201) (commit `cf85d31`, 18:08Z); verified land-time Track 65B. Introduced 2026-10-26 as Track 36B (`69d5ca5`), relabelled 53B (`3ca8859`, 2026-10-31) and 65B (`be8f724`, 2026-11-03). Started on the owner's "Yes go" (2026-11-04).
- The preparation receipt's completion matrix reports 18/18 VERIFIED (AC1–AC10, T1–T8) and 0 deferred, including the owner's `--prune` amendment: the helper refuses every removal of an existing entry unless `--prune` is given. `bin/pregate-deps` (`src/pregate-deps/`, documented in `docs/pregate-deps.md`) scans a repository's Python imports and writes or checks `.gstack/pregate.json` `dependencies` entries for modules under `src/` or repeatable `--root` directories, keeping hand-written entries and every other key; check mode changes nothing and exits nonzero on stale or missing entries. An independent probe against the installed upstream pregate confirmed the generated declarations select the same tests as a root-layout import graph, on a synthetic fixture only. Nothing runs automatically and upstream pregate is neither forked nor wrapped.
- Files beyond its `_touches:`: `README.md` and `docs/installation.md`, which its documentation audit updated for discoverability. Its review recorded ten test gaps under `test-gaps=record`; this regeneration routes them to Future.

## Individual Track history
_tombstone: 66_

### Track 66A: Check for gstack-extend updates in every skill, never upgrading from a spawned session ✓ Shipped (v0.65.0)
- 2026-11-04: merged [PR #202](https://github.com/kbitz/gstack-extend/pull/202) (commit `9e441fe`, 22:41Z); verified land-time Track 66A. Introduced 2026-10-26 as Track 37A (`69d5ca5`), split from the paused/resumed card under the card-size rule, relabelled 54A (`3ca8859`, 2026-10-31) and 66A (`be8f724`, 2026-11-03). Approved under the owner's "Merge when ready and keep going" (2026-11-04).
- The preparation receipt's completion matrix reports 15/15 VERIFIED (AC1–AC7, T1–T7 and the allowed test changes, amended by the owner) and 0 deferred. All twelve installed skills run `bin/update-check` at start with the shared upgrade flow byte for byte; the flow's spawned branch, chosen when `GSTACK_SESSION_KIND` is `spawned` or `unattended`, asks nothing, never runs `bin/update-run` (even under `auto_upgrade=true`), writes no snooze or config state and names the available version in the final message. Interactive behavior is unchanged, `docs/installation.md` gains "Update checks", and `PREAMBLE_SKILLS` covers all twelve skills with spawned, unattended and interactive cases.
- Release notes: corrected after merge by docs [PR #203](https://github.com/kbitz/gstack-extend/pull/203) (commit `a2a0605`, 23:12Z; `CHANGELOG.md` only, no version bump, on the owner's decision) to disclose that a caller launching stages without a person and without `GSTACK_SESSION_KIND` now meets the interactive branch in eight more stages; the GitHub release text was updated to match. PR #203 carried no Track ID and consumed no number.
- Files beyond its card: `CLAUDE.md`, the owner-approved cohort sentence (criterion AC7 of its plan), and `tests/docs-ship.test.ts`, whose 260-line cap now counts `/docs-ship`'s own text without the byte-locked shared block (owner-directed during review; the owner kept it). `tests/helpers/extend-root.ts`, `tests/skill-protocols-plan-track.test.ts` and `tests/update.test.ts` were named in its plan's allowed test changes.

### Track 66B: Record a caller-requested model where detection finds none ✓ Shipped (v0.66.0)
- 2026-11-05 (merged 01:53Z, released as v0.66.0 dated 2026-11-04): merged [PR #204](https://github.com/kbitz/gstack-extend/pull/204) (commit `d8d8848`); verified land-time Track 66B. Introduced 2026-10-17 as Track 27A (`8f79dd2`), relabelled 29A (`edc5df5`, 2026-10-20), 32A (`3cd166c`, 2026-10-25), 34A (`18abba7`, 2026-10-25), 37B (`69d5ca5`, 2026-10-26), 54B (`3ca8859`, 2026-10-31) and 66B (`be8f724`, 2026-11-03). Started on the owner's "Yes and then start 66b" (2026-11-04).
- The preparation receipt's completion matrix reports 12/12 VERIFIED (AC1–AC7, T1–T5) and 0 deferred. `GSTACK_EXTEND_MODEL` and `GSTACK_EXTEND_EFFORT` fill only a null detected value and carry the `requested` source label, never `detected`; detection and finish flags still win, a `cursor-agent` fixture covers the CLI route, invalid values stay null, and `docs/telemetry.md` and `docs/stage-runs.schema.json` document both variables. All files are on its `_touches:`. A documented side effect, `quota runs` filling a missing model from the stage-runs row without its label, is a Future entry.
- Correction to the card: its Supports line said every local `cursor-agent` row ("29 ship-and-land rows, releases 0.34.2.0 to 0.36.8.0") had model null. The local ledger held 116 `cursor-agent` rows on 2026-11-04; the owner agreed to the correction.

## Individual Track history
_tombstone: 67_

### Track 67A: Record each run's token usage, parent and child, from the harness's own logs ✓ Shipped (v0.67.0)
- 2026-11-05: merged [PR #206](https://github.com/kbitz/gstack-extend/pull/206) (commit `51ecfdb`, 22:19Z); verified land-time Track 67A. Introduced 2026-10-26 as Track 38A (`fd2e241`), the merged card for run usage and child and outside-reviewer attribution under the card-size rule's same-files exception, relabelled 55A (`3ca8859`, 2026-10-31) and 67A (`be8f724`, 2026-11-03). The owner started it during the Linux-move window: "let's just keep going, it's going to take all day for […] to finish, so just start on the next thing" (2026-11-05).
- The preparation receipt's completion matrix reports 19/19 VERIFIED (AC1–AC12, T1–T7) and 0 deferred. A finish-time capture reads the run's token usage from the harness's own session logs, reusing the quota parser's record handling, and writes a v2 step-ledger usage record; `metrics read --usage` projects it by workflow, step, pass and model. Usage is graded `direct` (the parent and explicitly linked children), `correlated` (a unique candidate inside a unique outside-call interval, or a checkout with no foreign session) or `unknown` (ambiguous), the three grades are never summed into one exact figure, and incomplete discovery suppresses correlation while keeping observed usage. Unknown values stay null with reasons, legacy, v1 and v2 rows stay readable, and capture makes no credential or network calls. The card's requested-telemetry test gap (66B) is covered. `docs/telemetry.md` and `docs/workflow-metrics.schema.json` document the record. Fixtures only; no installed-agent or live privacy claim.
- Implementation: the implementing session hit a harness "stream idle timeout" after a finished reply and was recovered by an owner-approved cancel and retry on the same model (per the launching brief; not in the PR record).
- Review: the first invocation stopped at the three-cycle cap with its cycle 1 full-review record missing (`Full-review evidence unavailable: record-missing`), so a repair-only continuation could not advance. The owner approved one full continuation, with a prospective cycle 1 record, and after its third repair cycle one extra delta pass, which completed clean. The pregate's secrets lane flagged local `key = (...)` tuples as false positives; an owner-approved rename of those private variables, with identical normalized syntax trees, cleared it.
- Files beyond its `_touches:`: `bin/lib/telemetry_usage.py` (new, the capture), `tests/fixtures/run-usage/` (new, eight synthetic session logs) and `.gstack/pregate.json` (the regenerated dependency copy). Its card listed `bin/lib/quota/usage.py`, `docs/stage-runs.schema.json`, `tests/quota.test.ts` and `tests/fixtures/quota/`, which it did not change. Its review recorded four test gaps under `test-gaps=record`; this regeneration routes them to Future.

## Individual Track history
_tombstone: 68_

### Track 68A: Bound documentation audits by changed contracts ✓ Shipped (v0.68.0)
- 2026-11-06 (merged 04:43Z, released as v0.68.0 dated 2026-11-05): merged [PR #207](https://github.com/kbitz/gstack-extend/pull/207) (commit `8c514a9`); verified land-time Track 68A. Introduced 2026-10-25 as Track 34A (`3cd166c`), relabelled 36A (`18abba7`, 2026-10-25), 40A (`69d5ca5`, 2026-10-26), 39A (`fd2e241`, 2026-10-26), 56A (`3ca8859`, 2026-10-31) and 68A (`be8f724`, 2026-11-03). It came from item E4 of the [efficiency program](designs/workflow-efficiency-program.md).
- The preparation receipt's completion matrix reports 15 VERIFIED and 1 DEFERRED BY USER of 16 rows (AC1–AC8, AC1-h, T1–T7). A `Review policy:` value, `documentation-scope=contracts`, bounds the documentation audit's read list by changed paths, contract terms and linked authorities, with a broad fallback whenever relevance is uncertain, and its one re-audit follows only the fix delta; the attempt bound is unchanged, a bounded `current` covers only the docs it read, and the light review default never sets the value. `/ship-and-land` takes it only from its own invocation. `docs/acceptance/documentation-audit-efficiency.md` records a self-graded static backtest over 7 merged PRs (all 6 known drift files retained, read volume mixed, time and tokens unknown), so the value stays opt-in and today's audit stays the default; no checkpoint or saving is claimed.
- Deferred by the owner ("A"): eight opt-in hardening items (AC1-h) went to one backlog entry that bars enabling `documentation-scope=contracts` until they are fixed; this regeneration moves it to Future as "Harden the bounded documentation audit before enabling it".
- Review: the first invocation stopped at the three-cycle cap. Its cycle 1 record read `pending-fix-review` because a required probe still checked a helper name the section no longer used, so a repair-only continuation could not advance; the owner approved one full continuation ("1"). That continuation's cycle 1 record read `completed=false (reviewer-incomplete)`, because the structured outside voice answered "no actionable defects" on every attempt without the marker its validator requires (`untagged_review`), recorded as missing coverage. The continuation converged.
- Files beyond its `_touches:`: `docs/workflow-handoffs.md`, `src/upstream-check/cli.ts` and `tests/handoff-contract.test.ts`, the key list, rollout paragraph, reference parser and capability-check exemption its criterion AC8 requires to agree.

## Individual Track history
_tombstone: 69_

### Track 69A: Overlap independent first-cycle review work ✓ Shipped (v0.69.0)
- 2026-11-06: merged [PR #210](https://github.com/kbitz/gstack-extend/pull/210) (commit `8eab87f`, 20:48Z); verified land-time Track 69A. Introduced 2026-10-25 as Track 35A (`3cd166c`), relabelled 39A, 40A, 43A, 42A and 59A, and 69A (`be8f724`, 2026-11-03). Declared in flight to the 2026-11-06 regeneration.
- The preparation receipt's completion matrix reports 19 VERIFIED and 0 partial, missing, unverifiable or deferred by user, covering all 10 acceptance criteria and 9 tasks. A `Review policy:` value, `first-cycle=overlap`, lets independent first-cycle reviewers share one frozen snapshot while the outside review pair stays sequential; the default stays sequential, and capacity, dependency or policy conflicts fall back to today's order. `docs/acceptance/review-concurrency.md` defines the paired-run comparison. The owner accepted (2026-11-06) reading the card's activation criteria as post-merge evidence: installed-agent runs are zero and pending, no speed or quality improvement is claimed, and the value stays opt-in until that record supports a default. The O6 evaluation (Track 76A) carries it as a candidate.
- Files beyond its `_touches:`, within its approved nine-file footprint: `docs/upstream-check.md`, `docs/workflow-handoffs.md`, `src/upstream-check/cli.ts`, `tests/handoff-contract.test.ts` and `tests/upstream-check.test.ts`.

### Track 69B: Reconcile `delegate=` and `specialists=fold` with upstream /review's specialist-dispatch contract ✓ Shipped (v0.69.1)
- 2026-11-07 (merged 00:34Z, released as v0.69.1 dated 2026-11-06): merged [PR #211](https://github.com/kbitz/gstack-extend/pull/211) (commit `a3ad477`); verified as the Track the owner promoted from the Future entry of the same title on 2026-11-06. It was never on the roadmap and carried no Track ID; this regeneration numbers it.
- The preparation receipt's completion matrix reports 55/55 VERIFIED (tasks T1–T6 and nine acceptance criteria) and 0 deferred. Delegation and the fold now meet or waive upstream `/review`'s `specialists-dispatched` item and say which in the receipt, the item is anchored so a further upstream change turns both options off, and `docs/upstream-check.md`, `docs/delegated-review.md` and `docs/acceptance/review-fold.md` record the requalified anchors. Its review filed one Future entry (exact item identity) and one recorded test gap (installed-agent waiver runs); this regeneration kills the first under the manifestation gate and routes the second to Future.

### Track 69C: Make the packer's collision judgment precise ✓ Shipped (v0.70.0)
- 2026-11-07 (merged 03:57Z, released as v0.70.0 dated 2026-11-06): merged [PR #212](https://github.com/kbitz/gstack-extend/pull/212) (commit `149e565`). It was never on the roadmap and carried no Track ID; the owner authorized its plan on 2026-11-06, and this regeneration numbers it.
- The preparation receipt's completion matrix reports 18/18 VERIFIED (nine acceptance criteria, tasks T1–T9) and 0 deferred. A path marked `(new)` collides only with the same path or a folder entry itself marked `(new)`; an opt-in `roadmap:shared_docs=` marker in `CLAUDE.md` removes listed docs from scheduling collisions; `bin/roadmap-pack` lists folder-only collisions under `FOLDER_ONLY`; the rule is published as `collision-contract/v1` in `docs/collision-contract.md` with conformance vectors. It also fixed the layout-scaffold flake caused by a transient `/tmp/.git` by rooting that suite under the per-user runtime directory, which the Codex sandbox Track (71E) revisits. Its review filed four backlog items and two recorded test gaps; this regeneration kills the four items under the manifestation gate, places one gap on Track 74B and defers the other.

### Track 69D: Record run modes and per-host usability telemetry ✓ Shipped (v0.71.0)
- 2026-11-07: merged [PR #213](https://github.com/kbitz/gstack-extend/pull/213) (commit `7640a38`, 12:55Z). It was never on the roadmap and carried no Track ID; this regeneration numbers it.
- The preparation receipt's completion matrix covers tasks T1–T8 (41 sub-obligations) and criteria AC1–AC11, all VERIFIED, with an approved consumer-neutral run-mode amendment and zero user deferrals. Stage-runs schema v3 records `run_mode` and its source, question, wait and resume aggregates and a local-only blocked reason; new rows go to per-host ledgers while readers keep legacy files; consumer-neutral orchestration signals (`GSTACK_SESSION_KIND`, `GSTACK_EXTEND_WORK_ITEM`, `GSTACK_EXTEND_RUN_MODE`) take precedence over interactive entrypoints; `gstack-extend-telemetry report` groups skills by run mode. Fixtures only; no real-host acceptance is claimed. It supplies O6.1's run-mode measurement. Its review recorded four test gaps, which this regeneration places on Track 72A.

## Individual Track history
_tombstone: 70_

### Track 70A: Retire /autoplan-lean ✓ Shipped (v0.72.0)
- 2026-11-07: merged [PR #215](https://github.com/kbitz/gstack-extend/pull/215) (commit `1fec2d5`, 16:14Z); verified land-time Track 70A. The owner decided it on 2026-11-07 ("yes, kill autoplan-lean"); it was launched before this regeneration numbered it and was declared in flight to it.
- The preparation receipt's completion matrix reports all 9 acceptance criteria and 26 task and repair obligations VERIFIED, with no deferrals. `/autoplan-lean`, `bin/autoplan-lean` and `src/autoplan-lean/` are removed; `setup` lists `autoplan-lean` among its retired skills, so an upgrade removes the copies it installed on each host and keeps and reports a user-owned or regular file; `/plan-track`, `/implement`, the init template, README, CLAUDE.md and the handoff, telemetry, outside-review and upstream-check docs no longer offer it; `bin/upstream-check` drops its skip-list and criteria checks (107 to 98 checks, other checks, order, exit codes and line grammar kept); shared outside-review, upstream-check, secret-dispositions and telemetry code stays. The release shipped as a 0.x MINOR because a skill name is a stable surface. Its generated CHANGELOG entry understated the breaking change; the owner-approved correction is in the docs PR that records this receipt.
- Files beyond its `_touches:`: `bin/lib/telemetry.py` (the known-skill list), `docs/designs/workflow-efficiency-program.md`, `tests/fixtures/autoplan-lean/` (deleted with the suite), `tests/init-templates.test.ts`, `tests/setup-hosts.test.ts` and `tests/skill-content.test.ts`.

## Individual Track history
_tombstone: 71_

### Track 71E: Make the suite pass inside Codex's workspace-write sandbox ✓ Shipped (v0.72.2)
- 2026-11-07: merged [PR #216](https://github.com/kbitz/gstack-extend/pull/216) (commit `09302e3`, 19:24Z); verified land-time Track 71E, introduced in the 2026-11-07 regeneration (`13c6053`, PR #214).
- The preparation receipt's completion matrix reports 14 of 14 VERIFIED (criteria AC1–AC7, tasks T1–T6 and one approved plan amendment) with no deferrals. `tests/layout-scaffold.test.ts` passes on the host and inside `codex sandbox -c sandbox_mode=workspace-write` with `TMPDIR` unset, with a private `TMPDIR`, and with a private `TMPDIR` and `/tmp` excluded (185 pass, 0 fail each); with `/tmp` excluded and `TMPDIR` unset it fails at load with the planned `TMPDIR` message, never a skip. The suite picks its temp parent from the first location where `mkdtemp` succeeds and gives child processes file-backed stdio (the approved amendment, test-only). `src/layout-scaffold/root.ts` `bindRoot` now treats an empty ancestor `.git` directory as plain, as Git does, and still refuses every other `.git` entry; the plan named why, as the card allowed, and the release notes disclose it. The sweep found 9 other suites failing in the sandbox; the owner-approved follow-up is Track 72D.
- Files beyond its `_touches:`: `src/layout-scaffold/root.ts` (allowed by its Done-when). `tests/helpers/fixture-repo.ts` was declared and not edited.

### Track 71C: Publish the orchestration contract ✓ Shipped
- 2026-11-07: merged [PR #217](https://github.com/kbitz/gstack-extend/pull/217) (commit `1c17678`, 21:31Z); verified land-time Track 71C, introduced in the 2026-11-07 regeneration (`13c6053`, PR #214). Documentation only, with no version bump; it is first released in v0.73.0.
- The preparation receipt's completion matrix reports 11 of 11 VERIFIED with no deferrals. `docs/orchestration-contract.md` (contract version 1) states what a host or orchestrator provides (worktree-ownership signal, host attribution, state root, run-mode signal, resume and approval semantics, optional caller inputs) and what each stage promises, traces each requirement to its current provider or marks it not yet honored, and links the handoff grammar instead of copying it; existing `Run /review-and-prep` and `review-and-prep/v1` consumers stay valid, and no orchestrator is named as required. Its approved plan let stage-exit gaps read "no Track scheduled"; this regeneration schedules them as Track 72A and updates those rows.

### Track 71D: Verify agent-checkable items before human testing ✓ Shipped (v0.73.0)
- 2026-11-08: merged [PR #218](https://github.com/kbitz/gstack-extend/pull/218) (commit `5649b6d`, 02:20Z); verified land-time Track 71D, introduced in the 2026-11-07 regeneration (`13c6053`, PR #214).
- The preparation receipt's completion matrix reports 14 of 14 VERIFIED (plan criteria 1–11 and tasks T1–T3) with no deferrals. `/review-and-prep` counts as required user testing only checks that need the user's judgment or access, runs agent-checkable items report-only through a fitting installed upstream QA skill before any manual-testing pause, records each result on its matrix row, falls back to the user only with a recorded reason, keeps destructive actions against shared environments with the user and never re-marks a failed check passed; the H-C hold is unchanged. Protocol tests lock each rule; installed-agent execution of the new section is not claimed. The plan's release line read `_release: minor — <paragraph>`, which the caller's scripted release refused as `level_invalid`, so the release was cut by hand as a 0.x MINOR (caller's account; the PR records only the plan's `_release: minor`). Track 73B now documents the exact line.
- Review backlog B1–B5 and the stale H-C pause example, recorded in the preparation receipt, are triaged in this regeneration: B1 deferred to Future, B2–B5 killed under the manifestation gate, and the example placed on Track 72A.

## Individual Track history
_tombstone: 72, 73, 74_

### Track 72A: Give the remaining stages a fixed exit line under the contract ✓ Shipped (v0.74.0)
- 2026-11-08: merged [PR #220](https://github.com/kbitz/gstack-extend/pull/220) (commit `2d1b3e4`, 10:01Z); verified land-time Track 72A, introduced in the 2026-11-07 regeneration (`f3a35fa`, PR #219).
- The preparation receipt's completion matrix reports 18 of 18 VERIFIED (criteria AC1–AC9 and tasks T1–T9) with no deferrals. `/pair-review`, `/ship-and-land`, `/full-review`, `/roadmap` and `/project-spec` end their final message with a `Stage handoff: stage-handoff/v1` line on every exit; `docs/workflow-handoffs.md` documents each producer with fixtures, the existing handoff prompts are unchanged, the contract's rows name what each stage honors, and the H-C pause example lists only judgment or access checks. Its review recorded one test gap (the pair-review stage-line value bindings), which this regeneration places on Track 76A.
- Files beyond its `_touches:`: `.gstack/pregate.json`, `tests/helpers/touchfiles.ts` and `docs/TODOS.md`.

### Track 72C: Use pregate to select docs-only tests and explain long runs ✓ Shipped (v0.76.0)
- 2026-11-08: merged [PR #222](https://github.com/kbitz/gstack-extend/pull/222) (commit `bb6ccba`, 19:39Z); verified land-time Track 72C, introduced in the 2026-11-07 regeneration (`f3a35fa`, PR #219).
- The preparation receipt's completion matrix reports 59 of 61 rows VERIFIED and 2 DEFERRED BY USER (AC4 and task T5's explanation, both the reported 211-minute outlier; owner, 2026-11-08: "Defer it."), which the card allowed. `/docs-ship` selects its doc-pinning tests from the base branch's pregate policy (`gstack-pregate --stage tests --explain`) and reports the selection source, keeps the text scan where there is no base policy or installed pregate, and keeps same-tree evidence reuse; `docs/acceptance/docs-ship-timing.md` records a six-row local baseline and the deferred outlier, now a Future entry. Attaching an installed `/docs-ship` run to the two-driver qualification stays with that Track (now 77B), whose card already requires it. Its review recorded nine test gaps, deferred to Future by this regeneration.
- Files beyond its `_touches:`: `src/docs-ship/pregate.ts` (new), `docs/acceptance/docs-ship-timing.md`, `docs/designs/workflow-efficiency-program.md` and `docs/TODOS.md`.

### Track 72D: Make the subprocess-driven suites pass inside Codex's sandbox ✓ Shipped (v0.76.1)
- 2026-11-08: merged [PR #225](https://github.com/kbitz/gstack-extend/pull/225) (commit `3e988e0`, 23:58Z); verified land-time Track 72D, introduced in the 2026-11-07 regeneration (`f3a35fa`, PR #219).
- The preparation receipt's completion matrix reports 15 of 15 VERIFIED with no deferrals, under owner revisions that kept the review-delegate and merge-gate product code untouched (test-only adaptations). Child processes get file-backed stdio from the shared `tests/helpers/child-stdio.ts`; the tests that run `./setup` pass `TMPDIR`; `setup` writes its self-registration log under `${TMPDIR:-/tmp}`; and `upstream-check`'s probe writes its output in chunks through `fs.writeSync` with a brief `EAGAIN` retry (product changes the card allowed where the plan showed the failure). The sandbox evidence is a per-suite table (81 rows) from sharded per-file runs, not one fresh whole-command sandbox run, and the final host full suite was attested by the caller. Its CHANGELOG entry said the probe's result was "on disk" and omitted the setup change; the docs PR that records this receipt corrects it. Its review recorded three test gaps, deferred to Future.
- Files beyond its `_touches:`: `setup`, `src/upstream-check/probe.ts`, `docs/upstream-check.md`, `tests/child-stdio.test.ts`, `tests/helpers/quota-env.ts` and several other suites the sweep reached (merge-gate, review-delegate, setup-hosts, docs-ship, project-spec, telemetry-contract, touchfiles), plus `docs/TODOS.md`. `tests/audit-cli-contract.test.ts` was declared and not edited.

### Track 74A: Keep /pair-review to human-judgment items ✓ Shipped (v0.78.0)
- 2026-11-09: merged [PR #227](https://github.com/kbitz/gstack-extend/pull/227) (commit `0667987`, 15:58Z); verified land-time Track 74A, introduced in the 2026-11-07 regeneration (`f3a35fa`, PR #219).
- The preparation receipt's completion matrix reports 56 of 56 VERIFIED with no deferrals, after one owner-authorized repair-only continuation ("74a - continuation"). `/pair-review` lists only checks that need the user's judgment or access, prepares each and attaches the agent's evidence, verifies a fix itself before asking for a retest and keeps a failed result on record; the coverage-bundle, coverage-graph and coverage-editing machinery is removed (the skill went from 1,899 to 1,774 lines), and the H-C `Results:` line stays readable. Its review recorded eight installed-agent test gaps (G1–G8), deferred to Future with its eval scenarios pointed at the two-driver qualification.
- Files beyond its `_touches:`: `docs/TODOS.md` only.

### Track 73B: Carry release-note disclosures from the plan through the review handoff ✓ Shipped (v0.82.0)
- 2026-11-10: merged [PR #231](https://github.com/kbitz/gstack-extend/pull/231) (commit `437a9e6`, 03:31Z); verified land-time Track 73B (the full receipt's scope reads "Track73B plus confidence-scale addition"), introduced in the 2026-11-07 regeneration (`f3a35fa`, PR #219).
- The preparation receipt's completion matrix reports 13 of 13 VERIFIED (AC1–AC7, T1–T5 and S1, the owner's addition "2 switch to 0-100, keep it simple!") with no deferrals. `/plan-track` can write `Release note:` and `Upgrade risk:` lines only when a change needs a disclosure and documents the exact `_release:` line; `/review-and-prep` prints `User-facing change:` lines beside, never inside, its handoff lines; `docs/workflow-handoffs.md` documents the grammar with fixtures; delegated reviews ask for 0–100 confidence. Live model adherence is unproven. Its review recorded three test gaps: one placed on Track 75A, two deferred to Future.
- Files beyond its `_touches:`: `docs/delegated-review.md`, `src/review-delegate/delegate.ts` and `tests/review-delegate.test.ts` (the S1 addition), `tests/fixtures/handoffs/release-disclosures-*.txt` and `docs/TODOS.md`.

### Track 74B: Add a one-command full-suite run for fresh checkouts ✓ Shipped (v0.75.1)
- 2026-11-08: merged [PR #223](https://github.com/kbitz/gstack-extend/pull/223) (commit `fb04192`, 17:02Z). It was never on the roadmap and carried no Track ID; its plan cites the owner's decision of 2026-11-08 ("B", a repository script over a transport setting, confirmed "yes"). This regeneration numbers it.
- The preparation receipt's completion matrix reports 12 of 12 VERIFIED. `scripts/full-suite.sh` changes to the repository root (also with `CDPATH` exported), runs `bun install --frozen-lockfile`, then `EVALS_ALL=1 bun run test`, and exits with the suite's status; it has its own test and a `CLAUDE.md` Testing paragraph. A receipt-only note that five other scripts share the `CDPATH` pattern was not filed to the inbox.

### Track 74C: Preserve full-review records and bound PR body size ✓ Shipped (v0.79.0)
- 2026-11-09: merged [PR #228](https://github.com/kbitz/gstack-extend/pull/228) (commit `5b54ffe`, 19:55Z). It was never on the roadmap and carried no Track ID; it ran from a caller's approved private plan. This regeneration numbers it.
- The preparation receipt's completion matrix reports 47 VERIFIED. `/review-and-prep` writes the full-review baseline record once, checks for a missed write at the next cycle's start and recovers it late, and kept every PR body it writes at or under 45,000 characters (a budget Track 74D replaced in v0.80.0). Its review recorded ten test gaps, deferred to Future. Track 75B's evidence mapping depends on its record.

### Track 74D: Keep workflow PR bodies and receipt comments compact ✓ Shipped (v0.80.0)
- 2026-11-09: merged [PR #230](https://github.com/kbitz/gstack-extend/pull/230) (commit `423cba3`, 23:47Z). It was never on the roadmap and carried no Track ID; it ran from a caller's approved implementation handoff. This regeneration numbers it.
- The preparation receipt's completion matrix reports 14 of 14 VERIFIED (AC1–AC9, T1–T5). `/review-and-prep` writes a short PR body and one compact receipt comment and keeps the full receipt in a local hash-bound file; `/ship-and-land`'s section becomes a short summary linking its own full receipt; the 45,000-character budget and its evidence comment are retired, and an older receipt comment without a `Full receipt:` line is read as a legacy full receipt. Its review recorded two test gaps, placed on Track 75A.

### Track 74E: Give delegated review parts read-only repository access and tools ✓ Shipped (v0.81.0)
- 2026-11-10: merged [PR #229](https://github.com/kbitz/gstack-extend/pull/229) (commit `03eb9fa`, 01:12Z). It was never on the roadmap and carried no Track ID; it implemented the owner-approved card of this title from the project manager's card files, and the owner approved its plan and later exceptions ("Approve both", "Approve this named exception and continue", "Approve this risk and later base merges under those conditions"). This regeneration numbers it.
- The local full receipt's completion matrix reports 52 VERIFIED and 17 DEFERRED BY USER, including AC7, the post-release real run (PM1 in `docs/acceptance/delegate-tools-mode.md`), which this regeneration places on Track 75D. `bin/review-delegate` accepts an opt-in tools-mode provider (`"access": "tools"`, `"cli": "claude-code"`, `"commands"`) that runs Claude Code with its normal HOME and sign-in in a disposable copy at the reviewed head, limited by Claude Code's permission flags; diff-only providers and runs without a `Review delegates:` line are unchanged. The review stopped at its cycle cap and then ran an owner-authorized full continuation. Its review filed twenty inbox items (DT01–DT20): this regeneration places one on Track 75D, kills nine and defers ten to Future.

## Individual Track history
_tombstone: 75_

### Track 75A: Review stop rules: block on shown findings, re-audit post-audit changes, document capped-review recovery ✓ Shipped (v0.83.0)
- 2026-11-10: merged [PR #234](https://github.com/kbitz/gstack-extend/pull/234) (commit `7891822`, 15:00Z); verified land-time Track 75A, introduced in the 2026-11-10 regeneration (`bcf1f80`, PR #232) from the 2026-11-07 review-evidence card and the two 2026-11-08 fold-in cards.
- The local full receipt's completion matrix reports 66 of 66 rows VERIFIED with no deferrals or blocked scope. `/review-and-prep` accepts two opt-in `review-and-prep-policy/v1` values, each with an installed-support check: `blocking=shown` (a finding outside the safety classes blocks readiness only when shown at the reviewed head) and `post-audit=classify` (a change after the documentation audit's last attempt stops for the owner only when it touches documented behavior, and the receipt names each change and why); the defaults are unchanged. `docs/workflow-handoffs.md` documents capped-review recovery while `/ship-and-land` still refuses a stopped draft; protocol and handoff tests lock the rules and the two recorded receipt and disclosure test gaps; `docs/acceptance/review-fix-policy.md` records an unpaired before sample, with "after" unknown and no installed-agent run. Its review recorded one test gap (neighboring review-policy bullet slices), which this regeneration places on Track 78A; the open "after" measurement and installed-agent check go to Track 81A.
- Files beyond its `_touches:`: `docs/acceptance/review-fix-policy.md`, `src/upstream-check/cli.ts` (two exemptions for the new capability checks) and `docs/TODOS.md`.

### Track 75B: Map review facts to a portable evidence reference ✓ Shipped
- 2026-11-10: merged [PR #233](https://github.com/kbitz/gstack-extend/pull/233) (commit `f38423d`, 13:06Z); verified land-time Track 75B, introduced in the 2026-11-10 regeneration (`bcf1f80`, PR #232). A documentation-only change, shipped without a version bump, so it has no release version.
- The local full receipt's completion matrix reports 15 of 15 VERIFIED with no deferrals. `docs/designs/review-evidence-envelope.md` (new) maps the review facts (commit and tree, scope, completed, converged and cycles, the review binding, verified and imported lanes, and the write-once baseline record) to the existing portable evidence bundle, checks the full-scope, completion, convergence and binding predicates independently, and specifies missing, stale and unavailable cases without treating a nonconverged full scope as a completed baseline; no runtime was added. Its receipt's optional documentation debt (no incoming link to the design) is placed on Track 76B.
- Files beyond its `_touches:`: none.
