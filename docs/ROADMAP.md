# Roadmap

Organized by lifecycle state: **In Progress** (active Tracks), **Current
Plan** (next-up work), **Future** (deferred bullets), **Shipped** (frozen
IDs at the document tail). A Track is one PR; Groups are equivalence
classes of "can run in parallel" — Tracks within a Group must have
set-disjoint `_touches:_` footprints. Execution order follows the
adjacency list in the Execution Map under Current Plan.

---

## In Progress

_(no Tracks currently mid-flight)_

---

## Current Plan

### Group 15: Canonical Locks ∥ Migrations ∥ Audit Gate ∥ Scaffold Preflight ∥ Init Polish

_Depends on: none_

Packer layer 0. Five file-disjoint Tracks. In-flight count is 5 (cap 6).

##### Track 15A: Lock SHARED:conductor-visibility-head + section-list drift + SKILLS helper
_3 tasks . ~130 LOC . low risk . [skill-protocols test + SKILLS helper]_
_touches: tests/skill-protocols.test.ts, tests/helpers/parse-setup-skills.ts (new), tests/audit-compliance.test.ts, skills/pair-review.md, skills/full-review.md, skills/review-apparatus.md, skills/test-plan.md_
_out: 16A, 16B, 16C, 16D, 17A_
_produces: locked SHARED:conductor-visibility-head, exact-set section-list drift assertions, and explicit SETUP/PROTOCOL/PREAMBLE/CONDUCTOR cohorts_
- **Lock Conductor visibility head** -- wrap the shared heading+item-1 core in pair-review, full-review, review-apparatus, test-plan; extract-from-canonical with AskUserQuestion / last-message pins. Conductor-only — 17A must not inherit blindly. _skills/{pair-review,full-review,review-apparatus,test-plan}.md, tests/skill-protocols.test.ts, ~40 lines._ (S)
- **Drift test: advisory/fail lists vs CANONICAL_SECTIONS** -- named parser on the two GSTACK REVIEW REPORT comma-lists; exact sets; fail-on-empty; SIZE_LABEL_MISMATCH is a known fossil (SIZE body label), not a section. Do not edit skills/roadmap.md. _tests/skill-protocols.test.ts, ~50 lines._ (S)
- **Shared SKILLS parser + explicit cohorts** -- extract `tests/helpers/parse-setup-skills.ts`; audit-compliance consumes it; protocol membership is an explicit 5/6/4 split (init is install-only). _tests/helpers/parse-setup-skills.ts (new), tests/audit-compliance.test.ts, tests/skill-protocols.test.ts, ~40 lines._ (S)

##### Track 15B: `migrations/v*.sh` runner in `bin/update-run`
_1 task . ~30 LOC . low risk . [bin/update-run + migrations/ + tests]_
_touches: bin/update-run, migrations/, tests/update.test.ts_
_produces: version-gated migrations runner after pull + setup_
- **Migrations runner parity for gstack-extend upgrades** -- after git pull + `./setup` in `bin/update-run`, run any `migrations/v*.sh` newer than the old VERSION and not newer than the new VERSION. Idempotent; per-script error emits `MIGRATION_WARN` and continues. _bin/update-run, migrations/ (new), tests/update.test.ts, ~30 lines._ (S)

##### Track 15C: Narrow the `docs/`-absent gate + fix archive-path string
_1 task . ~35 LOC . low risk . [doc-location + state-sections]_
_touches: src/audit/checks/doc-location.ts, tests/checks-doc-location.test.ts, src/audit/checks/state-sections.ts_
_produces: DOC_LOCATION docs/-absent only fires on a gstack-extend signal; MIGRATION_NEEDED points at the archived spec_
- **Tighten docs/-absent gate + fix archive path** -- replace the `hasClaude` gate with a gstack-extend signal (roadmap-audit shim, projects registry entry, or `docs/ROADMAP.md`). Fixture: CLAUDE.md-only repo must NOT fire. Same PR: point `state-sections.ts` MIGRATION_NEEDED at `docs/archive/roadmap-v2-state-model.md`. _src/audit/checks/doc-location.ts, tests/checks-doc-location.test.ts, src/audit/checks/state-sections.ts, ~35 lines._ (S)

