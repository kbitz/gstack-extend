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
A successful setup stays quiet on stdout. The checker prints the facts. A fact
line names the host, the skill (`-` for a whole host directory), the path, the
reason and cause, the checkout the record names, and a Fix link in this
checkout's `docs/installation.md`. For a preserved copy, `checkout=` is the
checkout its `.extend-root` names; for a host fact, it is the checkout whose
setup saw it. On a preserved-copy line, `origin=` says how that checkout was
qualified: `this_checkout` (the checkout that recorded the fact),
`verified_checkout` (another existing gstack-extend checkout) or
`prior_qualified` (one that has since moved or been deleted). A host line shows
`detection=` instead: how setup selected that host (`binary`,
`existing_skill`, `cursor_home`, `explicit_host`, or `not_applicable` for the
Claude fallback). Recover with a verified checkout, normally the one in the Fix link,
whatever `checkout=` shows. A status line (`reason=status_*`) names the state
path and its cause instead. Paths are shell-quoted when needed. Treat the
text after `INSTALL_WARN` as a human-readable diagnostic: rely on that token and
the `reason=` and `cause=` values, not on field order.
`reason=preserved_regular` means the file was left in place. `compare=` and `observed=` describe that file against
the checkout's source at the version setup recorded. `freshness=unverified`
means that comparison is not a promise the copy is current, customized, owned,
or disposable. A later setup can replace the observation; it does not clear
the fact until the repair below is verified.

A preserved-copy fact clears only when setup can show that the bytes it
recorded were kept: the skill directory is the same directory,
`SKILL.md.backup` in it holds exactly the bytes setup last recorded, and the
skill path is now this checkout's symlink (for a retired name, there is no
`SKILL.md` at all). The examples below run setup once before setting the file
aside, so the recorded bytes match. Deleting the copy, moving the whole
directory, or editing the copy after the last setup leaves the warning,
because setup cannot tell a kept copy from a lost one. While the copy is still
there, run the example again. Once it is gone, the warning stays until you put
the file back and repeat the example, or turn checks off as described below.
A host fact clears when that host's setup succeeds into a safe directory of
its own; `shared_directory` also needs the directory separated from every
other host's.

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
copy you want Claude to maintain, run the per-file example below. It keeps the
original as `SKILL.md.backup` in the same skill directory, which is also what
lets its warning clear, then runs `setup --host claude` from the upgraded
checkout to recreate the source symlink. Preserve customized
files; setup will continue to warn without overwriting them. Do not bulk-delete
files based on the pointer alone.

For Codex or OpenCode, back up the shared-directory wiring and give the host a
separate skills directory, then run `setup --host codex` or
`setup --host opencode` to install fresh copies there. Apply the same separation
when only copy-producing hosts share a directory. Cursor can continue reading
Claude's shared skills, or use a separate directory with `setup --host cursor`.
If you no longer use that host, its `shared_directory` warning stays until its
setup succeeds once into a directory of its own. Run that setup, then
`setup --host <host> --uninstall` if you do not want its copies.

Uninstall leaves those regular copies in place too. While a pointer naming the
checkout sits beside a `SKILL.md`, the shared CLI links stay, and the uninstall
output names one such pointer as `Kept for: <path>`. Review the copies, move aside the ones you no
longer want (as above), then rerun the uninstall; a pointer left without a
`SKILL.md` does not keep the links.

The examples below are the recovery to run. First set
`GSTACK_EXTEND_RECOVERY_CHECKOUT` to the verified checkout and
`GSTACK_EXTEND_RECOVERY_SKILL` to one skill directory name, for example
`export GSTACK_EXTEND_RECOVERY_CHECKOUT=~/.claude/skills/gstack-extend GSTACK_EXTEND_RECOVERY_SKILL=implement`.
Each block runs in a subshell, so its `exit` lines do not close your terminal.

