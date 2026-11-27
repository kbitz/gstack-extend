# /review-and-prep reference: Three-cycle cap stop procedure and continuation envelope

## From When /review stops at its cycle cap

2. Without a policy that names `continuation`, ask the user: repair-only
   (recommended when the unresolved findings are local to the fixes), full, or
   stop. Write the answer as the policy line, source `user decision`. Without a
   way to ask, print `Review policy: none supplied`. Preserve existing optional
   keys in a proposed replacement policy and record the user's approval of that
   exact line; a caller must confirm any change to its own policy before relay.
   If the allowance is exhausted, hold for explicit approval of a larger
   `max-continuations`, naming the current stop count and proposed limit.
3. Write the receipt through Step 6's procedure after the policy decision, with status
   `STOPPED — review cycle cap`: the stop SHA, the delta base (a pushed commit
   with corroborated full-review evidence), unresolved findings with
   severities, completed stages, the review policy and its source, the
   continuation count, and every line marked `Stopped: yes` in Step 6's
   **Readiness** receipt-line table (applying its `Unresolved:` exclusions).
   While the run state is recorded, follow the calls document's **Fixed
   points** for the stop. Use `"<extend-root>/bin/review-state" render --help`
   for the full receipt, stopped comment, PR body and final handoff. When the
   stop changes the recorded policy value or source, write the affected
   outputs inline as **Fixed points** directs. Use the inline fallback when
   recording is unavailable or a render is refused. After `finish`, render
   the full receipt with the final `Run state digest:`. The full receipt
   and stopped comment carry any `Finding cycle:` rows after
   `Continuation:`. Preserve the full receipt and its hash for the comment.
   Post it once as a comment marked
   `<!-- review-and-prep:stopped:<full-sha> -->` after the paused comment's
   credential/PII scan. Keep its one `Skipped pregate lanes:` or `Ship gates:`
   line and `Full receipt: <evidence locator>; sha256: <64 hex>`. A failed or
   uncertain post keeps the stop. Before a
   retry, look up that exact marker and reuse a corroborated existing comment;
   post only if absent. Conflicting or unverifiable duplicates hold for repair.
   Step 1's corroboration and restriction rules treat it like a pause.
   For H-E, retain the newest corroborated full-review base across repair-only continuations;
   review the cumulative delta from that base, including earlier continuation repairs.
   Do not replace it with a delta-reviewed invocation start or call partial coverage full.
   If no full-review base is available, record the pushed invocation-start commit
   as the label's placeholder and explicitly mark its delta evidence unavailable;
   only an authorized full continuation can proceed.
   Include a portable full-review evidence row for delta base B when available: reviewed commit
   B, tree T, `scope: full`, `completed: true`, and the original review-record
   reference and per-stage results. These must come from the actual completed
   pass, never be inferred from HEAD or filled in after the fact. Fill the row
   and the evidence comment for a new baseline only from the records written
   above, before the receipt: from `cycle-1-baseline` when it says
   `completed=true`, or when it says `completed=pending-fix-review` and a
   `cycle-1-fix-review` record names the same cycle 1 snapshot and says
   `fix-reviewed=true`. In both cases the snapshot-tree check (`tree-differs`)
   must pass: cycle 1's snapshot tree equals T. The row names cycle 1's B and T
   with `scope=full; completed=true`, and in both paths B is the first stop's
   delta base and the row's `commit=`. In this row `completed=true` records
   coverage except any outside voice the dedicated evidence comment's per-stage
   results record as missing (`missing coverage (unverified: <reason>)`): every
   selected reviewer completed and every required probe ran to
   a result on B, and a delta or full-scope cycle 2 reviewed the fixes for any
   reproduced defect. It never claims a clean review; reviewer findings never made a pass
   incomplete, only probe outcomes did. At a continuation or delta re-review
   stop, preserve the prior corroborated row and evidence-comment reference
   instead; the original local file is not required on another host. Never
   replace that base with this invocation's delta candidate. If neither a completed new
   baseline nor, on a continuation or delta re-review, a corroborated carried
   row is available, write
   `Full-review evidence: unavailable`, say delta
   evidence is unavailable, and print
   `Full-review evidence unavailable: <anchor-changed|tree-differs|reviewer-incomplete|record-missing>`
   in the STOPPED chat output and the record. This table's rows are in
   precedence order; for a non-continuation, full-scope cycle 1 it decides the
   stop row, and its first matching row also decides the unavailable reason at a
   continuation or delta re-review stop with no carried row:

   | `cycle-1-baseline` | `cycle-1-fix-review` | Stop row |
   |---|---|---|
   | no record | any | unavailable `record-missing` |
   | `completed=false` (`anchor-changed`) | any | unavailable `anchor-changed` |
   | `completed=false` (`reviewer-incomplete`) | any | unavailable `reviewer-incomplete` |
   | `completed=true`, snapshot tree differs from T | not read | unavailable `tree-differs` |
   | `completed=true`, snapshot tree equals T | not read | the row |
   | `completed=pending-fix-review`, snapshot tree differs from T | any | unavailable `tree-differs` |
   | `completed=pending-fix-review`, tree equals T | no readable record, one for another snapshot, or `fix-reviewed=false` | unavailable `reviewer-incomplete` |
   | `completed=pending-fix-review`, tree equals T | same snapshot, scope `delta from <S1>`, `fix-reviewed=true` | the row |
   | `completed=pending-fix-review`, tree equals T | same snapshot, scope `full`, `fix-reviewed=true` | the row |

   Read each record with the fence's `check` action at `stop`: `present`
   supplies the record's values to the table above, and `missing`, `missed` or
   `unreadable` counts as no record (or no readable record). An unreadable or
   duplicate record counts as no record of that kind, and a record not written
   at its write point is never written later, except through the single
   `next-cycle` late write in **Record cycle 1's full-review baseline**. The stop's own record, the one that carries
   the printed unavailable line, names which table row applied and its cause;
   the stop never writes into `cycle-1-baseline` or `cycle-1-fix-review`. For a
   late record, the stop's own record also names its provenance and boundary
   (`provenance: late (next-cycle)`). The dedicated evidence comment carries
   each probe's contract label, ID, outcome and, for `reproduced`, its
   fingerprint, plus cycle 2's fix-review results and a statement that
   `completed=true` records coverage, not a clean review; the exact probe
   commands and requests stay in the local records. For a late record, the
   dedicated evidence comment also carries `provenance: late (next-cycle)` and
   its sources' SHA-256 values, while local paths stay in the local records.
   The receipt's portable row and the H-E prompt stay unchanged. A consumer reads this row from the stopped
   receipt through the same author/edit-history checks; independently,
   `git rev-parse "B^{tree}"` must equal T (fetch the pushed commit if needed).
   Missing, incomplete, mismatched or unverifiable evidence holds repair-only continuation.
   Use these exact single-line labels in the stopped receipt, each exactly once:

