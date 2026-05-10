# Roadmap

Organized by lifecycle state: **In Progress** (active Tracks), **Current
Plan** (next-up work), **Future** (deferred bullets), **Shipped** (frozen
IDs at the document tail). A Track is one PR; Groups are equivalence
classes of "can run in parallel" — Tracks within a Group must have
set-disjoint `_touches:_` footprints. Execution order follows the
adjacency list in the Execution Map under Current Plan.

---

## In Progress

_(none — no Group has both shipped and unshipped Tracks)_

---

## Current Plan

### Group 6: Audit Polish + Track 5A Test Follow-ups + /roadmap-new Refactor

##### Track 6A: Audit polish + FRESHNESS coverage
_3 tasks . ~300 LOC . low risk . [src/audit/checks/, tests/audit-checks/, skills/roadmap.md]_
_touches: src/audit/checks/, tests/audit-checks/, tests/audit-snapshots.test.ts, skills/roadmap.md_
- **Direct state-machine tests for `check_phases` / `check_phase_invariants`** -- write `tests/audit-checks/phases.test.ts` covering each PHASE_INVARIANTS rule (≥2 Groups, listed Groups exist, sequentiality, no double-claim, scaffolding test-f, malformed-block warns) and the vocab-lint state transitions. Snapshot fixtures stay; unit tests are additive coverage that pinpoint state-machine regressions instead of cascading across 8 fixtures. _tests/audit-checks/phases.test.ts, ~150 lines._ (S)
- **Rename STALENESS → VERSION_TAG_STALENESS + skill prose clarifier** -- mechanical rename in `src/audit/checks/staleness.ts` (+ `expected.txt` fixtures), plus a one-line clarifier in `skills/roadmap.md` Interpreting Audit Findings: "VERSION_TAG_STALENESS only fires on items with explicit (shipped vN.N.N) annotations; broader recency belongs to FRESHNESS." Closes the dogfood-noted misread that `STALENESS: pass` settles the freshness question. _src/audit/checks/, tests/, skills/roadmap.md, ~30 lines._ (S)
- **Extend FRESHNESS scan to TODOS.md `## Unprocessed`** -- new `_inferred_freshness_for_todo` walks Unprocessed items, extracts referenced file paths from prose, runs the same per-file commit-since-introduction lookup as the ROADMAP scan (incl. Track-ID-or-title-fuzzy-match relaxation). Surfaces shipped-but-unclosed inbox items in the FRESHNESS AskUserQuestion flow. _src/audit/checks/freshness.ts, tests/, ~120 lines._ (M)

##### Track 6B: Track 5A test follow-ups
_2 tasks . ~50 LOC . low risk . [test files only]_
_touches: tests/update.test.ts, tests/checks-doc-type.test.ts_
- **`bin/update-run` upgrade-flow integration test** -- trigger `bin/update-run` and verify post-upgrade skills still resolve via path-1. Closes a Track 5A test-coverage gap surfaced during /ship of v0.18.14.0; low priority because (a) `bin/update-run` was unchanged in 5A scope, (b) post-upgrade resolution goes through path-1 which IS exercised, (c) update-run has its own non-Track-5A test coverage. _tests/update.test.ts, ~20 lines + git-fetch fixture._ (S)
- **Doc-type math unit tests** -- boundary cases (empty file, exactly 4 content lines, exactly 5 content lines with 25% density vs 60% density) for the `_inferred_doc_type` math. End-to-end coverage already exists via `tests/roadmap-audit/doc-type-mismatch/`; this Track adds isolated unit tests for the boundary cases. _tests/checks-doc-type.test.ts, ~30 lines._ (S)

##### Track 6C: `/roadmap-new` refactor — cut overhead + add ID-renames helper
_3 tasks . ~250 LOC . low risk . [skill prose + new lib + tests]_
_touches: skills/roadmap-new.md, src/audit/lib/renames-diff.ts, tests/lib-renames-diff.test.ts_
- **Cut Step 2 fast-path + top-of-run hint branches + `--scan-state` invocation from `/roadmap-new` skill prose** -- delete the fast-path predicate (~25 lines), the top-of-run hint branches, and the `--scan-state` JSON read from Step 1. v1 `/roadmap` keeps using `--scan-state` (helper preserved in `src/audit/cli.ts`); v2 reads audit + TODOS + git directly. _skills/roadmap-new.md, ~−45 lines._ (S)
- **Rewrite Step 5 PROGRESS.md flow** -- replace direct row-write with detect-staleness → AskUserQuestion → optional scoped general-purpose subagent appends rows from CHANGELOG. Honors the documentation taxonomy (PROGRESS.md content owned by /document-release) without invoking the full skill. _skills/roadmap-new.md, ~+25 lines._ (S)
- **Add ID-renames helper + apply-summary integration** -- new `src/audit/lib/renames-diff.ts` (parseEntities, computeRenames, formatRenamesTable) with `tests/lib-renames-diff.test.ts` (15 tests). Skill prose at apply-summary time runs the helper against pre/post ROADMAP.md and includes the table in the apply summary + commit message body. _src/audit/lib/renames-diff.ts, tests/lib-renames-diff.test.ts, skills/roadmap-new.md, ~+200 lines._ (S)