The per-file example needs the reviewed `SKILL.md` to be a regular file, not
a symlink. It runs setup once so the recorded bytes match the file, keeps the
file as `SKILL.md.backup` with `ln` (which refuses to replace an existing
backup), and removes the original name only after both names point at the
same file. `RECOVERY_SETUP_FAILED` (exit 5) means setup failed,
`RECOVERY_NOT_LINKED` (exit 6) means setup finished without linking the
skill, and `RECOVERY_STATUS_UNSAVED` (exit 7) means setup could not save its
record (see **State recovery**). The backup, if one was made, stays in place. Fix the cause and run the
example again: it resumes from the backup without moving it, including after
an interruption that left `SKILL.md.backup` and `SKILL.md` as two names for one
file. A second run
after the symlink exists does nothing to that symlink; it only reruns setup so
an unsaved record can catch up. A retired name whose
source file is gone is not moved by this example. A foreign symlink is left
alone. Repairing one skill does not repair the others.

<!-- recovery-example:per-file -->
```bash
(
checkout=${GSTACK_EXTEND_RECOVERY_CHECKOUT:?}
skill=${GSTACK_EXTEND_RECOVERY_SKILL:?}
checkout=$(cd -P "$checkout" && pwd -P) || { echo RECOVERY_NO_CHECKOUT; exit 2; }
dir="$HOME/.claude/skills/$skill"
file="$dir/SKILL.md"
backup="$dir/SKILL.md.backup"
source="$checkout/skills/$skill.md"
linked() {
  [ -L "$file" ] || return 1
  target=$(readlink "$file" || true)
  case "$target" in
    /*) ;;
    *) target="$dir/$target" ;;
  esac
  [ "$target" = "$source" ]
}
run_setup() {
  if ! out=$("$checkout/setup" --host claude --quiet); then
    [ -z "$out" ] || printf '%s\n' "$out"
    echo RECOVERY_SETUP_FAILED
    exit 5
  fi
  [ -z "$out" ] || printf '%s\n' "$out"
  case "$out" in
    *"INSTALL_WARN reason=status_unsaved"*) echo RECOVERY_STATUS_UNSAVED; exit 7 ;;
  esac
}
if [ ! -f "$source" ] || [ -L "$source" ]; then
  echo RECOVERY_RETIRED_MANUAL
  exit 0
fi
if [ -L "$file" ]; then
  if linked; then
    # Setup reconciles the record in case an earlier run could not save it.
    run_setup
    echo RECOVERY_ALREADY_REPAIRED
    exit 0
  fi
  echo RECOVERY_FOREIGN_LINK
  exit 0
fi
if [ ! -e "$file" ]; then
  if [ ! -f "$backup" ] || [ -L "$backup" ]; then
    echo RECOVERY_MISSING
    exit 0
  fi
  echo RECOVERY_RESUME
else
  if [ ! -f "$file" ]; then
    echo RECOVERY_NOT_REGULAR
    exit 2
  fi
  if cmp -s "$file" "$source"; then
    echo RECOVERY_COMPARE_MATCHES
  else
    echo RECOVERY_COMPARE_DIFFERS
  fi
  if [ -f "$backup" ] && [ ! -L "$backup" ] && [ "$file" -ef "$backup" ]; then
    # An earlier run linked the backup but stopped before removing the original.
    echo RECOVERY_RESUME
  elif [ -e "$backup" ] || [ -L "$backup" ]; then
    echo RECOVERY_COLLISION
    exit 3
  else
    run_setup
    if ! ln "$file" "$backup" 2>/dev/null || [ -L "$backup" ] || [ ! "$file" -ef "$backup" ]; then
      echo RECOVERY_MOVE_FAILED
      exit 4
    fi
  fi
  rm -f "$file"
  if [ -e "$file" ] || [ -L "$file" ] || [ ! -f "$backup" ]; then
    echo RECOVERY_MOVE_FAILED
    exit 4
  fi
fi
run_setup
if ! linked; then
  echo RECOVERY_NOT_LINKED
  exit 6
fi
echo RECOVERY_MIGRATED
)
```
<!-- /recovery-example:per-file -->

A retired name has no source to link to. Run this only after you have
reviewed that copy and decided to set it aside. It keeps the file as
`SKILL.md.backup` in the same directory, which lets its warning clear, and
uses the same refusals and resume as the per-file example.

