---
fixture: 3-pair-review-test-list
kind: positive
source_skill: skills/pair-review.md
source_skill_commit: 307b9a01ffaa6d791c89215f454bda4ffce61c21
repo_commit: 696ded8577aa21b6dae0d87bac32f32b7299be61
generation_model: synthesized
generation_timestamp_utc: 2026-05-04T15:00:00Z
worktree_state: clean (branch kbitz/track-4c-judge)
input_prompt: |
  Hypothetical /pair-review run on Track 4A (touchfiles diff selection)
  after the implementation is complete and ready for manual testing.
  Diff covers tests/helpers/touchfiles.ts, tests/helpers/fixture-repo.ts,
  scripts/select-tests.ts, tests/touchfiles.test.ts, package.json,
  CLAUDE.md, README.md.
provenance_note: |
  Synthesized from observed `/pair-review` output behavior documented in
  PROGRESS.md v0.4.0 / v0.5.0 / v0.8.7 (grouped test plans from diffs,
  test-fix-retest loop with group-level checkpoints, lookahead display,
  PASS/SKIP fast path). Replace with a real captured run when available.
---

# Pair-review session — Track 4A touchfiles diff selection

**Branch:** kbitz/track-4a-audit
**Diff vs origin/main:** 7 files, +630 / −12 LOC
**Deploy recipe:** `bun run test:full` (local, no remote deploy)
**Estimated session length:** 25–35 minutes (12 items, 2 groups)

## Group 1: Selection correctness (8 items)

The four safety fallbacks plus the import-graph + manual-map need to be
exercised against realistic diffs. Each item below is one concrete
`bun run test` invocation against a hand-crafted git state.

### Item 1.1 — Empty diff runs all tests
**Setup:** Branch HEAD points at base. `git diff origin/main...HEAD` is empty.
**Run:** `bun run test`
**Expect:** Wrapper prints `selection: empty-diff (running all 27 tests)`.
27 tests run. No skips.

### Item 1.2 — Single source-file change selects only consumers
**Setup:** Touch only `src/audit/lib/semver.ts` (one comment edit).
**Run:** `bun run test`
**Expect:** Selection includes `tests/lib-semver.test.ts` and any test
whose import graph reaches `semver.ts` (audit-snapshots, audit-shadow).
Skip count ≥ 20. Wall-clock < 30s.

### Item 1.3 — `package.json` change forces full run
**Setup:** Bump `version` field.
**Run:** `bun run test`
**Expect:** Wrapper prints
`selection: global: package.json matches package.json`. All tests run.

### Item 1.4 — Test file edit re-runs only that test
**Setup:** Add a no-op `expect(true).toBe(true)` line to
`tests/source-tag.test.ts`.
**Run:** `bun run test`
**Expect:** Selection is `[tests/source-tag.test.ts]`. 1 test runs.

### Item 1.5 — Skill-file edit re-runs skill-protocols only
**Setup:** Edit one word in `skills/roadmap.md`.
**Run:** `bun run test`
**Expect:** Selection includes `tests/skill-protocols.test.ts` (manual map).
No `tests/test-plan-e2e.test.ts` (different skill).

### Item 1.6 — Renamed file doesn't drop coverage
**Setup:** `git mv src/audit/lib/effort.ts src/audit/lib/sizing.ts`.
**Run:** `bun run test`
**Expect:** Selection includes `tests/lib-effort.test.ts` (until import
updates ship). Wrapper logs both old and new paths in changed-files list.

### Item 1.7 — `TOUCHFILES_BASE=<custom>` override
**Setup:** Stack on a feature branch. Set `TOUCHFILES_BASE=feature-x`.
**Run:** `bun run test`
**Expect:** Selection diffs against `feature-x`, not `origin/main`.
Visible in wrapper's "base: feature-x" log line.

### Item 1.8 — Argv passthrough bypasses selection
**Setup:** Any state.
**Run:** `bun test --watch tests/source-tag.test.ts`
**Expect:** Selection logic does not run. `bun test` invoked directly.
Watcher attaches.

## Group 2: Failure modes (4 items)

### Item 2.1 — Missing base branch falls back to run-all
**Setup:** Detached HEAD; no `origin/*` refs reachable.
**Run:** `bun run test`
**Expect:** Wrapper logs `base: <none>; fallback: run-all`. All tests run.

### Item 2.2 — Selection logic edit forces full run (self-defense)
**Setup:** Add a comment to `tests/helpers/touchfiles.ts`.
**Run:** `bun run test`
**Expect:** `selection: global: tests/helpers/touchfiles.ts matches ...`.
All tests run.

### Item 2.3 — Diff selects zero tests (non-empty fallback)
**Setup:** Edit `docs/PROGRESS.md` only.
**Run:** `bun run test`
**Expect:** Wrapper logs `selection: no-match-fallback (running all)`.
All tests run, even though no test depends on PROGRESS.md.

### Item 2.4 — Signal forwarding (Ctrl-C kills bun, not just wrapper)
**Setup:** Trigger any selection that runs ≥3 tests.
**Run:** `bun run test`, then Ctrl-C mid-run.
**Expect:** Both wrapper and child `bun test` exit; no orphaned process.
`pgrep -f "bun test"` returns empty after.

## Notes

- Items 1.1–1.4 should pass under PASS/SKIP fast-path (lookahead cached).
- Item 2.4 is the only one that can leave system state — `pgrep` check is
  the recovery oracle.
- If any item parks a bug, write `Symptom:` + numbered `Repro:` to
  `parked-bugs.md` per the v0.17.2 framing protocol.
