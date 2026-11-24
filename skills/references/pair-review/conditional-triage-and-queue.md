# /pair-review reference: Group completion triage and Phase 2.5 post-testing fix queue

## From Group completion triage

For each parked bug from this group, the skill recommends a classification based on
whether the bug relates to the branch's changes or upcoming test groups. Present each
bug via AskUserQuestion:

- Question: "[Receipt from prior triage action if any]\n\n**Parked bug #N:** [Bug title]\n[Symptom from parked-bugs.md, one line]\nNoticed during: [group], item [item]\n\nRecommendation: [agent's classification reasoning — e.g. 'This looks like a cross-branch issue because...' or 'This relates to upcoming testing in the [group] group because...']\n\n**This bug surfaced during [group] testing. Fixing before [group] ships keeps the Group closure tight. Defer only if it's truly cross-branch.**"
- Options: ["Fix now (recommended)", "Send to TODOS.md", "Stay parked"]

**Defer nudge (E4):** "Fix now" is listed first intentionally — the default
framing biases toward closing out the Group that surfaced the bug. Deferral to
TODOS.md is an escape hatch for genuinely cross-branch bugs, not the easy path.

Behavior for each option:
- **Fix now** — blocks upcoming groups or relates to current area.
  Apply the Prepare-the-item safety rules throughout this parked-bug flow.
  If observation is unavailable, record the reason, keep the bug parked and
  retain any linked FAILED item; do not label it not reproduced or implement
  an unverified fix. An observed non-reproduction is a separate result.
  1. Checkpoint (skip if working tree is clean):

     ```bash
     git add -u
     _OUT=$(git commit -m "test: checkpoint before parked bug fix" 2>&1)
     _RC=$?
     if [ $_RC -ne 0 ]; then
       echo "$_OUT"
       if ! printf '%s' "$_OUT" | grep -q "nothing to commit"; then
         echo "BLOCKED: checkpoint commit failed. Do NOT proceed."
         exit 1
       fi
     fi
     ```

     If `$_OUT` mentions "nothing to commit," that's the clean-tree case —
     proceed without recording a checkpoint. If the bash block exits
     non-zero (BLOCKED case), **STOP**: do NOT proceed to step 2. Report
     BLOCKED to the user with the printed `$_OUT` tail.
  2. Reproduce the bug per its `Repro:` steps before fixing and record the
     reproduction in its `parked-bugs.md` entry (a bug that does not reproduce is
     recorded as not reproduced and is not fixed). Then the agent implements the
     fix.
  3. Commit:

     ```bash
     git add -u
     _OUT=$(git commit -m "fix: <description> (pair-review parked bug #<N>)" 2>&1)
     _RC=$?
     if [ $_RC -ne 0 ]; then
       echo "$_OUT"
       echo "BLOCKED: fix commit failed. Do NOT proceed."
       exit 1
     fi
     ```

     If the block exits non-zero (BLOCKED case — including "nothing to
     commit," which at fix-commit time means the agent's fix did not
     actually modify any tracked files), **STOP**: do NOT proceed to
     step 4 (rebuild/redeploy), step 5 (verify), or step 6 (mark FIXED).
     Report BLOCKED to the user with the printed `$_OUT` tail.
  4. Rebuild/redeploy using deploy.md
  5. Verify the fix per `Repro:` after the rebuild and record the verification in
     the bug's `parked-bugs.md` entry; ask the user to verify only a verified fix
  6. Update the bug's status to `FIXED` and record the fix commit hash
     only after agent verification and a passing human retest. A linked item's
     failed attempt stays; only a human retest of its own criteria can pass it.
