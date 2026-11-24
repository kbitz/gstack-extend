# /review-and-prep reference: Documentation audit reuse checks and attempt entry points

## From Classify changes after the documentation audit's last attempt

**Under `doc-audit-gap=auto`.** Under `doc-audit-gap=auto`, apply this paragraph
group only when the parsed review policy carries `doc-audit-gap=auto` together
with `full-suite=external` and `post-audit=classify`; a run without the value
reads none of it and its receipt, readiness and blocked recovery stay as they
are, and a run with `post-audit=classify` alone keeps today's class list and
outcomes. At every Prepare while the parsed
policy carries `doc-audit-gap=auto` with `full-suite=external` and
`post-audit=classify`, the parent writes the exact `--docs` arguments it passes
to `gstack-docs-candidate snapshot`, one per line, to `doc-roots-<audit_id>.txt`
in the evidence directory; D3(a) below reads that file for the accepted audit,
every path in that audit's snapshot `docs` list is also protected, and a missing
or unreadable roots file is `docs-roots-unreadable`. Before dispatch, hash
the roots file and original Prepare snapshot. Keep both hashes in parent-held
evidence bound to the invocation and audit ID. On acceptance, retain them
alongside the saved post-child snapshot and section hashes.

Apply the single classification rule below at three entry points:

1. **Pre-attempt:** Before spending a re-audit attempt when a freshness check
   would dispatch one after an accepted audit in this invocation. This includes
   `documentation-audit=final`, a final-gate repair, the external gate's freeze
   re-entry and readiness. A still-current audit with the same binding follows
   ordinary re-entry, with no reuse decision or attempt.
2. **Blocked or failed re-audit fallback:** After upstream's re-audit attempt 2
   or the one extra attempt returns `blocked` or fails to complete or validate.
   Use this entry whenever evaluating that failed attempt, including on resume
   and after exhaustion. Run the fallback checks before blocked recovery's
   retry or owner decision.
3. **Post-exhaustion:** At a stale freshness check when upstream's attempt
   budget is exhausted. Without an earlier accepted audit, a blocked or failed
   audit still follows the existing recovery rules, including the eligible
   extra-attempt check at exhaustion. It supplies no audit to reuse.

When pre-attempt reuse applies, no `/document-release` child is dispatched.
Upstream's remaining re-audit attempt
stays unspent, and a later change that fails classification uses that attempt
before any extra attempt or owner stop. On pre-attempt reuse,
when `GX_CAPTURE=1` the parent records a raw `REUSE` decision for phase
`documentation` with reason `matching-evidence`, a fresh `step_id` and no interval.

**Single classification rule and decision table (`doc-audit-gap=auto`).**
For blocked or failed re-audit fallback, first execute blocked recovery step 1
(**confirm the child stopped**). If dispatch was refused before any child
started, retain proof that no child launched. Use that refusal as the stop
boundary. At initial reconciliation,
make no checkout writes and verify the original
Prepare snapshot against its pre-dispatch hash, invocation and audit ID.
If that verification fails or cannot run, stop before trusting the snapshot.
On resume, apply the stopped-state evidence rule below before comparing.
Only then compare it to verify HEAD, index and ownership even without valid
child output. Capture the clean-tree result and run the read-only
comparison even when the tree is dirty. Save the outcome, including any
non-waivable failure, in parent-held evidence bound to the invocation, attempt
and Prepare snapshot before stopping or proceeding.

**Stopped-state evidence on resume.** On resume or a later trigger, verify
the saved reconciliation and account for intervening authorized changes.
A recorded non-waivable failure keeps
that attempt stopped even if the tree is now clean or HEAD or the index were
restored. On any resume without saved reconciliation, even when interruption
preceded first reconciliation, require independent evidence that the checkout
still reflects the state at the child's stop before comparing it. Otherwise
stop.

For each fallback decision, require the current clean tree and pass the
base-policy cap check below before reuse or retry. Apply existing redaction and
security checks to the current inputs and available child artifacts before retaining or citing
their content. Missing child output can take fallback when independent evidence
establishes the required safety checks. Unreadable required evidence fails
closed.

Before handling each re-audit result, retain its recorded confirmed or
open documentation discrepancies with the attempt ID in this invocation's
parent-held evidence. If any re-audit in this invocation has recorded a
confirmed or open documentation discrepancy, record `classify-not-applied`
with that evidence and take blocked recovery's existing stop before fallback
can reuse an earlier audit or dispatch another attempt.

