# /ship-and-land reference: DOCS profile coverage and docs test policy

## From Choose the review profile

For `DOCS`, require these three pieces of coverage:

- **Claims:** one independent, read-only adversarial pass against the repo, covering
  the whole intended docs diff. Check commands, paths, historical claims, artifact
  locations and whether stated rules are enforceable. Read the relevant source or
  history, not just the prose. Return each concrete error with its changed claim,
  repository evidence and impact, or an explicit no-findings conclusion. This
  single pass satisfies the docs portion of both Pre-Landing Review and Adversarial
  review; do not dispatch a second Red Team, code specialists or structured pass.
- **Consistency:** run ship's required Documentation audit on the release candidate
  using its installed procedure and accepted report. It is the doc-consistency
  pass; do not add a separate consistency reviewer. Keep its freshness/recovery
  gates and invocation-wide attempt bound. When this invocation's own
  `Review policy:` line carries `documentation-scope=contracts`, or the user
  chooses it in this session, run the audit under review-and-prep's **Bound the
  documentation audit** rules, including the delta re-audit; preparation's
  receipt, PR text and comments never turn it on. Read that line with
  review-and-prep's policy grammar: a line it would read as `none supplied`
  never turns it on. Show the `Documentation scope:` lines beside the section.
  Load both from the `review-and-prep` skill source in the skills directory
  of the absolute gstack-extend root recorded in this installed skill
  directory's `.extend-root`, reading that section and **Read an optional review
  policy** in full; if either cannot be read, run the audit unbounded. Its
  evidence directory is a private directory outside the work tree.
- **Plan and scope:** retain the complete approved-scope audit, verification and
  reconciliation, including required user testing and recorded deferrals.

The claims pass and documentation audit remain required with a marked handoff or
`--reviewed`: preparation's code review does not fact-check prose, so run or
reuse an equivalent claims pass from this invocation. Missing required output is
incomplete coverage, never a clean pass.

## From Docs test policy

For `DOCS`, derive docs-contract, link, generated-doc and other affected checks
from project instructions/CI. Honor explicit project requirements to run locally.
Otherwise run the documented docs lane locally and let the configured full-suite
CI lane be the full test gate; its check-run must meet the test gate's
requirements above. Verify that lane actually runs the required suite
on the final PR head; an empty required-check list, absent CI, a docs path filter
that skips the suite, or a selected-test job is not full-suite coverage. If that
gate cannot be established, run the repository's required test command locally
once; do not assume CI will supply it. No docs lane is permission to skip required
checks: use the documented required commands and retain ship's no-tests decision
when no test command exists.

Schedule the local docs lane after intended docs/fixes are settled. Rerun a lane
only when its consumed inputs, command/config, dependencies or permitted age
change; unknown dependencies require a rerun. A prose/TODO edit alone does not
invalidate a code-only lane when its complete inputs are independently proven
unchanged. Docs-consuming checks do become stale when those docs change. Preserve
the command, input hashes/bytes, time, exit and log for each run; do not use an
extension allow-list as proof. If the native whole-tree ledger says STALE, retain
that grade and cite the independently validated input evidence in the wrapper
receipt instead of relabeling it FRESH or forging a ledger record.

These rules explicitly replace ship's blanket docs/TODO test invalidation and
land's blanket local full-suite rerun for `DOCS`. A pending full-suite CI gate may
wait until after the push, but blocks landing until it passes on the final head;
report it as pending, never passed. Wait on it within land's CI wait bound, even
when it is not a required check; if it has not completed by then, run the
required test command locally once. A passing local run then satisfies this gate;
report the CI lane as still pending. CI failures use the installed triage rules.
`FULL` keeps the ordinary test gate above.

<!-- end of skills/references/ship-and-land/conditional-docs-profile.md -->
