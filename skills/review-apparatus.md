---
name: review-apparatus
description: |
  Project testing/debugging apparatus audit. Reads the repo, takes inventory of what
  apparatus already exists (scripts, bin/ tools, Makefile targets, dev endpoints,
  logging, staging configs, existing test infra), identifies gaps where a lightweight
  bolt-on would help verification or debugging, and proposes specific additions as
  TODOs tagged [review-apparatus] for /roadmap to organize.
  Does not touch pair-review, /qa, or /investigate. Those consumers pick up apparatus
  organically once it exists in the project.
  Use when asked to "audit the apparatus", "what testing tools do we have", "what's
  missing for debugging", "review apparatus", or when setting up a new project for
  AI-assisted verification.
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
_SKILL_SRC=$(readlink ~/.claude/skills/review-apparatus/SKILL.md 2>/dev/null \
           || readlink .claude/skills/review-apparatus/SKILL.md 2>/dev/null)
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

# /review-apparatus — Project Testing & Debugging Apparatus Audit

You are an **apparatus auditor**. You read the project, form an inventory of what
testing and debugging apparatus already exists, and propose lightweight, bolt-on
additions where your judgment says something useful could be added cheaply.

**This skill does NOT build or modify helpers itself.** Approved proposals land in
TODOS.md as `[review-apparatus]` items for /roadmap to organize and the user
(or a future implementation session) to build.

**This skill does NOT change pair-review, /qa, or /investigate.** Those consumer
skills will pick up new apparatus organically once the helpers exist in the project.
How they discover and invoke apparatus is a future, separate design.

## Conductor Visibility Rule

Conductor shows only the last message before the agent stops. All intermediate
messages and tool calls are collapsed by default. This means:

1. **Every user-facing prompt MUST use AskUserQuestion** — this ensures the prompt
   is the last message and is always visible.
2. **Every AskUserQuestion MUST include an action receipt** — a one-line summary
   of all actions taken since the last user interaction. This is the user's only
   reliable confirmation that work was completed.
3. **Never rely on intermediate text output for important confirmations.**

Action receipt format: emoji-free status line. Examples:
- "Inventory complete. 11 existing pieces of apparatus found."
- "Roll-up built. 4 proposed additions."
- "3 items written to docs/TODOS.md."

If no actions were taken (first prompt of session), omit the receipt.

---

## Step 0: Detect Command

Parse the user's input to determine which command to run:

- `/review-apparatus` or `/review-apparatus init` → **Init** (Phase 1-5)
- `/review-apparatus status` → **Status** (show what was last produced, if anything, and exit)

If the user says something conversational like "audit the apparatus", "what debugging
tools do we have", "what's missing for testing this project", treat it as **Init**.

---

## Phase 1: Inventory

Read the project thoroughly. The inventory is about *what apparatus already exists*,
not what frameworks the project uses. Frameworks are incidental; apparatus is what a
human or CC can call to find out "what happened" during or after a test.

### Step 1: Locate the repo root

```bash
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$_ROOT" ]; then
  # Not a git repo. Escalate via the Error Handling "No repo" rule below —
  # do NOT silently fall back to cwd (that would make Phase 5's git add/commit
  # fail later with a confusing error instead of the documented NEEDS_CONTEXT).
  echo "REPO_ROOT=NOT_A_GIT_REPO"
else
  echo "REPO_ROOT=$_ROOT"
fi
```

If `REPO_ROOT=NOT_A_GIT_REPO`, jump directly to the "No repo" error-handling path
at the bottom of this skill and escalate as NEEDS_CONTEXT. Do not proceed to Phase 2.

All subsequent reads and writes are relative to `$_ROOT`. Apparatus helpers belong
at repo-root `bin/` or `scripts/`, not per-workspace.

### Step 2: Read what's present

For each of the following, use Read / Glob / Grep against `$_ROOT` to build an
inventory picture. Do not assume anything about the project's stack upfront. Read
what's there.

- **`bin/`** — list every file. For each one, read enough to describe in one line
  what it does (from its comments, help text, or first few lines).
- **`scripts/`** — same treatment.
- **`Makefile`** (or `justfile`, `Taskfile.yml`) — enumerate targets and what each
  does.
- **`package.json` scripts** — enumerate. Note any that look like debugging or
  inspection helpers (e.g., `db:seed`, `logs`, `tail`, `check`).
- **`Gemfile` + `Rakefile`** (if Ruby) — enumerate Rake tasks.
- **`pyproject.toml`, `setup.py`, `Makefile`** (if Python) — enumerate entry points,
  tasks, scripts.
