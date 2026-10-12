# gstack-extend

Extension skills for gstack.

## Versioning

Current format: `MAJOR.MINOR.PATCH.MICRO`; the planned three-part transition and compatibility rules are in `docs/SPEC.md`. Until its tooling transition lands, retain the current format. Source of truth: `VERSION`. Release history and acceptance: `docs/PROGRESS.md`. Backlog: `docs/TODOS.md`.

## Product scope and releases

Read docs/SPEC.md before roadmap, autoplan/planning, implementation, review or
release decisions. Its selected target, intended users, audience ceiling,
accepted limitations and release policy govern this project. Do not infer future
scale from backlog entries. Review findings need concrete impact on that target;
preserve approved scope unless the user explicitly changes it. Put unrelated
improvements in the backlog with a revisit trigger. A priority label alone is
not a launch gate. For version decisions, use the spec's policy and checkpoint
acceptance evidence instead of generic line-count, feature-size or Group-closure
heuristics. This project policy overrides those defaults in /ship; keep its
other release gates. A change that edits SPEC's release policy or adds
acceptance entries uses the base branch's policy, and its new entries count
only after the user confirms them directly. PROGRESS.md `## Acceptance` owns achieved stage and
evidence; SPEC owns definitions and target. Open a current supporting document
only when its listed role bears on the decision. Superseded plans/specs are
historical only: exclude them from routine discovery and backlog extraction.
Consult a named archive only for a specific unresolved historical question;
never use it to reintroduce scope or override the current spec.

## Testing

Run `bun install --frozen-lockfile` once per checkout before any test command. Development and tests need Bun 1.3.3+ (`package.json` `engines.bun`; text `bun.lock` alone needs 1.2+; Ajv 8 is pinned and development-only). Every `bin/` launcher that execs Bun (`roadmap-audit`, `roadmap-pack`, `roadmap-touches`, `roadmap-renumber`, `layout-scaffold`, `merge-gate`) passes `--no-env-file --no-install --config=/dev/null`, whose three flags first coexist in Bun 1.3.3, so those commands (and `gstack-extend init` through its audit step) need 1.3.3+ at runtime too; `setup` only checks that `bun` exists, not its version. Tests never install packages: `Cannot find package 'ajv'` means the install has not run.

`bun run test` runs `scripts/select-tests.ts`, which narrows by `git diff` against the detected base branch (`origin/main` → `origin/master` → `main` → `master`, override with `TOUCHFILES_BASE=<ref>`). Every `tests/*.test.ts` declares its dependencies via the static TS import graph plus a small manual map in `tests/helpers/touchfiles.ts` for non-TS deps (shell binaries, fixture trees, skill files, the `setup` script). Four safety fallbacks force a full run: empty diff, missing base, any global touchfile hit (`package.json`, `bun.lock`, `tsconfig.json`, `tests/helpers/{touchfiles,fixture-repo,run-bin}.ts`), and any non-empty diff that selects zero tests. User-supplied argv (`bun test --watch foo`) and `EVALS_ALL=1` bypass selection entirely. To skip the wrapper unconditionally: `bun run test:full`. `/ship` invokes `bun run test`.

`tests/touchfiles.test.ts` locks the selection contract — units, three structural invariants (every glob matches ≥1 file; every test reachable via import graph or manual map; every manual key resolves), a check that a `bin/lib/install-safety.sh` change selects `tests/lib-install-safety.test.ts` and `tests/update.test.ts`, and seven wrapper E2E scenarios. When adding a test that consumes a non-TS file (shell bin, fixture tree, markdown), add an entry to `MANUAL_TOUCHFILES`. The I2 invariant catches the omission only for a test with no TypeScript imports; a test that imports any helper stays reachable without the entry, so diff selection can skip it when that file changes.

All tests live in `tests/*.test.ts` using `bun:test`.

`tests/audit-snapshots.test.ts` is snapshot-based: each fixture under `tests/roadmap-audit/<name>/files/` is run through `bin/roadmap-audit`, and stdout is diffed against `expected.txt` (path-normalized, trailing-newline normalized). Stderr is asserted empty. To accept intentional behavior changes:

```sh
UPDATE_SNAPSHOTS=1 bun test tests/audit-snapshots.test.ts
git diff tests/roadmap-audit/   # review what audit behavior changed
```

`tests/audit-invariants.test.ts` is a structural-invariants safety net (NEW Track 3A). It walks every `expected.txt` and asserts every section has a `STATUS:` line, status values are in `CANONICAL_STATUSES`, MODE is last, and section order matches `CANONICAL_SECTIONS` (exported from `src/audit/sections.ts`). It trips on rubber-stamp `UPDATE_SNAPSHOTS=1` runs that scramble or drop sections.

`tests/audit-compliance.test.ts` is a structural-invariants safety net for gstack-extend itself (Track 4D). Four describes: (A) frontmatter sanity for every `skills/*.md` (`---` fence, `name:` matches filename, non-empty `description:` of at most 1024 UTF-16 code units, `allowed-tools:` present); (B) `setup` ↔ `skills/*.md` symmetric (every name in `SKILLS=( … )` has a file, every file is in the array); (C) source-tag registry consistency — `REGISTERED_SOURCES` exported from `src/audit/lib/source-tag.ts` is the single source of truth, and `docs/source-tag-contract.md`'s grammar list must match it exactly; (D) `skills/full-review.md`'s severity names and definitions, finding fields, byte-identical agent-prompt heads and tails, and `files=` tag-value rule must match `docs/source-tag-contract.md` and `validateTagExpression`, and the contract's `defer=true` routing rows must match `routeSourceTag`. When adding a source tag, update both sides; when adding a skill, register it in `setup`'s `SKILLS=( … )` array.

