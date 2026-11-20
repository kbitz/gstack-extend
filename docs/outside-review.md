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
The voice has no tools. A `NEEDS_CONTEXT` line that says nothing is missing in an
allowed form (**Recovery and storage**) is not a request; any other `NEEDS_CONTEXT`
line keeps coverage missing until the parent provides the named material in a
justified extension, and one that names no material leaves the voice as missing
coverage. Recovery of marker syntax never resends the prompt and never calls a model.

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
no-findings conclusion. A context-request line saying nothing is missing is not
a request only in one of three forms, read on its own line with code-span text:
list, quote or heading markup alone before the marker, then `none`, the observed
sentence `none of the above depends on missing context` (also with `depend`), each
with an optional period, or `none` and one change statement, as a sentence after
`.` or `;` or as a parenthetical. The change statement says `change` (or
`changes`, `diff`, `fix`, `patch`, `branch`, `commit`, `PR` or `pull request`),
optionally after `the` or `this`, does, do or did not (or `n't`) touch, change,
edit, modify, affect or depend on a list of names. Each name is one or more noun
phrases joined by `of` or `in`; a noun phrase is determiners (`the`, `a`, `an`,
`any`, `its` or `their`, never a word that can stand alone as a subject, such as
`this` or `all`), then attributes, then a code name or vocabulary noun, optionally
after one modifier (a code name, a possessive, or a vocabulary noun without a final
`s`), when the noun after it must be a vocabulary noun (each word with an optional
possessive `'s`), from the closed lists in `src/outside-review/recovery.ts`. A code name is a call (`name()`) or a file name
or path ending in a listed source or document extension; an abbreviation or words
joined by a slash or dot (`w/o`, `n/a`, `n.a.`, `0.5`) are not names. Any other
explanation, including one that says context was supplied, a second sentence, a
marker, a severity label or word, a quote, brace, question or `name:line`, keeps
coverage missing, as does any other context line and a nothing-missing line whose
text carries on to the next line. A next line carries it on unless, read within as
many quotes as the context line opens or as the quoted paragraph it may lazily carry
on (the most quote marks on the lines since the last blank one), a quote mark
counting after at most three spaces, it is blank or, after at most three spaces, starts a bullet item or
an item numbered 1 with text, a quote, a heading, a fence (three backticks with no
backtick after them on the line, or three tildes) or a marker line (a marker followed
by a colon or the line's end). After a CommonMark list item (a bullet, or a number
and `.` or `)`, after at most three spaces with its text one to four spaces later; a
parenthesized or emphasized number is paragraph text), a next line indented to the
item's text is read by the same rule from there, and one left of it carries the text
on unless it starts another such item. A tab in the next line's indentation carries
the text on, and after a list item that holds a quote or another item, so does any
line that is not blank. A gap named on a separate line
before or after a nothing-missing line is not read: owner decision A accepts that
residual risk. Lines inside a code fence are quoted text, never a criterion; fences are read
as the installed classifier reads them: a line that starts, after spaces or tabs
only, with three or more backticks or tildes opens one, and the next such line of the
same kind at least as long closes it. A context request still counts unless it is
also inside a fence as CommonMark certainly reads them: a marker after at most three
spaces opens one (for backticks, with no backtick later on the line), and only a line
holding just such a marker, after at most three spaces, closes it, so an info-string
line such as ```` ```sh ```` cannot hide a request. That reading stops hiding lines for
the rest of the reply at the first line it cannot be sure of: inside a fence, a line
that starts left of the opening marker (its list item may have ended) or another bare
marker of its kind at four or more columns or after a tab; outside one, a marker after
list or quote markup, at four or more columns or after a tab, or a line whose text
after such markup starts with `<` (it may start an HTML block). As at the merge base,
a reply also fails closed when it ends inside a fence that a classifier marker opened
and no later line holding just a marker of its kind, at least as long, closed. When
upstream's column-0 numbered-item rule (`4ed1711d`) leaves a reply with
unlabeled items, recovery drops the number from a numbered nothing-missing
context line (unless the rest would then open a code fence) and rewrites numbered
met-criterion lines into
`Criterion N:` lines, then reclassifies. A met-criterion line is read only as
printable ASCII text with typographic apostrophes, quotes and dashes, and without `&`,
`<` or a backslash (character entities, HTML); any other line is left as it is.
It carries no severity token or negated status (`not`, `never`, `cannot`, an `n't`
word, `no longer`, `hardly`, `barely`, `scarcely`, `seldom`, `rarely`, `nowhere`,
`partially` or `partly` up to two words before `Met`, whatever emphasis, code mark,
link, punctuation or spacing separates or splits them, or `unmet`); only whitespace and at most one delimiter separate its bold title,
and the first delimiter followed by `Met` separates an unwrapped statement without a caveat (a contrast,
failure, obligation, negation, condition, hedge, exception, absence or deferral
word, an `n't` word counting whatever mark or backtick stands for its apostrophe,
emphasis inside the word included)
from `Met`, `Met.` or `Met, by inspection` (its period optional; each optionally bold), or the line is
left as it is; and the one sentence allowed after `Met.` is the change statement without `depend on`.
A met-criterion line whose text carries on to the next line, read as for a
context line, is also left as it is.
The met-criterion checks are lexical: a bold title is not read for caveats, and
a caveat in an unwrapped statement that uses no listed word is not detected.
Refusals, failed execution, ambiguous prose and missing
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

## Measurement baseline

The supplied 2026-10-19 research reports a median $2.55 per call, 265K cache-write
tokens, prompts of 230K–330K tokens, and at least 4 of 26 paid calls uncredited.
These are the comparison baseline, not measurements from this implementation.
Measure the first real review after release against it: per-phase supplied
bytes/section sizes, cache creation/read tokens, output tokens, credited versus
parse-failed calls, billed cost when available and unique actionable findings.
Compare full/delta scopes separately. Claim no saving until that run is measured.
