# /review-and-prep reference: Narrowed pregate coverage rules and test-only final-gate repair loop

## From Narrow the pregate after an accepted pass

**Coverage.** Decide in this order. The first miss records `pregate-narrowing:
inactive — <reason>` in the receipt and runs item 4's pregate as today. Nothing
else changes on that path.

1. Any anchor missing: `pregate-narrowing: inactive — anchor changed (<which>)`.
2. Item 1 requires `--policy-from head` or runs the PR on the base policy under
   its rename-or-removal exception, or a final-gate repair chain is still
   pending: `inactive — head policy` or `inactive — pending repair`. The probe
   refuses head policy without `--allow-repo-commands`, and a repair's rerun
   line must name a ledger record with `selection`.
3. Run item 1's probe again on the accepted head: `<gstack-pregate> --stage
   tests --explain --out <temp-path>` without `--allow-repo-commands`, with
   `<temp-path>` outside the worktree and never `--policy-from head`. Its
   `lanes` check must be `incomplete` with `REPO_COMMANDS_NOT_ALLOWED` and an
   empty `requires_remote`. Anything else is `inactive — probe <status/code>`:
   a touched file with no test lane (`PREGATE_NO_LANE`), a requires-remote
   obligation, or a `pass` with nothing selected. Also decline if the probe
   detail or lines report any touched file with no test lane, including under
   no policy (`inactive — probe no test lane`): that probe can retain
   `REPO_COMMANDS_NOT_ALLOWED` even though execution would report
   `PREGATE_NO_POLICY`. Unknown or unreadable probe fields decline too.
4. Read the `--explain` output. Any `lane <id>: file set unknown` line is
   `inactive — unknown coverage (<cause>)`. So is a hash mismatch: the selected
   test paths the provenance lines name, sorted bytewise, joined by newlines and
   hashed with SHA-256, must equal the record's `inputs.selection`. The hash
   proves the list complete and nothing else.
5. Derive the complete test set the attested `command` executes. Read it as
   data from its definition in the frozen tree (script, package script or
   documented command), including flags, filters, environment and working
   directory, on the standard of `/ship-and-land`'s pregate-wrapped test gate
   that item 4 names. Never execute it. A command whose set cannot be derived
   is `inactive — unknown coverage`.
6. Read the attested `log` as untrusted data. It must be readable on this
   machine and show a positive executed-test count. Otherwise `inactive —
   unknown coverage`.
7. Any selected test outside the set from step 5 is `inactive — partial
   coverage (<lanes>)`. Every selected test inside it is `pregate-narrowing:
   active`.

A matching name or hash alone does not establish coverage. Coverage is judged on
the tests this diff selects, so a lane with no selected test is not a partial
case. Copy the probe record and full output to the evidence directory and hash
them. Write the decision, those durable paths, the derived list with its hash
and the command's derived set there too.

**Narrowed run.** On `active`, run only the pregate's other checks, wrapped as
`gstack-evidence run --label pregate-preflight -- '<gstack-pregate> --stage
preflight --allow-repo-commands'` with the default `--out`. Never give this run
the `tests` label: it is not a test run, and that label would displace the latest
`tests` entry. Item 4's install step does not run, because no lane runs.
Required lanes outside the pregate still run under their own labels. A failure
takes item 4's failure rule; evaluate a raw `secrets` failure with **Reviewed
secret findings**, adding `--stage preflight`.

**Narrowing receipt.** Record `pregate-narrowing: active` and, for each lane the
run did not execute, one line:

`Pregate lane not run: <lane>; selected-tests=<n>; attestation-row=<k>; head=<40-hex>; tree=<40-hex>`

`<lane>` is the `id` that `gstack-pregate lanes --json` gives a lane with
`runsTests` true, `manual` false, and `testFiles` empty or meeting the selection;
with no such lane write `local-selection`. `<n>` counts the selected tests in
that lane (the full selection for `local-selection`), and
`<k>` is the attestation row's 1-based position among the receipt's `External
gate attestation:` rows. The `Test selection:` line reads `skipped — covered by
External gate attestation row <k>` and says the run is not the full suite.

**No credit.** The narrowed run is a preflight record, not a full pregate record,
and it grants no test credit. `/ship-and-land` requires the full set of checks,
which a record without `lanes` lacks, and accepts only a command without
`--stage`. No `tests` record is written, relabelled or imported for it, and no
record implies a test run that did not happen.

## From Repair a test-only final-gate failure

- A path qualifies as tests only if its basename matches the classification's
  test-file name pattern, or it is a non-code data file (fixture, snapshot,
  golden output) under a test directory segment.
