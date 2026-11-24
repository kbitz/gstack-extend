# /review-and-prep reference: Fix-review records, checkpoint misses and late evidence

## From Record cycle 1's full-review baseline

- **Fix-review record.** When cycle 1's record says
  `completed=pending-fix-review` and cycle 2 of the same invocation runs either
  as the in-cap delta from cycle 1's snapshot (recorded with scope `delta from
  <cycle 1 snapshot>` and `SCOPE_DELTA: covered`) or at full scope from the
  verified PR merge base to its own snapshot (recorded with scope `full`,
  whatever made it full: `in-cap=full`, no `in-cap` value, an inactive in-cap
  delta, or a recorded full-scope fallback of the delta procedure), cycle 2
  writes a separate record, `cycle-1-fix-review`, to the same evidence
  directory. Write it at the end of
  cycle 2's review collection, after every selected reader has returned or is
  confirmed stopped and before /review's Step 5 applies any cycle 2 fix. Before that
  write point, cycle 2's /review's Step 4.7 reruns each cycle-1-reproduced probe by its
  key, with its exact recorded command or request, as revalidation of an
  affected check, which upstream runs even after the smoke limit, not as a
  smoke recheck. A probe has a cycle 2 result when it was rerun by its key on
  cycle 2's inputs, or when `/review`'s unchanged-input reuse rule keeps its
  result current; it is `not-run (no exact rerun)` only when neither holds.
  Fields: cycle 1's snapshot (equal to the one in `cycle-1-baseline`), cycle
  2's snapshot, the scope line, each stage's result with every recorded skip
  and its reason, the ID, key and outcome of every probe in the union (cycle
  2's own required list plus each cycle-1-reproduced key) with a reference to
  the evidence behind any reused current result, and `fix-reviewed=true|false`
  with the cause of a `false`. Set true only when every selected reviewer
  completed (under the same `unverified` outside-voice missing-coverage rule as
  `completed` above) and every probe in the union has a result on cycle 2's inputs
  (`passed` or `reproduced`). A cycle-1-reproduced probe without such a
  result, including one marked not applicable in cycle 2, is `not-run`. Allowed
  cycle 2 skips are gate skips plus the recorded
  `skipped — light default repair cycle` and
  `skipped — bounded-wait host, cycle 1 only` skips (the latter is the host
  rule that runs the Red Team on cycle 1 only, not a stalled reviewer). The
  light-default skip counts with or without the `; source: repair-cycles=light`
  suffix.
  Otherwise write false with reason `reviewer-incomplete`, naming the reviewer
  or probe. `fix-reviewed=true` means cycle 2 reviewed cycle 1's fixes, not
  that they hold; a defect still open at the stop stays in the receipt's
  unresolved findings and its `Unresolved:` line. A cycle 2 without its own
  snapshot writes no fix-review record.
- **Checkpoints.** Verify the records with the fence's `check` action at three
  boundaries: (1) `before-fix`, after the write point and before /review's Step 5 applies
  the cycle's first fix (cycle 1 for `cycle-1-baseline`; cycle 2 for
  `cycle-1-fix-review` when that record is required). `missing` there is still
  inside the write point because no fix has been applied: write the record now
  from the same collection results, check again, and apply no fix until it says
  `present`. (2) `next-cycle`, at the next cycle's /review's Step 3 (cycle 2 for
  `cycle-1-baseline`, cycle 3 for `cycle-1-fix-review`), before any of that
  cycle's readers or probes start. `missed` there records the miss at once:
  print `Full-review record missed: <kind> — detected at cycle <n>'s start`,
  and from then on only the late write below can make the record available.
  If the fence cannot persist the miss record, stop before any reader, probe
  or record write; repair that I/O failure before resuming the checkpoint.
  (3) `stop`: the cap stop reads both records only through this action. The
  fix-review checkpoints run only when the baseline says `pending-fix-review`
  and cycle 2 qualifies under **Fix-review record**, at either scope.
- **Late write.** Allowed once, at the `next-cycle` checkpoint that recorded the
  miss and before any reader or probe of that cycle starts. B, T and the
  snapshot are the values that cycle recorded (the snapshot's tree check runs
  in the fence). Each stage's result and each probe's outcome come only from
  evidence-directory files written during that cycle's review collection that
  name its snapshot (the per-review evidence and /review's Step 4.7 results kept under
  **Capture evidence and commit**), listed as `sources`. Never take a value from
  memory or chat, a later cycle, the final materialized verdict or a later
  relabel. Without such a source for every value, leave the miss: the stop
  reports `record-missing`. A late record has the same fields and completion
  rules, so it proves the same coverage; `provenance` records only when it was
  assembled. There is no late write at the stop or at any later boundary.
  The assembled input and either kind's generated record or miss file are not
  review evidence and cannot be a source.

<!-- end of skills/references/review-and-prep/conditional-cycle-followup.md -->