### Group 7: Tighten `git commit` Failure Handling

All three review skills currently treat any non-zero exit from `git commit`
as "nothing to commit, that's fine — continue." Silently swallows
pre-commit hook rejections, missing `user.email`, detached-HEAD refusal —
data-loss risk because the skill reports a commit that didn't land.

##### Track 7A: Snapshot staged state + escalate on real failure
_1 task . ~30 LOC . low risk . [3 review-skill files]_
_touches: skills/full-review.md, skills/pair-review.md, skills/review-apparatus.md_
- **Snapshot staged state + escalate on real failure** -- before commit, snapshot `git diff --cached --quiet; _HAS_STAGED=$?`. Run `git commit` only if `_HAS_STAGED` is 1. On non-zero exit with staged content present, escalate as BLOCKED with the stderr tail rather than swallowing silently. Apply identically to all three skills to preserve parity. _skills/full-review.md:498, skills/pair-review.md (parked-bug + fix-flow commits), skills/review-apparatus.md:346, ~30 lines (3 small edits)._ (S)

### Group 8: Project Bootstrapping — `roadmap-audit init` Subcommand

_Depends on: Group 6_

Closes the CEO-reviewed deferral from Track 5A. Codex outside-voice flagged
that layout scaffolding belonged in a separate Bootstrapping Group rather
than Track 5A's "install pipeline polish" scope.

##### Track 8A: `bin/roadmap-audit init` subcommand
_1 task . ~150 LOC . medium risk . [src/audit/cli.ts, tests/, skills/roadmap.md]_
_touches: src/audit/cli.ts, src/audit/checks/, tests/audit-init.test.ts, skills/roadmap.md_
- **`bin/roadmap-audit init` subcommand** -- new subcommand creates `docs/`, `docs/designs/`, `docs/archive/` in a fresh project and offers to `git mv` misplaced docs (consumes findings from `check_doc_location` and `check_doc_type`). On destination collisions, AskUserQuestion with diff/merge/skip/abort options. Skill prose in `skills/roadmap.md` adds a "Layout scaffolding" subsection describing when the subcommand fires. _src/audit/cli.ts, src/audit/checks/, tests/audit-init.test.ts, skills/roadmap.md, ~150 lines._ (M)

### Group 9: Project Bootstrapping — `gstack-extend init <project>` Scaffold

Wraps Group 8's init subcommand with full project scaffolding.

##### Track 9A: `gstack-extend init <project>` 10x-version
_1 task . ~250 LOC . medium-high risk . [new bin + scaffold templates + setup wiring]_
_touches: bin/gstack-extend, scripts/init-templates/, tests/init-e2e.test.ts, setup_
- **`gstack-extend init <project>` scaffold** -- full bootstrap with starter ROADMAP.md (state-section template), CLAUDE.md scaffold, project registration in `~/.gstack-extend/projects.yaml`, and initial `/roadmap` audit. Wraps Group 8's init subcommand. _bin/gstack-extend, scripts/init-templates/, tests/init-e2e.test.ts, setup, ~250 lines._ (M)

### Group 10: New Skill `/gstack-extend-upgrade`

Collides with `gstack-extend init` on `setup`'s SKILLS/BINS list. First-class
upgrade path replaces `git pull` archaeology — mirrors `/gstack-upgrade`.

##### Track 10A: Mirror `/gstack-upgrade` as `/gstack-extend-upgrade`
_1 task . ~250 LOC . low risk . [new skill + setup wiring]_
_touches: skills/gstack-extend-upgrade.md, setup, bin/_
- **Mirror `/gstack-upgrade` as `/gstack-extend-upgrade`** -- copy `~/.claude/skills/gstack-upgrade/SKILL.md` as the starting template; swap `gstack` → `gstack-extend` in install-detection paths, repo URL, config helper paths, and migrations directory; decide config-helper sharing (gstack-config vs parallel `gstack-extend-config`); wire into setup's SKILLS array. Same auto-upgrade / snooze / "never ask again" UX. _skills/gstack-extend-upgrade.md, setup, bin/, ~250 lines (mostly mechanical mirror)._ (M)

