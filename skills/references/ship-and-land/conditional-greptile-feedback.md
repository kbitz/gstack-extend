# /ship-and-land reference: Greptile gate, automatic-trigger checks, and new-feedback triage

## From Greptile and new feedback

**Applicable Greptile gate, before landing:** after ship creates/updates the PR,
require its one completed review with resolved findings, or review-and-prep's
qualifying no-response fallback/acknowledged configuration exclusion. Read that
skill's Steps 4–5 ("Trigger once and await Greptile" and "Triage, fix, and
verify locally") for the first-request, monitoring, provenance and triage
procedure; this wrapper owns the gate without invoking preparation's draft/ready
transitions or draft-only base-merge loop. Use the existing PR state. If no
submitted request/run exists, verify the final pushed head contains the base
ship integrated (record it; a later tip follows Step 3's rule) and required user
testing is complete, then request the first review with the installed MCP trigger or
review-and-prep's comment procedure and `review-and-prep:greptile` marker, using
the bot mention Greptile documents for the PR's draft/ready state. Never make a
ready PR draft to trigger review. Check automatic requests before sending one.
Treat ship opening a ready PR, or pushing to one, as a possible automatic
trigger that reserves the single run unless verified settings exclude automatic
review. Elapsed time or an empty run listing never authorizes a manual request
or another triggering push after such an operation; if no run becomes visible,
ask the user. Record each reservation or submitted request (identifier or
comment URL) and its time in the PR body immediately, before monitoring. A rerun
corroborates that record through run metadata or an unedited running-account
trigger comment; show an uncorroborated record to the user rather than treating
it as submitted or absent.
If the same run is queued/running, keep monitoring it; if failed/cancelled, stop
without retrying. Missing/ambiguous evidence never counts as completed. Use the
same ten-minute no-response fallback only under its documented conditions.
This gate also applies when ship's early triage had no PR/comments to inspect.

Verify prior dispositions against current content; do not reply again to
unchanged findings. Compare comment/review IDs and updated content, including
summaries and resolved/outdated threads, to catch later feedback. API failures
are not zero comments. Use installed triage instructions for new feedback and
the shared severity/delta rules, with ship's cycle cap, when fixes are needed. Before every push, including
ship's release push and doc-sync's, check applicable automatic triggers against
the one-run rule. If a push would start a second run, stop before it and ask the
user how to resolve that trigger; never silently change repository settings.
Apply first-run findings locally, then return through affected ship tests/reviews,
push and PR updates before landing. Keep the original request/run; fixes do not
authorize another review. Preserve actual reviewed SHA/base and later local
verification in the wrapper's receipt.

<!-- end of skills/references/ship-and-land/conditional-greptile-feedback.md -->
