# /ship-and-land reference: Release-only stage table, hand-back template, and post-write recovery

## From Release-only path

On this path reuse the receipt's `Ship gates` coverage and documentation audits
only after the provenance and binding checks above; pregate and test lanes keep
their own evidence rules. These rows replace the matching stage-table rows below.
Other rows keep their wrapper behavior:

| Installed ship stage | Release-only behavior |
|---|---|
| Merge base (3) | Must be a no-op. If it changes HEAD, leave this path. |
| Run tests / Eval Suites (5–6) | No suite runs. Reuse the FRESH test/eval evidence and verified full pregate copy that qualified this path. Missing evidence selects the existing FULL path before release writes. The checks release metadata selects run after the release commit, at Verification Gate (16). |
| Test Coverage Audit (7) | Reuse preparation's bound audit or its recorded waiver. |
| TODOs (14) | Edit nothing. List detected completions and follow-ups in the PR body, as ship does when a TODO write is skipped. |
| Documentation audit (14.5) | When `git diff --name-only <prepared tree> <current tree>` lists only release metadata, reuse preparation's accepted audit for the reviewed base with its accepted status. Alternatively reuse the user's recorded named-risk decision for that same content; only that case keeps `Documentation: blocked` with its reason and scope. Use the hash-verified documentation section, unchanged, as ship's section file, with `Reused from /review-and-prep at <prepared tree>` beside it, not inside it. For Steps 18–19 this replaces the upstream rule against reusing another invocation's audit. Any legacy documentation-sync stage is read-only on this path; drift uses the same hand-back. When preparation's accepted audit ran under `documentation-scope=contracts`, keep its recorded `Documentation scope:` and any `Documentation re-audit scope:` lines and show them beside the section with `Reused from /review-and-prep at <prepared tree>`; reuse rules are otherwise unchanged. |
| Commit (15) | Commit release metadata only, then run Step 3's trailer check. |
| Verification Gate (16) | Run declared builds and Release-metadata test selection's run. Check the release-metadata delta directly in place of stages 2–3. In stage 4, pass `--allow-paths` naming only the release-metadata files this run changed. Before Step 17's push, run `gstack-pregate --stage preflight --allow-repo-commands` on the final tree with preparation's policy source, so publication has a current record. That record has no lanes; cite preparation's immutable verified full record for the prepared tree, including its path, SHA-256, policy source and cleared requires-remote obligations, separately from the final preflight record. |

Settle every reuse decision and check-only run before Step 12, so no release
write precedes a finding. A finding that needs any other change is preparation
work: documentation drift, a coverage gap the threshold decision does not accept,
a pregate or test failure, a missing plan item, or actionable review feedback.
Ship never edits code, tests or docs on this path. Stop and hand back using the release-only hand-back template in **Release-only path** in the core, naming the
finding.

Print the stage line after the hand-back fence (`next: review-and-prep; status: stopped`, `head` set to the fence's `head:`). A post-write failure, such as a build, a release check or the final preflight, stops before the
push. Fix it when the fix stays within release metadata. Otherwise, before any
push, identify any uncommitted release writes this invocation owns. Restore only
those named paths from the prepared HEAD after verifying their entire diff is
this invocation's release metadata and no intervening writer changed them;
use `git restore --source=<prepared HEAD> --staged --worktree -- <owned paths>`.
If ownership is uncertain, preserve the changes and report them. Then
verify the intervening commits are only this invocation's unpushed release
commits, then use `git reset --keep <prepared HEAD>`. Check its exit status,
HEAD equality and the complete working-tree status before claiming restoration.
Preserve unexpected local changes; if recovery fails or leaves changes, report
the remaining commits/paths and error without claiming a clean branch.
After a push, preserve published history and name the retained release commits
and current local/remote heads in the hand-back. This routing also applies to
new feedback and non-release findings during later ship or land readiness
checks. Never reset published release commits to make the hand-back look clean.
The receipt records
`path: release-only`, each reused record with its source, and every check-only
run.

<!-- end of skills/references/ship-and-land/conditional-release-only.md -->
