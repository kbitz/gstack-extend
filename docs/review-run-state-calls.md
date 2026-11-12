# `/review-and-prep` run-state caller procedure (`run-state=record`)

## Status

Experimental until Track 79A's default decision, like `bin/review-state` ([design D1](designs/review-run-state.md#d1-roles)); read once at Step 1 only under `run-state=record`. Receipts, PR text and handoff lines are written as today (Track 78A renders them). Upstream `/review` is wrapped, never edited. The state file is internal: external readers keep reading the published receipts and handoff lines, never `review-run-state.json`.

## Activation

Active when the review policy parsed with `run-state=record` and `"<extend-root>/bin/review-state" --version` exits 0 (`src/review-state/cli.ts` prints `review-state <version|unknown>` and exits 0), resolving `<extend-root>` from the installed skill's `.extend-root`. Otherwise the full receipt says `Run state: unavailable (helper-missing)` and the invocation runs today's inline path in full, the **Workflow metrics (optional, local)** section included.

## Directory, inputs and IDs

`--dir` is the invocation's evidence directory (**Capture evidence and commit**), created with `mkdir -p` before `start` (the helper never creates it, [design D2](designs/review-run-state.md#d2-location)). Each `--input` is an absolute path to a JSON file written into that directory with the file-write tool. IDs (`run_id`, `pass_id`, `attempt_id`, `correction_id`, `gate_id`, `audit_id`, `checkpoint_id`) are minted as the Workflow metrics section mints IDs today (fresh lowercase random UUIDs); voice IDs and `found_by` follow its attribution bullets (`skills/review-and-prep.md`). Request shapes: `"<extend-root>/bin/review-state" <command> --help` and [design D13](designs/review-run-state.md#d13-request-shapes-and-walkthrough). Evidence files a record names live inside the evidence directory. Issue calls one at a time from this session, from inside the work tree.

## Fixed points

| Skill heading | Call | When |
|---|---|---|
| `## 1. Establish the branch, PR, and review inputs` | `start`, then `derive` | Run `start` once at the end of Step 1 when the base tip, plan reference and SHA-256, parsed policy (`value`, `source`, `delegation`) and continuation counts are known, and before Step 2's first span; set `session_id` from this segment's `GE_TELEMETRY: session=…` line, or `null` when the start printed any `GE_TELEMETRY: unavailable` line or no session line; set `pr` and `gh_login` to `null` when not yet known. Then run `derive` (below) before any span. Step 1's own `evidence` and `scope` spans come before `start` and are not emitted under `run-state=record`. |
| `## 2. Review and verify locally`, `### Scope a re-review to its delta`, `## 5. Triage, fix, and verify locally`, `## 4. Trigger once and await Greptile` | `record pass`, `record correction` | Record `pass` states for each review round (`started` before dispatch, each `attempt` and `voice-complete` as its result is consumed, and `completed` when the round closes; Greptile uses `scope: "greptile"`). Run `record correction` when a finding's adjudication or resolution changes. A retried or replacement attempt names its `predecessor_attempt_id`. |
| `### Record cycle 1's full-review baseline` | `record gate` (`probe-<id>`), `checkpoint before-fix`, `checkpoint next-cycle` | For cycle 1's required Step 4.7 probes, run `record gate` named `probe-<id>` on cycle 1's candidate before the baseline write, mapping the record's outcome `passed` to `passed`, `reproduced` to `failed` with reason `reproduced`, `blocked` to `blocked` with reason `blocked`, `inconclusive` to `blocked` with reason `inconclusive`, and `not-run` to `not-run`. Run `checkpoint before-fix` before each cycle's first fix and `checkpoint next-cycle` at each later cycle's Step 3. |
| `### Prove /ship's release gates on this head`, `### Narrow the pregate after an accepted pass`, `### Repair a test-only final-gate failure` | `record gate`, `record audit` | Run `record gate` for `pregate` and `tests`; run `record audit` for `coverage` and `documentation`. |
| `### Pause for an external full-suite gate` | `checkpoint external-gate`, `checkpoint pause`, `checkpoint resume`, `record gate` (`external-gate`) | Run `checkpoint external-gate`, then `checkpoint pause` (both with the fetched base), at the pause; on resume, run `checkpoint resume` and then `record gate` named `external-gate` with result `attested` for the attestation. |
| `### Manual testing checkpoint and resume`, `### Greptile exits that need a user decision` | `checkpoint pause` | Run `checkpoint pause` (with the current base) at each deliberate pause that a later resume continues (manual testing, Greptile exit question, configuration pause). |
| `### Telemetry start` | `checkpoint resume`, then `derive` | On a resume, run `checkpoint resume` in the paused invocation's evidence directory (its `Evidence:` line) with the new segment's session ID (same `null` rule as `start`), then run `derive`; when no state exists there, `start` a new run at Step 1's fixed point instead. |
| `### When /review stops at its cycle cap` | `checkpoint stop`, `finish` (`stopped`) | Run `checkpoint stop`, then `finish` with `outcome: "stopped"`. |
| `### Readiness` | `finish` (`prepared`, `blocked`, `needs-context`) | Run `finish` with `outcome: "prepared"` after the `gh pr ready` readback, carrying `readiness_confirmed_at` from that readback and `user_facing_changes`; a blocked or needs-context exit records `finish` with that outcome. |
| `### Telemetry finish` | `derive` | Run `derive` once more after the pause checkpoint or `finish` and before Telemetry finish. |

