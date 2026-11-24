# /review-and-prep reference: Behavior-changing repair classification

## From Reopen review only for behavior-changing repairs

**Classify the batch once.** Under the active value only, after `/review`'s
Step 5.0 dedup and Step 5a and before Step 5b's first edit, write one line per
finding of that batch:

`Repair classification: cycle=<n>; finding=<fingerprint>; severity=<upstream label>; fix-first=<AUTO-FIX|ASK>; repair=<neutral-candidate|behavior-changing|unclassifiable>`

Write each line once per batch and never relabel it. `severity` is copied from
upstream and is never downgraded or overruled; an unclassifiable finding keeps
its upstream label. The classification changes no action: `/review`'s "action
every remaining finding" stands, so a trivial fix is still made rather than
deferred. A candidate's final class comes from the diff check below.

**Classify each repair on its actual diff.** A repair is neutral only when all
of these hold: its pre-repair line says `repair=neutral-candidate`; Step 5a
classified its finding AUTO-FIX and the finding is not CRITICAL; its whole diff
is a docstring or comment, a rename with every reference updated of a name nothing outside this change reads, code no path
reaches, or a handler for a case already handled, with the evidence named; it
touches no file that an agent or a gate reads as instructions or a contract
(skills, prompts, handoff and contract docs, tests, fixtures, CI and
`.gstack/`); and its targeted lanes pass. Everything else is behavior-changing,
including every ASK repair and every repair that cannot be classified. Any
doubt counts as behavior-changing. Tool directives, pragmas and comments or
docstrings consumed by a tool or runtime are behavior-changing, including type
suppressions, build tags, optimizer annotations and doctests.

**A neutral-only batch below the cap** leaves `/review`'s own log row as
upstream wrote it (`converged:false`, never rewritten), and the wrapper does
not take upstream's "Below 3, repeat". Targeted lanes and Step 2's single final
suite cover those repairs, so no further cycle opens. That pass counts as final
for Step 5.8 items 2–4 and Step 4.7's freshness check. A failing freshness rerun
or targeted lane reclassifies the repair as behavior-changing, and a batch with
one repeats as today. A final-gate failure attributable to the repair also
reclassifies it and voids its neutral chain; a later pass alone cannot restore
that chain. If attribution is uncertain, treat the repair as behavior-changing.
A prepared receipt that records such a repair still hands off `review: COMPLETE`
only after the applicable neutral or ordinary review coverage is verified.
Append `Repair chain voided: <fingerprint>; failed=<ledger or persisted external-failure reference>; reason=<attribution>`
and carry that immutable line in every later receipt, including pauses and
stops. It permanently disqualifies that neutral chain, even after passing gates.
Persist the failed result in the durable evidence directory immediately; a
failed write stops. Read-only diagnosis may then establish attribution. Before
any edit or retry, persist either the void record or the existing diagnosis
and evidence proving the failure unrelated. Missing attribution evidence means
uncertainty and voids the chain. A wrapper-satisfied raw secret failure needs
its raw record and successful disposition evaluation, never a fabricated
passing test ledger. External failures
use the existing external-gate checkpoint/attestation history, whose failure
row is the reference; attribution uncertainty still voids the chain. Before
readiness or resume, reconcile all final-gate runs and external results for the
chain against its void records. Missing or unverifiable history covers nothing,
so an older receipt or a later pass cannot prove the absence of a failure.
Before readiness, review the repair as behavior-changing. Only when the next
cycle qualifies as an active delta, use a snapshot before the voided repair as
B; otherwise use today's full-scope selection and verified PR merge base. An
unbounded delta also falls back to full scope. Never reuse N that already
contains the repair. Use the normal remaining cycles or Step 5 re-review path;
a cap stop still requires its authorized continuation and cannot be cleared
by a passing gate.

**A mixed batch.** Only when the next cycle qualifies as an active delta, use
this split. Within Step 5b, apply the neutral candidates first, take one candidate snapshot N with the snapshot procedure above, then apply the rest. The
next delta uses B=N only when every repair before N proved neutral and every
repair after it is behavior-changing; otherwise B stays the previous cycle's
snapshot, and the receipt records which. While `cycle-1-baseline` says
`pending-fix-review`, B stays cycle 1's snapshot so `cycle-1-fix-review` stays
writable. Force re-dispatch only the specialists whose finding a
behavior-changing repair fixed, in addition to every reviewer selected by the
delta's ordinary gates; the neutral repairs get their targeted lanes and the
final gate. A full-scope or inactive cycle preserves today's reviewer and base
selection, with no N split or specialist narrowing. Full scope uses the
verified PR merge base, never a previous-cycle snapshot.

A neutral-only exit never writes or upgrades `cycle-1-fix-review`. If the
write-once baseline is `pending-fix-review` and has no matching valid
`cycle-1-fix-review` with `fix-reviewed=true`, record `neutral-only baseline:
unestablished — no fix-review cycle` in the receipt and preserve that state.
An existing valid combined baseline remains established; the neutral exit
creates or upgrades neither record. A later re-review uses full scope unless
it has a corroborated completed baseline; neutral receipts cannot manufacture
one.

The cap and stop are unchanged: a neutral-only third batch still takes **When
/review stops at its cycle cap**, and the value waives no gate.

Record the `repair-review:` status line with every `Repair classification:` and
`Repair without review cycle:` line when `repair-review=behavior-changing` is
on the policy line:

`Repair without review cycle: <fingerprint>; class=<docstring|rename|dead-code|redundant-handler>; paths=<n>; cycle=<n>; targeted=<ledger reference> pass; final-gate=<ledger reference or external attestation or pending>`

For each such line also record:

`Repair evidence: <fingerprint>; before=<full commit SHA>; after=<full commit SHA>; paths=<exact path list>; diff-sha256=<hash>; diff-check=<evidence reference>`

Commit each neutral repair separately when needed to isolate its exact diff.
The before/after commits must be durable ancestors of the prepared head.
Before must be after's sole parent, with a tree equal to a covered reviewed
snapshot or the preceding verified chain's after tree. Check contiguous
coverage from the full reviewed snapshot through the prepared head, including
changes before `before`; a gap covers nothing. A verified, policy-authorized
final-gate repair chain also supplies a coverage link under the existing
readiness exception only after its own diagnosis and verification prerequisites
are met. This grants no diagnosis coverage to a pending neutral chain; where
that prerequisite is absent, use ordinary review coverage. Hash this
canonical raw listing:
`git diff-tree --no-commit-id --raw -r -z --no-renames --no-relative --no-abbrev --no-color --no-ext-diff --no-textconv -O/dev/null <before> <after> --`
It binds paths, modes and full blob IDs without host-dependent patch formatting.
Record the closed-list evidence and final class in `diff-check`. Before readiness or
reuse, recompute the diff, path list and hash, and check that every subsequent
change has its own review, neutral chain or authorized final-gate repair chain. A missing or mismatched binding
covers nothing; never infer coverage from a path count or finding fingerprint.

`final-gate=` reads `pending` until the final gate passes, then names its ledger
reference or, under `full-suite=external`, the attestation. Pause and stopped
receipts carry the status, classification, repair and evidence lines, every
`Repair chain voided:` line and any `neutral-only baseline:` outcome, and the
policy line that authorized them.

<!-- end of skills/references/review-and-prep/conditional-behavior-repairs.md -->
