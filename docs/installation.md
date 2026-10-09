# Installation and troubleshooting

[Back to README](../README.md)

## Installation

**Requirements:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (or Codex / OpenCode / Cursor, see below), [Git](https://git-scm.com/), [Bun](https://bun.sh/). The commands that start Bun with `--no-env-file --no-install --config=/dev/null` (the `/roadmap` audit tools, `gstack-extend init`, the merge gate and `bin/layout-scaffold`) need Bun v1.3.3 or newer. `setup` checks for `bun` and fails fast with install instructions if it's missing; it does not check the version.

Clone and run setup:

```bash
git clone https://github.com/kbitz/gstack-extend.git ~/.claude/skills/gstack-extend
~/.claude/skills/gstack-extend/setup
```

Equivalently, if you prefer driving install through bun:

```bash
git clone https://github.com/kbitz/gstack-extend.git ~/.claude/skills/gstack-extend
bun --cwd ~/.claude/skills/gstack-extend run setup
```

Default install is Claude (`~/.claude/skills/<name>/SKILL.md`). For every
detected agent (Claude, Codex, OpenCode, Cursor):

```bash
~/.claude/skills/gstack-extend/setup --host auto
```

| Host | Path |
|------|------|
| Claude | `~/.claude/skills/<name>/` |
| Codex | `~/.codex/skills/<name>/` |
| OpenCode | `~/.config/opencode/skills/<name>/` |
| Cursor | `~/.cursor/skills/<name>/` |

Each skill is its own directory with `SKILL.md`. The package checkout is never linked as a skill.

For Cursor only, run `setup --host cursor` from the checkout. Auto mode detects
Cursor when `cursor` is on PATH or `~/.cursor` exists, including an existing
skill install. Detection can create `~/.cursor/skills`; without either signal,
auto mode leaves `~/.cursor` absent. Explicit `--host cursor` installs even
without a detected Cursor installation.

Cursor receives regular-file copies with the authored shell paths, a multiline
description, and no `allowed-tools` frontmatter, plus an `.extend-root` pointer
to the checkout. Setup refreshes generated copies. A user-owned regular
`SKILL.md` is preserved without claiming ownership, and setup still exits 0.
Use `setup --host cursor --uninstall` to remove copies owned by this checkout.
Cursor may also discover same-named skills in other hosts' directories. If
`~/.cursor/skills` is another host's skills directory (for example a symlink to
`~/.claude/skills`), setup warns and leaves it to that host.

On every host, a `SKILL.md` symlink that points anywhere other than a
gstack-extend checkout's `skills/` directory (a dotfiles-managed personal
skill, say) is treated like a user-owned file: setup warns and leaves it alone.
A link into a checkout that no longer exists is repointed only when setup's own
`.extend-root` beside it still names that checkout.

Codex and OpenCode passes skip a skills directory shared with Claude or with
each other, on both install and uninstall, even if that other host was not
selected. This includes aliases through parent directories, dangling links
into a directory not created yet, and case variants: path components that do
not exist yet are compared case-blind, so on a case-sensitive volume a case
variant can skip a host until that directory exists. Claude can maintain its symlinks in a shared
directory; Codex and OpenCode need separate directories to refresh their
copies, so if they share one, both skip it. Cursor keeps yielding to whichever
host's directory it shares, as described above. Setup preserves existing
regular files in Claude's directory, including old generated copies; see
**Shared-directory migration** below. A `--host` run whose host was skipped
installs or uninstalls nothing and leaves the CLI links and registry alone.

Generated copies preserve shell paths as written in the source; setup never
substitutes a literal HOME into skill bodies. The runtime resolver probes the
four host directories and uses their `.extend-root` pointers.

If a skill directory is already a personal symlink (for example, linked from
dotfiles), setup stops before installing anything on any selected host. It
preserves the link and its contents, reports the colliding path even with
`--quiet`, and exits unsuccessfully. Choose which skill should own that name,
move the personal link if replacing it, then rerun setup. A symlink collision
remains an error even when other skill names could be installed.

In `--host auto`, a detected host whose skills directory is outside HOME, not
owned by you, or world-writable is skipped with a warning, and the other hosts
still install. Naming that host with `--host` stops setup instead. If nothing
is left to install, setup installs Claude when only Cursor was skipped (Cursor
also reads `~/.claude/skills`) and fails otherwise.

