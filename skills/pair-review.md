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
_SKILL_SRC=$(readlink ~/.claude/skills/pair-review/SKILL.md 2>/dev/null \
           || readlink .claude/skills/pair-review/SKILL.md 2>/dev/null)
_EXTEND_ROOT=""
[ -n "$_SKILL_SRC" ] && _EXTEND_ROOT=$(dirname "$(dirname "$_SKILL_SRC")")
if [ -n "$_EXTEND_ROOT" ] && [ -x "$_EXTEND_ROOT/bin/update-check" ]; then
  _UPD=$("$_EXTEND_ROOT/bin/update-check" 2>/dev/null || true)
  [ -n "$_UPD" ] && echo "$_UPD" || true
fi
```

If output shows `UPGRADE_AVAILABLE <old> <new>`: follow the **Inline upgrade flow** below.
If `JUST_UPGRADED <from> <to>`: tell user "Running gstack-extend v{to} (just updated!)" and continue.

<!-- SHARED:upgrade-flow -->
### Inline upgrade flow

Check if auto-upgrade is enabled:
```bash
_AUTO=$("$_EXTEND_ROOT/bin/config" get auto_upgrade 2>/dev/null || true)
echo "AUTO_UPGRADE=${_AUTO:-false}"
```

Read `bin/update-run`'s output before reporting anything: a literal `UPGRADE_OK <old> <new>` line means success. **Treat absent `UPGRADE_OK` as failure** — an `UPGRADE_FAILED <reason>` line, or no recognizable result line at all, both count as failure. Never report success without `UPGRADE_OK`.

**If `AUTO_UPGRADE=true`:** Skip asking. Log "Auto-upgrading gstack-extend v{old} → v{new}..." and run:
```bash
"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"
```
- On `UPGRADE_OK <old> <new>`: tell user "Update installed (v{old} → v{new}). You're running the previous version for this session; next invocation will use v{new}." Use the versions from the `UPGRADE_OK` line.
- On failure: tell user "Auto-upgrade failed: {reason}. Run `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"` to retry." Continue with the skill.

**Otherwise**, use AskUserQuestion:
- Question: "gstack-extend **v{new}** is available (you're on v{old}). Upgrade now?"
- Options: ["Yes, upgrade now", "Always keep me up to date", "Not now", "Never ask again"]

**If "Yes, upgrade now":** Run `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"`.
- On `UPGRADE_OK <old> <new>`: tell user "Update installed (v{old} → v{new}). You're running the previous version for this session; next invocation will use v{new}."
- On failure: tell user "Upgrade failed: {reason}. Run `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"` to retry." Continue with the skill.

**If "Always keep me up to date":** Run `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"` first. **Only on a confirmed `UPGRADE_OK <old> <new>`, enable auto-upgrade:**
```bash
"$_EXTEND_ROOT/bin/config" set auto_upgrade true
```
Then tell user "Update installed (v{old} → v{new}). Auto-upgrade enabled — future updates install automatically." On failure, do **not** enable auto-upgrade; tell user "Upgrade failed: {reason}. Auto-upgrade not enabled. Run `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"` to retry." Continue with the skill.

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
<!-- /SHARED:upgrade-flow -->

<!-- SHARED:telemetry-preamble -->
## Telemetry (preamble — run after the upgrade-flow block above)

Marks each skill activation in `~/.gstack/analytics/skill-usage.jsonl` with `source:gstack-extend` (and an `extend:<skill>` name) so mind-meld retro can attribute activity across both ecosystems. The first line sets the per-skill name; the rest is byte-identical across all gstack-extend skills (locked by `tests/skill-protocols.test.ts`).

After running, note the `GE_TELEMETRY:` echo line — paste the `session=` and `start=` values into the epilogue block at skill-done time.

```bash
_GE_SKILL="extend:pair-review"
_GE_TEL=$(~/.claude/skills/gstack/bin/gstack-config get telemetry 2>/dev/null || true)
_GE_TEL_START=$(date +%s)
_GE_SESSION_ID="$$-$_GE_TEL_START-$RANDOM"
if [ "${_GE_TEL:-off}" != "off" ]; then
  mkdir -p ~/.gstack/analytics
  _GE_REPO_TOP=$(git rev-parse --show-toplevel 2>/dev/null)
  _GE_REPO=$(basename "${_GE_REPO_TOP:-unknown}")
  _GE_GVER=$(cat ~/.claude/skills/gstack/VERSION 2>/dev/null | tr -d '[:space:]' || echo "unknown")
  _GE_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  printf '%s\n' '{"skill":"'"$_GE_SKILL"'","ts":"'"$_GE_TS"'","repo":"'"$_GE_REPO"'","source":"gstack-extend"}' >> ~/.gstack/analytics/skill-usage.jsonl 2>/dev/null || true
  echo "GE_TELEMETRY: session=$_GE_SESSION_ID start=$_GE_TEL_START"
fi
```
<!-- /SHARED:telemetry-preamble -->

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

State lives in two scopes — a project-wide dir and a per-branch dir under it.
Sessions are keyed by branch, so multiple branches (in different Conductor
workspaces or on different machines) can each have their own active session
without trampling each other.

- `<PROJECT_DIR>` = `${GSTACK_STATE_ROOT:-$HOME/.gstack}/projects/<slug>/pair-review/`
  Project-wide, branch-agnostic. Holds `deploy.md` (deploy recipe is the same
  regardless of branch) and the `branches/` + `archives/` subdirs.
- `<SESSION_DIR>` = `<PROJECT_DIR>/branches/<sanitized-branch>/`
  Per-branch session state: `session.yaml`, `groups/`, `parked-bugs.md`, `report.md`.

Resolve both at the start of every bash block that touches state:

```bash
_SKILL_SRC=$(readlink ~/.claude/skills/pair-review/SKILL.md 2>/dev/null \
           || readlink .claude/skills/pair-review/SKILL.md 2>/dev/null)
