---
name: gstack-extend-init
description: |
  Beta (less battle-tested — review its output carefully).
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

> **⚠️ Beta skill.** Newer and less battle-tested than gstack-extend's stable
> skills. Before substantive work, tell the user this skill is beta and that its
> output warrants closer review than usual. Note any rough edges so it can be hardened.

## Preamble (run first)

```bash
_ER_SKILL=gstack-extend-init
_er_ok() { case "$1" in /*) [ -f "$1/bin/update-check" ] && [ -x "$1/bin/update-check" ] && grep -qx '# extend-root-protocol: v1' "$1/bin/update-check" 2>/dev/null ;; *) false ;; esac; }
_EXTEND_ROOT=""
_ER_SEEN=""
for _ER_SRC in "$HOME"/.claude/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.codex/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.config/opencode/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.cursor/skills/"$_ER_SKILL"/SKILL.md; do
  case "$_ER_SRC" in /*) ;; *) continue ;; esac
  _ER=$(readlink "$_ER_SRC" 2>/dev/null || true)
  [ -n "$_ER" ] || continue
  case "$_ER" in /*) ;; *) _ER="$(dirname "$_ER_SRC")/$_ER" ;; esac
  _ER=$(dirname "$(dirname "$_ER")")
  if _er_ok "$_ER"; then _EXTEND_ROOT="$_ER"; break; fi
  _ER_SEEN="${_ER_SEEN:-$_ER}"
done
if [ -z "$_EXTEND_ROOT" ]; then
  for _ER_SRC in "$HOME"/.claude/skills/"$_ER_SKILL"/.extend-root "$HOME"/.codex/skills/"$_ER_SKILL"/.extend-root "$HOME"/.config/opencode/skills/"$_ER_SKILL"/.extend-root "$HOME"/.cursor/skills/"$_ER_SKILL"/.extend-root; do
    case "$_ER_SRC" in /*) ;; *) continue ;; esac
    [ -f "$_ER_SRC" ] && [ -r "$_ER_SRC" ] || continue
    _ER=""
    IFS= read -r _ER < "$_ER_SRC" || true
    if _er_ok "$_ER"; then _EXTEND_ROOT="$_ER"; break; fi
    _ER_SEEN="${_ER_SEEN:-${_ER:-empty:$_ER_SRC}}"
  done
fi
_ER_UNVERIFIED=""
if [ -z "$_EXTEND_ROOT" ] && [ -n "$_ER_SEEN" ]; then
  _ER="$_ER_SEEN/bin/update-check"
  case "$_ER_SEEN" in
    empty:*) _ER_UNVERIFIED="${_ER_SEEN#empty:} is empty. Fix: run setup --host auto from your gstack-extend checkout" ;;
    /*) if [ ! -e "$_ER" ]; then _ER_UNVERIFIED="$_ER_SEEN has no bin/update-check (checkout moved or deleted). Fix: re-clone gstack-extend (README: Installation), then run its setup --host auto"
        elif [ ! -f "$_ER" ] || [ ! -x "$_ER" ] || [ ! -r "$_ER" ]; then _ER_UNVERIFIED="$_ER is not a readable executable file. Fix: git -C \"$_ER_SEEN\" checkout -- bin/update-check, then run \"$_ER_SEEN/setup\" --host auto"
        else _ER_UNVERIFIED="$_ER lacks the line '# extend-root-protocol: v1' (checkout older than this skill, or not gstack-extend). Fix: git -C \"$_ER_SEEN\" pull --ff-only, then run \"$_ER_SEEN/setup\" --host auto"; fi ;;
    *) _ER_UNVERIFIED="an install pointer names a non-absolute path ($_ER_SEEN). Fix: run setup --host auto from your gstack-extend checkout" ;;
  esac
fi
unset _ER _ER_SRC _ER_SEEN
if [ -z "$_EXTEND_ROOT" ]; then
  echo "ERROR: cannot locate a verified gstack-extend install. ${_ER_UNVERIFIED:-No gstack-extend skill link or .extend-root pointer under ~/.claude, ~/.codex, ~/.config/opencode or ~/.cursor. Fix: run setup --host auto from your gstack-extend checkout (README: Installation).}"
  exit 1
fi
if [ ! -f "$_EXTEND_ROOT/bin/gstack-extend" ] || [ ! -x "$_EXTEND_ROOT/bin/gstack-extend" ]; then
  echo "ERROR: $_EXTEND_ROOT/bin/gstack-extend is missing or not executable. Fix: git -C \"$_EXTEND_ROOT\" checkout -- bin/gstack-extend, or re-clone gstack-extend"
  exit 1
fi
echo "EXTEND_ROOT: $_EXTEND_ROOT"
printf '_EXTEND_ROOT=%q\n' "$_EXTEND_ROOT"
unset _ER_UNVERIFIED _ER_SKILL
```

