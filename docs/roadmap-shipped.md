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
