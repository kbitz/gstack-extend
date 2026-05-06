# bun + TypeScript test architecture

Status: design (2026-04-29). Author: kb. Supersedes the prior `[manual] Port
`bin/roadmap-audit` out of bash` TODO (Python/Node alternatives).

## Why

Two problems compound on each other:

1. **`bin/roadmap-audit` is 3,495 lines of bash.** ~272 command substitutions
   per run, ~70s on this repo's own ROADMAP.md. The language is wrong for a
   markdown parser + topology analyzer + JSON emitter. Slow audit = sluggish
   `/roadmap`.
2. **Test scripts are bash assertion suites** (`scripts/test-*.sh`,
   ~3,000 LOC across 7 files). Sequential, no diff-based selection, no
   structural-invariants safety net behind `UPDATE_SNAPSHOTS=1`. The v0.18.1
   snapshot redesign cut `/ship` time 5–7 min → ~50s but didn't change the
   bash-on-bash architecture.

gstack proper solved both in TypeScript with `bun test` two years ago. We
already have bun installed (gstack proper requires it), and the snapshot
fixtures we just shipped are language-agnostic — they survive a port unchanged
as golden files.

## What

Mirror gstack proper's architecture:

- **`bin/roadmap-audit` is a compiled bun binary** (`bun build --compile`)
  built from `src/audit/*.ts`. Single binary, zero runtime deps, ~25ms cold
  start.
- **All `scripts/test-*.sh` become `tests/*.test.ts`** running under
  `bun test --concurrent`. Same fixtures, same `expected.txt` files, just a
  faster runner.
