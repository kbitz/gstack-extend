# gstack-extend

Extension skills for gstack.

## Versioning

4-digit format: `MAJOR.MINOR.PATCH.MICRO`. Source of truth: `VERSION` file. Status: `docs/PROGRESS.md`. Backlog: `docs/TODOS.md`.

## Testing

`bun run test` runs `scripts/select-tests.ts`, which narrows by `git diff` against the detected base branch (`origin/main` → `origin/master` → `main` → `master`, override with `TOUCHFILES_BASE=<ref>`). Every `tests/*.test.ts` declares its dependencies via the static TS import graph plus a small manual map in `tests/helpers/touchfiles.ts` for non-TS deps (shell binaries, fixture trees, skill files, the `setup` script). Four safety fallbacks force a full run: empty diff, missing base, any global touchfile hit (`package.json`, `tsconfig.json`, `tests/helpers/{touchfiles,fixture-repo,run-bin}.ts`), and any non-empty diff that selects zero tests. User-supplied argv (`bun test --watch foo`) and `EVALS_ALL=1` bypass selection entirely. To skip the wrapper unconditionally: `bun run test:full`. `/ship` invokes `bun run test`.

`tests/touchfiles.test.ts` locks the selection contract — units, three structural invariants (every glob matches ≥1 file; every test reachable via import graph or manual map; every manual key resolves), and seven wrapper E2E scenarios. When adding a test that consumes a non-TS file (shell bin, fixture tree, markdown), add an entry to `MANUAL_TOUCHFILES`; the I2 invariant catches the omission.

All tests live in `tests/*.test.ts` using `bun:test`.

`tests/audit-snapshots.test.ts` is snapshot-based: each fixture under `tests/roadmap-audit/<name>/files/` is run through `bin/roadmap-audit`, and stdout is diffed against `expected.txt` (path-normalized, trailing-newline normalized). Stderr is asserted empty. To accept intentional behavior changes:

```sh
UPDATE_SNAPSHOTS=1 bun test tests/audit-snapshots.test.ts
git diff tests/roadmap-audit/   # review what audit behavior changed
```

`tests/audit-invariants.test.ts` is a structural-invariants safety net (NEW Track 3A). It walks every `expected.txt` and asserts every section has a `STATUS:` line, status values are in `CANONICAL_STATUSES`, MODE is last, and section order matches `CANONICAL_SECTIONS` (exported from `src/audit/sections.ts`). It trips on rubber-stamp `UPDATE_SNAPSHOTS=1` runs that scramble or drop sections.

Add a fixture by creating a new directory with a `files/` subtree (and optional one-line `args` file), then run `UPDATE_SNAPSHOTS=1` to seed `expected.txt`.

To regenerate the source-tag hash corpus (needed when bash `compute_dedup_hash` semantics change):

```sh
./scripts/regen-source-tag-corpus.sh
git diff tests/fixtures/source-tag-hash-corpus.json   # review hash drift
```

`scripts/score-extractor.ts` is a manual harness for scoring `/test-plan` extractor JSON output against vendored fixtures (`tests/fixtures/extractor-corpus/`). Run via `bun scripts/score-extractor.ts --help`.

`tests/fixtures/skill-prose-corpus/` is a reference corpus of skill output prose — 3 positive examples (`/roadmap` reassessment, `/test-plan` extraction, `/pair-review` test list) plus a `4-shallow-control` negative control. There is no automated judge test; the corpus is calibration material for the rubric (clarity / completeness / actionability, 1–5 each, ≥3 expected on positives, ≤2 expected on at least one axis for the control). When skill prose changes — i.e. any edit to `skills/*.md` in a session — Claude should proactively recommend judging the changed prose against the corpus and rubric in-session. Sample request: "score the new skill prose against tests/fixtures/skill-prose-corpus and the rubric." This runs in the existing Claude Code session (no API key, no separate billing, prompt caching across fixtures), keeps the human in the loop for taste decisions, and skips the cost overhead of an SDK-driven test that would only run on this machine anyway.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
- Manual testing, "give me a test list", pair test → invoke pair-review
- Restructure TODOs, clean up roadmap, reorganize backlog, tidy docs → invoke roadmap
- Update roadmap, refresh roadmap, roadmap out of date → invoke roadmap with args "update"
- Full codebase review, "review everything", weekly review, what needs cleaning up → invoke full-review
- Audit testing/debugging apparatus, "what helpers should we add", "review the test infra", "bolt-on dev tools" → invoke review-apparatus
- Batch test a Group, "bug bash", "test this release", "plan the bug bash" → invoke test-plan with args "run &lt;group&gt;"
