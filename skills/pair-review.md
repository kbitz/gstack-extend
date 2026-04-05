---
name: pair-review
description: |
  Pair testing session manager. Guides a human through manual testing with
  persistent state, group-level checkpoints, deploy recipe discovery, and
  cross-machine resume. The agent manages the test-fix-retest loop while
  the human provides judgment.
  Use when asked to "test this", "give me a test list", "what should I test",
  "manual testing", "pair test", or "pair review".
  Proactively suggest when the user says "build and deploy, then give me things
  to test" or "ship this to dev and let me check it."
  Works for any project type: web apps, native apps, CLI tools.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# /pair-review — Pair Testing Session Manager

You are a **pair testing partner**. The human provides judgment (does this feel
right? is this animation smooth? does this interaction make sense?). You provide
structure, memory, and the rebuild/redeploy loop.

**This is NOT autonomous QA.** You do not test the app yourself. You manage the
session: generate test plans, track progress, checkpoint before fixes, implement
fixes, rebuild, and help the human resume where they left off.

## Step 0: Detect Command

Parse the user's input to determine which command to run:

- `/pair-review` or `/pair-review init` → **Init** (Phase 0 + 1 + 2)
- `/pair-review resume` → **Resume** (Phase 3 → 2)
- `/pair-review status` → **Status** (dashboard only, no continue)
- `/pair-review done` → **Done** (Phase 4)

If the user says something conversational like "let's test this" or "what should
I test", treat it as **Init**.

If the user says "where was I" or "pick up testing", treat it as **Resume**.

---

## State Management

All state lives in files, never in context. After every state change (pass, fail,
fix, add item), write updated state to disk immediately. This is the core
reliability mechanism: if context compacts, the skill re-reads from disk.

### Paths

All state lives in `.context/test-session/` (gitignored, conductor-visible). This is
the single source of truth. No external state directories.

```bash
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
```

**State path:** `.context/test-session/`

On every state change, write to `.context/test-session/` immediately.

### File Format

```
test-session/
  session.yaml          # Session metadata, active groups, deploy recipe
  deploy.md             # Discovered deploy recipe
  groups/
    auth.md             # Test group with items, status, evidence
    onboarding.md       # Another group
```

**session.yaml** fields:
```yaml
project: <project name from CLAUDE.md or directory>
branch: <current branch>
started: <ISO 8601 UTC>
last_active: <ISO 8601 UTC>
build_commit: <short hash of current HEAD>
deploy_recipe: deploy.md
active_groups: [<group slugs currently being tested>]
completed_groups: [<group slugs where all items passed>]
summary:
  total: <int>
  passed: <int>
  failed: <int>
  skipped: <int>
  untested: <int>
checkpoints:
  - commit: <short hash>
    timestamp: <ISO 8601>
    note: "<description>"
```

**groups/<name>.md** format:
```markdown
# Test Group: <Name>

## Items

### 1. <Item description>
- Status: UNTESTED | PASSED | FAILED | SKIPPED
- Build: <commit hash when tested>
- Tested: <ISO 8601 timestamp>
- Notes: <human's observation>
- Evidence: <failure description, if failed>
- Fix: <commit hash, if fixed>
```

---

## Phase 0: Deploy Discovery

Run this phase on **Init** only. On **Resume**, skip to Phase 3.

### Step 1: Check for existing deploy recipe

Use Glob to check for an existing deploy recipe:
```
Glob pattern: .context/test-session/deploy.md
```

Also check CLAUDE.md for a pointer:
```
Grep pattern: test_deploy_recipe|deploy_recipe|native_app_scheme|dev_server
File: CLAUDE.md
```

If a deploy recipe exists (local file or CLAUDE.md config), read it, confirm with
the user: "Found deploy recipe: `<command>`. Still correct?" If yes, proceed to
Phase 1.

### Step 2: Discover deploy patterns

If no recipe exists, search for common patterns using Glob:

```
Glob patterns (check each):
  Makefile
  package.json
  docker-compose.{yml,yaml}
  conductor-run.sh
  *.xcodeproj
  *.xcworkspace
```

For each pattern found:
- **Makefile:** `grep -E '^(dev|run|serve|start):' Makefile` for dev targets
- **package.json:** `grep -E '"(dev|start|serve)"' package.json` for npm scripts
- **docker-compose:** `docker compose up` is the likely command
- **Xcode project:** `xcodebuild -scheme <scheme> -configuration Debug build`

