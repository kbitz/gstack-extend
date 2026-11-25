# Installation and troubleshooting

[Back to README](../README.md)

## Installation

### Requirements

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) or Codex, [Git](https://git-scm.com/), and [Bun](https://bun.sh/) **1.3.3 or newer** (verified runtime and development floor). Every Bun-backed launcher passes `--no-env-file --no-install --config=/dev/null`; `--no-env-file` was introduced in Bun 1.3.3, and earlier builds (such as 1.2.0 and 1.3.2) silently ignore it and still load `.env`.

`setup`, `gstack-extend init`, and all 14 Bun-backed `bin/` launchers check Bun before writing or executing. They refuse when Bun is missing, fails the minimum-version check, returns no parseable numeric version, or when the prerequisite helper is missing or unreadable. `gstack-extend init` also checks Bun from the project directory (its parent for a new project), where its post-render audit runs, so a version manager that pins an older Bun there is refused before anything is written. Entry points in the single-line family use these refusal templates. The table lists the other output formats.

```text
<entry>: PREREQ_BUN_MISSING Bun >= 1.3.3 is required (not on PATH); run: install Bun >= 1.3.3 (curl -fsSL https://bun.sh/install | bash and reload your shell or add ~/.bun/bin to PATH), then rerun the same command once; if it still refuses, report this line verbatim. No changes were made. See docs/installation.md#requirements.
<entry>: PREREQ_BUN_TOO_OLD Bun >= 1.3.3 is required (found <found> at <path>); run: upgrade Bun to >= 1.3.3 (bun upgrade, or upgrade via your package manager), then rerun the same command once; if it still refuses, report this line verbatim. No changes were made. See docs/installation.md#requirements.
<entry>: PREREQ_BUN_VERSION_UNKNOWN Bun >= 1.3.3 is required (could not determine version at <path>; saw <detail>); run: upgrade or reinstall Bun >= 1.3.3 (bun upgrade, or curl -fsSL https://bun.sh/install | bash and reload your shell), then rerun the same command once; if it still refuses, report this line verbatim. No changes were made. See docs/installation.md#requirements.
<entry>: PREREQ_HELPER_MISSING prerequisite helper missing or unreadable; re-run ./setup. No changes were made. See docs/installation.md#requirements.
setup: PREREQ_HELPER_MISSING prerequisite helper missing or unreadable; re-run ./setup from a complete checkout. No changes were made. See docs/installation.md#requirements.
<entry>: PREREQ_DEPS_MISSING missing or mismatched runtime dependency <package>@<version> in <checkout>; run: '<checkout>/setup' --host auto or run bun install --production --frozen-lockfile from the checkout. No changes were made. See docs/installation.md#requirements.
```

| Entry points | Channel and format | Exit | Error codes / causes |
|---|---|---|---|
| `setup`, `gstack-extend init`, `roadmap-audit`, `roadmap-id`, `roadmap-pack`, `roadmap-touches`, `roadmap-renumber`, `outside-review`, `secret-dispositions`, `pregate-deps`, `review-delegate` | Single line on stderr. For missing Bun, `setup` also prints download and checksum instructions. Dry-run init warns on stderr and keeps its preview exit behavior. | 1 | `PREREQ_BUN_MISSING`, `PREREQ_BUN_TOO_OLD`, `PREREQ_BUN_VERSION_UNKNOWN`, `PREREQ_HELPER_MISSING` |
| `gstack-extend init`, `roadmap-audit`, `roadmap-pack`, `roadmap-touches` | Single line on stderr. Dry-run init warns and still previews. | 1 | `PREREQ_DEPS_MISSING` |
| `layout-scaffold`, `docs-ship`, `upstream-check` | Two lines on stderr with `ERROR <code>:` and `FIX:`. | 5 | `bun_missing`, `bun_not_absolute`, `bun_too_old`, `bun_version_unknown` |
| `layout-scaffold`, `docs-ship` | Two lines on stderr with `ERROR <code>:` and `FIX:` for an incomplete installation or broken launcher link. | 5 | `source_missing`, `symlink_loop` |
| `upstream-check` | Three lines on stderr with `ERROR INTERNAL:`, version context and `FIX:` for an incomplete installation or broken launcher link. | 1 | `source_missing`, `symlink_loop` |
| `merge-gate` | `ERROR <code>:` / `FIX:` on stderr, or canonical JSON object on stdout when `--json` / `--jsonl` is passed | 1 | `bun_missing`, `bun_too_old`, `bun_version_unknown`, `internal_error` |
| `review-state` | Canonical `internal-error` JSON envelope on stdout plus `ERROR INTERNAL_ERROR:` / `FIX:` on stderr | 5 | `runtime-missing`, `runtime-too-old`, `runtime-version-unknown` |

The helper refusal carries the `PREREQ_HELPER_MISSING` token in the message. For `merge-gate` and `review-state`, that includes the JSON error. `review-state` reports the unavailable helper with cause `runtime-missing`.

A build reporting exactly Bun 1.3.3 must list `--no-env-file` in its help.
Early canaries reported that version before the flag existed. If the check
fails, the launcher reports `PREREQ_BUN_TOO_OLD` with the missing capability.

If setup refuses Bun during an update, fix Bun and resume the
[update procedure](#update-checks) so the updater can finish migrations.

`package.json` and `bun.lock` pin the `marked` runtime dependency for planning
file readers. Fresh `setup` and the setup run by `bin/update-run` during
`/gstack-extend-upgrade` install missing or mismatched dependencies into the
checkout's `node_modules/` using `bun install --production --frozen-lockfile`.
Setup skips installation when the locked versions are already present and
preserves development dependencies in contributor checkouts.

The audit started by `gstack-extend init` and all Bun-backed launchers use
`--no-env-file --no-install --config=/dev/null`. Planning readers load
`marked` from the checkout's `node_modules/` without fetching it at runtime.
After a manual `git pull`, run `<checkout>/setup --host auto` to recover from
`PREREQ_DEPS_MISSING`, or run `bun install --production --frozen-lockfile` from
the checkout.

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

The default install is Claude Code (`~/.claude/skills/<name>/SKILL.md`).
To select an agent explicitly, use `--host claude` or `--host codex`.
To run setup for its detected host paths, use:

```bash
~/.claude/skills/gstack-extend/setup --host auto
```

| Host | Path |
|------|------|
| Claude | `~/.claude/skills/<name>/` |
| Codex | `~/.codex/skills/<name>/` |

Each skill is its own directory with `SKILL.md`. The package checkout is never linked as a skill.

Cursor and OpenCode are no longer supported install hosts (dropped 2026-11-21); see [Retired install hosts](#retired-install-hosts) for leftover copies and removal.

On every host, a `SKILL.md` symlink that points anywhere other than a
gstack-extend checkout's `skills/` directory (a dotfiles-managed personal
skill, say) is treated like a user-owned file: setup warns and leaves it alone.
A link into a checkout that no longer exists is repointed only when setup's own
`.extend-root` beside it still names that checkout.

Codex passes skip a skills directory shared with Claude, on both install and
uninstall, even if Claude was not selected. This includes aliases through parent
directories, dangling links into a directory not created yet, and case variants:
path components that do not exist yet are compared case-blind, so on a
case-sensitive volume a case variant can skip Codex until that directory exists.
Claude can maintain its symlinks in a shared directory; Codex needs a separate
directory to refresh its copies. Setup preserves existing regular files in
Claude's directory, including old generated copies; see
**Shared-directory migration** below. A `--host` run whose host was skipped
installs or uninstalls nothing and leaves the CLI links and registry alone.

Generated copies preserve the shell paths from the skill source. At runtime,
the start command resolves Claude Code and Codex skill links and
`.extend-root` pointers as described in [Start command](#start-command).

If a skill directory is already a personal symlink (for example, linked from
dotfiles), setup stops before installing anything on any selected host. It
preserves the link and its contents, reports the colliding path even with
`--quiet`, and exits unsuccessfully. Choose which skill should own that name,
move the personal link if replacing it, then rerun setup. A symlink collision
remains an error even when other skill names could be installed.

In `--host auto`, a detected host whose skills directory is outside HOME, not
owned by you, or world-writable is skipped with a warning, and the other host
still installs. Naming that host with `--host` stops setup instead. If every
detected host is skipped, setup fails without installing anything.

When hosts are skipped because of shared or unsafe directories, stdout includes
one `SETUP_SKIPPED_HOSTS <csv>` line (for example,
`SETUP_SKIPPED_HOSTS codex`) even with `--quiet` or when setup later
fails. No such line is printed when no host was skipped. Reasons and
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
skill copy was refreshed. A preserved regular file, a shared directory, or an
unsafe directory stays
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

Setup also copies `bin/lib/telemetry-call.sh` to
`$HOME/.gstack-extend/bin/telemetry-call`, whichever hosts it installs for, and
again ignores `GSTACK_EXTEND_STATE_DIR`. Each skill's start command and telemetry
finish block call that file, which finds the compatible wrapper
([telemetry](telemetry.md)). It is a copy so a moved checkout cannot break it, and
`bin/update-run` refreshes it because it runs setup. Pulling a checkout by hand
leaves skill telemetry off until `setup` runs: `GSTACK_EXTEND_TELEMETRY_DEBUG=1`
names the cause and `gstack-extend doctor telemetry` reports a missing helper.

To uninstall: `~/.claude/skills/gstack-extend/setup --host auto --uninstall`

Every managed-host uninstall, including `--host auto --uninstall`, keeps
`~/.local/bin/gstack-extend` and `~/.local/bin/gstack-extend-telemetry` while either
of the two managed hosts (Claude Code or Codex) has an `.extend-root` pointer naming this checkout beside a
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
pointer naming another checkout does not. The `telemetry-call` copy is kept while
either managed host skill directory still holds an `.extend-root` pointer, whichever checkout
wrote it, and removed with the last one. Foreign links and regular files are left alone. Legacy
`--skills-dir ... --uninstall` cleanup leaves the shared CLI links alone.

Uninstall from a managed host or with `--host auto` keeps the shared preamble
while Claude Code or Codex has an `.extend-root` pointer or a recognized
older skill link into a live checkout. This applies across checkouts.
Uninstall removes the shared copy when neither kind of install remains.
Legacy `--skills-dir ... --uninstall` leaves it alone.

Setup also removes retired gstack-extend skills owned by this checkout. Personal skills,
foreign install pointers, and unrelated files are preserved.

### Hosts setup does not manage

`setup` manages Claude Code and Codex from the table above. Another agent that reads
`<host-skills-dir>/<name>/SKILL.md` can still use a skill that needs
no helper from this checkout, such as `/plan-track`. Antigravity's
`~/.gemini/config/skills/` is one such directory. Muse Code 1.4.25 validated
scratch Codex renderings of `/review-and-prep` and the initial PR B copies of
`/roadmap`, `/ship-and-land`, and `/pair-review`.
[PR A load checks](acceptance/skill-references.md#pre-merge-scratch-load-and-reference-checks),
[PR B load checks](acceptance/skill-references.md#pre-merge-scratch-load-checks-pr-b).

With a managed Claude install, link the directory `setup` already maintains, so
the link follows later refreshes. For Codex, use `~/.codex/skills`:

```bash
mkdir -p <host-skills-dir>
ln -s ~/.claude/skills/plan-track <host-skills-dir>/plan-track
```

With no managed install, link the source file the way `setup` does for Claude:

```bash
mkdir -p <host-skills-dir>/plan-track
ln -s <checkout>/skills/plan-track.md <host-skills-dir>/plan-track/SKILL.md
```

`/plan-track` can continue without a managed install. If the start command is
missing, rejected, refused or fails, the skill reports the problem once and
skips telemetry finish for that run.
`setup` and its uninstall never see these links, so remove them by hand; a link
dangles after `setup --uninstall` or a moved checkout. Skills that call checkout
helpers need a Claude Code or Codex install. The start command resolves only
these two hosts. If your only skill copies are under Cursor or OpenCode, run
`./setup --host claude` or `./setup --host codex` from your checkout and start the
skill in that host; see [Retired install hosts](#retired-install-hosts) to clean up
leftover copies.

### Retired install hosts

Cursor (`~/.cursor/skills/`) and OpenCode (`~/.config/opencode/skills/`) install support was dropped on 2026-11-21. Supported install hosts are Claude Code (`claude`) and Codex (`codex`).

- **Install refusal:** `setup --host cursor` and `setup --host opencode` exit `1` without touching any directory, link, helper, registry or `install-status` file, and print an unsupported message with the removal command. `--host auto` and `--host auto --uninstall` ignore both directories (aside from the install-run notice below).
- Run `<checkout>/setup --host cursor --uninstall` or `<checkout>/setup --host opencode --uninstall` to remove leftover copies. The command handles known skill names only. It removes a `SKILL.md` link to the matching source in that checkout's `skills/` or a regular `SKILL.md` beside a regular, readable `.extend-root` naming that checkout. It also removes orphaned regular copies when the pointer gives a normalized absolute path and the checkout is confirmed missing. It preserves unrelated personal files, shared CLI links, `telemetry-call`, `preamble`, the registry and `install-status`. It skips a directory with a warning if it belongs to Claude Code or Codex, resolves outside your home, is foreign-owned, or is world-writable. Successful removal and safe skips exit `0`.
- For remaining copies, inspect `~/.cursor/skills/<name>/.extend-root` or `~/.config/opencode/skills/<name>/.extend-root`. Empty, relative, or otherwise unverified pointers and copies under unknown skill names stay in place. The command also reports copies owned by another checkout and prints that checkout's removal command. Inspect the named checkout before running it.
- Setup checks for regular leftover copies beside regular, readable `.extend-root` files before installing, including under `--quiet`. For each safe, unshared retired skills directory with matching copies, it reports counts by owner on stderr and gives the removal command or manual recovery guidance.
- When update checks are enabled, `bin/update-check` reports regular leftover copies in safe, unshared retired directories. The scan reads up to 4096 bytes from each regular `.extend-root` pointer and groups copies by the first line. It emits up to four `INSTALL_WARN host=<cursor|opencode> skill=- path=<dir> reason=retired_host cause=host_dropped detection=not_applicable checkout=<root> freshness=unverified Fix: <checkout>/docs/installation.md#retired-install-hosts` lines per directory. An overflow line substitutes `more_owners=<count>` for `checkout=<root>`. Warnings appear after any version line and also appear when the version check is cached, snoozed or offline. Remove the old copies to clear their warnings. `update_check=false` silences all update checks.
- **Legacy `install-status` facts:** existing `cursor` and `opencode` facts in `install-status` (including `cursor_unserved` and `cursor_home`) remain readable so existing frames never turn `malformed`. `bin/update-check` suppresses them (the live `retired_host` scan supersedes them), and `setup` drops them on its next reconciling install run.
- **Transitional status:** the refusal, removal path, install notice, `retired_host` scan and legacy-fact acceptance are transitional and will be removed once the owner's machines hold no Cursor or OpenCode copies, or in the first release after 1.0, whichever comes first.

### Start command

Every gstack-extend skill starts with one fixed command:

```bash
~/.gstack-extend/bin/preamble <skill>
```

`setup` installs `bin/lib/preamble.sh` as a regular executable copy at `$HOME/.gstack-extend/bin/preamble` (mode `755`) beside `$HOME/.gstack-extend/bin/telemetry-call`, before publishing any skill link or copy. It resolves the verified checkout from `~/.claude/skills/<skill>` and `~/.codex/skills/<skill>` (links first, then `.extend-root` pointers), prints `EXTEND_ROOT:` and `_EXTEND_ROOT=`, runs `bin/update-check` (with `--force` for `/gstack-extend-upgrade`), and starts telemetry.

**Modes and flags:**

- `~/.gstack-extend/bin/preamble <skill>` — resolve root, run `bin/update-check`, start telemetry.
- `--force` — pass `--force` when `bin/update-check` runs.
- `--require <helper>` — in default or `--root` mode, require a verified root and executable `bin/<helper>`. A failed check prints `ERROR:` to stdout and exits `1`.
- `--root` — print only the root lines (runs neither `bin/update-check` nor telemetry); used to recover `_EXTEND_ROOT=` later in a session.
- `--resume` — start a new telemetry segment after a deliberate pause. This mode skips root lookup and update checks.
- `--ref <file> --expect <digest> [--lines <a>-<b>]` — read numbered lines from a verified reference using its 16-hex SHA-256 digest. This mode skips update checks and telemetry. See [Skill references](#skill-references).
- `--help` / `-h` — on its own, print usage synopsis and flag descriptions to stdout and exit `0`.

`--root` and `--resume` are mutually exclusive. Invalid arguments print
`preamble: PREAMBLE_USAGE:` on stderr and exit `2`.

**First-run check:** after running `./setup --host auto`, verify the install without side effects:

```bash
~/.gstack-extend/bin/preamble plan-track --root
```

Expected output:

```text
EXTEND_ROOT: /path/to/gstack-extend
_EXTEND_ROOT=/path/to/gstack-extend
```

**Permission grant:** each Claude Code skill includes `Bash(~/.gstack-extend/bin/preamble:*)` after `Bash` in `allowed-tools`. Setup strips `allowed-tools` from Codex copies. The local shell probe confirmed tilde expansion in Bash 5.3.20. Permission decisions in Claude Code auto mode and live worker adherence in Claude Code and Codex still need owner verification. Allowing `~/.gstack-extend/bin/preamble` lets it run `bin/update-check` from the resolved checkout and `$HOME/.gstack-extend/bin/telemetry-call`, which looks up `gstack-extend-telemetry` on `PATH` first.

**Shared copy.** Setup uses a temporary file and an atomic rename to publish
`~/.gstack-extend/bin/preamble`. The last setup to publish that file supplies
the shared copy, even when it ran from an older clone or worktree. The command
resolves the checkout per skill at runtime. Rolling back to a release before
the start command was added leaves the copy on disk and unused.

**Recovery.** Exit `127` or `126` means the shell could not find or execute the
command (`PREAMBLE_MISSING`). Exit `2` with `preamble: PREAMBLE_USAGE:` means
the command rejected an argument (`PREAMBLE_ARGS`), as an older copy does when
given a flag it does not recognize. First retry the start line exactly as
written for a rejected argument. If it still fails, or the skill reports
`PREAMBLE_MISSING` or `PREAMBLE_FAILED`, run `./setup --host auto` from the
checkout your skills link to, then start the skill again.

**Developer escape hatches:** to test a checkout's start command without replacing `~/.gstack-extend/bin/preamble`, run `bash <checkout>/bin/lib/preamble.sh <skill> --root`. To debug a non-zero `bin/update-check` exit, run `<root>/bin/update-check` directly.

### Update checks

On a fresh start, the start command runs `bin/update-check` after it finds a
verified checkout. A skill follows its upgrade flow when the check prints
`UPGRADE_AVAILABLE <old> <new>`.

In an interactive session (`GSTACK_SESSION_KIND` unset or any value other than
`spawned` or `unattended`), the flow checks `auto_upgrade`. With `auto_upgrade=true`
it runs `"$_EXTEND_ROOT/bin/update-run" "$_EXTEND_ROOT"` without asking; otherwise it
asks whether to upgrade now, enable auto-upgrade after a confirmed upgrade, snooze
for 24h / 48h / 1 week, or set `update_check=false`. `/plan-track` is the exception:
because it asks no questions and installs nothing, it always follows the spawned
branch below.

With `GSTACK_SESSION_KIND` set to `spawned` (or `unattended`), the flow asks nothing,
never runs `bin/update-run` even under `auto_upgrade=true`, writes no snooze or
config state itself, and puts the available version line in the run's final message
before any fenced prompt or result, handoff, stage or pause line. Concurrent stages
share the installed checkout, so upgrading from a spawned stage could mutate that
checkout underneath other stages running at the same time.

`bin/update-check` keeps its own state in every session kind: it refreshes its cache;
it consumes the just-upgraded marker and clears a snooze when it reports
`JUST_UPGRADED`; and it clears a snooze whenever `/gstack-extend-upgrade` runs it with
`--force`. A spawned stage may therefore be the run that shows the "just updated"
notice, and a spawned run can end a snooze early, so the next interactive stage may
ask sooner.

The skill reads this variable from the environment only; any other value, or none,
uses the interactive branch. A caller that launches stages without a person must set
`GSTACK_SESSION_KIND=spawned`; otherwise a stage may ask the upgrade question at
start or auto-upgrade under `auto_upgrade=true`. Skill text is not enforcement: a
caller that must never upgrade should deny `bin/update-run` in its own permission
layer.

To upgrade when a spawned run reports a newer version, run `/gstack-extend-upgrade`
in an interactive session, or run `<checkout>/bin/update-run <checkout>` directly.

### Version numbers

gstack-extend's own VERSION uses `MAJOR.MINOR.PATCH` without prefixes or suffixes
from the first release cut from a base containing the transition policy.
Historical four-part tags/records remain valid. Consumer projects keep their
own version schemes and init defaults. Comparison pads a missing fourth part
with zero: `0.47.0 == 0.47.0.0`, while `0.47.0 > 0.46.0.0`. An equal or malformed
remote VERSION produces no upgrade offer. Silence alone does not prove a
refreshed installation; cache, snooze and offline checks can also be silent.

For example, a legacy install might print `UPGRADE_AVAILABLE 0.47.0.0 0.48.0`,
then `UPGRADE_OK 0.47.0.0 0.48.0`, then `JUST_UPGRADED 0.47.0.0 0.48.0` on its
next check. These are illustrative numbers, not a published release promise.
`UPGRADE_OK` covers the checkout; inspect `SETUP_SKIPPED_HOSTS`, `INSTALL_WARN`
and `MIGRATION_WARN` separately. The first cutover's release notes disclose
padded equality and link this recovery guidance. See the
[qualification record](acceptance/release-compatibility.md) for candidate-only
proof and the pending real published-tag upgrade. See the
[compatibility catalog](compatibility.md) for which surfaces the version rules
cover.

To roll back an otherwise clean install, first save user work and identify the
last four-part tag from its release history (on the default remote this is
`v0.47.0.0`). Do this in the installation checkout, never a project worktree:

```sh
git fetch --tags origin
git status --short
# Stop and preserve any local changes before continuing.
LAST_FOUR_PART=$(git tag --list 'v*.*.*.*' --sort=-v:refname |
  awk '/^v[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ {print; exit}')
if [ -z "$LAST_FOUR_PART" ]; then
  echo 'No four-part release tag found. Check the remote and fetch its tags.'
else
  echo "Rolling back to: $LAST_FOUR_PART"   # e.g. v0.47.0.0
  git diff --name-status --diff-filter=A "$LAST_FOUR_PART"..HEAD -- skills/
  ./bin/config set update_check false &&
    git checkout --detach "$LAST_FOUR_PART" &&
    ./setup --host auto --quiet
fi
```

Pause update checks first: the restored checker still offers the newer release,
and accepting it (or `auto_upgrade=true`) makes `bin/update-run` fast-forward the
detached checkout back to main. The pause also hides `INSTALL_WARN` lines.
This leaves detached HEAD. The diff before checkout lists skills that the older
setup cannot refresh. Every skill added after that tag (for example, `plan-track`
after `v0.47.0.0`) stays installed as a dangling link or stale copy and may fail
until you resume upgrades. Rollback preserves install migrations and saved
telemetry and ledgers. Retain readers capable of every
emitted schema (including stage-runs v2, v3 and v4), reading both the legacy
`analytics/stage-runs.jsonl` and per-host `analytics/stage-runs/*.jsonl` files.
An older writer resumes appending to the legacy path; retain the per-host files
and their capable readers. Inspect warnings and preserve user-owned
files. To resume upgrades, return to the install's main branch, re-enable checks
and rerun its updater: `git checkout main`, `./bin/config set update_check true`,
then `./bin/update-run "$PWD"`. If setup failed, follow the reported setup
recovery before relying on refreshed skills.

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
`existing_skill`, `explicit_host`, or `not_applicable` for the
Claude fallback). Recover with a verified checkout, normally the one in the Fix link,
whatever `checkout=` shows. A status line (`reason=status_*`) names the state
path and its cause instead. Paths are shell-quoted when needed. Treat the
text after `INSTALL_WARN` as a human-readable diagnostic: rely on that token and
the `reason=` and `cause=` values, not on field order.
`reason=preserved_regular` means the file was left in place. `compare=` says
whether that file matched the checkout source (`matches_canonical`,
`differs_canonical`, or `source_unavailable`). `variant=` is that comparison
after the copy-host frontmatter strip. `observed=` is the checkout version
recorded with the fact, not another reading of the file. `freshness=unverified`
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
its own. `shared_directory` also needs that directory separated from the other
managed host's directory. Legacy `cursor` and `opencode` facts are dropped
automatically on the next reconciling install run (see [Retired install hosts](#retired-install-hosts)).

A pointer that names a moved or deleted checkout does not by itself refresh
or delete the copy. A second verified checkout can clear a fact only for the
exact host path it re-checks and finds repaired. Another HOME's managed-host
facts stay in the file and are not printed for this HOME. Codex with its own skills
directory is refreshed with `setup --host codex`.

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

For Codex, back up the shared-directory wiring and give Codex a
separate skills directory, then run `setup --host codex` to install fresh copies there.
If you no longer use Codex, its `shared_directory` warning stays until its
setup succeeds once into a directory of its own. Run that setup, then
`setup --host codex --uninstall` if you do not want its copies.

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

Codex already using its own skills directory is refreshed
with `setup --host codex`. This does not rewrite Claude's preserved files. Set
`GSTACK_EXTEND_RECOVERY_HOST` to `codex`. `RECOVERY_HOST_SKIPPED` (exit 6)
means setup still skipped that host, usually because its directory is shared,
and `RECOVERY_STATUS_UNSAVED` (exit 7) means setup could not save its record.

<!-- recovery-example:separate-host -->
```bash
(
checkout=${GSTACK_EXTEND_RECOVERY_CHECKOUT:?}
host=${GSTACK_EXTEND_RECOVERY_HOST:?}
case "$host" in
  codex) ;;
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

If that pointer sits beside a regular `SKILL.md` in a directory Codex
shares with Claude, rerunning setup does not regenerate it; follow
**Shared-directory migration** instead.

Copy-paste checks, replacing `<skill>` and `<root>`:

```bash
readlink ~/.claude/skills/<skill>/SKILL.md
cat ~/.codex/skills/<skill>/.extend-root
grep -x '# extend-root-protocol: v1' <root>/bin/update-check
```

Running `setup` from a worktree repoints every host at that worktree. Re-run `setup --host auto` from the stable checkout before archiving the worktree.

The start command checks Claude Code and Codex skill links in that order,
then their `.extend-root` pointers in the same order. It uses the first
verified checkout, regardless of which host runs the skill.

**Start-command install failure:** if `setup` refuses or fails to install `~/.gstack-extend/bin/preamble` (for example, the destination is a symlink or directory, `$HOME/.gstack-extend/bin` is unwritable or foreign-owned, or the copy fails), `setup` prints the path, cause, and a `Fix:` line and exits `1` without installing any skills. Fix the path or permissions as instructed and rerun `<checkout>/setup --host auto`; if the checkout is already updated, its skill text requires `~/.gstack-extend/bin/preamble` until `setup` succeeds.

Setup and uninstall share a short lock while changing the helper and skill
files. Uninstall leaves the helper directory available for a waiting setup.
If a run times out waiting for the lock, wait for the other setup to finish
and retry. If an interrupted setup left the lock behind, confirm no setup is
running before removing the empty `~/.gstack-extend/bin/.setup.lock` directory.

### Skill references

Slimmed skills fetch conditional instructions from `skills/references/<skill>/<file>.md` in the verified checkout through `~/.gstack-extend/bin/preamble <skill> --ref <file> --expect <digest>`. Pass the file stem without `.md`. A required read failure stops the skill at that step and preserves existing holds. After fixing the cause, resume the existing work. If an optional metrics read fails in `/review-and-prep` or `/ship-and-land`, the skill reports the error, records `capture=partial (reference-unavailable)`, and continues the workflow.

| Error line / cause | Meaning | Fix |
|---|---|---|
| `SKILL_REFERENCE_MISSING` (`cause: absent`) on a normal checkout | The reference file is missing from the checkout (for example, an older checkout or local deletion) | Run `"<root>/bin/update-run" "<root>"`, or inspect with `git -C "<root>" status -- skills/references` if the checkout has local changes |
| `SKILL_REFERENCE_MISSING` (`cause: absent`) on a linked worktree | The verified root is a linked worktree (`bin/update-run` refuses linked worktrees) | Run `setup --host auto` from your stable gstack-extend checkout |
| `SKILL_REFERENCE_MISSING` (`cause: unreadable`) | The reference could not be read or its bytes could not be verified | Follow the fix in the error line. Check the file, temporary directory, or digest utility it names. |
| `SKILL_REFERENCE_MISSING` (`cause: no-root`) | No verified gstack-extend checkout was found under `~/.claude` or `~/.codex` | Run `setup --host auto` from your gstack-extend checkout (see Installation) |
| `SKILL_REFERENCE_STALE` (`cause: digest-mismatch`) | The loaded skill copy and the checkout's reference file are different versions (for example, after a manual `git pull` without rerunning `setup`, or after a mid-run upgrade) | Restart `/<skill>` so the loaded copy matches the checkout; if it still differs, run `"<root>/setup" --host auto` from the checkout this host should use |
| `SKILL_REFERENCE_USAGE` (`cause: usage`) | Bad arguments passed to `preamble ... --ref` (exit 2) | Re-run the exact command from the skill's read instruction (`preamble <skill> --ref <file> --expect <digest> [--lines <a>-<b>]`) |
| `PREAMBLE_USAGE` (exit 2) on `--ref` | The shared `~/.gstack-extend/bin/preamble` predates `--ref` support | Run `./setup --host auto` from your updated gstack-extend checkout |
| `SKILL_REFERENCE_INCOMPLETE` | The skill still could not verify the full reference after retrying in chunks | Report the step, reference, harness and version before resuming |

If output omits the trailer, fetch `--lines 1-1` first to recover the line count.
Retry missing lines within that count using one-based inclusive `--lines <a>-<b>` ranges.
Each read verifies the whole file and ends with `REFERENCE_END`, which reports
the full line count and digest. After updating a checkout manually, rerun
`./setup --host auto` from that checkout to refresh the managed skill copies
and shared start command.

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
