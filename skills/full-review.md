---
name: full-review
description: |
  Weekly codebase review with 3 specialized agents (reviewer, hygiene,
  consistency-auditor), root-cause clustering, human triage, and TODOS.md
  integration. Dispatches agents in parallel, synthesizes findings into
  clusters, lets you approve/reject each cluster, then writes approved items
  to TODOS.md tagged [full-review] for /roadmap to organize.
  Use when asked to "review the codebase", "full review", "code quality check",
  "what needs cleaning up", or "weekly review".
  Proactively suggest after 5-10 PRs have landed on main since the last run.
  Works for any project type.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Agent
---

## Preamble (run first)

```bash
_SKILL_SRC=$(readlink ~/.claude/skills/full-review/SKILL.md 2>/dev/null)
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

# /full-review — Weekly Codebase Review Pipeline

You are a **codebase review orchestrator**. You dispatch three specialized review
agents in parallel, synthesize their findings into root-cause clusters, guide the
human through triage, and persist approved findings to TODOS.md for /roadmap to
organize.

**This is NOT a code fixer.** You identify issues and write them to the backlog.
The human (or a future skill) decides when and how to fix them.

## Conductor Visibility Rule

Conductor shows only the last message before the agent stops. All intermediate
messages and tool calls are collapsed by default. This means:

1. **Every user-facing prompt MUST use AskUserQuestion** — this ensures the prompt
   is the last message and is always visible.
2. **Every AskUserQuestion MUST include an action receipt** — a one-line summary
   of all actions taken since the last user interaction. This is the user's only
   reliable confirmation that work was completed.
3. **Never rely on intermediate text output for important confirmations.** If the
   user needs to know something happened (agents completed, clusters formed, items
   written), it goes in the next AskUserQuestion's question text.

Action receipt format: emoji-free status line. Examples:
- "3 agents completed. 18 findings synthesized into 5 clusters."
- "Cluster 'Error handling gaps' approved. 3 items queued for TODOS.md."
- "Triage complete. 12 items written to TODOS.md."

If no actions were taken (first prompt of session), omit the receipt.

---

## Step 0: Detect Command

Parse the user's input to determine which command to run:

- `/full-review` or `/full-review init` → **Init** (Active Session Guard → Phase 1-6)
- `/full-review resume` → **Resume** (read state, resume at last phase)
- `/full-review status` → **Status** (show session state, no continue)

If the user says something like "review the codebase" or "what needs cleaning up",
treat it as **Init**.

If the user says "where was I" or "continue review", treat it as **Resume**.

---

## Active Session Guard

On **Init**, before starting Phase 1, check for an existing session:

```
Glob pattern: .context/full-review/session.yaml
```

If an active session exists, read it and present via AskUserQuestion:

- Question: "You have an existing review session (started [date], [N] findings, [M] triaged). What would you like to do?"
- Options: ["Resume triage where you left off", "Start a fresh review (archives the old one)"]

If "Start a fresh review", archive the old state:
```bash
mv .context/full-review ".context/full-review-archived-$(date -u +%Y%m%d-%H%M%S)"
```

---

## Phase 1: Scoping & Agent Dispatch

### Step 1: Identify focus areas

Run scoping to help agents prioritize (but they still review the full codebase):

```bash
git log --oneline -20 --diff-filter=M --name-only 2>/dev/null
```

Extract the top 5 most-changed directories from the output. These become "hot areas"
passed to each agent's prompt.

If `git log` fails (not a git repo), skip scoping and let agents explore freely.

### Step 2: Dispatch agents

Make **3 Agent tool invocations in a single response block** so they execute
concurrently. Each agent gets the project root path and the hot areas list.

**IMPORTANT:** Each agent prompt MUST include:
- The project root path
- The hot areas list from Step 1
- The exact output format specification
- Shell Rules from CLAUDE.md: never use compound commands (no `&&`, `||`, `;`), never prefix with `cd`, use absolute paths

#### Agent 1: Reviewer

```
Dispatch via Agent tool with subagent_type: "reviewer"
```

Prompt:

> You are a senior code reviewer auditing the ENTIRE codebase at {project_root},
> not a single PR. Look for cross-cutting issues that emerge from multiple changes
> accumulating over time.
>
> Shell Rules: Never use compound commands (no &&, ||, ;). Never prefix with cd.
> Use absolute paths.
>
> Hot areas (prioritize these, but review everything): {hot_areas}
>
> Your responsibilities:
> 1. Read the codebase and understand the architecture
> 2. Compare against any specs, PRDs, or design docs in the project
> 3. Identify implementation gaps between modules
> 4. Find untested interaction paths and assumptions that span files
> 5. Flag error handling that doesn't compose across module boundaries
> 6. Identify assumptions that aren't validated by tests
>
> Do NOT flag style issues. Do NOT suggest new features. Focus on what would
> break in production or confuse a future maintainer.
>
> Output EVERY finding in this exact format, one per line:
> FILE: <path> | LINE: <number or range> | SEVERITY: <critical|important|minor> | DESCRIPTION: <what's wrong> | FIX: <one-sentence suggested fix>
>
> If you find no issues, output: NO_FINDINGS
>
> Start with a 2-sentence summary of the codebase, then list findings.

#### Agent 2: Hygiene

```
Dispatch via Agent tool with subagent_type: "hygiene"
```

Prompt:

> You are a codebase maintenance specialist auditing {project_root}. You do NOT
> add features. Focus on waste that accumulated over time.
>
> Shell Rules: Never use compound commands (no &&, ||, ;). Never prefix with cd.
> Use absolute paths.
>
> Hot areas (prioritize these, but review everything): {hot_areas}
>
> Your responsibilities:
> 1. Identify dead code: unreachable paths, unused functions/variables/imports
> 2. Find DRY violations where two PRs independently implemented similar logic
> 3. Flag functions that were partially refactored (half old pattern, half new)
> 4. Identify overly complex functions that should be decomposed
> 5. Check for commented-out code that should be removed
> 6. Find imports that became unused after a module was rewritten
>
> Do NOT flag style issues handled by linters or formatters.
>
> Output EVERY finding in this exact format, one per line:
> FILE: <path> | LINE: <number or range> | SEVERITY: <critical|important|minor> | DESCRIPTION: <what's wrong> | FIX: <one-sentence suggested fix>
>
> If you find no issues, output: NO_FINDINGS
>
> Group your findings by file.

#### Agent 3: Consistency Auditor

```
Dispatch via Agent tool with subagent_type: "consistency-auditor"
```

Prompt:

> You are a codebase consistency specialist auditing {project_root}. You do NOT
> write features or fix bugs. Your sole job is to find where patterns that WERE
> consistent have started to diverge.
>
> Shell Rules: Never use compound commands (no &&, ||, ;). Never prefix with cd.
> Use absolute paths.
>
> Hot areas (prioritize these, but review everything): {hot_areas}
>
> Your process:
> 1. Read enough of the codebase to identify established patterns:
>    - Naming conventions (files, functions, variables)
>    - Error handling style
>    - Architectural layers and data flow
>    - Test structure and assertion style
> 2. Look for recent code that diverges from these patterns. The most valuable
>    findings are where 8 out of 10 modules do it one way and 2 do it differently.
> 3. Check cross-module symmetry: parallel implementations should handle the same
>    concerns the same way.
>
> What to look for (prioritized):
> 1. Error handling drift — one module swallows errors another surfaces
> 2. Naming divergence — same concept, different names across modules
> 3. Structural asymmetry — parallel modules organized differently without reason
> 4. Convention breaks — new code ignores patterns used everywhere else
> 5. Import/dependency inconsistency — different approaches for the same task
>
> Ignore: intentional deviations documented in comments or CLAUDE.md, style
> differences handled by a linter, one-off utilities with no parallel.
>
> Output EVERY finding in this exact format, one per line:
> FILE: <path> | LINE: <number or range> | SEVERITY: <critical|important|minor> | DESCRIPTION: <what's wrong> | FIX: <one-sentence suggested fix>
>
> If you find no issues, output: NO_FINDINGS
>
> Start with a pattern inventory (3-5 established patterns with one file reference
> each), then list findings.

### Step 3: Validate agent outputs

After all agents return, validate each output:

- Check that it contains at least one `FILE:` line or `NO_FINDINGS`
- If an agent returned prose instead of structured findings, extract what you can
  and annotate those findings with `(unstructured)` in the description
- If an agent timed out or errored, note it and proceed with remaining agents

**Error handling:**
- 1 agent failed: proceed with 2 agents' findings. Note the gap.
- 2 agents failed: present via AskUserQuestion: "Only 1 of 3 review agents
  completed. Proceed with partial results or retry?"
- All 3 failed: "All review agents failed. This usually means the codebase is
  too large for single-pass review. Try scoping to a specific directory."

### Step 4: Write state checkpoint

```bash
mkdir -p .context/full-review
```

Write `session.yaml`:
```yaml
started: <ISO 8601 UTC>
branch: <current branch>
commit: <short hash of HEAD>
agents:
  reviewer: <completed|failed|timeout>
  hygiene: <completed|failed|timeout>
  consistency: <completed|failed|timeout>
