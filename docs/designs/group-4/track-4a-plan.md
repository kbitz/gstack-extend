# Track 4A — Touchfiles diff selection (locked plan)

Source: `/plan-eng-review` session in workspace `bogota` (branch
`kbitz/groups-2-3-status`), 2026-05-03. Eng review CLEARED with codex
outside-voice incorporated. **Gated on Pre-flight `4A-audit` greenlight.**

**Status:** DONE — plan reviewed end-to-end. 13 issues surfaced (4 architecture
/ 2 code-quality / 1 test / 1 performance / 5 plan corrections). 6 cross-model
tensions with codex resolved. 1 TODO captured. 3 learnings logged.

**Headline architectural shift:** codex caught that manual TEST_TOUCHFILES is
the wrong primary mechanism for a TS-heavy repo. Switched to a hybrid (static
TS import graph + small manual map for non-TS deps). Eliminates 3 follow-on
tensions by construction. Track grew M (~150 LOC) → L (~630 LOC) but bought
drift safety + correctness on refactors.

## Final scope

```
NEW tests/helpers/touchfiles.ts            (~200 LOC)
  ├── matchGlob(file, pattern)              # ported from gstack proper, ~20 LOC
  ├── analyzeTestImports(testFile): string[] # NEW: TS AST walk → resolved src paths
  ├── computeTestSelection(changed, ...)    # combines import graph + manual map + globals
  ├── detectBaseBranch(cwd)                 # TOUCHFILES_BASE env → origin/main → main → master
  ├── getChangedFiles(base, cwd)            # `git diff base...HEAD --name-status`, parses R/A/M/D/C
  ├── MANUAL_TOUCHFILES (~10 entries)       # bin/**, docs/**, fixtures, package.json, tsconfig
  └── GLOBAL_TOUCHFILES (5 entries)         # helpers/{touchfiles,fixture-repo,run-bin}, package.json, tsconfig.json

NEW scripts/select-tests.ts                  (~80 LOC wrapper)
  ├── argv passthrough: any user arg → bypass selection (D13)
  ├── EVALS_ALL=1 → run all
  ├── 4 safety fallbacks: empty diff, no base, global hit, non-empty-but-zero-selected (D11)
  ├── spawn `bun test ${selected}`, propagate exit code + SIGINT/SIGTERM
  └── log: 'selected: N/27, skipped: M, reason: <case>'

NEW tests/touchfiles.test.ts                 (~350 LOC)
  ├── matchGlob unit tests (6 cases)
  ├── analyzeTestImports unit tests (TS imports, type-only, re-exports, dynamic — fixtures)
  ├── computeTestSelection unit tests (8+ cases incl. all 4 fallbacks)
  ├── detectBaseBranch unit tests (env override, probe, no-base)
  ├── getChangedFiles parsing tests (--name-status format incl. R100 rename)
  ├── INVARIANT: every glob in MANUAL_TOUCHFILES + GLOBAL_TOUCHFILES matches ≥1 file
  ├── INVARIANT: every tests/*.test.ts (27, except touchfiles.test.ts) is reachable via import graph or MANUAL_TOUCHFILES
  ├── INVARIANT: every MANUAL_TOUCHFILES key resolves to an existing path
  └── 7 wrapper E2E scenarios via fixture-repo: happy, EVALS_ALL=1, empty-diff, no-base, global, args-passthrough, rename

EDIT package.json scripts.test → wrapper invocation; add scripts.test:full
EDIT CLAUDE.md ##Testing section + README ##Testing (or new) + CONTRIBUTING (if exists)
PRE-TASK: harden tests/helpers/fixture-repo.ts makeEmptyRepo to check spawn exit codes (codex C3)
```

## Implementation order

| Step | Task | Effort | Why this order |
|---|---|---|---|
| 0 | **Timing + dependency audit** (D15) — done in Pre-flight | 30 min | Already done before Track starts |
| 0.5 | Harden `makeEmptyRepo` (codex C3) | 15 min | E2E scenarios depend on it |
| 1 | Implement `tests/helpers/touchfiles.ts` (matchGlob + analyzeTestImports + computeTestSelection + git ops) | half-day CC | Pure functions first |
| 2 | Implement `scripts/select-tests.ts` wrapper (4 fallbacks, argv passthrough, signal forwarding) | ~1 hr CC | Integration glue |
| 3 | Implement `tests/touchfiles.test.ts` (units + invariants + 7 E2E) | half-day CC | Lock the contract |
| 4 | Wire `package.json scripts`, update CLAUDE.md + README + CONTRIBUTING | 30 min | Distribution |
| 5 | Benchmark before/after on 3 recent commits, write CHANGELOG numbers | 30 min | D8 + D15 closure |