_EXTEND_ROOT=$(dirname "$(dirname "$_SKILL_SRC")" 2>/dev/null)
source "$_EXTEND_ROOT/bin/lib/session-paths.sh"
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
PROJECT_DIR=$(session_dir pair-review)
SESSION_DIR=$(session_dir pair-review "$BRANCH")
echo "PROJECT_DIR=$PROJECT_DIR"
echo "SESSION_DIR=$SESSION_DIR"
echo "BRANCH=$BRANCH"
```

Throughout the rest of this skill, `<SESSION_DIR>` and `<PROJECT_DIR>` in path
expressions mean the resolved values above. When invoking Glob/Read/Write/Edit,
substitute the concrete absolute path printed by the bash block.

### File Format

```
pair-review/                                  # <PROJECT_DIR>
  deploy.md                                   # Discovered deploy recipe (project-wide)
  branches/
    <sanitized-branch>/                       # <SESSION_DIR> — one per active branch
      session.yaml                            # Session metadata, active groups, deploy recipe
      parked-bugs.md                          # Bugs noticed during testing, not yet triaged
      groups/
        auth.md                               # Test group with items, status, evidence
        onboarding.md                         # Another group
      report.md                               # Written at /pair-review done
  archives/
    <sanitized-branch>-<ts>/                  # Past sessions per branch
      ...
```

**Terminal-passed statuses**: PASSED or PASSED_BY_COVERAGE. Every reference below
to "passed" filtering — group completion, summary counters, dashboard, resume
lookahead, per-item table rendering — means both statuses unless explicitly
narrowed to direct PASSED. Use the phrase `terminal-passed statuses` when
referring to this set; a `tests/skill-protocols.test.ts` invariant asserts the
canonical definition exists and that the phrase appears at multiple filter
sites (≥4 occurrences), so a future edit that drops it from a filter site
trips the test.

**session.yaml** fields:
```yaml
project: <project name from CLAUDE.md or directory>
branch: <current branch>
started: <ISO 8601 UTC>
last_active: <ISO 8601 UTC>
build_commit: <short hash of current HEAD>
deploy_recipe: deploy.md
active_groups: [<group slugs currently being tested>]
completed_groups: [<group slugs where all items reached terminal-passed statuses>]
summary:
  total: <int>
  passed: <int>                # INCLUSIVE — counts PASSED + PASSED_BY_COVERAGE
  passed_by_coverage: <int>    # sub-count of passed
  failed: <int>
  skipped: <int>
  untested: <int>
  bundles_offered: <int>       # count of bundle prompts shown
  bundles_accepted: <int>      # user picked "All pass"
  bundles_rejected: <int>      # user picked "Mark individually"
parked_bugs:
  total: <int>
  todos: <int>          # promoted to docs/TODOS.md
  this_branch: <int>    # still parked (fix after testing)
  fixed: <int>          # fixed during triage or Phase 2.5
checkpoints:
  - commit: <short hash>
    timestamp: <ISO 8601>
    note: "<description>"
coverage_warnings:      # entries logged when validation drops edges
  - phase: inference | resume
    rule: cycle | self-reference | existence | intra-group
    edge: "<source-item> -> <target-item>"
    note: <short human-readable explanation>
```

**groups/<name>.md** format:
```markdown
# Test Group: <Name>

## Items

### 1. <Item description>
- Status: UNTESTED | PASSED | PASSED_BY_COVERAGE | FAILED | SKIPPED
- Build: <commit hash when tested>
- Tested: <ISO 8601 timestamp>
- Notes: <human's observation>             # human-authored only; machine never writes
- Evidence: <failure description, if failed>
- Fix: <commit hash, if fixed>
- Covers: [<item-indices>]                 # optional; intra-group item indices this item verifies-by-action
- CoverageNote: <text>                     # machine-authored coverage annotation; never overwrites Notes
```

`PASSED_BY_COVERAGE` exists as a distinct status (rather than reusing `PASSED`) so
the FAIL handler can find and demote *only* items that were resolved via
bundle-confirmation, not items that were directly tested. Directly-`PASSED` items
have independent evidence and stay `PASSED` regardless of what happens to other
items in the group. Without this distinction, a single covering-item failure
would silently invalidate every previously-passed item that happened to be in
any `Covers:` list — which would weaken integrity instead of preserving it.

**Transitive coverage is explicitly NOT supported in v1.** If item 1 covers item
2 and item 2 covers item 3, passing item 1 does NOT auto-cover item 3. Bundle
prompts and FAIL-time demotion consider only **direct** edges in the just-passed
or just-failed item's `Covers:` list.

---

## Phase 0: Deploy Discovery

Run this phase on **Init** only. On **Resume**, skip to Phase 3.

### Step 1: Check for existing deploy recipe

Use Glob to check for an existing deploy recipe. Deploy recipe lives at the
project level (one per project, not per branch):
```
Glob pattern: <PROJECT_DIR>/deploy.md
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

Write `deploy.md` to `<PROJECT_DIR>/` (project-level, shared across branches):

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
test_deploy_recipe: "~/.gstack/projects/<slug>/pair-review/deploy.md"
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

### Step 3.5: Infer coverage hints (Covers metadata)

While generating items, attach an optional `Covers:` field to any item that
plausibly verifies another item in the same group via a single user action.
This lets Phase 2 bundle confirmation prompts and avoid redundant per-item
clicks for items that one action already demonstrated.

**Inference heuristics** — attach `Covers: [N, M]` to item X when ANY of these
hold for an item-pair (X, Y) in the same group:

