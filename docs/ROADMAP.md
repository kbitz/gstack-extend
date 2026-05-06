# Roadmap — Pre-1.0 (v0.x)

Organized as **Groups > Tracks > Tasks**. A Group is a wave of PRs that land
together — parallel-safe within, sequential between. Create a new Group
whenever (a) dependency ordering demands it, OR (b) parallel tasks would
collide on files. Within a Group, Tracks must be fully parallel-safe
(set-disjoint `_touches:_` footprints). Each track is one plan + implement
session.

Execution order follows the adjacency list in the Execution Map below.
Phase 1 (Groups 1–4, bun + TypeScript test infrastructure per
`docs/archive/bun-test-architecture.md`) shipped across v0.18.3 → v0.18.11.0.
Active scope is Group 5 (install pipeline), Group 6 (distribution), Group 7
(audit polish), and Group 8 (skill ecosystem polish, serialized internally).

---

## Phase 1: Bun Test Migration ✓ Complete

**End-state:** `bun test` is the sole test entry point, all `scripts/test-*.sh`
retired, `bin/roadmap-audit` is a 7-line POSIX-sh shim invoking `src/audit/cli.ts`,
and the 4 leverage patterns (touchfiles, skill prose corpus + in-session judging,
audit-compliance, eval persistence — last deferred to Future) are adopted.

**Groups:** 1, 2, 3, 4 (sequential).

Shipped across v0.18.3 → v0.18.11.0. Full suite went 113s → 32s; audit
snapshot suite 124s → 7.3s.

**Scaffolding contract:**
- Group 1 landed `src/audit/lib/source-tag.ts` and `tests/source-tag.test.ts`
  in v0.18.4 — the source-tag library was the seed module the rest of the TS
  port consumed.
- Group 2 landed the rest of `src/audit/lib/*.ts` (semver, effort) plus the
  TS port itself in v0.18.6.0 (dark code) and the cutover in v0.18.11.0.

---

## Group 1: Bun Test Toolchain ✓ Complete

Bootstrap the bun test toolchain in isolation, prove the pattern on the
smallest existing bash test. Single-PR scope; lays the foundation for
Groups 2–4. Both bash and bun test suites coexist after this Group ships.

### Track 1A: Bootstrap bun + port source-tag lib + tests ✓ Complete
_1 task . ~half-day (CC) . medium risk . [bootstrap + source-tag lib port]_
_touches: package.json, tsconfig.json, src/audit/lib/source-tag.ts, tests/source-tag.test.ts, tests/fixtures/source-tag-hash-corpus.json, scripts/regen-source-tag-corpus.sh_

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

## Group 2: TypeScript Port of `bin/roadmap-audit` ✓ Complete

Shipped as v0.18.6.0 (Track 2A — TS port as dark code, full byte-parity verified by `tests/audit-shadow.test.ts`) + v0.18.11.0 (Track 2B — `bin/roadmap-audit` cutover to a 7-line POSIX-sh shim invoking `src/audit/cli.ts`; shadow test deleted; snapshot suite 111s → 7.3s, full suite 113s → 32s). The 3,868-line bash binary lives in git history at `e4f883b` for archaeology.

### Track 2A: Port `bin/roadmap-audit` to TypeScript ✓ Complete
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
_1 task . ~30 min (CC) . low risk . [bin/roadmap-audit shim + audit-shadow delete]_
_touches: bin/roadmap-audit, tests/audit-shadow.test.ts, tests/helpers/touchfiles.ts_

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

## Group 3: Test Runner Migration + Invariants ✓ Complete

Shipped as v0.18.7.0 (Track 3A). 7 bash test scripts → bun:test files (~2,800 LOC bash deleted, ~1,400 LOC TS added); structural-invariants safety net (`tests/audit-invariants.test.ts`) and CLI-contract test (`tests/audit-cli-contract.test.ts`) added. `/ship` test runtime ~50s → ~30s post-cutover.

### Track 3A: Migrate test runners + invariants test ✓ Complete
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

## Group 4: Test Leverage Patterns ✓ Complete

Shipped as v0.18.9.0 (4A — touchfiles diff selection + invariants) + v0.18.10.0 (4D — audit-compliance) + v0.18.11.0 (4C — skill prose corpus + in-session judging routing rule). Pre-flight `4A-audit` greenlit Track 4A. Original Track 4B (eval persistence + regression) deferred to Future; pairs with the next Track that produces eval-store data.

