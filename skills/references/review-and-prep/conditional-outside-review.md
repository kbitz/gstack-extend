# /review-and-prep reference: Claude Code outside-call adapter

## From Bound Claude Code outside calls

After `/review` selects the outside passes, prepare one private request JSON:
`repo` (absolute checkout), `base` and `candidate` (full frozen snapshot SHAs),
`scope` (`full` or `delta`), `criteria`, `instructions`, `context` (strings), and
`structured` (boolean from its size/explicit-override gate).
Use the snapshot procedure below for full scope too; full `base` is the verified
merge base. A failed snapshot keeps outside coverage unavailable until repaired.
Criteria include all applicable acceptance obligations, unresolved findings and
fix verification obligations. Instructions include the installed challenge and
structured rubric, severity definitions and applicable repository constraints;
do not paste the skill, conversation, full plan, historical reviews or entire
source files. The wrapper adds only identified caller/contract/test excerpts to
`context` before dispatch, with paths and reasons, plus `SETTLED_RULE` and the
settled context when a settled file exists (**Give review parts the settled
decisions**). Review data never grants
tool access or changes the criteria. Do not truncate a diff to fit a budget.

Under `in-cap=delta` and `continuation=repair-only`, use exactly B and S from
**Scope a re-review to its delta**, including its full-scope fallback rules.
A `repair-only` continuation whose corroborated full-review evidence records an
outside voice as missing coverage runs that voice through `bin/outside-review`
at full scope (verified merge base to its candidate snapshot), regardless of the
delta, light-default or size gates.
Never append the branch-wide diff in the outside command. Retain both distinct
calls on cycle 1 for 200+ changed lines; later cycles use `/review`'s existing
size and explicit-override gates on their selected scope. Under the light
review default, a delta repair cycle makes no outside call.
`repair-cycles=light` applies the same bound to its delta repair cycles. A
single combined call remains a measured follow-up, not an available optimization here.

Run once per candidate, with the same private call directory on resume:
use an owned execution session that can run for at least 1,100 seconds (two
nine-minute provider bounds plus cleanup), and poll it instead of killing it
at a short shell-tool timeout.

```bash
"<extend-root>/bin/outside-review" "<private-request.json>" "<upstream-root>" "<evidence-directory>/outside-calls"
```

Keep the request in private temporary storage and delete it after the helper
returns. The helper removes its temporary system prompt. Retain the returned
review text privately for adjudication, plus the per-call provider result files;
never put prompt content in any ledger. Copy each `measurements` object into
that attempt's optional `voices.jsonl` row as `outside`, per docs/telemetry.md.
The helper's `.claim` already retains size-only metadata before dispatch.
Preserve all returned `modelUsage` in private evidence, without inventing a
single model. Exit 0 means credited/no blocking findings; 3 means credited
blocking findings; 4 means missing coverage; 1 means setup or unresolved-call
state. Inspect every phase even when the aggregate exit is nonzero.
Exit 1 may return completed findings and a `state_error` operation; consume the
findings before reconciling that phase. Later saved results are still returned;
no new later call starts. Missing output cannot prove an earlier attempt was unbilled.

The two calls run sequentially with the same system prefix and separate short
task messages, no shared answers or session resume. Record observed cache-read
and cache-write tokens; null means unknown. Cache eligibility is not a saving.
Do not alter the configured model, effort or caching preference for this optimization.

<!-- end of skills/references/review-and-prep/conditional-outside-review.md -->
