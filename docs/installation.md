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
into a directory not created yet, and case variants: a not-yet-created
directory is compared case-blind, so on a case-sensitive volume a case variant
can skip a host. Claude can maintain its symlinks in a shared
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
fails. No such line is printed when no host was skipped. A Cursor that yields
is listed only when the same run did not process the host it yields to; it
otherwise reads that host's refreshed install. Reasons and recovery
guidance remain on stderr. `bin/update-run` forwards the line;
`UPGRADE_OK` means the checkout upgraded, while listed hosts were left untouched
and may still have stale copies. The upgrade flow reports both outcomes, whether
`/gstack-extend-upgrade` or another skill's auto-upgrade runs it.
Fix the directories and rerun `setup --host auto` from that checkout to refresh
the host installs without another upgrade. After `UPGRADE_FAILED stage=setup`,
rerun `<checkout>/bin/update-run <checkout>` instead so its post-setup steps
also run.

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
have only the link), and prints that file as `Kept for: <path>`. A skill whose
`.extend-root` is not a regular file is skipped on install and uninstall; remove
that entry by hand. The last uninstall removes
both links if they point at this checkout. A preserved, customized skill's pointer also keeps the links; a
pointer naming another checkout does not. Foreign links and regular files are left alone. Legacy
`--skills-dir ... --uninstall` cleanup leaves the shared CLI links alone.

Setup also removes retired gstack-extend skills owned by this checkout. Personal skills,
foreign install pointers, and unrelated files are preserved.

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