1. **Same-prerequisite-action**: Y's verification implicitly requires the user
   to have done what X tests. ("Verify logged-in homepage renders" covers
   "Verify session cookie is set" if both follow a sign-in.)
2. **Strict subset**: X tests a feature; Y tests a sub-state of that feature
   with no additional setup. ("Verify the form submits" covers "Verify the
   submit button is enabled when fields are valid.")
3. **Same observation, different framing**: X and Y describe the same
   observable state from different angles. ("Item appears in the list" covers
   "Item count increments.")

Heuristics that do **not** justify Covers links: shared module/file, shared
test fixture, semantic adjacency, "they feel related." The agent must be able
to articulate the heuristic match in one sentence; if it can't, no link.

**Coverage is intra-group only.** Cross-group `Covers:` links are out of scope.

**Validation rules** — every inferred (and later, user-edited) Covers graph must
pass these:

1. **No self-reference**: `Covers:` may not contain its own item index.
2. **No cycles**: directed graph induced by `Covers:` edges must be acyclic.
3. **Existence**: every target index must refer to an existing item in the
   same group.
4. **Intra-group**: no cross-group references (enforced by the integer-only
   schema — group filenames are not referenceable).

Failure handling — **deterministic per rule**:
- **Self-reference / Existence / Intra-group** — drop the single offending edge
  (the (source, target) pair that failed).
- **Cycle** — find the strongly connected component (SCC); drop the edge in
  the SCC whose source has the highest item index (tie-break: highest target
  index). Deterministic and testable.

At inference (plan time), apply automatically and log dropped edges to
`coverage_warnings:` in session.yaml with `phase: inference`. Inference runs
ONLY at Phase 1 plan generation; resume never re-infers.

### Step 4: Present and approve

Present the plan via AskUserQuestion:

"Here's the test plan I generated from the diff. Review and tell me if you want to
add, remove, or modify any items."

Show each group with its items. Ask which groups to start with (user works on 1-3
at a time).

### Step 4.5: Coverage graph review (skip if no item has Covers)

If any generated item has a non-empty `Covers:` field, present a second
AskUserQuestion immediately after Step 4. If NO item has Covers (heuristics
didn't match), SKIP this step entirely — no UX friction for plans without
coverage hints.

```
Question:
"Coverage shortcuts the plan suggests:

  Item 1 (Sign in) → covers items 3 (Session cookie), 4 (Logged-in nav)
  Item 2 (Sign out) → covers item 6 (Session cleared)

Bundling these saves ~4 prompts. Approve, edit, or strip all?"

Options: ["Approve as-is", "Edit", "Strip all coverage"]
```

- **Approve as-is** → continue to Step 5.
- **Edit** → enter the structured edit loop (below).
- **Strip all coverage** → set every `Covers:` field to empty; persisted (user-stripped graph stays empty for the session). Continue to Step 5.

**Structured edit loop**: present a follow-up AskUserQuestion:

```
Question: "Coverage edit menu:"
Options: ["Drop an edge", "Add an edge", "Strip all coverage", "Done editing"]
```

- **Drop an edge** → second AskUserQuestion lists every current edge as an
  option (`"1 → 3"`, `"1 → 4"`, etc.) plus `"Cancel"`. Apply the selected
  drop; re-render the graph; loop back to the edit menu.
- **Add an edge** → two free-text follow-ups: `"Source item index?"` then
  `"Target item index?"`. Validate both as integers in [1, group_size]; run
  the four validation rules; on failure, present the named rule that fired
  and loop back to the edit menu. On success, add the edge; loop back.
- **Strip all coverage** → same as the top-level option; exits the loop.
- **Done editing** → exit the loop and re-present the top-level graph prompt
  (Approve / Edit / Strip).

**Loop bail-out**: track invalid-edit attempts within a single edit session.
After **3 consecutive invalid edits**, insert a fallback AskUserQuestion:

```
Question: "Three invalid edits in a row. Strip all coverage and continue, or keep editing?"
Options: ["Strip all coverage", "Keep editing"]
```

This caps the loop without forcing the user to abandon.

### Step 5: Write state

Create the session directory and write all files:

```bash
mkdir -p "$SESSION_DIR/groups"
```

Write `session.yaml` and each `groups/<name>.md` file. All items start as
UNTESTED. Items with inferred (or user-edited) Covers get the `Covers: [N, M]`
line written to disk.

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
2. Edit session.yaml summary counts (increment `passed`).
3. Write both edits in **parallel** (two Edit tool calls in the same turn).
4. **Bundle check**: read item N's `Covers:` field. Filter the target list to
   items still at `UNTESTED` (silently drop any target already at a non-UNTESTED
   status — those were added/tested out of order). If the filtered list is
   non-empty, present the **bundle prompt** below before advancing to item N+1.
   Otherwise, present item N+1 (from the cached lookahead) immediately via
   AskUserQuestion with item N+2 as the new lookahead preview. Receipt: "Item N passed."

#### Bundle prompt (post-PASS)

When item X passes and `X.Covers` resolves to a non-empty UNTESTED set,
present this AskUserQuestion BEFORE advancing to the next UNTESTED item.
Increment `session.yaml.summary.bundles_offered` before showing the prompt.

```
Question:
"Item X passed. Items [N], [M] are flagged as verified by your action on X:

  [N]. <Item N description>
  [M]. <Item M description>

Note: 'verified' means your action plausibly demonstrated each property. If
you'd need to look at something specific (logs, network panel, DB row) to be
sure, mark individually instead.

Confirm all pass, mark individually, or park a bug?"

Options: ["All pass", "Mark individually", "Park a bug"]
```

**Trust posture — "verified by action" vs "observed property"**: A bundle PASS
is a claim that the user's action *plausibly demonstrated* each covered
property, not that the user *directly observed* each one. Signing in
successfully implies a session cookie was set, but the user did not literally
inspect the cookie. Bundle confirmation is appropriate when the
implicit-observation is high-confidence (the system's behavior would visibly
break if the property were violated). When the property requires direct
inspection to be sure (logs, network requests, DB state, race conditions),
the user should pick "Mark individually" and verify each. This is a
calibrated trust posture, not a license to skip inspection.

Behavior:

- **All pass** → For each item Y in the filtered Covers list:
  - Mark Y's `Status` as `PASSED_BY_COVERAGE`, write `Build: <HEAD>` +
    `Tested: <now>`.
  - Compute Y's reverse-coverage set (sibling items whose `Covers:` lists
    include Y). Write `CoverageNote: covered by items [<comma-separated
    list of every item in Y's reverse-coverage set that is currently
    terminal-passed>]`. This records full provenance for multi-cover items
    so the FAIL handler can apply the multi-cover demotion rule correctly.
  - Leave Y's human `Notes:` field untouched.
  Increment `session.yaml.summary.passed_by_coverage` by the number of items
  resolved this way; also increment `passed` by the same number (passed is
  INCLUSIVE of passed_by_coverage). Increment `bundles_accepted` by 1.
  Then advance to the next UNTESTED item AFTER the bundled set (since the
  bundled items are no longer UNTESTED).

- **Mark individually** → Increment `bundles_rejected` by 1. Fall through to
  the standard per-item PASS/FAIL/SKIP flow on item N (the first bundled
  item), then item M, in order. Do NOT write `PASSED_BY_COVERAGE` for items
  the user marks PASSED via this path — direct PASS through the standard flow
  always writes `PASSED`.

- **Park a bug** → Run the standard PARK flow (see below). After parking,
  return to THIS bundle prompt (not to item X). PARK does not resolve the
  bundle; it interjects.

### On FAIL

1. Update the item: `Status: FAILED`, `Evidence: <user's description>`
   (If the user's response includes the failure description, use it directly.
   If they just said "fail" with no details, ask via AskUserQuestion:
   "**[Group] [N]/[Total] — What went wrong?**" with options: ["Let me describe it"])
2. **E3 demotion (always — applies to ALL FAIL paths, not just Fix Now)**:
   For each item Y whose reverse-coverage set includes this just-FAILED item X
   (i.e., Y appears in X's `Covers:` list AND Y is currently
   `PASSED_BY_COVERAGE`), re-evaluate Y's coverage backing using the
   **multi-cover demotion rule**:
   - Y demotes from `PASSED_BY_COVERAGE` to `UNTESTED` **only when every item
     in Y's reverse-coverage set is currently non-PASSED** (i.e., none of the
     items that originally backed Y are still terminal-passed).
   - If at least one covering item is still terminal-passed, Y stays
     `PASSED_BY_COVERAGE` (other items still back the claim). Append
     `CoverageNote: covering item X failed; items [<list of still-passed
     covering items>] still back this` to record the diminished provenance.
   - For Y items that DO demote: write `Status: UNTESTED`, clear `Build:`,
     clear `Tested:`, write `CoverageNote: pulled back after all covering
     items ([<list of failed/non-passed covering items>]) failed`. Leave the
     human `Notes:` field untouched.
   - Direct `PASSED` items NEVER demote — they have independent evidence and
     keep their status regardless of what happens to other items.