When changing the installed skill list, update the independently hardcoded `tests/helpers/expected-setup-skills.ts` list too. The setup, update, and skill-protocol suites share it; `tests/skill-protocols.test.ts` compares it exactly against `setup`. Keep protocol cohorts explicit. The selector follows these TypeScript imports without manual touchfile entries.

Telemetry, SHARED protocol, and upgrade-preamble memberships are independent.
`TELEMETRY_SKILLS` covers all nine setup skills; protocol/preamble cohorts stay
narrow. The five utility/workflow skills may carry only telemetry SHARED markers.
Telemetry tests execute canonical skill blocks in independent processes, isolate
HOME and all state overrides, and test generated host copies without PATH wiring.
For telemetry changes run the telemetry, telemetry-contract, telemetry-doctor,
skill-protocols, audit-compliance, setup-hosts, setup-init-wire, touchfiles, and quota
suites explicitly: diff selection uses committed `base...HEAD`, not working edits.
See [docs/telemetry.md](docs/telemetry.md) for the local sink, doctor report, and
its separation from transcript-derived skill counts produced by other tools. `duration_s` is
session wall-clock, not model/token spend; skill-usage values above 86400 seconds
become null. Finish also appends a local-only provenance row (agent, model, effort
read from the harness's own session log; documented schema for external consumers) to
`~/.gstack-extend/analytics/stage-runs.jsonl`, gated by the `provenance` config key,
not gstack's tier.

Add a fixture by creating a new directory with a `files/` subtree (and optional one-line `args` file), then run `UPDATE_SNAPSHOTS=1` to seed `expected.txt`. New `PACKING` fixtures live under `tests/roadmap-audit/packing-ok/`.

`bin/roadmap-pack`, `bin/roadmap-touches`, and `bin/roadmap-renumber` are the packing, `_touches:` drift, and ID-rewrite CLIs (`src/audit/pack-cli.ts`, `src/audit/touches-cli.ts`, `src/audit/renumber-cli.ts`). `bin/roadmap-route` prints the KEEP / KILL / PROMPT default for one source tag (`bin/lib/source-tag.sh`). `pack --from <path>` / `--stdin` pack a draft; `BINS: EMPTY` means no unshipped Tracks and `BINS: CYCLE` is a `_blocked-by` loop. Group `_Depends on:` is output, not packer input. `pack --materialize` prints old implicit previous-Group edges. Packer tie-breaks by packIdent (scheduling touches + normalized title), never ID or live document order — rename and regroup must not change partitions. `_tombstone: N, M` reserves numbers; STRUCTURE fails an unshipped Group that reuses one. `touches drift --track <id>` unions merge-base..HEAD with the working tree. `touches report-cross-group` prints soft overlaps. `renumber --map old=new,…` rewrites Current Plan IDs in one atomic pass (lookarounds, not `\b`); dated-historical mentions stay put.

`bin/layout-scaffold` (`src/layout-scaffold/`) plans and applies the documentation-layout moves behind the audit's `DOC_LOCATION` and `DOC_TYPE_MISMATCH` suggestions: `plan` prints the directories to create, the moves and a plan ID, and `apply --plan-id <ID>` recomputes the plan and answers `STATUS: stale` if it changed. `layout-scaffold --help` is the contract; `tests/layout-scaffold.test.ts` locks it.

To regenerate the source-tag hash corpus (needed when bash `compute_dedup_hash` semantics change):

```sh
./scripts/regen-source-tag-corpus.sh
git diff tests/fixtures/source-tag-hash-corpus.json   # review hash drift
```

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
- Implement the plan, build this plan → invoke implement (targeted checks, then a fresh-session review-and-prep handoff)
- Review and prep, prepare a draft PR, get Greptile review before shipping → invoke review-and-prep (versioning stays with ship)
- Ship and land, finish a prepared PR → invoke ship-and-land (reuse verified evidence; run missing/stale stages, then land)
- Resume review and prep after manual testing, continue the paused draft PR → invoke review-and-prep with args "resume"
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
- Manual testing, "give me a test list", pair test → invoke pair-review
- Establish project outcomes, organize an existing project around its MVP, write a project spec → invoke project-spec
- Restructure TODOs, clean up roadmap, reorganize backlog, tidy docs → invoke roadmap
- Update roadmap, refresh roadmap, roadmap out of date → invoke roadmap with args "update"
- Full codebase review, "review everything", weekly review, what needs cleaning up → invoke full-review
- Upgrade gstack-extend, update gstack-extend, check for gstack-extend updates → invoke gstack-extend-upgrade
- Bootstrap a new project, scaffold project docs, onboard a project with gstack-extend → invoke gstack-extend-init _(beta)_

## Consumer independence

Describe consumers generically. No shipped code, docs, fixtures or release text names or requires personal tooling.

Quota fixtures: pipe `gstack-extend quota probe KIND --raw` directly into
`bun scripts/scrub-quota-fixture.ts` and save only the scrubber output. Never
paste a raw response into an agent session. Wrap scrubbed endpoint bodies in
`{status, delay_ms, error, body}` and run `bun test tests/quota.test.ts`.
