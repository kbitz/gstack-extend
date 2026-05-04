# Track 4C — LLM-as-judge for skill prose (locked plan)

Source: `/plan-eng-review` session in workspace `valletta` (branch
`kbitz/llm-judge-skill-prose`), 2026-05-03. Eng review CLEARED with strong
codex consensus.

**Status:** DONE — 14 decisions resolved (D1–D14), 0 unresolved, 0 critical
gaps. Codex outside-voice surfaced 4 cross-model tensions (3 went codex's
way, 1 deferred) and 10 unambiguous catches batch-applied. 2 follow-up TODOs
in `docs/ROADMAP.md` `## Future` (tool-use migration on 2nd consumer or regex
bug; raise floor to >=4 after 5–10 EVALS runs).

## Final scope (~370 LOC, ~3 hr CC)

- **`tests/helpers/llm-judge.ts` (~70 LOC)** — exports `callJudge<T>(prompt, validator)` with:
  - baked-in validator (D11)
  - `maxRetries: 0` on Anthropic client (D14 catch #2)
  - explicit 1× 429 retry
  - `stop_reason` check before regex extract (D14 catch #6)
  - `JudgeScore` interface
  - `isJudgeScore` strict predicate (rejects NaN/Infinity/decimals/0/6/null/wrong types/empty reasoning) (D14 catch #5)
  - hardcoded model + `temperature: 0` + `max_tokens: 1024` (note: Anthropic doesn't guarantee determinism at temp 0, fix messaging — D14 catch #7)

- **`tests/helpers/llm-judge.test.ts` (~120 LOC)** — 6 mocked-Anthropic-client unit tests covering all helper branches.

- **`tests/skill-llm-eval.test.ts` (~100 LOC)**:
  - sequential `test.each` (D10 — codex flipped from parallel beforeAll because Promise.all loses per-fixture granularity)
  - `process.env.EVALS === '1'` exact gate (D14 catch #3)
  - strict `ANTHROPIC_API_KEY` check
  - per-test `{ timeout: 60_000 }` (D14 catch #1 — bun:test default is 5s)
  - per-axis floor `>=3` for the 3 positive fixtures (clarity/completeness/actionability)
  - `<=2` ceiling on at least one axis for the 1 negative-control fixture
  - prints token usage per fixture

- **`tests/fixtures/skill-prose-corpus/` (4 files)** — **user provides via 5-min real-capture step before implementation starts**. Each fixture has rich provenance (D14 catch #9):
  - 1-roadmap-reassessment
  - 2-test-plan-extraction
  - 3-pair-review-test-list
  - 4-shallow-control (negative control — D12)
  - Provenance fields per fixture: source skill commit + repo commit + exact prompt/input + generation model (D14 catch #8) + UTC timestamp + worktree state

- **`package.json`** — add `@anthropic-ai/sdk` to `devDependencies`.

- **`CLAUDE.md ## Testing`** — short paragraph documenting EVALS=1 contract.

- **`docs/PROGRESS.md`** — post-merge changelog row (D14 catch #10).

## Decisions inventory (14 total)

- **D1 (Mode A)** → A
- **D2 (gating)** → A
- **D3 (temp+threshold)** → A
- **D4 (uniform threshold)** → A
- **D5 (hand-rolled predicate)** → B
- **D6 (unit tests)** → A
- **D7 (real captured fixtures)** → A
- **D8 (parallel beforeAll)** → B, **REVERSED by D10**
- **D9 (codex outside voice)** → A
- **D10 (sequential)** → B
- **D11 (validator baked in)** → B
- **D12 (negative control fixture)** → A
- **D13 (regex+validator)** → A — tool-use migration deferred to Future
- **D14 (10 codex catches batch)** → A

## 10 codex catches batch-applied (D14)

1. bun:test default timeout 5s → add per-test `{ timeout: 60_000 }` ✓
2. SDK double-retry → set `maxRetries: 0` on client ✓
3. EVALS gating loose → change to `process.env.EVALS === '1'` exact check ✓
4. beforeAll throwing skips tests → noted; single-workstream-OK as signal ✓
5. isJudgeScore edge cases → reject NaN/Infinity/decimals/0/6/null/wrong-types ✓
6. stop_reason not checked → add stop_reason check before regex extract ✓
7. temperature 0 determinism claim → note Anthropic doesn't guarantee; fix messaging ✓
8. Model hardcoding lifecycle drift → pin exact model, record in fixture provenance ✓
9. Fixture provenance too thin → add source skill commit + repo commit + prompt/input + model + timestamp + worktree state ✓
10. PROGRESS.md path → correct to `docs/PROGRESS.md` ✓

## Codex cross-model tensions resolved

**T1 → D8 reversed to D10 (Parallel vs Sequential):** Codex point 3-4 exposed
that Promise.all in beforeAll loses per-fixture granularity and parallelism
doesn't save enough wall-clock on 3 paid calls. **Chosen:** Sequential
test.each (D10→B).

**T2 → D11 (callJudge signature):** Codex point 7 required validator baked
into callJudge signature: `callJudge<T>(prompt, validator)` instead of
`callJudge<T>(prompt)` alone. **Chosen:** Validator baked-in (D11→B).

**T3 → D12 (Coverage):** Codex point 14 required negative-control fixture to
test rubric sensitivity. **Chosen:** Add 4th shallow-control fixture (D12→A).

**T4 → D13 (Regex vs Tool-use):** Codex point 9 raised tool-use JSON schema
as alternative; review chose greedy regex for v1. **Chosen:** Keep regex,
defer tool-use as TODO (D13→A with caveat). Lives in `## Future`.

## Cost

~$0.05–0.15 per `EVALS=1` run.

## Worktree parallelization

Per re-plan: declares `_Depends on: Track 4A_` in ROADMAP for the trivial
additive merge on `package.json` (devDependencies) + `CLAUDE.md ## Testing`
(paragraph). Develop in parallel with 4A; merge after 4A lands.

If Pre-flight `4A-audit` kills 4A, drop the dep declaration — 4C ships
standalone.

## Next steps

1. Capture the 4 fixtures (3 positive + 1 negative-control) with full
   provenance — ~5 min, the only manual step.
2. Implement `tests/helpers/llm-judge.ts` with all 14 codex hardenings.
3. Implement `tests/helpers/llm-judge.test.ts` (6 mocked units).
4. Implement `tests/skill-llm-eval.test.ts` (sequential, EVALS=1 gated).
5. Add `@anthropic-ai/sdk` to devDeps; document in CLAUDE.md.
6. Smoke-test manually with `EVALS=1 ANTHROPIC_API_KEY=... bun test tests/skill-llm-eval.test.ts` before declaring shipped.
7. `/ship` runs the full bun test suite (default-mode, EVALS gated to skip).