3. **After E3 demotion, the next prompt MUST do a full group re-read. Do not
   use any remembered N+1 item description from the lookahead step before the
   FAIL; demotion changed the UNTESTED set behind lookahead's back.** This
   sentence is load-bearing — a `tests/skill-protocols.test.ts` invariant
   asserts this exact phrasing exists in the FAIL handler section so future
   edits don't accidentally strip it.
4. Write all edits to disk.
5. Ask via AskUserQuestion:
   - Question: "**[Group] [N]/[Total] FAILED:** [evidence summary]\n\nFix now or keep testing?"
   - Options: ["Fix now", "Continue testing"]

The demotion happens regardless of which option the user picks next. If the
user picks "Continue testing," demoted items will be presented as normal
UNTESTED items in subsequent prompts. If the user picks "Fix now" and the
covering item then PASSES on retest, the demoted items stay UNTESTED — the
user must re-verify them (possibly via the bundle prompt firing again if
they re-PASS the covering item directly).

If the user later parks the session or hits session-end before retesting,
demoted items persist as UNTESTED in session state. Group completion will not
fire until they reach a terminal state.

### On FIX NOW

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

**Implement the fix:**

The agent writes the code fix. This is pair testing: the human found the bug,
the agent fixes it.

**Commit the fix:**

Determine the commit message suffix. If the failed item's `Covers:` field is
non-empty, append `, covers [<comma-separated-indices>]`; otherwise leave the
suffix empty:

```bash
COVERS_SUFFIX=""    # set to ", covers [3, 4]" when item N has Covers
git add -u
_OUT=$(git commit -m "fix: <description> (pair-review item <N>$COVERS_SUFFIX)" 2>&1)
_RC=$?
if [ $_RC -ne 0 ]; then
  echo "$_OUT"
  echo "BLOCKED: fix commit failed. Do NOT proceed."
  exit 1
fi
```

This keeps the existing `grep "pair-review item"` pattern working for items
without Covers, and adds full coverage provenance to the commit log for
items with Covers — useful when reviewing the fix in PR.

