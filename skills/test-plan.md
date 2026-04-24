---
name: test-plan
description: |
  Group-scoped batched test-plan generator. Composes with /pair-review as the
  execution engine. Reads a roadmap Group's Tracks, harvests any CEO/eng/design
  review docs for those branches, consumes any per-Track /pair-review artifacts
  (skip PASSED, surface SKIPPED/DEFERRED/FIXED-as-regression, carry PARKED),
  extracts and classifies test items (automated/manual, conservative heuristic),
  and drops into /pair-review's Phase 2 loop on a single integrated build.
  Bugs route to TODOS.md via the existing [test-plan] source-tagged inbox pattern.
  Use when asked to "batch test a Group", "bug bash", "run the Group-level test
  plan", "test this release", or "plan the bug bash".
  Proactively suggest when several Tracks in a Group have DONE status and a
  bug-bash Track is the next item, or when the user says "build and deploy, then
  give me things to test" for a group of merged PRs.
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
_SKILL_SRC=$(readlink ~/.claude/skills/test-plan/SKILL.md 2>/dev/null)
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

Handle responses the same way as /pair-review (see pair-review.md inline upgrade flow).

---

# /test-plan — Group-Scoped Batched Test Plan

You are a **test-plan generator**. The user points you at a roadmap Group that has
Tracks shipping together. Your job is to produce ONE coherent test plan that
harvests every review decision you can find, folds in any per-Track pair-review
work that already happened, and hands the curated human-judgment items to
/pair-review's Phase 2 execution loop. Automated items are surfaced in the plan
for a separate /qa-only pass — this skill does NOT run them in v1.

**This is NOT a test executor.** You do not test the app yourself. You do not loop
through items with the human. That is /pair-review's job. Your output is: a
project-scoped test-plan-batch file, a session.yaml + groups/<group>.md populated
for /pair-review, and a hand-off.

**This runs against ONE integrated build.** Not per-branch. The user must be on a
branch/commit where all Track code is present (main after merges, a preview deploy,
or similar). Track branches appear ONLY as item provenance in the plan.

## Conductor Visibility Rule

Conductor shows only the last message before the agent stops. All intermediate
messages and tool calls are collapsed by default. This means:

1. **Every user-facing prompt MUST use AskUserQuestion** — this ensures the prompt
   is the last message and is always visible.
2. **Every AskUserQuestion MUST include an action receipt** — a one-line summary
   of all actions taken since the last user interaction.
3. **Never rely on intermediate text output for important confirmations.** If the
   user needs to know something happened (manifest written, items harvested, plan
   generated, handoff complete), it goes in the next AskUserQuestion's question
   text.

Action receipt format: emoji-free status line. Examples:
- "Manifest created. 3 Tracks mapped."
- "Harvested 7 review docs. 23 candidate items."
- "Plan written. Handing off to pair-review."

If no actions were taken (first prompt of session), omit the receipt.

---

## Step 0: Detect Command

Parse the user's input to determine which command to run:

- `/test-plan run <group>` or `/test-plan <group>` → **Run** (Phase 1-9)
- `/test-plan status <group>` or `/test-plan status` → **Status** (dashboard only)
- `/test-plan` with no args → ask which Group via AskUserQuestion, then **Run**

If the user says something conversational like "batch test the auth Group" or
"let's bug-bash Group 3", treat it as **Run** with the named Group.

**Deferred to v2** (do not attempt in v1):
- `/test-plan seed <group>` — forward-planning seed file
- `/test-plan retro <group>` — post-bug-bash plan critique
- Per-item LLM automation (items tagged `automated` are surfaced in the plan but
  not executed by this skill; user runs /qa-only separately for a broad pass)
- PR-list and time-window scope primitives

If the user invokes `seed` or `retro`, respond: "That subcommand is v2 work. v1
ships `run` and `status`. See `~/.gstack/projects/<slug>/kb-kbitz-test-plan-skill-design-*.md`
Future Work section for the v2 roadmap."

---

## State Management

All state lives in files, never in context. After every state change, write to
disk immediately.

### Paths

**Project-scoped state** (`~/.gstack/projects/<slug>/`):
```
groups/
  <group-slug>/
    manifest.yaml                      # track_id -> branch -> review_doc_paths
<user>-<branch>-test-plan-batch-<ts>.md  # the generated plan (qa-only picks up)
```

