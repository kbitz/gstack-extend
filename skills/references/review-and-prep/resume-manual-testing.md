# /review-and-prep reference: Manual testing resume reconciliation

## From Manual testing checkpoint and resume

On `/review-and-prep resume` (or a repeat invocation), refresh Step 1's live
branch/PR state and read this receipt. Locate `/pair-review` through the host's
skill catalog for its state format and branch-specific session paths. Read the
matching `session.yaml`, `groups/`, `parked-bugs.md`, and `report.md` when present,
or use durable copies of the item-level evidence. A machine-local path alone
is insufficient after a workspace/machine handoff; preserve a sanitized results
summary with tested build IDs, observations, and fix/retest links in the PR
receipt before continuing.

Map the results back to the required matrix items. Accept PASSED and valid
PASSED_BY_COVERAGE results with their supporting evidence, or equivalent
recorded user testing outside `/pair-review`. A completed report, `done`
command, SKIPPED item, parked bug, or fix commit without retesting does not
prove the required behavior. Unresolved required checks remain paused unless
the user explicitly deferred them under Step 2's scope rules.

Inspect fixes and any changes since the tested build. Reuse unaffected local
review/test and user-testing evidence, refresh only invalidated checks, and
request user retesting when the changed behavior needs it. Merge a newer base
through Step 2 and revalidate affected results before Greptile. Commit/push any
verified fixes through Step 3 to the same draft; do not rerun an unchanged full
review or create a new PR just because preparation resumed. Once no required
user testing remains, update the receipt and continue to Step 4 when applicable,
otherwise Step 6. The one-run-per-PR rule and original trigger times still apply.

<!-- end of skills/references/review-and-prep/resume-manual-testing.md -->