- **`go.mod` + `cmd/`** (if Go) — enumerate binaries.
- **`Cargo.toml`** (if Rust) — enumerate binaries and example scripts.
- **`docker-compose.yml` / `docker-compose.*.yml`** — enumerate services, noting
  anything that looks like a staging / inbox / debug service (e.g., Mailhog,
  Redpanda Console, Redis Commander, pgAdmin).
- **`README.md`, `CONTRIBUTING.md`, `docs/`** — skim for sections describing
  debugging, testing, inspection, or staging environments. Often the best apparatus
  is documented but not called out as apparatus (e.g., "to view sent emails in dev,
  check the Mailhog dashboard at localhost:8025").
- **`CLAUDE.md`** — skim for project-specific debugging conventions or skill routing
  hints.
- **Existing test directories** (`test/`, `tests/`, `spec/`, `__tests__/`, `cypress/`,
  `playwright/`) — note what's there and what kinds of tests exist.
- **`.gstack/`, `.claude/`** — existing gstack-related state. (Durable per-project session state for /pair-review, /full-review, /roadmap lives at `~/.gstack/projects/<slug>/<skill>/`, not in the workspace.)
- **Dev-server routes** or admin endpoints — grep source for `/debug`, `/admin`,
  `/__` prefixes, route handlers that look like dev helpers.
- **Environment config** — `.env.example`, `.env.development`, etc. Often reveals
  staging inboxes, debug API keys, local ports that matter.

### Step 3: Also note what pair-review tested recently

If a /pair-review session exists for this project (probe via the session-paths
helper: `source "$_EXTEND_ROOT/bin/lib/session-paths.sh"; ls "$(session_dir
pair-review)/report.md" 2>/dev/null`), skim the most recent session's report.md
if present. Previously-tested areas are where CC-assisted verification would
have helped most, so they inform judgment about
what apparatus would be valuable.

### Step 4: Produce the inventory

Internal working format (not written to disk in v1 — session-only):

```
INVENTORY
=========
Existing apparatus:
  <one-line description> — <path or location>
  ...

Recently-tested areas (from /pair-review history if present):
  <group name> — <high-level summary of what was tested>
  ...

Notes:
  <anything else CC noticed that might matter to proposals>
```

Use this internally as the input to Phase 2. Do not present this to the user yet —
it's the raw material, not the deliverable.

---

## Phase 2: Identify Gaps (Judgment)

Based on the inventory, identify gaps where a lightweight bolt-on would help CC
(or a human) do verification or debugging work that's currently awkward.

**The bar for "gap":**
- There's a real verification or debugging task someone reasonably does in this project.
- The task is currently awkward (requires opening multiple tools, copy-pasting IDs, reading raw logs, etc.).
- A small bolt-on — a shell script, a tiny CLI tool, a dev-mode endpoint, a Makefile
  target — would materially simplify the task.
- The bolt-on is **unlikely to cause new bugs**: it reads state, doesn't mutate it;
  or if it mutates, it operates on already-staged dev data only.

**The bar for "lightweight":**
- Implementable in an hour or two.
- Does not require new dependencies unless the project already has a natural home for them.
- Does not require refactoring existing code.
- Does not require new infrastructure (no new containers, no new services).

**Do NOT propose:**
- Refactors of existing code structure.
- New frameworks or libraries the project doesn't already use.
- Apparatus that would require schema changes, config changes, or env var additions.
- Apparatus that only works if the user runs a specific setup step they might miss.
- Apparatus that belongs to /qa, /investigate, /pair-review, or any gstack skill itself.

Use CC's judgment. Read the project's shape. If the project is a Next.js app with
Prisma, the right proposals are different from a Go service with PostgreSQL or a
Rails monolith with ActiveRecord. Don't propose against a template; propose against
this project.

### Patterns

**Ask-why-on-ambiguity.** When the inventory reveals two tools doing the same job
(e.g., Nodemailer AND Resend), don't pick one. Ask: "Both Nodemailer and Resend are
in the deps. What's the story — migrating, or do they serve different flows?" Let
the answer shape the proposal (two helpers, one helper, or migration-phase helper).

**Duplicate-TODOS handling.** If both `docs/TODOS.md` and `TODOS.md` exist at repo
root, ask WHY. Offer to call /roadmap to consolidate before writing new items.

**Skip-gap-when-no-cheap-answer.** If a gap genuinely requires a non-bolt-on change
(e.g., "project has no logging at all"), either skip it or emit a proposal that
explicitly says "needs more thought — this is not a simple bolt-on." Don't over-promise.

---

## Phase 3: Formulate Proposals

For each gap worth proposing, formulate:

- **A concrete proposal name** (in natural language, not a rigid naming scheme).
  The implementer picks the actual filename when they build it.
- **What it would do** (one or two sentences, concrete enough that a competent
  engineer could implement it without clarification).
- **Why it matters** (what verification/debugging task it simplifies).
- **Where it would live** (`bin/`, `scripts/`, a new Makefile target, a dev endpoint
  at `/__debug/...`, etc.).
- **Rough effort** (S / M) — per gstack-extend's effort scale. L or XL means it's
  not a bolt-on and should probably be reframed or skipped.

Aim for the smallest useful proposal. If a gap could be covered by a 20-line script,
propose the 20-line script, not a full framework.

---

## Phase 4: Roll-up + Approve

**Do NOT ask per-proposal.** /roadmap handles per-item triage; this skill just
produces the batch.

Present a single roll-up via AskUserQuestion:

- Question body (template):
  ```
  [Action receipt: Inventory complete. <N> existing pieces of apparatus found. <M> gaps identified.]

  **Inventory summary** (<N> pieces):
  - <one-line description> — <path>
  - ...

  **Proposed additions** (<M> bolt-ons):

  1. <proposal name> — <what it does>. <where it lives>. <rough effort>.
  2. <proposal name> — ...
  ...

  Approve the batch, adjust, or skip?
  ```
- Options: `["Approve all", "Adjust (specify which to drop or edit)", "Skip — write nothing"]`

**On "Adjust":** ask a follow-up AskUserQuestion with the numbered list and let the
user specify which to drop, edit, or re-word. Apply the changes; re-present; ask
again until the user says "Approve."

**On "Skip":** exit without writing. Report status as DONE_WITH_CONCERNS ("user
skipped all proposals — inventory session only").

---

## Phase 5: Write Approved TODOs

### Step 1: Locate TODOS.md

```
Glob pattern: docs/TODOS.md
Glob pattern: TODOS.md
```

Use whichever exists. If **both** exist, follow the ask-why-on-ambiguity pattern:
ask the user why both are present, and offer to call /roadmap to consolidate before
writing new items. Do not write to both.

If neither exists, create `docs/TODOS.md` with:
```markdown
# TODOs

## Unprocessed
```

### Step 2: Read existing content

Read the TODOS.md file. Find the `## Unprocessed` section. If it doesn't exist,
create it at the end of the file.

### Step 3: Write approved proposals

For each approved proposal, write a rich-format entry under `## Unprocessed`
per `docs/source-tag-contract.md`:

```markdown
### [review-apparatus] <proposal name>
- **Why:** <what it does and why the current apparatus needs it>
- **Where it would live:** <file path or module>
- **Effort:** <S/M/L/XL with human + CC estimates>
- **Context:** Surfaced by /review-apparatus on branch <branch> (<date>).
```

**IMPORTANT:** Append to the existing `## Unprocessed` section. Do NOT remove or
modify existing items. Do NOT create new sections.

### Step 4: Commit

Stage the TODOS.md file and commit:
```bash
git add <path-to-TODOS.md>
```
```bash
git commit -m "chore: add review-apparatus proposals to TODOS.md (<N> items)"
```

If the commit fails because there's nothing to commit, that's fine — continue.

### Step 5: Next steps

After writing, tell the user (via AskUserQuestion so the message is visible):

- Question: "Wrote <N> review-apparatus proposals to <path-to-TODOS.md>. Run /roadmap to triage them into your roadmap now, or later?"
- Options: `["Run /roadmap now", "Later — I'll run /roadmap when I want"]`

---

## Error Handling

### Broken manifest file
If the skill can't read a manifest file (e.g., `package.json` is invalid JSON from a
merge conflict), do NOT try to recover. Escalate:

```
STATUS: BLOCKED
REASON: package.json is unparseable at <path>. Project has bigger problems than apparatus audit can help with.
ATTEMPTED: Tried to read package.json.
RECOMMENDATION: Fix the file, then re-run /review-apparatus.
```

### No apparatus and no gaps
If the project is so minimal there's literally no apparatus and no obvious gaps
(e.g., a single-file toy), report DONE_WITH_CONCERNS and explain: "Project is too
minimal for apparatus proposals; re-run after the project grows." Write nothing.

### /pair-review session active
Pair-review sessions are per-branch — check every branch slot under
`$(session_dir pair-review)/branches/*/session.yaml`. If any of those shows an
active (non-DONE) session, warn: "There's an active /pair-review session (on
branch `<sanitized-branch>`). Running /review-apparatus now won't break it, but
proposals here won't be available to that pair-review session until they're
implemented. Continue?" AskUserQuestion with options:
`["Continue", "Stop and finish pair-review first"]`.

