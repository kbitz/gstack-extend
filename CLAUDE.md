# gstack-extend

Extension skills for gstack.

## Versioning

4-digit format: `MAJOR.MINOR.PATCH.MICRO`. Source of truth: `VERSION` file. Status: `docs/PROGRESS.md`. Backlog: `docs/TODOS.md`.

## Testing

Run the test suites under `./scripts/test-*.sh` (e.g. `test-roadmap-audit.sh`, `test-update.sh`).

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