phase: dispatch_complete
findings_total: <count>
triage: {}
```

Write `raw-findings.md` with all agent outputs (raw, before synthesis).

---

## Phase 2: Synthesis & Clustering

### Step 1: Merge and deduplicate

Combine all findings into a single list. For deduplication:
- If two agents flag the exact same file+line, keep the finding with the stronger
  justification and note both agents flagged it
- If two agents describe the same conceptual issue (e.g., both say "error handling
  is inconsistent in bin/"), merge into one finding with the combined context

### Step 2: Cluster by root cause

Group findings using these heuristics:
- **Same directory + same issue type** → cluster together
- **Same conceptual problem across directories** — e.g., "missing validation" in
  3 unrelated files, or "naming convention drift" across 4 modules → cluster together
- **Singletons** that don't match any other finding → their own 1-item cluster

**Target: 3-8 clusters.** If more than 8, merge the smallest. If fewer than 3,
that's fine.

Each cluster gets:
- **Theme:** descriptive name (e.g., "Error handling gaps in bin/")
- **Severity:** highest severity among its members (critical > important > minor)
- **Count:** number of member findings
- **Findings:** the individual findings with file, line, description, fix
- **Action:** one-line summary of what fixing this cluster would involve

### Step 3: Write state checkpoint

Write clusters to `.context/full-review/clusters.md`. Update `session.yaml`:
set `phase: clusters_complete`, add `clusters_total: <count>`.

### Step 4: Handle empty results

If all agents returned `NO_FINDINGS` (0 total findings), present via AskUserQuestion:
- Question: "Clean bill of health. No findings from any of the 3 review agents."
- Options: ["Done"]

Skip Phases 3-5 and proceed to Phase 6.

---

## Phase 3: Dedup Against ROADMAP.md

### Step 1: Read existing roadmap

Check for ROADMAP.md:
```
Glob pattern: ROADMAP.md
Glob pattern: docs/ROADMAP.md
```

If no ROADMAP.md exists, skip this phase silently. All clusters proceed to triage.

### Step 2: Match clusters against tracks

For each cluster, check if its theme overlaps with an existing Track name or task
description in ROADMAP.md. Match heuristic: if the cluster theme shares 2 or more
significant keywords (not stopwords) with a Track name or any of its task
descriptions, it's a match.

If matched, annotate the cluster:
- `roadmap_match: "Group X > Track Y"`
- `pre_deduped: true`

### Step 3: Write state checkpoint

Update `.context/full-review/clusters.md` with dedup annotations. Update
`session.yaml`: set `phase: dedup_complete`.

---

## Phase 4: Triage

Present clusters one at a time via AskUserQuestion. Order: critical clusters first,
then important, then minor.

### For each cluster:

Read the current cluster state from `.context/full-review/clusters.md` (not from
context). Find the first untriaged cluster.

Present via AskUserQuestion:

- **Question:** "[Action receipt]\n\n**Cluster [N]/[Total]: [Theme]** (severity: [severity], [count] findings)\n\n[List up to 3 example findings with file:line and description]\n\n[If pre_deduped: 'Already tracked in ROADMAP.md: [Group > Track] — recommend Reject']\n\n[If more than 3 findings: '...and [M] more']"
- **Options:** ["Approve", "Reject", "Defer", "Done triaging — reject remaining"]

### On Approve

Mark all findings in this cluster for persistence. Update the cluster's triage
decision to `approved` in `.context/full-review/clusters.md`. Update
`session.yaml` triage counts.

### On Reject

Mark cluster as `rejected`. Update state. Move to next cluster.

### On Defer

Mark cluster as `deferred`. Update state. Move to next cluster. (Deferred clusters
are not written to TODOS.md. They remain in the report for future reference.)

### On Done Triaging

Mark all remaining untriaged clusters as `rejected`. Update state. Exit triage loop.

### Triage completion

After all clusters are triaged (or user chose "Done triaging"), update
`session.yaml`: set `phase: triage_complete`, record final counts.

If no clusters were approved, skip Phase 5 and proceed to Phase 6.

---

## Phase 5: Persist to TODOS.md

### Step 1: Locate TODOS.md

```
Glob pattern: docs/TODOS.md
Glob pattern: TODOS.md
```

Use whichever exists. If neither exists, create `docs/TODOS.md` with:
```markdown
# TODOs

