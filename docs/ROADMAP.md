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

## Phase 1: Bun Test Migration

**End-state:** all `scripts/test-*.sh` deleted; `bun test` is the sole
test entry point; `bin/roadmap-audit` is a compiled bun binary; the
4 leverage patterns from gstack proper (touchfiles, eval persistence,
LLM-as-judge, audit-compliance) are adopted.

**Groups:** 1, 2, 3, 4 (sequential).

**Scaffolding contract:**
- Group 1 landed `src/audit/lib/source-tag.ts` and `tests/source-tag.test.ts`
  in v0.18.4 — the source-tag library is the seed module the rest of the TS
  port consumes.
- Group 2 lands the rest of `src/audit/lib/*.ts` (semver, effort) plus the
  TS port itself; some helpers are unit-tested in Group 2 but not yet
  wired into checks until the Group 3 test-runner migration references
  them directly.

---

## Group 1: Bun Test Toolchain ✓ Complete

Bootstrap the bun test toolchain in isolation, prove the pattern on the
smallest existing bash test. Single-PR scope; lays the foundation for
Groups 2–4. Both bash and bun test suites coexist after this Group ships.

### Track 1A: Bootstrap bun + port source-tag lib + tests ✓ Complete

Shipped in v0.18.3 (2026-04-29). `package.json` (engines.bun >=1.0,
`scripts.test = "bun test tests/"`) and `tsconfig.json` (strict ESM,
`types: ["bun"]`) bootstrap the bun toolchain. `bunfig.toml` and
`tests/helpers/run-bin.ts` were dropped during /plan-eng-review —
defaults sufficed and there's nothing to shell out to (Track 2A's TS
port supersedes the run-bin helper). Track scope expanded under
adversarial review to include the source-tag library port itself
(`src/audit/lib/source-tag.ts`, 7 pure functions, `Result<T, Reason>`)
plus `tests/source-tag.test.ts` (118 tests / 216 expects, full coverage)
and `tests/fixtures/source-tag-hash-corpus.json` (30 byte-exact bash
parity fixtures). Whitespace-squeeze regression caught pre-merge — bash
`tr -s '[:space:]'` only collapses runs of *identical* whitespace, not
mixed; locked in by 7 corpus fixtures with internal control chars.

---

## Group 2: TypeScript Port of `bin/roadmap-audit`

The big one. Replace 3,495 lines of bash with `src/audit/{cli,parsers,
checks,lib}/*.ts`, compiled via `bun build --compile`. Snapshot suite is
the byte-for-byte oracle — Track 2A's first task tightens that oracle
before the port itself begins.