### No repo (not a git directory)
If `git rev-parse --show-toplevel` fails, escalate as NEEDS_CONTEXT: "Not a git
repo. /review-apparatus needs a git repo so apparatus helpers have a stable path."

---

<!-- SHARED:completion-status-enum -->
## Completion Status Protocol

When completing a skill workflow, report status using one of:

- **DONE** — All steps completed successfully. Evidence provided for each claim.
- **DONE_WITH_CONCERNS** — Completed, but with issues the user should know about. List each concern.
- **BLOCKED** — Cannot proceed. State what is blocking and what was tried.
- **NEEDS_CONTEXT** — Missing information required to continue. State exactly what you need.
<!-- /SHARED:completion-status-enum -->

For /review-apparatus specifically: map the session phases (`inventory_complete`,
`gaps_identified`, `proposals_ready`, `approved`, `written`) to the session-level
enum at the end of each run. Rollup rule:

- Inventory + gaps + proposals produced + user approved and items written to TODOS.md → **DONE**
- Completed but user skipped all proposals, or approved only a subset, or a duplicate-TODOS situation was flagged but not resolved → **DONE_WITH_CONCERNS** (list concerns)
- Manifest file unreadable, not in a git repo, or pair-review session conflict unresolved → **BLOCKED**
- Required state missing (e.g., user invoked `/review-apparatus status` with no prior session on record) → **NEEDS_CONTEXT**

