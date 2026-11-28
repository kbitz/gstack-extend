---
name: gstack-extend-upgrade
description: |
  Check for and install a gstack-extend update on the configured channel,
  and report the result. Use when asked
  to "upgrade gstack-extend", "update gstack-extend", or "check for
  gstack-extend updates".
allowed-tools:
  - Bash
  - Bash(~/.gstack-extend/bin/preamble:*)
  - Read
  - AskUserQuestion
---

## Preamble (run first)

```bash
~/.gstack-extend/bin/preamble gstack-extend-upgrade --force
```

Run the start command above exactly as written, with no `cd`, expansion, absolute path or wrapper. If the harness refuses or holds it, do not run its steps by hand: tell the user to allow the command (`docs/installation.md#start-command`) and stop (plan-track notes it once in its final message, skips Telemetry finish for this run, and continues). Shell variables do not survive between commands. Every later command that uses `$_EXTEND_ROOT` (a fenced block, or an inline command in prose or `SHARED:upgrade-flow`) starts with the `_EXTEND_ROOT=…` line the preamble printed, copied verbatim. Commands shown to the user use the literal root path, never `$_EXTEND_ROOT`. Init's later blocks call `"$_EXTEND_ROOT/bin/gstack-extend"` directly. If the printed lines are no longer in context, re-run the same start command with ` --root` added at the end (it prints only the root lines and runs neither update-check nor telemetry). If no `EXTEND_ROOT:` line was printed, never guess a root. Relay the `EXTEND_ROOT_UNVERIFIED:` fix if one was printed. If neither line was printed, tell the user: `No gstack-extend install found under ~/.claude or ~/.codex. Project-local (vendored) installs are not supported. Fix: run setup --host auto from your gstack-extend checkout (README: Installation).` roadmap, pair-review and full-review then run Telemetry finish with `--outcome error` and stop, because their tool and session-state steps need the root. Relay any `INSTALL_WARN … reason=retired_host` line once with its Fix link in the run's final message before any fenced prompt, result, handoff, stage or pause line, and never inside a fence or a receipt field.

If the shell cannot run `~/.gstack-extend/bin/preamble` (exit 127 or 126), tell the user: `PREAMBLE_MISSING: gstack-extend's start command ~/.gstack-extend/bin/preamble is missing or not executable: this install predates it, or setup has not run since the checkout was updated. Fix: in your gstack-extend checkout (README: Installation), run ./setup --host auto, then start this skill again. See docs/installation.md#start-command.` If the command exits 2 with stderr starting `preamble: PREAMBLE_USAGE:`, tell the user: `PREAMBLE_ARGS: gstack-extend's start command rejected this skill's arguments, most likely because the installed command is older than this skill text. Fix: first rerun the skill's start line exactly as written; if it is rejected again, in your gstack-extend checkout (README: Installation), run ./setup --host auto, then start this skill again. See docs/installation.md#start-command.` On any other non-zero exit (or exit 2 without that stderr prefix), relay stderr verbatim, then tell the user: `PREAMBLE_FAILED: gstack-extend's start command failed unexpectedly. Fix: in your gstack-extend checkout (README: Installation), run ./setup --host auto, then start this skill again; if it fails again, report the output of bash -x ~/.gstack-extend/bin/preamble gstack-extend-upgrade. See docs/installation.md#start-command.` On any of these three start-command failures, every skill except plan-track relays the applicable message and stops without Telemetry finish; plan-track relays the message once in its final message, skips Telemetry finish for this run, and continues.

If output shows `UPGRADE_AVAILABLE <old> <new>`: follow the **Inline upgrade flow** below.
If `JUST_UPGRADED <from> <to>`: tell user "Running gstack-extend v{to} (just updated!)" — you're already current, nothing to do.

Whatever the version result, `INSTALL_WARN` lines in the update-check output
are not a version result and do not change the answers below. Relay each one
with its Fix link; see **After upgrading**.

If no `EXTEND_ROOT:` line was printed, tell the user no verified gstack-extend install was found, and to run `./setup --host auto` from their gstack-extend checkout. Run Telemetry finish with `--outcome error`. Then stop.

## Standalone usage

1. The start command forces a fresh check with `--force`.
2. On `UPGRADE_AVAILABLE`, follow the inline upgrade flow.
3. On `JUST_UPGRADED`, report the just-updated install.
4. Otherwise, use the state block below. Only an offer from the checker can start the upgrade flow.

```bash
_UC=$("$_EXTEND_ROOT/bin/config" get update_check 2>/dev/null || true)
if [ "$_UC" = "false" ]; then
  echo "STATE: checks-disabled"
elif [ ! -f "$_EXTEND_ROOT/VERSION" ]; then
  echo "STATE: no-version-file"
else
  _LOCAL=$(tr -d '[:space:]' < "$_EXTEND_ROOT/VERSION")
  echo "STATE: no-offer (local v$_LOCAL)"
fi
```

