---
name: gstack-extend-init
description: |
  Bootstrap a new gstack-extend-onboarded project. Scaffolds the canonical
  layout (CLAUDE.md, ROADMAP.md, TODOS.md, PROGRESS.md, CHANGELOG.md, VERSION,
  docs/), registers the project in ~/.gstack-extend/projects.json, and runs
  the post-render audit. Per-language test command detected automatically.
  Use when asked to "init a new project", "bootstrap a project with
  gstack-extend", "scaffold project docs", or "onboard <path>".
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

## Preamble (run first)

```bash
_SKILL_SRC=$(readlink ~/.claude/skills/gstack-extend-init/SKILL.md 2>/dev/null \
           || readlink .claude/skills/gstack-extend-init/SKILL.md 2>/dev/null)
_EXTEND_ROOT=""
[ -n "$_SKILL_SRC" ] && _EXTEND_ROOT=$(dirname "$(dirname "$_SKILL_SRC")")
if [ -z "$_EXTEND_ROOT" ] || [ ! -x "$_EXTEND_ROOT/bin/gstack-extend" ]; then
  echo "ERROR: cannot locate bin/gstack-extend — run \`setup\` first."
  exit 1
fi
_GX="$_EXTEND_ROOT/bin/gstack-extend"
echo "EXTEND_ROOT: $_EXTEND_ROOT"
```

If the bin is missing, tell the user: "gstack-extend isn't installed or its CLI symlink isn't wired. Run `~/.claude/skills/gstack-extend/setup` to install + wire the CLI." Then stop.

---

# /gstack-extend-init — Bootstrap a new project

This skill is a thin conversational wrapper around `gstack-extend init`. The CLI does the actual work (scaffold, render, register, audit); the skill gathers arguments and reports.

## Step 1 — Gather the target

If the user already named a project (`/gstack-extend-init my-app` or "onboard `/path/to/repo`"), use that. Otherwise ask:

> "Where should I bootstrap? Give me an absolute path (will be created if missing) or a name relative to the current directory."

Use AskUserQuestion with examples:
- A) `~/dev/my-new-project` (new dir under home)
- B) `$PWD/.` (current dir)
- C) Other path (free-form)

## Step 2 — Detect state via `--dry-run`

Before any writes, run dry-run to show the user what would happen:

```bash
"$_GX" init "<target>" --dry-run
```

Print the output. If it ends in `dry-run complete`, you have a clean picture: target state, language detected, files that would be written, mkdir plan. If dry-run errors out:

- `partially onboarded`: the target already has some canonical files. Ask whether to `--migrate` (backfill missing files; leaves user-edited files alone) or pick a different target.
- `already onboarded`: the target is already registered. Suggest the user re-run with `--migrate` if they want to refresh the registry entry (path/remote), or treat as no-op.
- `invalid characters`: ask for a valid name (`[a-zA-Z0-9._-]+`).

## Step 3 — Optional `--name` override

If the auto-derived display name (basename of target) doesn't match what the user wants, ask once:

> "Display name will be `<basename>`. Use a different name?"

If yes, append `--name <user-name>` to the next invocation. Validate against `[a-zA-Z0-9._-]+` and re-ask on failure.

## Step 4 — Confirm and execute

Show the user a one-line summary of what's about to happen ("Init `<target>` as `<name>`, register slug `<slug>`, audit") and use AskUserQuestion:

- A) Yes, run it
- B) Show me dry-run again
- C) Cancel

If A:

```bash
"$_GX" init "<target>" --name "<name>"
```

Stream the output. Three outcomes:

- **Exit 0 + SUCCESS banner:** the project is onboarded. The CLI prints a "Next 30 minutes" checklist (`/roadmap`, `/review-apparatus`, `/full-review`). Restate it.
- **Exit 1, audit failed:** the CLI per D3.A leaves rendered files in place and prints the audit output + retry hint. Walk the user through the failing audit sections; suggest `--migrate` retry after fixes.
- **Exit 1, scaffold/register failed:** the CLI prints a specific reason. Surface it; suggest the obvious fix (permission, disk full, invalid name).

## Step 5 — Subcommand stubs

If the user asks for `list`, `status`, `doctor`, or `migrate` (the bulk operation, not the `--migrate` flag), the CLI prints `coming in a future Group`. Acknowledge: "Those subcommands are reserved namespace; not implemented yet. For now, `gstack-extend init --migrate <dir>` covers single-project backfill."

## Headless invocation

When invoked by another agent or in a non-interactive context, skip the AskUserQuestion gates. Default to:

```bash
"$_GX" init "<target>" --no-prompt
```

The `--no-prompt` flag makes the CLI fail loudly on any unresolvable input rather than waiting for stdin.

## Completion status

- **DONE** — exit 0, project onboarded, "Next 30 minutes" printed.
- **DONE_WITH_CONCERNS** — exit 1 from audit, files left in place. Surface the failing audit sections.
- **BLOCKED** — bin not found, registry corrupt, permission errors. State the blocker, suggest the fix.
