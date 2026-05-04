# Group 4 implementation plans

Implementer artifacts for Group 4 (Test Leverage Patterns). Each Track has a
locked `/plan-eng-review` plan extracted from the original review session.
Implementers consume these directly — no re-review needed.

## Files

- [`track-4a-plan.md`](./track-4a-plan.md) — Touchfiles diff selection (L, ~630 LOC). **Gated on Pre-flight `4A-audit`** (see `../group-4-replan.md` for the threshold).
- [`track-4c-plan.md`](./track-4c-plan.md) — LLM-as-judge for skill prose (M, ~370 LOC).
- [`track-4d-plan.md`](./track-4d-plan.md) — Audit-compliance test (M, ~150 LOC).

Track 4B was dropped from Group 4; the full original scope (eval persistence
+ reader + regression gate) lives in `../../ROADMAP.md` `## Future`.

## How to start a new workspace

Open a fresh Conductor workspace on `main`, then prompt the agent:

```
Implement Track 4X from gstack-extend's ROADMAP. Read in order:
1. docs/designs/group-4-replan.md (re-plan context, why 4B was dropped)
2. docs/ROADMAP.md Group 4 Track 4X entry (summary + locked decisions)
3. docs/designs/group-4/track-4X-plan.md (full plan with all decisions and codex catches)

Pre-flight 4A-audit greenlit at <X%>. (← only for Track 4A)

Don't re-do the eng-review. The plan is locked. Implement what we planned,
run tests, /ship when done.
```

## Cleanup

Each file should be deleted when its Track ships (CHANGELOG row + git history
preserve the decisions). The directory disappears when Group 4 closes.
