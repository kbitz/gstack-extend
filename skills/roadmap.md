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
- C) Skip audit findings, go straight to triage

## Step 2: Triage

Before organizing anything into Groups > Tracks > Tasks, decide which TODOs to keep
and which phase they belong to. This prevents roadmapping dead weight and keeps the
execution plan focused on what you're actually doing now.

### Step 2a: Keep or Kill

Read the items to triage:
- **Overhaul mode:** ALL items in TODOS.md (building the roadmap from scratch, so
  every item gets triaged).
- **Triage mode:** ONLY items in the `## Unprocessed` section of TODOS.md. Items
  already organized in ROADMAP.md are NOT re-triaged.

**Auto-suggest kills:** Before presenting the keep/kill table, check for items that
are likely dead:
1. Feed any STALENESS audit findings (from Step 1) as "suggest: kill" entries. These
   are items marked DONE whose version tag exists — they should have been deleted.
2. Read backtick-quoted file paths (`` `path/to/file` ``) from TODO descriptions. Run
   `git ls-files` to check if referenced files still exist. Flag missing paths as
   "suggest: kill (referenced file deleted)".

**One-by-one triage:** Present each item individually via AskUserQuestion. Never
cluster or batch items — every item gets its own prompt with full context.

For each item, before presenting:
1. Extract a distinctive phrase from the item title (3-5 words).
2. Run `git log --oneline -1 -S "distinctive phrase" -- <TODOS-file-path>` to find
   when the item was introduced.
3. If the git log returns a result, extract the commit date and check if the commit
   message contains a PR number (e.g., `(#123)`). Format as:
   `Introduced: <relative time ago> (<commit short hash>, PR #NNN)` — or without
   the PR number if none was found.
4. If the git log returns nothing, show `Provenance: unknown`.

Present each item via AskUserQuestion with this format:
```
**Item [N]/[Total]: [item title]**

[Full item description from TODOS.md]
[If auto-suggest kill: "⚠ Suggest kill: [reason]"]
[Provenance line from step 3 above]
```

Options: ["Keep", "Kill"]

Killed items get deleted — git has the history.

**Edge case:** If ALL items are killed, exit gracefully: "All items killed. No roadmap
to build. TODOS.md cleaned." Skip to Step 4 (Update PROGRESS.md) and Step 6 (Commit).

### Step 2b: Phase Assignment

For each surviving item, assign it to the current phase or a future phase.

**Current phase** is determined by the major version in VERSION:
- v0.x = "pre-1.0" phase
- v1.x = "v1" phase
- etc.

Future items go into a single "Future" bucket (flat list in ROADMAP.md). Multi-phase
roadmapping is deferred until phase transition detection ships.

Present each surviving item with a recommended phase assignment. Use AskUserQuestion
to confirm. Items assigned to the current phase proceed to Step 3 for full Groups >
Tracks > Tasks treatment. Items assigned to future go directly to the `## Future`
section in ROADMAP.md (flat list, not structured).

**IMPORTANT:** Phase assignment happens BEFORE Group/Track placement. Future items
skip Group/Track entirely. Only current-phase items get the structured treatment.

**Edge case:** If ALL items are assigned to "future," write ROADMAP.md with just the
Future section (no Groups). This is a valid roadmap state.

### Step 2c: Triage Summary

After triage completes, present a summary:
"Triaged N items: kept M, killed K. Assigned X to current phase, Y to future."

## Step 3: Build/Update ROADMAP.md

Read TODOS.md (the inbox), ROADMAP.md (if it exists), recent git history, and the
codebase file structure.

### Mode: Overhaul (first run or no ROADMAP.md)

This is the full restructure path. Read everything in TODOS.md, organize it into
Groups > Tracks > Tasks, and write the result to ROADMAP.md. After writing, clean
TODOS.md: remove all organized items, leaving only the `## Unprocessed` section
header (empty, ready for future inbox items from other skills).

### Vocabulary Rules

**Unconditionally banned** in ROADMAP.md (case-insensitive):
- Cluster
- Workstream
- Milestone
- Sprint

**Contextually controlled:**
- **Phase** — allowed ONLY for top-level scoping:
  - The ROADMAP.md title (e.g., `# Roadmap — Phase 1 (v0.x)`)
  - The `## Future (Phase 2+)` section header and content