If the bash block exits zero, record the fix commit hash in the item's metadata.
If the block exits non-zero (BLOCKED case — including "nothing to commit," which
at fix-commit time means the agent's fix did not actually modify any tracked
files), **STOP**: do NOT record a fix commit hash, do NOT mark the item as
fixed, do NOT proceed to rebuild/redeploy. Report BLOCKED to the user with
the printed `$_OUT` tail (pre-commit hook reject, missing `user.email`,
detached HEAD, fix never staged, etc.).

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
2. **Coverage picker** (optional). After capturing the description, ask via
   AskUserQuestion whether this new item covers any existing items in the
   target group:

   ```
   Question: "Does this item cover any existing items in this group?"
   Options: ["No", "Yes — pick targets"]
   ```

   - **No** → continue with step 3 (no `Covers:` line on the new item).
   - **Yes — pick targets** → present a multi-select AskUserQuestion listing
     every existing item in the group (`"1. <description>"`, `"2. <description>"`,
     etc.). The new item's `Covers:` field is the set of selected indices.
     Validate against the four validation rules at add time; on failure,
     reject the offending target index(es) with the named rule that fired
     (per the user-edit policy in Phase 1 Step 3.5) and re-present the
     multi-select. Remaining valid targets stay selected.

   Indices are resolved **at add time** and immutable thereafter. If the
   user adds item 8 covering item 7, then later adds item 9, item 9's index
   is 9 — item 8's `Covers: [7]` is not shifted. (Items never renumber today;
   this preserves that invariant.)

3. Append the new item to the group file as UNTESTED. Write the `Covers:`
   line if non-empty (omit otherwise).
