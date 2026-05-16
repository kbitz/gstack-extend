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

### Group 12: `gstack-extend init <project>` Scaffold

Project bootstrapping continuation — Layout Scaffolding (shipped in
Group 10) gave skill prose for `mkdir/git mv` against the canonical
layout. This Group ships the dedicated `gstack-extend init <project>`
command for greenfield projects.

##### Track 12A: `gstack-extend init <project>` 10x-version
_1 task . ~850 LOC . medium-high risk . [new bin + scaffold templates + setup wiring]_
_touches: bin/gstack-extend, bin/lib/, scripts/init-templates/, skills/gstack-extend-init.md, setup, tests/init-*.test.ts, tests/setup-init-wire.test.ts, tests/helpers/touchfiles.ts_
- **`gstack-extend init <project>` cathedral** -- full bootstrap with starter ROADMAP.md (state-section template), CLAUDE.md scaffold (per-language test-command detect: bun/cargo/go/python), CHANGELOG.md, TODOS.md (with `[manual]`-tagged first-session checklist), PROGRESS.md, VERSION, `docs/{designs,archive}/`, project registration in `~/.gstack-extend/projects.json` (JSON not YAML — jq-native), and post-render audit gate (per D3.A: leave files + retry hint on audit fail). Subcommand namespace reserved: `list/status/doctor/migrate` as stubs printing "coming in a future Group". `setup` wires `~/.local/bin/gstack-extend` symlink (fail-soft + PATH tip) and auto-self-registers (D4.A, `|| true` wrapped). Flag matrix: `default | --dry-run | --no-prompt | --migrate` × `empty | partial | onboarded` (defensive-minimal D2.B scaffold refuses on canonical file collision). `_die_with_line()` ERR-trap helper in install-safety.sh. POSIX-portable readlink for invocation via PATH symlink (macOS + Linux). _bin/gstack-extend, bin/lib/projects-registry.sh, scripts/init-templates/*.tmpl (6 files), skills/gstack-extend-init.md, setup, 5 test files, ~850 lines._ (M-H)

### Group 13: Telemetry Parity with Gstack

gstack-extend skills emit nothing today; mind-meld retro flying over a
project sees gstack activity but is blind to all gstack-extend skill
runs.

##### Track 13A: `bin/gstack-extend-telemetry` + per-skill emit blocks
_1 task . ~200 LOC . low risk . [new helper + per-skill blocks]_
_touches: bin/gstack-extend-telemetry, skills/full-review.md, skills/pair-review.md, skills/review-apparatus.md, skills/test-plan.md, skills/roadmap.md_
- **Add helper + per-skill emit blocks** -- helper appends one JSON line per activation to `~/.gstack/analytics/skill-usage.jsonl` matching gstack's schema (`{"skill","duration_s","outcome","session","ts","repo"}`); mark via skill-name prefix (`extend:roadmap`) or `"source":"gstack-extend"`. Append preamble + completion block to each gstack-extend skill following gstack's pattern at `retro/SKILL.md:58-65` and `:631-650`. Gate on `~/.gstack/.telemetry-prompted` / `gstack-config get telemetry`. _bin/gstack-extend-telemetry, skills/*.md (5 files), ~200 lines._ (M)

### Group 14: New Skill `/claude-md-cleanup`

_Depends on: Group 12_

Collides on `setup` with Group 12. Audits CLAUDE.md for bloat, stale
references, and content that should be pointers.

##### Track 14A: `/claude-md-cleanup` skill
_1 task . ~250 LOC . low risk . [new skill + setup wiring]_
_touches: skills/claude-md-cleanup.md, setup_
- **`/claude-md-cleanup` skill** -- detect duplication against README, TESTING.md, CONTRIBUTING.md; flag stale file references via `git ls-files`; flag long inline content that could be a pointer; produce diff with summary + per-section recommendation. Wire into setup's SKILLS array. _skills/claude-md-cleanup.md, setup, ~250 lines._ (M)

### Group 15: Canonical Fragment Extraction + Skill-Prose Drift Test

Skill simplification pre-work — identifies byte-identical fragments
across the four review-skill files and locks them via
`REQUIRED_VERBATIM_BLOCKS` assertions before the trim Tracks land. Also
folds in the deferred drift test for `## SECTION_NAME` references in
`skills/roadmap.md` advisory lists; both add assertion families to the
same file so they ship as one PR.

##### Track 15A: Extract canonical fragments + add REQUIRED_VERBATIM_BLOCKS + section-name drift test
_2 tasks . ~110 LOC . low risk . [skill-protocols test only]_
_touches: tests/skill-protocols.test.ts_
- **Extract canonical shared fragments + lock via test** -- read the appended graft sections across pair-review, full-review, review-apparatus, test-plan; identify byte-identical fragments (Completion Status Protocol enum, Escalation opener, Escalation format, Confusion Protocol head, GSTACK REVIEW REPORT table header); pick the tightest variant of each as canonical; add per-fragment assertions to `tests/skill-protocols.test.ts` so future drift is caught. _tests/skill-protocols.test.ts, ~80 lines._ (S)
- **Drift test: skill prose section-name lists vs CANONICAL_SECTIONS** -- assert every `## SECTION_NAME` referenced in advisory-section lists in `skills/roadmap.md` matches `CANONICAL_SECTIONS` from `src/audit/sections.ts`. Pairs with `tests/audit-invariants.test.ts` (fixture-lock) and `tests/audit-compliance.test.ts` (skill registry) as a third structural-invariants check. Strikethrough-aware parsing or whitelist file optional. _tests/skill-protocols.test.ts, ~30 lines._ (S)

### Group 16: Skill-File Trims (parallel)

_Depends on: Group 13, Group 15_

Telemetry adds blocks first; canonical extraction must lock shared
fragments before trim Tracks can run safely. Tracks 16A-16D are
file-disjoint and run fully in parallel.

##### Track 16A: Trim `pair-review.md`
_1 task . ~100 LOC (deletions) . low risk . [pair-review skill file]_
_touches: skills/pair-review.md_
- **Duplication-only trim per scope discipline** -- only remove (a) literal duplication within the skill, (b) word-level redundancy, (c) obviously stale refs (e.g., removed features), (d) dead cross-references. Gate on `tests/skill-protocols.test.ts` passing unchanged. _skills/pair-review.md, ~100 lines (deletions)._ (M)

##### Track 16B: Trim `full-review.md`
_1 task . ~80 LOC (deletions) . low risk . [full-review skill file]_
_touches: skills/full-review.md_
- **Duplication-only trim per scope discipline** -- same rules as 16A, applied to full-review.md. _skills/full-review.md, ~80 lines._ (M)

##### Track 16C: Trim `review-apparatus.md`
_1 task . ~50 LOC (deletions) . low risk . [review-apparatus skill file]_
_touches: skills/review-apparatus.md_
- **Duplication-only trim per scope discipline** -- same rules as 16A, applied to review-apparatus.md (smallest skill, calibration target). _skills/review-apparatus.md, ~50 lines._ (S)

##### Track 16D: Trim `test-plan.md`
_1 task . ~80 LOC (deletions) . low risk . [test-plan skill file]_
_touches: skills/test-plan.md_
- **Duplication-only trim per scope discipline** -- same rules as 16A, applied to test-plan.md. _skills/test-plan.md, ~80 lines._ (M)

### Group 17: Promote Canonical Fragments to `SKILL.md.tmpl`

_Depends on: Group 14, Group 15, Group 16_

Collides with `/claude-md-cleanup` on `setup`; consumes canonical
extraction + trims. Once skills are trimmed and fragments are locked,
promote them into a shared template so new skills inherit automatically
and cross-cutting protocol additions become single-source instead of
N-skill grafts.

##### Track 17A: Promote canonical fragments into a shared template
_1 task . ~150 LOC . low risk . [shared template + setup integration]_
_touches: .claude/skills/SKILL.md.tmpl, setup_
- **Promote canonical fragments into a shared template** -- once Group 15 has identified which fragments rhyme and Group 16 has trimmed, promote them into `.claude/skills/SKILL.md.tmpl`. New skills inherit automatically. _.claude/skills/SKILL.md.tmpl, setup integration, ~150 lines._ (M)

### Group 18: Migrations Runner Parity for `gstack-extend` Upgrades

Mirrors gstack's `gstack-upgrade/SKILL.md` Step 4.75. `bin/update-run`
already has `OLD_VERSION`/`NEW_VERSION` in hand; this Group adds a
`migrations/v*.sh` runner so future breaking state changes (renamed
config keys, moved state dirs, orphaned files) ship with a migration
path instead of stranding existing installs.

##### Track 18A: `migrations/v*.sh` runner in `bin/update-run`
_1 task . ~30 LOC . low risk . [bin/update-run + migrations/ + tests]_
_touches: bin/update-run, migrations/, tests/update.test.ts_
- **Migrations runner parity for gstack-extend upgrades** -- after the git pull + `./setup` in `bin/update-run`, run any `migrations/v*.sh` script whose version is newer than the old `VERSION` and not newer than the new `VERSION`. Idempotent (re-running on the same install is a no-op), non-fatal on per-script error (emit `MIGRATION_WARN` line but continue). Reference impl: gstack `gstack-upgrade/SKILL.md` Step 4.75. _bin/update-run, migrations/ (new dir), tests/update.test.ts, ~30 lines._ (S)

### Group 19: Tighten `docs/`-Absent Audit Gate

Source: pre-landing `/review` codex round on Track 10A (formerly Track
8A). Narrows the `DOC_LOCATION` "docs/ directory absent" finding's
trigger from any-CLAUDE.md to a stronger gstack-extend signal, so
running `bin/roadmap-audit` on a generic Claude Code repo (or in fleet
contexts) doesn't emit a hard `DOC_LOCATION fail` telling the user to
scaffold a layout they didn't opt into.

##### Track 19A: Narrow the gate to a gstack-extend-specific signal
_1 task . ~30 LOC . low risk . [doc-location check + test]_
_touches: src/audit/checks/doc-location.ts, tests/checks-doc-location.test.ts_
- **Tighten docs/-absent gate** -- replace the `hasClaude` gate in `src/audit/checks/doc-location.ts` with one of (or a disjunction over): presence of a `bin/roadmap-audit` shim at repo root, an entry in `~/.gstack-extend/projects.yaml` once that registry exists, or `docs/ROADMAP.md` anywhere in the worktree. Add a fixture exercising the new gate on a CLAUDE.md-but-no-roadmap-audit-shim repo (must NOT fire). Keep the existing fixture (CLAUDE.md + gstack-extend signal) firing. _src/audit/checks/doc-location.ts, tests/checks-doc-location.test.ts, ~30 lines._ (S)

### Group 20: Realpath Preflight for Layout Scaffolding (non-solo contexts)

_Depends on: Group 13_

Collides with Telemetry parity on `skills/roadmap.md` (Group 13 appends
the telemetry emit block; this Group amends the Layout Scaffolding
section preflight). Defense-in-depth against malicious-repo clones
where `docs` is a symlink to an external directory; mirrors the
`is_safe_install_path` pattern Track 5A shipped for the install
context.

##### Track 20A: Add realpath preflight to Layout Scaffolding skill prose
_1 task . ~30 LOC . low risk . [skills/roadmap.md skill prose only]_
_touches: skills/roadmap.md_
- **Realpath preflight for Layout Scaffolding skill prose** -- in the Preflight section of Layout Scaffolding, after the "every scaffold path either doesn't exist OR exists as a directory" check, add a step that resolves each scaffold directory via realpath (or `cd -P && pwd -P`) and refuses to proceed if the resolved target lives outside the repo root. Include the resolved-target value in the halt message so the user can see what tripped. Document the chezmoi/stow exception path in the same halt message (legitimately symlinks `docs/` outside the worktree; user must set up manually). Mirror the `is_safe_install_path` pattern Track 5A shipped for install. _skills/roadmap.md, ~30 lines._ (S)

### Group 21: Extract Layout Scaffolding into Shared Helper

_Depends on: Group 12_

Track 12A shipped an inline minimal scaffold (mkdir + canonical-file refusal) in
`bin/gstack-extend`. The richer ~85-line Layout Scaffolding logic lives in
`skills/roadmap.md` (lines 567-658). Until extracted, the two flows duplicate
the same canonical-path knowledge with drift risk. Source:
[plan-ceo-review:track=12A] reviewer finding #1.

##### Track 21A: Extract Layout Scaffolding into shared helper
_1 task . ~120 LOC . low risk . [shared lib extraction]_
_touches: skills/roadmap.md, bin/lib/layout-scaffold.sh, bin/gstack-extend_
- **Layout Scaffolding shared helper** -- pull the ~85 lines of Layout Scaffolding logic currently inline in `skills/roadmap.md` (lines 567-658) into a shared helper consumable by both `/roadmap` (in-flight project fix) and `gstack-extend init` (day-zero scaffold). 12A's inline minimal scaffold gets replaced by a call to the same helper so future audit-gate refinements update one place. _skills/roadmap.md, bin/lib/layout-scaffold.sh (new), bin/gstack-extend, ~120 lines._ (S)

### Execution Map

Adjacency list:
```
- Group 12 ← {}
- Group 13 ← {}
- Group 14 ← {12}
- Group 15 ← {}
- Group 16 ← {13, 15}
- Group 17 ← {14, 15, 16}
- Group 18 ← {}
- Group 19 ← {}
- Group 20 ← {13}
- Group 21 ← {12}
```

Track detail per group:
```
Group 12: gstack-extend init scaffold
  +-- Track 12A .......... ~M-H . 1 task

Group 13: Telemetry parity with gstack
  +-- Track 13A .......... ~M . 1 task

Group 14: New skill /claude-md-cleanup
  +-- Track 14A .......... ~M . 1 task

Group 15: Canonical fragments + section-name drift test
  +-- Track 15A .......... ~S . 2 tasks

Group 16: Skill-file trims (parallel)
  +-- Track 16A .......... ~M . 1 task (trim pair-review)
  +-- Track 16B .......... ~M . 1 task (trim full-review)
  +-- Track 16C .......... ~S . 1 task (trim review-apparatus)
  +-- Track 16D .......... ~M . 1 task (trim test-plan)

Group 17: SKILL.md.tmpl promotion
  +-- Track 17A .......... ~M . 1 task

Group 18: Migrations runner parity
  +-- Track 18A .......... ~S . 1 task

Group 19: Tighten docs/-absent audit gate
  +-- Track 19A .......... ~S . 1 task

Group 20: Realpath preflight for Layout Scaffolding
  +-- Track 20A .......... ~S . 1 task

Group 21: Extract Layout Scaffolding into shared helper
  +-- Track 21A .......... ~S . 1 task
```

**Total: 0 phases . 10 groups . 13 tracks remaining.**

---

## Future

- **Major version boundary detection** — When VERSION bumps to a new major (e.g., 0.x → 1.x), `/roadmap` should detect the boundary and offer to promote items from `## Future` into the current scope. Add detection logic to `src/audit/` and re-triage flow to `skills/roadmap.md`. _Source: prior Track 6A; deferred because it requires an external 0.x → 1.x bump to validate against, and the project is at 0.20.x with no major bump on the horizon. M effort (~80 LOC)._
- **Multi-agent test orchestration** — Each test group assigned to a separate Conductor agent. session.yaml as coordination point, groups as independent files so agents don't conflict. Parallel testing for large suites (15-20 items). _Deferred because: depends on /pair-review v1 proven reliable and Conductor agent API maturity. L effort (~2 weeks human / ~2 hours CC)._
- **Shared-infra auto-detect from git history** — Compute the shared-infra list automatically by scanning the last 20 merged PRs for files modified in ≥40% of them. Replaces `docs/shared-infra.txt` hand-maintenance. _Deferred because: ships hand-curated list first; revisit after 4+ weeks of cohort usage. M effort (~1 day human / ~30 min CC)._
- **Cohort retrospective telemetry** — Log per-cohort merge outcomes (parallel tracks merged clean? hotfix count? mid-flight splits?) to `~/.gstack/analytics/cohort-outcomes.jsonl`. Data-driven tuning of the size-cap ceilings. _Deferred because: requires 10+ real cohorts of usage data before signal emerges. M effort (~1 day human / ~40 min CC)._
- **Eval persistence + reader + comparator + regression gate** — Port `tests/helpers/eval-store.ts` from gstack proper (types, `getProjectEvalDir` with lazy memoization + design-doc fallback, transcript writer); reader (`findPreviousRun`, `compareEvalResults`, `extractToolSummary`, `totalToolCount`, `findBudgetRegressions`, `assertNoBudgetRegression`, `runBudgetCheck`); active `tests/skill-budget-regression.test.ts`. _Deferred because: no Track in this codebase currently produces eval-store data; shipping types + a skipped test alone would just bury infrastructure under a permanently-skipped test. Unblocks the day a Track that captures skill transcripts exists. M effort (~400–500 LOC)._
- **gbrain-sync allowlist for `~/.gstack/projects/*/evals/`** — Once a transcript producer exists, add the evals dir to gbrain-sync's allowlist (or denylist) in gstack proper so transcripts don't auto-sync to a private GitHub repo. _Deferred because: requires the producer to land first; cross-repo (gstack proper, not gstack-extend). S effort (~30 min)._
- **Eval dir retention / pruning policy** — Time-based ('drop files >30 days'), count-based ('keep last N per branch + tier'), or scenario-indexed ('prune older runs of the same {skill, scenario, model}') pruning of `~/.gstack/projects/<slug>/evals/`. _Deferred because: no eval-write rate exists yet to design against; pairs with the eval-persistence item above. S–M effort._
- **Audit fail-taxonomy calibration** — Review `src/audit/` STATUS emit decisions; downgrade `ARCHIVE_CANDIDATES` to warn; design narrow waiver mechanism for `SIZE` (per-track + reason + optional expiry, NOT vague italic markers). _Deferred because: a separate `/plan-eng-review` on the audit's policy surface, not in scope for any current Group. M effort._
- **Deduplicate SKILLS list across `setup` + `tests/skill-protocols.test.ts`** — Extract to `tests/helpers/parse-setup-skills.ts` and consume from the protocols test. Closes the third drift channel for the canonical skill list. _Deferred because: pairs naturally with Group 15's canonical extraction work. S effort._
- **Codex host support in `setup`** — `setup --host claude|codex|auto` flag (and matching uninstall path) targeting `~/.codex/skills/{skill}/SKILL.md` so Codex CLI users can consume the gstack-extend skills. Pre-existing TODOS work captures Codex-specific gates: frontmatter `description:` ≤ 1024 chars (4 of 5 skills exceed today; re-measure after Group 16 simplification), preamble probe path fallthrough, cross-skill reference fix at `skills/test-plan.md:232`. _Deferred until after Group 16 simplification settles description lengths. S-M effort._
- **Update `state-sections.ts` MIGRATION_NEEDED message to new archive path** — `src/audit/checks/state-sections.ts:74` emits a `MIGRATION_NEEDED` error pointing at `docs/designs/roadmap-v2-state-model.md`. The doc was archived to `docs/archive/roadmap-v2-state-model.md` on 2026-05-14. The error message will mis-route any user who triggers it. _Deferred because: /roadmap's hard gate is doc-only — TS source string update belongs in a code-touching PR. Trivially absorbed into the next audit-touching Track (G19) or a hotfix. S effort (~3 lines)._

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