- `checks-disabled`: tell user "Update checks disabled. Run `"$_EXTEND_ROOT/bin/config" set update_check true` to re-enable."
- `no-version-file`: tell user "Can't determine the installed version — `$_EXTEND_ROOT/VERSION` is missing. Re-clone gstack-extend or check the install."
- `no-offer`: tell the user "The check offered no upgrade for your channel. You're on v{local}. An unavailable remote can also produce this result."

<!-- SHARED:upgrade-flow -->
### Inline upgrade flow

#### Step 1: Session kind

```bash
case "${GSTACK_SESSION_KIND:-}" in spawned|unattended) echo "UPGRADE_SESSION=spawned" ;; *) echo "UPGRADE_SESSION=interactive" ;; esac
_AUTO=$("$_EXTEND_ROOT/bin/config" get auto_upgrade 2>/dev/null || true)
echo "AUTO_UPGRADE=${_AUTO:-false}"
```

**If `UPGRADE_SESSION=spawned`:** Ask nothing, never run `bin/update-run` whatever `AUTO_UPGRADE` says, write no snooze or config state, and continue with the skill. Put this line in the run's final message, before any fenced prompt and any result, handoff, stage or pause line the skill ends with, and never inside a fence or a versioned receipt field: `gstack-extend v{new} is available (running v{old}); not upgraded in this spawned session. To upgrade, run /gstack-extend-upgrade in an interactive session.` The rest of this flow applies only to `UPGRADE_SESSION=interactive`; Step 3's command checks the session kind again and prints `UPGRADE_SKIPPED spawned-session` instead of running.

#### Step 2: Ask the user (or auto-upgrade)

**If `AUTO_UPGRADE=true`:** Skip asking. Log "Auto-upgrading gstack-extend v{old} → v{new}..." and go to Step 3.

**Otherwise**, use AskUserQuestion:
- Question: "gstack-extend **v{new}** is available (you're on v{old}). Upgrade now?"
- Options: ["Yes, upgrade now", "Always keep me up to date", "Not now", "Never ask again"]

For "Yes" and "Always", go to Step 3.

**If "Not now":** Write snooze state using the offered version for `{new}`.
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
Say "Next reminder in 24h" (48h at level 2, 1 week at level 3). Tip: `"$_EXTEND_ROOT/bin/config" set auto_upgrade true`. Go to Step 5.

**If "Never ask again":**
```bash
"$_EXTEND_ROOT/bin/config" set update_check false
```
Say "Update checks disabled. Run `"$_EXTEND_ROOT/bin/config" set update_check true` to re-enable." Go to Step 5.

#### Step 3: Upgrade

```bash
case "${GSTACK_SESSION_KIND:-}" in spawned|unattended) echo "UPGRADE_SKIPPED spawned-session" ;; *) "$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT" ;; esac
```

The guard's `UPGRADE_SKIPPED spawned-session` line is not `bin/update-run` output and not a failure.
- On `UPGRADE_SKIPPED spawned-session`: this is not a failure. Show no retry command; follow the `UPGRADE_SESSION=spawned` branch above.

If output has a `SETUP_SKIPPED_HOSTS <csv>` line, whatever the result, name each listed host and relay setup's stderr reason and fix. See **Shared-directory migration** in `docs/installation.md` for shared paths. Never say every host was refreshed. A `failed` row means the refresh did not finish and may have left previous copies.

- On failure: **Treat absent `UPGRADE_OK` as failure** after handling the guard. Relay any Upgrade summary as printed. Say "Upgrade failed: {reason}. Run `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"` to retry." Go to Step 5.

For "Always": **Only on a confirmed `UPGRADE_OK <old> <new>`, enable auto-upgrade:**
```bash
"$_EXTEND_ROOT/bin/config" set auto_upgrade true
```
Say "Auto-upgrade enabled. Future updates will install automatically."

#### Step 4: Show what's new

On `UPGRADE_OK <old> <new>`, use those versions. Read `$_EXTEND_ROOT/CHANGELOG.md` at the installed commit (`git -C "$_EXTEND_ROOT" show <to>:CHANGELOG.md` when a range is present). Use `## [<version>]` entries newer than {old} through {new}, newest first. Compare numerically with zero padding (0.47.0 equals 0.47.0.0). Group into at most 7 bullets by theme, user-facing changes first, keeping every `### Upgrade notes` item. With `WHATS_NEW_RANGE from=<from> to=<to> channel=main`, instead summarize `git -C "$_EXTEND_ROOT" log --oneline <from>..<to>` in at most 7 bullets.

Say "gstack-extend v{new} — upgraded from v{old}!", then "What's new:" and the bullets, then the Upgrade summary block as printed. Omit unavailable parts from older updaters. Close by saying this session keeps v{old} and the next invocation uses v{new}.

#### Step 5: Continue

Continue with the skill, following its Mid-run upgrade rule if present.
<!-- /SHARED:upgrade-flow -->

---

# /gstack-extend-upgrade — Upgrade gstack-extend

