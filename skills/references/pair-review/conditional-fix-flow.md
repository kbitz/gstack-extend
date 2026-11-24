# /pair-review reference: On FIX NOW checkpoint, reproduction, commit, rebuild, and verification

## From On FIX NOW

**Group-level checkpoint:**

If this is the first fix in the current group, commit a checkpoint:

```bash
git add -u
_OUT=$(git commit -m "test: checkpoint before fix (<group> group)" 2>&1)
_RC=$?
if [ $_RC -ne 0 ]; then
  echo "$_OUT"
  if ! printf '%s' "$_OUT" | grep -q "nothing to commit"; then
    echo "BLOCKED: checkpoint commit failed. Do NOT proceed."
    exit 1
  fi
fi
```

If the bash block exits zero, record the checkpoint commit hash in session.yaml.
If `$_OUT` contains "nothing to commit" (clean tree, no test changes since the
last checkpoint), skip the checkpoint entry — note "working tree clean" in
session.yaml and proceed. If the block exits non-zero (BLOCKED case),
**STOP**: do NOT record a checkpoint hash in session.yaml, do NOT proceed to
the fix step. Report BLOCKED to the user with the printed `$_OUT` tail
(pre-commit hook reject, missing `user.email`, detached HEAD, etc.).

**Reproduce first:**

On the build the human tested, under the item's prepared state, drive the
reported failure and record `agent reproduced at <build>: <observation>; <evidence path>`
in `Attempts:`; for a judgment failure, capture the state the human judged and
name the property the fix will change. If that build was replaced, a current
owned build may stand in only after you confirm the intervening changes leave
its failure path and prepared state unchanged. Record both build identities and
the comparison in `Attempts:`; uncertain equivalence parks the failure instead
of checking out another commit. When the agent cannot observe the failure
directly (a device it cannot drive, an account only the user holds), use the
closest check it can run: a simulator or emulator, a failing automated test, or
the built artifact's own output. If no check observes it, park the bug with that
reason in the On PARK format instead of asking for a retest.
Apply the Prepare-the-item safety rules to this observation. Keep `Status:
FAILED`, link the item and parked bug in both directions, record the blocked
observation in `Attempts:`, and continue to the next UNTESTED item when no
observing check exists. Unavailable observation is not non-reproduction; the
human's failed result remains unchanged.
If an observing check runs but the failure does not reproduce, append
`agent did not reproduce at <build>: <observation>; <evidence path>` to
`Attempts:`. Keep the item FAILED, link a parked bug with that reason, and do
not implement a fix or claim verification; continue to the next UNTESTED item.

**Implement the fix:**

The agent writes the code fix. This is pair testing: the human found the bug,
the agent fixes it.

**Commit the fix:**

```bash
git add -u
_OUT=$(git commit -m "fix: <description> (pair-review item <N>)" 2>&1)
_RC=$?
if [ $_RC -ne 0 ]; then
  echo "$_OUT"
  echo "BLOCKED: fix commit failed. Do NOT proceed."
  exit 1
fi
```

This keeps the existing `grep "pair-review item"` pattern working.

If the bash block exits zero, record the fix commit hash in `Fix: <commit>` and
append `fix <commit>` to `Attempts:`. If the block exits non-zero (BLOCKED case
— including "nothing to commit," which at fix-commit time means the agent's fix
did not actually modify any tracked files), **STOP**: do NOT record a fix commit
hash, do NOT mark the item as fixed, do NOT proceed to rebuild/redeploy. Report
BLOCKED to the user with the printed `$_OUT` tail (pre-commit hook reject,
missing `user.email`, detached HEAD, fix never staged, etc.).

**Rebuild/redeploy:**

Read deploy.md and execute the build/run commands. A build failure goes to Error
Handling "Deploy fails", never to a retest.

**Verify before any retest:**

Repeat the same observation on a build made from the fix commit. The reported
behavior must be gone; for a judgment failure, the named property must have
changed as intended. Record `agent verified at <build>: <observation>; <evidence path>`
or `agent verification failed at <build>: <observation>` in `Attempts:`. A failed
verification is recorded, and the agent fixes again without asking the human; it
counts toward the existing escalation after three fix attempts.
If verification cannot run, append `agent verification unavailable at <build>:
<reason>`, keep the item FAILED and link a parked bug. Mark that fix deliberately
deferred; unavailability never triggers another fix or counts toward escalation.
Apply the Prepare-the-item safety rules to the rebuild and verification too.
At escalation, retain the failed verification and link an unresolved parked bug;
a fix commit is never evidence of a passing item.

**Update state:**

A failed result is never re-marked passed. Keep it, its evidence and its build in
`Attempts:`. Only a new human retest of the verified fix can pass the item,
recorded beside the failure, never in its place. Write `Fix: <commit>` and the
updated `Attempts:` to disk while keeping `Status: FAILED` until the human
retests.

**Continue testing:**

Present the retest only after a verified fix via AskUserQuestion:
Refresh `Prepared:` and `Agent evidence:` on the verified build before
presenting the retest, using Prepare the item; retain the earlier observations
in `Attempts:`.
- Question: "Fixed in [commit]; reproduced and verified on build [build]. Retest:\n\n**[Group] [N]/[Total]:** [Action line]\n\nPASS: [item's Pass field]\nFAIL: [item's Fail field]\nPrepared: [item's Prepared field]"
- Options: ["Pass", "Fail", "Skip", "Park a bug", "Add item"]

Do not append an explanation of the fix to this prompt. The human retests the
same observable criteria; what changed underneath is not their input.

If the retest passes, record `PASSED at <build> (<time>)` in `Attempts:` and
update `Status: PASSED`. If it fails again, append the new failure to `Attempts:`
and repeat the fix cycle. Recompute `session.yaml` summary counts after either
result; a retested pass replaces the latest failed tally, not its history.

<!-- end of skills/references/pair-review/conditional-fix-flow.md -->