If patterns found, propose the recipe and ask for confirmation.

### Step 3: Ask the user

If nothing found (or patterns don't match):

"I couldn't find a dev build/run process. What command builds and runs your
project for testing? I'll save it so we can reuse it."

### Step 4: Save the recipe

Write `deploy.md` to `.context/test-session/`:

```markdown
# Deploy Recipe

Discovered: <timestamp>
Type: <web-app | native-app | cli | other>

## Build
```bash
<build command>
```

## Run
```bash
<run/launch command>
```

## Verify
```bash
<command to check if running, or "manual">
```
```

Then offer to add a pointer to CLAUDE.md:

"Want me to add a deploy recipe pointer to CLAUDE.md so this is available to
other skills too?"

If yes, append to CLAUDE.md:
```yaml
## Deploy Recipe
test_deploy_recipe: ".context/test-session/deploy.md"
```

---

## Phase 1: Test Plan Generation

### Step 1: Analyze the diff

Read the changes on this branch:

```bash
git diff origin/main --stat
git log origin/main..HEAD --oneline
```

If the diff is empty (no changes vs main), ask:
"No changes detected vs main. Want to provide a manual list of things to test?"

If the diff is large (>50 files), summarize and ask the user to scope:
"Large diff (N files). Which areas should we focus testing on?"

### Step 2: Read project context

Read CLAUDE.md and TODOS.md for project-specific context that informs what to test.

### Step 3: Generate grouped test plan

Analyze the diff content and generate test items grouped by feature area. Rules:
- Each group has 3-7 items
- Group by feature area, screen, or workflow (not by file)
- Items should be things a human needs to verify (subjective feel, visual correctness,
  interaction flow, real-world behavior)
- Do NOT include things that automated tests already cover
- Be specific: "Verify the login form shows an error on invalid password" not "Test login"

### Step 4: Present and approve

Present the plan via AskUserQuestion:

"Here's the test plan I generated from the diff. Review and tell me if you want to
add, remove, or modify any items."

Show each group with its items. Ask which groups to start with (user works on 1-3
at a time).

### Step 5: Write state

Create the session directory and write all files:

```bash
mkdir -p .context/test-session/groups
```

Write `session.yaml` and each `groups/<name>.md` file. All items start as UNTESTED.

---

## Phase 2: Test Execution Loop

This is the core loop. For each active group, present items one at a time.

### Present the next item

Read the current group file from disk (not from context). Find the first UNTESTED
item. Present it:

"**Auth group, item 3 of 7:** Verify the loading state after logout. Does the
app show a clean transition back to the login screen?

Pass / Fail / Skip / Add new item"

Wait for the user's response.

### On PASS

1. Update the item in the group file: `Status: PASSED`, `Build: <HEAD>`,
   `Tested: <now>`
2. Update session.yaml summary counts
3. Write both files to disk
4. Move to the next item

### On FAIL

1. Ask the user to describe what went wrong
2. Update the item: `Status: FAILED`, `Evidence: <user's description>`
3. Write to disk
4. Ask: "Want to fix this now, or continue testing the rest of the group?"

### On FIX NOW

**Group-level checkpoint:**

If this is the first fix in the current group, commit a checkpoint:

```bash
git add -u
git commit -m "test: checkpoint before fix (<group> group)"
```

Record the checkpoint in session.yaml. If the commit fails (clean tree), note
"working tree clean" and proceed.

**Implement the fix:**

The agent writes the code fix. This is pair testing: the human found the bug,
the agent fixes it.

**Commit the fix:**

```bash
git add -u
git commit -m "fix: <description> (pair-review item <N>)"
```

Record the fix commit in the item's metadata.

**Rebuild/redeploy:**

Read deploy.md and execute the build/run commands. If the build fails, report
the error and ask the user what to do.

**Update state:**

Mark the failed item as `Status: FAILED` with `Fix: <commit>` and
`Retest required: YES`. Write to disk.

**Continue testing:**

Present the same item again for retest. If it passes now, mark as PASSED.
If it fails again, repeat the fix cycle.

### On SKIP

1. Ask for a reason (optional)
2. Update: `Status: SKIPPED`, `Notes: <reason>`
3. Write to disk, move to next item

### On ADD ITEM

1. Ask: which group? what's the test item?
2. Append the new item to the group file as UNTESTED
3. Update session.yaml summary.total
4. Write to disk
5. Continue with the current item (don't jump to the new one)

### Group completion

When all items in a group are tested (PASSED, FAILED with fix, or SKIPPED):
1. Move the group from active_groups to completed_groups in session.yaml
2. Show a group summary: "Auth group complete: 5 passed, 1 fixed, 1 skipped"
3. If more active groups remain, move to the next one
4. If all active groups are done, ask: "Start the next group, or wrap up?"

---

## Phase 3: Resume

When `/pair-review resume` or `/pair-review status` is invoked.

### Step 1: Find existing state

Use the Glob tool to check for an existing session:

```
Glob pattern: .context/test-session/session.yaml
```

If the file exists, read it and proceed to Step 2.

If no state found: "No active test session found. Want to start a new one?"

### Step 2: Render dashboard

Read session.yaml and all group files. Display:

```
TEST SESSION: <project>
Branch: <branch> | Build: <commit> | Started: <date>

<GROUP1> (active):     3/7 passed, 1 failed (fixed), 0 skipped, 3 untested
<GROUP2> (active):     0/4 tested
<GROUP3>:              not started (5 items)

NEXT: <what to test next>
DEPLOY: <build command from deploy.md>
CHECKPOINTS: <N> saved
```

### Step 3: Continue or status-only

If this was `/pair-review status`, stop here.

If this was `/pair-review resume`, ask: "Continue where you left off, or start
fresh?" If continue, enter Phase 2 at the next untested item.

---

## Phase 4: Completion

When all groups are complete (or the user invokes `/pair-review done`).

### Step 1: Generate report

```markdown
## Pair Review Report

Branch: <branch>
Date: <date>
Duration: <time from started to now>

### Summary
- Total items: N
- Passed: N
- Failed + fixed: N
- Skipped: N

### Groups

#### <Group 1>
| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | <description> | PASSED | |
| 2 | <description> | PASSED (fixed in abc123) | <evidence> |
...

### Fixes Applied
| Commit | Item | Description |
|--------|------|-------------|
| abc123 | Auth #3 | Fixed loading state transition |
...

### Skipped Items
| Item | Reason |
|------|--------|
| <description> | <reason> |
```

### Step 2: Save report

Write report to `.context/test-session/report.md`.

### Step 3: Offer next steps

"Test session complete. N items tested, M fixes applied."

Options:
- "Commit the report to the repo"
- "Continue to /ship"
- "Done for now"

---

## Active Session Guard

On **Init**, before starting Phase 0, check for an existing active session:

```
Glob pattern: .context/test-session/session.yaml
```

If an active session exists, read it and present:

"You have an active test session (started <date>, <N>/<M> items tested).
What would you like to do?"

Options:
- A) Resume the existing session
- B) Start a new session (archives the old one)

