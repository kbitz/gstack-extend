# /review-and-prep reference: Cycle 1 full-review baseline and fix-review records

## From Record cycle 1's full-review baseline

- **B.** B is the HEAD that cycle 1 reviews: capture it at cycle 1's /review's Step 3,
  after this skill's Step 2's base merge and after "Commit pending intended work before
  invoking `/review`". B must be an ancestor of the pushed stop commit.
- **Snapshot.** Whenever the anchor is present, take cycle 1's candidate
  snapshot under **Scope a re-review to its delta**, whether or not `in-cap=delta`
  applies. When cycle 1's record says `completed=pending-fix-review`, also
  take cycle 2's candidate snapshot at /review's Step 3 with the same
  procedure, whether or not `in-cap=delta` applies.
- **Scope.** Only a full-scope cycle 1 of a non-continuation invocation writes
  `completed=true` or `completed=pending-fix-review`. A `continue` invocation,
  delta or full, never writes a new baseline; it carries the newest
  corroborated base forward unchanged, as the cap section requires. A
  non-continuation delta re-review also carries the prior corroborated
  full-review row; without one it has no baseline (`record-missing`), never a
  new full-review claim.
- **Folded cycle 1.** Under `specialists=fold`, a folded cycle 1 is a
  full-scope cycle 1. Its stage results name each folded checklist as main-pass
  work, and `completed=true` stays reachable. A folded checklist that was
  selected but not applied is `reviewer-incomplete`.
