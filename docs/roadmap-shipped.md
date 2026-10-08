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
