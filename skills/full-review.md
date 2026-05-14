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
_SKILL_SRC=$(readlink ~/.claude/skills/full-review/SKILL.md 2>/dev/null \
           || readlink .claude/skills/full-review/SKILL.md 2>/dev/null)
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

## Path Resolution

Session state lives in `<SESSION_DIR>` — a durable, per-project directory at
`${GSTACK_STATE_ROOT:-$HOME/.gstack}/projects/<slug>/full-review/`. Survives
Conductor workspace archival.

Resolve `SESSION_DIR` at the start of every bash block that touches state:

```bash
_SKILL_SRC=$(readlink ~/.claude/skills/full-review/SKILL.md 2>/dev/null \
           || readlink .claude/skills/full-review/SKILL.md 2>/dev/null)
_EXTEND_ROOT=$(dirname "$(dirname "$_SKILL_SRC")" 2>/dev/null)
source "$_EXTEND_ROOT/bin/lib/session-paths.sh"
SESSION_DIR=$(session_dir full-review)
echo "SESSION_DIR=$SESSION_DIR"
```

Throughout this skill, `<SESSION_DIR>` in path expressions means the resolved
value above. When invoking Glob/Read/Write/Edit, substitute the concrete
absolute path printed by the bash block.

---

## Active Session Guard

On **Init**, before starting Phase 1, check for an existing session:

```
Glob pattern: <SESSION_DIR>/session.yaml
```

If an active session exists, read it and present via AskUserQuestion:

- Question: "You have an existing review session (started [date], [N] findings, [M] triaged). What would you like to do?"
- Options: ["Resume triage where you left off", "Start a fresh review (archives the old one)"]