_Pre-flight (4A-audit) — ✓ Complete. Greenlit Track 4A._

### Track 4A: Touchfiles diff selection ✓ Complete
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
_1 task . ~1 day (human) / ~2 hours (CC) . low risk . [3 describes + REGISTERED_SOURCES export]_
_touches: tests/audit-compliance.test.ts, src/audit/lib/source-tag.ts, docs/source-tag-contract.md, docs/TODOS.md_

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
shipped in v0.16.0.

After Phase 1 closure the remaining install/setup work is a single serial
Track touching cross-cutting install files. Per the single-Track
Pre-flight rule, the previous Pre-flight items are folded into Track 5A
as additional tasks, plus the `setup` symlink-component hardening surfaced
during /review of Pre-flight 1.

### Track 5A: Install pipeline polish
_5 tasks . ~2 days (human) / ~2 hours (CC) . medium risk . [setup, skill preambles, src/audit/, bin/update-run]_
_touches: setup, skills/*.md, src/audit/cli.ts, src/audit/checks/, bin/update-run_

End-to-end install / upgrade ergonomics: per-project install resolution
(preamble probe), roadmap onboarding scaffolding, doc-location heuristics,
custom-dir propagation through upgrade, and symlink-component hardening
at the install target.

- **Preamble probe pattern** -- Skill preambles currently `readlink ~/.claude/skills/{name}/SKILL.md`, which silently breaks on non-default installs. Replace with gstack-core's probe pattern (`~/.claude/skills/{name}/SKILL.md` then `.claude/skills/{name}/SKILL.md`). For truly-custom paths, honor `$GSTACK_EXTEND_ROOT` env var and fallback to `$HOME/.gstack-extend-rc` (written by setup). Also fix `skills/test-plan.md:632` to point at `$_EXTEND_ROOT/skills/pair-review.md`. _[skills/*.md preambles (5 files), setup], ~40 lines._ (S)
- **Layout scaffolding for new projects** -- Add a `/roadmap init` subcommand that creates the correct directory structure (`docs/`, `docs/designs/`, `docs/archive/`) and offers to git-mv misplaced docs (consumes `bin/roadmap-audit DOC_LOCATION` findings). On destination collisions, AskUserQuestion with diff + merge/skip/abort options. _[src/audit/cli.ts, skills/roadmap.md], ~50 lines._ (S)
- **Doc type detection heuristic** -- Teach `bin/roadmap-audit` to emit `## DOC_TYPE_MISMATCH` for two strong-signal patterns: design-looking doc outside `docs/designs/` (mermaid/plantuml fence), inbox-looking doc outside `TODOS.md` (checkbox density >20%). Skip known ROOT_DOCS/DOCS_DIR_DOCS. Only emit rows where content disagrees with location. _[src/audit/checks/], ~40 lines._ (S)
- **Propagate dir to update-run** -- `bin/update-run` calls `setup` without passing through any custom dir. Read `$GSTACK_EXTEND_ROOT` env var (set by user shell, populated by the preamble probe pattern's rc-file fallback when available). If set, pass `--skills-dir "$GSTACK_EXTEND_ROOT"` to `./setup`. If unset, default behavior (matches pre-Group-5 semantics). Regression test: install with `--skills-dir /tmp/foo`, trigger upgrade, confirm skills still resolve at `/tmp/foo`. _[bin/update-run], ~40 lines._ (S)
- **Harden setup against attacker-controlled symlink components at install target** -- `setup` install/uninstall paths do not check whether `$SKILLS_DIR/{skill}` is itself a symlink before `ln -snf` / `rm -f` / `rmdir` touch `$SKILLS_DIR/{skill}/SKILL.md`. Before `ln -snf` in the install loop, assert `[ ! -L "$target" ]` (the directory itself, not `$target/SKILL.md`) — fail with a clear error if the path component is a symlink. Same check in the uninstall loop before `readlink`/`rm`. Add targeted tests that create a symlink at `$CUSTOM_DIR/pair-review` pointing elsewhere and assert install/uninstall refuse with a clean message. _[setup], ~30 lines._ (S)

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

## Group 7: Audit Polish

_Depends on: none_

Audit-related ergonomics and coverage gaps surfaced dogfooding `/roadmap`
on bolt and on extend itself. All three tasks touch `src/audit/**` plus
`skills/roadmap.md`, so they ship as one Track.

### Track 7A: Audit polish + FRESHNESS coverage
_3 tasks . ~1 day (human) / ~1 hour (CC) . low risk . [src/audit/checks/, tests/audit-checks/, skills/roadmap.md]_
_touches: src/audit/checks/, tests/audit-checks/, tests/audit-snapshots.test.ts, skills/roadmap.md_

- **Direct state-machine tests for `check_phases` / `check_phase_invariants`** -- write `tests/audit-checks/phases.test.ts` covering each PHASE_INVARIANTS rule (≥2 Groups, listed Groups exist, sequentiality, no double-claim, scaffolding test-f, malformed-block warns) and the vocab-lint PHASE state transitions. Snapshot fixtures stay; unit tests are additive coverage that pinpoint state-machine regressions instead of cascading across 8 fixtures. _[tests/audit-checks/phases.test.ts], ~150 lines._ (S)
- **Rename STALENESS → VERSION_TAG_STALENESS + skill prose clarifier** -- mechanical rename in `src/audit/checks/staleness.ts` (+ expected.txt fixtures), plus a one-line clarifier in `skills/roadmap.md` Interpreting Audit Findings: "VERSION_TAG_STALENESS only fires on items with explicit (shipped vN.N.N) annotations; broader recency belongs to FRESHNESS." Closes the dogfood-noted misread that `STALENESS: pass` settles the freshness question. _[src/audit/checks/, tests/, skills/roadmap.md], ~30 lines._ (S)
- **Extend FRESHNESS scan to TODOS.md `## Unprocessed`** -- new `_inferred_freshness_for_todo` walks Unprocessed items, extracts referenced file paths from prose, runs the same per-file commit-since-introduction lookup as the ROADMAP scan (incl. Track-ID-or-title-fuzzy-match relaxation from v0.17.1). Surfaces shipped-but-unclosed inbox items in the FRESHNESS AskUserQuestion flow. _[src/audit/checks/freshness.ts, tests/], ~120 lines._ (M)

---

## Group 8: Tighten `git commit` failure handling

_Depends on: none_

All three review skills currently treat any non-zero exit from `git commit`
as "nothing to commit, that's fine — continue." Silently swallows
pre-commit hook rejections, missing `user.email`, detached-HEAD refusal —
data-loss risk because the skill reports a commit that didn't land.

### Track 8A: Snapshot staged state + escalate on real failure
_1 task . ~2 hours (human) / ~20 min (CC) . low risk . [3 skill files]_
_touches: skills/full-review.md, skills/pair-review.md, skills/review-apparatus.md_

- **Snapshot staged state + escalate on real failure** -- before commit, snapshot `git diff --cached --quiet; _HAS_STAGED=$?`. Run `git commit` only if `_HAS_STAGED` is 1. On non-zero exit with staged content present, escalate as BLOCKED with the stderr tail rather than swallowing silently. Apply identically to all three skills to preserve parity. _[skills/full-review.md:498, skills/pair-review.md (parked-bug + fix-flow commits), skills/review-apparatus.md:346], ~30 lines (3 small edits)._ (S)

---

## Group 9: New skill `/gstack-extend-upgrade`

Mirror `/gstack-upgrade` for gstack-extend so users have a first-class
upgrade path instead of `git pull` archaeology. Sequenced after Group 8
because the new skill file inherits the corrected commit-handling pattern
from Track 8A.

### Track 9A: Mirror `/gstack-upgrade` as `/gstack-extend-upgrade`
_1 task . ~half day (human) / ~30 min (CC) . low risk . [new skill + setup wiring]_
_touches: skills/gstack-extend-upgrade.md, setup, bin/_

Detect install type (global git clone vs vendored), fetch latest, run
`./setup`, run pending migrations, summarize What's New from `CHANGELOG.md`
between old/new. Same auto-upgrade / snooze / "never ask again" UX as
`/gstack-upgrade`, including the inline-upgrade flow that other
gstack-extend skill preambles already call when they detect
`UPGRADE_AVAILABLE`.

- **Mirror `/gstack-upgrade` as `/gstack-extend-upgrade`** -- copy `~/.claude/skills/gstack-upgrade/SKILL.md` as the starting template; swap `gstack` → `gstack-extend` in install-detection paths, repo URL, config helper paths, and migrations directory; decide config-helper sharing (gstack-config vs parallel `gstack-extend-config`); wire into setup's SKILLS array. _[skills/gstack-extend-upgrade.md, setup, bin/], ~250 lines (mostly mechanical mirror)._ (M)

---

## Group 10: Telemetry parity with gstack

gstack-extend skills currently emit nothing. gstack writes per-skill
activations + outcomes to `~/.gstack/analytics/skill-usage.jsonl`; `/retro`
reads them. Without parity, mind-meld retro flying over a project sees
gstack activity but is blind to all gstack-extend skill runs. Sequenced
after Group 9 because the telemetry helper consumes the same config
helper decision Track 9A makes (gstack-config sharing vs parallel
`gstack-extend-config`).

### Track 10A: Add `bin/gstack-extend-telemetry` + per-skill emit blocks
_1 task . ~half day (human) / ~30 min (CC) . low risk . [new helper + per-skill blocks]_
_touches: bin/gstack-extend-telemetry, skills/*.md_

- **Add helper + per-skill emit blocks** -- helper appends one JSON line per activation to `~/.gstack/analytics/skill-usage.jsonl` matching gstack's schema (`{"skill","duration_s","outcome","session","ts","repo"}`); mark via skill-name prefix (`extend:roadmap`) or `"source":"gstack-extend"`. Append preamble + completion block to each gstack-extend skill following gstack's pattern at `retro/SKILL.md:58-65` and `:631-650`. Gate on `~/.gstack/.telemetry-prompted` / `gstack-config get telemetry`. _[bin/gstack-extend-telemetry, skills/*.md (5 files)], ~200 lines._ (M)

---

## Group 11: New skill `/claude-md-cleanup`

Audits a project's CLAUDE.md for bloat: duplicated info that already
exists in README or other docs, stale references to files or features
that no longer exist, sections that should be pointers instead of inline
content. Sequenced after Group 10 because the new skill file should
include the same telemetry block other skills get in 10A.

### Track 11A: `/claude-md-cleanup` skill
_1 task . ~half day (human) / ~30 min (CC) . low risk . [new skill]_
_touches: skills/claude-md-cleanup.md, setup_

- **`/claude-md-cleanup` skill** -- detect duplication against README, TESTING.md, CONTRIBUTING.md; flag stale file references via `git ls-files`; flag long inline content that could be a pointer; produce diff with summary + per-section recommendation. Wire into setup's SKILLS array. _[skills/claude-md-cleanup.md, setup], ~250 lines._ (M)

---

## Group 12: Skill-file simplification pass + SKILL.md.tmpl

Five releases (v0.10.0 → v0.15.0) appended cross-cutting protocol grafts
to skill files. The grafts were appended rather than woven in, so skills
have grown noticeably (pair-review 1000, full-review 793, review-apparatus
480, test-plan 857 — only roadmap was trimmed in v0.17.0: 1253 → 541).
Sequenced last so all preceding skill grafts (8A commit handling, 10A
telemetry blocks) are settled before the simplification pass identifies
which patterns rhyme.

**Pre-flight** (Lane A — canonical fragment extraction; serial, before parallel skill trims):
- **Inspect 4 skills + extract canonical shared fragments + add REQUIRED_VERBATIM_BLOCKS** -- read the appended graft sections across the 4 skills, identify byte-identical fragments (Completion Status Protocol enum, Escalation opener, Escalation format, Confusion Protocol head, GSTACK REVIEW REPORT table header), pick the tightest variant of each as canonical, add per-fragment assertions to `scripts/test-skill-protocols.sh` so future drift is caught. _[scripts/test-skill-protocols.sh], ~80 lines._ (S)

### Track 12A: Trim `pair-review.md`
_1 task . ~half day (human) / ~20 min (CC) . low risk . [pair-review skill file]_
_touches: skills/pair-review.md_

- **Duplication-only trim per scope discipline** -- only remove (a) literal duplication within the skill, (b) word-level redundancy, (c) obviously stale refs (e.g., removed features), (d) dead cross-references. Gate on `scripts/test-skill-protocols.sh` passing unchanged. _[skills/pair-review.md], ~100 lines (deletions)._ (M)

### Track 12B: Trim `full-review.md`
_1 task . ~half day (human) / ~20 min (CC) . low risk . [full-review skill file]_
_touches: skills/full-review.md_

- **Duplication-only trim per scope discipline** -- same rules as 12A, applied to full-review.md. _[skills/full-review.md], ~80 lines._ (M)

### Track 12C: Trim `review-apparatus.md`
_1 task . ~2 hours (human) / ~15 min (CC) . low risk . [review-apparatus skill file]_
_touches: skills/review-apparatus.md_

- **Duplication-only trim per scope discipline** -- same rules as 12A, applied to review-apparatus.md (smallest skill, calibration target). _[skills/review-apparatus.md], ~50 lines._ (S)

### Track 12D: Trim `test-plan.md`
_1 task . ~half day (human) / ~20 min (CC) . low risk . [test-plan skill file]_
_touches: skills/test-plan.md_

- **Duplication-only trim per scope discipline** -- same rules as 12A, applied to test-plan.md. _[skills/test-plan.md], ~80 lines._ (M)

### Track 12E: Promote shared fragments to SKILL.md.tmpl
_1 task . ~half day (human) / ~30 min (CC) . low risk . [shared template]_
_touches: .claude/skills/SKILL.md.tmpl, setup_

- **Promote canonical fragments into a shared template** -- once Tracks 12A-12D have trimmed the skill files and Pre-flight extraction has identified which fragments rhyme, promote them into `.claude/skills/SKILL.md.tmpl`. New skills inherit automatically; cross-cutting protocol additions become single-source instead of N-skill grafts. _[.claude/skills/SKILL.md.tmpl, setup integration], ~150 lines._ (M)

---

## Execution Map

Adjacency list:
```
- Group 1 ← {}                  ✓ Complete
- Group 2 ← {1}                 ✓ Complete
- Group 3 ← {2}                 ✓ Complete
- Group 4 ← {3}                 ✓ Complete
- Group 5 ← {4}
- Group 6 ← {5}                 (Track 6A also waits for an external 0.x → 1.x bump)
- Group 7 ← none
- Group 8 ← none
- Group 9 ← {8}
- Group 10 ← {9}
- Group 11 ← {10}
- Group 12 ← {11}
```

Track detail per group:
```
Group 1: Bun Test Toolchain ✓ Complete
  +-- Track 1A ..................... ✓ Complete (v0.18.3)

Group 2: TypeScript Port of bin/roadmap-audit ✓ Complete
  +-- Track 2A ..................... ✓ Complete (v0.18.6.0)
  +-- Track 2B ..................... ✓ Complete (v0.18.11.0)

Group 3: Test Runner Migration + Invariants ✓ Complete
  +-- Track 3A ..................... ✓ Complete (v0.18.7.0)

Group 4: Test Leverage Patterns ✓ Complete
  +-- Track 4A ..................... ✓ Complete (v0.18.9.0)
  +-- Track 4C ..................... ✓ Complete (v0.18.11.0)
  +-- Track 4D ..................... ✓ Complete (v0.18.10.0)

Group 5: Install Pipeline
  +-- Track 5A ..................... ~2 hr CC ... 5 tasks

Group 6: Distribution Infrastructure
  +-- Track 6A ..................... ~20 min CC ... 1 task  (waits for 0.x → 1.x bump)

Group 7: Audit Polish
  +-- Track 7A ..................... ~1 hr CC ... 3 tasks

Group 8: Tighten git commit failure handling
  +-- Track 8A ..................... ~20 min CC ... 1 task

Group 9: New skill /gstack-extend-upgrade
  +-- Track 9A ..................... ~30 min CC ... 1 task

Group 10: Telemetry parity with gstack
  +-- Track 10A .................... ~30 min CC ... 1 task

Group 11: New skill /claude-md-cleanup
  +-- Track 11A .................... ~30 min CC ... 1 task

Group 12: Skill-file simplification + SKILL.md.tmpl
  Pre-flight (Lane A canonical extraction) ..... 1 item
  +-- Track 12A .................... ~20 min CC ... 1 task (trim pair-review)
  +-- Track 12B .................... ~20 min CC ... 1 task (trim full-review)
  +-- Track 12C .................... ~15 min CC ... 1 task (trim review-apparatus)
  +-- Track 12D .................... ~20 min CC ... 1 task (trim test-plan)
  +-- Track 12E .................... ~30 min CC ... 1 task (promote SKILL.md.tmpl)
```

**Total: 12 groups (4 ✓ Complete) . 16 tracks (7 ✓ Complete) . 19 tasks (12 active + 7 shipped)**

---

## Future (post-Phase 1)

Items triaged but deferred to a future phase. Not organized into Groups/Tracks.
Will be promoted to the current phase and structured when their time comes.

- **Multi-agent test orchestration** — Each test group assigned to a separate Conductor agent. session.yaml as coordination point, groups as independent files so agents don't conflict. Parallel testing for large suites (15-20 items). _Deferred because: depends on /pair-review v1 proven reliable and Conductor agent API maturity. L effort (~2 weeks human / ~2 hours CC)._
- **Shared-infra auto-detect from git history** — Compute the shared-infra list automatically by scanning the last 20 merged PRs for files modified in ≥40% of them. Replaces `docs/shared-infra.txt` hand-maintenance. _Deferred because: ships hand-curated list first; revisit after 4+ weeks of cohort usage. M effort (~1 day human / ~30 min CC)._
- **Cohort retrospective telemetry** — Log per-cohort merge outcomes (parallel tracks merged clean? hotfix count? mid-flight splits?) to `~/.gstack/analytics/cohort-outcomes.jsonl`. Data-driven tuning of the size-cap ceilings. _Deferred because: requires 10+ real cohorts of usage data before signal emerges. Pairs with `bin/config` ceiling overrides. M effort (~1 day human / ~40 min CC)._
- **Eval persistence + reader + comparator + regression gate** (full original Track 4B scope) — Port `tests/helpers/eval-store.ts` from gstack proper (types, `getProjectEvalDir` with lazy memoization + design-doc fallback, transcript writer); reader (`findPreviousRun`, `compareEvalResults`, `extractToolSummary`, `totalToolCount`, `findBudgetRegressions`, `assertNoBudgetRegression`, `runBudgetCheck`); active `tests/skill-budget-regression.test.ts`. Lift the locked decisions D3/D6/D7/D8/D9/D10/D11/D14 from the original 4B /plan-eng-review. _Deferred because: no Track in this codebase currently produces eval-store data; shipping types + a skipped test alone would just bury infrastructure under a permanently-skipped test. Unblocks the day a Track that captures skill transcripts exists. M effort (~400–500 LOC including active tests)._
- **gbrain-sync allowlist for `~/.gstack/projects/*/evals/`** — Once a transcript producer exists, add the evals dir to gbrain-sync's allowlist (or denylist) in gstack proper so transcripts don't auto-sync to a private GitHub repo. _Deferred because: requires the producer to land first so the privacy surface is observable; cross-repo (gstack proper, not gstack-extend). S effort (~30 min)._
- **Eval dir retention / pruning policy** — Time-based ('drop files >30 days'), count-based ('keep last N per branch + tier'), or scenario-indexed ('prune older runs of the same {skill, scenario, model}') pruning of `~/.gstack/projects/<slug>/evals/`. _Deferred because: no eval-write rate exists yet to design against; pairs with the eval-persistence Track above. S–M effort (~2–4 hrs)._
- **Audit fail-taxonomy calibration** — Review `bin/roadmap-audit` STATUS emit decisions; downgrade `ARCHIVE_CANDIDATES` to warn; design narrow waiver mechanism for `SIZE` (per-track + reason + optional expiry, NOT vague italic markers). Surfaced during Track 4D /plan-eng-review when audit emitted 3 `STATUS: fail` sections, only 1 of which was real structural drift. _Deferred because: a separate /plan-eng-review on the audit's policy surface, not Group 4 scope. M effort (~3 hrs)._
- **Deduplicate SKILLS list across `setup` + `tests/skill-protocols.test.ts`** — Once Track 4D's setup-parser ships, extract to `tests/helpers/parse-setup-skills.ts` and consume from `tests/skill-protocols.test.ts`. Closes the third drift channel for the canonical skill list. _Deferred because: depends on Track 4D landing first (now unblocked — Track 4D shipped v0.18.10.0); pairs naturally with Track 8E. S effort (~30 min)._
- **Codex host support in `setup`** — `setup --host claude|codex|auto` flag (and matching uninstall path) targeting `~/.codex/skills/{skill}/SKILL.md` so Codex CLI users can consume `/pair-review`, `/roadmap`, `/full-review`, `/review-apparatus`, `/test-plan`. Pre-existing TODOS work captures Codex-specific gates: frontmatter `description:` ≤ 1024 chars (4 of 5 skills exceed today; re-measure after Track 8E simplification), preamble probe path fallthrough (one extra `||` per preamble × 5 skills), cross-skill reference fix at `skills/test-plan.md:232` (depends on upstream gstack's Codex install layout). Mechanical core (flag handling + path table + test parameterization) is ~30 min CC; description trimming follow-up depends on what Track 8E leaves. _Deferred because: best deferred until after Track 8E simplification settles description lengths so the "trim if needed" follow-up can be measured rather than speculative. S-M effort (~3-5 hours human / ~30-45 min CC)._

---

## Unprocessed

Items awaiting triage by /roadmap. Added by other skills or manually.