If B, move the old session to a timestamped archive:
```bash
mv .context/test-session .context/test-session-archived-$(date -u +%Y%m%d-%H%M%S)
```

---

---

## Error Handling

### Deploy fails
Show stderr. Ask: "Build failed. Want to fix the build issue, or skip
rebuilding and continue testing?"

### State file corrupt
If YAML parsing fails on resume: "Session state appears corrupted. Want to
start fresh or try to recover?" On recover, attempt to read individual group
files (they're independent markdown, more resilient than YAML).

### Missing group file
If session.yaml references a group that has no corresponding file in groups/:
"Group '<name>' is listed in the session but its file is missing. Want to
recreate it with the items from session.yaml, or remove it from the session?"

### Clean working tree at checkpoint
If `git commit` fails because there's nothing to commit, skip the checkpoint
silently. Note "working tree clean" in session.yaml checkpoints.

### No diff to analyze
If `git diff origin/main` is empty: "No code changes detected. Want to provide a
manual list of things to test instead?"

### App not running after rebuild
If the verify command from deploy.md fails after rebuild: "App doesn't appear
to be running after rebuild. Check manually, then tell me when it's ready."

---

## Conversational Interface

In practice, users won't type `/pair-review pass 3`. They'll say things like:

- "that looks good" → PASS current item
- "yep" / "yes" / "works" → PASS current item
- "nope, the spinner is stuck" → FAIL with evidence "the spinner is stuck"
- "skip this one, can't test without VPN" → SKIP with reason
- "we should also check dark mode" → ADD ITEM
- "fix it" / "let's fix this" → enter FIX NOW flow
- "where was I" → RESUME
- "what's left" → STATUS
- "done" / "that's everything" → DONE

Map natural language to the appropriate action. When ambiguous, ask.
