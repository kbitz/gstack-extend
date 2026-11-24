# /review-and-prep reference: Claude Code outside-review recovery outcomes

## From Bound Claude Code outside calls

A completed response with a marker failure is a **parse failure**, not a
transport outage. The adapter tries conservative formatting recovery and the
upstream structured validator, preserving severity and all findings. Credit
`parse: recovered` exactly as a valid completed voice. There is no paid reformat
or retry. An unresolved parse stays `outside_status: unverified`,
`GATE: MISSING COVERAGE`; an execution failure stays unavailable. Neither is
clean or PASS, and the native pass never substitutes for outside completion.
Retain the upstream review-log schema and record parse detail in `voices.jsonl`.
If the helper reports `needs_context: true` (see `docs/outside-review.md#exact-reply-forms`), keep the voice unverified: when that reply names no specific missing material (for example a misplaced or malformed no-missing-context line), record the voice as missing coverage and make no context extension; otherwise the parent identifies
the missing excerpts and supplies them only in a separately justified context
extension, recording why the input changed; never repeat unchanged content to
repair markers. Report a credited reply's counted no-missing-context line as "no missing context" and never print the token itself in stage output or in a `User-facing change:` line. An unresolved `.claim` requires reconciliation with the original
process/result, never deleting the claim or choosing a fresh directory to retry.

<!-- end of skills/references/review-and-prep/conditional-outside-recovery.md -->