## NOT in scope

- TEST_TIERS (gate vs paid) — dropped per re-plan (4C self-gates on EVALS=1; no cross-Track dependency).
- LLM-judge touchfiles map — Track 4C's responsibility; may co-evolve.
- Eval persistence — moved to Future per re-plan.
- GitHub Actions PR-test CI integration — no PR-test CI exists in this repo (`.github/workflows/auto-tag.yml` only); revisit if/when CI lands.
- Modifying `/ship` skill — gstack-proper-owned; selection happens transparently via `package.json` script change.
- Untracked-file selection — out of scope (PR-diff vs base; untracked is local concept).

## What already exists

- gstack proper `~/.claude/skills/gstack/test/helpers/touchfiles.ts` — reference (we copy *content* of `matchGlob` + `selectTests` shapes; no runtime path dependency, per codex C5)
- `tests/helpers/fixture-repo.ts` — Track 3A; reused for E2E (after C3 hardening)
- `tests/helpers/run-bin.ts` — Track 3A; reused
- `tests/audit-invariants.test.ts` — Track 3A; mirror pattern for invariants

## Failure modes

| Mode | Test? | Handling? | Visibility |
|---|---|---|---|
| Selection wrongly skips a failing test (CRITICAL) | Yes — completeness + glob-validity + import-graph invariants + 4 fallbacks | Yes | Failed test red on /ship |
| `origin/main` ref missing (Conductor fresh clone) | Yes — wrapper E2E #4 | Yes — D3 fallback 2 → run all | Wrapper logs "no base — running all" |
| Empty diff vs base (no commits ahead) | Yes — wrapper E2E #3 | Yes — D3 fallback 1 → run all | Wrapper logs "empty diff — running all" |
| Renamed source file | Yes — D14 `--name-status` parser unit + E2E #7 | Yes — both rename sides included | Selection includes both old + new |
| New unmapped file (typoed path, README) | Yes — wrapper E2E for non-empty-zero-selected | Yes — D11 fallback 4 → run all + warn | Warning surfaces unmapped path |
| Stacked branch w/ wrong base | Yes — D12 `TOUCHFILES_BASE` env override | Yes | User sets env explicitly |
| `bun test --watch foo` | Yes — D13 argv passthrough E2E | Yes — selection bypassed | Behaves identically to pre-Track |
| Type-only or dynamic import (import graph false-negative) | Yes — analyzeTestImports unit fixtures | Conservative overcount + manual-map override | Acceptable; audited via D15 timing data |

**No silent failures remain after these mitigations.**

## Cross-model tension recap (codex)

| # | Tension | Codex Said | Decision | Result |
|---|---|---|---|---|
| 1 | Manual globs vs static import graph | Manual is wrong primary mechanism for TS code | **B (hybrid)** | Subsumes 3 follow-on gaps |
| 2 | "Never zero tests" loophole | 3 fallbacks miss non-empty-but-zero case | **A (add 4th fallback)** | Loophole closed |
| 3 | Base branch detection | Underspecified; need precedence | **A (env override + probe)** | Stacked-branch escape hatch |
| 4 | Wrapper argv passthrough | Breaks ergonomics | **A (full passthrough + signals)** | Direct invocation preserved |
| 5 | git diff mode | --name-only loses renames | **A (--name-status w/ rename pairs)** | Refactor-safe |
| 6 | Audit timing first | Measure-before-merge is too late | **A (audit as Pre-flight)** | Cheap kill option |

## TODOs captured

The original plan captured a TEST_TIERS TODO; the re-plan dropped it (4C
self-gates on EVALS=1, no need for a tier layer in v1).

## Learnings logged

- Pattern: "Diff-selection 4-fallback rule (zero-tests loophole)" — confidence 9/10
- Architecture: "Manual touchfiles vs static import graph for TS repos" — confidence 8/10
- Operational: "Timing audit before leverage infra" — confidence 9/10

## Next steps

When Pre-flight `4A-audit` greenlights this Track, start at Task 0.5
(harden `makeEmptyRepo`), then proceed through Tasks 1–5 in order. Run
`/ship` when done.
