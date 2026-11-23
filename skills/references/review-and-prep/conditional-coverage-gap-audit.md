# /review-and-prep reference: Coverage-audit adjustments for recorded test gaps

## From Prove /ship's release gates on this head

   Under `test-gaps: active`, **Record unproven test gaps** changes only how
   gaps are handled. The parent dispatches the audit with `Generation:
   audit-only`, the section's documented parameter, and each `gaps` and
   `weak_gaps` path that meets that section's rules gets a `Test gap recorded:`
   line with `source=coverage-audit`. A regression the audit names gets one
   generation pass limited to those paths, in place of the audit's "err on the
   side of writing the test": a test red at HEAD in its own assertion stays,
   with the audit's Regression proof record and the fix path, while a test that
   passes at HEAD proves no defect, so remove it with the audit's rejected-test
   removal and record the gap. Reapply all recordable-gap conditions before
   recording a passing regression candidate; if it is ineligible, use ordinary
   gap handling instead of recording it.
   For every gap that is not recordable, retain the audit's ordinary generation
   and threshold handling (`plan-required`, `no-path`, `path-not-taggable`, or
   eligibility uncertain). Re-dispatch with `Generation: allowed`, supplying
   only the named regressions and non-recordable gaps as generation targets;
   exclude only the recorded findings or behaviors, never their whole files;
   a different non-recordable gap or regression sharing a path remains a
   generation target; count every generation pass against the audit's existing
   two-pass limit. Keep the audit's setup-failure,
   rejected-test and exhausted-allowance rules. An unrecordable gap is never
   covered by the recorded-gaps threshold decision: apply the ordinary gate
   to it and retain its actual decision separately.
   Use the list-only answer only when every remaining gap is recordable and
   recorded. Answer the threshold gate with its list-only
   option A and record `threshold decision: gaps recorded under
   test-gaps=record (<n>)` in the receipt's coverage-audit field. The audit
   still runs, so the waiver rule above is unchanged.

<!-- end of skills/references/review-and-prep/conditional-coverage-gap-audit.md -->
