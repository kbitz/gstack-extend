# /review-and-prep reference: Corroboration and resumption of existing review records

## From 1. Establish the branch, PR, and review inputs

While the run state is recorded, a resume or repeat invocation first runs the calls document's **Resume** procedure, which supplies the recorded checkpoint, passes and gate results that the reads below would otherwise rebuild; the corroboration and authorization rules below still apply.

With `full-suite=external` in the invocation prompt, read **Resume entry** in
**Pause for an external full-suite gate** now before scheduling review or checks;
its local checkpoint may exist without a PR. This route does not waive any
manual-testing or cycle-cap hold already present on a draft.

For a draft paused for manual testing, read Step 3's resume procedure now and
load the user-test results before scheduling reviews or checks. For a draft
stopped at `/review`'s cycle cap, every invocation (including a plain call or
`resume`) reads Step 2's cycle-stop procedure now and handles its stopped record
like a pause. No new `/review` starts without valid continuation authorization
or the user's decision in this session. A repeat call,
including `/review-and-prep resume`, continues that receipt; reuse completed
stages with current, equivalent evidence and run only missing or invalidated
verification. Do not repeat an unchanged `/review` just to reach the checkpoint.

A draft whose receipt records a pending exit question or a configuration pause
under **Marking ready would start a second run.** (E1(a)) resumes like a
manual-testing pause. Refresh the live PR, run state, and configuration, then
re-evaluate the exit, because the edge may have resolved (for example, a run
reported failed may have since completed). Reuse verified authorization for
the exact configuration repair and complete it within its approved scope.
Ask again only if authorization cannot be verified, the proposed policy or
conflicting values change, or the exit still needs a new decision. Before a
draft exists, an available authorization from the user's conversation remains
sufficient; record it when Step 3 creates the draft. If no verifiable
authorization is available, ask again.

Read the body receipt and the running account's `review-and-prep:paused:`,
`review-and-prep:stopped:` and `review-and-prep:receipt:` comments, and use the
newest record. Restrictions from a pause or a stop hold until a later receipt
records their resolution. A later corroborated pause may resolve the review-stop
restriction with `reviewRestrictionResolved: true`, after verifying the review
completed; its pending user tests and postponed Greptile still hold.
Recency alone never clears them. Corroborate the record by author and edit history
(Boundaries), and by its pause SHA being an ancestor of HEAD. Fix commits from
`/pair-review` are expected on top. Its restrictions (pending user tests,
postponed Greptile) hold even when unconfirmed.

Handle a refresh's H-F checkpoint under that reference before choosing an
ordinary review. For an ordinary invocation on a draft, reuse a prepared
receipt only if its head, tree and base match the checkout and verified base tip. If that
receipt is stale, start a full review after reconciling holds and checking for a
current resumable run. This also covers an inline base-refresh escalation.

For an existing **ready** PR: verify its state and any preparation receipt. If
the same HEAD/base is already fully prepared and no local work remains, report
it as already complete and regenerate the Step 7 handoff from verified evidence.
"Fully prepared" requires the current Step 6 evidence gates, including the
complete scope matrix and per-stage review results; only the draft-state
requirement is inapplicable to this read-only check. An older receipt and matching
HEAD/base alone do not qualify. If required evidence cannot be validated, report
incomplete preparation and withhold the success handoff while leaving it ready.
Otherwise stop under the draft-once rule and explain that further preparation
requires a draft PR.

<!-- end of skills/references/review-and-prep/resume-review-records.md -->
