# /review-and-prep reference: Greptile second-run detection, user-decision exits, and configuration repair

## From Detect whether marking ready would start a second run

The ready transition starts an automatic run unless the effective trigger list
excludes `open`. Normalize implied events first: `push` includes `open`, and
`rebase` includes both `push` and `open`. Normalize the legacy key before the
exclusion check: `triggerOnUpdates: true` is `["open","push","rebase"]`. A
list containing `push` or `rebase` therefore cannot exclude the ready trigger,
and it does not exclude those events for the waiver. Unknown values or invalid
types are unverified configuration. `labels` filters which PRs qualify; it
does not limit a PR to one review. Once the label is present, configured
automatic events may keep triggering reviews. `"autoReview": []` disables
those events, including the trigger-label event; explicit requests still work.

- Take the list from the source branch's supported effective configuration:
  root `.greptile/` takes precedence over `greptile.json`; its settings belong
  in `.greptile/config.json`. Read `autoReview` (default `["open"]`) or
  its legacy forms: `triggerOnUpdates: true` is `["open","push","rebase"]`, and
  `skipReview: "AUTOMATIC"` means an empty list. Supported files override
  dashboard defaults; an ignored `.greptile.json` does not override them.
  Use verified dashboard settings or run metadata, cited, when no supported
  file establishes the effective triggers.
- Count `open` as excluded when the effective source-branch file excludes it,
  or when verified settings do. A file that
  fails to parse as JSON is unreadable. These all count as starting one:
  - a repository whose only marker is `.greptile.json` (this step's local
    policy signal, which Greptile may not read)
  - a missing or unreadable file, including one that fails to parse as JSON
  - unknown trigger values, invalid types, or conflicting sources
- Other filters do not count unless verified settings show they exclude this PR.

Use this configuration contract for routine checks; do not browse vendor docs
or probe the dashboard merely to reconfirm a valid supported file. The linked
references document these rules (verified 2026-10-06). Consult the matching
reference only for an unsupported key, conflicting trigger settings, or an
observed run that contradicts the file. If that lookup cannot resolve the
unknown, name it in one concrete repair question; do not cycle through tools
or ask the user to research the schema.

When the detection is positive, ask **Marking ready would start a second run.**
(E1) from Step 4 before `/review`. When no PR exists yet, write the answer into
the receipt when Step 3 creates the draft. Before that, reuse an available
verified authorization for the exact repair under the resume rule in **Establish the branch, PR, and review inputs**.
When the detection is positive and a request or run
already exists, readiness requires option (a) whatever other exit the user takes.

Name the result in the question:

- "Greptile's settings will start a review when this PR is marked ready" when
  verified settings, or the effective source-branch file, include `open`. Name each
  source, ref, and value.
- "cannot rule out an automatic review" when a file is missing, unreadable
  (including one that fails to parse as JSON), has unknown trigger values or
  invalid types, is `.greptile.json`-only, or the sources conflict. Name each
  source, ref, and value, or the read failure.

## From Greptile exits that need a user decision

Every exit question uses this template:

- A bold lead-in that names the edge. E-numbers may accompany the name.
- A re-grounding line: repository, PR URL, head SHA.
- What happened: request or run links, trigger and observation times, and SHAs.
- Why it stops: the specific rule.
- The options, recommended first, each with its consequence and any stated
  residual.
- The line "This is asked once for this PR; your answer is recorded in the receipt."
  for every question except E6, whose question ends with
  "This is asked again only after the wait you choose; your answer is recorded in the receipt."
  A changed policy or conflicting values require a new scoped decision; that
  is the exception to asking once, not a reason to repeat an unchanged repair.

The answer is recorded per PR and reused. The same edge is
asked again only when its evidence changes or a chosen wait expires (E6 records
`wait until <UTC>`). There is no E3 or E5, because the paused comment and the
reservation comment are durability fixes, not user decisions. In practice a PR
sees at most two exit questions: E1, then one of E2, E4, E6, or E7, which are
mutually exclusive by run state. The only exceptions are E6 wait renewals the
user chose. When the Step 1 detection is positive and a request or run already
exists, readiness requires option (a) of **Marking ready would start a second
run.** whatever other exit the user takes, and each exit's question says so.

**Marking ready would start a second run.** (E1). Step 1 detects this; Step 4
re-checks before any request, and Step 6 re-checks before `gh pr ready`.

When no request or run exists yet, offer (b) only when verified settings or
the source branch's valid effective trigger list excludes `push` and `rebase`. Otherwise
offer (a) or (c) only: after a ready-transition run, release pushes could start
a second run while the waiver skips review. Unknown settings do not establish
this exclusion. This guard preserves the once-per-PR rule without changing
`/ship-and-land`.

- (a) **recommended:** approve the concrete configuration repair below. Show
  the current and proposed paths and complete proposed JSON or diff, preserving
  existing settings. Cite Step 1's matching configuration reference. Say that
  the source-branch change disables automatic reviews for this PR and, once
  merged, becomes the repository default for future PR branches. If migrating
  an ignored file, disclose that its preserved filters and settings may now
  take effect. Explain that
  `"autoReview": []` stops only automatic reviews: explicit requests, including
  this workflow's, still work (manual requests still work). That is what this
  workflow's explicit request needs, but the user may prefer a narrower change.
  Never make an unapproved repository-policy change. After approval, apply the
  repair on the current feature branch through the normal draft review, test,
  and push steps, within session permissions. Step 4 pauses only if the
  detection is still positive before any request. On resume, re-run the
  detection; it passes once the pushed source branch shows the approved change.
