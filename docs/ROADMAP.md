# Roadmap — Pre-1.0 (v0.x)

Organized as **Groups > Tracks > Tasks**. A Group is a wave of PRs that land
together — parallel-safe within, sequential between. Create a new Group
whenever (a) dependency ordering demands it, OR (b) parallel tasks would
collide on files. Within a Group, Tracks must be fully parallel-safe
(set-disjoint `_touches:_` footprints). Each track is one plan + implement
session.

Execution order follows the adjacency list in the Execution Map below.
Groups 1–4 (bun + TypeScript test infrastructure, per
`docs/designs/bun-test-architecture.md`) sequence first; Groups 5 and 6
(install pipeline, distribution) follow because both touch
`bin/roadmap-audit` and would collide mid-port if they ran in parallel
with the test-infra chain.

---

## Group 1: Bun Test Toolchain

Bootstrap the bun test toolchain in isolation, prove the pattern on the
smallest existing bash test. Single-PR scope; lays the foundation for
Groups 2–4. Both bash and bun test suites coexist after this Group ships.

### Track 1A: Bootstrap bun + port test-source-tag.sh
_1 task . ~1 day (human) / ~1 hour (CC) . low risk . [package.json, tsconfig.json, bunfig.toml, tests/]_
_touches: package.json, tsconfig.json, bunfig.toml, tests/helpers/run-bin.ts, tests/source-tag.test.ts_

Add `package.json` (engines.bun >=1.0, no runtime deps), `tsconfig.json`
(strict ESM), `bunfig.toml` (test config). Write
`tests/helpers/run-bin.ts` for invoking shell binaries from tests. Port
`scripts/test-source-tag.sh` (75 assertions, 352 LOC, standalone) to
`tests/source-tag.test.ts` as the proof-of-concept. `/ship` runs both
bash and bun suites until later Groups retire bash.

- **Bootstrap bun test toolchain** -- add `package.json`, `tsconfig.json`, `bunfig.toml`, `tests/helpers/run-bin.ts`, and port `scripts/test-source-tag.sh` to `tests/source-tag.test.ts` with parity. _[package.json, tsconfig.json, bunfig.toml, tests/], ~150 lines._ (S)

---

## Group 2: TypeScript Port of `bin/roadmap-audit`

The big one. Replace 3,495 lines of bash with `src/audit/{cli,parsers,
checks,lib}/*.ts`, compiled via `bun build --compile`. Snapshot suite is
the byte-for-byte oracle — Track 2A's first task tightens that oracle
before the port itself begins.