When hosts are skipped because of shared or unsafe directories, stdout includes
one `SETUP_SKIPPED_HOSTS <csv>` line (for example,
`SETUP_SKIPPED_HOSTS codex,opencode`) even with `--quiet` or when setup later
fails. No such line is printed when no host was skipped. During an install, a
Cursor that yields is listed only when the same run did not process the host it
yields to; otherwise Cursor reads that host's refreshed install. Reasons and
recovery guidance remain on stderr. `bin/update-run` forwards the line;
`UPGRADE_OK` means the checkout upgraded, while listed hosts were left untouched
and may still have stale copies. The refreshed `/gstack-extend-upgrade` skill and
other refreshed skills' auto-upgrade flows report both outcomes. Older copies
preserved in a shared directory may ignore the report; follow **Shared-directory
migration** below to refresh them. After separating shared or unsafe directories,
rerun `setup --host auto` from that checkout to refresh installable copies without
another upgrade. After `UPGRADE_FAILED stage=setup`,
rerun `<checkout>/bin/update-run <checkout>` instead so its post-setup steps
also run.

`UPGRADE_OK` means the git checkout upgraded. It does not mean every on-disk
skill copy was refreshed. A preserved regular file, a shared directory, an
unsafe directory, or a Cursor install whose owner was not processed stays
recorded. The next enabled `bin/update-check` prints one `INSTALL_WARN` line
per unresolved fact, including when the version check is cached, snoozed, or
offline. Those lines are not version results. `update_check=false` hides them
and also hides ordinary version notifications; turning it back to `true`
shows the same facts again. That switch is not a per-copy acknowledgement.
Do not delete `.extend-root` or `install-status` to make an unresolved install
quiet. See **Preserved installs**, **Shared-directory migration**, and
**State recovery**. Real-host recovery on each supported host is later work
(Tracks 27A and 27B). How long a person takes to follow one known recovery
is unmeasured.

Setup also registers the checkout as `gstack-extend` in
`$HOME/.gstack-extend/projects.json`. It ignores `GSTACK_EXTEND_STATE_DIR` for
that child registration; direct `init` still honors the override. Registration
or audit errors leave the installation usable and print full diagnostics plus
a HOME-scoped `Retry:` command. Correct the reported cause, then run that
command in Bash.

To uninstall: `~/.claude/skills/gstack-extend/setup --host auto --uninstall`

Every host-specific uninstall, and `--host auto --uninstall`, keeps
`~/.local/bin/gstack-extend` and `~/.local/bin/gstack-extend-telemetry` while any
of the four hosts has an `.extend-root` pointer naming this checkout beside a
`SKILL.md`, or a Claude `SKILL.md` link into it (installs that predate pointers
have only the link), and prints that file as `Kept for: <path>`. A non-dangling
`.extend-root` that does not resolve to a regular file causes setup to skip the
skill on install and uninstall. A link to a regular marker is followed
for ownership checks, but setup removes the link itself before writing a
replacement and never writes through it. A dangling marker link is treated as
absent, not ownership evidence: setup leaves an unrecognized regular `SKILL.md`
beside it untouched, and removes the dangling link only when it otherwise
refreshes or removes that skill. The last uninstall removes both links if they
point at this checkout. A preserved, customized skill's pointer also keeps the links; a
pointer naming another checkout does not. Foreign links and regular files are left alone. Legacy
`--skills-dir ... --uninstall` cleanup leaves the shared CLI links alone.

Setup also removes retired gstack-extend skills owned by this checkout. Personal skills,
foreign install pointers, and unrelated files are preserved.

### Preserved installs

Setup records associated regular Claude `SKILL.md` files and skipped-host
facts under `${GSTACK_EXTEND_STATE_DIR:-$HOME/.gstack-extend}/install-status`.
A successful setup stays quiet on stdout. The checker prints the facts. Each
`INSTALL_WARN` line names the host, skill, path, reason, and a Fix link in
this checkout's `docs/installation.md`. `reason=preserved_regular` means the
file was left in place. `compare=` and `observed=` describe that file against
the checkout's source at the version setup recorded. `freshness=unverified`
means that comparison is not a promise the copy is current, customized, owned,
or disposable. A later setup can replace the observation; it does not clear
the fact until the repair below is verified.

A pointer that names a moved or deleted checkout does not by itself refresh
or delete the copy. A second verified checkout can clear a fact only for the
exact host path it re-checks and finds repaired. Another HOME's facts stay
in the file and are not printed for this HOME. Copy-producing hosts that
already have their own skills directory are refreshed with
`setup --host codex`, `setup --host opencode`, or `setup --host cursor`.
Cursor can keep reading Claude's directory when that owner was installed in
the same run; otherwise the warning says `cursor_unserved`.

On-disk repair does not replace text this session already loaded. After the
files and a repeat check look right, reload the skill or start a new session.