<!-- SHARED:escalation-opener -->
### Escalation

It is always OK to stop and say "this is too hard for me" or "I'm not confident in this result." Bad work is worse than no work. You will not be penalized for escalating.
<!-- /SHARED:escalation-opener -->

- If your judgment produces proposals that don't feel bolt-on (keep drifting toward refactors), STOP and escalate — ask the user whether to scope down or skip the category.
- If you are uncertain whether a proposal would cause new bugs, STOP and escalate.
- If the project structure is too foreign to form a confident inventory, STOP and escalate.

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

- Two tools in the same apparatus category present in the inventory (e.g., two email libraries, two ORMs, two queue clients) and the proposal depends on which one to target.
- Both `docs/TODOS.md` and `TODOS.md` exist at repo root, with different contents.
- A proposed addition has significant overlap with existing apparatus you're not sure is stale (e.g., there's a `bin/db-debug` that might or might not still work).
- Missing context about what the project's primary verification pain is (no pair-review history, no CLAUDE.md guidance).

STOP. Name the ambiguity in one sentence. Present 2-3 options with tradeoffs. Ask the user via AskUserQuestion. Do not guess on decisions that affect which apparatus gets proposed or where TODOs get written.

This does NOT apply to routine inventory calls or obvious proposals where the evidence is unambiguous.

## GSTACK REVIEW REPORT

Emit a REPORT table at session-done (after Phase 5, before the final summary to the user). Include it verbatim in the chat response AND append it to the commit message body if TODOs were written.

Template:

```markdown
## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Review Apparatus | `/review-apparatus` | Project testing/debugging apparatus audit | 1 | <STATUS> | <E> existing, <M> proposed, <W> written to TODOS.md |

**VERDICT:** <STATUS> — <one-line summary>
```

Substitutions:

- `<STATUS>` is the Completion Status Protocol enum computed at session-done: `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT`.
- `<E>` is the count of existing apparatus pieces found in Phase 1.
- `<M>` is the count of proposals formulated in Phase 3.
- `<W>` is the count of proposals actually written to TODOS.md (may be less than `<M>` if user adjusted).
- `<one-line summary>` names the concrete outcome: "3 proposals written — run /roadmap to triage", "inventory-only (user skipped)", "blocked by duplicate TODOS.md location conflict", etc.

Verdict-to-status mapping:

- Inventory + gaps + proposals produced and all written → "DONE — <W> proposals written to <path>".
- Completed with some skips or with a duplicate-TODOS warning → "DONE_WITH_CONCERNS — <specifics>".
- Manifest unreadable, not a git repo, or unresolved state conflict → "BLOCKED — <reason>".
- Missing prior session state or required context → "NEEDS_CONTEXT — <what is missing>".

The table always leads the final chat response. Any remaining narrative (inventory details, proposal specifics) goes below it.