### Track 2A: Port `bin/roadmap-audit` to TypeScript
_2 tasks . ~3–5 days (human) / ~half-day (CC) . high risk . [src/audit/, bin/roadmap-audit, tests/]_
_touches: src/audit/**, bin/roadmap-audit, tests/roadmap-audit/**, tests/audit-parsers.test.ts, tests/lib-semver.test.ts, tests/lib-effort.test.ts, tests/lib-source-tag.test.ts_

Behavior-preserving port against all `expected.txt` fixtures byte-for-byte.
First task adds coverage-gap fixtures to tighten the oracle; second task
does the port itself. Split the TS into `parsers/` (roadmap.ts, todos.ts,
progress.ts), `checks/` (one file per `## SECTION`, ~22 sections), `lib/`
(semver.ts, source-tag.ts, effort.ts). Compile via `bun build --compile
src/audit/cli.ts --outfile bin/roadmap-audit`. Snapshot runner stays bash
for this Track — it just retargets the new binary. The freshness
`git log -S` scan stays as a shell-out (the one place where shelling is
right). Add unit tests for parsers and lib modules — currently only
tested via full-audit snapshot runs. **Targets:** real-repo audit <5s
(vs 70s), binary <2,000 lines TS (vs 3,495 bash), snapshot suite <5s
(vs ~25s). XL track — accepted size warning; bounded by snapshot oracle.

- **Coverage-gap audit fixtures** -- walk v0.10–v0.18 CHANGELOG entries that added test cases to `scripts/test-roadmap-audit.sh`, identify edge cases not represented in the 14 snapshot fixtures (DAG cycles, name-anchor with spaces, `_serialize: true_` variants, compact-bullet form, `Depends on:` trailing prose, `complete_groups` detection, `in_flight_topo` doc-order tiebreaker). Add fixtures for any gaps before the port starts so the oracle is tight. _[tests/roadmap-audit/**], ~5–10 new fixtures (~30 lines)._ (S)
- **Behavior-preserving TS port of `bin/roadmap-audit`** -- write `src/audit/{cli,parsers,checks,lib}/*.ts`, compile to `bin/roadmap-audit` via `bun build --compile`, verify all snapshot fixtures pass byte-for-byte, add parser/lib unit tests. _[src/audit/**, bin/roadmap-audit, tests/audit-parsers.test.ts, tests/lib-*.test.ts], ~1,500–2,000 lines new + 3,495 lines deleted._ (XL)

---

## Group 3: Test Runner Migration + Invariants

Now that the audit is TypeScript, replace the remaining bash test runners
with `bun test` equivalents and add the structural-invariants safety net.
After this Group ships, no bash test scripts remain.

### Track 3A: Migrate test runners + invariants test
_1 task . ~1 day (human) / ~2 hours (CC) . medium risk . [tests/, scripts/test-*.sh deleted]_
_touches: tests/audit-snapshots.test.ts, tests/update.test.ts, tests/skill-protocols.test.ts, tests/test-plan.test.ts, tests/test-plan-extractor.test.ts, tests/test-plan-e2e.test.ts, tests/audit-invariants.test.ts_

Migrate `scripts/test-roadmap-audit.sh` → `tests/audit-snapshots.test.ts`
(~50 lines), `test-update.sh` → `tests/update.test.ts`,
`test-skill-protocols.sh` → `tests/skill-protocols.test.ts`,
`test-test-plan*.sh` → `tests/test-plan*.test.ts`. Add
`tests/audit-invariants.test.ts` — walks every `expected.txt`, asserts
every `## SECTION` has a `STATUS:` line, STATUS is in the canonical set
(`pass / fail / warn / info / skip / found / none`), MODE is the last
section, section order matches a canonical list. ~30 lines. Trips on
rubber-stamp `UPDATE_SNAPSHOTS=1` even when 14 fixtures all pass.
Concurrent execution is free with `bun test`. **Target:** `/ship` test
runtime ~50s → ~10s.

- **Migrate bash test runners to bun + add invariants test** -- 1:1 migration of all `scripts/test-*.sh` to `tests/*.test.ts`, plus `tests/audit-invariants.test.ts`. Delete the bash scripts after parity. _[tests/, scripts/test-*.sh deleted], ~250 lines new + ~3,000 lines deleted._ (M)

---

## Group 4: Test Leverage Patterns

Adopt gstack proper's higher-leverage test patterns once the foundation is
in place. The four sub-tasks are independent (different file footprints) —
parallel-safe within Group 4. Pull each in based on actual pain.

### Track 4A: Touchfiles diff selection
_1 task . ~1 day (human) / ~1 hour (CC) . low risk . [tests/helpers/touchfiles.ts]_
_touches: tests/helpers/touchfiles.ts, tests/audit-snapshots.test.ts, tests/update.test.ts, tests/skill-protocols.test.ts, tests/test-plan.test.ts, tests/source-tag.test.ts_

Copy gstack proper's `touchfiles.ts` pattern. Each test declares source
dependencies as glob patterns; `git diff` against base branch selects
which subset to run; `EVALS_ALL=1` overrides. Highest leverage for `/ship`
runtime — most PRs only touch one area.

- **Diff-based test selection** -- port `touchfiles.ts` from gstack proper, declare per-test source-file globs, integrate with `bun test` selection. _[tests/helpers/touchfiles.ts, tests/*.test.ts], ~150 lines._ (M)

### Track 4B: Eval persistence + budget regression
_1 task . ~2 days (human) / ~2 hours (CC) . medium risk . [tests/helpers/eval-store.ts, tests/skill-budget-regression.test.ts]_
_touches: tests/helpers/eval-store.ts, tests/skill-budget-regression.test.ts, ~/.gstack/projects/<slug>/evals/_

Persist skill-run eval data to `~/.gstack/projects/<slug>/evals/` (share
gstack proper's directory). Add `tests/skill-budget-regression.test.ts`
that fails when latest run >2× prior on the same branch in tool calls or
turns. Free, gate-tier — no LLM cost; pure comparison.

- **Eval persistence + budget regression test** -- port `eval-store.ts` and `skill-budget-regression.test.ts` from gstack proper, share `~/.gstack/projects/<slug>/evals/` dir. _[tests/helpers/eval-store.ts, tests/skill-budget-regression.test.ts], ~300 lines._ (M)

### Track 4C: LLM-as-judge for skill prose
_1 task . ~2 days (human) / ~3 hours (CC) . medium risk . [tests/helpers/llm-judge.ts, tests/skill-llm-eval.test.ts]_
_touches: tests/helpers/llm-judge.ts, tests/skill-llm-eval.test.ts_

Copy gstack proper's `callJudge<T>` helper. Score `/roadmap` reassessment,
`/test-plan` extraction, `/pair-review` test list quality on
`clarity / completeness / actionability` (1–5 each) using Sonnet. Gate
behind `EVALS=1` (paid). Cost: ~$0.05–0.15 per run.

- **LLM-as-judge for skill prose quality** -- port `llm-judge.ts` from gstack proper, write `tests/skill-llm-eval.test.ts` scoring the three skills, gate via `EVALS=1`. _[tests/helpers/llm-judge.ts, tests/skill-llm-eval.test.ts], ~250 lines._ (M)

### Track 4D: Audit-compliance test for gstack-extend invariants
_1 task . ~1 day (human) / ~2 hours (CC) . low risk . [tests/audit-compliance.test.ts]_
_touches: tests/audit-compliance.test.ts_

Mirror gstack proper's `audit-compliance.test.ts` pattern, but for
gstack-extend invariants: skill files have correct frontmatter, every
skill listed in `setup` has a corresponding `skills/*.md`, no
`[source-tag]` bracket appears outside the documented set in
`docs/source-tag-contract.md`. Catches structural regressions even when
behavior tests pass.

- **Audit-compliance test for structural invariants** -- write `tests/audit-compliance.test.ts` with the gstack-extend-specific assertions above. _[tests/audit-compliance.test.ts], ~150 lines._ (M)

---

## Group 5: Install Pipeline

The `--skills-dir` flag (originally this Group's first Pre-flight item)
shipped in v0.16.0; the rest follows Group 4 because Pre-flight 3, 4, and
Group 6 all touch `bin/roadmap-audit`, which is being ported in Group 2.

Make the install system flexible enough for per-project usage and polish the
roadmap first-run experience. Most of this Group is shared-infra work that
touches cross-cutting files (`setup`, `bin/roadmap-audit`, `skills/*.md`),
so it's batched into Pre-flight and runs serially. Only the truly isolated
`bin/update-run` propagation remains as a parallel track.

**Pre-flight** (shared-infra; serial, one-at-a-time). Order: 2 → Track 5A → 3 → 4:
- **[2]** Preamble probe pattern — Skill preambles currently `readlink ~/.claude/skills/{name}/SKILL.md`, which silently breaks on non-default installs. Replace with gstack-core's probe pattern (`~/.claude/skills/{name}/SKILL.md` then `.claude/skills/{name}/SKILL.md`). For truly-custom paths, honor `$GSTACK_EXTEND_ROOT` env var and fallback to `$HOME/.gstack-extend-rc` (written by setup). Also fix `skills/test-plan.md:632` to point at `$_EXTEND_ROOT/skills/pair-review.md`. `[skills/*.md preambles (5 files), setup], ~40 lines.` (S)
- **[3]** Layout scaffolding for new projects — Add a `/roadmap init` subcommand that creates the correct directory structure (`docs/`, `docs/designs/`, `docs/archive/`) and offers to git-mv misplaced docs (consumes `bin/roadmap-audit DOC_LOCATION` findings). On destination collisions, AskUserQuestion with diff + merge/skip/abort options. `[bin/roadmap-audit, skills/roadmap.md], ~50 lines.` (S)
- **[4]** Doc type detection heuristic — Teach `bin/roadmap-audit` to emit `## DOC_TYPE_MISMATCH` for two strong-signal patterns: design-looking doc outside `docs/designs/` (mermaid/plantuml fence), inbox-looking doc outside `TODOS.md` (checkbox density >20%). Skip known ROOT_DOCS/DOCS_DIR_DOCS. Only emit rows where content disagrees with location. `[bin/roadmap-audit], ~40 lines.` (S)

### Track 5A: Update-Run Dir Propagation
_1 task . ~30 min (human) / ~15 min (CC) . low risk . [bin/update-run]_
_touches: bin/update-run_
_Depends on: Pre-flight 2 (requires the `$GSTACK_EXTEND_ROOT` env-var infrastructure). Pre-flight 1 (the `--skills-dir` flag itself) shipped in v0.16.0._

End-to-end support for custom install directories in the upgrade path. Partial
support was removed in v0.6.2 to avoid half-baked behavior.

- **Propagate dir to update-run** -- `bin/update-run` calls `setup` without passing through any custom dir. Read `$GSTACK_EXTEND_ROOT` env var (set by user shell, populated by Pre-flight 2's rc-file fallback when available). If set, pass `--skills-dir "$GSTACK_EXTEND_ROOT"` to `./setup`. If unset, default behavior (matches pre-Group-5 semantics). Regression test: install with `--skills-dir /tmp/foo`, trigger upgrade, confirm skills still resolve at `/tmp/foo`. _[bin/update-run], ~40 lines._ (S)

---

## Group 6: Distribution Infrastructure

Improvements to how /roadmap handles version transitions. Independent of
Group 5 but blocked on a major version bump to validate against.

### Track 6A: Major Version Transition Detection
_1 task . ~1 day (human) / ~20 min (CC) . medium risk . [bin/roadmap-audit, skills/roadmap.md]_
_touches: bin/roadmap-audit, skills/roadmap.md_

Depends on: at least one major version bump (0.x -> 1.x) to validate against.

- **Auto-detect major version boundary** -- When VERSION bumps to a new major (e.g., 0.x -> 1.x), /roadmap should detect the boundary and offer to promote items from the `## Future` section to the current scope. Add detection logic to `bin/roadmap-audit` and re-triage flow to `skills/roadmap.md`. _[bin/roadmap-audit, skills/roadmap.md], ~80 lines._ (M)

---

## Execution Map

Adjacency list:
```
- Group 1 ← {}
- Group 2 ← {1}
- Group 3 ← {2}
- Group 4 ← {3}
- Group 5 ← {4}
- Group 6 ← {5}  (Track 6A also waits for an external 0.x → 1.x bump)
```

Track detail per group:
```
Group 1: Bun Test Toolchain
  +-- Track 1A ..................... ~1 hr CC ... 1 task

Group 2: TypeScript Port of bin/roadmap-audit
  +-- Track 2A ..................... ~half-day CC ... 2 tasks (S + XL)

Group 3: Test Runner Migration + Invariants
  +-- Track 3A ..................... ~2 hr CC ... 1 task

Group 4: Test Leverage Patterns
  +-- Track 4A ..................... ~1 hr CC ... 1 task
  +-- Track 4B ..................... ~2 hr CC ... 1 task
  +-- Track 4C ..................... ~3 hr CC ... 1 task
  +-- Track 4D ..................... ~2 hr CC ... 1 task

Group 5: Install Pipeline
  Pre-flight (shared-infra, serial) ... 3 items
  +-- Track 5A ..................... ~15 min CC ... 1 task

Group 6: Distribution Infrastructure
  +-- Track 6A ..................... ~20 min CC ... 1 task  (waits for 0.x → 1.x bump)
```

**Total: 6 groups . 8 tracks . 13 tasks (3 Pre-flight + 10 track tasks)**

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