If "Start a fresh review", archive the old state:
```bash
TS=$(date -u +%Y%m%d-%H%M%S)
ARCHIVE_DIR=$(session_archive_dir full-review "$TS")
mv "$SESSION_DIR" "$ARCHIVE_DIR"
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
> **Subtraction first.** Before proposing a hypothesis that adds code (new
> validation, new helper, new error handling layer), consider whether deletion
> or simplification gets to the same place. Often the right move is to remove
> the caller that violates the assumption rather than make the callee defend
> against it. Only suggest additive directions when subtraction won't work.
>
> Your hypothesis is a starting point for investigation, not a prescription.
> Frame it as one possible direction; the implementer will re-verify the
> problem and choose the actual fix.
>
> Output EVERY finding in this exact format, one per line:
> FILE: <path> | LINE: <number or range> | SEVERITY: <critical|necessary|nice-to-have|edge-case> | DESCRIPTION: <what's wrong> | HYPOTHESIS: <one-sentence direction to investigate (verify before implementing)>
>
> SEVERITY semantics (see docs/source-tag-contract.md):
>   critical     — ship-blocker, data loss, security, correctness
>   necessary    — real defect, should fix in current or next Group
>   nice-to-have — legitimate improvement, OK to defer
>   edge-case    — hypothetical or extreme-edge scenario. These are DROPPED at source
>                  by /full-review. Only report them for the record; they will not be
>                  written to TODOS.md.
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
> **Subtraction first.** This agent's whole purpose is finding waste — your
> default hypothesis should be deletion. For DRY violations, prefer "delete
> one of the duplicates" over "extract a shared helper" unless the
> duplication is genuinely load-bearing. For partially-refactored functions,
> prefer "finish the migration and remove the old pattern" over "make both
> patterns coexist." For complex functions, decomposition is fine but ask
> whether the function should exist at all. Adding a helper to consolidate
> three call sites is often worse than the duplication.
>
> Your hypothesis is a starting point for investigation, not a prescription.
> Frame it as one possible direction; the implementer will re-verify the
> problem and choose the actual fix.
>
> Output EVERY finding in this exact format, one per line:
> FILE: <path> | LINE: <number or range> | SEVERITY: <critical|necessary|nice-to-have|edge-case> | DESCRIPTION: <what's wrong> | HYPOTHESIS: <one-sentence direction to investigate (verify before implementing)>
>
> SEVERITY semantics (see docs/source-tag-contract.md):
>   critical     — ship-blocker, data loss, security, correctness
>   necessary    — real defect, should fix in current or next Group
>   nice-to-have — legitimate improvement, OK to defer
>   edge-case    — hypothetical or extreme-edge scenario. These are DROPPED at source
>                  by /full-review. Only report them for the record; they will not be
>                  written to TODOS.md.
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
> **Subtraction first.** When 8 of 10 modules do it one way and 2 diverge,
> the conformance hypothesis is "make the 2 match the 8" — but ask first
> whether the 2 should be deleted, merged into another module, or whether
> the divergence is actually correct (the 8 might be the wrong pattern).
> Don't reflexively propose making the deviating modules conform; that's
> how codebases grow. Suggest the smallest change that resolves the
> inconsistency, including deletion.
>
> Your hypothesis is a starting point for investigation, not a prescription.
> Frame it as one possible direction; the implementer will re-verify the
> problem and choose the actual fix.
>
> Output EVERY finding in this exact format, one per line:
> FILE: <path> | LINE: <number or range> | SEVERITY: <critical|necessary|nice-to-have|edge-case> | DESCRIPTION: <what's wrong> | HYPOTHESIS: <one-sentence direction to investigate (verify before implementing)>
>
> SEVERITY semantics (see docs/source-tag-contract.md):
>   critical     — ship-blocker, data loss, security, correctness
>   necessary    — real defect, should fix in current or next Group
>   nice-to-have — legitimate improvement, OK to defer
>   edge-case    — hypothetical or extreme-edge scenario. These are DROPPED at source
>                  by /full-review. Only report them for the record; they will not be
>                  written to TODOS.md.
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
mkdir -p "$SESSION_DIR"
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

**Drop edge-case findings (A.11).** Before clustering, filter out every finding with
`SEVERITY: edge-case`. These represent hypothetical or extreme-edge scenarios that
downstream /roadmap triage would default-kill anyway. Filtering at source keeps
TODOS.md focused on real defects. Count them as `edge_case_dropped: N` in the final
report for visibility — `dropped`, not hidden.

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
- **Severity:** highest severity among its members
  (critical > necessary > nice-to-have; edge-case findings were already dropped in Step 1)
- **Count:** number of member findings
- **Findings:** the individual findings with file, line, description, fix
- **Action:** one-line summary of what fixing this cluster would involve

### Step 3: Write state checkpoint

Write clusters to `<SESSION_DIR>/clusters.md`. Update `session.yaml`:
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

Update `<SESSION_DIR>/clusters.md` with dedup annotations. Update
`session.yaml`: set `phase: dedup_complete`.

---

## Phase 4: Triage

Present clusters one at a time via AskUserQuestion. Order: critical clusters first,
then important, then minor.

### For each cluster:

Read the current cluster state from `<SESSION_DIR>/clusters.md` (not from
context). Find the first untriaged cluster.

Present via AskUserQuestion:

- **Question:** "[Action receipt]\n\n**Cluster [N]/[Total]: [Theme]** (severity: [severity], [count] findings)\n\n[List up to 3 example findings with file:line and description]\n\n[If pre_deduped: 'Already tracked in ROADMAP.md: [Group > Track] — recommend Reject']\n\n[If more than 3 findings: '...and [M] more']\n\n**Severity check:** does this cluster's severity still feel right? (critical/necessary/nice-to-have). Approving writes it to TODOS.md with the severity tag; /roadmap's scrutiny gate uses it to set defaults."
- **Options:** ["Approve", "Approve + reclassify severity", "Reject", "Defer", "Done triaging — reject remaining"]

### On Approve + reclassify

Offer a follow-up AskUserQuestion asking which severity the cluster should be
written with (critical / necessary / nice-to-have). Edge-case is not an option —
those are dropped at source before clustering. Update the cluster's severity
before persistence.

### On Approve

Mark all findings in this cluster for persistence. Update the cluster's triage
decision to `approved` in `<SESSION_DIR>/clusters.md`. Update
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

For each approved cluster, write each finding as a rich-format entry under
`## Unprocessed`, following `docs/source-tag-contract.md`:

```markdown
### [full-review:<severity>] <finding title>
- **Description:** <DESCRIPTION text from the finding — the reviewer agent's framing of what's wrong>
- **Hypothesis (untested):** <HYPOTHESIS text> — re-investigate before implementing; the reviewer agent did not verify this direction.
- **Found in:** <file>:<line>
- **Context:** From /full-review cluster "<theme>" on branch <branch> (<date>).
- **Effort:** ? (user triages in /roadmap)
```

Two framing choices are load-bearing:
- `**Description:**` (not `**Why:**`) signals the reviewer's analytical
  framing of the issue — neither verified causation nor a direct observation.
  The implementer should read it as "here's what the reviewer thinks is wrong"
  and re-verify before acting.
- `**Hypothesis (untested):**` (not `**Proposed fix:**` or `**Fix:**`) signals
  that the suggested direction is speculation, not a verified fix.

Do not rename either field back to verified-sounding language — that framing
is what created the tunnel-vision problem this skill exists to avoid.

If the finding's cluster has a single file (`files=` hint available), include
it as a tag attribute for /roadmap's placement heuristic:

```markdown
### [full-review:<severity>,files=<path>] <finding title>
```

Order within the section: critical first, then necessary, then nice-to-have.
(edge-case findings were dropped in Phase 2.)