<!-- recovery-example:retired -->
```bash
(
checkout=${GSTACK_EXTEND_RECOVERY_CHECKOUT:?}
skill=${GSTACK_EXTEND_RECOVERY_SKILL:?}
checkout=$(cd -P "$checkout" && pwd -P) || { echo RECOVERY_NO_CHECKOUT; exit 2; }
dir="$HOME/.claude/skills/$skill"
file="$dir/SKILL.md"
backup="$dir/SKILL.md.backup"
run_setup() {
  if ! out=$("$checkout/setup" --host claude --quiet); then
    [ -z "$out" ] || printf '%s\n' "$out"
    echo RECOVERY_SETUP_FAILED
    exit 5
  fi
  [ -z "$out" ] || printf '%s\n' "$out"
  case "$out" in
    *"INSTALL_WARN reason=status_unsaved"*) echo RECOVERY_STATUS_UNSAVED; exit 7 ;;
  esac
}
if [ -f "$checkout/skills/$skill.md" ]; then
  echo RECOVERY_NOT_RETIRED
  exit 2
fi
if [ ! -e "$file" ] && [ ! -L "$file" ]; then
  if [ ! -f "$backup" ] || [ -L "$backup" ]; then
    echo RECOVERY_MISSING
    exit 0
  fi
  echo RECOVERY_RESUME
else
  if [ -L "$file" ] || [ ! -f "$file" ]; then
    echo RECOVERY_NOT_REGULAR
    exit 2
  fi
  if [ -f "$backup" ] && [ ! -L "$backup" ] && [ "$file" -ef "$backup" ]; then
    # An earlier run linked the backup but stopped before removing the original.
    echo RECOVERY_RESUME
  elif [ -e "$backup" ] || [ -L "$backup" ]; then
    echo RECOVERY_COLLISION
    exit 3
  else
    run_setup
    if ! ln "$file" "$backup" 2>/dev/null || [ -L "$backup" ] || [ ! "$file" -ef "$backup" ]; then
      echo RECOVERY_MOVE_FAILED
      exit 4
    fi
  fi
  rm -f "$file"
  if [ -e "$file" ] || [ -L "$file" ] || [ ! -f "$backup" ]; then
    echo RECOVERY_MOVE_FAILED
    exit 4
  fi
fi
run_setup
echo RECOVERY_RETIRED_SET_ASIDE
)
```
<!-- /recovery-example:retired -->

A customized file you want to keep is not a migration, and these examples do
not move it. Its warning stays. The only switch that hides it is
`"$checkout/bin/config" set update_check false`, which also hides ordinary
version notifications and is not an acknowledgement of one copy;
`update_check true` brings both back. Set `GSTACK_EXTEND_RECOVERY_UPDATE_CHECK`
to `false` or `true`. Do not delete the pointer or the status file.

<!-- recovery-example:custom-retain -->
```bash
(
checkout=${GSTACK_EXTEND_RECOVERY_CHECKOUT:?}
value=${GSTACK_EXTEND_RECOVERY_UPDATE_CHECK:?}
case "$value" in
  false|true) ;;
  *) echo RECOVERY_VALUE_REFUSED; exit 2 ;;
esac
if ! "$checkout/bin/config" set update_check "$value"; then
  echo RECOVERY_CONFIG_FAILED
  exit 5
fi
echo "RECOVERY_UPDATE_CHECK_$value"
)
```
<!-- /recovery-example:custom-retain -->

Codex, OpenCode, or Cursor already using its own skills directory is refreshed
with that host's setup. This does not rewrite Claude's preserved files. Set
`GSTACK_EXTEND_RECOVERY_HOST` to the host. `RECOVERY_HOST_SKIPPED` (exit 6)
means setup still skipped that host, usually because its directory is shared,
and `RECOVERY_STATUS_UNSAVED` (exit 7) means setup could not save its record.