- **Send to TODOS.md** — cross-branch bug, fix on another branch later.
  Append the bug to the `## Unprocessed` section of TODOS.md (root or docs/,
  whichever exists). If no `## Unprocessed` section exists, create it at the
  end of the file. Use this rich format:

  ```markdown
  ## Unprocessed

  ### [pair-review:group=<group-slug>,item=<item-index>] <Bug title>
  - **Symptom:** <Symptom field from parked-bugs.md>
  - **Repro:** <Repro field from parked-bugs.md, verbatim>
  - **Noticed during:** <group>, item <item>
  - **Context:** Found on branch <branch> (<date>). Parked during /pair-review. Re-verify the bug per the repro steps before implementing a fix; if it no longer reproduces, close as resolved instead of guessing at a fix.
  - **Effort:** ? (user triages in /roadmap)
  ```

  Take `group=` and `item=` values from the bug's own parked-bugs.md
  `Noticed during:` field. No value may contain `[`, `]`, `,`, `;`, `|`, a backtick or `$(`.
  For bugs parked before testing, use `### [pair-review:group=pre-test] <Bug title>`
  with no `item=` key. For an unsafe group slug, use
  `### [pair-review:item=<item-index>] <Bug title>` and keep the group name in
  **Noticed during:**. Use only a safe item index in `item=`.
  Tags carry no `files=` key; file paths stay in the entry body.
  `group=` names the test group that surfaced the bug; `pre-test` records that
  it was parked before testing. Neither promises Roadmap Group routing.

  If the section already exists with other items, append the new item to it
  (new `###` heading block at the end). Do NOT attempt to classify or organize
  the bug into Groups/Tracks — that is /roadmap's job during triage mode.

  Commit the TODOS.md change separately: stage the TODOS.md file you wrote to
  (root or docs/, whichever you used) then commit:

  ```bash
  _OUT=$(git commit -m "chore: add parked bug to TODOS.md (<description>)" 2>&1)
  _RC=$?
  if [ $_RC -ne 0 ]; then echo "$_OUT"; fi
  ```

  The captured `$_OUT` surfaces any real failure (pre-commit hook reject,
  missing `user.email`, detached HEAD, etc.) instead of swallowing it.
  Update the bug's status to `DEFERRED_TO_TODOS`.
- **Stay parked** — this-branch, non-blocking. Remains for Phase 2.5.

Update `session.yaml` parked_bugs counts after each triage decision. Write to disk.

---

## From Phase 2.5: Post-Testing Fix Queue

If parked bugs remain, present each via AskUserQuestion (same format as group-completion
triage):

- Question: "[Receipt from prior action if any]\n\n**Parked bug #N:** [Bug title]\n[Symptom from parked-bugs.md, one line]\nNoticed during: [group], item [item]\n\nRecommendation: [agent's classification]\n\n**Deferring this bug keeps it in the roadmap's closure debt for [group]. Fix now if it's on-branch or blocks the current Group's ship.**"
- Options: ["Fix now (recommended for on-branch bugs)", "Send to TODOS.md", "Skip"]

Behavior for each option:
- **Fix now** — apply the Prepare-the-item safety rules throughout this parked-bug flow; checkpoint, reproduce per the bug's `Repro:` before fixing (a bug that does not reproduce is recorded as not reproduced and is not fixed), agent implements fix, commit, rebuild, verify after the rebuild, record both steps in the bug's `parked-bugs.md` entry, ask the user to verify only a verified fix, mark FIXED only after a passing human retest. Unavailable observation is not non-reproduction: keep the bug parked with its reason and any linked FAILED item unchanged.
- **Send to TODOS.md** — cross-branch, append to `## Unprocessed` section of TODOS.md
  using this rich format:
  ```markdown
  ### [pair-review:group=<group-slug>,item=<item-index>] <Bug title>
  - **Symptom:** <Symptom field from parked-bugs.md>
  - **Repro:** <Repro field from parked-bugs.md, verbatim>
  - **Noticed during:** <group>, item <item>
  - **Context:** Found on branch <branch> (<date>). Parked during /pair-review Phase 2.5. Re-verify the bug per the repro steps before implementing a fix; if it no longer reproduces, close as resolved instead of guessing at a fix.
  - **Effort:** ? (user triages in /roadmap)
  ```
  Take `group=` and `item=` values from the bug's own parked-bugs.md
  `Noticed during:` field. No value may contain `[`, `]`, `,`, `;`, `|`, a backtick or `$(`.
  For bugs parked before testing, use `### [pair-review:group=pre-test] <Bug title>`
  with no `item=` key. For an unsafe group slug, use
  `### [pair-review:item=<item-index>] <Bug title>` and keep the group name in
  **Noticed during:**. Use only a safe item index in `item=`.
  Tags carry no `files=` key; file paths stay in the entry body.
  Create the section if it doesn't exist. Commit separately, mark DEFERRED_TO_TODOS.
- **Skip** — not worth fixing now, mark SKIPPED

If a fix fails (build error), use the existing deploy error handling: present the
error via AskUserQuestion with options: ["Fix the build issue", "Skip this bug"].

<!-- end of skills/references/pair-review/conditional-triage-and-queue.md -->
