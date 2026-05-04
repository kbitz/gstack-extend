---
fixture: 2-test-plan-extraction
kind: positive
source_skill: skills/test-plan.md
source_skill_commit: 29c21d42c49ac31c28e2eb4f8b6ba584a2d23ffe
repo_commit: 696ded8577aa21b6dae0d87bac32f32b7299be61
generation_model: synthesized
generation_timestamp_utc: 2026-05-04T15:00:00Z
worktree_state: clean (branch kbitz/track-4c-judge)
input_prompt: |
  Hypothetical /test-plan run on Group 4 (Test Leverage Patterns) covering
  Tracks 4A (touchfiles) + 4C (LLM judge) + 4D (audit-compliance) after all
  three branches have merged to a single integrated build. Eng-review docs
  consumed: track-4a-plan.md, track-4c-plan.md, track-4d-plan.md. No prior
  /pair-review artifacts (first batched test run).
provenance_note: |
  Synthesized from observed `/test-plan` output behavior documented in
  PROGRESS.md v0.15.0 (Group-scoped batched test-plan generator extracts
  test items via LLM prompt with strict JSON contract, classifies
  automated/manual via conservative heuristic). Replace with a real captured
  run when one is available.
---

# Group 4 batched test plan

**Group:** 4 (Test Leverage Patterns)
**Tracks:** 4A, 4C, 4D
**Integrated build:** local `bun run test:full`, manual `EVALS=1` smoke
**Items extracted:** 14 (9 automated, 5 manual)
**Source breakdown:** 8 from track-4a-plan.md, 4 from track-4c-plan.md, 2 from track-4d-plan.md

## Automated (covered by `bun run test:full`)

1. **[4A] Empty-diff fallback runs all tests.** `selectTests([], allTests)`
   returns `{ selected: allTests, reason: 'empty-diff' }`. Already locked
   by `tests/touchfiles.test.ts`. _Verify in CI run only._

2. **[4A] Global-touchfile hit forces run-all.** Changing `package.json`
   triggers `reason: 'global: package.json matches package.json'`. Locked
   by touchfiles unit tests.

3. **[4A] Manual-key drift detector.** Invariant I3 asserts every key in
   `MANUAL_TOUCHFILES` resolves to an existing test file path. Verify by
   deleting a test and confirming I3 fails before fixing the map.

4. **[4A] Rename safety.** `git diff --name-status R<percent>` returns both
   old and new paths; touchfiles match against either. Unit test
   `parseDiffNameStatus` covers `R100\told\tnew` cases.

5. **[4C] `isJudgeScore` rejects out-of-band integers.** `clarity: 0` and
   `clarity: 6` both fail the predicate. Locked by 6 unit tests in
   `tests/llm-judge.test.ts`.

6. **[4C] `callJudge` retries once on 429 then succeeds.** Mocked-client
   test asserts second call returns the parsed score. No retry on
   non-429 errors.

7. **[4C] `stop_reason !== 'end_turn'` is rejected before regex extract.**
   Mocked-client test asserts the throw fires before any JSON parsing,
   with `'max_tokens'` in the message.

8. **[4D] `REGISTERED_SOURCES` symmetry.** Audit-compliance test asserts
   every source listed in `docs/source-tag-contract.md` appears in
   `REGISTERED_SOURCES` and vice versa.

9. **[4D] `setup` ↔ `skills/*.md` symmetric.** Every entry in `setup`'s
   SKILLS array has a matching `skills/<name>.md` file, and every
   `skills/*.md` is registered in `setup`.

## Manual (drives `/pair-review` Phase 2)

10. **[4A] Real `/ship` run picks up correct subset on a small diff.**
    Open a 1-file change PR, observe `bun run test` selects ≤5 tests,
    confirm wall-clock under 30s.

11. **[4A] Stacked-branch override works.** Set `TOUCHFILES_BASE=feature-x`
    on a branch ahead of `feature-x`; verify selection diffs against
    `feature-x` not `origin/main`.

12. **[4C] EVALS=1 smoke against real Anthropic API.** With a valid key,
    `EVALS=1 bun test tests/skill-llm-eval.test.ts` produces 4 scored
    fixtures, prints token usage, and reports total cost ~$0.05–0.15.

13. **[4C] Negative-control fixture scores ≤2 on at least one axis.**
    Manually inspect the judge's reasoning to confirm it cited the
    fixture's missing specifics, not surface-level features.

14. **[4D] Audit-compliance failure messages are actionable.** Delete a
    `description:` field from a skill frontmatter; verify the test
    failure names the exact skill + missing field, not just "skill
    drift detected."

## Notes

- No `[4B]` items: Track 4B was dropped to `Future` per the Group 4 re-plan.
- Item 13 is intentionally manual because the negative control's score is
  judgment-of-judgment — automating it would lock in whatever the judge
  scores today, including drift.