##### Track 15D: Add realpath preflight to Layout Scaffolding skill prose
_1 task . ~30 LOC . low risk . [skills/roadmap.md]_
_touches: skills/roadmap.md_
_out: 16E_
_produces: Layout Scaffolding refuses scaffold dirs whose realpath is outside the repo_
- **Realpath preflight for Layout Scaffolding skill prose** -- after the exists-or-is-directory check, resolve each scaffold dir and halt if the target is outside the repo root. Name the resolved path. Document the chezmoi/stow exception. _skills/roadmap.md, ~30 lines._ (S)

##### Track 15E: 12A init-surface polish + test coverage
_2 tasks . ~200 LOC . low risk . [init bin + setup + init tests]_
_touches: tests/init-bin.test.ts, tests/init-registry.test.ts, tests/init-templates.test.ts, tests/setup-init-wire.test.ts, tests/helpers/init-scope.ts (new), bin/gstack-extend, setup_
_out: 16E_
_produces: init test coverage, DRY CANONICAL_FILES, and a fail-soft setup self-register guard_
- **Init test coverage + mkScope helper** -- (a) audit-failure path (PATH-shim non-zero `roadmap-audit` → exit 1 + "audit FAILED" + "--migrate" + files on disk); (b) 5–10 parallel `registry_upsert` stay valid JSON; (c) `validate_name` edges (`..`, `.`, leading-dash, empty, Unicode); (d) `lang_detect` precedence; (e) setup self-register fail-soft on corrupt `projects.json`; (g) extract `mkScope` to `tests/helpers/init-scope.ts`. _tests/init-*.test.ts, tests/helpers/init-scope.ts (new), ~120 lines._ (M)
- **Init code polish** -- (f) `render_all` map ↔ `CANONICAL_FILES` DRY; (h) `env -u GSTACK_EXTEND_STATE_DIR` guard on setup self-register; (j) trim fresh-init audit output to non-pass sections. Multi-hop readlink walker (old item i) shipped in v0.22.3.0. _bin/gstack-extend, setup, ~80 lines._ (M)

### Group 16: Skill-File Trims ∥ Layout Scaffold Extract

_Depends on: Group 15_

Packer layer 1. Trims wait on 15A's fragment lock. Layout extract waits on 15D (preflight lands in `skills/roadmap.md`) and 15E (`bin/gstack-extend` polish).

##### Track 16A: Trim `pair-review.md`
_1 task . ~100 lines (del) . low risk . [pair-review skill file]_
_touches: skills/pair-review.md_
_blocked-by: Track 15A_
_out: 17A_
_read-first: 15A_
_produces: pair-review.md with only unique prose; locked fragments untouched_
- **Duplication-only trim per scope discipline** -- remove literal duplication, word-level redundancy, stale refs, and dead cross-references. Do not touch `SHARED:` blocks. Gate on `tests/skill-protocols.test.ts` still passing. _skills/pair-review.md, ~100 lines (del)._ (S)

##### Track 16B: Trim `full-review.md`
_1 task . ~80 lines (del) . low risk . [full-review skill file]_
_touches: skills/full-review.md_
_blocked-by: Track 15A_
_out: 17A_
_read-first: 15A_
_produces: full-review.md with only unique prose; locked fragments untouched_
- **Duplication-only trim per scope discipline** -- same rules as 16A. _skills/full-review.md, ~80 lines (del)._ (S)

