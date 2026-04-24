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

## Preamble (run first)

```bash
_SKILL_SRC=$(readlink ~/.claude/skills/pair-review/SKILL.md 2>/dev/null)
_EXTEND_ROOT=$(dirname "$(dirname "$_SKILL_SRC")" 2>/dev/null)
if [ -n "$_EXTEND_ROOT" ] && [ -x "$_EXTEND_ROOT/bin/update-check" ]; then
  _UPD=$("$_EXTEND_ROOT/bin/update-check" 2>/dev/null || true)
  [ -n "$_UPD" ] && echo "$_UPD" || true
fi
```

If output shows `UPGRADE_AVAILABLE <old> <new>`: follow the **Inline upgrade flow** below.
If `JUST_UPGRADED <from> <to>`: tell user "Running gstack-extend v{to} (just updated!)" and continue.

### Inline upgrade flow

Check if auto-upgrade is enabled:
```bash
_AUTO=$("$_EXTEND_ROOT/bin/config" get auto_upgrade 2>/dev/null || true)
echo "AUTO_UPGRADE=${_AUTO:-false}"
```

**If `AUTO_UPGRADE=true`:** Skip asking. Log "Auto-upgrading gstack-extend v{old} → v{new}..." and run:
```bash
"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"
```
After upgrade, tell user: "Update installed. You're running the previous version for this session; next invocation will use v{new}."
If it fails, warn: "Auto-upgrade failed. Run `git -C $_EXTEND_ROOT pull && $_EXTEND_ROOT/setup` manually."

**Otherwise**, use AskUserQuestion:
- Question: "gstack-extend **v{new}** is available (you're on v{old}). Upgrade now?"
- Options: ["Yes, upgrade now", "Always keep me up to date", "Not now", "Never ask again"]

**If "Yes, upgrade now":** Run `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"`. Tell user: "Update installed. You're running the previous version for this session; next invocation will use v{new}."

**If "Always keep me up to date":**
```bash
"$_EXTEND_ROOT/bin/config" set auto_upgrade true
```
Tell user: "Auto-upgrade enabled." Then run `update-run`.

**If "Not now":** Write snooze state, then continue with the skill:
```bash
_SNOOZE_FILE=~/.gstack-extend/update-snoozed
_REMOTE_VER="{new}"
_CUR_LEVEL=0
if [ -f "$_SNOOZE_FILE" ]; then
  _SNOOZED_VER=$(awk '{print $1}' "$_SNOOZE_FILE")
  if [ "$_SNOOZED_VER" = "$_REMOTE_VER" ]; then
    _CUR_LEVEL=$(awk '{print $2}' "$_SNOOZE_FILE")
    case "$_CUR_LEVEL" in *[!0-9]*) _CUR_LEVEL=0 ;; esac
  fi
fi
_NEW_LEVEL=$((_CUR_LEVEL + 1))
[ "$_NEW_LEVEL" -gt 3 ] && _NEW_LEVEL=3
echo "$_REMOTE_VER $_NEW_LEVEL $(date +%s)" > "$_SNOOZE_FILE"
```
Note: `{new}` is the remote version from the `UPGRADE_AVAILABLE` output. Tell user the snooze duration (24h/48h/1 week).

**If "Never ask again":**
```bash
"$_EXTEND_ROOT/bin/config" set update_check false
```
Tell user: "Update checks disabled. Re-enable by editing `~/.gstack-extend/config` and changing `update_check=false` to `update_check=true`."

---

# /pair-review — Pair Testing Session Manager

You are a **pair testing partner**. The human provides judgment (does this feel
right? is this animation smooth? does this interaction make sense?). You provide
structure, memory, and the rebuild/redeploy loop.

**This is NOT autonomous QA.** You do not test the app yourself. You manage the
session: generate test plans, track progress, checkpoint before fixes, implement
fixes, rebuild, and help the human resume where they left off.

## Conductor Visibility Rule

Conductor shows only the last message before the agent stops. All intermediate
messages and tool calls are collapsed by default. This means:

1. **Every user-facing prompt MUST use AskUserQuestion** — this ensures the prompt
   is the last message and is always visible.
2. **Every AskUserQuestion MUST include an action receipt** — a one-line summary
   of all actions taken since the last user interaction. This is the user's only
   reliable confirmation that work was completed.
