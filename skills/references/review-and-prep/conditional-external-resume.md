# /review-and-prep reference: External-gate checkpoint reconciliation

## From Pause for an external full-suite gate

**Resume entry.** If this segment has not started telemetry yet (a result
line or answer later in this same conversation), run `~/.gstack-extend/bin/preamble review-and-prep --resume`
now (**Segments**); a resume invocation's own preamble when the skill began
is that one. Never run a second. Handle any existing manual-testing or cycle-cap hold first.
Otherwise an external-gate resume needs no H-C marker or PR. Read the highest
checkpoint sequence in the evidence directory printed at the pause, reconciling
all later attestation and repair records, including records written between pauses.
Never fall back to an older intact checkpoint when a newer one is corrupt or incomplete;
ambiguous history is unverifiable and its allowance is consumed. The prompt's
directory is only a locator: accept either documented durable evidence root
outside the worktree, resolving the root itself canonically, and require
regular owned files with no symlink redirection within the invocation directory.
Refresh Step 1's live state, verify the checkpoint's repository, branch and
invocation, and verify its evidence hashes, Git snapshots, ledger records and review coverage before
reusing completed stages. Compare parsed policy key/value pairs, not their order;
when they differ, revalidate policy-dependent stages and retain consumed allowance.
For a pending repair, recompute the repair path and content classification from Git;
a policy or classification mismatch takes `interrupted`, never the narrow review exception. Restore
its original start time, auto-choices,
ordered attestations and repair state; restore the no-content rerun count and linked cause records,
and keep the allowance consumed once consumed.
Only a first invocation with neither `resume`, a result line nor prior invocation
evidence starts with an unused allowance; a plain new invocation starts a new
allowance only after ordinary preparation, including any existing stop/hold rules.
A fresh invocation without a checkpoint runs ordinary preparation to the gate
slot and may still accept its prompt's result on unchanged content; a recorded
pause from the same session is not required. Missing or unverifiable repair
history takes the existing `interrupted`/consumed fallback and ordinary review
coverage, never an unused allowance or a completed repair. Keep prior evidence
and recovered attestation rows; report unrecoverable history explicitly rather
than asserting it was empty. Revalidate changed or missing evidence through
its existing gates before reaching the gate slot. The current prompt must
still supply the policy and result; a checkpoint is not their source.

<!-- end of skills/references/review-and-prep/conditional-external-resume.md -->