##### Track 16C: Trim `review-apparatus.md`
_1 task . ~50 lines (del) . low risk . [review-apparatus skill file]_
_touches: skills/review-apparatus.md_
_blocked-by: Track 15A_
_out: 17A_
_read-first: 15A_
_produces: review-apparatus.md with only unique prose; locked fragments untouched_
- **Duplication-only trim per scope discipline** -- same rules as 16A. _skills/review-apparatus.md, ~50 lines (del)._ (S)

##### Track 16D: Trim `test-plan.md`
_1 task . ~80 lines (del) . low risk . [test-plan skill file]_
_touches: skills/test-plan.md_
_blocked-by: Track 15A_
_out: 17A_
_read-first: 15A_
_produces: test-plan.md with only unique prose; locked fragments untouched_
- **Duplication-only trim per scope discipline** -- same rules as 16A. _skills/test-plan.md, ~80 lines (del)._ (S)

##### Track 16E: Extract Layout Scaffolding into shared helper
_1 task . ~120 LOC . low risk . [shared lib extraction]_
_touches: skills/roadmap.md, bin/lib/layout-scaffold.sh (new), bin/gstack-extend_
_blocked-by: Track 15D, Track 15E_
_read-first: 15D, 15E_
_produces: one layout-scaffold helper consumed by /roadmap and `gstack-extend init`_
- **Layout Scaffolding shared helper** -- pull the inline Layout Scaffolding logic out of `skills/roadmap.md` into `bin/lib/layout-scaffold.sh`. Replace 12A's inline mkdir+refusal in `bin/gstack-extend` with a call to the same helper. _skills/roadmap.md, bin/lib/layout-scaffold.sh (new), bin/gstack-extend, ~120 lines._ (S)

### Group 17: Promote Canonical Fragments to `SKILL.md.tmpl`

_Depends on: Group 15, Group 16_

Packer layer 2. Consumes the locked fragments and the trimmed skill files. Serialized after Group 15 (setup collision with 15E) via the 15 → 16 → 17 chain.

##### Track 17A: Promote canonical fragments into a shared template
_1 task . ~150 LOC . low risk . [shared template + setup integration]_
_touches: .claude/skills/SKILL.md.tmpl (new), setup_
_blocked-by: Track 15A, Track 15E, Track 16A, Track 16B, Track 16C, Track 16D_
_read-first: 15A, 16A, 16B, 16C, 16D_
_produces: SKILL.md.tmpl carrying canonical fragments; new skills inherit them_
- **Promote canonical fragments into a shared template** -- write `.claude/skills/SKILL.md.tmpl` from the fragments 15A locked and 16A–D left intact. Wire `setup` so new skills inherit the template. _.claude/skills/SKILL.md.tmpl (new), setup, ~150 lines._ (M)

### Execution Map

Adjacency list (from `bin/roadmap-pack`):
```
- Group 15 ← {}
- Group 16 ← {15}
- Group 17 ← {15, 16}
```

Track detail per group:
```
Group 15: Canonical Locks ∥ Migrations ∥ Audit Gate ∥ Scaffold Preflight ∥ Init Polish
  +-- Track 15A .......... ~S . 3 tasks (fragments + drift + SKILLS helper)
  +-- Track 15B .......... ~S . 1 task (migrations runner)
  +-- Track 15C .......... ~S . 1 task (docs/-absent gate + archive path)
  +-- Track 15D .......... ~S . 1 task (realpath preflight)
  +-- Track 15E .......... ~M . 2 tasks (init tests + init code polish)

Group 16: Skill-File Trims ∥ Layout Scaffold Extract
  +-- Track 16A .......... ~S . 1 task (trim pair-review)
  +-- Track 16B .......... ~S . 1 task (trim full-review)
  +-- Track 16C .......... ~S . 1 task (trim review-apparatus)
  +-- Track 16D .......... ~S . 1 task (trim test-plan)
  +-- Track 16E .......... ~S . 1 task (layout-scaffold helper)

Group 17: SKILL.md.tmpl promotion
  +-- Track 17A .......... ~M . 1 task
```

**Total: 0 phases . 3 groups . 11 tracks remaining.**