```markdown
Stopped at: <full HEAD SHA>
Delta base: <full SHA>
Review policy: <verbatim policy value or none supplied>
Review policy source: <caller prompt|user decision|none supplied>
Full-review evidence: commit=<full SHA>; tree=<Git tree SHA>; scope=full; completed=true; source=<durable reference>
```

   Replace the alternatives with actual values. The source is a whitespace-free
   URL or resource reference to the actual per-stage results preserved in a
   corroborated receipt; a local-only ledger path is not portable evidence.
   On the first stop with available evidence, preserve the actual per-stage
   results in a dedicated full-review evidence comment before posting the stopped
   comment. Scan it through Step 6, include B and T, and corroborate its author,
   every editor and reviewed content; use its returned permalink as `source=`.
   Reuse an existing comment only after those same checks. After an uncertain
   post, reconcile the live comments before retrying; unverifiable evidence
   remains unavailable. Never invent a permalink or infer review results.
   This evidence comment carries neither a stopped nor a prepared-receipt marker;
   retain its original results across continuation/body rewrites, and copy its
   verified reference into later stopped receipts. STOPPED exits never post
   `review-and-prep:receipt:`; Step 6 reserves that marker for preparation.
   When evidence is unavailable, replace its entire line with
   `Full-review evidence: unavailable`. Never fill placeholder hashes with HEAD
   merely to produce a well-formed row. Ambiguous, repeated or malformed fields
   hold at their corresponding binding; no prose synonym substitutes for a label.
4. Finish with `STOPPED — review cycle cap`, the PR URL, the stop SHA and this
   prompt, with actual values:

```text
Run /review-and-prep continue for PR <URL> on <owner/repo>, branch <branch>.
Stopped at: <full HEAD SHA>
Delta base: <full SHA>
Review policy: <the policy line's value verbatim, or "none supplied">
Continuation: <k> of <n>
Unresolved: <finding IDs and severities, or "none recorded">
Keep the PR draft.
Do not run /ship on this PR.
```

`k` counts the running account's distinct stop SHAs on this PR, this one
included, and `n` is the policy's `max-continuations` (`0` without a policy).
Count distinct stop SHAs, not comments. A
limit is PR-lifetime, not reset by a new policy or session; renewed approval
must explicitly raise it to at least `k` (within the grammar's 0–9 range).
At the grammar ceiling, hold for the user's in-session work decision.
A stop is not a BLOCKED exit, because it has a continuation prompt.
Do not emit a `STATUS:` line on this exit; the literal
`STOPPED — review cycle cap` line above is the status.
This prompt is the H-E hold of the
[stage-handoff contract](https://github.com/kbitz/gstack-extend/blob/main/docs/workflow-handoffs.md);
keep its first line and labels byte-stable for callers. After its fence, print
Step 7's stage line: `next: review-and-prep; status: stopped`, with `head` the
`Stopped at` SHA.

<!-- end of skills/references/review-and-prep/conditional-cycle-cap.md -->
