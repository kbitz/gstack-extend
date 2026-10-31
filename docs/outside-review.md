# Bounded Claude Code review calls

`review-and-prep` overrides only its nested Claude Code outside dispatch.
This is extension-owned adapter code, not a fork: it imports the installed
upstream transport, command resolver and result classifier. Supervision,
authentication, model selection, provider errors and severity interpretation
remain upstream responsibilities. Direct `/review`, autoplan and other outside
providers are unchanged.

## Upstream revision

The integration was re-inspected against gstack commit
`e2fffee3114e90ce2a7d165f09d3efce3555e252` (1.91.208.0, 2026-10-25): `lib/claude-code.ts`
(`runClaudeCode`), `lib/claude-bin.ts` (`resolveClaudeCommand`),
`lib/outside-review-result.ts` (`classifyOutsideReview`) and the rendered Codex
review challenge/structured dispatch. It was previously inspected against
`d8753130710de2647f7ea3bdd19ffa793f3d5c6d`; the only change to those three files
since (and none to `review/SKILL.md`) is `db87940e` (1.91.198.0): a reviewer's own last `Verdict: not ready`
line now makes advisory-only findings a `findings` verdict. The adapter's call
shapes and the recovery code are unchanged by it, and recovery still credits a
completed voice only when the classifier does. The imported helpers are listed
once, in `UPSTREAM_HELPERS` in `src/outside-review/cli.ts`; the adapter and
[`bin/upstream-check`](upstream-check.md) both read that list. Missing exports
fail before dispatch. Upstream upgrades need the adapter tests and an
installed-call check; a fixture does not establish provider cache reuse or
installed-host acceptance, and a passing `upstream-check` is not that check.
Re-inspect the adapter against the installed upstream before changing the
revision above.

## Invocation and scope

Internal command (Bun 1.3.3+):

```sh
bin/outside-review request.json /absolute/installed/gstack /private/evidence/outside-calls
```

The request is a private temporary JSON file with `repo`, full 40-hex snapshot
`base` and `candidate`, `scope: "full" | "delta"`, `criteria`, `instructions`,
`context` strings, and a `structured` boolean. The wrapper validates scope and
chooses both endpoints using v0.38's existing full/delta policy. The helper
generates only `git diff base candidate` (including binary changes, without
external diff drivers or textconv). It cannot certify the parent's scope choice.
Never put the request in the source checkout or retained telemetry.

Supply acceptance criteria and the two installed review rubrics, not whole
skills or session history. The **wrapper adds context**, selecting specific
callers, contracts and tests before dispatch; it records why each is relevant.
The voice has no tools. `NEEDS_CONTEXT` keeps coverage missing until the parent
provides the named material in a justified extension. Recovery of marker syntax
never resends the prompt and never calls a model.

The CLI returns `results` (private review output, provider usage and per-phase
classification) and content-free `measurements`. Exit codes: 0 credited with
no blocking findings; 3 blocking findings; 4 at least one uncredited voice;
1 input, setup or unresolved-call state. Always consume all phase findings,
even when another phase is missing. P2/P3 findings still need adjudication.
Exit 1 can also return completed paid results alongside a content-free
`state_error` operation (`read-result`, `claim`, `dispatch`, `save-result` or
`blocked-by-state-error`). Consume those findings before reconciling the failed
phase. Later saved results are still read, but no later call starts.

## Shared prefix and bounded context

The two independent calls use an identical custom system prompt file containing
the review policy and JSON-encoded material, and distinct short task messages.
They run sequentially to let the first populate the cache before the second.
No answer from one voice is fed to the other. Keep the first-cycle 200-line
structured gate and all explicit overrides. Combining the two voices needs
retained-result evidence that it preserves their distinct findings; defer it
until that comparison exists.

The adapter uses upstream's restricted transport in the original repository,
preserves native user/project/local settings and replaces the default system prompt,
excludes discovered CLAUDE.md material and auto memory, and disables session
persistence. Upstream still disables tools, hooks and MCP. Auth and configured
environment model selection are preserved; no credential files are read by the
adapter. Organization-managed instructions cannot be suppressed. Native CLI
overhead is not observable in bytes, so `provider_overhead_bytes` is null.
The explicit instructions must carry the applicable project constraints.

Claude Code manages prompt caching automatically at prompt boundaries. Identical
system prefixes make reuse possible; cache minima, TTL, provider settings and
model changes can prevent it. See [Claude Code caching](https://code.claude.com/docs/en/prompt-caching)
and the [CLI reference](https://code.claude.com/docs/en/cli-reference).
Report provider cache-read/write counts, never infer a hit from matching hashes.
Keep the original configured model and effort; this change does not trade down
review capability. First real post-release review measurement is still required.

## Recovery and storage

The installed classifier owns severity and execution checks. Recovery accepts
only a completed execution, normalizes wrapped recommendation headings and
lowercase priority labels and one-severity qualified labels, and permits a missing recommendation when the
upstream structured validator independently establishes findings or an explicit
no-findings conclusion. Refusals, failed execution, ambiguous prose and missing
context remain uncredited. A failed parse is `unverified`, not `unavailable`.
No reformat model is needed, so malformed markers cannot cause another bill.

Before a call, the helper exclusively creates a `.claim` containing only its
hash, phase, dispatch time and prompt byte measurements. It saves the original
provider result in a private `.json`. Repeating the same content, task and
transport identity in this invocation's directory reparses that result locally.
A claim without a readable result stops; reconcile the original attempt before
continuing. Do not delete claims, substitute directories or silently rerun.
Directories must be private, owned by this invocation and retained across its
resume. They hold private review responses, never prompt text. Temporary prompt
files are removed in `finally`; after an abrupt process kill, clean only that
attempt's temporary directory once its process is known to have ended.

Telemetry is separate from the paid-call state. A failed optional `voices.jsonl`
write never changes the result. A state write failure does prevent another call,
because otherwise a paid attempt could be repeated without knowing its outcome.

## Measurement baseline

The supplied 2026-10-19 research reports a median $2.55 per call, 265K cache-write
tokens, prompts of 230K–330K tokens, and at least 4 of 26 paid calls uncredited.
These are the comparison baseline, not measurements from this implementation.
Measure the first real review after release against it: per-phase supplied
bytes/section sizes, cache creation/read tokens, output tokens, credited versus
parse-failed calls, billed cost when available and unique actionable findings.
Compare full/delta scopes separately. Claim no saving until that run is measured.