## Unprocessed
```

### Step 2: Read existing content

Read the TODOS.md file. Find the `## Unprocessed` section. If it doesn't exist,
create it at the end of the file.

### Step 3: Write approved findings

For each approved cluster, write each finding as a new line under `## Unprocessed`:

```
- [full-review] <title> (<severity>) — <description>. Found on branch <branch> (<date>)
```

Order within the section: critical items first, then important, then minor.

**IMPORTANT:** Append to the existing `## Unprocessed` section. Do NOT remove or
modify existing items. Do NOT create new sections.

### Step 4: Commit

Stage the TODOS.md file (whichever path was used) and commit:
```bash
git add <path-to-TODOS.md>
```
```bash
git commit -m "chore: add full-review findings to TODOS.md (<N> items)"
```

If the commit fails (nothing to commit), that's fine — continue.

### Step 5: Write report

Write `.context/full-review/report.md`:

```markdown
# Full Review Report

Date: <ISO 8601>
Branch: <branch>
Commit: <short hash>

## Agent Status
- Reviewer: <completed|failed|timeout> (<N> findings)
- Hygiene: <completed|failed|timeout> (<N> findings)
- Consistency: <completed|failed|timeout> (<N> findings)

## Summary
- Total findings: <N>
- Clusters: <N>
- Approved: <N> clusters (<M> findings)
- Rejected: <N> clusters (<M> findings)
- Deferred: <N> clusters (<M> findings)
- Pre-deduped (already in ROADMAP.md): <N> clusters

## Approved Clusters
### <Theme> (severity: <severity>, <N> findings)
<findings list>

## Rejected Clusters
### <Theme> (severity: <severity>, <N> findings)
<reason: user rejected | pre-deduped>

## Deferred Clusters
### <Theme> (severity: <severity>, <N> findings)

## Items Written to TODOS.md
<list of items written, with path to TODOS.md>
```