- (b) Waive Greptile for this PR under the Step 1 extension. The option says
  that Greptile may still review automatically when the PR is marked ready.
  That run is the PR's only one, and neither this workflow nor
  `/ship-and-land` triages it.
- (c) Stay draft.

When a request or run already exists, offer (a) or (c) only. The question says
that marking the PR ready outside this workflow is the user's own action and
starts a second run.

**A failed or cancelled run consumed the allowance.** (E2). Failed/cancelled
runs consume the allowance and cannot be retried.

- (a) **recommended:** triage any findings the run posted, waive Greptile for
  this PR under the Step 1 extension (citing the run ID and status), and
  continue on local review.
- (b) Stay draft. A resume re-checks that same run and never retries.

**No observable run after an MCP request.** (E4). After 10 minutes with no
observable run, this covers any MCP request that exposes no observable run,
whether it was accepted or ambiguous.

- (a) **recommended:** proceed as
  `Greptile: unverified — no response after 10 minutes (MCP request with no observable run; user decision <reference>)`.
  The locked prefix stays verbatim. The reservation stays the PR's only
  allowance. Feedback that arrives before readiness is still triaged.
- (b) Stay draft.

Only request or run history showing that nothing was submitted permits the
first request. The user's confirmation does not release a reservation.

**A known run is still incomplete.** (E6). The run is still incomplete 10
minutes after the trigger or first sighting.

- (a) **recommended:** keep waiting. Record `wait until <UTC>` (10 minutes by
  default, or the interval the user names) and ask again only after it passes.
- (b) Waive Greptile for this PR under the Step 1 extension. The option states
  that the run's later results will not be triaged.
- (c) Stay draft.

**The reviewed commit is no longer in this branch.** (E7). The ancestor check
exited 1, or the reviewed object is missing after fetching.

- (a) **recommended:** run `/review` on the full base-to-head diff (not a
  delta), triage the stale run's findings against current code, then waive
  Greptile under the Step 1 extension, citing the stale SHA.
- (b) Stay draft.

One rendered **Marking ready would start a second run.** question, with no
existing request/run and source-branch `autoReview: ["open"]`:

```text
**Marking ready would start a second run.** (E1)
Repository <owner/repo>, PR <url>, head <full SHA>.
Greptile's settings will start a review when this PR is marked ready: <source> at <ref> has autoReview ["open"].
This stops preparation because a manual request plus that automatic run would be two reviews, and this PR gets one.
(a) Recommended: approve <concrete rename/consolidation/edit and preserved JSON or diff> on this feature branch. It disables automatic reviews for this PR and becomes the default for future PR branches once merged. "autoReview": [] stops only automatic reviews: explicit requests, including this workflow's, still work (manual requests still work). See the configuration reference linked in Step 1. This approval also covers the stated marker migration; I will apply it within this draft's normal review and push steps.
(b) Waive Greptile for this PR. Greptile may still review automatically when the PR is marked ready. That run is this PR's only one, and neither this workflow nor /ship-and-land triages it.
(c) Stay draft.
This is asked once for this PR; your answer is recorded in the receipt.
A changed policy or conflicting values require a new scoped decision.
```

## From Configuration repair

- When a root `.greptile/` exists, consolidate root settings into
  `.greptile/config.json`, even if that file does not exist yet. Preserve its
  rules and other files; remove superseded root settings files in the same
  approved repair, preserving their nonconflicting settings.
- If a supported configuration exists without `.greptile.json`, amend the
  supported effective file in place. Keep the repository's chosen format.
- If only `.greptile.json` exists, rename `.greptile.json` to `greptile.json`
  and amend the renamed file.
- If legacy and supported settings files coexist, consolidate into the
  supported effective file and remove the legacy file in the same approved
  change. Preserve nonconflicting settings from both. Show conflicting keys
  and their actual values before asking; do not guess which value to discard.
  Prepare complete proposed variants for those values and include the user's
  selection in the same repair approval question.
- If no settings file exists, create `.greptile/config.json` only when a root
  `.greptile/` already exists; otherwise create `greptile.json`.

Preserve every existing setting, including `labels`, except the trigger
settings the user approved changing. In the proposed trigger change, replace
legacy `triggerOnUpdates` and `skipReview` keys with `"autoReview": []`, showing
their removal in the complete diff for approval. Previously ignored settings
may become active after migration; disclose that effect in the same proposal.
Do not create a second settings file
alongside `.greptile.json`. Do not introduce a `.greptile/` directory solely
for this repair. For the legacy file containing only `labels: ["greptile"]`,
the proposed renamed `greptile.json` is:

```json
{
  "labels": ["greptile"],
  "autoReview": []
}
```

One approval of the concrete repair also satisfies Step 1's marker-change
policy decision; record its source, paths, setting changes, and scope in the
receipt. Reuse an existing authorization for that exact repair; ask again
only if the proposed policy or conflicting values change.

<!-- end of skills/references/review-and-prep/conditional-greptile-recovery.md -->
