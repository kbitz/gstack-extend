# /review-and-prep reference: Manual testing pause receipt assembly

## From Manual testing checkpoint and resume

The PAUSED body uses Step 6's `## Review and prep` body-section shape, listing
pending user checks under open checks, and every line this section says to
record goes to the full receipt (`full-receipt-<n>.md`). While the run state
is recorded, render the full receipt and paused comment, then the PR body and
final handoff at the calls document's **Fixed points**
(`"<extend-root>/bin/review-state" render --help`). Follow that table's pause
recovery for `greptile-value-unrecognized`. Use the inline fallback when
recording is unavailable or another render refusal occurs. The paused comment
carries `<!-- review-and-prep:paused:<full-sha> -->`,
`Resume with /review-and-prep resume; do not run /ship on this draft.` and
`Full receipt: <evidence locator>; sha256: <64 hex>`. Before posting the
comment once per pause, scan its bytes with `scan-text` (wrapping
`gstack-redact --from-file`) or a manual inspection. The marker is distinct
from `review-and-prep:receipt:`, so `/ship-and-land` never reads a paused
receipt as prepared. If posting the paused comment fails, keep the pause and
keep preparation incomplete until the compact comment is confirmed; report its
absence and the local full receipt, and retry the post on the next resume.
The body's status preserves the hold; its pointer alone never authenticates
the missing checkpoint.

<!-- end of skills/references/review-and-prep/conditional-manual-pause-receipt.md -->