- **Phase** is BANNED everywhere else: inside Group headings, Track headings, task
  descriptions, or as a synonym for Group. "Phase" means "a collection of groups that
  constitute a release." It is NOT a synonym for Group, Track, or any structural unit.

**Permitted structural terms:** **Group**, **Track**, **Task**, **Pre-flight**.
**Permitted scoping term:** **Phase** (top-level only, as described above).

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

8. **Unprocessed items are drained by triage.** Step 2 (Triage) processes all items
   including any in the `## Unprocessed` section. After triage, the Unprocessed section
   is empty (all items were kept/killed and phase-assigned). Keep the `## Unprocessed`
   heading in ROADMAP.md even when empty (other skills will write to it again).

### Output Template

Write the structured execution plan to ROADMAP.md following this exact format:

```markdown
# Roadmap — Phase N (vX.x)

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

## Future (Phase N+1+)

Items triaged but deferred to a future phase. Not organized into Groups/Tracks.
Will be promoted to the current phase and structured when their time comes.

- **[Item title]** — [description]. _Deferred because: [reason]._

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
structure (Groups > Tracks, or Future-only). Only the `## Unprocessed` section in
TODOS.md is processed. Items move from TODOS.md (inbox) into ROADMAP.md.

**Note:** Triage mode does NOT run keep/kill on inbox items. These are fresh items
just added by /pair-review or /investigate, so they don't need keep/kill triage.
They only need phase assignment and Group/Track placement.

**Step 3a: Read the Unprocessed section from TODOS.md.** Parse each item, noting its
source tag (`[pair-review]`, `[manual]`, `[investigate]`, etc.) and description.

**Step 3b: Phase assignment (before Group/Track placement).** For each unprocessed
item, ask: current phase or future? Items assigned to "future" go directly to the
`## Future` section in ROADMAP.md. Only current-phase items proceed to Step 3c for
Group/Track placement.

**Step 3c: Classify current-phase items against ROADMAP.md.** If ROADMAP.md is
future-only (no Groups exist), create new Group/Track structure for the current-phase
items (a mini-overhaul while preserving the Future section). Otherwise, for each item
assigned to the current phase, determine:
- Which existing Group in ROADMAP.md it belongs to (based on dependency position)
- Which existing Track it fits in (based on file ownership overlap)
- Whether it needs a new Track (no existing track touches those files)
- Whether it's a Pre-flight item (trivial, < 30 min)

Use the source tag as a signal:
- `[pair-review]` items are usually bugs, likely belong in a bug-fix group/track
- `[manual]` items are feature requests or improvements, classify by area
- `[investigate]` items are usually bugs found during debugging

**Step 3d: Propose triage.** Present the proposed placement of each item via
AskUserQuestion:
```
Triaging 5 unprocessed items:

1. [pair-review] Arrow key double-move → Track 2A: Message List Core (current phase)
2. [pair-review] NSNull crash → Track 2A: Message List Core (current phase)
3. [manual] Cmd+Arrow navigation → Track 2A: Message List Core (current phase)
4. [pair-review] Draft conflict → NEW Track 2F: Draft Safety (current phase)
5. [manual] Template emails → Future (deferred: not needed until v2)
```

Options:
- A) Approve all placements
- B) Adjust placements (specify which items to move)

**Step 3e: Apply triage.** Add current-phase items to their assigned Group/Track in
ROADMAP.md. Add future items to the `## Future` section. Update track metadata (task
count, effort). Remove the triaged items from the `## Unprocessed` section in
TODOS.md. Keep the `## Unprocessed` heading even when empty.

**Step 3f: Revalidate.** Check if the triage changed any dependency ordering. If a new
item in Group 2 actually blocks something in Group 1, flag it. Check if any track
metadata is stale (task count changed).

Options:
- A) Approve restructured ROADMAP.md
- B) Revise (specify which sections)
- C) Revert to original

## Step 4: Update PROGRESS.md

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

## Step 5: Version Recommendation

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

## Step 6: Commit

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

**Data flow:** Skills write to TODOS.md (inbox) -> /roadmap triages (keep/kill + phase
assignment), then writes current-phase items to ROADMAP.md (structured plan) and future
items to ROADMAP.md's Future section -> /document-release prunes completed items from
ROADMAP.md.
