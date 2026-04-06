---
name: roadmap
description: |
  Documentation restructuring skill. Reorganizes TODOS.md into Groups > Tracks > Tasks
  with dependency-chain ordering and file-ownership grouping for parallel agent execution.
  Audits versioning, validates doc taxonomy, and recommends version bumps.
  Use when asked to "restructure TODOs", "clean up the roadmap", "reorganize backlog",
  "tidy up docs", or after a big batch of work that generated many new TODOs.
  Proactively suggest when TODOS.md has grown significantly or structure looks stale.
  Works for any project type.
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
_SKILL_SRC=$(readlink ~/.claude/skills/roadmap/SKILL.md 2>/dev/null)
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

**If `AUTO_UPGRADE=true`:** Skip asking. Log "Auto-upgrading gstack-extend v{old} -> v{new}..." and run:
```bash
"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"
```
After upgrade, tell user: "Update installed. Next invocation will use v{new}."
If it fails, warn: "Auto-upgrade failed. Run `git -C $_EXTEND_ROOT pull` manually."

**Otherwise**, use AskUserQuestion:
- Question: "gstack-extend **v{new}** is available (you're on v{old}). Upgrade now?"
- Options: ["Yes, upgrade now", "Always keep me up to date", "Not now", "Never ask again"]

Handle responses the same way as /pair-review (see pair-review.md inline upgrade flow).

---

# /roadmap -- Documentation Restructuring

Restructures TODOS.md into a clean execution plan with consistent vocabulary, dependency
ordering, and file-ownership grouping. Audits versioning and doc taxonomy.

**HARD GATE:** This skill produces documentation changes ONLY. Never modify source code,
configs, or CI files. The only files this skill writes to are ROADMAP.md, TODOS.md
(to drain the inbox), PROGRESS.md, and (indirectly via recommendation) VERSION.

**File ownership:**
- **TODOS.md** = inbox. Other skills write here (pair-review, investigate, manual). /roadmap reads and drains it.
- **ROADMAP.md** = structured execution plan. /roadmap owns this. Groups > Tracks > Tasks live here.

## Step 1: Audit

Run the deterministic audit script against the current repo:

```bash
_SKILL_SRC=$(readlink ~/.claude/skills/roadmap/SKILL.md 2>/dev/null)
_EXTEND_ROOT=$(dirname "$(dirname "$_SKILL_SRC")" 2>/dev/null)
"$_EXTEND_ROOT/bin/roadmap-audit"
```

Present the findings as a summary to the user. For each check that failed:
- **VOCAB_LINT failures:** List each banned term and its line number.
- **STRUCTURE failures:** Explain what's wrong with the current organization.
- **STALENESS failures:** List completed items that should be deleted. Suggest running
  `/document-release` first if there are many stale items.
- **VERSION failures:** Report mismatches and invalid versions.
- **TAXONOMY failures:** Report missing or duplicate docs.
- **DEPENDENCIES failures:** Report broken track references.
- **UNPROCESSED found:** Report the number of items awaiting triage.

### Mode Detection

The audit outputs a `## MODE` section with `DETECTED: overhaul` or `DETECTED: triage`.

- **Overhaul mode** (no Groups > Tracks structure): Full restructure of the entire TODOS.md.
  Every item gets reorganized from scratch.
- **Triage mode** (valid structure exists): Process only the `## Unprocessed` section.
  Move items into existing Groups/Tracks or create new Tracks as needed. Do NOT
  restructure items that are already organized.

If MODE is triage and the Unprocessed section is empty (ITEMS: 0), run a quick
validation (audit findings only) and exit: "Roadmap looks good. No unprocessed items
to triage." Do NOT prompt for a full restructure.

Use AskUserQuestion to confirm which violations to address. Options:
- A) Fix all violations (recommended)
- B) Fix selected violations (let me choose)
- C) Skip audit findings, go straight to restructuring

## Step 2: Build/Update ROADMAP.md

Read TODOS.md (the inbox), ROADMAP.md (if it exists), recent git history, and the
codebase file structure.

### Mode: Overhaul (first run or no ROADMAP.md)

This is the full restructure path. Read everything in TODOS.md, organize it into
Groups > Tracks > Tasks, and write the result to ROADMAP.md. After writing, clean
TODOS.md: remove all organized items, leaving only the `## Unprocessed` section
header (empty, ready for future inbox items from other skills).

### Banned Vocabulary

