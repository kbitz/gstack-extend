---
name: gstack-extend-init
description: |
  Bootstrap a new gstack-extend-onboarded project. Scaffolds the canonical
  layout (CLAUDE.md, ROADMAP.md, TODOS.md, PROGRESS.md, CHANGELOG.md, VERSION,
  docs/), registers the project in ~/.gstack-extend/projects.json, and runs
  the post-render audit. Per-language test command detected automatically. Use
  when asked to "init a new project", "bootstrap a project with
  gstack-extend", "scaffold project docs", or "onboard <path>".
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

## Preamble (run first)

```bash
_ER_SKILL=gstack-extend-init
_er_ok() { case "$_ER" in /*) [ -f "$_ER/bin/update-check" ] && [ -x "$_ER/bin/update-check" ] && grep -qx '# extend-root-protocol: v1' "$_ER/bin/update-check" 2>/dev/null ;; *) false ;; esac; }
_EXTEND_ROOT=""
_ER_SEEN=""
for _ER_SRC in "$HOME"/.claude/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.codex/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.config/opencode/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.cursor/skills/"$_ER_SKILL"/SKILL.md; do
  case "$_ER_SRC" in /*) ;; *) continue ;; esac
  _ER=$(readlink "$_ER_SRC" 2>/dev/null || true)
  [ -n "$_ER" ] || continue
  case "$_ER" in /*) ;; *) _ER="$(dirname "$_ER_SRC")/$_ER" ;; esac
  _ER=$(dirname "$(dirname "$_ER")")
  if _er_ok; then _EXTEND_ROOT="$_ER"; break; fi
  _ER_SEEN="${_ER_SEEN:-$_ER}"
done
if [ -z "$_EXTEND_ROOT" ]; then
  for _ER_SRC in "$HOME"/.claude/skills/"$_ER_SKILL"/.extend-root "$HOME"/.codex/skills/"$_ER_SKILL"/.extend-root "$HOME"/.config/opencode/skills/"$_ER_SKILL"/.extend-root "$HOME"/.cursor/skills/"$_ER_SKILL"/.extend-root; do
    case "$_ER_SRC" in /*) ;; *) continue ;; esac
    [ -f "$_ER_SRC" ] && [ -r "$_ER_SRC" ] || continue
    _ER=""
    IFS= read -r _ER < "$_ER_SRC" || true
    if _er_ok; then _EXTEND_ROOT="$_ER"; break; fi
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
_UPD=$(GSTACK_EXTEND_DIR="$_EXTEND_ROOT" "$_EXTEND_ROOT/bin/update-check" 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
unset _ER_UNVERIFIED _ER_SKILL
```

Shell variables do not survive between commands. Every later command that uses `$_EXTEND_ROOT` (a fenced block, or an inline command in prose or `SHARED:upgrade-flow`) starts with the `_EXTEND_ROOT=…` line the preamble printed, copied verbatim. Commands shown to the user use the literal root path, never `$_EXTEND_ROOT`. Init's later blocks call `"$_EXTEND_ROOT/bin/gstack-extend"` directly. If the printed lines are no longer in context, re-run this preamble block. When re-running it only to recover the root, ignore its update-check output. If no `EXTEND_ROOT:` line was printed, never guess a root. Relay the `EXTEND_ROOT_UNVERIFIED:` fix if one was printed. If neither line was printed, tell the user: `No gstack-extend install found under ~/.claude, ~/.codex, ~/.config/opencode or ~/.cursor. Project-local (vendored) installs are not supported. Fix: run setup --host auto from your gstack-extend checkout (README: Installation).` roadmap, pair-review and full-review then stop, because their tool and session-state steps need the root.

In this skill, an `ERROR:` line from the preamble replaces the no-install message above: relay that line verbatim and stop.

If output shows `UPGRADE_AVAILABLE <old> <new>`: follow the **Inline upgrade flow** below.
If `JUST_UPGRADED <from> <to>`: tell user "Running gstack-extend v{to} (just updated!)" and continue.

<!-- SHARED:upgrade-flow -->
### Inline upgrade flow

Check the session kind and whether auto-upgrade is enabled:
```bash
case "${GSTACK_SESSION_KIND:-}" in spawned|unattended) echo "UPGRADE_SESSION=spawned" ;; *) echo "UPGRADE_SESSION=interactive" ;; esac
_AUTO=$("$_EXTEND_ROOT/bin/config" get auto_upgrade 2>/dev/null || true)
echo "AUTO_UPGRADE=${_AUTO:-false}"
```

**If `UPGRADE_SESSION=spawned`:** Ask nothing, never run `bin/update-run` whatever `AUTO_UPGRADE` says, write no snooze or config state, and continue with the skill. Put this line in the run's final message, before any fenced prompt and any result, handoff, stage or pause line the skill ends with, and never inside a fence or a versioned receipt field: `gstack-extend v{new} is available (running v{old}); not upgraded in this spawned session. To upgrade, run /gstack-extend-upgrade in an interactive session.` The rest of this flow applies only to `UPGRADE_SESSION=interactive`; the auto-upgrade command below checks the session kind again and prints `UPGRADE_SKIPPED spawned-session` instead of running.

Read `bin/update-run`'s output before reporting anything: a literal `UPGRADE_OK <old> <new>` line means success. **Treat absent `UPGRADE_OK` as failure** — an `UPGRADE_FAILED <reason>` line, or no recognizable result line at all, both count as failure. Never report success without `UPGRADE_OK`.