### Track 2A: Port `bin/roadmap-audit` to TypeScript
_2 tasks . ~3–5 days (human) / ~half-day (CC) . high risk . [src/audit/, bin/roadmap-audit, tests/]_
_touches: src/audit/**, bin/roadmap-audit, tests/roadmap-audit/**, tests/audit-parsers.test.ts, tests/lib-semver.test.ts, tests/lib-effort.test.ts_

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

### Track 2B: Cut `bin/roadmap-audit` over to TS implementation ✓ Complete

Shipped in v0.18.11.0 (2026-05-04). Track 2A landed the TS port at
`src/audit/**` as "dark code" — full byte-parity verified by
`tests/audit-shadow.test.ts`, but the binary at `bin/roadmap-audit` was
never wired up, so the shadow test ran every fixture twice (bash + TS) and
the snapshot suite still paid the bash cost. This Track makes the cutover:
`bin/roadmap-audit` becomes a 7-line POSIX-sh shim
(`exec bun "$(dirname "$0")/../src/audit/cli.ts" "$@"`), the parity check
`tests/audit-shadow.test.ts` is deleted (oracle and runner are now the
same code), and the manual touchfile entries for the audit tests gain
`src/audit/**` so audit code edits retrigger the snapshot suite.
**Measured impact:** `tests/audit-snapshots.test.ts` 111s → 7.3s (~15×),
full suite 113s → 32s (~3.5×). Phase 1's stated end-state ("`bin/roadmap-
audit` is a compiled bun binary") is met (shim, not `--compile` artifact —
trivially equivalent, simpler to deploy). Bash binary preserved in git
history at commit `e4f883b` (PR #58) for archaeology.

---

## Group 3: Test Runner Migration + Invariants

Now that the audit is TypeScript, replace the remaining bash test runners
with `bun test` equivalents and add the structural-invariants safety net.
After this Group ships, no bash test scripts remain.

### Track 3A: Migrate test runners + invariants test
_1 task . ~1 day (human) / ~3 hours (CC) . medium risk . [tests/, scripts/test-*.sh deleted]_
_touches: tests/audit-snapshots.test.ts, tests/audit-invariants.test.ts, tests/audit-cli-contract.test.ts, tests/update.test.ts, tests/skill-protocols.test.ts, tests/test-plan.test.ts, tests/test-plan-extractor.test.ts, tests/test-plan-e2e.test.ts, tests/score-extractor.test.ts, tests/parsers-group-tracks.test.ts, tests/parsers-pair-review-session.test.ts, tests/helpers/fixture-repo.ts, tests/helpers/run-bin.ts, src/audit/sections.ts, src/test-plan/parsers.ts, scripts/score-extractor.ts, scripts/verify-migration-parity.sh, tests/fixtures/extractor-corpus/_

Migrate 7 bash test scripts → bun test files. NEW
`tests/audit-invariants.test.ts` walks every `expected.txt`, asserts every
`## SECTION` has a `STATUS:` line, STATUS is in `CANONICAL_STATUSES`
(`pass / fail / warn / info / skip / found / none`), MODE is last,
section order matches `CANONICAL_SECTIONS` exported from
`src/audit/sections.ts` (with a fixture-lock invariant: const must match
observed fixture order). NEW `tests/audit-cli-contract.test.ts` locks
exit-code + stderr behavior beyond stdout (codex-flagged CLI contract gap).

Two awk pipelines from `test-test-plan-e2e.sh` lifted to pure functions
in `src/test-plan/parsers.ts` (parseGroupTracks, scanPairReviewSession),
each with ≥3 ugly-input unit tests. `--score` mode of
`test-test-plan-extractor.sh` extracted to `scripts/score-extractor.ts`
(documented exit codes 0/1/2, --help, 15-test unit suite). Extractor
corpus vendored to `tests/fixtures/extractor-corpus/` with provenance
headers (was `$HOME`-relative, kb-only).

`scripts/verify-migration-parity.sh` is the one-shot PR gate:
informational count check + BLOCKING named-scenario check (every
required describe in TS port). After merge, the gate is dead code (bash
files don't exist).

`tests/helpers/{fixture-repo.ts, run-bin.ts}` consolidate spawn-env
isolation; `audit-shadow.test.ts` refactored to consume them.

**Target:** `/ship` test runtime ~50s → ~30s after this Track lands; the
full ~10s arrives only when Track 2A's compile-binary cutover replaces
the bash `bin/roadmap-audit` (separate Track) and `audit-shadow.test.ts`
becomes obsolete.

- **Migrate bash test runners to bun + add invariants test + CLI contract test** -- 1:1 named-scenario parity of all 7 `scripts/test-*.sh` to `tests/*.test.ts`, plus `audit-invariants.test.ts` (NEW, fixture-locked) and `audit-cli-contract.test.ts` (NEW, exit-code + stderr). Helpers, parsers, scorer, and parity gate added. Delete bash scripts after gate passes. _[tests/, src/audit/sections.ts, src/test-plan/parsers.ts, scripts/{score-extractor.ts, verify-migration-parity.sh}, tests/fixtures/extractor-corpus/, scripts/test-*.sh deleted], ~1,400 lines new + ~3,000 lines deleted._ (L)

---

## Group 4: Test Leverage Patterns

Adopt gstack proper's higher-leverage test patterns once the foundation is
in place. After /plan-eng-review re-plan (`docs/designs/group-4-replan.md`,
2026-05-03): three Tracks (4A/4C/4D) plus a Pre-flight gate for 4A. The
original Track 4B (eval persistence + regression) was dropped to Future
because no Track in this codebase currently produces eval-store data. The
three remaining Tracks are file-disjoint and parallel-safe within Group 4
(modulo trivial additive merges on `package.json` + `CLAUDE.md ## Testing`).

**Pre-flight** (1 item, no code, ~30 min):
- **[4A-audit]** Timing + dependency audit for Track 4A — pick 3 recent merged PRs; for each, walk the import graph that 4A would build to compute which subset of tests selection would run; estimate saved wall-clock as `(1 − selected/27) × 117s − 5s wrapper overhead` (suite measured at 117s on 2026-05-03). Median across 3 PRs is the metric. **Greenlight** ≥40% saved (≥45s); **judgment** 25–40%; **kill** <25%. Result recorded inline in `docs/designs/group-4-replan.md` or PROGRESS.md before Track 4A starts. _[no code], ~0 lines._ (S)

### Track 4A: Touchfiles diff selection
_1 task . ~3–4 days (human) / ~half-day (CC) . medium risk . [hybrid TS import graph + manual map; ~630 lines]_
_touches: tests/helpers/touchfiles.ts, tests/helpers/fixture-repo.ts, scripts/select-tests.ts, tests/touchfiles.test.ts, package.json, CLAUDE.md, README.md_
_Depends on: Pre-flight `4A-audit` greenlight. Killable cheap if audit fails._

/plan-eng-review (kbitz/groups-2-3-status, 2026-05-03) shifted approach
from manual touchfiles globs to a hybrid: static TS import graph for
`tests/*.test.ts` → `src/**/*.ts` edges plus a small manual map for non-TS
deps (shell bins, fixtures, skills, docs, configs). Wrapper is
`scripts/select-tests.ts` with 4 safety fallbacks (empty diff / no base /
global hit / non-empty-but-zero-selected → all run all), argv passthrough
(`bun test --watch foo` bypasses selection), signal forwarding,
`TOUCHFILES_BASE` env override for stacked branches, `--name-status` git
diff so renames track both sides. Three invariants in
`tests/touchfiles.test.ts`: every glob in MANUAL/GLOBAL touchfiles matches
≥1 file; every test reachable via import graph or manual map; every
manual key resolves to an existing path. Pre-task hardens
`tests/helpers/fixture-repo.ts` `makeEmptyRepo` with spawn exit-code
checks (codex C3) — inlined into the Track, no separate Pre-flight.
Bumped from M (~150 LOC) to L (~630 LOC) post-codex.

- **Diff-based test selection (hybrid import graph)** -- port `matchGlob` from gstack proper, add `analyzeTestImports` (TS AST walk → resolved src paths), `computeTestSelection` (graph + manual map + globals), `detectBaseBranch`, `getChangedFiles` (--name-status with rename pairs), MANUAL_TOUCHFILES (~10 entries) + GLOBAL_TOUCHFILES (5 entries). Wrapper script with 4 fallbacks, argv passthrough, signal propagation. Test suite: units + invariants + 7 E2E scenarios. Wire `package.json scripts.test` + `scripts.test:full`; document in CLAUDE.md + README. Inlines `makeEmptyRepo` hardening. _[tests/helpers/touchfiles.ts, tests/helpers/fixture-repo.ts, scripts/select-tests.ts, tests/touchfiles.test.ts, package.json, CLAUDE.md, README.md], ~630 lines._ (L)

### Track 4C: Skill prose corpus + in-session judging routing rule ✓ Complete
_1 task . ~1 hour (human) / ~30 min (CC) . low risk . [4-fixture corpus + CLAUDE.md routing rule]_
_touches: tests/fixtures/skill-prose-corpus/, CLAUDE.md, docs/PROGRESS.md, CHANGELOG.md_

Shipped in v0.18.11.0 (2026-05-04). The eng-review (kbitz/llm-judge-skill-prose,
2026-05-03) originally locked an SDK-driven path: `callJudge<T>(prompt, validator)`
helper, mocked unit tests, and a paid `tests/skill-llm-eval.test.ts` gated on
`EVALS=1` + `ANTHROPIC_API_KEY`. The plan was implemented end-to-end and reviewed
during /ship — and reconsidered: the test only runs on machines that already
have `claude` authenticated (it never runs in CI), so requiring a separate API
key plus a separate Anthropic SDK dependency was setup friction with no
ecological payoff. The SDK path was deleted before merge. Final shape:

- 4-fixture corpus at `tests/fixtures/skill-prose-corpus/` (3 positive examples
  for `/roadmap` reassessment, `/test-plan` extraction, `/pair-review` test-list
  output, plus one shallow negative control). Each fixture carries rich
  provenance (source skill commit + repo commit + input prompt + generation
  model + UTC timestamp + worktree state) so future replacements with real
  captures preserve the structural contract.
- Routing rule in `CLAUDE.md ## Testing`: when `skills/*.md` is edited in a
  session, Claude proactively recommends judging the changed prose against
  the corpus and the three-axis rubric (clarity / completeness / actionability,
  1–5 each, ≥3 expected on positives, ≤2 expected on at least one axis for the
  control) in-session. No new code, no new dependency, no new env var, no
  separate billing — uses the existing Claude Code session with prompt caching
  across fixtures.