---

## Future

- **Major version boundary detection** — When VERSION bumps to a new major (e.g., 0.x → 1.x), `/roadmap` should detect the boundary and offer to promote items from `## Future` into the current scope. Add detection logic to `src/audit/` and re-triage flow to `skills/roadmap.md`. _Source: prior Track 6A; deferred because it needs an external 0.x → 1.x bump to validate against, and the project is at 0.23.x with no major bump on the horizon._
- **Multi-agent test orchestration** — Each test group assigned to a separate Conductor agent. session.yaml as coordination point, groups as independent files so agents don't conflict. Parallel testing for large suites (15-20 items). _Deferred because: depends on /pair-review v1 proven reliable and Conductor agent API maturity._
- **Shared-infra auto-detect from git history** — Compute the shared-infra list automatically by scanning the last 20 merged PRs for files modified in ≥40% of them. Replaces `docs/shared-infra.txt` hand-maintenance. _Deferred because: ships hand-curated list first; revisit after 4+ weeks of cohort usage._
- **Cohort retrospective telemetry** — Log per-cohort merge outcomes (parallel tracks merged clean? hotfix count? mid-flight splits?) to `~/.gstack/analytics/cohort-outcomes.jsonl`. Data-driven tuning of the size-cap ceilings. _Deferred because: requires 10+ real cohorts of usage data before signal emerges._
- **Eval persistence + reader + comparator + regression gate** — Port `tests/helpers/eval-store.ts` from gstack proper (types, `getProjectEvalDir` with lazy memoization + design-doc fallback, transcript writer); reader (`findPreviousRun`, `compareEvalResults`, `extractToolSummary`, `totalToolCount`, `findBudgetRegressions`, `assertNoBudgetRegression`, `runBudgetCheck`); active `tests/skill-budget-regression.test.ts`. _Deferred because: no Track in this codebase currently produces eval-store data._
- **gbrain-sync allowlist for `~/.gstack/projects/*/evals/`** — Once a transcript producer exists, add the evals dir to gbrain-sync's allowlist (or denylist) in gstack proper so transcripts don't auto-sync to a private GitHub repo. _Deferred because: requires the producer to land first; cross-repo (gstack proper, not gstack-extend)._
- **Eval dir retention / pruning policy** — Time-based, count-based, or scenario-indexed pruning of `~/.gstack/projects/<slug>/evals/`. _Deferred because: no eval-write rate exists yet to design against._
- **Audit fail-taxonomy calibration** — Review `src/audit/` STATUS emit decisions; downgrade `ARCHIVE_CANDIDATES` to warn; design narrow waiver mechanism for `SIZE` (per-track + reason + optional expiry). _Deferred because: a separate `/plan-eng-review` on the audit's policy surface._
- **Frontmatter `description:` ≤ 1024 for Codex** — 4 of 5 skills exceeded the Codex description cap at last measure. Re-measure after Group 16 trims; shorten any that still overflow. Host install itself shipped in v0.22.3.0. _Leftover from the old Codex-host Future item._

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
- Track 13A — _shipped (v0.22.0.0): bin/gstack-extend-telemetry wrapper + canonical preamble/epilogue blocks in 5 skill files. Every extend skill activation now writes start + end lines to ~/.gstack/analytics/skill-usage.jsonl with extend:<skill> name and source:gstack-extend field; mind-meld retro / /retro pick up extend activity with zero downstream changes. Wrapper falls back silently when gstack isn't installed. Drift-lock test extracts canonical blocks from skills/full-review.md and asserts each other skill embeds the templated variant. Opportunistic contract test catches future gstack flag renames._

#### Group 14: Fix `parsers-roadmap` Group 6 Completeness Failure ✓ Shipped (v0.22.0.2)
- Track 14A — _shipped (v0.22.0.2): dropped volatile live-ROADMAP assertions; added a synthetic state-section enclosure fixture. Parser untouched._