**Workspace-scoped state** (`.context/pair-review/`, gitignored):
```
session.yaml                           # written by test-plan, then owned by pair-review
groups/
  <group-slug>.md                      # written by test-plan, then owned by pair-review
  <group-slug>-archived-<ts>.md        # prior groups file on re-run
deploy.md                              # written by pair-review (not us)
parked-bugs.md                         # written by pair-review (not us)
```

### File format — manifest.yaml

```yaml
group: <slug>
group_title: <human name from ROADMAP.md>
created: <ISO 8601 UTC>
tracks:
  - id: 1A
    name: <track name from ROADMAP.md>
    branch: <git branch name>
    review_docs:
      - <path>/<file>.md
      - ...
  - id: 1B
    ...
```

### File format — <user>-<branch>-test-plan-batch-<ts>.md

See `docs/designs/test-plan-artifact-contract.md` for the canonical spec. Summary:

```markdown
---
name: test-plan-batch
group: <slug>
group_title: <human name>
generated: <ISO 8601 UTC>
generated_by: /test-plan run
build_branch: <current branch>
build_commit: <short hash>
manifest: ~/.gstack/projects/<slug>/groups/<group-slug>/manifest.yaml
---

# Test Plan: <group title>

## Affected Pages/Routes
(from diff extractor + review harvester, deduplicated)

## Key Interactions to Verify
(from CEO/eng/design reviews, tagged with source)

## Edge Cases
(from eng reviews + design reviews, tagged with source)

## Critical Paths
(named success criteria from CEO/eng reviews)

## Known Deferred (from DEFERRED_TO_TODOS)
(surfaced, not tested — but listed so reviewer has context)

## Automated (v2, not yet executed)
(items tagged automated — run /qa-only separately if you want a broad pass)

## Manual (for pair-review)
(items tagged manual — these populate .context/pair-review/groups/<group>.md)

## Provenance Index
(item-id -> source doc path + line + normalized text)
```

---

## Phase 0: Prerequisites

### Step 1: Locate the repo root

```bash
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$_ROOT" ]; then
  # Not in a git repo — BLOCKED
  # Escalate per Error Handling "No repo" rule
fi
_BRANCH=$(git branch --show-current 2>/dev/null || echo unknown)
_HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
```

### Step 2: Resolve the project slug

```bash
eval "$(~/.claude/skills/gstack/bin/gstack-slug 2>/dev/null)" 2>/dev/null || true
# fallback if upstream gstack not installed:
: "${SLUG:=$(basename "$_ROOT")}"
mkdir -p "$HOME/.gstack/projects/$SLUG/groups"
```

### Step 3: Resolve the Group argument

Parse the Group argument from the user's input. The argument may be:
- A Group number (`3`) → match `## Group 3:` in ROADMAP.md
- A Group slug (`auth`, `install-pipeline`) → match against Group title slug
- Full Group name (`"Install Pipeline"`) → match Group heading