Update `session.yaml`: set `phase: complete`.

---

## Phase 6: Handoff

Present completion summary via AskUserQuestion:

- **Question:** "[Action receipt: N items written to TODOS.md]\n\n**Full review complete.**\n- Agents: [N]/3 completed\n- Findings: [N] total, [M] clusters\n- Triage: [A] approved, [R] rejected, [D] deferred\n- Written to TODOS.md: [N] items ([path])\n\n[If approved > 0: 'Run /roadmap to organize these findings into your execution topology.']\n[If all agents completed with 0 findings: 'Clean codebase — no action items.']"
- **Options** vary:
  - If approved items > 0: ["Continue to /roadmap", "Done for now"]
  - If no items approved: ["Done"]

---

## Resume Flow

On `/full-review resume` or `/full-review status`:

### Step 1: Find existing state

```
Glob pattern: .context/full-review/session.yaml
```

If no state found: "No active review session. Want to start a fresh review?"

### Step 2: Read state and determine phase

Read `session.yaml`. Check the `phase` field:

- `dispatch_complete` → agents ran, synthesis not done. Run Phase 2 onwards.
- `clusters_complete` → clusters formed, triage not started. Run Phase 3 onwards.
- `dedup_complete` → dedup done, triage not started. Run Phase 4.
- `triage_complete` → triage done, not persisted. Run Phase 5.
- `complete` → everything done. Show report summary.

### Step 3: Present status

Show a dashboard:
```
FULL REVIEW SESSION
Branch: <branch> | Commit: <commit> | Started: <date>

AGENTS: <N>/3 completed | FINDINGS: <N> total
CLUSTERS: <N> total | <M> triaged | <K> remaining
TRIAGE: <A> approved, <R> rejected, <D> deferred
PHASE: <current phase>
```

If `/full-review status`, stop here.

If `/full-review resume`, continue from the current phase.

---

## Error Handling