### Shared-directory migration

Earlier Codex and OpenCode passes could replace Claude symlinks with generated
copies in a shared directory. Setup now leaves those copies untouched: an
`.extend-root` beside a regular Claude `SKILL.md` cannot distinguish an old
generated copy from a user's customized file. There is no automatic conversion.

Review and back up the regular `SKILL.md` files in the shared Claude directory.
Compare them with `skills/<name>.md` in the checkout. For each old generated
copy you want Claude to maintain, move that file aside (for example, to
`SKILL.md.backup` in the same skill directory), then run `setup --host claude`
from the upgraded checkout to recreate the source symlink. Preserve customized
files; setup will continue to warn without overwriting them. Do not bulk-delete
files based on the pointer alone.

For Codex or OpenCode, back up the shared-directory wiring and give the host a
separate skills directory, then run `setup --host codex` or
`setup --host opencode` to install fresh copies there. Apply the same separation
when only copy-producing hosts share a directory. Cursor can continue reading
Claude's shared skills, or use a separate directory with `setup --host cursor`.

Uninstall leaves those regular copies in place too. While a pointer naming the
checkout sits beside a `SKILL.md`, the shared CLI links stay, and the uninstall
output names one such pointer as `Kept for: <path>`. Review the copies, move aside the ones you no
longer want (as above), then rerun the uninstall; a pointer left without a
`SKILL.md` does not keep the links.

The examples below are the recovery to run. They use
`GSTACK_EXTEND_RECOVERY_CHECKOUT` (the verified checkout) and
`GSTACK_EXTEND_RECOVERY_SKILL` (one skill directory name). The reviewed
`SKILL.md` must be a regular file, not a symlink. The example refuses to
replace an existing backup, checks that the move actually happened, and does
not run setup when the move failed. If setup never ran, leave the backup
where it is and run the example again; it resumes without moving that backup.
A second run after the symlink exists does nothing to that symlink. A retired
name whose source file is gone is not moved by this example; keep that
regular file until you choose to set it aside yourself. A foreign symlink is
left alone. Repairing one skill does not repair the others.

<!-- recovery-example:per-file -->
```bash
checkout=${GSTACK_EXTEND_RECOVERY_CHECKOUT:?}
skill=${GSTACK_EXTEND_RECOVERY_SKILL:?}
dir="$HOME/.claude/skills/$skill"
file="$dir/SKILL.md"
backup="$dir/SKILL.md.backup"
source="$checkout/skills/$skill.md"
if [ ! -f "$source" ] || [ -L "$source" ]; then
  echo RECOVERY_RETIRED_MANUAL
  exit 0
fi
if [ -L "$file" ]; then
  target=$(readlink "$file" || true)
  case "$target" in
    /*) ;;
    *) target="$dir/$target" ;;
  esac
  if [ "$target" = "$source" ]; then
    echo RECOVERY_ALREADY_REPAIRED
    exit 0
  fi
  echo RECOVERY_FOREIGN_LINK
  exit 0
fi
if [ ! -e "$file" ]; then
  if [ -f "$backup" ] && [ ! -L "$backup" ]; then
    echo RECOVERY_RESUME
    "$checkout/setup" --host claude --quiet
    echo RECOVERY_MIGRATED
    exit 0
  fi
  echo RECOVERY_MISSING
  exit 0
fi
if [ ! -f "$file" ]; then
  echo RECOVERY_NOT_REGULAR
  exit 2
fi
if cmp -s "$file" "$source"; then
  echo RECOVERY_COMPARE_MATCHES
else
  echo RECOVERY_COMPARE_DIFFERS
fi
if [ -e "$backup" ] || [ -L "$backup" ]; then
  echo RECOVERY_COLLISION
  exit 3
fi
mv "$file" "$backup"
if [ -e "$file" ] || [ -L "$file" ] || [ ! -f "$backup" ] || [ -L "$backup" ]; then
  echo RECOVERY_MOVE_FAILED
  exit 4
fi
"$checkout/setup" --host claude --quiet
echo RECOVERY_MIGRATED
```
<!-- /recovery-example:per-file -->

A customized file you want to keep is not a migration. This example does not
move it. `update_check=false` also suppresses ordinary version notifications
and is not an acknowledgement of one copy. Stop after the `false` command
only when that broader silence is what you want; the `true` command restores
both version notices and install warnings. Do not delete the pointer or the
status file.

