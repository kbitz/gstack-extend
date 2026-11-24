# /ship-and-land reference: Parallel readers, severity triage, delta rechecks, and structured output

## From Shared review execution (DOCS and FULL)

**Parallel readers.** For `FULL`, when Red Team's installed activation is known at
dispatch (its diff-size gate), dispatch it alongside the first available specialist
batch, rather than after specialist synthesis; when only a specialist's CRITICAL
finding activates it, dispatch it as soon as that finding arrives. Each reads the same
frozen diff/tree/base independently; it need not wait for the others' findings.
Schedule within the host's concurrency limit. Wait for all required outputs and
confirm every reader/writer is terminal before edits, then deduplicate/synthesize
once. Pass these overrides and the project's Shell Rules to every subagent.
Record each reader in `voices.jsonl` as `/review-and-prep`'s evidence rules
describe (Reviewer join file in `docs/telemetry.md`): local only, never in a
receipt or the PR body. Use a unique branch/invocation subdirectory under an
existing `<state-root>/projects/<slug>/ship-and-land/`, otherwise
`~/scratch/ship-and-land/`. `<state-root>` is `${GSTACK_STATE_ROOT:-${GSTACK_HOME:-$HOME/.gstack}}` (empty counts as unset); a set absolute root counts as existing and is created, a relative one never does. A
failed required reader still needs coverage; a peer's output is not its substitute.
Re-dispatch only that reader once on the same frozen snapshot, keeping completed
peers' outputs; if it fails again, record incomplete coverage and ask the user.

**Severity before Fix-First.** Apply this gate to all sources, including queued
outside/Greptile findings, before AUTO-FIX or ASK. Defer informational suggestions
with a recorded `deferred-informational` disposition and reason; do not edit, ask
about, or repeat a pass merely to clear them. If a nominally informational finding
proves a factual error or reproducible defect, make it actionable with repository
or reproduction evidence and classify its impact. Critical findings and verified
defects use installed fix/user-decision rules. Requests for changes from authorized
human reviewers and known completion/test blockers retain their own gates. Record
automatic deferrals in the wrapper receipt; never fabricate an explicit user Skip.
A deferred Greptile finding still gets review-and-prep's evidence-based reply,
which resolves it for the Greptile gate.

**Delta rechecks.** Retain completed reader outputs on the pre-fix snapshot or
completed coverage from a marked handoff. After actual edits,
obtain an independent read-only check
of the fix delta plus the context needed to detect regressions, using the affected
reviewers/methodology. New claims need repo evidence; code fixes need relevant
callers, contracts and tests. Do not repeat every specialist, core, Red Team and
outside pass on the whole branch. Preserve unaffected coverage with unchanged
approved scope and a verified before/after chain. A bounded base-integration or
behavioral delta gets the same affected-reviewer/regression check; a base change
alone does not force every full-scope pass. Unknown dependencies, missing initial
output, changed approved scope or an unbounded regression requires fresh affected
full-scope coverage.

Only a critical finding or verified factual/behavioral defect triggers another
fixing cycle. Keep ship's invocation-wide
three-fixing-cycle cap and scoped user decisions; require a final independent
zero-edit check of changed inputs with no unresolved blocking findings. Combine
original coverage, dispositions and completed delta checks in the wrapper receipt.
A delta check is a partial native pass, not a new completed full review record.

**Structured output, one attempt.** For any applicable Codex/outside structured
pass, request recognized severity tags or an explicit no-findings marker. On the
first malformed output, timeout or tool failure, record `unavailable`, its source/
phase and reason, then stop automatic attempts on unchanged inputs. Do not retry
merely to get formatting, and do not call prose a clean structured result. Retain
any independently supported concrete defect for severity triage. An optional pass
is reported as unavailable and does not block by itself; a structured/P1 gate the
user or project instructions explicitly require blocks until repaired or
explicitly waived by the user. This
rule does not waive required native review or DOCS claims/consistency coverage.

<!-- end of skills/references/ship-and-land/conditional-shared-review.md -->