- The two follow-up Future entries the SDK path required (tool-use migration,
  judge-floor tightening 3 → 4) are obsolete in this shape — they assumed a
  scheduled paid run that no longer exists.

### Track 4D: Audit-compliance test for gstack-extend invariants ✓ Complete

Shipped in v0.18.10.0 (PR #62, 2026-05-04). `tests/audit-compliance.test.ts` (23 tests) covers (A) frontmatter sanity for every `skills/*.md`, (B) `setup` ↔ `skills/*.md` symmetry, (C) source-tag registry consistency. Adds the `REGISTERED_SOURCES` export to `src/audit/lib/source-tag.ts`. Also: `discovered` added to `docs/source-tag-contract.md` grammar list; one TODO retagged `[design]` → `[review]`.

<details><summary>Original plan</summary>

_1 task . ~1 day (human) / ~2 hours (CC) . low risk . [3 describes + REGISTERED_SOURCES export]_
_touches: tests/audit-compliance.test.ts, src/audit/lib/source-tag.ts, docs/source-tag-contract.md, docs/TODOS.md_

/plan-eng-review (kbitz/audit-invariants-test, 2026-05-03) locked: three
describes — (A) frontmatter sanity (4 checks per skill: `---` fence,
`name === filename`, `description:` present, `allowed-tools:` present);
(B) `setup` ↔ `skills/*.md` symmetric (forward + reverse); (C) source-tag
registry consistency (imports `REGISTERED_SOURCES` from
`src/audit/lib/source-tag.ts`, asserts `docs/source-tag-contract.md`
matches). Doc fix: add `discovered` to `source-tag-contract.md` grammar
list (codex finding 10). Data fix: retag the existing `### [design]` TODO
entry to `[review]`. Adds the `REGISTERED_SOURCES` export to
`src/audit/lib/source-tag.ts`. Two follow-up TODOs deferred to Future
(audit fail-taxonomy calibration, SKILLS list dedup helper).

- **Audit-compliance test for structural invariants** -- write `tests/audit-compliance.test.ts` with the three describes above; export `REGISTERED_SOURCES` from `src/audit/lib/source-tag.ts`; add `discovered` to grammar list in `docs/source-tag-contract.md`; retag one existing TODO entry. _[tests/audit-compliance.test.ts, src/audit/lib/source-tag.ts, docs/source-tag-contract.md, docs/TODOS.md], ~150 lines._ (M)

</details>

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
  +-- Track 1A ..................... ✓ Complete (v0.18.3)

Group 2: TypeScript Port of bin/roadmap-audit
  +-- Track 2A ..................... ~half-day CC ... 2 tasks (S + XL)

Group 3: Test Runner Migration + Invariants
  +-- Track 3A ..................... ~2 hr CC ... 1 task

Group 4: Test Leverage Patterns
  Pre-flight (gate, no code) ......... 1 item (4A-audit)
  +-- Track 4A ..................... ~half-day CC ... 1 task (gated)
  +-- Track 4C ..................... ~3 hr CC ... 1 task
  +-- Track 4D ..................... ~2 hr CC ... 1 task

Group 5: Install Pipeline
  Pre-flight (shared-infra, serial) ... 3 items
  +-- Track 5A ..................... ~15 min CC ... 1 task

Group 6: Distribution Infrastructure
  +-- Track 6A ..................... ~20 min CC ... 1 task  (waits for 0.x → 1.x bump)
```

**Total: 6 groups . 7 tracks . 13 tasks (4 Pre-flight + 9 track tasks)**

---

## Future (Phase 1.x+)

Items triaged but deferred to a future phase. Not organized into Groups/Tracks.
Will be promoted to the current phase and structured when their time comes.

- **Multi-agent test orchestration** — Each test group assigned to a separate Conductor agent. session.yaml as coordination point, groups as independent files so agents don't conflict. Parallel testing for large suites (15-20 items). _Deferred because: depends on /pair-review v1 proven reliable and Conductor agent API maturity. L effort (~2 weeks human / ~2 hours CC)._
- **Shared-infra auto-detect from git history** — Compute the shared-infra list automatically by scanning the last 20 merged PRs for files modified in ≥40% of them. Replaces `docs/shared-infra.txt` hand-maintenance. _Deferred because: ships hand-curated list first; revisit after 4+ weeks of cohort usage. M effort (~1 day human / ~30 min CC)._
- **Cohort retrospective telemetry** — Log per-cohort merge outcomes (parallel tracks merged clean? hotfix count? mid-flight splits?) to `~/.gstack/analytics/cohort-outcomes.jsonl`. Data-driven tuning of the size-cap ceilings. _Deferred because: requires 10+ real cohorts of usage data before signal emerges. Pairs with `bin/config` ceiling overrides. M effort (~1 day human / ~40 min CC)._
- **Eval persistence + reader + comparator + regression gate** (full original Track 4B scope) — Port `tests/helpers/eval-store.ts` from gstack proper (types, `getProjectEvalDir` with lazy memoization + design-doc fallback, transcript writer); reader (`findPreviousRun`, `compareEvalResults`, `extractToolSummary`, `totalToolCount`, `findBudgetRegressions`, `assertNoBudgetRegression`, `runBudgetCheck`); active `tests/skill-budget-regression.test.ts`. Lift the locked decisions D3/D6/D7/D8/D9/D10/D11/D14 from the original 4B /plan-eng-review. _Deferred because: no Track in this codebase currently produces eval-store data; shipping types + a skipped test alone would just bury infrastructure under a permanently-skipped test. Unblocks the day a Track that captures skill transcripts exists. M effort (~400–500 LOC including active tests)._
- **gbrain-sync allowlist for `~/.gstack/projects/*/evals/`** — Once a transcript producer exists, add the evals dir to gbrain-sync's allowlist (or denylist) in gstack proper so transcripts don't auto-sync to a private GitHub repo. _Deferred because: requires the producer to land first so the privacy surface is observable; cross-repo (gstack proper, not gstack-extend). S effort (~30 min)._
- **Eval dir retention / pruning policy** — Time-based ('drop files >30 days'), count-based ('keep last N per branch + tier'), or scenario-indexed ('prune older runs of the same {skill, scenario, model}') pruning of `~/.gstack/projects/<slug>/evals/`. _Deferred because: no eval-write rate exists yet to design against; pairs with the eval-persistence Track above. S–M effort (~2–4 hrs)._
- **Audit fail-taxonomy calibration** — Review `bin/roadmap-audit` STATUS emit decisions; downgrade `ARCHIVE_CANDIDATES` to warn; design narrow waiver mechanism for `SIZE` (per-track + reason + optional expiry, NOT vague italic markers). Surfaced during Track 4D /plan-eng-review when audit emitted 3 `STATUS: fail` sections, only 1 of which was real structural drift. _Deferred because: a separate /plan-eng-review on the audit's policy surface, not Group 4 scope. M effort (~3 hrs)._
- **Deduplicate SKILLS list across `setup` + `tests/skill-protocols.test.ts`** — Once Track 4D's setup-parser ships, extract to `tests/helpers/parse-setup-skills.ts` and consume from `tests/skill-protocols.test.ts`. Closes the third drift channel for the canonical skill list. _Deferred because: depends on Track 4D landing first. S effort (~30 min)._

---

## Unprocessed

Items awaiting triage by /roadmap. Added by other skills or manually.

