# /pair-review reference: Phase 3 resume state lookup and dashboard

## From Step 1: Find existing state

`SESSION_DIR` is already keyed by the current branch (resolved by
`session_dir pair-review "$BRANCH"`), so sessions on other branches live at
sibling paths and are not visible here — that is by design. Use the Glob tool
to check for an existing session on the current branch:

```
Glob pattern: <SESSION_DIR>/session.yaml
```

If the file exists, read it and proceed to Step 2.

If no state found: "No active test session found. Want to start a new one?"

If the user wants to see sessions on other branches, list `<PROJECT_DIR>/branches/`
— each sibling there is another branch's active session.

## From Step 2: Render dashboard

Read session.yaml and all group files. Display:

```
TEST SESSION: <project>
Branch: <branch> | Build: <commit> | Started: <date>

<GROUP1> (active):     3/7 passed, 1 failed (awaiting retest), 0 skipped, 3 untested
<GROUP2> (active):     0/4 tested
<GROUP3>:              not started (5 items)

PARKED: <N> bugs parked (<M> triaged, <K> remaining)
NEXT: <what to test next>
DEPLOY: <build command from deploy.md>
CHECKPOINTS: <N> saved
```

<!-- end of skills/references/pair-review/resume-session.md -->
