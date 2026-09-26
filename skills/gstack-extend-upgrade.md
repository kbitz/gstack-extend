---
name: gstack-extend-upgrade
description: |
  Upgrade gstack-extend to the latest version. Detects the install, runs the
  upgrade via a git fast-forward pull, and reports the result. Use when asked
  to "upgrade gstack-extend", "update gstack-extend", or "check for
  gstack-extend updates".
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

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
  "$_GE_BIN" start --skill "extend:gstack-extend-upgrade" || true
elif [ "${GSTACK_EXTEND_TELEMETRY_DEBUG:-}" = "1" ]; then
  echo 'telemetry skipped: gstack-extend-telemetry unresolvable or stale. Fix: re-run ./setup. See docs/telemetry.md.' >&2
fi
true
```
<!-- /SHARED:telemetry-start -->

## Preamble (after telemetry start)

```bash
_ER_SKILL=gstack-extend-upgrade
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
if [ -n "$_EXTEND_ROOT" ]; then
  echo "EXTEND_ROOT: $_EXTEND_ROOT"
  printf '_EXTEND_ROOT=%q\n' "$_EXTEND_ROOT"
  _UPD=$(GSTACK_EXTEND_DIR="$_EXTEND_ROOT" "$_EXTEND_ROOT/bin/update-check" --force 2>/dev/null || true)
  [ -n "$_UPD" ] && echo "$_UPD" || true
elif [ -n "$_ER_UNVERIFIED" ]; then
  echo "EXTEND_ROOT_UNVERIFIED: $_ER_UNVERIFIED"
fi
unset _ER_UNVERIFIED _ER_SKILL
```

Shell variables do not survive between commands. Every later command that uses `$_EXTEND_ROOT` (a fenced block, or an inline command in prose or `SHARED:upgrade-flow`) starts with the `_EXTEND_ROOT=…` line the preamble printed, copied verbatim. Commands shown to the user use the literal root path, never `$_EXTEND_ROOT`. Init's later blocks call `"$_EXTEND_ROOT/bin/gstack-extend"` directly. If the printed lines are no longer in context, re-run this preamble block. When re-running it only to recover the root, ignore its update-check output. If no `EXTEND_ROOT:` line was printed, never guess a root. Relay the `EXTEND_ROOT_UNVERIFIED:` fix if one was printed. If neither line was printed, tell the user: `No gstack-extend install found under ~/.claude, ~/.codex, ~/.config/opencode or ~/.cursor. Project-local (vendored) installs are not supported. Fix: run setup --host auto from your gstack-extend checkout (README: Installation).` roadmap, pair-review, full-review and test-plan then stop, because their tool and session-state steps need the root. review-apparatus continues, skipping the update check and its optional pair-review report skim.

If output shows `UPGRADE_AVAILABLE <old> <new>`: follow the **Inline upgrade flow** below.
If `JUST_UPGRADED <from> <to>`: tell user "Running gstack-extend v{to} (just updated!)" — you're already current, nothing to do.

If no `EXTEND_ROOT:` line was printed, tell the user no verified gstack-extend install was found, and to run `./setup --host auto` from their gstack-extend checkout. Run Telemetry finish with `--outcome error`. Then stop.

If an `EXTEND_ROOT:` line was printed but no `UPGRADE_AVAILABLE` or `JUST_UPGRADED` line followed, do not assume "up to date": a silent update check also covers disabled checks, a missing `VERSION` file, and network failure. Disambiguate first:

```bash
_UC=$("$_EXTEND_ROOT/bin/config" get update_check 2>/dev/null || true)
if [ "$_UC" = "false" ]; then
  echo "STATE: checks-disabled"
elif [ ! -f "$_EXTEND_ROOT/VERSION" ]; then
  echo "STATE: no-version-file"
else
  _LOCAL=$(tr -d '[:space:]' < "$_EXTEND_ROOT/VERSION")
  _REMOTE=$(curl -sf --max-time 5 https://raw.githubusercontent.com/kbitz/gstack-extend/main/VERSION 2>/dev/null | tr -d '[:space:]')
  if ! printf '%s\n' "$_REMOTE" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$'; then
    echo "STATE: offline (local v$_LOCAL)"
  elif [ "$_LOCAL" = "$_REMOTE" ]; then
    echo "STATE: up-to-date (v$_LOCAL)"
  else
    echo "STATE: remote v$_REMOTE differs from local v$_LOCAL"
  fi
fi
```

- `checks-disabled`: tell user "Update checks are disabled. Re-enable by editing `~/.gstack-extend/config` and changing `update_check=false` to `update_check=true`."
- `no-version-file`: tell user "Can't determine the installed version — `$_EXTEND_ROOT/VERSION` is missing. Re-clone gstack-extend or check the install."
- `offline`: tell user "Couldn't reach GitHub to check for updates (offline?). You're on v{local}."
- `up-to-date`: tell user "You're on the latest version (v{local})."
- `remote ... differs`: compare the two versions. If the remote is newer (rare; the periodic check should have caught it), follow the **Inline upgrade flow** below, treating the remote version as `{new}`. If the local version is newer, this is a development checkout ahead of the published release: tell the user "You're on v{local}, ahead of the published v{remote}." and do not upgrade.

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

# /gstack-extend-upgrade — Upgrade gstack-extend

A first-class upgrade path for gstack-extend, mirroring gstack's own `/gstack-upgrade`.
The same flow runs automatically inside every gstack-extend skill's preamble when an
update is detected — this skill is the standalone entry point for when you want to
check or upgrade on demand.

## After upgrading

Once `bin/update-run` reports `UPGRADE_OK <old> <new>`, the upgrade is installed for
the *next* invocation — the current session keeps running the version it loaded.
Point the user at `$_EXTEND_ROOT/CHANGELOG.md` for what changed between `{old}` and
`{new}` if they want the details.

If the same stdout also contains `MIGRATION_WARN <script> exit=<n>`, the git
upgrade succeeded but a one-shot install migration failed. Name the script.
Tell the user to retry with `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"` —
re-running this skill after `UPGRADE_OK` will see `JUST_UPGRADED` / up-to-date
and will not invoke the runner. Do **not** treat `MIGRATION_WARN` as `UPGRADE_FAILED`.

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
  "$_GE_BIN" finish --skill "extend:gstack-extend-upgrade" --outcome unknown || true
elif [ "${GSTACK_EXTEND_TELEMETRY_DEBUG:-}" = "1" ]; then
  echo 'telemetry skipped: gstack-extend-telemetry unresolvable or stale. Fix: re-run ./setup. See docs/telemetry.md.' >&2
fi
true
```
<!-- /SHARED:telemetry-finish -->