<!-- recovery-example:separate-host -->
```bash
(
checkout=${GSTACK_EXTEND_RECOVERY_CHECKOUT:?}
host=${GSTACK_EXTEND_RECOVERY_HOST:?}
case "$host" in
  codex|opencode|cursor) ;;
  *) echo RECOVERY_HOST_REFUSED; exit 2 ;;
esac
if ! out=$("$checkout/setup" --host "$host" --quiet); then
  [ -z "$out" ] || printf '%s\n' "$out"
  echo RECOVERY_SETUP_FAILED
  exit 5
fi
[ -z "$out" ] || printf '%s\n' "$out"
case "$out" in
  *"INSTALL_WARN reason=status_unsaved"*) echo RECOVERY_STATUS_UNSAVED; exit 7 ;;
  *SETUP_SKIPPED_HOSTS*) echo RECOVERY_HOST_SKIPPED; exit 6 ;;
esac
echo RECOVERY_HOST_SETUP
)
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

### Unsafe skills directory

`reason=unsafe_directory` means setup left that host's skills directory alone
because the directory, or its nearest existing parent, failed the install-path
check. `path=` names the directory and `cause=` says why:

| `cause=` | Meaning | Fix |
|---|---|---|
| `world_writable` | Other users can write to it | `chmod o-w <path>` |
| `not_owned` | It belongs to another user | Make it yours, or move it aside and let setup create a new one |
| `outside_home` | It resolves outside your home directory, usually through a symlink | Point the link inside HOME, or remove the link so setup creates the directory |
| `unresolvable`, `stat_failed`, `empty_path`, `unsafe_directory` | Setup could not resolve or inspect it | Check that the path and each parent exist and are readable |

Then run `"<checkout>/setup" --host <host>` from the verified checkout. The
warning clears when that run installs the host into the corrected directory.

## State recovery

`install-status` is a private data file in
`${GSTACK_EXTEND_STATE_DIR:-$HOME/.gstack-extend}`. Setup publishes a complete
replacement only after it can read the previous file. When it cannot save, it
prints `INSTALL_WARN reason=status_unsaved` on stdout, even with `--quiet`,
and keeps its own exit status; `bin/update-run` forwards that line. A reader that finds a
problem prints `INSTALL_WARN` with `reason=status_unreadable`,
`reason=status_unverified`, or `reason=status_pending`, names the cause, and
points here. It does not treat that file as a clean install.

| What you see | Cause | What to do |
|---|---|---|
| `status_unsaved` / `temp_failed`, `write_failed`, `chmod_failed`, `rename_failed`, `mkdir_failed`, `lock_failed` | This run could not create its lock or publish a new snapshot, for example on a full disk or a read-only state directory | The previous file, if any, is still there. Fix the named cause and rerun setup from the verified checkout. |
| `status_unsaved` / `invalid_record` or `oversized` | This run's own observations would not pass the reader's checks, so setup kept the previous file | Check HOME and the host directories, then rerun setup from a verified checkout. If it repeats, report the warning line. |
| `lock_timeout` or `status_pending` / `lock_held` | Another setup holds `install-status.lock`, or a setup was interrupted and left it | Do not delete `install-status`. The owner is recorded as `<pid> <nonce>` in `install-status.lock/owner`; see whether that process is still running (`ps -p <pid>`). If it is gone, or there is no owner file and no setup is running, move the lock directory aside and rerun setup. Setup does not take over a lock by itself. |
| `not_readable` (from setup, `predecessor_not_readable`), or `not_searchable` | The status file, or the state directory holding it, cannot be read | Restore read access (and search access on the directory) or ownership. Keep the file. |
| `symlink`, `directory`, `fifo`, `not_regular` (from setup, with `predecessor_`), or `unsafe_target` | The status path is not a regular file | Leave the unexpected object in place, move it aside only if you know it is not something you need, and rerun setup. Do not follow a link or replace a directory to force a clean result. |
| `unknown_schema` (from setup, `predecessor_unknown_schema`) | A newer gstack-extend wrote the file | Run setup and checks from that newer checkout, or upgrade this one. Keep the file. |
| `malformed`, `unknown_record`, `truncated`, `extra_data`, `count_mismatch`, `oversized` (from setup, with `predecessor_`) | The file is damaged, or is not a snapshot this checkout reads | Move it aside under a dated name so the bytes are kept, for example `mv "$state/install-status" "$state/install-status.damaged-$(date +%Y%m%d%H%M%S)"` where `$state` is the directory above, then rerun setup from a verified checkout. Setup records again what it can see now. A copy whose pointer names a deleted checkout is not recorded again. |
| `home_unreadable` | HOME could not be identified | Fix HOME, then rerun setup. Facts already in the file stay there. |

A failed or partial setup adds what it saw and does not clear older unresolved
facts. After a successful upgrade, rerun `"<checkout>/setup" --host auto` to
refresh installs. After `UPGRADE_FAILED stage=setup`, rerun
`"<checkout>/bin/update-run" "<checkout>"` so the updater's later steps run.
Neither command replaces skill text a session has already loaded.
