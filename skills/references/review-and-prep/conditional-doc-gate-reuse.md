# /review-and-prep reference: Documentation-gate reuse and freshness rules

## From Prove /ship's release gates on this head

   Under active `doc-audit-gap=auto`, any documentation freshness check that
   would spend an attempt after an earlier accepted (`current` or `updated`)
   audit first takes **Classify changes after the documentation audit's last
   attempt** (**Under
   `doc-audit-gap=auto`**) *before* spending a re-audit attempt: when pre-attempt
   reuse applies, no `/document-release` child is dispatched, upstream's
   remaining re-audit attempt stays unspent (so a later commit touching an
   audited document, user-visible text or documented behavior still uses
   upstream's re-audit attempt before any extra attempt or owner stop), and when `GX_CAPTURE=1` the parent
   records a raw `REUSE` decision for phase `documentation` with a fresh
   `step_id` and no interval. Under `post-audit=classify` without active
   `doc-audit-gap=auto`, a change after the audit's last attempt first takes
   **Classify changes after the documentation audit's last attempt**. With active
   `doc-audit-gap=auto`, a blocked or failed re-audit, including the extra
   attempt, takes that section's fallback before blocked recovery's retry
   or owner decision.
   Under active `doc-audit-gap=auto`, verify the Prepare binding before Parent
   processing uses it. If resuming an interrupted audit, confirm the child
   stopped and enforce the stopped-state evidence rule under **Under
   `doc-audit-gap=auto`** before Parent processing. After validating child
   edits, use the cap check in **Classify changes after the documentation audit's last attempt** in place of upstream's
   origin-based cap lookup for every audit
   acceptance, including the initial audit, ordinary re-audit and extra attempt.

<!-- end of skills/references/review-and-prep/conditional-doc-gate-reuse.md -->
