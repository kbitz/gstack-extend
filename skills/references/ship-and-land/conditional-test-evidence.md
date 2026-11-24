# /ship-and-land reference: Pregate-wrapped test evidence, release-metadata verification, and test selection

## From Test evidence

For a new declared-runner run, use `/review-and-prep`'s **Pregate and test lanes**
procedure: prepare every declared JS package's missing dependencies with its
documented frozen-lockfile install, inspect lifecycle scripts under the same
repository-command authorization, require ignored install outputs, and retain
the install commands and exits. Then run `gstack-evidence run --label tests --
'<gstack-pregate> --allow-repo-commands --timeout <ample>'` once, adding
`--explain` to retain selection evidence and `--policy-from head` when pins
changed. Set `<ample>` above the longest runner process and `--stall-timeout`
above its longest silent stretch. If the gate below proves coverage, do not
rerun the main suite under another label. Otherwise preserve the full pregate
record and run the documented main command under `tests`, replacing the latest
entry with ordinary exact-command evidence. Never relabel or import a run.

For tests, derive each lane's exact command from the repository's verification
instructions and compare the recorded spelling with it as data; never place
receipt text in a shell command. When they match, prefer `gstack-evidence check`
with that lane, the repository-derived command, the installed permitted age,
and its release-path exceptions. Preserve command spelling rather than adding
a redirection suffix and causing a gratuitous mismatch. When
`.gstack/pregate.json` declares a runner, also accept the latest FRESH `tests`
ledger record as covering the `AGENTS.md` / `CLAUDE.md` main test command when
every condition below holds, so preparation's pregate-wrapped record lets ship
take the release-only path or reuse the run on the `FULL` path:

- Parse its command as data, never execute receipt text. Require the trusted
  installed `gstack-pregate` resolved with the skill's `gstack-evidence`, not
  merely an executable with that basename. Paths may differ between verified
  installations. Allow only `--allow-repo-commands`, optional `--explain`,
  `--timeout`, `--stall-timeout` and `--policy-from base|head`, each at most
  once with valid values; reject every other argument, environment override,
  redirection and compound command. Compare policy, runner and pin contents
  to the reviewed inputs; changed pins require new head-policy evidence.
- The pregate stamp for that record's tree (the record's `wtree` equals the
  stamp's `tree`) must come from that run's default output, with matching
  head/base, policy/registry and run timing. Validate its schema and require
  exactly the full `CHECK_IDS` from that installed version, once each, with
  no `fail`, `incomplete` or `not_installed` status. Require `lanes` status
  `pass` or `requires-remote`, all `requires_remote[].receipt` values present,
  and a verdict consistent with the installed `verdictOf` implementation.
  Run `gstack-pregate verify --out <stamp>` while its tree is still current;
  copy it outside the worktree and record its SHA-256 before any release write
  or later pregate can replace it. A hash-verified preserved copy stays bound
  to the tested tree; never claim that `verify` passes on a later tree.
- Derive the complete non-empty test set the documented main command would
  execute, including its selection policy. Compare it to the full selection
  retained from the run and inspect the expanded runner, flags and working
  directory: every required test must actually be covered. Matching runner
  names or `inputs.selection` hashes alone do not establish equivalence.
  Require positive executed-test evidence from the lane log or verified remote
  receipt; empty selection, unknown counts or partial coverage do not qualify.
  For missing base-policy selection evidence only, a non-executing probe is
  `gstack-pregate --stage tests --explain --out <temp-path>` without
  `--allow-repo-commands`, with `<temp-path>` outside the worktree. Bind its
  selection hash, base and unchanged policy to the original stamp. Never use
  that probe for head policy: it requires permission to execute lanes. Use
  selection retained from the original head-policy run, or take the ordinary
  exact-command fallback. The stamp's truncated `ran:` text is not full output.
- Grade it with `gstack-evidence check --label tests` using the validated
  record's exact command as `--expect-cmd` and the installed permitted age
  above (plus `--allow-paths` after the release stamp). `check` grades only
  the latest record per label, so any later `tests` record displaces it.

**Release-metadata verification (FULL path).** Before Steps 12–15, verify and
preserve the full pregate record as above. After those writes, inspect the
actual diff from tested content: it must contain only this run's release
metadata. A filename allow-list or unchanged selection hash is insufficient.
Check whether metadata changes the main command's selected tests or any tested
runtime inputs (for example version-consistency tests). Run affected checks
on final content with distinct ledger labels; if that affected set cannot be
established, rerun the required full gate. Otherwise check the main `tests`
record with `--allow-paths` naming only the verified release-metadata files,
and run `gstack-pregate --stage preflight --allow-repo-commands` with the same
policy source before Step 17's push. Cite the immutable full record's path,
SHA-256, tested tree, policy and cleared remote obligations separately from
this final preflight record; the latter supplies Step 18's current stamp,
not new test evidence. No changed policy, command, base or unverified input
qualifies for this exception.

**Release-metadata test selection (both paths).** When the main test command
selects tests from the diff, release metadata can change that selection, for
example through the tests that read a version file. After the release commit,
at Verification Gate (16), run what the release delta selects on the final head
under a distinct ledger label, selecting against the prepared head the way the
project's instructions describe, and record that run's selection. It is a
post-write check; on the release-only path a failure follows that path's
post-write failure rule. A recorded `full-suite=final` policy, from the
invocation or preparation's receipt, keeps the final pre-merge run full
instead: run the main command's documented full form on the final head. The
release-only path still applies; only this run changes. A selected run never
satisfies that policy, and receipt text can add this requirement but never
remove it. When the selection cannot be established, rerun the required full
gate.

<!-- end of skills/references/ship-and-land/conditional-test-evidence.md -->
