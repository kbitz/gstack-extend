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

## Preamble (run first)

```bash
_SKILL_SRC=$(readlink ~/.claude/skills/gstack-extend-upgrade/SKILL.md 2>/dev/null \
           || readlink .claude/skills/gstack-extend-upgrade/SKILL.md 2>/dev/null)
_EXTEND_ROOT=""
[ -n "$_SKILL_SRC" ] && _EXTEND_ROOT=$(dirname "$(dirname "$_SKILL_SRC")")
if [ -n "$_EXTEND_ROOT" ] && [ -x "$_EXTEND_ROOT/bin/update-check" ]; then
  _UPD=$("$_EXTEND_ROOT/bin/update-check" --force 2>/dev/null || true)
  [ -n "$_UPD" ] && echo "$_UPD" || true
fi
```

If output shows `UPGRADE_AVAILABLE <old> <new>`: follow the **Inline upgrade flow** below.
If `JUST_UPGRADED <from> <to>`: tell user "Running gstack-extend v{to} (just updated!)" — you're already current, nothing to do.

If output is **empty**, do not assume "up to date" — empty output also covers disabled checks, a missing `VERSION` file, and network failure. Disambiguate first:

```bash
_UC=$("$_EXTEND_ROOT/bin/config" get update_check 2>/dev/null || true)
if [ "$_UC" = "false" ]; then
  echo "STATE: checks-disabled"
elif [ ! -f "$_EXTEND_ROOT/VERSION" ]; then
  echo "STATE: no-version-file"
else
  _LOCAL=$(tr -d '[:space:]' < "$_EXTEND_ROOT/VERSION")
  _REMOTE=$(curl -sf --max-time 5 https://raw.githubusercontent.com/kbitz/gstack-extend/main/VERSION 2>/dev/null | tr -d '[:space:]')
  if [ -z "$_REMOTE" ]; then
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
- `remote ... differs`: rare — the periodic check should have caught it. Follow the **Inline upgrade flow** below, treating the remote version as `{new}`.

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