A first-class upgrade path for gstack-extend, mirroring gstack's own `/gstack-upgrade`.
The same flow runs automatically inside every gstack-extend skill's preamble when an
update is detected — this skill is the standalone entry point for when you want to
check or upgrade on demand.

## After upgrading

When the inline flow reports `SETUP_SKIPPED_HOSTS <csv>` hosts, add the
recovery path. A shared directory follows `docs/installation.md`'s
**Shared-directory migration**; an unsafe directory needs fixing first. With
`UPGRADE_OK`, say the checkout upgraded but the listed host installs were
skipped. Tell the user to run `"<root>/setup" --host auto` (the literal root
path) after correcting the directories, rather than waiting for another version
bump; do not run it before they have. After `UPGRADE_FAILED stage=setup`, tell
them to rerun `"<root>/bin/update-run" "<root>"` instead, so its post-setup
steps run too.

Once `bin/update-run` reports `UPGRADE_OK <old> <new>`, the upgrade is installed for
the *next* invocation — the current session keeps running the version it loaded.
Show what changed in Step 4. For a `failed` row, explain that the host refresh
did not finish and give the same updater retry after the setup issue is fixed.

If the same stdout also contains `MIGRATION_WARN <script> exit=<n>`, the git
upgrade succeeded but a one-shot install migration failed. Name the script.
Tell the user to retry with `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"` —
re-running this skill after `UPGRADE_OK` will see `JUST_UPGRADED` / up-to-date
and will not invoke the runner. Do **not** treat `MIGRATION_WARN` as `UPGRADE_FAILED`.

`INSTALL_WARN` lines are local install facts, not version results. Warning-only
stdout does not mean a release is available and does not mean the install is
clean. Facts appear after a setup from this checkout has published them; an
older setup never wrote this file. Cache, snooze, and an offline version check
do not consume the warnings. `update_check=false` hides warnings and ordinary
version notifications together; `"$_EXTEND_ROOT/bin/config" set update_check true`
brings both back. That is not a per-copy acknowledgement. Do not tell the user
to delete `.extend-root` or `install-status` to get silence.

Say that `UPGRADE_OK` upgraded the checkout. Preserved regular copies, shared
directories, and unsafe directories still need the
repair in `$_EXTEND_ROOT/docs/installation.md`. A partial repair leaves a
warning for every remaining entry. A preserved-copy warning clears only when
setup finds `SKILL.md.backup` holding the recorded bytes in the same skill
directory, plus the canonical link (for a retired name, no `SKILL.md`). The
per-file and retired examples there produce exactly that; deleting the copy
instead leaves the warning. `reason=unsafe_directory` uses
`docs/installation.md#unsafe-skills-directory`. Customized files and retired copies whose
source is gone stay until the user moves those specific files aside; do not
treat a pointer as permission to replace them. A moved or deleted checkout
pointer does not clear a fact. The same-version command after a successful
upgrade is `"$_EXTEND_ROOT/setup" --host auto`. After
`UPGRADE_FAILED stage=setup`, the retry is
`"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"`.

Status warnings (`status_unsaved`, `status_unreadable`, `status_unverified`,
`status_pending`) use `docs/installation.md#state-recovery`. Never delete the
status file. Keep a newer-schema file in place; move a damaged one aside under
a dated name as that table shows, then rerun setup. An
abandoned `install-status.lock` is moved aside only after the user confirms
the owner is gone, then setup is rerun. Setup does not steal a lock.

Repairing files on disk does not change instructions this session already
loaded. After the repeat check matches the repair, the user reloads the skill
or starts a new session. The next invocation is not a fresh install while
preserved copies remain or this session is still on the old text. How long a
person needs for one known recovery is unmeasured. Checking that recovery on
real host installs is Tracks 27A and 27B, not this skill's result line.

<!-- SHARED:telemetry-finish -->
### Telemetry finish

Run when this invocation completes or deliberately pauses. Set `--outcome` to the actual result (`success`, `error`, `abort`, `blocked`, or `unknown`). Use `blocked` at a deliberate pause, where the run stops for a person and a later resume continues it. Telemetry is optional; see [docs/telemetry.md](https://github.com/kbitz/gstack-extend/blob/main/docs/telemetry.md). State, tier gating, and session wall-clock duration are handled by the binary; do not copy session values between calls.

```bash
_GE_CALL="$HOME/.gstack-extend/bin/telemetry-call"
if [ -f "$_GE_CALL" ] && [ -x "$_GE_CALL" ]; then "$_GE_CALL" finish --skill "extend:gstack-extend-upgrade" --outcome unknown || true
elif [ "${GSTACK_EXTEND_TELEMETRY_DEBUG:-}" = "1" ]; then echo 'telemetry skipped: gstack-extend-telemetry unresolvable or stale. Fix: re-run ./setup. See docs/telemetry.md.' >&2; fi
true
```
<!-- /SHARED:telemetry-finish -->