- **Gate skips.** A gate skip is a reviewer that `/review`'s own selection
  gates did not select: its small-diff, simplification, Red Team and
  structured-review size gates and its scope signals (see "Scope a re-review to
  its delta"). That includes a structured review that `/review` logs as
  size-gated (`gate: skipped`, `completed:false`). A gate skip is never an
  incomplete reviewer. This defines "adaptive-gate skips" below, for both
  cycles.
- **Required probes.** The record lists each required /review's Step 4.7 probe once. Its
  key is its contract plus its native command or request as the evidence tool
  records it (the annotation's `command`), without the guard wrapper, capture
  IDs, the deadline and timeout flags and evidence paths. Its probe ID is the
  first 12 hex digits of the key's SHA-256; both records and the evidence
  comment use the ID, so the cycle 1 and cycle 2 entries match explicitly while
  the commands stay local. A minimized replay is evidence only, never the key,
  and a defect fingerprint never keys a probe, because its line shifts after
  fixes. A changed probe command is a different probe, as in /review's Step 4.7's own
  rerun rule, so the original probe counts as `not-run` (fail closed by
  design).
- **Probe outcomes.** Each probe gets exactly one outcome, taken as known at
  the record's write point from /review's Step 4.7's provisional results, never from the
  final materialized verdict:
  - `pass` → `passed`
  - `product-defect`, or `fail`/`failed` classified as a product defect with a
    replay and a Fix-First fingerprint → `reproduced` (record the fingerprint
    as evidence)
  - `setup-blocked`, `blocked`, or `fail`/`failed` classified as setup →
    `blocked`
  - `inconclusive` → `inconclusive`
  - `not run`/`not-run`, or `superseded` without a current rerun of the same
    key → `not-run`
  - `not applicable` with a reason → not a required probe
  - any other label or classification → `inconclusive (unmapped: <label or
    classification>)`, recorded with its check key, sensitive values redacted

  A reproduced defect is a probe result: a `reproduced` probe has run to a
  result and is never an incomplete probe. A browser check that /review's Step 4.7
  reports as current passing evidence is `passed`, so `completed=true` stays as
  reachable as before. The `/review` anchor check does not cover /review's Step 4.7's
  outcome labels, classifications or Fix-First return shape; if upstream
  renames or changes them, the result maps to `inconclusive` and the baseline
  is unavailable, never misread.
- **Write point.** At the end of cycle 1's review collection, after every
  selected reader has returned or is confirmed stopped and before /review's Step 5
  applies any fix, write
  `cycle-1-baseline` to the invocation's evidence directory: B, T
  (`git rev-parse "B^{tree}"`), the cycle 1 snapshot and whether its tree
  equals T, each stage's result, each required probe's ID, key and outcome,
  the `gstack-review-read` row when `/review` writes one (not required for
  `completed=true`), and `completed=true|pending-fix-review|false` with the
  cause of every non-`true` value.
- **Completion values.** `completed=true`: every selected reviewer completed
  and every required probe is `passed`. `completed=pending-fix-review`: every
  selected reviewer completed, every required probe is `passed` or
  `reproduced`, and at least one is `reproduced`. An outside voice
  (`outside:challenge`, `outside:structured`) whose completed reply stayed
  `unverified` (an unresolved parse, including a reply whose context line names
  missing context) is missing coverage, not an incomplete reviewer: when the
  only incomplete reviewers are such voices, `completed` follows the probe rule
  (`true` or `pending-fix-review`) and each voice's stage result records
  `missing coverage (unverified: <reason>)`, while an `unavailable` outside
  voice (execution failure, not dispatched, provider-failure stop) stays
  `reviewer-incomplete`. `completed=false` with reason
  `reviewer-incomplete`: an unavailable, failed or bounded-wait reviewer (a
  reviewer still running or stalled when the provider-failure budget expired on
  a bounded-wait host), or a `blocked`, `inconclusive` or `not-run` required
  probe. The cause names the reviewer or probe and its outcome. Allowed skips
  are scope or adaptive-gate skips only. A failed reader still gets this false
  record once it is confirmed stopped; it is not mistaken for a missing record.
  Only the exact value `true` in `completed` (cycle 1) and in `fix-reviewed`
  (cycle 2) makes a record usable: any other value, `pending-fix-review` alone
  included, is not a baseline.

- **Files and write-once.** Write the records as `cycle-1-baseline.json` and
  `cycle-1-fix-review.json`, each with a `schema` field
  (`review-and-prep-cycle-1-baseline/v1`,
  `review-and-prep-cycle-1-fix-review/v1`) and the fields above. Each record
  carries `provenance` (`write-point` or `late`) and uses these snake_case JSON
  keys: `cycle-1-baseline` has `schema`, `provenance`, `b`, `t`, `snapshot`
  (`null` allowed only when `completed` is `"false"`),
  `snapshot_tree_equals_t` (boolean), `stages` (non-empty array of
  `{name, result}`), `probes` (array of `{id, key, outcome}`, `id` 12 hex,
  `outcome` starting with `passed`, `reproduced`, `blocked`, `inconclusive` or
  `not-run`, with `fingerprint` required on `reproduced`), optional
  `review_read_row`, `completed` (the string `"true"`, `"pending-fix-review"`
  or `"false"`) and `cause` (required unless `completed` is `"true"`);
  `cycle-1-fix-review` has `schema`, `provenance`, `cycle_1_snapshot`,
  `cycle_2_snapshot`, `scope` (`full` or starting `delta from `), `stages`, `probes`
  (each may carry `evidence`, the reference behind a reused current result),
  `fix_reviewed` (`"true"` or `"false"`) and `cause` (required unless `"true"`).
  Write each record with the fence's `write` action, which creates the file
  exclusively (`{flag: "wx"}`), so no duplicate can exist. Write each record
  once, with the outcomes known at its write point; never edit, rewrite or
  replace a written record, including on a same-run resume, and never let a
  later relabel (for example `superseded`) change it. A record not written at
  its write point is never written later, except through the single **Late
  write** at the next cycle's start above. A parse failure, or a missing or
  invalid required field, makes a record unreadable; an unreadable or duplicate
  record counts as no record of that kind. A `continue` invocation writes
  neither record. The records belong to the invocation's first `/review` run; a
  later `/review` run in the same invocation (this skill's Step 5's delta re-review, or a
  full-scope fallback) writes neither.
- **Unavailable.** A snapshot tree that differs from T (reviewed uncommitted or
  untracked content) is `tree-differs`; a missing record is `record-missing`.
  Each, with `anchor-changed` and `reviewer-incomplete`, makes the baseline
  unavailable.
- **Scope of the record.** The files are internal to the evidence directory and
  provisional pending the portable evidence envelope. The only portable
  contract stays the `Full-review evidence:` row and its dedicated comment.
  Never infer a baseline from HEAD or the stop commit.

Write and check `cycle-1-baseline` and `cycle-1-fix-review` with this fence
(`<evidence-directory>` is this invocation's directory from **Evidence
directory**, which already exists; `<action>` is `write` or `check`; `<kind>` is
`cycle-1-baseline` or `cycle-1-fix-review`; `<record-file-or-boundary>` is the
assembled JSON file for `write`, or `before-fix`, `next-cycle` or `stop` for
`check`):

```bash
"<extend-root>/bin/review-state" full-review-record "<workspace>" "<evidence-directory>" "<action>" "<kind>" "<record-file-or-boundary>"
```

The fence prints one `FULL_REVIEW_RECORD:` line, read as above (`--help` lists
its messages and exit codes). That line is not a review-state result envelope,
so use the fence's own recovery rules. While recording, follow **The baseline
fence** in `docs/review-run-state-calls.md` for `REVIEW_STATE_DIR` and each
fence refusal. If an older calls document omits the recovery for a no-ID
refusal, map `(run-state unreadable)` to `fence-run-state-unreadable` and
`(cycle-1-pass)` to `fence-cycle-1-pass-missing`. Take the **Degraded path**
with that reason and rerun the identical baseline write once without
`REVIEW_STATE_DIR`. Preserve the stored state and the record's original
provenance. A missing pass stays missing.

<!-- end of skills/references/review-and-prep/conditional-cycle-baseline.md -->
