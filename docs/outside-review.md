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

Upstream `7cb151bf` (gstack PR #4140, committed 2026-11-07) introduced the
closing verdict-line rule and first shipped in 1.99.0.0 (upstream CHANGELOG
dated 2026-11-09); installed 1.99.1.0 (checkout `b9bbc31c`) carries it. On the
review and structured gates the reply's last nonempty line, `VERDICT: CLEAN` or
`VERDICT: FINDINGS`, is the only evidence for a clean verdict; a reply without
it reads `missing_verdict`. A `VERDICT: FINDINGS` line followed by the
Recommendation reads `unverified_verdict`; a misplaced `VERDICT: CLEAN` reads
`missing_verdict`. `POLICY` and the delegate format ask for it last
from this change. The inspected revision above stays `e2fffee3` (1.91.208.0)
until an installed-call check; the corrected reply shape was also checked in
memory against that revision's classifier during planning.

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
The voice has no tools. When the helper recognizes a missing-context marker
that the [exact-form rules](#exact-reply-forms) leave in the reply, it reports
`needs_context: true` and coverage stays missing. The parent supplies specific
missing material named in the reply only in a justified context extension.
Recovery of marker syntax never resends the prompt and never calls a model.

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

The review policy (`POLICY` in `src/outside-review/prompt.ts`) asks a voice to
write its closing lines in this order: for a clean review, `NO_FINDINGS: none`
immediately before `Recommendation: <action> because <specific reason>`, with
nothing between them and its reason in the because-clause; after any findings,
`Recommendation: <action> because <specific reason>`; and as the last line of
the reply, `VERDICT: CLEAN` (no findings) or `VERDICT: FINDINGS` (any finding).
Installed gstack 1.99.0.0 and later no longer reads a no-findings sentence as
clean and requires that final `VERDICT:` line for any reply without a blocking
finding. Recovery never moves a misplaced verdict line, so the 2026-11-12 reply
shape (`VERDICT: FINDINGS` before the closing `Recommendation`) and a reply that
opens with `NO_FINDINGS` and ends on other prose both stay uncredited.
`GSTACK_OUTSIDE_TEST_ROOT=<installed gstack root> bun test tests/outside-review.test.ts`
checks these shapes against the installed classifier.

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

## Exact reply forms

`recover()` (`src/outside-review/recovery.ts`) and `parseFindings`
(`src/review-delegate/delegate.ts`) share one linear-time predicate,
`exactForms(lines)`. In `recover()`, counted exact-form lines are blanked in
place before classification, so a counted met-criterion line never reaches the
installed classifier's untagged-item rule. A reply made only of the token has
no closing line and still reads as missing context. There are two exact forms:

- **No-missing-context token:** a line that is exactly `NEEDS_CONTEXT: none`
  (starting in column 0, with that case and single space, optional trailing
  spaces or tabs, and nothing else or formatting on the line).
- **Met-criterion line (outside reviews only):** a line that is exactly
  `<n>. MET`, where `<n>` is a criterion number from `1` to `999` without
  leading zeros (starting in column 0, optional trailing spaces or tabs, and
  nothing else or formatting on the line).

Definitions and boundary rules:

- **Blank line:** matches `/^[ \t]*$/` (spaces and tabs only; a line holding
  only a non-breaking space or a byte-order mark is not blank).
- **Closing line:** matches `NO_FINDINGS: none`, a line starting
  `Recommendation:` in column 0, or `VERDICT: CLEAN` or `VERDICT: FINDINGS` in
  column 0 (each with optional trailing spaces or tabs and nothing before it; a
  bold `**Recommendation:**` line or a leading-space closing line is not a
  closing line).
- **Verdict boundary:** both forms must come before the last exact
  `VERDICT: CLEAN` or `VERDICT: FINDINGS` line when one is present. A later
  recommendation cannot make a form after that line count.
- **Token rule (trailer anchor):** a `NEEDS_CONTEXT: none` line counts only when
  the line above it is blank or it is the reply's first line, every line after
  it to the end of the reply is blank or a closing line, and at least one later
  line is a closing line. A gap named on the line directly above it, a sentence
  running into it, a prose line directly below it, a bold or leading-space
  closing line directly below it, a later paragraph, a second token, or a token
  placed after the final `VERDICT:` line makes it not count, so the reply sets
  `needs_context: true` and fails closed. Two residuals are accepted and pinned
  because omitting the token credits the same text: a gap named in a separate
  earlier paragraph, and a gap named in the closing `Recommendation`'s
  because-clause.
- **MET block rule:** a maximal run of consecutive `<n>. MET` lines counts only
  when the line above the run is blank or the run starts the reply, the line
  below the run is blank or a closing line, and at least one later line is a
  closing line. Any other unlabeled numbered line (such as `3. Met`, `3. MET.`,
  `3) MET`, `**3. MET**`, `03. MET`, or a MET block adjacent to a nonblank prose
  or sub-bullet line or after the final `VERDICT:` line) reaches the installed
  classifier unchanged. A `VERDICT: CLEAN` reply with an untagged numbered
  item remains uncredited under the installed classifier's clean-verdict rule.
- **Other context markers:** the existing marker reader sets
  `needs_context: true` on a missing-context line it recognizes after
  stripping common formatting and prefixes. It matches at the start of the
  resulting line and ignores fenced examples. For an inline code span, it
  checks for a bare `NEEDS_CONTEXT` or `NEEDS_CONTEXT:` case-insensitively
  after trimming surrounding whitespace. It treats longer spans as quoted
  examples and does not interpret free-form mentions in prose.

Example 1 — outside clean reply with the no-missing-context line:

```text
I checked every hunk of the diff against the acceptance criteria and the supplied callers.

NEEDS_CONTEXT: none
NO_FINDINGS: none
Recommendation: approve because every criterion is met and no caller changes behavior.
VERDICT: CLEAN
```

Example 2 — outside structured reply with a met-criterion block:

```text
**Criteria assessment**

1. MET
2. MET
3. MET

NO_FINDINGS: none
Recommendation: approve because every acceptance criterion is met and no defect was found.
VERDICT: CLEAN
```

Example 3 — delegated findings reply with the no-missing-context line:

```text
[P2] {"severity":"INFORMATIONAL","confidence":80,"path":"src/outside-review/recovery.ts","line":20,"category":"maintainability","summary":"keep the pre-pass pure","fix":"avoid mutating caller arrays"}

NEEDS_CONTEXT: none
Recommendation: merge, optionally applying the advisory note, because no blocking defect was found.
VERDICT: FINDINGS
```

**Troubleshooting and upgrade reconciliation.** A `needs_context: true` result
(or a delegated `needs-context` fallback) can be caused by a misplaced or
malformed no-missing-context line rather than real missing material. To tell
which, open the saved reply (outside:
`<evidence-directory>/outside-calls/<call id>.json`; delegated:
`<evidence root>/<branch>-delegate-calls/<call id>.json`) and compare it with
the examples above. Because the prompt text is part of the shared prefix and
call identity, this prompt change alters each outside and delegated call id: a
review resumed across the upgrade makes those calls once more instead of
replaying earlier saved results. Before upgrading, reconcile any outside or
delegated call that has a `.claim` file and no saved `.json` result, so the
upgraded version does not dispatch a new paid call past the old claim.

## Measurement baseline

The supplied 2026-10-19 research reports a median $2.55 per call, 265K cache-write
tokens, prompts of 230K–330K tokens, and at least 4 of 26 paid calls uncredited.
These are the comparison baseline, not measurements from this implementation.
Measure the first real review after release against it: per-phase supplied
bytes/section sizes, cache creation/read tokens, output tokens, credited versus
parse-failed calls, billed cost when available and unique actionable findings.
Compare full/delta scopes separately. Claim no saving until that run is measured.