3. **Never rely on intermediate text output for important confirmations.** If the
   user needs to know something happened (bug parked, fix committed, build
   succeeded), it goes in the next AskUserQuestion's question text.

Action receipt format: emoji-free status line. Examples:
- "Item 2 passed. Saved."
- "Fixed in abc123. Build succeeded. Ready for retest."
- "Parked bug #3."

If multiple actions occurred since the last interaction, compose them:
- "Parked bug #3. Item 7 skipped. Auth group complete: 5 passed, 1 fixed, 1 skipped."

If no actions were taken (first prompt of session), omit the receipt.

---

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

All state lives in `.context/pair-review/` (gitignored, conductor-visible). This is
the single source of truth. No external state directories.

```bash
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
```

**State path:** `.context/pair-review/`

On every state change, write to `.context/pair-review/` immediately.

### File Format

```
pair-review/
  session.yaml          # Session metadata, active groups, deploy recipe
  deploy.md             # Discovered deploy recipe
  parked-bugs.md        # Bugs noticed during testing, not yet triaged
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
parked_bugs:
  total: <int>
  todos: <int>          # promoted to docs/TODOS.md
  this_branch: <int>    # still parked (fix after testing)
  fixed: <int>          # fixed during triage or Phase 2.5
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
Glob pattern: .context/pair-review/deploy.md
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

Write `deploy.md` to `.context/pair-review/`:

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
test_deploy_recipe: ".context/pair-review/deploy.md"
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

Read CLAUDE.md and docs/TODOS.md for project-specific context that informs what to test.

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
mkdir -p .context/pair-review/groups
```

Write `session.yaml` and each `groups/<name>.md` file. All items start as UNTESTED.

---

## Phase 2: Test Execution Loop

This is the core loop. For each active group, present items one at a time.

### Lookahead & Fast Path

To minimize wait time between items, **always pre-read the next UNTESTED item**
when presenting the current one. Show its description inline so the user can
start testing it immediately — they don't need to wait for the next prompt.

**Lookahead rule:** When reading the group file to find item N (current UNTESTED),
also identify item N+1 (next UNTESTED after N). Remember both descriptions.

**Fast path (PASS/SKIP):** After a PASS or SKIP, you already know item N+1 from
the lookahead. Update state and present N+1 **without re-reading the group file**.
Read the group file once to identify item N+2 for the new lookahead, then edit it
to mark item N.

**Compaction fallback:** If you do not have the lookahead cached (e.g., after
context compaction or session resume), fall back to a full read of the group file
before presenting the next item. The fast path is an optimization, not a requirement.

### Present the next item

Read the current group file from disk (not from context). Find the first UNTESTED
item (item N). Also find the second UNTESTED item (item N+1) — the lookahead.
Present via AskUserQuestion:

- **Question:** "[Action receipt if applicable]\n\n**[Group] [N]/[Total]:** [Item description]\n\n_Next up: [N+1]. [Next item description]_"
- **Options:** ["Pass", "Fail", "Skip", "Park a bug", "Add item", "Batch: next 3"]

If item N is the last UNTESTED in the group, replace the _Next up:_ line with
_Last item in this group._

Use this exact AskUserQuestion format every time. Do not present test items as
plain text, yes/no questions, or lettered multiple choice. The options array is
the canonical interface.

Wait for the user's response.

### On PASS

**Fast path** — use the cached lookahead to avoid re-reading the group file:

1. Edit the group file: mark item N as `Status: PASSED`, `Build: <HEAD>`,
   `Tested: <now>`. While the file is open, identify item N+2 (new lookahead).
2. Edit session.yaml summary counts.
3. Write both edits in **parallel** (two Edit tool calls in the same turn).
4. Present item N+1 (from the cached lookahead) immediately via AskUserQuestion
   with item N+2 as the new lookahead preview. Receipt: "Item N passed."

### On FAIL

1. Update the item: `Status: FAILED`, `Evidence: <user's description>`
   (If the user's response includes the failure description, use it directly.
   If they just said "fail" with no details, ask via AskUserQuestion:
   "**[Group] [N]/[Total] — What went wrong?**" with options: ["Let me describe it"])
2. Write to disk
3. Ask via AskUserQuestion:
   - Question: "**[Group] [N]/[Total] FAILED:** [evidence summary]\n\nFix now or keep testing?"
   - Options: ["Fix now", "Continue testing"]

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

