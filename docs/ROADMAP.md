# Roadmap — Pre-1.0 (v0.x)

Organized as **Groups > Tracks > Tasks**. A Group is a wave of PRs that land
together — parallel-safe within, sequential between. Create a new Group
whenever (a) dependency ordering demands it, OR (b) parallel tasks would
collide on files. Within a Group, Tracks must be fully parallel-safe
(set-disjoint `_touches:_` footprints). Each track is one plan + implement
session.

---

## Group 1: Install Pipeline + Audit Polish

Three thematic Tracks. Track 1A consolidates install/setup foundation
(env-var-aware skill preambles, update-run dir propagation, symlink-component
defense-in-depth). Track 1B builds `/roadmap` onboarding helpers (init
scaffolding + doc-type detection). Track 1C tightens audit recency semantics.
Tracks serialize via intra-group `Depends on:` — file overlap on
`skills/roadmap.md` (1A preamble vs 1B/1C body) and `bin/roadmap-audit`
(1B vs 1C) can't be distinguished by the audit at line-range granularity, but
each Track is a coherent PR with distinct scope.

### Track 1A: Install Path Resolution
_3 tasks . ~2 days (human) / ~45 min (CC) . low risk . [setup, bin/update-run, skills/*.md preambles, scripts/test-update.sh]_
_touches: setup, bin/update-run, scripts/test-update.sh, skills/full-review.md, skills/pair-review.md, skills/review-apparatus.md, skills/roadmap.md, skills/test-plan.md_

End-to-end support for custom install directories: probe-pattern preambles,
env-var honoring in `update-run`, and defense-in-depth against
symlink-component trust violations at the install target. Pre-flight 1
(the `--skills-dir` flag itself) shipped in v0.16.0; this Track makes the
flag's promise actually hold across the upgrade path.

- **Preamble probe pattern** -- Skill preambles currently `readlink ~/.claude/skills/{name}/SKILL.md`, which silently breaks on non-default installs. Replace with gstack-core's probe pattern (`~/.claude/skills/{name}/SKILL.md` then `.claude/skills/{name}/SKILL.md`). For truly-custom paths, honor `$GSTACK_EXTEND_ROOT` env var and fallback to `$HOME/.gstack-extend-rc` (written by setup). Also fix `skills/test-plan.md:632` to point at `$_EXTEND_ROOT/skills/pair-review.md`. _[skills/*.md preambles (5 files), setup], ~40 lines._ (S)
- **Propagate dir to update-run** -- `bin/update-run` calls `setup` without passing through any custom dir. Read `$GSTACK_EXTEND_ROOT` env var (set by user shell, populated by the probe-pattern rc-file fallback when available). If set, pass `--skills-dir "$GSTACK_EXTEND_ROOT"` to `./setup`. If unset, default behavior. Regression test: install with `--skills-dir /tmp/foo`, trigger upgrade, confirm skills still resolve at `/tmp/foo`. _[bin/update-run], ~40 lines._ (S)
- **Harden `setup` against symlink-component attacks** -- Before `ln -snf` in the install loop, assert `[ ! -L "$target" ]` (the directory itself, not `$target/SKILL.md`); fail with a clear error if the path component is a symlink. Same check in the uninstall loop before `readlink`/`rm`. Defense-in-depth against symlink-component trust boundary violations — becomes more relevant once `--skills-dir` is used in shared/semi-trusted directories. _[setup, scripts/test-update.sh], ~15 lines src + ~35 lines tests._ (S)

### Track 1B: Roadmap Onboarding Helpers
_2 tasks . ~1 day (human) / ~30 min (CC) . medium risk . [bin/roadmap-audit, skills/roadmap.md]_
_touches: bin/roadmap-audit, skills/roadmap.md_
_Depends on: Track 1A (file overlap on skills/roadmap.md — 1A's preamble probe-pattern fix vs this Track's body edits — serialize for clean PR landing)._

Make `/roadmap` self-bootstrapping for new projects: scaffold the right
directory layout, detect when a doc lives in the wrong place.

- **Layout scaffolding for new projects** -- Add a `/roadmap init` subcommand that creates the correct directory structure (`docs/`, `docs/designs/`, `docs/archive/`) and offers to git-mv misplaced docs (consumes `bin/roadmap-audit DOC_LOCATION` findings). On destination collisions, AskUserQuestion with diff + merge/skip/abort options. _[bin/roadmap-audit, skills/roadmap.md], ~50 lines._ (S)
- **Doc type detection heuristic** -- Teach `bin/roadmap-audit` to emit `## DOC_TYPE_MISMATCH` for two strong-signal patterns: design-looking doc outside `docs/designs/` (mermaid/plantuml fence), inbox-looking doc outside `TODOS.md` (checkbox density >20%). Skip known ROOT_DOCS/DOCS_DIR_DOCS. Only emit rows where content disagrees with location. _[bin/roadmap-audit], ~40 lines._ (S)

### Track 1C: Audit Recency Polish
_2 tasks . ~4 hours (human) / ~55 min (CC) . low risk . [bin/roadmap-audit, scripts/test-roadmap-audit.sh, skills/roadmap.md]_
_touches: bin/roadmap-audit, scripts/test-roadmap-audit.sh, skills/roadmap.md_
_Depends on: Track 1B (shared `bin/roadmap-audit` and `skills/roadmap.md` body surface area — serialize for clean PR landing)._

Tighten freshness/staleness semantics so `STALENESS: pass` doesn't get misread
as "skip FRESHNESS," and so shipped TODOS.md items don't rot indefinitely.

- **Rename `STALENESS` audit check + skill clarifier** -- `STALENESS: pass` reads like a superset of `FRESHNESS`, leading readers (including dogfooded LLM runs) to conclude prematurely "skip FRESHNESS, freshness question settled." Rename `STALENESS` → `VERSION_TAG_STALENESS` (or similar) so the scope is explicit in the section name. Add a one-line clarifier in `skills/roadmap.md` Interpreting Audit Findings: "`STALENESS: pass` only means no version-tag-annotated items are stale. It does not mean the roadmap is fresh — that's `FRESHNESS`'s job." _[bin/roadmap-audit, scripts/test-roadmap-audit.sh, skills/roadmap.md], ~30 lines._ (S)
- **Extend FRESHNESS scan to TODOS.md items** -- Currently the freshness scan walks ROADMAP.md only, so shipped items in `## Unprocessed` rot indefinitely (no version-tag annotation, files still exist, never auto-killed). Add `_inferred_freshness_for_todo` to `bin/roadmap-audit`: extract referenced file paths from `Proposed fix` / prose, run the per-file commit-since-introduction lookup, apply the same Track-ID-or-title-fuzzy-match rule from v0.17.1's bundled-PR fix. Surface candidates in the same FRESHNESS AskUserQuestion flow with options "Mark shipped (remove)" / "Still relevant". _[bin/roadmap-audit, scripts/test-roadmap-audit.sh, skills/roadmap.md], ~80 lines._ (M)

---

## Group 2: Distribution Infrastructure

Improvements to how /roadmap handles version transitions. Independent of
Group 1 but blocked on a major version bump to validate against.

### Track 2A: Major Version Transition Detection
_1 task . ~1 day (human) / ~20 min (CC) . medium risk . [bin/roadmap-audit, skills/roadmap.md]_
_touches: bin/roadmap-audit, skills/roadmap.md_

Depends on: at least one major version bump (0.x -> 1.x) to validate against.

- **Auto-detect major version boundary** -- When VERSION bumps to a new major (e.g., 0.x -> 1.x), /roadmap should detect the boundary and offer to promote items from the `## Future` section to the current scope. Add detection logic to `bin/roadmap-audit` and re-triage flow to `skills/roadmap.md`. _[bin/roadmap-audit, skills/roadmap.md], ~80 lines._ (M)

---

## Execution Map

```
Group 1: Install Pipeline + Audit Polish
  +-- Track 1A: Install Path Resolution ........ ~45 min CC ... 3 tasks
  +-- Track 1B: Roadmap Onboarding Helpers ..... ~30 min CC ... 2 tasks  (Depends on 1A)
  +-- Track 1C: Audit Recency Polish ........... ~55 min CC ... 2 tasks  (Depends on 1B)

                  |

Group 2: Distribution Infrastructure
  +-- Track 2A: Major Version Transition ....... ~20 min CC ... 1 task   (blocked: major version bump)
```

**Total: 2 groups . 4 tracks . 8 tasks**

---

## Future (Phase 1.x+)

Items triaged but deferred to a future phase. Not organized into Groups/Tracks.
Will be promoted to the current phase and structured when their time comes.

- **Multi-agent test orchestration** — Each test group assigned to a separate Conductor agent. session.yaml as coordination point, groups as independent files so agents don't conflict. Parallel testing for large suites (15-20 items). _Deferred because: depends on /pair-review v1 proven reliable and Conductor agent API maturity. L effort (~2 weeks human / ~2 hours CC)._
- **Shared-infra auto-detect from git history** — Compute the shared-infra list automatically by scanning the last 20 merged PRs for files modified in ≥40% of them. Replaces `docs/shared-infra.txt` hand-maintenance. _Deferred because: ships hand-curated list first; revisit after 4+ weeks of cohort usage. M effort (~1 day human / ~30 min CC)._
- **Cohort retrospective telemetry** — Log per-cohort merge outcomes (parallel tracks merged clean? hotfix count? mid-flight splits?) to `~/.gstack/analytics/cohort-outcomes.jsonl`. Data-driven tuning of the size-cap ceilings. _Deferred because: requires 10+ real cohorts of usage data before signal emerges. Pairs with `bin/config` ceiling overrides. M effort (~1 day human / ~40 min CC)._
- **Follow-up perf audit of remaining per-line bash loops in `bin/roadmap-audit`** — `count_todo_patterns` was rewritten single-pass awk in v0.9.0 (45s → 4s on this repo). Other per-line loops (state-machine parse in `_parse_roadmap`, `check_vocab_lint`, `check_structure`, `check_staleness`) may dominate on repos with ROADMAP.md >500 lines. _Deferred because: not a problem until a project hits the scale; keep audit interactive (<1s) when it is. M effort (~2 days human / ~30 min CC)._
- **CLAUDE.md cleanup skill** — New skill (e.g. `/claude-md-cleanup`) that audits a project's CLAUDE.md for bloat: duplicated info already in README/other docs, stale references to removed files/features, sections that should be pointers instead of inline content. Produces a streamlined CLAUDE.md with cross-references. _Deferred because: nice-to-have grooming, no acute pain. M effort (~2 days human / ~30 min CC)._
- **Evaluate `SKILL.md.tmpl` shared template (Approach A)** — If cross-cutting protocol grafts (Completion Status, Confusion Protocol, GSTACK REVIEW REPORT) start getting duplicated painfully across skills, promote them to a shared template. Pre-staged by v0.15.2 `<!-- SHARED:<block-name> -->` markers + verbatim-block test assertions. _Deferred because: drift-protection already shipped (v0.15.2); promote only when manual cross-skill edits become painful. L effort (~3 days human / ~1 hour CC)._
- **Tighten `git commit` failure handling across `/full-review`, `/pair-review`, `/review-apparatus`** — All three skills treat any non-zero `git commit` exit as "nothing to commit, continue." Silently swallows pre-commit hook rejections, missing `user.email`, detached-HEAD refusal. Risk: skill reports a commit that didn't land; work exists only as unstaged edits and can be lost silently. Fix: snapshot staged state via `git diff --cached --quiet` before commit; escalate BLOCKED with stderr tail when staging present but commit failed. Adversarial-flagged from /review on `kbitz/pair-review-assist` (2026-04-18). _Deferred because: data-loss risk is real but narrow (requires user with hooks rejecting). S effort (~2 hours human / ~20 min CC)._
- **Skill-file simplification pass — non-roadmap skills (v0.10–v0.15 accrual)** — Cross-cutting protocol grafts were appended rather than woven into the 4 remaining skills: `pair-review.md` (972 lines), `full-review.md` (747), `review-apparatus.md` (480), `test-plan.md` (857). Note: `roadmap.md` already trimmed 1253 → 517 in v0.17.0 signal-vs-verdict redesign — scope updated to exclude it. Strict scope discipline (only obvious dups, word-level redundancy, dead cross-refs) and shared-fragment canonicalization rules locked at /plan-eng-review 2026-04-24; gate on `scripts/test-skill-protocols.sh` passing unchanged. Lane A (extract canonical fragments + harness assertions) shipped in v0.15.2; Lanes B-F (per-skill trimming) remain. _Deferred because: motivating bloat (roadmap.md) is gone; remaining 4 skills not actively painful. L effort (~1 day human / ~1 hour CC)._
- **Codex host support in `setup`** — Add `--host claude|codex|auto` flag (and matching uninstall path) so Codex users can consume the 5 skills. Codex install layout: `~/.codex/skills/{skill-name}/SKILL.md`. Codex-specific gate: frontmatter `description:` ≤ 1024 chars hard-error (4 of 5 skills currently exceed; re-measure post-simplification). Probe pattern from Pre-flight 2 adds a third probe fallthrough for Codex layout. `scripts/test-update.sh` parameterized by host. _Deferred because: extend not blocking Codex adoption today; cleanest after Skill-file simplification settles description lengths. S-M effort (~3-5 hours human / ~30-45 min CC)._
- **`/full-review` pass on `scripts/`** — The test harnesses (test-roadmap-audit, test-update, test-skill-protocols, test-test-plan*, test-test-plan-extractor, test-test-plan-e2e) have grown to hundreds of assertions each by accretion. Run `/full-review` scoped to `scripts/` only (reviewer/hygiene/consistency-auditor agents) to surface dead fixtures, DRY violations across the 5 test files, inconsistent assertion patterns. _Deferred because: test suites are working; review is preventive maintenance, not blocking. S to kick off (~10 min); M to action findings (~half day human / ~30 min CC)._

---

## Unprocessed

Items awaiting triage by /roadmap. Added by other skills or manually.