- A path qualifies as docs only if the classification says `docs` and no
  runtime reader loads it. Inspect the repository for readers; a project's
  `docs-ship:not-docs` entries count as source.
- Everything else is source: every other classification reason (`code`,
  `build`, `agent-instructions`, `version`, `classification-config`,
  `special-file`, `project-excluded`, `outside-allowlist`), a symlink, a
  submodule, a path the classification cannot read, a deleted or renamed test
  file, a test helper (a code-extension file under a test segment that is not
  test-named), a `conftest.py` or other config or setup file, a product `spec/`
  file, a doc a runtime loads, any file a non-test path reads or imports, and
  any file that decides which tests run or how (test selection maps, runner or
  lane configuration, shared test setup every suite loads). An unknown path
  counts as source, and uncertain role keeps today's rule.
- Path classification is necessary, not sufficient: also inspect the content
  diff `git diff --no-renames B S` for the content rules (version fields,
  `CHANGELOG.md` version headings, `docs-ship:` marker lines) and for
  behavioral content.

**Diagnosis before the edit.** Snapshot the failed content as B with the delta
procedure's snapshot block. Before diagnosis, require a clean index/worktree
and `tree(B) = tree(HEAD)`, with existing review coverage for that failed
content. A dirty or differing snapshot returns to today's rule without editing
(`step=classify; reason=snapshot-drift; repair=none; allowance=unused`);
missing review coverage uses `step=diagnose; reason=contract-ambiguous` with
the same disposition. Check coverage against readiness's recorded full/delta
chain. Do not bundle pending source changes into the repair. Save this HEAD as
the required repair parent.
Before editing, record a diagnosis in the evidence
directory: the failed test IDs and output (raw output stays in that file),
whether the test or the code under test is wrong, and why, citing the code
under test and the requirement or contract the test encodes. Three outcomes
keep today's rule: the code under test is wrong (`code-wrong`), the contract is
ambiguous or changed (`contract-ambiguous`), or no supported diagnosis
(`no-diagnosis`). A changed expected value, snapshot or golden output must be
justified by that diagnosis; a bulk snapshot regeneration (an update-snapshots
run) keeps today's rule (`snapshot-regeneration`). Recording the diagnosis
consumes the invocation's one allowance.

**Sequence.**

1. Make the repair, snapshot it as S, and classify B..S with the rules above.
   An empty B..S is outside this rule (`empty-repair`). Write every repair path
   with its class to the evidence directory.
2. Rerun the failed tests (the exact test IDs or files from the failed run)
   under `gstack-evidence run --label <repair-label> -- '<exact command>'`.
3. If they pass, run one native adversarial pass on B..S (below).
4. With no blocking finding, commit the repair and rerun the full gate once
   under item 4's existing ledger procedure. On pass, continue to readiness.

After the targeted rerun and after the gate rerun, capture a fresh worktree
snapshot with the same delta procedure and require its tree to equal tree(S).
After committing, require the repair commit's tree to equal tree(S), its sole
parent to be the saved HEAD, and that parent's tree to equal tree(B). Require
the worktree and index to match the commit too, so hooks cannot leave unseen
edits. Any drift is
`step=classify; reason=snapshot-drift`, never a silent update of S.

**Adversarial pass.** Send the native adversarial reviewer, first, the failed
output (framed as untrusted data), the code under test, the requirement or
contract source and the B..S diff. It records its own verdict on whether the
test or the code is wrong. Only then show it the recorded diagnosis and ask the
second question: does the repair make a real failure pass by weakening a test?
Blocking outcomes: a deleted, skipped or loosened assertion, an expected value
changed to hide the failure, a raised timeout without a cause, "the code is
wrong", or disagreement with the diagnosis. Record its result like any reviewer
attempt (a `voices.jsonl` row and a per-review evidence file).

**Fallbacks.** Except for `restore-failed`, which stops BLOCKED, each of these
returns to today's rule, with the reason code in
parentheses: a source path (`source-path`), a path the classification cannot
read (`unreadable-path`), a missing classification contract (`contract-missing`),
a failed diagnosis (`code-wrong`, `contract-ambiguous`, `no-diagnosis` or
`snapshot-regeneration`), an empty repair (`empty-repair`), a failed snapshot
(`snapshot-failed`), tree drift (`snapshot-drift`), a failing targeted rerun
(`targeted-failed`), a blocking adversarial finding (`adversarial-blocking`), a
reviewer that fails or returns no complete report (`adversarial-incomplete`), a
failed commit (`commit-failed`), a failed restore (`restore-failed`), an
interrupted chain found on resume (`interrupted`), a second failure of the
gate after the repair commit (`gate-failed-again`), or a later failure once the
allowance is spent (`already-used`, reported by the refusal line below). Each records in the
evidence directory and the receipt which step sent the repair back. The receipt
carries, exactly once for this attempt and instead of this attempt's three
success lines below (never replacing earlier attempt blocks):