Stop under blocked recovery if any check fails or cannot be verified, including an
unconfirmed writer, ownership violation, unauthorized Git mutation, redaction or
security gate failure, or `docs-caps` failure. Record `classify-not-applied`
with the reason and retain any non-waivable failure for that attempt in the
same bound evidence. An initially blocked or failed audit cannot enter fallback.
A blocked or failed re-audit disclosed alongside a reused audit keeps its actual
result in the full documentation detail and evidence while that audit is carried.
Write no `record audit` for reuse or for the rejected attempt on this fallback
path. The accepted audit keeps its original record.

For any reuse, verify the earlier accepted (`current` or `updated`) audit in
this invocation and its post-child snapshot, section and recorded
documentation roots against retained evidence. A missing accepted audit or
unverifiable evidence declines reuse. Preserve the existing base-change,
unverifiable-delta and broad-fallback checks for the PR's own contribution, with
the test-tooling and qualifying base-merge exceptions described here. Outside
failed-child recovery, commit intended pending work first. Require an empty
`git status --porcelain=v1 -z --untracked-files=all --ignore-submodules=none`
(non-empty is `dirty-tree`, including pending changes inside submodules).
In fallback a dirty tree stops recovery before any retry, staging or commit.
Preserve partial child edits. A missing or unreadable `doc-roots-<audit_id>.txt`
or snapshot `docs` list is `docs-roots-unreadable`.
Before granting reuse at any entry point, check the current clean tree against
the documentation caps at the verified fetched base SHA, even after a qualifying
base merge. Use a successful `git ls-tree --full-tree <base-sha> -- .gstack/ship-policy.json`
to distinguish a confirmed absent policy (no caps) from a failed lookup. For a
present policy, require a regular blob, copy its exact bytes from that commit
to private evidence, and run upstream's `gstack-ship-receipt docs-caps --policy <file>`.
Never substitute `origin/<base>` or the working-tree policy for the verified SHA.
An unverifiable policy or check takes the non-waivable stop. A measured cap
violation declines reuse. A pre-attempt visit can still take the ordinary
upstream re-audit, which must pass the cap gate before acceptance. In failed
re-audit recovery or after exhaustion, a cap violation stops before dispatch.

Judge the whole walk. Reuse requires every commit to qualify for an
`owner=not-needed` class for this entry point. Apply 1(a) and 1(c) to existing
no-owner classes too, subject to the table's `todos-only`, qualifying
base-merge and post-exhaustion `mechanical-correction` exceptions. A change
that makes a documented claim inaccurate, or whose class is uncertain, is
`documented-behavior` even without an audited path or user-visible text edit.
Rerun checks that depend on the trigger, head, audit or fetched base when those
inputs change. In particular, recheck a qualifying merge against the current
PR diff before relying on its earlier classification. Retain superseded rows
as evidence only.