If that output also has a `SETUP_SKIPPED_HOSTS <csv>` line, whatever the result, name each listed host in your message: setup left its skill install untouched, so it may be stale. Relay setup's stderr reason with its fix: for a shared directory, **Shared-directory migration** in the checkout's `docs/installation.md`; for an unsafe directory, the directory fix setup printed. Never say every host was refreshed.

**If `AUTO_UPGRADE=true`:** Skip asking. Log "Auto-upgrading gstack-extend v{old} → v{new}..." and run:
```bash
case "${GSTACK_SESSION_KIND:-}" in spawned|unattended) echo "UPGRADE_SKIPPED spawned-session" ;; *) "$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT" ;; esac
```
- On `UPGRADE_SKIPPED spawned-session`: this is not a failure. Show no retry command; follow the `UPGRADE_SESSION=spawned` branch above.
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
  _SNOOZED_VER=$(awk '{print $(1)}' "$_SNOOZE_FILE")
  if [ "$_SNOOZED_VER" = "$_REMOTE_VER" ]; then
    _CUR_LEVEL=$(awk '{print $(2)}' "$_SNOOZE_FILE")
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

# /gstack-extend-init — Bootstrap a new project

<!-- SHARED:telemetry-start -->
### Telemetry start

Run once when this skill begins, and again when it resumes after a deliberate pause: each resume starts its own segment, in whichever checkout it runs. Telemetry is optional; see [docs/telemetry.md](https://github.com/kbitz/gstack-extend/blob/main/docs/telemetry.md). State, tier gating, and session wall-clock duration are handled by the binary; do not copy session values between calls.

```bash
_GE_CALL="$HOME/.gstack-extend/bin/telemetry-call"
if [ -f "$_GE_CALL" ] && [ -x "$_GE_CALL" ]; then "$_GE_CALL" start --skill "extend:gstack-extend-init" || true
elif [ "${GSTACK_EXTEND_TELEMETRY_DEBUG:-}" = "1" ]; then echo 'telemetry skipped: gstack-extend-telemetry unresolvable or stale. Fix: re-run ./setup. See docs/telemetry.md.' >&2; fi
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

Print the output. If it ends in `dry-run complete`, you have a clean picture: target state, language detected, each file the real run would create or skip, mkdir plan. If dry-run errors out:

- `partially onboarded`: the target already has some canonical files. Ask whether to `--migrate` (backfill missing files; never overwrites an existing file) or pick a different target.
- `already onboarded`: the target is already registered. Suggest the user re-run with `--migrate` if they want to refresh the registry entry (slug, path, remote), or treat as no-op. `--migrate` keeps one entry per project and its original `created_at`; a `slug: <new> (was: <old>)` line means the slug changed, usually because a git remote was added after init, and the old entry will be replaced.
- If the user chooses `--migrate`, preview it before any write: run `"$_EXTEND_ROOT/bin/gstack-extend" init "<target>" --migrate --dry-run`, show its `slug:` line and its `would create` / `would skip` lines, and get confirmation before the real run in Step 4.
- `invalid characters`: ask for a valid name (`[a-zA-Z0-9._-]+`).
- `refusing to create …` (a file or folder init would create lands outside the project, sits behind a dangling link, or a path it needs is not a directory): show the message and explain that init never writes outside the project or through a link. Ask the user how to fix that path; never move, replace or delete their links or files yourself. In a headless run, stop and report BLOCKED with the message.

## Step 3 — Optional `--name` override

If the auto-derived display name (basename of target) doesn't match what the user wants, ask once:

> "Display name will be `<basename>`. Use a different name?"

If yes, append `--name <user-name>` to the next invocation. Validate against `[a-zA-Z0-9._-]+` and re-ask on failure.

## Step 4 — Confirm and execute

Show the user a one-line summary of what's about to happen ("Init `<target>` as `<name>`, register slug `<slug>`, audit") and use AskUserQuestion:

- A) Yes, run it
- B) Show me dry-run again (the same flags as the command below, plus `--dry-run`)
- C) Cancel

If A:

```bash
"$_EXTEND_ROOT/bin/gstack-extend" init "<target>" --name "<name>"
```

If the user chose `--migrate` in Step 2, add `--migrate` to this command. If Step 3 changed the name after the Step 2 preview, re-run the preview with these exact flags plus `--dry-run` and confirm again before running it.

Stream the output. Three outcomes:

- **Exit 0 + SUCCESS banner:** the project is onboarded. The CLI prints a "Next 30 minutes" checklist (`/project-spec` then its `/roadmap` step, `/full-review`). Restate it.
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

Run when this invocation completes or deliberately pauses. Set `--outcome` to the actual result (`success`, `error`, `abort`, `blocked`, or `unknown`). Use `blocked` at a deliberate pause, where the run stops for a person and a later resume continues it. Telemetry is optional; see [docs/telemetry.md](https://github.com/kbitz/gstack-extend/blob/main/docs/telemetry.md). State, tier gating, and session wall-clock duration are handled by the binary; do not copy session values between calls.

```bash
_GE_CALL="$HOME/.gstack-extend/bin/telemetry-call"
if [ -f "$_GE_CALL" ] && [ -x "$_GE_CALL" ]; then "$_GE_CALL" finish --skill "extend:gstack-extend-init" --outcome unknown || true
elif [ "${GSTACK_EXTEND_TELEMETRY_DEBUG:-}" = "1" ]; then echo 'telemetry skipped: gstack-extend-telemetry unresolvable or stale. Fix: re-run ./setup. See docs/telemetry.md.' >&2; fi
true
```
<!-- /SHARED:telemetry-finish -->