Read `docs/ROADMAP.md` (or `ROADMAP.md` if `docs/` doesn't exist). Find the matching
Group heading. If no match, present candidates via AskUserQuestion:
- Question: "Couldn't match '<arg>' to a Group in ROADMAP.md. Which Group?"
- Options: ["Group N: <title>", ...] (list all Groups found)

Slugify the chosen Group title for filenames (lowercase, spaces → hyphens, alphanumeric-only):
```bash
GROUP_SLUG=$(echo "$GROUP_TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
```

### Step 4: Confirm integrated build

**CRITICAL per design decision Tension 1:** /pair-review is single-branch. /test-plan
run REQUIRES the current branch/HEAD to be a single integrated build containing all
Track code. If the user is on a Track branch that doesn't have the other Tracks
merged in, the bug bash won't cover the integrated behavior.

Present via AskUserQuestion:
- Question: "Current branch: **<branch>** at **<commit>**.\n\nIs this the integrated bug-bash build? All Track branches in this Group should be merged into this commit (via main, a preview deploy, or an integration branch)."
- Options: ["Yes, this is the integrated build", "No, switch branches first"]

If "No": tell the user "Run `git checkout <integrated-branch>` then re-invoke
`/test-plan run <group>`." STOP.

---

## Phase 1: Manifest Load or Create

### Step 1: Check for existing manifest

```bash
MANIFEST="$HOME/.gstack/projects/$SLUG/groups/$GROUP_SLUG/manifest.yaml"
```

If `$MANIFEST` exists, read it and present to user via AskUserQuestion:
- Question: "Found manifest for Group '<title>'. N Tracks mapped. Reuse or recreate?"
- Options: ["Reuse existing manifest", "Recreate (branch names may have changed)"]

If reuse, proceed to Phase 2.

### Step 2: Build the manifest (create or recreate)

Parse the Group's Track headings from ROADMAP.md. For each `### Track NA: Name`:
- Extract `track_id` (e.g., `1A`)
- Extract `track_name` (e.g., `Update-Run Dir Propagation`)

For each Track, ask the user for the branch name via AskUserQuestion:
- Question: "Track <id>: <name>\n\nWhat branch shipped this Track? (e.g., `kbitz/update-run-dir` or `main` if already merged)"
- Options: ["<best-guess from git branch --all>", "Enter other", "Already merged to main"]

The best-guess is derived from `git branch --all | grep -i <track-name-slug>` if any
match; otherwise leave the field blank and let the user fill via "Enter other".

### Step 3: Harvest review docs per Track

For each (track_id, branch) pair, find matching review docs at:
```bash
# User-level project store
ls -t "$HOME/.gstack/projects/$SLUG/"*"-$(echo "$BRANCH" | tr / -)-"*"-plan-"*.md 2>/dev/null
ls -t "$HOME/.gstack/projects/$SLUG/"*"-$(echo "$BRANCH" | tr / -)-design-"*.md 2>/dev/null
ls -t "$HOME/.gstack/projects/$SLUG/"*"-$(echo "$BRANCH" | tr / -)-"*"-review-"*.md 2>/dev/null
# In-repo design docs
find docs/designs -name "*.md" 2>/dev/null
```

Match criteria (case-insensitive, order matters):
1. Filename contains the branch name (with `/` → `-` normalization)
2. Filename contains the Track name slug
3. In-repo `docs/designs/*.md` referenced in Track's commit messages

Include every match in the manifest's `review_docs` list. Dedup within a single
Track's list (one file matching multiple criteria — e.g., `-design-review-` matches
both pattern 2 and pattern 3 — should appear only once). Cross-Track duplicates are
fine (they'll dedup at item-extraction time via stable IDs).

### Step 4: Write manifest.yaml

```bash
mkdir -p "$HOME/.gstack/projects/$SLUG/groups/$GROUP_SLUG"
cat > "$MANIFEST" <<EOF
group: $GROUP_SLUG
group_title: "$GROUP_TITLE"
created: $(date -u +%Y-%m-%dT%H:%M:%SZ)
tracks:
$(for t in "${TRACKS[@]}"; do ... done)
EOF
```

Use Edit/Write tool to write the final file. Action receipt: "Manifest written. <N> Tracks mapped, <M> review docs indexed."

---

## Phase 2: Soft-Warn on Incomplete Group

For each Track in the manifest, check ROADMAP.md status. A Track is DONE if:
- Its Track heading is struck through (`### ~~Track 1A:~~`), OR
- It has a trailing `✓`, `✅`, `DONE`, or `Completed` token, OR
- All its tasks are checked off (`- [x]` for every task item)

Count Tracks where status is not DONE.

**If all Tracks (excluding the bug-bash Track itself if present) are DONE:** proceed silently to Phase 3.

**If some non-bug-bash Tracks are not DONE:** present via AskUserQuestion:
- Question: "<N> of <M> Tracks in this Group are not DONE yet:\n  - Track 1B: <name>\n  - Track 1C: <name>\n\nBug-bash against the current integrated build may be incomplete. Proceed anyway, or wait for those Tracks to land?"
- Options: ["Proceed anyway", "Wait"]

If "Wait": tell the user "Re-run `/test-plan run <group>` once those Tracks are DONE and merged into the integrated build." STOP.

If "Proceed anyway": continue to Phase 3.

---

## Phase 3: Review Doc Harvest + Item Extraction

For each review_doc in the manifest (across all Tracks, deduplicated by file path):

### Step 1: Read the doc

Use Read tool. If the file is missing (was deleted since manifest creation), warn
the user but continue: "Review doc <file> referenced by manifest is missing. Skipping.
Consider re-running Phase 1 to refresh the manifest."

### Step 2: Extract items via LLM prompt

**Extractor prompt contract** (string constant below):

**Trust boundary:** the extractor's return value is untrusted LLM output. Fields are
written into Markdown (rationale_quote, description), used in stable-ID hashing
(section_heading, description), and matched by the classifier (classification_signal).
They MUST NOT be shell-executed, filesystem-path-concatenated, or interpolated into
commands. If you extend this skill, treat extractor output as user-input-equivalent.

```
You are extracting testable claims from a project review document. The document is
about a specific feature/change that was planned. Your job is to convert every
verifiable claim in the doc into a concrete test-plan item.

Input: the full content of one review document (CEO plan, eng review, design review,
or implementation design doc).

Output: JSON array. Each element is an object with exactly these fields:
  - description: string, starts with an imperative verb ("Verify", "Confirm",
    "Check", "Ensure"), testable in 1-2 minutes of effort, 1-2 sentences max.
  - source_type: one of "ceo-review", "eng-review", "design-review", "design-doc".
  - rationale_quote: verbatim (or near-verbatim) snippet from the doc that
    motivated this item. No paraphrase that strips meaning.
  - section_heading: the ## or ### heading the rationale_quote sits under (for
    stable ID generation).
  - classification_signal: free-form keywords that help downstream automated/manual
    classification (e.g., "timing, perceived-latency, visual-feedback"; "api,
    schema, error-handling"; "animation, motion, subjective-feel").

Rules:
- Extract EVERY claim that reads as "the thing should behave this way", "risk: X",
  "edge case: Y", "success criteria: Z", or a named magical-moment quote.
- rationale_quote MUST be a real snippet from the input. Do not invent.
- description MUST NOT include the rationale_quote verbatim — describe the test,
  not the source.
- If the doc contains NO testable claims (e.g., pure strategy with no behavior
  commitments), return [].
- No duplicates within a single doc. Cross-doc dedup happens later.
- When in doubt about whether a claim is testable, include it. The classifier will
  tag ambiguous items as manual.
- Output ONLY the JSON array. No prose, no markdown code fences.

Example:
Input excerpt: "## Magical moment\nThe feedback must appear instantly — within 200ms
of click. A spinner for 1 second is a failure."

Output:
[{"description":"Verify feedback appears within 200ms of clicking submit (no spinner
on the happy path).","source_type":"ceo-review","rationale_quote":"The feedback must
appear instantly — within 200ms of click. A spinner for 1 second is a failure.",
"section_heading":"Magical moment","classification_signal":"timing,
perceived-latency,visual-feedback"}]
```

Invoke this prompt via a subagent call (Agent tool, subagent_type=general-purpose)
OR inline LLM reasoning. Pass the doc content + the above prompt.

**Retry logic:** if the response is not valid JSON, retry once with "Previous
response was not valid JSON. Return only the JSON array." If still invalid, skip
this doc with a warning and continue.

### Step 3: Extract diff-derived items

For the integrated build, compute the full diff across all Track branches vs main:

```bash
# Collect commits from all Track branches that touched files
DIFF_COMMITS=$(for b in "${TRACK_BRANCHES[@]}"; do git log --format=%H "main..$b" 2>/dev/null; done | sort -u)
# Or, if already merged, the merge-base approach:
git log --name-only main..HEAD
```

Run the extractor prompt with a diff-specific variant: the input is the aggregated
changed-files list + commit messages, the source_type is "diff", and
rationale_quote is a hunk header or commit subject.

### Step 4: Assign stable IDs

For each extracted item, compute a deterministic ID:

```bash
# Pseudocode — implement with jq + shasum, or in-skill LLM-driven:
normalized_desc=$(echo "$DESCRIPTION" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//')
id_input="${BRANCH}|${SOURCE_DOC_PATH}|${SECTION_HEADING}|${normalized_desc}"
item_id=$(printf '%s' "$id_input" | shasum -a 256 | cut -c1-8)
```

For diff items, `SOURCE_DOC_PATH = "diff"` and `SECTION_HEADING = <changed file path>`.

### Step 5: Dedup by ID

Across all docs in the Group, collapse items with identical IDs. When collapsing,
union their `classification_signal` fields so downstream classification sees the
combined signal. Preserve all source_type/rationale_quote instances (an item backed
by both a CEO and an eng review is more valuable).

Action receipt after Phase 3: "Harvested <N> review docs, extracted <M> candidate
items (after dedup)."

---

## Phase 4: Per-Track Pair-Review Consumption

For each Track in the manifest, scan for prior pair-review artifacts:

```bash
# Current workspace
CUR_PR=".context/pair-review"
[ -d "$CUR_PR" ] && scan_pair_review "$CUR_PR" "$TRACK_BRANCH"
# Archived sessions in current workspace
for d in .context/pair-review-archived-*; do
  [ -d "$d" ] && scan_pair_review "$d" "$TRACK_BRANCH"
done
```

`scan_pair_review <dir> <track_branch>` reads `session.yaml` and checks if
`branch: <track_branch>` matches. If yes, walk `groups/*.md` and collect every item
with its status.

### The 5 consume categories

For each harvested pair-review item, classify into one of:

| Source status | Target action |
|---|---|
| PASSED | **Skip** — do not add to batch plan. |
| SKIPPED | **Surface for decision** — add to "Items from prior sessions to decide" list; user chooses include/exclude at plan approval. |
| DEFERRED_TO_TODOS | **Surface as "Known Deferred"** — add to the plan's "Known Deferred" section (not tested, just listed for context). |
| PARKED | **Carry forward** — include in the batch plan as a manual item tagged `[from parked-bug: <branch>]`. |
| FAILED (with Fix: and no prior retest) | **Carry forward for retest** — include in the batch plan tagged `[retest-after-fix]`. |
| FAILED+FIXED (retested PASSED) | **Surface as regression candidate ONLY** if the integrated build differs from the verified build. Heuristic: if the fix commit is not the most recent commit touching the same file set, OR if other Track branches modified overlapping files, flag. Otherwise, skip (retest was already done). |

For each carry-forward item, assign a stable ID using the same scheme as Phase 3
(branch = Track branch, source_doc_path = `pair-review/<session-dir>`,
section_heading = pair-review group name, normalized_desc = item description).

Dedup against Phase 3 items by ID — if a review-derived item matches a carry-forward
item's ID, union their metadata and surface both source tags.

Action receipt: "Consumed <K> prior pair-review items. Skipped <P> PASSED. Carried <F> forward. Surfaced <D> deferred, <S> skipped-for-decision, <R> regression candidates."

---

## Phase 5: Classification (Automated vs Manual)

Apply this heuristic to every item in the candidate set:

| classification_signal pattern | Classification |
|---|---|
| Contains "loads", "returns", "200", "status", "response-code", "schema", "shape" | **automated** |
| Contains "form-submits", "api", "endpoint", "http", "request" | **automated** |
| Contains "element-visible", "contains-text", "text-equals" | **automated** |
| Contains "feel", "feels", "looks", "visual", "aesthetic", "subjective" | **manual** |
| Contains "animation", "motion", "transition", "timing" (when paired with "feel") | **manual** |
| Contains "copy", "tone", "voice", "wording" | **manual** |
| Contains "judgment", "makes-sense", "seems-right" | **manual** |
| No match / ambiguous | **manual** (default) |

Alongside the classification, compute a confidence score (0.0-1.0):
- Strong signal match (e.g., pure "schema + api + endpoint") → 0.9
- Single weak signal → 0.6
- Ambiguous → 0.5 (defaults to manual)

Items classified `automated` with confidence < 0.7 are downgraded to `manual`.
(Conservative v1 rule — false-positive automated items are worse than conservative
manuals.)

Store `classification`, `confidence`, and the matched signal rule with each item.

---

## Phase 6: Write Test-Plan-Batch File

```bash
USER=$(whoami)
BRANCH_SLUG=$(echo "$_BRANCH" | tr / -)
# TS includes PID ($$) to avoid second-granularity collisions when two
# /test-plan invocations run on the same Group within the same second.
# Without this, mv would silently overwrite a just-written archive/plan.
TS=$(date +%Y%m%d-%H%M%S)-$$
BATCH_FILE="$HOME/.gstack/projects/$SLUG/${USER}-${BRANCH_SLUG}-test-plan-batch-${TS}.md"
```

Write the plan using the file-format spec from the State Management section above.
Structure:

1. YAML front-matter (schema per docs/designs/test-plan-artifact-contract.md)
2. `# Test Plan: <group title>` header
3. `## Affected Pages/Routes` — from diff items
4. `## Key Interactions to Verify` — from CEO/eng/design-review items tagged manual
5. `## Edge Cases` — from eng/design-review items tagged manual
6. `## Critical Paths` — items with classification_signal containing
   "success-criteria" or "magical-moment"
7. `## Known Deferred` — items surfaced from DEFERRED_TO_TODOS
8. `## Automated (v2, not yet executed)` — items tagged automated, listed for
   /qa-only separate invocation
9. `## Manual (for /pair-review)` — items tagged manual (these populate
   `.context/pair-review/groups/<group>.md` in Phase 7)
10. `## Items Surfaced From Prior Sessions (user decision required)` — SKIPPED
    items surfaced
11. `## Provenance Index` — table: item-id | source | rationale_quote

Action receipt: "Plan written to <path>. <A> automated, <M> manual, <D> deferred, <S> user-decision items."

---

## Phase 7: Pair-Review State Handoff

### Step 1: Archive existing groups file

```bash
GROUPS_FILE=".context/pair-review/groups/${GROUP_SLUG}.md"
if [ -f "$GROUPS_FILE" ]; then
  ARCH=".context/pair-review/groups/${GROUP_SLUG}-archived-${TS}.md"
  mv "$GROUPS_FILE" "$ARCH"
fi
mkdir -p ".context/pair-review/groups"
```

### Step 2: Write session.yaml

If `.context/pair-review/session.yaml` exists, read it and union:
- Preserve existing fields
- Set `plan_source: test-plan`
- Set `build_commit: <current HEAD short hash>`
- Set `branch: <current branch>`
- Add `$GROUP_SLUG` to `active_groups` (if not already present)

If no existing session.yaml, create fresh (see pair-review.md for full session.yaml
schema). Set `plan_source: test-plan` so pair-review knows the origin.

### Step 3: Present SKIPPED items for decision (if any)

For items in the "Items Surfaced From Prior Sessions" section, present via
AskUserQuestion per item (or batched, one group at a time):
- Question: "Prior session SKIPPED: \"<desc>\" (reason: <reason>). Include in this batch?"
- Options: ["Include", "Exclude"]

Included items move to the manual list; excluded items are logged and dropped.

### Step 4: Write groups/<group-slug>.md

Populate with all items tagged `manual` + included-from-prior items + items with
`[retest-after-fix]` tag. Use the format from pair-review.md `groups/<name>.md`
spec. Each item has:
- Number (sequential in group)
- Description (testable, imperative)
- Status: UNTESTED
- Provenance tags
- Item ID (as a comment for pair-review's retest/dedup logic in future)

Failure-mode guard (per failure mode #4): if the write fails (permissions, disk),
abort BEFORE dropping into pair-review Phase 2. Report the error and exit. Do not
leave pair-review in a partial state.

Action receipt: "Pair-review state staged. <N> items in <group> group. Handing off."

---

## Phase 8: Drop Into Pair-Review Phase 2

The skill's final action is to hand execution to /pair-review's Phase 2 loop.

Read `~/.claude/skills/pair-review/SKILL.md` using the Read tool.

Skip these sections (already handled by /test-plan):
- Preamble
- Phase 0 (Deploy Discovery) — only skip if deploy.md already exists; otherwise
  delegate to pair-review's Phase 0 discovery
- Phase 1 (Test Plan Generation) — fully replaced by /test-plan's output
- Active Session Guard

Execute Phase 2 (Test Execution Loop) at full depth with the populated
`.context/pair-review/groups/<group-slug>.md`.

Tell the user once: "Plan generated. Entering /pair-review's execution loop on group '<title>' (<N> items)."

Then delegate to Phase 2. From this point on, /pair-review's conventions apply —
items presented one at a time (or in batch mode), pass/fail/skip/park as normal,
parked bugs route to TODOS.md with the rich format per
`docs/source-tag-contract.md`:

```markdown
### [test-plan:group=<group-slug>,item=<item-index>] <Bug title>
- **Why:** <description>
- **Noticed during:** <group> test-plan run, item <item>
- **Context:** Found on branch <branch> (<date>). Parked during /test-plan → /pair-review.
- **Effort:** ? (user triages in /roadmap)
```

The `group=<group-slug>` origin lets /roadmap's closure bias route the bug
back to the Group that surfaced it. /pair-review's defer nudge applies here
too — the UX should default toward fixing before the Group ships.

When /pair-review completes (`/pair-review done`), it emits its normal session rollup
report. /test-plan's work is complete at handoff; no further /test-plan action after
Phase 8.

---

## Status Subcommand

`/test-plan status <group>` is read-only. Present:

```
TEST PLAN: <group title>
Group slug: <slug> | Current branch: <branch> | Commit: <hash>

MANIFEST: <manifest path>
  Tracks: <N> mapped, <M> review docs indexed
  Last created: <ISO timestamp>

LATEST PLAN: <batch file path>
  Generated: <ISO timestamp>
  Items: <A> automated | <M> manual | <D> deferred | <S> user-decision

PAIR-REVIEW STATE: .context/pair-review/
  Session: plan_source=<source>, branch=<branch>, commit=<commit>
  Active groups: [<list>]
  Group <slug>: <N> untested, <P> passed, <F> failed, <K> skipped, <X> parked
  Archived: <N> prior groups files

NEXT: <recommendation — continue testing, run /pair-review resume, or regenerate plan>
```

Read from disk only. Do not modify any state.

---

## Error Handling

### No git repo
Escalate per Completion Status Protocol with status BLOCKED:
```
STATUS: BLOCKED
REASON: /test-plan requires a git repository. The current directory is not one.
ATTEMPTED: git rev-parse --show-toplevel
RECOMMENDATION: cd into your project root and re-invoke /test-plan.
```

### Group not found in ROADMAP.md
Present candidates via AskUserQuestion. If the user picks "none of these", escalate
with NEEDS_CONTEXT: "Couldn't find Group '<arg>' in docs/ROADMAP.md. Either the
Group name is wrong or ROADMAP.md is out of date. Run /roadmap to refresh."

### No Tracks in the Group
Error out cleanly: "Group '<title>' contains no Tracks. /test-plan operates at the
Track-set level, not Group-with-only-Pre-flight level. Consider adding at least one
Track, or bug-bash the Pre-flight changes against main with a direct /pair-review."

### Manifest write fails
Escalate per failure mode #4 pattern. Do not proceed to Phase 2.

### Extractor returns invalid JSON after retry
Skip that doc with a warning. Do not fail the whole run. Continue with remaining docs.

### pair-review state write fails in Phase 7
Abort before Phase 8. Report: "Failed to write `.context/pair-review/groups/<group>.md`.
Plan file at <path> is preserved. Fix the underlying issue (permissions, disk),
then re-run /test-plan run — the archive-then-write sequence is idempotent."

### No review docs found
Continue silently with diff-only fallback. Add a note to the plan: "No CEO/eng/design
review docs found for this Group's Tracks. Test items derived from diff only. Consider
running /plan-ceo-review, /plan-eng-review, /plan-design-review on future Tracks to
enrich /test-plan output."

### Manifest exists but branch name no longer resolves to a git branch
Warn, fall back to diff-only for that Track, and flag: "Track <id> manifest branch
'<branch>' not found in git. Skipping pair-review consumption for this Track.
Provenance preserved."

---

## Conversational Interface

Users may type naturally. Map to commands:
- "batch test the auth group" / "bug-bash the auth group" → `/test-plan run auth`
- "what's the test plan for group 3" → `/test-plan status 3`
- "plan the bug bash" → ask which Group, then `/test-plan run <answer>`
- "seed the plan" / "retro the plan" → explain v2 deferral, do nothing

When ambiguous about which Group, ask via AskUserQuestion.

---

<!-- SHARED:completion-status-enum -->
## Completion Status Protocol

When completing a skill workflow, report status using one of:

- **DONE** — All steps completed successfully. Evidence provided for each claim.
- **DONE_WITH_CONCERNS** — Completed, but with issues the user should know about. List each concern.
- **BLOCKED** — Cannot proceed. State what is blocking and what was tried.
- **NEEDS_CONTEXT** — Missing information required to continue. State exactly what you need.
<!-- /SHARED:completion-status-enum -->

For /test-plan specifically: the handoff-to-pair-review moment is where /test-plan
itself completes. pair-review's own Completion Status covers the session after that.
Rollup rule for /test-plan's handoff status:

- Manifest written + review docs harvested + plan file written + pair-review state
  staged + handoff clean → **DONE**
- Completed with missing review docs (diff-only fallback), some Tracks skipped due to
  missing branches, or user excluded all SKIPPED items → **DONE_WITH_CONCERNS** (list)
- Not in a git repo, Group not found, no Tracks in Group, pair-review state write
  failed → **BLOCKED**
- `/test-plan status` invoked with no prior manifest, or /test-plan run invoked with
  missing CLI arguments → **NEEDS_CONTEXT**

<!-- SHARED:escalation-opener -->
### Escalation

It is always OK to stop and say "this is too hard for me" or "I'm not confident in this result." Bad work is worse than no work. You will not be penalized for escalating.
<!-- /SHARED:escalation-opener -->

- If extractor consistently fails to produce valid JSON on a specific doc format, STOP and escalate — ask the user to skip that doc or fix its structure.
- If you are uncertain whether an item should be automated vs manual and the signal is weak, default to manual (per Phase 5 rule) — but if the doc has many such ambiguous items, surface the issue as DONE_WITH_CONCERNS.
- If you cannot resolve branch names for several Tracks, STOP and escalate — the manifest is the load-bearing artifact; guessing produces silent wrong plans.

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

- Two Groups in ROADMAP.md have the same title slug (shouldn't happen under
  /roadmap's rules, but real files drift).
- A Track's branch name is ambiguous — multiple git branches match its slug, and
  the user isn't sure which shipped the Track.
- A review doc's content doesn't obviously map to the Track the manifest claims it
  belongs to — could be a misfiled doc.
- The current branch has uncommitted changes and user is about to bug-bash against
  a "dirty" integrated build.
- Multiple `groups/<group-slug>.md` archived files exist — not clear which is
  canonical.

STOP. Name the ambiguity in one sentence. Present 2-3 options with tradeoffs. Ask the user via AskUserQuestion. Do not guess on decisions that affect the test plan, manifest mapping, or pair-review state.

This does NOT apply to routine argument parsing, obvious branch matches, or small
classification calls.

## GSTACK REVIEW REPORT

Emit a REPORT table at handoff-to-pair-review (end of Phase 8). Include it verbatim
in the chat response AND reference it in the plan file's front-matter.

Template:

```markdown
## GSTACK REVIEW REPORT — test-plan run

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Test Plan | `/test-plan run <group>` | Group-level batched test plan + pair-review handoff | 1 | <STATUS> | <H> review docs, <K> items (<A> auto, <M> manual, <D> deferred), <C> carried from prior sessions |

**VERDICT:** <STATUS> — <one-line summary>
```

Substitutions:

- `<STATUS>` is the Completion Status Protocol enum: `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT`.
- `<H>` is the count of review docs successfully harvested.
- `<K>` is the total item count in the manual+automated lists (excludes deferred).
- `<A>`, `<M>`, `<D>` are the automated/manual/deferred counts.
- `<C>` is the count of items carried forward from prior pair-review sessions.
- `<one-line summary>` names the concrete outcome: "<N> manual items queued for pair-review", "diff-only fallback (no review docs)", "blocked — Group 3 not found in ROADMAP.md", etc.

Verdict-to-status mapping:

- Manifest + harvest + write + handoff all clean → "DONE — <M> manual items queued, <A> automated surfaced".
- Completed with missing review docs, excluded SKIPPED items, or skipped Tracks → "DONE_WITH_CONCERNS — <specifics>".
- Not in a git repo, Group not found, no Tracks, pair-review state write failed → "BLOCKED — <reason>".
- Missing CLI arg or prior session state → "NEEDS_CONTEXT — <what is missing>".

The REPORT runs once per `/test-plan run` invocation, at the moment of handoff to
pair-review. pair-review's own session rollup runs afterward per its own GSTACK
REVIEW REPORT rules.