- **Diff-based test selection** via touchfiles (gstack proper's pattern):
  each test declares source-file globs; `git diff` decides which subset runs.
- **Structural-invariants test** as a safety net against rubber-stamp
  `UPDATE_SNAPSHOTS=1`.
- **Optional later** (Phase 4): LLM-as-judge for skill prose quality, eval
  persistence, budget regression on skill runs.

## Goal state

```
package.json                       # engines.bun >=1.0, scripts.test
tsconfig.json
bunfig.toml

bin/
  roadmap-audit                    # compiled binary (was 3,495-line bash)
  roadmap-revise, roadmap-route    # remain bash for now (small, stable)
  update-check, update-run         # remain bash (release tooling)

src/audit/
  cli.ts                           # entry, arg parsing, output composition
  parsers/
    roadmap.ts                     # Group/Track/Task parser
    todos.ts                       # TODO format detection
    progress.ts                    # version table parser
  checks/
    vocab-lint.ts, structure.ts,   # one file per ## SECTION (~22 sections)
    staleness.ts, version.ts, ...
  lib/
    semver.ts                      # was bin/lib/semver.sh
    source-tag.ts                  # was bin/lib/source-tag.sh
    effort.ts                      # was bin/lib/effort.sh

tests/
  audit-snapshots.test.ts          # was scripts/test-roadmap-audit.sh
  audit-invariants.test.ts         # NEW: structural safety net
  audit-parsers.test.ts            # NEW: unit tests for parsers
  source-tag.test.ts               # was scripts/test-source-tag.sh
  test-plan.test.ts                # was scripts/test-test-plan*.sh
  update.test.ts                   # was scripts/test-update.sh
  skill-protocols.test.ts          # was scripts/test-skill-protocols.sh
  helpers/
    run-bin.ts                     # invoke shell binaries from tests
    touchfiles.ts                  # diff-based test selection
    llm-judge.ts                   # (Phase 4) LLM-as-judge
  roadmap-audit/                   # 14 fixture dirs unchanged

scripts/                           # non-test scripts only after migration
```

## Non-goals

- **No Python.** Adds a runtime dep gstack-extend doesn't need; bun is
  already there.
- **No standalone-without-gstack install.** README says "Extension skills
  for gstack" — bun-via-gstack is presumed.
- **No port of `bin/roadmap-revise` / `bin/roadmap-route` / update tooling.**
  They're small, stable, and shelling-out is the right call. Only audit gets
  ported.
- **No multi-provider e2e harness.** gstack proper tests Claude + Codex +
  Gemini; gstack-extend is bash skills + one TS binary, not that scope.

## Phasing

Each phase is independently shippable. Stop at any phase if priorities shift.

### Phase 1 — Bootstrap bun test infrastructure

Land the toolchain in isolation, prove the pattern on the smallest existing
test.

**Add:**
- `package.json` (engines.bun >=1.0, scripts.test, scripts.test:audit, no
  runtime deps)
- `tsconfig.json` (strict, ESM, target ESNext)
- `bunfig.toml` (test config: retry, preload)
- `tests/helpers/run-bin.ts` (invoke `bin/*` shell binaries, capture stdout,
  normalize paths)
- `tests/source-tag.test.ts` (port `scripts/test-source-tag.sh`, 75
  assertions, 352 LOC, standalone — no audit dependency, smallest scope)

**Keep:** all existing `scripts/test-*.sh` running. `/ship` test phase
invokes both bash and bun suites until migration completes.

**Exit:** `bun test` runs, `tests/source-tag.test.ts` passes with parity to
`scripts/test-source-tag.sh`, `/ship` green on both.

### Phase 2 — Port `bin/roadmap-audit` to TypeScript

Snapshot suite is the oracle, so the port is bounded.

**Pre-work (separate PR):** coverage-gap audit. Walk v0.10–v0.18 CHANGELOG
entries that added test cases, identify edge cases not represented in the 14
fixtures (DAG cycles, name-anchor with spaces, `_serialize: true_` variants,
compact-bullet form, `Depends on:` trailing prose, `complete_groups`
detection, `in_flight_topo` doc-order tiebreaker). Add fixtures for any gaps.
Tightens the oracle before the port.

**Port:**
- Build pipeline: `bun build --compile src/audit/cli.ts --outfile bin/roadmap-audit`
- Behavior-preserving against all `expected.txt` fixtures (byte-for-byte).
- Split into `parsers/`, `checks/`, `lib/` — easier to unit-test than the
  bash monolith.
- Ship compiled binary in releases (or commit to `bin/` like gstack does
  with `browse/dist/browse`).

**Add unit tests** for parsers and lib modules:
- `tests/audit-parsers.test.ts` — markdown parsing edge cases the snapshots
  catch only transitively
- `tests/lib-semver.test.ts`, `tests/lib-effort.test.ts` — direct tests for
  helper modules (currently only tested via full audit invocations)

**Snapshot runner stays bash** for this phase. Just retargets the new
binary. Migration of the runner happens in Phase 3.

**Targets:** real-repo audit <5s (vs 70s), binary <2,000 lines TS (vs 3,495
bash), snapshot suite <5s (vs ~25s).

**Exit:** all 14 (+gap-fix) fixtures pass byte-for-byte;
`bin/roadmap-audit.bash.bak` for one release, then deleted.

### Phase 3 — Migrate test runners to bun

Now that the audit is TS, replace the bash test runners.

**Migrate:**
- `scripts/test-roadmap-audit.sh` → `tests/audit-snapshots.test.ts` (~50
  lines)
- `scripts/test-update.sh` → `tests/update.test.ts`
- `scripts/test-skill-protocols.sh` → `tests/skill-protocols.test.ts`
- `scripts/test-test-plan*.sh` → `tests/test-plan.test.ts`,
  `test-plan-extractor.test.ts`, `test-plan-e2e.test.ts`

**Add structural-invariants test** (`tests/audit-invariants.test.ts`):
walks every `expected.txt`, asserts every `## SECTION` has a `STATUS:` line,
STATUS is one of `{pass, fail, warn, info, skip, found, none}`, MODE is the
last section, section order matches a canonical list. ~30 lines. Trips on
rubber-stamp `UPDATE_SNAPSHOTS=1` even when 14 fixtures all pass.

**Concurrent execution** is free with `bun test`. Sequential bash loop
becomes parallel.

**Exit:** `scripts/test-*.sh` deleted; `bun test` is the only test entry
point. `/ship` test runtime drops from ~50s to ~10s.

### Phase 4 — Adopt gstack proper's leverage patterns

Each is independent and pulled in based on actual pain.

1. **Touchfiles diff selection** (`tests/helpers/touchfiles.ts`, copy
   gstack's). Tests declare source dependencies as glob patterns; `git
   diff` selects which to run; `EVALS_ALL=1` overrides. Highest leverage for
   `/ship` runtime — most PRs only touch one area.

2. **Eval persistence** in `~/.gstack/projects/<slug>/evals/`. Share gstack
   proper's directory rather than parallel `~/.gstack-extend/`. One source
   of truth for both projects.

3. **LLM-as-judge for skill prose** (`tests/helpers/llm-judge.ts`, copy
   gstack's `callJudge<T>`). Score `/roadmap` reassessment, `/test-plan`
   extraction, `/pair-review` test list quality on `clarity / completeness /
   actionability`. Gate behind `EVALS=1`.

4. **Budget regression** on skill runs. Track tool calls / turns per skill
   run; fail when latest >2× prior on the same branch. Free, gate-tier.

5. **Audit-compliance test** for gstack-extend invariants: skill files have
   correct frontmatter, every skill listed in `setup` has a corresponding
   `skills/*.md`, no `[source-tag]` bracket appears outside the documented
   set in `docs/source-tag-contract.md`.

## Decisions

1. **Compile vs runtime-execute audit binary.** Compile (`bun build
   --compile`). Cold start matters for `/roadmap` UX (~25ms vs ~150ms for
   `bun run`). Same pattern gstack uses for `browse`/`design`/`make-pdf`.
2. **Single file vs split modules.** Split (`src/audit/{parsers,checks,lib}`).
   3,495 LOC bash unfolds to ~1,500–2,000 LOC TS; one file is cramped, unit
   tests get awkward.
3. **Eval data location.** Share `~/.gstack/projects/<slug>/evals/` with
   gstack proper. Standalone-extend installs (rare) fall back to
   `~/.gstack-extend/projects/...`.
4. **Build artifact.** Commit compiled binary to `bin/` like gstack does.
   Avoids requiring users to run `bun build` after `git pull`. CI rebuilds
   on tag.
5. **Bash binaries staying bash.** `bin/roadmap-revise`, `bin/roadmap-route`,
   `bin/update-check`, `bin/update-run` stay bash. They're small, shell-out
   is the right call, no value in porting.

## Risks

- **TS port introduces subtle regressions** (regex edge cases, locale, awk
  semantics that don't exist in JS). _Mitigation:_ snapshot fixtures are
  byte-exact contracts. Coverage-gap fixtures (Phase 2 pre-work) tighten the
  oracle before the port. Port is green only when all fixtures pass without
  `UPDATE_SNAPSHOTS=1`.
- **Two test systems coexist for 1–2 weeks** during Phase 1–2. _Mitigation:_
  Phase 1 ports only one test (smallest); bulk migration happens in Phase 3
  after the audit port is done.
- **Compiled binary needs a build step in CI.** _Mitigation:_ same as gstack
  proper. One `bun run build` step in the release workflow. Or commit
  artifact (gstack's choice).
- **Skills currently shell out to `bin/roadmap-audit "$REPO_ROOT"`.**
  _Mitigation:_ contract is path + args + stdout. Skills don't change.

## Success metrics

After Phase 3 ships:
- `/ship` test phase: ~50s → ~10s (5× faster).
- Real-repo audit: ~70s → <5s (14× faster).
- `bin/roadmap-audit` LOC: 3,495 → ~1,500–2,000.
- Test code can be unit-tested directly (parsers, lib modules) — currently
  only testable via full-audit snapshot runs.

## Phase ordering rationale

Phase 1 before Phase 2 because the toolchain bootstrap is cheap and de-risks
the bigger port. Phase 2 before Phase 3 because the audit port is bounded by
the snapshot suite (still bash); migrating the runner first would mean
porting bash tests against a still-bash audit, then re-porting them when the
audit changes. Phase 4 is opportunistic — pull in patterns when their value
shows up in real friction.