Present the same item again for retest via AskUserQuestion:
- Question: "Fixed in [commit]. Build [succeeded/failed]. Retest:\n\n**[Group] [N]/[Total]:** [Item description]"
- Options: ["Pass", "Fail", "Skip", "Park a bug", "Add item"]

If it passes now, mark as PASSED. If it fails again, repeat the fix cycle.

### On SKIP

**Fast path** — same as PASS, use the cached lookahead:

1. Edit the group file: mark item N as `Status: SKIPPED`, `Notes: <reason if provided>`.
   While the file is open, identify item N+2 (new lookahead).
2. Edit session.yaml summary counts.
3. Write both edits in **parallel** (two Edit tool calls in the same turn).
4. Present item N+1 (from the cached lookahead) immediately via AskUserQuestion
   with item N+2 as the new lookahead preview. Receipt: "Item N skipped."

### On ADD ITEM

1. Ask: which group? what's the test item?
2. Append the new item to the group file as UNTESTED
3. Update session.yaml summary.total
4. Write to disk
5. Continue with the current item (don't jump to the new one)

### On PARK

Available anytime during Phase 2 (testing loop) and FIX NOW flows. When the user
says something like "park this", "note a bug", "not related but...", or describes
a bug that is clearly unrelated to the current test item:

1. If the user didn't include a description, ask: "What's the bug?"
2. Append a new entry to `.context/pair-review/parked-bugs.md`.
   Determine N by reading the file and incrementing the highest existing number
   (or 1 if the file is empty/new).
   ```markdown
   ## <N>. <Bug description>
   - Noticed during: <current group slug>, item <current item number>
   - Timestamp: <ISO 8601 UTC>
   - Description: <user's full description>
   - Status: PARKED
   ```
   If `parked-bugs.md` doesn't exist yet, create it with a `# Parked Bugs` header.
   If parking before any testing starts, use "before testing" for "Noticed during."
3. Update session.yaml `parked_bugs.total` count
4. Write to disk
5. Return to whatever was in progress. The next AskUserQuestion receipt will
   read: "Parked bug #N." followed by the current test item or fix prompt.

**Do NOT classify the bug at park time.** Classification happens at group completion.

### On BATCH

When the user selects "Batch: next 3", switch to batch presentation for faster
throughput. This reduces round-trips by 3x for rapid testing sessions.

1. Read the group file. Collect the next 3 UNTESTED items (or fewer if the group
   is nearly done). Also identify the item after the batch (the post-batch lookahead).
2. Present all items in a single AskUserQuestion:
   - **Question:** "[Action receipt if applicable]\n\n**[Group] — Batch [start]-[end]/[Total]:**\n\n[N]. [Item description]\n[N+1]. [Item description]\n[N+2]. [Item description]\n\n_Next up: [N+3]. [Post-batch item description]_\n\nReport results for each item. Examples:\n`all pass` · `1 pass, 2 fail: button misaligned, 3 skip` · `2 fail: crashes on tap`"
   - **Options:** ["All pass", "Report results", "Park a bug", "Back to single mode"]

3. **On "All pass"**: Mark all batch items as PASSED in the group file, update
   session.yaml counts, write both in parallel. Present the next batch (or next
   single item if fewer than 3 remain).

4. **On "Report results"**: The user clicked a button, so you don't have results yet.
   Ask a follow-up via AskUserQuestion:
   - Question: "Enter results for each item. Examples:\n`all pass` · `1 pass, 2 fail: button misaligned, 3 skip` · `2 fail: crashes on tap`"
   - Options: ["Submit"]
   Parse the user's free-text response. Map each item to PASS, FAIL (with evidence),
   or SKIP. For any FAILs, follow the standard FAIL flow (ask "Fix now or continue
   testing?") one at a time in item order after recording all results.

5. **On "Back to single mode"**: Return to single-item presentation with lookahead
   at the next UNTESTED item.

**Minimum threshold:** If fewer than 2 UNTESTED items remain when "Batch: next 3"
is selected, stay in single-item mode. Tell the user: "Only N item(s) left —
staying in single mode."

After a batch, if remaining UNTESTED items >= 3, offer another batch. If < 3,
fall back to single-item presentation with lookahead.

### Group completion

When all items in a group are tested (PASSED, FAILED with fix, or SKIPPED):
1. Move the group from active_groups to completed_groups in session.yaml
2. Write to disk
3. Present group summary via AskUserQuestion:
   - Question: "[Receipt from last action]\n\n**[Group] complete:** [N] passed, [M] fixed, [K] skipped."
   - Options vary by state:
     - If parked bugs from this group exist: ["Triage parked bugs", "Skip triage, next group"]
     - If no parked bugs and more groups remain: ["Start next group"]
     - If all groups done and parked bugs remain: ["Start bug fix queue"]
     - If all groups done and no parked bugs: ["Generate report", "Add more tests"]
4. On "Triage parked bugs": run **Group completion triage** (see below)
5. After triage (or if skipped), if more active groups remain, move to the next one
6. If all active groups are done:
   a. Run **Phase 2.5** if any parked bugs remain with Status: PARKED
   b. Then proceed to Phase 4

### Group completion triage

After the group summary, check `parked-bugs.md` for entries with Status: PARKED that
were noticed during the just-completed group. If none, skip triage silently.

For each parked bug from this group, the skill recommends a classification based on
whether the bug relates to the branch's changes or upcoming test groups. Present each
bug via AskUserQuestion:

- Question: "[Receipt from prior triage action if any]\n\n**Parked bug #N:** [description]\nNoticed during: [group], item [item]\n\nRecommendation: [agent's classification reasoning — e.g. 'This looks like a cross-branch issue because...' or 'This relates to upcoming testing in the [group] group because...']\n\n**This bug surfaced during [group] testing. Fixing before [group] ships keeps the Group closure tight. Defer only if it's truly cross-branch.**"
- Options: ["Fix now (recommended)", "Send to TODOS.md", "Stay parked"]

**Defer nudge (E4):** "Fix now" is listed first intentionally — the default
framing biases toward closing out the Group that surfaced the bug. Deferral to
TODOS.md is an escape hatch for genuinely cross-branch bugs, not the easy path.

Behavior for each option:
- **Fix now** — blocks upcoming groups or relates to current area.
  1. Checkpoint: `git add -u` then `git commit -m "test: checkpoint before parked bug fix"`
     (skip if working tree is clean)
  2. The agent implements the fix
  3. Commit: `git add -u` then `git commit -m "fix: <description> (pair-review parked bug #<N>)"`
  4. Rebuild/redeploy using deploy.md
  5. Ask the user to verify the fix
  6. Update the bug's status to `FIXED` and record the fix commit hash
- **Send to TODOS.md** — cross-branch bug, fix on another branch later.
  Append the bug to the `## Unprocessed` section of TODOS.md (root or docs/,
  whichever exists). If no `## Unprocessed` section exists, create it at the
  end of the file. Use the rich format per `docs/source-tag-contract.md`:

  ```markdown
  ## Unprocessed

  ### [pair-review:group=<group-slug>,item=<item-index>] <Bug title>
  - **Why:** <description from parked-bugs.md>
  - **Noticed during:** <group>, item <item>
  - **Context:** Found on branch <branch> (<date>). Parked during /pair-review.
  - **Effort:** ? (user triages in /roadmap)
  ```

  Where `<group-slug>` is the slug of the group the user is currently testing
  (from session.yaml's `active_groups`). This origin tag lets /roadmap route
  the bug back to the Group that surfaced it (closure bias). For bugs parked
  BEFORE testing started (where there's no active group yet), use
  `group=pre-test` — /roadmap interprets this as "route to PRIMARY in-flight
  Group's Pre-flight."

  If the section already exists with other items, append the new item to it
  (new `###` heading block at the end). Do NOT attempt to classify or organize
  the bug into Groups/Tracks — that is /roadmap's job during triage mode.

  Commit the TODOS.md change separately: stage the TODOS.md file you wrote to
  (root or docs/, whichever you used) then commit with
  `git commit -m "chore: add parked bug to TODOS.md (<description>)"`.
  Update the bug's status to `DEFERRED_TO_TODOS`.
- **Stay parked** — this-branch, non-blocking. Remains for Phase 2.5.

Update `session.yaml` parked_bugs counts after each triage decision. Write to disk.

---

## Phase 2.5: Post-Testing Fix Queue

After all test groups are complete and group-completion triage is done, check
`parked-bugs.md` for ALL entries with Status: PARKED (regardless of which group
they were noticed during, including bugs parked before testing started).

If none remain, skip to Phase 4.

If parked bugs remain, present each via AskUserQuestion (same format as group-completion
triage):

- Question: "[Receipt from prior action if any]\n\n**Parked bug #N:** [description]\nNoticed during: [group], item [item]\n\nRecommendation: [agent's classification]\n\n**Deferring this bug keeps it in the roadmap's closure debt for [group]. Fix now if it's on-branch or blocks the current Group's ship.**"
- Options: ["Fix now (recommended for on-branch bugs)", "Send to TODOS.md", "Skip"]

Behavior for each option:
- **Fix now** — checkpoint, agent implements fix, commit, rebuild, user verifies, mark FIXED
- **Send to TODOS.md** — cross-branch, append to `## Unprocessed` section of TODOS.md
  using the rich format per `docs/source-tag-contract.md`:
  ```markdown
  ### [pair-review:group=<group-slug>,item=<item-index>] <Bug title>
  - **Why:** <description>
  - **Noticed during:** <group>, item <item>
  - **Context:** Found on branch <branch> (<date>). Parked during /pair-review Phase 2.5.
  - **Effort:** ? (user triages in /roadmap)
  ```
  Use `group=pre-test` for bugs parked before any group started.
  Create the section if it doesn't exist. Commit separately, mark DEFERRED_TO_TODOS.
- **Skip** — not worth fixing now, mark SKIPPED

If a fix fails (build error), use the existing deploy error handling: present the
error via AskUserQuestion with options: ["Fix the build issue", "Skip this bug"].

After all parked bugs are processed (or the user says to stop), proceed to Phase 4.

---

## Phase 3: Resume

When `/pair-review resume` or `/pair-review status` is invoked.

### Step 1: Find existing state

Use the Glob tool to check for an existing session:

```
Glob pattern: .context/pair-review/session.yaml
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

PARKED: <N> bugs parked (<M> triaged, <K> remaining)
NEXT: <what to test next>
DEPLOY: <build command from deploy.md>
CHECKPOINTS: <N> saved
```

### Step 3: Continue or status-only

If this was `/pair-review status`, stop here.

If this was `/pair-review resume`, present via AskUserQuestion:
- Question: "[Dashboard from Step 2 above]\n\nContinue where you left off, or start fresh?"
- Options: ["Continue testing", "Start fresh"]

If continue, enter Phase 2 at the next untested item.

---

## Phase 4: Completion

When all groups are complete (or the user invokes `/pair-review done`).

**Early termination check:** If `/pair-review done` is invoked and there are parked
bugs with Status: PARKED, prompt: "You have N parked bugs that haven't been triaged.
Triage them before wrapping up?" If yes, run group-completion triage on all remaining
parked bugs (run triage on all remaining PARKED bugs regardless of which group
they were noticed during). If no, mark remaining bugs as Status: SKIPPED and proceed.

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

### Parked Bugs
| # | Bug | Noticed During | Outcome |
|---|-----|----------------|---------|
| 1 | <description> | <group>, item <N> | FIXED (abc123) / DEFERRED_TO_TODOS / SKIPPED |
```

### Step 2: Save report

Write report to `.context/pair-review/report.md`.

### Step 3: Offer next steps

Before presenting options, determine the recommended next step:

1. Run `gstack-review-read` and check its output.
2. If the output is **not** "NO_REVIEWS", a review exists for this branch — recommend `/ship`.
3. If the output **is** "NO_REVIEWS", check the diff size: run `git diff --stat main...HEAD` and count changed lines (insertions + deletions).
   - **≤ 30 lines changed** (trivial): recommend `/ship` — the changes are minor enough to skip review.
   - **> 30 lines changed**: recommend `/review` first.

Present via AskUserQuestion:

**If recommending `/review`:**
- Question: "**Test session complete.** [N] items tested, [M] fixes applied, [K] bugs parked.\n\n[One-line summary of parked bug outcomes if any]\n\nYou haven't run `/review` on this branch yet and there are meaningful code changes — worth a quick review before shipping."
- Options: ["Continue to /review", "Skip review, continue to /ship", "Commit the report to the repo", "Done for now"]

**If recommending `/ship`:**
- Question: "**Test session complete.** [N] items tested, [M] fixes applied, [K] bugs parked.\n\n[One-line summary of parked bug outcomes if any]"
- Options: ["Continue to /ship", "Commit the report to the repo", "Done for now"]

---

## Active Session Guard

On **Init**, before starting Phase 0, check for an existing active session:

```
Glob pattern: .context/pair-review/session.yaml
```

If an active session exists, read it and present via AskUserQuestion:

- Question: "You have an active test session (started [date], [N]/[M] items tested). What would you like to do?"
- Options: ["Resume the existing session", "Start a new session (archives the old one)"]

If B, move the old session to a timestamped archive:
```bash
mv .context/pair-review .context/pair-review-archived-$(date -u +%Y%m%d-%H%M%S)
```

---

---

## Error Handling

### Deploy fails
Present via AskUserQuestion:
- Question: "Build failed.\n\n```\n[stderr output]\n```"
- Options: ["Fix the build issue", "Skip rebuild, continue testing"]

### State file corrupt
Present via AskUserQuestion:
- Question: "Session state appears corrupted (YAML parsing failed)."
- Options: ["Start fresh", "Try to recover from group files"]

On recover, attempt to read individual group files (they're independent
markdown, more resilient than YAML).

### Missing group file
Present via AskUserQuestion:
- Question: "Group '[name]' is listed in the session but its file is missing."
- Options: ["Recreate from session.yaml", "Remove from session"]

### Clean working tree at checkpoint
If `git commit` fails because there's nothing to commit, skip the checkpoint
silently. Note "working tree clean" in session.yaml checkpoints.

### No diff to analyze
If `git diff origin/main` is empty: "No code changes detected. Want to provide a
manual list of things to test instead?"

### App not running after rebuild
If the verify command from deploy.md fails after rebuild: "App doesn't appear
to be running after rebuild. Check manually, then tell me when it's ready."

### Parked bugs file missing
If session.yaml shows parked_bugs.total > 0 but `parked-bugs.md` doesn't exist
on resume: "Parked bugs were recorded in the session but the file is missing.
Starting with 0 parked bugs." Reset parked_bugs counts in session.yaml.

### Empty parked bugs at group completion
If no parked bugs have Status: PARKED when a group completes, skip triage
silently. Do not mention parked bugs if there are none.

---

## Conversational Interface

The primary interface is AskUserQuestion with explicit options (Pass, Fail, Skip,
Park a bug, Add item). The user clicks a button or types via the "Other" option.

When the user types free-text (via "Other" or as a direct message), map natural
language to the appropriate action. In practice, users will say things like:

- "that looks good" → PASS current item
- "yep" / "yes" / "works" → PASS current item
- "nope, the spinner is stuck" → FAIL with evidence "the spinner is stuck"
- "skip this one, can't test without VPN" → SKIP with reason
- "we should also check dark mode" → ADD ITEM
- "park this" / "note a bug" / "not related but..." / "unrelated bug" → PARK
- "fix it" / "let's fix this" → enter FIX NOW flow
- "batch" / "give me a few" / "speed up" / "faster" → enter BATCH mode
- "one at a time" / "slow down" / "single mode" → exit BATCH mode
- "all pass" / "all good" → if in batch mode, PASS all items in current batch; if in single mode, PASS current item
- "where was I" → RESUME
- "what's left" → STATUS
- "done" / "that's everything" → DONE

Map natural language to the appropriate action. When ambiguous, ask.

---

## Completion Status Protocol

When completing a skill workflow, report status using one of:

- **DONE** — All steps completed successfully. Evidence provided for each claim.
- **DONE_WITH_CONCERNS** — Completed, but with issues the user should know about. List each concern.
- **BLOCKED** — Cannot proceed. State what is blocking and what was tried.
- **NEEDS_CONTEXT** — Missing information required to continue. State exactly what you need.

For pair-review specifically: map per-item states (`UNTESTED`, `PASSED`, `FAILED`, `FIXED`, `SKIPPED`, `PARKED`) and per-group statuses to the session-level enum at `/pair-review done` time. Rollup rule:

- All groups complete, no parked bugs and no failures → **DONE**
- Complete with items SKIPPED, PARKED, or with deferred bugs → **DONE_WITH_CONCERNS** (list them)
- A group cannot proceed (deploy broken, can't reach the app, missing credentials) → **BLOCKED**
- Session interrupted or resumed without required context (lost `.context/pair-review/` state, for example) → **NEEDS_CONTEXT**

### Escalation

It is always OK to stop and say "this is too hard for me" or "I'm not confident in this result." Bad work is worse than no work. You will not be penalized for escalating.

- If you have attempted a fix 3 times without success, STOP and escalate (park the bug, move on, surface at group rollup).
- If you are uncertain about a security-sensitive change, STOP and escalate.
- If the scope of work exceeds what you can verify, STOP and escalate.

Escalation format:

```
STATUS: BLOCKED | NEEDS_CONTEXT
REASON: [1-2 sentences]
ATTEMPTED: [what you tried]
RECOMMENDATION: [what the user should do next]
```

## Confusion Protocol

When you encounter high-stakes ambiguity during this workflow:

- Two plausible interpretations of a user request, with different outcomes (e.g., "fix it" could mean patch the current bug or re-derive the test from scratch).
- A request that contradicts the existing session plan and you're unsure which to follow.
- A destructive or irreversible operation where the scope is unclear (e.g., "reset" — reset this group? the whole session? discard local changes?).
- Missing context that would change your approach significantly (unknown test target, ambiguous failure mode).

STOP. Name the ambiguity in one sentence. Present 2-3 options with tradeoffs. Ask the user via AskUserQuestion. Do not guess on decisions that affect the test record or the user's code.

This does NOT apply to routine pass/fail decisions, obvious next-item moves, or small clarifications.

## GSTACK REVIEW REPORT

Emit a REPORT table at two points in every `/pair-review` session:

1. **At each group checkpoint** (after the group's items are all resolved, before moving to the next group): a per-group mini-table with a single row for the just-completed group.
2. **At session-done** (at `/pair-review done`): a rollup table with one row per group covered in the session.

### Per-group mini-table (at group checkpoint)

Template:

```markdown
## GSTACK REVIEW REPORT — <group-name> group

| Group | Trigger | Why | Runs | Status | Findings |
|-------|---------|-----|------|--------|----------|
| <group-name> | `/pair-review` | Manual test coverage | 1 | <STATUS> | <passed>/<total> passed, <skipped> skipped, <parked> parked |

**VERDICT:** <STATUS> — <one-line summary>
```

### Session-done rollup table (at `/pair-review done`)

Template:

```markdown
## GSTACK REVIEW REPORT — session rollup

| Group | Trigger | Why | Runs | Status | Findings |
|-------|---------|-----|------|--------|----------|
| <group-1> | `/pair-review` | Manual test coverage | 1 | <STATUS-1> | <findings-1> |
| <group-2> | `/pair-review` | Manual test coverage | 1 | <STATUS-2> | <findings-2> |
| ... | ... | ... | ... | ... | ... |

**VERDICT:** <SESSION_STATUS> — <one-line session summary>
```

Substitutions:

- `<STATUS>` / `<STATUS-n>` is the Completion Status Protocol enum: `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT`.
- `<SESSION_STATUS>` is the rollup across all groups: DONE if all groups DONE, DONE_WITH_CONCERNS if any group had skips/parks/deferred fixes, BLOCKED if any group was blocked.
- Findings cells come from the group's item state tally (`PASSED`, `FAILED`, `FIXED`, `SKIPPED`, `PARKED`). Prefer compact form like "6/7 passed, 1 skipped (VPN), 1 parked".
- `<one-line summary>` names the concrete group outcome: "6/7 passed, moving to next group", "deploy broken after fix attempt", "1 parked bug carried forward to Payments", etc.

Verdict-to-status mapping:

- All items in group are PASSED or FIXED → group "DONE — all <N> items pass".
- Group has SKIPPED or PARKED items, or deferred bugs → group "DONE_WITH_CONCERNS — <specifics>".
- Group could not proceed (deploy broken, app unreachable, missing credentials) → "BLOCKED — <reason>".
- Session state malformed or `.context/pair-review/` lost on resume → "NEEDS_CONTEXT — <what is missing>".

The mini-table runs at each group boundary so the Conductor action-receipt pattern still shows a clean summary in the collapsed view. The rollup runs once at session-done.