Shell variables do not survive between commands. Every later command that uses `$_EXTEND_ROOT` (a fenced block, or an inline command in prose or `SHARED:upgrade-flow`) starts with the `_EXTEND_ROOT=…` line the preamble printed, copied verbatim. Commands shown to the user use the literal root path, never `$_EXTEND_ROOT`. Init's later blocks call `"$_EXTEND_ROOT/bin/gstack-extend"` directly. If the printed lines are no longer in context, re-run this preamble block. When re-running it only to recover the root, ignore its update-check output. If no `EXTEND_ROOT:` line was printed, never guess a root. Relay the `EXTEND_ROOT_UNVERIFIED:` fix if one was printed. If neither line was printed, tell the user: `No gstack-extend install found under ~/.claude, ~/.codex, ~/.config/opencode or ~/.cursor. Project-local (vendored) installs are not supported. Fix: run setup --host auto from your gstack-extend checkout (README: Installation).` roadmap, pair-review, full-review and test-plan then stop, because their tool and session-state steps need the root. review-apparatus continues, skipping the update check and its optional pair-review report skim.

---

# /gstack-extend-init — Bootstrap a new project

<!-- SHARED:telemetry-start -->
### Telemetry start

Run once when this skill begins. On resuming a paused invocation in the same repository, keep its existing handoff and skip another start. Telemetry is optional; see [docs/telemetry.md](https://github.com/kbitz/gstack-extend/blob/main/docs/telemetry.md). State, tier gating, and session wall-clock duration are handled by the binary; do not copy session values between calls.

```bash
if [ -n "${ZSH_VERSION:-}" ]; then setopt +o nomatch; fi
_ge_ok() { case "$1" in /*) [ -f "$1" ] && [ -x "$1" ] && grep -q 'telemetry-protocol: start-finish-v1' "$1" ;; *) false ;; esac; }
_GE_BIN=$(command -v gstack-extend-telemetry 2>/dev/null || true)
if ! _ge_ok "$_GE_BIN"; then _GE_BIN="$HOME/.claude/skills/gstack-extend/bin/gstack-extend-telemetry"; fi
if ! _ge_ok "$_GE_BIN"; then
  _GE_BIN=""
  for _GE_PTR in "$HOME"/.claude/skills/*/.extend-root "$HOME"/.codex/skills/*/.extend-root "$HOME"/.config/opencode/skills/*/.extend-root "$HOME"/.cursor/skills/*/.extend-root; do
    if [ -f "$_GE_PTR" ] && [ -r "$_GE_PTR" ]; then
      IFS= read -r _GE_ROOT < "$_GE_PTR" || true
      if _ge_ok "$_GE_ROOT/bin/gstack-extend-telemetry"; then _GE_BIN="$_GE_ROOT/bin/gstack-extend-telemetry"; break; fi
    fi
  done
fi
if [ -n "$_GE_BIN" ]; then
  "$_GE_BIN" start --skill "extend:gstack-extend-init" || true
elif [ "${GSTACK_EXTEND_TELEMETRY_DEBUG:-}" = "1" ]; then
  echo 'telemetry skipped: gstack-extend-telemetry unresolvable or stale. Fix: re-run ./setup. See docs/telemetry.md.' >&2
fi
true
```
<!-- /SHARED:telemetry-start -->

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
"$_EXTEND_ROOT/bin/gstack-extend" init "<target>" --dry-run
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
"$_EXTEND_ROOT/bin/gstack-extend" init "<target>" --name "<name>"
```

Stream the output. Three outcomes:

- **Exit 0 + SUCCESS banner:** the project is onboarded. The CLI prints a "Next 30 minutes" checklist (`/roadmap`, `/review-apparatus`, `/full-review`). Restate it.
- **Exit 1, audit failed:** the CLI per D3.A leaves rendered files in place and prints the audit output + retry hint. Walk the user through the failing audit sections; suggest `--migrate` retry after fixes.
- **Exit 1, scaffold/register failed:** the CLI prints a specific reason. Surface it; suggest the obvious fix (permission, disk full, invalid name).

## Step 5 — Subcommand stubs

If the user asks for `list`, `status`, or `migrate` (the bulk operation, not the `--migrate` flag), the CLI prints `coming in a future Group`. Acknowledge: "Those subcommands are reserved namespace; not implemented yet. For now, `gstack-extend init --migrate <dir>` covers single-project backfill." `gstack-extend doctor telemetry` is implemented (a local telemetry fidelity report); project drift checks under `doctor` remain future work.

## Headless invocation

When invoked by another agent or in a non-interactive context, skip the AskUserQuestion gates. Default to:

```bash
"$_EXTEND_ROOT/bin/gstack-extend" init "<target>" --no-prompt
```

The `--no-prompt` flag makes the CLI fail loudly on any unresolvable input rather than waiting for stdin.

## Completion status

- **DONE** — exit 0, project onboarded, "Next 30 minutes" printed.
- **DONE_WITH_CONCERNS** — exit 1 from audit, files left in place. Surface the failing audit sections.
- **BLOCKED** — bin not found, registry corrupt, permission errors. State the blocker, suggest the fix.

<!-- SHARED:telemetry-finish -->
### Telemetry finish

Run when this invocation completes. Set `--outcome` to the actual result (`success`, `error`, `abort`, or `unknown`). A deliberate pause defers finish until completion. Telemetry is optional; see [docs/telemetry.md](https://github.com/kbitz/gstack-extend/blob/main/docs/telemetry.md). State, tier gating, and session wall-clock duration are handled by the binary; do not copy session values between calls.

```bash
if [ -n "${ZSH_VERSION:-}" ]; then setopt +o nomatch; fi
_ge_ok() { case "$1" in /*) [ -f "$1" ] && [ -x "$1" ] && grep -q 'telemetry-protocol: start-finish-v1' "$1" ;; *) false ;; esac; }
_GE_BIN=$(command -v gstack-extend-telemetry 2>/dev/null || true)
if ! _ge_ok "$_GE_BIN"; then _GE_BIN="$HOME/.claude/skills/gstack-extend/bin/gstack-extend-telemetry"; fi
if ! _ge_ok "$_GE_BIN"; then
  _GE_BIN=""
  for _GE_PTR in "$HOME"/.claude/skills/*/.extend-root "$HOME"/.codex/skills/*/.extend-root "$HOME"/.config/opencode/skills/*/.extend-root "$HOME"/.cursor/skills/*/.extend-root; do
    if [ -f "$_GE_PTR" ] && [ -r "$_GE_PTR" ]; then
      IFS= read -r _GE_ROOT < "$_GE_PTR" || true
      if _ge_ok "$_GE_ROOT/bin/gstack-extend-telemetry"; then _GE_BIN="$_GE_ROOT/bin/gstack-extend-telemetry"; break; fi
    fi
  done
fi
if [ -n "$_GE_BIN" ]; then
  "$_GE_BIN" finish --skill "extend:gstack-extend-init" --outcome unknown || true
elif [ "${GSTACK_EXTEND_TELEMETRY_DEBUG:-}" = "1" ]; then
  echo 'telemetry skipped: gstack-extend-telemetry unresolvable or stale. Fix: re-run ./setup. See docs/telemetry.md.' >&2
fi
true
```
<!-- /SHARED:telemetry-finish -->