**IMPORTANT:** Append to the existing `## Unprocessed` section. Do NOT remove or
modify existing items. Do NOT create new sections.

### Step 4: Commit

Stage the TODOS.md file (whichever path was used) and commit:
```bash
git add <path-to-TODOS.md>
```
```bash
_OUT=$(git commit -m "chore: add full-review findings to TODOS.md (<N> items)" 2>&1)
_RC=$?
if [ $_RC -ne 0 ]; then echo "$_OUT"; fi
```

If the commit fails because there's nothing to commit, that's fine — continue.
The captured `$_OUT` surfaces any real failure (pre-commit hook reject, missing
`user.email`, detached HEAD, etc.) instead of swallowing it silently.

### Step 5: Write report

Write `<SESSION_DIR>/report.md`:

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
- Total findings (post-edge-case-drop): <N>
- Edge-case findings dropped at source (A.11): <N>
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
Glob pattern: <SESSION_DIR>/session.yaml
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

<!-- SHARED:completion-status-enum -->
## Completion Status Protocol

When completing a skill workflow, report status using one of:

- **DONE** — All steps completed successfully. Evidence provided for each claim.
- **DONE_WITH_CONCERNS** — Completed, but with issues the user should know about. List each concern.
- **BLOCKED** — Cannot proceed. State what is blocking and what was tried.
- **NEEDS_CONTEXT** — Missing information required to continue. State exactly what you need.
<!-- /SHARED:completion-status-enum -->

For /full-review specifically: map the six session phases (`dispatch_complete`,
`clusters_complete`, `dedup_complete`, `triage_complete`, `complete`) and per-agent
outcomes to the session-level enum at `/full-review done` time. Rollup rule:

- All 3 agents completed, clustering + dedup + triage done, approved items written to TODOS.md → **DONE**
- Complete but some clusters deferred, or agents returned warnings that weren't actioned → **DONE_WITH_CONCERNS** (list deferred clusters + warnings)
- One or more agents timed out, crashed, or returned no usable output AND no fallback path succeeded → **BLOCKED**
- Session interrupted or state files are missing/malformed on resume → **NEEDS_CONTEXT**

<!-- SHARED:escalation-opener -->
### Escalation

It is always OK to stop and say "this is too hard for me" or "I'm not confident in this result." Bad work is worse than no work. You will not be penalized for escalating.
<!-- /SHARED:escalation-opener -->

- If an agent has been retried 3 times without producing usable output, STOP and escalate.
- If you are uncertain whether a cluster represents a real issue or a false positive, STOP and present the evidence.
- If the scope of findings exceeds what can be sensibly triaged in one session, STOP and escalate (offer to split into multiple sessions).

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

- Two plausible root-cause framings for the same set of findings (different clusterings lead to different remediations).
- A request that contradicts the existing triage record (e.g., user wants to approve a cluster already marked rejected).
- A destructive or irreversible operation where the scope is unclear (e.g., "restart" — discard clusters? discard triage decisions? rerun the agents?).
- Missing context that would change the clustering significantly (unknown hot areas, ambiguous ownership, conflicting prior reviews).

STOP. Name the ambiguity in one sentence. Present 2-3 options with tradeoffs. Ask the user via AskUserQuestion. Do not guess on decisions that affect TODOS.md writes or the approval record.

This does NOT apply to routine cluster naming, obvious approve/reject calls where the evidence is unambiguous, or small clarifications.

## GSTACK REVIEW REPORT

At session-done, prepend this table to `<SESSION_DIR>/report.md` as the first section (above the narrative clusters). Also emit it verbatim in the chat response so the user gets the same dashboard immediately.

Template:

```markdown
## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Full Review | `/full-review` | Weekly codebase sweep | 1 | <STATUS> | <N> clusters (<approved> approved, <deferred> deferred, <rejected> rejected) |

**VERDICT:** <STATUS> — <one-line summary>
```

Substitutions:

- `<STATUS>` is the Completion Status Protocol enum computed at session-done: `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT`.
- `<N>`, `<approved>`, `<deferred>`, `<rejected>` come from the triage record.
- `<one-line summary>` names the concrete outcome: "3 approved clusters landed in TODOS.md", "2 deferred for next review", "agent dispatch blocked — see BLOCKED entry above", etc.

Verdict-to-status mapping (same as the Completion Status Protocol rollup):

- All 3 agents completed + clustering + dedup + triage done + approved items written → verdict "DONE — <N> approved clusters landed in TODOS.md".
- Complete with deferred clusters or warnings → verdict "DONE_WITH_CONCERNS — <specifics>".
- Agent timeout/crash/no-output → verdict "BLOCKED — <which agent>, <what was tried>".
- State files missing on resume → verdict "NEEDS_CONTEXT — <which state is missing>".

The table always leads. The narrative clusters, decision trail, and triage log stay below it.