### Group 11: Telemetry Parity with Gstack

_Depends on: Group 6, Group 7, Group 8_

Collides on `skills/roadmap.md` (with 6A and 8A) and the 3 review-skill
files (with 7A). gstack-extend skills emit nothing today; mind-meld retro
flying over a project sees gstack activity but is blind to all
gstack-extend skill runs.

##### Track 11A: `bin/gstack-extend-telemetry` + per-skill emit blocks
_1 task . ~200 LOC . low risk . [new helper + per-skill blocks]_
_touches: bin/gstack-extend-telemetry, skills/full-review.md, skills/pair-review.md, skills/review-apparatus.md, skills/test-plan.md, skills/roadmap.md_
- **Add helper + per-skill emit blocks** -- helper appends one JSON line per activation to `~/.gstack/analytics/skill-usage.jsonl` matching gstack's schema (`{"skill","duration_s","outcome","session","ts","repo"}`); mark via skill-name prefix (`extend:roadmap`) or `"source":"gstack-extend"`. Append preamble + completion block to each gstack-extend skill following gstack's pattern at `retro/SKILL.md:58-65` and `:631-650`. Gate on `~/.gstack/.telemetry-prompted` / `gstack-config get telemetry`. _bin/gstack-extend-telemetry, skills/*.md (5 files), ~200 lines._ (M)

### Group 12: New Skill `/claude-md-cleanup`

_Depends on: Group 10_

Collides on `setup` with Group 10. Audits CLAUDE.md for bloat, stale
references, and content that should be pointers.

##### Track 12A: `/claude-md-cleanup` skill
_1 task . ~250 LOC . low risk . [new skill + setup wiring]_
_touches: skills/claude-md-cleanup.md, setup_
- **`/claude-md-cleanup` skill** -- detect duplication against README, TESTING.md, CONTRIBUTING.md; flag stale file references via `git ls-files`; flag long inline content that could be a pointer; produce diff with summary + per-section recommendation. Wire into setup's SKILLS array. _skills/claude-md-cleanup.md, setup, ~250 lines._ (M)

### Group 13: Canonical Fragment Extraction

Skill simplification pre-work. Identifies byte-identical fragments across
the four review-skill files and locks them via `REQUIRED_VERBATIM_BLOCKS`
assertions before the trim Tracks land. Touches only the test script —
no skill files mutated.

##### Track 13A: Inspect 4 skills + extract canonical fragments + add REQUIRED_VERBATIM_BLOCKS
_1 task . ~80 LOC . low risk . [skill-protocols test only]_
_touches: tests/skill-protocols.test.ts_
- **Extract canonical shared fragments + lock via test** -- read the appended graft sections across pair-review, full-review, review-apparatus, test-plan; identify byte-identical fragments (Completion Status Protocol enum, Escalation opener, Escalation format, Confusion Protocol head, GSTACK REVIEW REPORT table header); pick the tightest variant of each as canonical; add per-fragment assertions to `tests/skill-protocols.test.ts` so future drift is caught. _tests/skill-protocols.test.ts, ~80 lines._ (S)

### Group 14: Skill-File Trims

_Depends on: Group 11, Group 13_

Telemetry adds blocks first; canonical extraction must lock shared
fragments before trim Tracks can run safely. Tracks 14A-14D are
file-disjoint and run fully in parallel.

##### Track 14A: Trim `pair-review.md`
_1 task . ~100 LOC (deletions) . low risk . [pair-review skill file]_
_touches: skills/pair-review.md_
- **Duplication-only trim per scope discipline** -- only remove (a) literal duplication within the skill, (b) word-level redundancy, (c) obviously stale refs (e.g., removed features), (d) dead cross-references. Gate on `tests/skill-protocols.test.ts` passing unchanged. _skills/pair-review.md, ~100 lines (deletions)._ (M)

##### Track 14B: Trim `full-review.md`
_1 task . ~80 LOC (deletions) . low risk . [full-review skill file]_
_touches: skills/full-review.md_
- **Duplication-only trim per scope discipline** -- same rules as 14A, applied to full-review.md. _skills/full-review.md, ~80 lines._ (M)

##### Track 14C: Trim `review-apparatus.md`
_1 task . ~50 LOC (deletions) . low risk . [review-apparatus skill file]_
_touches: skills/review-apparatus.md_
- **Duplication-only trim per scope discipline** -- same rules as 14A, applied to review-apparatus.md (smallest skill, calibration target). _skills/review-apparatus.md, ~50 lines._ (S)

##### Track 14D: Trim `test-plan.md`
_1 task . ~80 LOC (deletions) . low risk . [test-plan skill file]_
_touches: skills/test-plan.md_
- **Duplication-only trim per scope discipline** -- same rules as 14A, applied to test-plan.md. _skills/test-plan.md, ~80 lines._ (M)

### Group 15: Promote Canonical Fragments to `SKILL.md.tmpl`

_Depends on: Group 12, Group 13, Group 14_

Collides with `/claude-md-cleanup` on `setup`; consumes canonical extraction
+ trims. Once skills are trimmed and fragments are locked, promote them
into a shared template so new skills inherit automatically and
cross-cutting protocol additions become single-source instead of N-skill
grafts.

##### Track 15A: Promote canonical fragments into a shared template
_1 task . ~150 LOC . low risk . [shared template + setup integration]_
_touches: .claude/skills/SKILL.md.tmpl, setup_
- **Promote canonical fragments into a shared template** -- once 13A has identified which fragments rhyme and 14A-14D have trimmed, promote them into `.claude/skills/SKILL.md.tmpl`. New skills inherit automatically. _.claude/skills/SKILL.md.tmpl, setup integration, ~150 lines._ (M)

### Execution Map

Adjacency list:
```
- Group 6 ← {}
- Group 7 ← {}
- Group 8 ← {6}
- Group 9 ← {8}
- Group 10 ← {9}
- Group 11 ← {6, 7, 8}
- Group 12 ← {10}
- Group 13 ← {}
- Group 14 ← {11, 13}
- Group 15 ← {12, 13, 14}
```

Track detail per group:
```
Group 6:  Audit Polish + Track 5A Test Follow-ups + /roadmap-new refactor
  +-- Track 6A ........... ~M . 3 tasks (audit polish)
  +-- Track 6B ........... ~S . 2 tasks (5A test follow-ups)
  +-- Track 6C ........... ~M . 3 tasks (/roadmap-new refactor)

Group 7:  Tighten git commit failure handling
  +-- Track 7A ........... ~S . 1 task

Group 8:  Project Bootstrapping — roadmap-audit init
  +-- Track 8A ........... ~M . 1 task

Group 9:  Project Bootstrapping — gstack-extend init scaffold
  +-- Track 9A ........... ~M . 1 task

Group 10: New skill /gstack-extend-upgrade
  +-- Track 10A .......... ~M . 1 task

Group 11: Telemetry parity with gstack
  +-- Track 11A .......... ~M . 1 task

Group 12: New skill /claude-md-cleanup
  +-- Track 12A .......... ~M . 1 task

Group 13: Canonical fragment extraction
  +-- Track 13A .......... ~S . 1 task

Group 14: Skill-file trims (parallel)
  +-- Track 14A .......... ~M . 1 task (trim pair-review)
  +-- Track 14B .......... ~M . 1 task (trim full-review)
  +-- Track 14C .......... ~S . 1 task (trim review-apparatus)
  +-- Track 14D .......... ~M . 1 task (trim test-plan)

Group 15: SKILL.md.tmpl promotion
  +-- Track 15A .......... ~M . 1 task
```

**Total: 0 phases . 10 groups . 15 tracks remaining.**

---

## Future

- **Major version boundary detection** — When VERSION bumps to a new major (e.g., 0.x → 1.x), `/roadmap` should detect the boundary and offer to promote items from `## Future` into the current scope. Add detection logic to `src/audit/` and re-triage flow to `skills/roadmap.md`. _Source: prior Track 6A; deferred because it requires an external 0.x → 1.x bump to validate against, and the project is at 0.18.x with no major bump on the horizon. M effort (~80 LOC)._
- **Multi-agent test orchestration** — Each test group assigned to a separate Conductor agent. session.yaml as coordination point, groups as independent files so agents don't conflict. Parallel testing for large suites (15-20 items). _Deferred because: depends on /pair-review v1 proven reliable and Conductor agent API maturity. L effort (~2 weeks human / ~2 hours CC)._
- **Shared-infra auto-detect from git history** — Compute the shared-infra list automatically by scanning the last 20 merged PRs for files modified in ≥40% of them. Replaces `docs/shared-infra.txt` hand-maintenance. _Deferred because: ships hand-curated list first; revisit after 4+ weeks of cohort usage. M effort (~1 day human / ~30 min CC)._
- **Cohort retrospective telemetry** — Log per-cohort merge outcomes (parallel tracks merged clean? hotfix count? mid-flight splits?) to `~/.gstack/analytics/cohort-outcomes.jsonl`. Data-driven tuning of the size-cap ceilings. _Deferred because: requires 10+ real cohorts of usage data before signal emerges. M effort (~1 day human / ~40 min CC)._
- **Eval persistence + reader + comparator + regression gate** — Port `tests/helpers/eval-store.ts` from gstack proper (types, `getProjectEvalDir` with lazy memoization + design-doc fallback, transcript writer); reader (`findPreviousRun`, `compareEvalResults`, `extractToolSummary`, `totalToolCount`, `findBudgetRegressions`, `assertNoBudgetRegression`, `runBudgetCheck`); active `tests/skill-budget-regression.test.ts`. _Deferred because: no Track in this codebase currently produces eval-store data; shipping types + a skipped test alone would just bury infrastructure under a permanently-skipped test. Unblocks the day a Track that captures skill transcripts exists. M effort (~400–500 LOC)._
- **gbrain-sync allowlist for `~/.gstack/projects/*/evals/`** — Once a transcript producer exists, add the evals dir to gbrain-sync's allowlist (or denylist) in gstack proper so transcripts don't auto-sync to a private GitHub repo. _Deferred because: requires the producer to land first; cross-repo (gstack proper, not gstack-extend). S effort (~30 min)._
- **Eval dir retention / pruning policy** — Time-based ('drop files >30 days'), count-based ('keep last N per branch + tier'), or scenario-indexed ('prune older runs of the same {skill, scenario, model}') pruning of `~/.gstack/projects/<slug>/evals/`. _Deferred because: no eval-write rate exists yet to design against; pairs with the eval-persistence item above. S–M effort._
- **Audit fail-taxonomy calibration** — Review `src/audit/` STATUS emit decisions; downgrade `ARCHIVE_CANDIDATES` to warn; design narrow waiver mechanism for `SIZE` (per-track + reason + optional expiry, NOT vague italic markers). _Deferred because: a separate `/plan-eng-review` on the audit's policy surface, not in scope for any current Group. M effort._
- **Deduplicate SKILLS list across `setup` + `tests/skill-protocols.test.ts`** — Extract to `tests/helpers/parse-setup-skills.ts` and consume from the protocols test. Closes the third drift channel for the canonical skill list. _Deferred because: pairs naturally with Group 13's canonical extraction work. S effort._
- **Codex host support in `setup`** — `setup --host claude|codex|auto` flag (and matching uninstall path) targeting `~/.codex/skills/{skill}/SKILL.md` so Codex CLI users can consume the gstack-extend skills. Pre-existing TODOS work captures Codex-specific gates: frontmatter `description:` ≤ 1024 chars (4 of 5 skills exceed today; re-measure after Group 14 simplification), preamble probe path fallthrough, cross-skill reference fix at `skills/test-plan.md:232`. _Deferred until after Group 14 simplification settles description lengths. S-M effort._

## Shipped

### Phase 1: Bun Test Migration ✓ Shipped (v0.18.3 → v0.18.11.0)

**End-state:** `bun test` is the sole test entry point, all `scripts/test-*.sh` retired, `bin/roadmap-audit` is a 7-line POSIX-sh shim invoking `src/audit/cli.ts`, and the 4 leverage patterns (touchfiles, skill prose corpus + in-session judging, audit-compliance, eval persistence — last deferred to Future) are adopted.

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
- Track 4C — _shipped (v0.18.11.0): skill prose corpus + in-session judging routing rule_
- Track 4D — _shipped (v0.18.10.0): audit-compliance test for gstack-extend invariants_

#### Group 5: Install Pipeline ✓ Shipped (v0.18.14.0)
- Track 5A — _shipped (v0.18.14.0): install pipeline polish — 3 of 5 originally-planned tasks landed (preamble probe pattern, doc-type detection heuristic, setup symlink hardening); 2 deferred tasks (layout scaffolding, update-run dir propagation) routed to Project Bootstrapping (Groups 8 + 9 in Current Plan)._