**NEVER use these terms in TODOS.md** (case-insensitive):
- Phase
- Cluster
- Workstream
- Milestone
- Sprint

The ONLY permitted organizational terms are: **Group**, **Track**, **Task**, **Pre-flight**.

### Restructuring Rules

1. **Primary axis: dependency chains.** What blocks what? Groups are sequential: complete
   Group 1 before starting Group 2. Earlier groups should contain foundational work that
   makes later groups easier (refactors before features, infrastructure before UI).

2. **Secondary axis: file ownership.** Within each group, tracks are organized by which
   files/modules they primarily touch. This minimizes merge conflicts when multiple agents
   work in parallel. If two tasks touch the same file, they go in the same track.

3. **Pre-flight section:** Trivial fixes (< 30 min each, not worth a formal track) get
   batched into a Pre-flight section at the top of each group. Any agent can pick these up.

4. **Track metadata:** Every track MUST have an italic metadata line immediately after the
   heading:
   ```
   _N tasks . ~X days (human) / ~Y min (CC) . [low/medium/high] risk . [primary files]_
   ```

5. **Task format:** Each task is a bullet with bold title, description, affected files,
   and effort estimate:
   ```
   - **[Task title]** -- [description]. _[files affected], ~N lines._ (S/M/L)
   ```

6. **Execution map:** At the end, include an ASCII visualization showing group sequence
   and track parallelism within each group.

7. **Delete completed items.** Completed work gets deleted from TODOS.md. Git has the
   history. Do NOT use strikethrough, checkmarks, or "DONE" annotations.

8. **Preserve Unprocessed items during overhaul.** If an `## Unprocessed` section exists
   with items, carry those items forward verbatim into the new `## Unprocessed` section
   at the bottom. Do NOT attempt to triage them during overhaul. Keep the source tags
   and format intact. Triage happens on the next run (when the structure is valid).

### Output Template

Write the structured execution plan to ROADMAP.md following this exact format:

```markdown
# Roadmap

Organized as **Groups > Tracks > Tasks**. Groups are sequential (complete one before
starting the next). Tracks within a group run in parallel. Each track is one plan +
implement session. Tracks are organized by file ownership to minimize merge conflicts
between parallel agents.

---

## Group 1: [Name]

[1-2 sentence rationale for why this group comes first]

**Pre-flight** (any agent, <30 min, before starting tracks):
- [trivial fix 1]
- [trivial fix 2]

### Track 1A: [Name]
_N tasks . ~X days (human) / ~Y min (CC) . [low/medium/high] risk . [primary files]_

[Optional: Depends on: Track 1C]
[Optional: 1 sentence on what this track owns]

- **[Task title]** -- [description]. _[files affected], ~N lines._ (S/M/L)

---

## Group 2: [Name]
...

---

## Execution Map

```
Group 1: [Name]
  Pre-flight .............. ~30 min
  +-- Track 1A ........... ~X days .. N tasks
  +-- Track 1B ........... ~X days .. N tasks
                  |
Group 2: [Name]
  +-- Track 2A ........... ~X days .. N tasks
```

**Total: N groups . M tracks . P tasks**

---

## Unprocessed

Items awaiting triage by /roadmap. Added by other skills or manually.

- [source] Item description (date or context)
```

### When STRUCTURE audit shows many violations (>5)

Propose a full rewrite rather than incremental edits. Tell the user: "The current
structure has significant violations. I recommend a complete restructure into
Groups > Tracks > Tasks rather than trying to patch the existing layout."

### Approval (Overhaul Mode)

Write ROADMAP.md to disk. Clean TODOS.md (remove organized items, keep empty
`## Unprocessed` header). Present a summary via AskUserQuestion:
- How many groups, tracks, and tasks
- What changed from the previous structure (items added/removed/reordered)
- Any items that were hard to classify

Options:
- A) Approve restructured TODOS.md
- B) Revise (specify which sections)
- C) Revert to original

### Mode: Triage (subsequent runs, structure exists)

This path runs when the audit detects MODE: triage. ROADMAP.md already has a valid
Groups > Tracks > Tasks structure. Only the `## Unprocessed` section in TODOS.md
is processed. Items move from TODOS.md (inbox) into ROADMAP.md (structured plan).

**Step 2a: Read the Unprocessed section from TODOS.md.** Parse each item, noting its source tag
(`[pair-review]`, `[manual]`, `[investigate]`, etc.) and description.

