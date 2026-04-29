# gstack-extend

Extension skills for gstack.

## Versioning

4-digit format: `MAJOR.MINOR.PATCH.MICRO`. Source of truth: `VERSION` file. Status: `docs/PROGRESS.md`. Backlog: `docs/TODOS.md`.

## Testing

Two suites run side by side:

- **Bash** — `./scripts/test-*.sh` (e.g. `test-roadmap-audit.sh`, `test-update.sh`, `test-source-tag.sh`).
- **Bun** — `bun run test` (which invokes `bun test tests/`). New unit tests under `tests/*.test.ts` use `bun:test`.

`/ship` runs both. Together the full set runs in ~65 seconds.

`test-roadmap-audit.sh` is snapshot-based: each fixture under `tests/roadmap-audit/<name>/files/` is run through `bin/roadmap-audit`, and the output is diffed against `expected.txt`. To accept intentional behavior changes:

```sh
UPDATE_SNAPSHOTS=1 ./scripts/test-roadmap-audit.sh
git diff tests/roadmap-audit/   # review what audit behavior changed
```

Add a fixture by creating a new directory with a `files/` subtree (and optional one-line `args` file), then run `UPDATE_SNAPSHOTS=1` to seed `expected.txt`.

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