| Case | Condition | Decision and attempt or stop | Receipt fields |
|---|---|---|---|
| `documents unchanged` | The full walk qualifies for reuse. Each non-merge change is `owner=not-needed` with no 1(a) protected path change (except `todos-only`) and no 1(c) user-visible text change. For `undocumented-internal`, 1(b) must also pass. | Reuse `S` with no question. Pre-attempt leaves the remaining re-audit unspent and records `REUSE` when `GX_CAPTURE=1`. | `post-audit: active`, `Post-audit change:` with class, `carried-audit=<S>` and trigger in `reason=`, plus `doc-audit-gap: active; reuse=applied`. Compact `- documentation: not-run` when no audit matches the final binding. |
| `an audited document changed` | A 1(a) protected path changed, except `todos-only`. This includes `mechanical-correction` pre-attempt or on blocked/failed fallback. | Pre-attempt: decline reuse and spend the remaining upstream re-audit. Fallback or exhaustion: use the eligible extra attempt or existing stop. After exhaustion only, `mechanical-correction` still qualifies when the last attempt neither blocked nor failed. | On decline, record `Post-audit change:` with `class=documented-behavior; owner=needed` and `doc-audit-gap: active; reuse=not-applied classify-not-applied <reason>; evidence=<evidence locator>` and `Doc-audit extra:` if evaluated. On mechanical-correction reuse, record `class=mechanical-correction; owner=not-needed` and `doc-audit-gap: active; reuse=applied`. |
| `user-visible text changed` | A 1(c) surface changed. Give doubt, an unreadable diff and other `documented-behavior` (including changed behavior that makes a documented claim false) the same outcome. | Decline reuse. Pre-attempt: spend the remaining upstream re-audit. Fallback or exhaustion: use the eligible extra attempt or existing stop. | `Post-audit change:` with `class=documented-behavior; owner=needed`, `doc-audit-gap: active; reuse=not-applied classify-not-applied <reason>; evidence=<evidence locator>`, plus `Doc-audit extra:` if evaluated. |
| `a base merge` | Two parents, second parent an ancestor of the fetched base tip, empty `--remerge-diff` on Git 2.36+, and the two-way merge guard passes against the current PR diff. | A qualifying merge is `owner=not-needed`; the whole walk still has to qualify. An unqualified merge or failed precondition declines reuse. Before dispatch require a verified base fetch and clean tree; then take the remaining upstream re-audit, eligible extra attempt or existing stop. | Qualifying merge: `Post-audit change:` with `class=base-merge; owner=not-needed; carried-audit=<S>`. On reuse record `post-audit: active` and `doc-audit-gap: active; reuse=applied`. On decline record `post-audit: not applied — <reason>` and `doc-audit-gap: active; reuse=not-applied <token> <context>; evidence=<evidence locator>`. |
| `a blocked re-audit` | Upstream attempt 2 or the extra attempt returned `blocked`. Verify the stopped child and all fallback prerequisites first. | Apply the same rule to `S..HEAD`. A qualifying unchanged walk reuses `S` with no question and no extra attempt. On decline, take the eligible extra attempt or existing stop. A non-waivable failure stops recovery. | `post-audit: active` and `doc-audit-gap: active; reuse=applied` on reuse, with `Post-audit change:` rows for any commits, `carried-audit=<S>` and `blocked-re-audit` in `reason=`. Keep the attempt's actual result, `audit_id` and child-stop proof in the full `Ship gates` detail and evidence. On decline record `reuse=not-applied` and `Doc-audit extra:` if evaluated. |
| `a failed re-audit` | Upstream attempt 2 or the extra attempt failed to complete or validate. Includes timeout, missing output, `DOCS_RESULT_INVALID` after any allowed format repair, exit 3 refusal, or failed validation or freshness. Verify the stopped child and all fallback prerequisites first. | Apply the same rule to `S..HEAD`. A qualifying unchanged walk reuses `S` with no question and no extra attempt. On decline, take the eligible extra attempt or existing stop. A non-waivable failure stops recovery. | `post-audit: active` and `doc-audit-gap: active; reuse=applied` on reuse, with `Post-audit change:` rows for any commits, `carried-audit=<S>` and `failed-re-audit` in `reason=`. Keep the attempt's actual failure code, `audit_id` and child-stop proof in the full `Ship gates` detail and evidence. On decline record `reuse=not-applied` and `Doc-audit extra:` if evaluated. |

Let `S` be the commit representing the accepted audit's content. If the verified
post-child snapshot has no pending changes, use its HEAD. Otherwise the snapshot
records pending content separately from Prepare's HEAD. This can happen for
either accepted status, including reviewed coverage tests still pending when a
`current` audit runs and permitted child edits from an `updated` audit. Keep the
snapshot and its section intact. Commit only the verified, authorized pending
content before unrelated work. Bind `S` to that commit only after confirming its
sole parent is Prepare's HEAD, its diff contains exactly that pending content,
and its committed content matches the post-child snapshot's recorded path hashes.
Retain this binding with the audit ID, base and snapshot hash. If any proof is
missing, decline reuse. The table's
`carried-audit=<S>` means the existing `<audit_id> <section-sha256>` of the audit
bound to `S`.

A verified empty walk on fallback
has no `Post-audit change:` rows. Record the carried audit, child-stop proof
and actual failure in the documentation detail. The walk reaches `S` only
when `S` appears as a whole line of `git rev-list --first-parent HEAD`
(otherwise the result is `walk-missed-snapshot`), and the post-audit changes are
the commits on `git rev-list --first-parent S..HEAD`. Every `git diff` and
`git log` command in this paragraph group passes
`--no-renames --no-ext-diff --no-textconv --ignore-submodules=none --no-relative`
to keep paths repository-relative and prevent local Git configuration from
hiding a change. A gitlink or symlink path is listed and
then fails `undocumented-internal` as doubt. Each git command and the NUL-split
script (**Bound the documentation audit** item 3) write stdout, stderr and the
exit status to files in the evidence directory; `evidence=` locators point
there, and any unexpected command or script failure is `command-failed`.

<!-- end of skills/references/review-and-prep/conditional-post-audit-reuse.md -->