## Derive and spans

Run `"<extend-root>/bin/gstack-extend-telemetry" derive --dir <evidence directory>` from the work tree after `start` and each `checkpoint resume`, immediately before each receipt's `metrics read`, and after the pause checkpoint or `finish` and before Telemetry finish ([docs/telemetry.md](telemetry.md#review-state-derive), Review-state derive). It writes the run `begin`, `pass`, `correction` and run `end` records and any missing `stage-runs` rows; the model writes none of those. In the call that runs the first derive of a segment, resolve `GX_LIB` with the Workflow metrics section's resolver snippet; set `GX_RUN` from `data.current.run_step_id`, `GX_SID` from `data.current.session_id`, and `GX_CAPTURE=1` only when `data.current.run_begin` is `recorded` or `replayed`. Spans, waits and decisions stay as the Workflow metrics section says, with no context-override argument; fix-cycle corrections and attempt `model_context` are not derived (accepted measurement difference, decision d8). Each receipt's `metrics read` uses `data.current.session_id`. Derive's non-`ok` output goes in chat only; a later derive recovers a missed write.

## The baseline fence

While the state is being recorded, run the `cycle-1-baseline` fence with `REVIEW_STATE_DIR` set to the evidence directory for that call only. On `refused cycle-1-baseline: write point not reached (<id>)`, record the named voice result or `probe-<id>` gate and rerun the identical write; never write the baseline around it. Once the state is unavailable for the rest of the invocation, run the fence without `REVIEW_STATE_DIR` so a degraded run never blocks its own `cycle-1-baseline` write.

## Degraded path (design D1)

On a helper result with `retry: "same-input"` (`busy` or `unwritable`; wait `retry_after_ms` when present) or no parseable result line, rerun the identical command once. If it still fails, or on `bad-dir`, `unreadable` (`corrupt` or `newer-schema`) or any other refusal, record no further state for the rest of the invocation, stop setting `REVIEW_STATE_DIR`, keep today's outputs, and add `Run state: unavailable (<reason>)` and `Workflow metrics (local, optional): capture=partial (run-state unavailable: <reason>).` to the full receipt. Never delete a lock or repair a state file: `busy` recovery is manual ([design D8](designs/review-run-state.md#d8-commands-result-envelope-and-reason-codes)). On success the full receipt carries `Run state: recorded (<state path>; rev <n>)`. This implements D14's opt-in-period caller behaviors; every other D14 item stays placed in Track 79A.

## Receipts and handoffs

Receipts, PR text and handoffs are written as today. `Prepared HEAD:`, `Review handoff:`, `Delegated part:` (12 segments) and `delegation: active (…)` stay byte-exact ([design D9](designs/review-run-state.md#d9-derivation-map) and its "Orchestrator gate-read compatibility" note), as do the other kept lines.