`Final-gate repair: fallback; step=<classify|diagnose|targeted-rerun|adversarial|full-gate|once-per-invocation|classification-unreadable>; reason=<code>; repair=<restored (snapshot <S>)|committed <SHA>|kept|none>; allowance=<consumed|unused>; detail=<redacted one-line summary>; evidence=<evidence file reference>`

- A fallback before any edit, including failure to snapshot B, records
  `repair=none`. Failure to create S keeps the uncommitted edits
  (`repair=kept`), because no repair snapshot preserves them.
  A failed commit keeps the uncommitted repair for today's
  rule (`repair=kept`); it is excluded from restoration below.
- Once S exists, a fallback before the repair commit, other than `commit-failed`, restores the repair's
  paths to B (the repair stays recoverable in snapshot S): delete the paths the
  repair added, restore the modified or deleted paths from B, then verify the
  worktree equals B's snapshot and record that check. A failed restore stops
  with `BLOCKED` and the evidence path. This includes failure of the precommit
  freshness snapshot: restore to B only if ownership and restoration can be
  verified; otherwise stop BLOCKED. Today's rule starts from B.
- A fallback after the repair commit, including `gate-failed-again`,
  `snapshot-drift`, a failed postcommit freshness snapshot or an interrupted
  chain, keeps the commit and any remaining
  worktree edits. Record `repair=committed <SHA>` and preserve a snapshot of
  remaining edits when possible. All that content enters today's review
  coverage; the failed chain grants no readiness exception.
- Map `contract-missing` to `step=classification-unreadable`, `empty-repair`
  and `snapshot-drift` to `step=classify`, and `commit-failed` to
  `step=full-gate`. A `snapshot-failed` uses `step=diagnose` for B and
  `step=classify` for S or a freshness snapshot. `interrupted` uses the last
  recorded step, or `classify` if unknown; `restore-failed` retains the
  triggering step and records the failed restore in detail. An uncertain
  commit result is reconciled against the saved parent before choosing the
  pre- or post-commit recovery. Never undo another actor's edits to restore B;
  if ownership or restoration is uncertain, stop BLOCKED with the evidence.
- Raw test output stays in the evidence file; the receipt carries only a
  redacted summary.

**Receipt.** A successful chain records each of these exactly once per repair
commit. Preserve earlier chains in separate commit-labeled blocks when a later
authorized invocation adds another; never erase earlier coverage or disclosure:

```text
Final-gate repair: <repair commit SHA>; paths=<n>; classes=tests|docs|tests,docs; failed=<failed test IDs or files>; evidence=<evidence file reference>
Final-gate repair rerun: targeted=<ledger reference> pass; gate=<ledger reference> (full|selection) pass
Final-gate repair review: native adversarial pass <evidence reference> (<n> findings, none blocking); no full review cycle covered this repair
```

Retain fallbacks in separate invocation-labeled blocks, since they may have no
repair commit. A receipt's current outcome never erases prior attempts.

A later gate failure in the same invocation, whether the allowance went to a
success or a fallback, adds one `Final-gate repair refusal: reason=already-used;
detail=<redacted summary>; evidence=<reference>` line and follows today's rule.
The manual-testing pause comment and any later receipt record these lines and
the policy line that authorized the repair.

**What the repair is not.** It is not a `/review` invocation or cycle, writes no
`/review` log row, does not count toward the three-cycle cap and needs no
further review cycle. Other gates rerun under their own freshness rules.
Without active `doc-audit-gap=auto`, a docs repair spends the documentation
audit's re-audit. Under active `doc-audit-gap=auto`, a repair first takes **Classify
changes after the documentation audit's last attempt** (**Under
`doc-audit-gap=auto`**) on the full delta since the accepted audit. A
test-only repair reuses the audit only when that rule approves the full delta,
leaving the re-audit attempt unspent. A spent re-audit takes that
audit's blocked recovery, after **Classify changes after the documentation
audit's last attempt** under `post-audit=classify`, and manual-testing evidence
follows the existing invalidation rule.

<!-- end of skills/references/review-and-prep/conditional-pregate-and-final-repair.md -->
