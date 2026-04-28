# Roadmap — Pre-1.0 (v0.x)

Organized as **Groups > Tracks > Tasks**. A Group is a wave of PRs that land
together — parallel-safe within, sequential between. Create a new Group
whenever (a) dependency ordering demands it, OR (b) parallel tasks would
collide on files. Within a Group, Tracks must be fully parallel-safe
(set-disjoint `_touches:_` footprints). Each track is one plan + implement
session.

---

## Group 1: Install Pipeline

Make the install system flexible enough for per-project usage and polish the
roadmap first-run experience. Most of this Group is shared-infra work that
touches cross-cutting files (`setup`, `bin/roadmap-audit`, `skills/*.md`),
so it's batched into Pre-flight and runs serially. Only the truly isolated
`bin/update-run` propagation remains as a parallel track.

**Pre-flight** (shared-infra; serial, one-at-a-time). Order: 2 → Track 1A → 3 → 4:
- **[2]** Preamble probe pattern — Skill preambles currently `readlink ~/.claude/skills/{name}/SKILL.md`, which silently breaks on non-default installs. Replace with gstack-core's probe pattern (`~/.claude/skills/{name}/SKILL.md` then `.claude/skills/{name}/SKILL.md`). For truly-custom paths, honor `$GSTACK_EXTEND_ROOT` env var and fallback to `$HOME/.gstack-extend-rc` (written by setup). Also fix `skills/test-plan.md:632` to point at `$_EXTEND_ROOT/skills/pair-review.md`. `[skills/*.md preambles (5 files), setup], ~40 lines.` (S)
- **[3]** Layout scaffolding for new projects — Add a `/roadmap init` subcommand that creates the correct directory structure (`docs/`, `docs/designs/`, `docs/archive/`) and offers to git-mv misplaced docs (consumes `bin/roadmap-audit DOC_LOCATION` findings). On destination collisions, AskUserQuestion with diff + merge/skip/abort options. `[bin/roadmap-audit, skills/roadmap.md], ~50 lines.` (S)
- **[4]** Doc type detection heuristic — Teach `bin/roadmap-audit` to emit `## DOC_TYPE_MISMATCH` for two strong-signal patterns: design-looking doc outside `docs/designs/` (mermaid/plantuml fence), inbox-looking doc outside `TODOS.md` (checkbox density >20%). Skip known ROOT_DOCS/DOCS_DIR_DOCS. Only emit rows where content disagrees with location. `[bin/roadmap-audit], ~40 lines.` (S)

### Track 1A: Update-Run Dir Propagation
_1 task . ~30 min (human) / ~15 min (CC) . low risk . [bin/update-run]_
_touches: bin/update-run_
_Depends on: Pre-flight 2 (requires the `$GSTACK_EXTEND_ROOT` env-var infrastructure). Pre-flight 1 (the `--skills-dir` flag itself) shipped in v0.16.0._

End-to-end support for custom install directories in the upgrade path. Partial
support was removed in v0.6.2 to avoid half-baked behavior.

- **Propagate dir to update-run** -- `bin/update-run` calls `setup` without passing through any custom dir. Read `$GSTACK_EXTEND_ROOT` env var (set by user shell, populated by Pre-flight 2's rc-file fallback when available). If set, pass `--skills-dir "$GSTACK_EXTEND_ROOT"` to `./setup`. If unset, default behavior (matches pre-Group-1 semantics). Regression test: install with `--skills-dir /tmp/foo`, trigger upgrade, confirm skills still resolve at `/tmp/foo`. _[bin/update-run], ~40 lines._ (S)

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
Group 1: Install Pipeline
  Pre-flight (shared-infra, serial) ... 3 items
  +-- Track 1A ..................... ~10 min ... 1 task

                  |

Group 2: Distribution Infrastructure
  +-- Track 2A ..................... ~20 min ... 1 task  (blocked: major version bump)
```

**Total: 2 groups . 2 tracks . 5 tasks (3 Pre-flight + 2 track tasks)**

---

## Future (Phase 1.x+)

Items triaged but deferred to a future phase. Not organized into Groups/Tracks.
Will be promoted to the current phase and structured when their time comes.

- **Multi-agent test orchestration** — Each test group assigned to a separate Conductor agent. session.yaml as coordination point, groups as independent files so agents don't conflict. Parallel testing for large suites (15-20 items). _Deferred because: depends on /pair-review v1 proven reliable and Conductor agent API maturity. L effort (~2 weeks human / ~2 hours CC)._
- **Shared-infra auto-detect from git history** — Compute the shared-infra list automatically by scanning the last 20 merged PRs for files modified in ≥40% of them. Replaces `docs/shared-infra.txt` hand-maintenance. _Deferred because: ships hand-curated list first; revisit after 4+ weeks of cohort usage. M effort (~1 day human / ~30 min CC)._
- **Cohort retrospective telemetry** — Log per-cohort merge outcomes (parallel tracks merged clean? hotfix count? mid-flight splits?) to `~/.gstack/analytics/cohort-outcomes.jsonl`. Data-driven tuning of the size-cap ceilings. _Deferred because: requires 10+ real cohorts of usage data before signal emerges. Pairs with `bin/config` ceiling overrides. M effort (~1 day human / ~40 min CC)._

---

## Unprocessed

Items awaiting triage by /roadmap. Added by other skills or manually.