<!-- recovery-example:custom-retain -->
```bash
checkout=${GSTACK_EXTEND_RECOVERY_CHECKOUT:?}
"$checkout/bin/config" set update_check false
"$checkout/bin/config" set update_check true
echo RECOVERY_CUSTOM_RETAINED
```
<!-- /recovery-example:custom-retain -->

Codex, OpenCode, or Cursor already using its own skills directory is refreshed
with that host's setup. This does not rewrite Claude's preserved files.

<!-- recovery-example:separate-host -->
```bash
checkout=${GSTACK_EXTEND_RECOVERY_CHECKOUT:?}
host=${GSTACK_EXTEND_RECOVERY_HOST:?}
case "$host" in
  codex|opencode|cursor) ;;
  *) echo RECOVERY_HOST_REFUSED; exit 2 ;;
esac
"$checkout/setup" --host "$host" --quiet
echo RECOVERY_HOST_SETUP
```
<!-- /recovery-example:separate-host -->

## Troubleshooting

`EXTEND_ROOT_UNVERIFIED` means a skill found a home install pointer but could not verify it. The line names the first rejected candidate. Match the cause to the fix:

| Cause | Fix |
|---|---|
| The pointer file is empty | `setup --host auto` from your gstack-extend checkout |
| The checkout has no `bin/update-check` (moved or deleted) | Re-clone (see Installation), then run that checkout's `setup --host auto` |
| `bin/update-check` is not a readable executable file | `git checkout -- bin/update-check` in that checkout, then `setup --host auto` |
| `bin/update-check` lacks `# extend-root-protocol: v1` (older checkout, or not gstack-extend) | `git pull --ff-only` in that checkout, then `setup --host auto` |
| The pointer names a non-absolute path | `setup --host auto` from your gstack-extend checkout |

If that pointer sits beside a regular `SKILL.md` in a directory Codex or
OpenCode shares with Claude, rerunning setup does not regenerate it; follow
**Shared-directory migration** instead.

Copy-paste checks, replacing `<skill>` and `<root>`:

```bash
readlink ~/.claude/skills/<skill>/SKILL.md
cat ~/.codex/skills/<skill>/.extend-root
grep -x '# extend-root-protocol: v1' <root>/bin/update-check
```

Running `setup` from a worktree repoints every host at that worktree. Re-run `setup --host auto` from the stable checkout before archiving the worktree.

The resolver probes Claude, then Codex, then OpenCode, then Cursor, and uses the first verified checkout. If those installs point at different checkouts, a session on any host updates the Claude one. Host-aware ordering is not implemented.

## State recovery

`install-status` is a private data file in
`${GSTACK_EXTEND_STATE_DIR:-$HOME/.gstack-extend}`. Setup publishes a complete
replacement only after it can read the previous file. A reader that finds a
problem prints `INSTALL_WARN` with `reason=status_unreadable`,
`reason=status_unverified`, or `reason=status_pending`, names the cause, and
points here. It does not treat that file as a clean install.

| What you see | Cause | What to do |
|---|---|---|
| `status_unsaved` / `temp_failed`, `write_failed`, `chmod_failed`, `rename_failed`, `mkdir_failed` | This run could not publish a new snapshot | The previous file, if any, is still there. Fix the named cause and rerun setup from the verified checkout. |
| `lock_timeout` or `status_pending` / `lock_held` | Another setup holds `install-status.lock`, or a setup was interrupted and left it | Do not delete `install-status`. See whether the owner process is still running. If you have confirmed it is gone, move the lock directory aside and rerun setup. Setup does not take over a lock by itself. |
| `predecessor_symlink`, `predecessor_directory`, `predecessor_fifo`, `unsafe_target`, or a matching `status_unreadable` cause | The status path is not a regular file | Leave the unexpected object in place, move it aside only if you know it is not something you need, and rerun setup. Do not follow a link or replace a directory to force a clean result. |
| `predecessor_malformed`, `unknown_schema`, `unknown_record`, `truncated`, `extra_data`, `count_mismatch`, `oversized`, or `status_unverified` | The file is not a schema-1 snapshot this checkout can reconcile | Keep the file. Correct or replace it only with a snapshot you trust, then rerun setup from a verified checkout. Unknown bytes are not deleted to make the warning stop. |
| `home_unreadable` | HOME could not be identified | Fix HOME, then rerun setup. Facts already in the file stay there. |

A failed or partial setup adds what it saw and does not clear older unresolved
facts. After a successful upgrade, rerun `"<checkout>/setup" --host auto` to
refresh installs. After `UPGRADE_FAILED stage=setup`, rerun
`"<checkout>/bin/update-run" "<checkout>"` so the updater's later steps run.
Neither command replaces skill text a session has already loaded.