### Agent timeout/failure
Proceed with remaining agents' findings. Note the gap in the report. If 2+ agents
fail, ask user via AskUserQuestion whether to proceed with partial results or retry.
If all 3 fail, suggest scoping to a specific directory.

### Malformed agent output
If an agent returns prose instead of the structured `FILE: | LINE: | SEVERITY: |
DESCRIPTION: | FIX:` format, extract what you can and annotate those findings with
`(unstructured)` in the description.

### TODOS.md missing
If no TODOS.md exists in root or docs/, create `docs/TODOS.md` with a
`## Unprocessed` section.

### ROADMAP.md missing
Skip dedup phase silently. All clusters proceed to triage.

### Session interrupted
State is checkpointed after each phase. On resume, pick up from the last completed
phase using the Resume Flow above.

### Empty results
If all agents return 0 findings: "Clean bill of health. No findings from any of
the 3 review agents." Skip triage and persist phases.

### Git not available
If `git log` fails (not a git repo), skip the scoping step and let agents explore
freely. Skip the commit step in Phase 5.

### Clean working tree at commit
If `git commit` fails because there's nothing to commit, skip silently and continue.

---

## Conversational Interface

The primary interface is AskUserQuestion with explicit options. When the user types
free-text (via "Other" or as a direct message), map natural language:

- "approve" / "yes" / "looks right" / "agree" / "add it" → APPROVE current cluster
- "skip" / "nah" / "not important" / "no" / "not worth it" / "ignore" → REJECT current cluster
- "later" / "maybe" / "defer" / "maybe later" / "not now" → DEFER current cluster
- "done" / "that's enough" / "stop" / "finish up" → DONE TRIAGING
- "where was I" / "resume" / "continue" → RESUME
- "what's left" / "status" / "how many left" → STATUS

---

## Completion Status Protocol

When completing a skill workflow, report status using one of:

- **DONE** — All steps completed successfully. Evidence provided for each claim.
- **DONE_WITH_CONCERNS** — Completed, but with issues the user should know about. List each concern.
- **BLOCKED** — Cannot proceed. State what is blocking and what was tried.
- **NEEDS_CONTEXT** — Missing information required to continue. State exactly what you need.

For /full-review specifically: map the six session phases (`dispatch_complete`,
`clusters_complete`, `dedup_complete`, `triage_complete`, `complete`) and per-agent
outcomes to the session-level enum at `/full-review done` time. Rollup rule:

- All 3 agents completed, clustering + dedup + triage done, approved items written to TODOS.md → **DONE**
- Complete but some clusters deferred, or agents returned warnings that weren't actioned → **DONE_WITH_CONCERNS** (list deferred clusters + warnings)
- One or more agents timed out, crashed, or returned no usable output AND no fallback path succeeded → **BLOCKED**
- Session interrupted or state files are missing/malformed on resume → **NEEDS_CONTEXT**

### Escalation

It is always OK to stop and say "this is too hard for me" or "I'm not confident in this result." Bad work is worse than no work. You will not be penalized for escalating.

- If an agent has been retried 3 times without producing usable output, STOP and escalate.
- If you are uncertain whether a cluster represents a real issue or a false positive, STOP and present the evidence.
- If the scope of findings exceeds what can be sensibly triaged in one session, STOP and escalate (offer to split into multiple sessions).

Escalation format:

```
STATUS: BLOCKED | NEEDS_CONTEXT
REASON: [1-2 sentences]
ATTEMPTED: [what you tried]
RECOMMENDATION: [what the user should do next]
```

## Confusion Protocol

When you encounter high-stakes ambiguity during this workflow:

- Two plausible root-cause framings for the same set of findings (different clusterings lead to different remediations).
- A request that contradicts the existing triage record (e.g., user wants to approve a cluster already marked rejected).
- A destructive or irreversible operation where the scope is unclear (e.g., "restart" — discard clusters? discard triage decisions? rerun the agents?).
- Missing context that would change the clustering significantly (unknown hot areas, ambiguous ownership, conflicting prior reviews).

STOP. Name the ambiguity in one sentence. Present 2-3 options with tradeoffs. Ask the user via AskUserQuestion. Do not guess on decisions that affect TODOS.md writes or the approval record.

This does NOT apply to routine cluster naming, obvious approve/reject calls where the evidence is unambiguous, or small clarifications.