**Step 2b: Classify each item against ROADMAP.md.** For each unprocessed item, determine:
- Which existing Group in ROADMAP.md it belongs to (based on dependency position)
- Which existing Track it fits in (based on file ownership overlap)
- Whether it needs a new Track (no existing track touches those files)
- Whether it's a Pre-flight item (trivial, < 30 min)

Use the source tag as a signal:
- `[pair-review]` items are usually bugs, likely belong in a bug-fix group/track
- `[manual]` items are feature requests or improvements, classify by area
- `[investigate]` items are usually bugs found during debugging

**Step 2c: Propose triage.** Present the proposed placement of each item via
AskUserQuestion:
```
Triaging 5 unprocessed items:

1. [pair-review] Arrow key double-move → Track 2A: Message List Core (same files)
2. [pair-review] NSNull crash → Track 2A: Message List Core (SyncMutationService)
3. [manual] Cmd+Arrow navigation → Track 2A: Message List Core (KeyboardRouter)
4. [pair-review] Draft conflict → NEW Track 2F: Draft Safety (ComposeViewModel)
5. [manual] Template emails → Track 3B: Template Emails (existing)
```

Options:
- A) Approve all placements
- B) Adjust placements (specify which items to move)

**Step 2d: Apply triage.** Add each item to its assigned Group/Track in ROADMAP.md.
Update track metadata (task count, effort). Remove the triaged items from the
`## Unprocessed` section in TODOS.md. Keep the `## Unprocessed` heading even when
empty (other skills will write to it again).

**Step 2e: Revalidate.** Check if the triage changed any dependency ordering. If a new
item in Group 2 actually blocks something in Group 1, flag it. Check if any track
metadata is stale (task count changed).

Options:
- A) Approve restructured TODOS.md
- B) Revise (specify which sections)
- C) Revert to original

## Step 3: Update PROGRESS.md

Check if a version was bumped since the last PROGRESS.md entry.

If PROGRESS.md exists:
- If a new version shipped that isn't in PROGRESS.md, append a row to the version table.
- Verify the phase status table is current (do groups in TODOS.md align with roadmap?).
- The roadmap section of PROGRESS.md uses its own natural language (not forced into
  Groups vocabulary). If TODOS.md has "Group 1: Refactors", the roadmap might say
  "Current: code cleanup and refactoring."

If PROGRESS.md doesn't exist:
- Create one with a single row for the current VERSION (or v0.1.0 if no VERSION file).
- Add a phase status section and release roadmap.

## Step 4: Version Recommendation

Based on changes since the last tag (or VERSION baseline if no tags):

| Change type | Recommended bump |
|-------------|-----------------|
| Bug fix, small feature, polish | PATCH (0.0.x) |
| Phase completion, capability boundary | MINOR (0.x.0) |
| Breaking changes, public launch | MAJOR (x.0.0) |
| Doc-only, config, CI changes | None |

**Important:** /roadmap only RECOMMENDS a version bump. It does NOT write to VERSION.
Tell the user: "I recommend bumping to vX.Y.Z. Run `/ship` to execute the bump."

If no bump is needed, say so.

## Step 5: Commit

Stage only documentation files:
- ROADMAP.md (structured execution plan)
- TODOS.md (cleaned inbox)
- PROGRESS.md (if modified)

Commit with message: `docs: restructure roadmap (Groups > Tracks > Tasks)`

**Never stage VERSION, CHANGELOG.md, or any code files.**

## Documentation Taxonomy Reference

This skill enforces these doc ownership boundaries:

| Doc | Purpose | Owned by |
|-----|---------|----------|
| TODOS.md | "Inbox" -- unprocessed items from other skills | /pair-review, /investigate (write), /roadmap (drain) |
| ROADMAP.md | "Execution plan" -- Groups > Tracks > Tasks | /roadmap (owns structure) |
| PROGRESS.md | "Where we are" -- append-only version history, phase status | /roadmap (structure), /document-release (content) |
| CHANGELOG.md | "What users get" -- user-facing release notes | /document-release only |
| docs/plan.md | "Where we're going" -- product vision | Manual / /office-hours |
| docs/designs/*.md | "Why we chose this" -- architecture decisions | /office-hours |
| VERSION | SemVer source of truth | /roadmap (recommends), /ship (executes) |

**Data flow:** Skills write to TODOS.md (inbox) -> /roadmap reads TODOS.md, writes to
ROADMAP.md (structured plan) -> /document-release prunes completed items from ROADMAP.md.