4. Update session.yaml summary.total.
5. Write to disk.
6. Continue with the current item (don't jump to the new one).

Existing items' `Covers:` lists are **immutable during execution** — they're
editable only via the Phase 1 Step 4.5 graph prompt at plan-review time. If
the user wants to edit existing covers mid-session, restart at Step 4.5
(currently not exposed; out of scope for this iteration).

### On PARK

Available anytime during Phase 2 (testing loop), FIX NOW flows, bundle
prompts (post-PASS coverage bundles + post-batch bundle walks), and the
plan-review coverage graph prompt (Phase 1 Step 4.5). When the user says
something like "park this", "note a bug", "not related but...", or describes
a bug that is clearly unrelated to the current test item:

1. If the user didn't include a description, ask via AskUserQuestion:
   - Question: "**What's the bug, and how do you reproduce it?** A short
     symptom + numbered repro steps. Repro is what makes this fixable later
     without re-deriving the bug from a vague memory."
   - Options: ["Let me describe it"]

   The user's response should give you both a symptom and repro steps. If
   they only describe the symptom (no repro), gently ask once more for the
   steps. If they push back ("can't repro reliably" / "saw it once"), accept
   that and record `Repro: not reliably reproducible — verify before fixing`.
   Do NOT insist past one nudge.

   **Ambiguous-response fallback:** if after one nudge the response is still
   vague, contradictory, or you genuinely cannot extract numbered steps,
   record what you have for `Symptom:` and write `Repro: not reliably
   reproducible — verify before fixing` for the repro. Move on. The
   re-verify guidance in the promoted TODO will surface the gap later if
   the bug ever needs to be fixed.
2. Append a new entry to `<SESSION_DIR>/parked-bugs.md`.
   Determine N by reading the file and incrementing the highest existing number
   (or 1 if the file is empty/new).
   ```markdown
   ## <N>. <Bug title — short phrase>
   - Noticed during: <current group slug>, item <current item number>
   - Timestamp: <ISO 8601 UTC>
   - Symptom: <what the user observed — one or two sentences>
   - Repro: <numbered steps, or "not reliably reproducible — verify before fixing">
   - Status: PARKED
   ```
   If `parked-bugs.md` doesn't exist yet, create it with a `# Parked Bugs` header.
   If parking before any testing starts, use "before testing" for "Noticed during."
3. Update session.yaml `parked_bugs.total` count
4. Write to disk
5. Return to whatever was in progress. The next AskUserQuestion receipt will
   read: "Parked bug #N." followed by the current test item or fix prompt.
   **From a bundle prompt or graph-review prompt**: PARK returns to the SAME
   bundle/graph prompt — it interjects, it does not resolve the bundle or
   graph. The user can park multiple bugs before answering the bundle.

**Do NOT classify the bug at park time.** Classification happens at group completion.

**Why Symptom + Repro (not Description):** parked bugs often get fixed days
or weeks later, on a different branch, after the original context has faded.
A bare description ("the spinner is stuck") becomes the spec for the future
fix and creates tunnel vision — the implementer fixes what was written, not
what's actually broken. Capturing repro steps at park time lets the future
implementer re-verify the bug before guessing at a fix; if it doesn't repro,
they close it instead of inventing a fix for a stale symptom.

### On BATCH

When the user selects "Batch: next 3", switch to batch presentation for faster
throughput. This reduces round-trips by 3x for rapid testing sessions.

BATCH keeps **index-ordered** selection — never leapfrog ahead to grab a cluster
of items further down the group. Leapfrogging would change the unit-of-work
in ways that interact badly with checkpoints and group-completion logic.
Coverage-aware compression happens via in-batch cluster hints + post-batch
bundle walks, not via reordering.

1. Read the group file. Collect the next 3 UNTESTED items in index order
   (or fewer if the group is nearly done). Also identify the item after the
   batch (the post-batch lookahead).
2. **In-batch cluster detection**: scan the batched items' `Covers:` fields.
   If any in-batch covering item's target is ALSO within this batch, render
   an inline cluster hint inline next to the covered item: `← covered by item [N] if it passes`.
3. Present all items in a single AskUserQuestion:
   - **Question (default):** "[Action receipt if applicable]\n\n**[Group] — Batch [start]-[end]/[Total]:**\n\n[N]. [Item description]\n[N+1]. [Item description]\n[N+2]. [Item description]\n\n_Next up: [N+3]. [Post-batch item description]_\n\nReport results for each item. Examples:\n`all pass` · `1 pass, 2 fail: button misaligned, 3 skip` · `2 fail: crashes on tap`"
   - **Question (when in-batch cluster detected):** "[Action receipt if applicable]\n\n**[Group] — Batch [start]-[end]/[Total]:**\n\n[N]. [Item description]\n[N+1]. [Item description]      ← covered by item [N] if it passes\n[N+2]. [Item description]\n\n_Cluster hint: passing [N] would also cover [N+1]._\n\n_Next up: [N+3]. [Post-batch item description]_\n\nReport results for each item."
   - **Options:** ["All pass", "Report results", "Park a bug", "Back to single mode"]

4. **On "All pass"** — two coverage paths apply:
   - **In-batch covers**: For each in-batch item whose `Covers:` field lists
     another in-batch item, mark the covered items as `PASSED_BY_COVERAGE`
     (not `PASSED`). Apply the same provenance-recording rules as the
     post-PASS bundle prompt (CoverageNote lists all covering items in Y's
     reverse-coverage set that are now terminal-passed). All non-covered
     batched items get `PASSED`.
   - **Out-of-batch covers**: For each batched item whose `Covers:` field
     points at an UNTESTED item OUTSIDE this batch, after the batch resolves
     to disk, fire the standard post-PASS bundle prompt for each such item
     in item order. The user can pick "All pass" / "Mark individually" /
     "Park" on each post-batch bundle prompt. This means a single "All pass"
     on a batch can spawn multiple follow-up bundle prompts (worst case: one
     per batched item with out-of-batch covers).

   Increment `bundles_offered` / `bundles_accepted` / `bundles_rejected`
   counters appropriately as each follow-up bundle prompt fires and resolves.

5. **On "Report results"**: The user clicked a button, so you don't have results yet.
   Ask a follow-up via AskUserQuestion:
   - Question: "Enter results for each item. Examples:\n`all pass` · `1 pass, 2 fail: button misaligned, 3 skip` · `2 fail: crashes on tap`"
   - Options: ["Submit"]
   Parse the user's free-text response. Map each item to PASS, FAIL (with evidence),
   or SKIP. For any FAILs, follow the standard FAIL flow (ask "Fix now or continue
   testing?") one at a time in item order after recording all results.
   The same out-of-batch walk applies: after all results are recorded, walk
   each newly-PASSED batched item with non-empty Covers and fire bundle
   prompts for any UNTESTED targets in item order.

6. **On "Back to single mode"**: Return to single-item presentation with lookahead
   at the next UNTESTED item.

**Minimum threshold:** If fewer than 2 UNTESTED items remain when "Batch: next 3"
is selected, stay in single-item mode. Tell the user: "Only N item(s) left —
staying in single mode."

After a batch (including any post-batch bundle walks), if remaining UNTESTED
items >= 3, offer another batch. If < 3, fall back to single-item presentation
with lookahead.

### Group completion

When all items in a group reach a terminal state (terminal-passed statuses, FAILED with fix, or SKIPPED):
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

- Question: "[Receipt from prior triage action if any]\n\n**Parked bug #N:** [Bug title]\n[Symptom from parked-bugs.md, one line]\nNoticed during: [group], item [item]\n\nRecommendation: [agent's classification reasoning — e.g. 'This looks like a cross-branch issue because...' or 'This relates to upcoming testing in the [group] group because...']\n\n**This bug surfaced during [group] testing. Fixing before [group] ships keeps the Group closure tight. Defer only if it's truly cross-branch.**"
- Options: ["Fix now (recommended)", "Send to TODOS.md", "Stay parked"]

**Defer nudge (E4):** "Fix now" is listed first intentionally — the default
framing biases toward closing out the Group that surfaced the bug. Deferral to
TODOS.md is an escape hatch for genuinely cross-branch bugs, not the easy path.

Behavior for each option:
- **Fix now** — blocks upcoming groups or relates to current area.
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
  2. The agent implements the fix
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
  5. Ask the user to verify the fix
  6. Update the bug's status to `FIXED` and record the fix commit hash
- **Send to TODOS.md** — cross-branch bug, fix on another branch later.
  Append the bug to the `## Unprocessed` section of TODOS.md (root or docs/,
  whichever exists). If no `## Unprocessed` section exists, create it at the
  end of the file. Use the rich format per `docs/source-tag-contract.md`:

  ```markdown
  ## Unprocessed

  ### [pair-review:group=<group-slug>,item=<item-index>] <Bug title>
  - **Symptom:** <Symptom field from parked-bugs.md>
  - **Repro:** <Repro field from parked-bugs.md, verbatim>
  - **Noticed during:** <group>, item <item>
  - **Context:** Found on branch <branch> (<date>). Parked during /pair-review. Re-verify the bug per the repro steps before implementing a fix; if it no longer reproduces, close as resolved instead of guessing at a fix.
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

## Phase 2.5: Post-Testing Fix Queue

After all test groups are complete and group-completion triage is done, check
`parked-bugs.md` for ALL entries with Status: PARKED (regardless of which group
they were noticed during, including bugs parked before testing started).

If none remain, skip to Phase 4.

If parked bugs remain, present each via AskUserQuestion (same format as group-completion
triage):

- Question: "[Receipt from prior action if any]\n\n**Parked bug #N:** [Bug title]\n[Symptom from parked-bugs.md, one line]\nNoticed during: [group], item [item]\n\nRecommendation: [agent's classification]\n\n**Deferring this bug keeps it in the roadmap's closure debt for [group]. Fix now if it's on-branch or blocks the current Group's ship.**"
- Options: ["Fix now (recommended for on-branch bugs)", "Send to TODOS.md", "Skip"]

Behavior for each option:
- **Fix now** — checkpoint, agent implements fix, commit, rebuild, user verifies, mark FIXED
- **Send to TODOS.md** — cross-branch, append to `## Unprocessed` section of TODOS.md
  using the rich format per `docs/source-tag-contract.md`:
  ```markdown
  ### [pair-review:group=<group-slug>,item=<item-index>] <Bug title>
  - **Symptom:** <Symptom field from parked-bugs.md>
  - **Repro:** <Repro field from parked-bugs.md, verbatim>
  - **Noticed during:** <group>, item <item>
  - **Context:** Found on branch <branch> (<date>). Parked during /pair-review Phase 2.5. Re-verify the bug per the repro steps before implementing a fix; if it no longer reproduces, close as resolved instead of guessing at a fix.
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

`SESSION_DIR` is already keyed by the current branch (resolved by
`session_dir pair-review "$BRANCH"`), so sessions on other branches live at
sibling paths and are not visible here — that is by design. Use the Glob tool
to check for an existing session on the current branch:

```
Glob pattern: <SESSION_DIR>/session.yaml
```

If the file exists, read it and proceed to Step 1.5.

If no state found: "No active test session found. Want to start a new one?"

If the user wants to see sessions on other branches, list `<PROJECT_DIR>/branches/`
— each sibling there is another branch's active session.

### Step 1.5: Re-validate coverage graph

Read every group file. Reconstruct the in-memory covers map. Re-run the four
validation rules from Phase 1 Step 3.5 against the persisted graph (the user
may have hand-edited group files between sessions). Apply the same
deterministic per-rule failure handling, logging dropped edges to
`coverage_warnings:` in session.yaml with `phase: resume`.

For each PASSED_BY_COVERAGE item: check that at least one of its (originally
recorded) covering items still exists in the group file. If every covering
item has been removed from the group file externally, demote the orphaned
PASSED_BY_COVERAGE item back to UNTESTED with
`CoverageNote: covering item removed between sessions`. Leave human `Notes:`
untouched.

Note: resume does NOT re-run inference. It only validates the persisted
graph. New Covers links only originate from Phase 1 plan generation or
explicit user dictation via Add Item (Phase 2).

### Step 2: Render dashboard

Read session.yaml and all group files. Display:

```
TEST SESSION: <project>
Branch: <branch> | Build: <commit> | Started: <date>

<GROUP1> (active):     3/7 passed, 1 failed (fixed), 0 skipped, 3 untested
<GROUP2> (active):     0/4 tested

# The "N/M passed" count uses terminal-passed statuses (PASSED + PASSED_BY_COVERAGE).
<GROUP3>:              not started (5 items)

COVERAGE: 3 bundles in plan
  auth: 1 (sign in → session cookie, logged-in nav)
  payments: 2 (cart add → cart total, checkout button enabled)
                (cart remove → cart total, checkout button disabled)

PARKED: <N> bugs parked (<M> triaged, <K> remaining)
NEXT: <what to test next>
DEPLOY: <build command from deploy.md>
CHECKPOINTS: <N> saved
```

**COVERAGE sub-block rendering rules:**
- Omit the COVERAGE block ENTIRELY if no item in any group has a non-empty `Covers:` field.
- Otherwise, list each group that has at least one bundle, followed by the
  count of bundles in that group and a parenthesized summary per bundle
  (`source description → target descriptions, comma-separated`).
- The "3 bundles in plan" header counts ALL bundles across all groups.

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
- Passed: N (M by coverage)
- Failed + fixed: N
- Skipped: N
- Coverage savings: K items confirmed by coverage across B bundles (saved K prompts)
- Bundles accepted: B/O (R marked individually)
- Coverage warnings: I edge(s) dropped during inference, R dropped during resume (see session.yaml for details)

### Groups

#### <Group 1>
| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | <description> | PASSED | |
| 2 | <description> | PASSED (fixed in abc123) | <evidence> |
| 3 | <description> | PASSED (by coverage from item 1) | |
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

**Summary line rendering rules:**

- **Passed: N (M by coverage)** — `M == summary.passed_by_coverage`. If `M == 0`, render as `- Passed: N` (omit the parenthetical) so reports for sessions that didn't use coverage stay clean.
- **Coverage savings** — `K == summary.passed_by_coverage` (items resolved via the "All pass" bundle path); `B == summary.bundles_accepted`; "saved K prompts" reflects that each accepted bundle replaces N per-item prompts with 1 bundle prompt (net savings = N per bundle, totaled). Omit this line if `summary.bundles_accepted == 0`.
- **Bundles accepted** — `B == summary.bundles_accepted`, `O == summary.bundles_offered`, `R == summary.bundles_rejected`. Omit this line if `summary.bundles_offered == 0`. If `bundles_offered > 0` and `bundles_accepted == 0`, still render this line (acceptance was 0/N — useful negative signal); omit the Coverage savings line in that case.
- **Coverage warnings** — `I == count(coverage_warnings where phase == inference)`, `R == count(coverage_warnings where phase == resume)`. Omit this line entirely if `coverage_warnings` is empty.

### Step 2: Save report

Write report to `<SESSION_DIR>/report.md`.

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

On **Init**, before starting Phase 0, check for an existing active session on
the current branch. `SESSION_DIR` is already branch-scoped, so sessions on
other branches are invisible here — by design, they have their own
`branches/<branch>/` slot and continue to live independently.

```
Glob pattern: <SESSION_DIR>/session.yaml
```

If an active session exists, read it and present via AskUserQuestion:

- Question: "You have an active test session on this branch (started [date], [N]/[M] items tested). What would you like to do?"
- Options: ["Resume the existing session", "Start a new session (archives the old one)"]

If B, move this branch's session to a per-branch archive (re-source the helper
if this is a fresh bash block):
```bash
TS=$(date -u +%Y%m%d-%H%M%S)
ARCHIVE_DIR=$(session_archive_dir pair-review "$TS" "$BRANCH")
mv "$SESSION_DIR" "$ARCHIVE_DIR"
```

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

<!-- SHARED:completion-status-enum -->
## Completion Status Protocol

When completing a skill workflow, report status using one of:

- **DONE** — All steps completed successfully. Evidence provided for each claim.
- **DONE_WITH_CONCERNS** — Completed, but with issues the user should know about. List each concern.
- **BLOCKED** — Cannot proceed. State what is blocking and what was tried.
- **NEEDS_CONTEXT** — Missing information required to continue. State exactly what you need.
<!-- /SHARED:completion-status-enum -->

For pair-review specifically: map per-item states (`UNTESTED`, `PASSED`, `PASSED_BY_COVERAGE`, `FAILED`, `FIXED`, `SKIPPED`, `PARKED`) and per-group statuses to the session-level enum at `/pair-review done` time. Rollup rule:

- All groups complete, no parked bugs and no failures → **DONE**
- Complete with items SKIPPED, PARKED, or with deferred bugs → **DONE_WITH_CONCERNS** (list them)
- A group cannot proceed (deploy broken, can't reach the app, missing credentials) → **BLOCKED**
- Session interrupted or resumed without required context (lost `<SESSION_DIR>` state, for example) → **NEEDS_CONTEXT**

<!-- SHARED:escalation-opener -->
### Escalation

It is always OK to stop and say "this is too hard for me" or "I'm not confident in this result." Bad work is worse than no work. You will not be penalized for escalating.
<!-- /SHARED:escalation-opener -->

- If you have attempted a fix 3 times without success, STOP and escalate (park the bug, move on, surface at group rollup).
- If you are uncertain about a security-sensitive change, STOP and escalate.
- If the scope of work exceeds what you can verify, STOP and escalate.

<!-- SHARED:escalation-format -->
Escalation format:

```
STATUS: BLOCKED | NEEDS_CONTEXT
REASON: [1-2 sentences]
ATTEMPTED: [what you tried]
RECOMMENDATION: [what the user should do next]
```
<!-- /SHARED:escalation-format -->

<!-- SHARED:confusion-head -->
## Confusion Protocol

When you encounter high-stakes ambiguity during this workflow:
<!-- /SHARED:confusion-head -->

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
- Findings cells come from the group's item state tally (`PASSED`, `PASSED_BY_COVERAGE`, `FAILED`, `FIXED`, `SKIPPED`, `PARKED`). The "passed" count rolls up terminal-passed statuses (PASSED + PASSED_BY_COVERAGE). Prefer compact form like "6/7 passed, 1 skipped (VPN), 1 parked".
- `<one-line summary>` names the concrete group outcome: "6/7 passed, moving to next group", "deploy broken after fix attempt", "1 parked bug carried forward to Payments", etc.

Verdict-to-status mapping:

- All items in group are at terminal-passed statuses or FIXED → group "DONE — all <N> items pass".
- Group has SKIPPED or PARKED items, or deferred bugs → group "DONE_WITH_CONCERNS — <specifics>".
- Group could not proceed (deploy broken, app unreachable, missing credentials) → "BLOCKED — <reason>".
- Session state malformed or `<SESSION_DIR>` lost on resume → "NEEDS_CONTEXT — <what is missing>".

The mini-table runs at each group boundary so the Conductor action-receipt pattern still shows a clean summary in the collapsed view. The rollup runs once at session-done.

<!-- SHARED:telemetry-epilogue -->
## Telemetry (epilogue — run last, after the GSTACK REVIEW REPORT)

Replace `_GE_TEL_START` and `_GE_SESSION_ID` with the values the preamble's `GE_TELEMETRY:` line emitted; set `_GE_OUTCOME` per the Completion Status Protocol (`success` / `error` / `abort` / `unknown`). The wrapper at `bin/gstack-extend-telemetry` adds `--source gstack-extend` automatically and falls back silently if gstack isn't installed.

```bash
_GE_SKILL="extend:pair-review"
_GE_TEL_START=$(date +%s)               # REPLACE with start= value from preamble's GE_TELEMETRY line
_GE_SESSION_ID="$$-$_GE_TEL_START-$RANDOM"      # REPLACE with session= value from preamble's GE_TELEMETRY line
_GE_OUTCOME="success"                   # success | error | abort | unknown
_GE_TEL=$(~/.claude/skills/gstack/bin/gstack-config get telemetry 2>/dev/null || true)
_GE_TEL_END=$(date +%s)
_GE_TEL_DUR=$(( _GE_TEL_END - _GE_TEL_START ))
if [ "${_GE_TEL:-off}" != "off" ]; then
  _GE_BIN=""
  if command -v gstack-extend-telemetry >/dev/null 2>&1; then
    _GE_BIN="gstack-extend-telemetry"
  elif [ -x "$HOME/.claude/skills/gstack-extend/bin/gstack-extend-telemetry" ]; then
    _GE_BIN="$HOME/.claude/skills/gstack-extend/bin/gstack-extend-telemetry"
  fi
  [ -n "$_GE_BIN" ] && "$_GE_BIN" --skill "$_GE_SKILL" --duration "$_GE_TEL_DUR" --outcome "$_GE_OUTCOME" --session-id "$_GE_SESSION_ID" 2>/dev/null || true
fi
```
<!-- /SHARED:telemetry-epilogue -->
