---
fixture: 1-roadmap-reassessment
kind: positive
source_skill: skills/roadmap.md
source_skill_commit: 200d8c4b29a30264abc2b0ddc670467a0c35acaa
repo_commit: 696ded8577aa21b6dae0d87bac32f32b7299be61
generation_model: synthesized
generation_timestamp_utc: 2026-05-04T15:00:00Z
worktree_state: clean (branch kbitz/track-4c-judge)
input_prompt: |
  Hypothetical /roadmap reassessment run after a Group 4 re-plan landed.
  TODOS.md inbox carries 6 items added by `/plan-eng-review` sessions across
  4 sibling Conductor workspaces; the audit reports 3 in-flight Tracks
  (4A/4C/4D) and warns SIZE on Track 4A (~630 LOC vs 300 LOC default cap).
provenance_note: |
  Synthesized from observed `/roadmap` reassessment behavior documented in
  PROGRESS.md v0.18.0 (LLM-owned reassessment proposing plan diffs covering
  structural changes + closures + placements). Replace with a real captured
  run when one is available; the fixture's role is to anchor "what good
  reassessment prose looks like" for the LLM judge.
---

# Reassessment proposal

## Summary

Six items in the inbox come from four parallel `/plan-eng-review` sessions
that ran in workspaces bogota, dalat-v1, valletta, and richmond. Reading
all six together, three are correction targets (4B's "Track 4D collision",
4A's TEST_TIERS deferral, 4B's NOT-parallel-safe claim) — they propose
work that contradicts other in-flight Tracks. Two are deferrable
follow-ons (callJudge tool-use migration, judge-floor tightening after
data accumulates). One belongs in `Future` (full original 4B scope, depends
on a producer that doesn't exist yet).

The audit's SIZE warn on Track 4A is real but defensible: codex flipped
the approach from a manual-glob map (~150 LOC) to a hybrid import-graph
(~630 LOC) for correctness, and the four safety fallbacks plus the three
structural invariants in `tests/touchfiles.test.ts` are load-bearing
defenses, not padding. Override with a one-line rationale on the SIZE
finding rather than splitting the Track.

## Plan diff

1. **Drop Track 4B from Group 4.** The narrow scope (types + dir resolver
   + skipped stub) is "scaffolding pretending to be a gate" because no
   Track in this codebase produces eval-store data. Move the full original
   scope (writer + reader + comparator + regression gate) to `Future`,
   tagged `eval-store-producer-required`. Lift D3/D6/D7/D8/D9/D10/D11/D14
   from the locked 4B eng-review so the eventual implementer doesn't
   re-litigate.

2. **Keep Tracks 4A, 4C, 4D as the active Group 4.** Add a Pre-flight
   `4A-audit` (timing audit, no code, ~30 min) — kill-cheap option for
   4A's L scope. Greenlight ≥40% wall-clock saved on the 117s baseline,
   judgment 25–40%, kill <25%. Result recorded inline in the re-plan doc.

3. **Track 4C declares `_Depends on: Track 4A_`** in ROADMAP.md to clear
   the audit's COLLISIONS check on the trivial additive merge overlap
   (`package.json` devDependencies + `CLAUDE.md ## Testing` paragraph).
   Serializes the merge order, not the work; drop the dep if Pre-flight
   kills 4A.

## Closures

- `[plan-eng-review] Track 4D rename (collision with reader follow-on)`
  in dalat-v1 worktree → KILL (the rename is unnecessary once 4B is
  dropped; the collision was a phantom).
- `[plan-eng-review] gbrain-sync allowlist for evals dir` from dalat-v1
  → DEFER to `Future` (cross-repo work, depends on a producer landing
  first).

## Why this shape and not the alternatives

- Renumbering 4A/4C/4D to 4A/4B/4C closes a cosmetic gap but breaks the
  trace back to the four eng-review session artifacts. Keep IDs.
- Inventing a Pre-flight just to absorb the trivial `package.json` merge
  overlap is overengineering — the dep declaration is the lighter mechanism.
- Splitting Track 4A on the SIZE warn would scatter the 4-fallback safety
  net across two PRs, weakening it.
