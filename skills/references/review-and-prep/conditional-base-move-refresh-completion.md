# /review-and-prep reference: Complete or resume a base-move refresh

## From 1. Establish the branch, PR, and review inputs

### G. Fast path

When every changed file is `base-only` or `resolution` and no `base-only` change alters reviewed behavior:

- **Delta review.** The host session reviews the delta alone — no nested `/review` cycle, no subagent, no delegated part, no outside voice, no coverage audit, no documentation audit, and no Greptile run. Check each `resolution` hunk (both sides' intent preserved, no dropped entries, no duplicate IDs) and each `base-only` change against the behavior rule above. Record the completed delta pass on `S` (`--coverage delta --scope local --cycle 1 --delta-from <R> --commit <S> --voice core`). Require HEAD and its tree to match `S` before recording the pass, freezing the final gate, pushing or marking ready. An unexpected mismatch takes `delta-unverified`; only a D merge or the allowed fix can establish a new `S` and fresh facts.
- **Fixes.** Allow at most one fix round per refresh, limited to `resolution` files and committed on top of the merge. Retain the findings and rerun delta facts, classification and affected checks on the fix commit before recording the accepted pass. A remaining defect or one outside this class escalates with `delta-finding`.
- **Final gate.** Use Step 2's pin rule, pregate and secret checks. Under `full-suite=external`, use H-F and route Freeze's new-base merge through D–G. A failed preflight, final gate or external `fail` escalates `final-gate-failed`.
- **External resume.** Route H-F to G before review selection when the supplied evidence-directory basename starts with `refresh--`, including when the directory is lost, or a checkpoint names `refresh-1.md`. The basename selects the route only. Bind `R`, the `refresh-1.md` path and SHA-256, the expected published head and fix allowance in every H-F checkpoint, even inline. The published head starts at `R` and advances only after verified draft-push readback. Verify before review selection or result handling. Restore refresh mode only when the file matches the bound SHA-256. Restore its restriction and disclosures. Recheck E's checkout checks, A's chain and the plan hash. A verified continuation skips A and B. Require the live draft head to match the checkpoint's published head and apply H-F freshness and result rules.
  Invalid evidence with matching checkout escalates `delta-unverified`. Omit the invalid evidence on recorded resume. If the checkpoint is lost, verify the draft identity and recover `R` from its latest corroborated prepared receipt chain. Match the clean checkout's head and tree to the supplied H-F result. Require the published head to descend from `R` and be included in local HEAD. Use the sole merge base of the fetched target and that HEAD as the last included base, requiring it to descend from the reviewed base and advance it. Escalate only with verified bindings. Hold BLOCKED if a binding cannot be verified, and end the refresh in either case.
- **Base moves again.** If the target base moves again before readiness, repeat Sections D through G from the same reviewed head `R`.
- **Push.** Before each push, verify A's chain and current plan SHA-256 and repeat E's checkout checks. If a proof fails, escalate `delta-unverified`. Reverify the open draft's branch, base and published head under Step 3, and use the verified `S` as the source of the normal feature-branch push. Hold on stale Greptile evidence. Never request Greptile. Step 3's CI check and E1 apply.
- **Readiness.** Step 6 applies with these substitutions:
  - verify A's receipt chain and the current plan SHA-256, escalating `delta-unverified` if verification fails;
  - link the original full review, each verified refresh and this delta pass. Carry the original matrix, scope and user tests by reference;
  - omit both audit records so the compact receipt renders `- coverage: not-run` and `- documentation: not-run`. Record `not-run (refresh; /ship-and-land runs them)` in full receipt and body. These skips permit readiness;
  - the pregate (or the accepted external attestation and its narrowing rules) must be current for the final head, tree, and base.
- **Receipts.** Put the Refresh line, file classes and immediate predecessor's comment URL in the full receipt and body summary. Preserve `Disclosure evidence: unavailable` in the full receipt when present in `refresh-1.md`. Follow Step 6 through readiness. Carry `reviewRestrictionResolved: true` to the receipt and finish when corroborated. Pass the saved disclosures to `finish prepared` with `--user-facing-change`. Then derive and render `final`.
- **Final message.** Print the Refresh line:
  `Refresh: review-and-prep-refresh/v1; cause: base_moved; reviewed: <40-hex>; head: <40-hex>; base: <40-hex>; delta: base-only=<n>, resolution=<n>; gate: <pregate-pass|external-pass>`
  Report unavailable disclosures, emit the rendered final bytes and finish Telemetry with `--outcome success`.

### H. Inline fallback

For BLOCKED, report the reason and observed state, finish Telemetry with `--outcome blocked` and use Step 7's `next: none; status: blocked` stage line. Inline, emit A's `Refresh refused: review-and-prep-refresh/v1; reason: <cause|state|receipt|current>` or F's escalation with its stage line. On success use G's Refresh line, H-B fence, carried `User-facing change:` lines, and `Stage handoff: stage-handoff/v1; stage: review; next: ship-and-land; status: done; head: <40-hex>; plan-sha256: <64-hex or none>`.

<!-- end of skills/references/review-and-prep/conditional-base-move-refresh-completion.md -->
