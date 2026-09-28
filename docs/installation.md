# Installation and troubleshooting

[Back to README](../README.md)

## Installation

**Requirements:** [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (or Codex / OpenCode / Cursor, see below), [Git](https://git-scm.com/), [Bun](https://bun.sh/) v1.0+. `setup` checks for `bun` and fails fast with install instructions if it's missing.

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

Cursor receives regular-file copies with native skill paths, a multiline
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

Cursor is the only host setup keeps out of another host's skills directory.
If you share `~/.codex/skills` or `~/.config/opencode/skills` with Claude through
a symlink, that host's copies replace the Claude links, as before.

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

Setup also registers the checkout as `gstack-extend` in
`$HOME/.gstack-extend/projects.json`. It ignores `GSTACK_EXTEND_STATE_DIR` for
that child registration; direct `init` still honors the override. Registration
or audit errors leave the installation usable and print full diagnostics plus
a HOME-scoped `Retry:` command. Correct the reported cause, then run that
command in Bash.

To uninstall: `~/.claude/skills/gstack-extend/setup --host auto --uninstall`

Setup also removes retired gstack-extend skills owned by this checkout. Personal skills,
foreign install pointers, and unrelated files are preserved.

## Troubleshooting

`EXTEND_ROOT_UNVERIFIED` means a skill found a home install pointer but could not verify it. The line names the first rejected candidate. Match the cause to the fix:

| Cause | Fix |
|---|---|
| The pointer file is empty | `setup --host auto` from your gstack-extend checkout |
| The checkout has no `bin/update-check` (moved or deleted) | Re-clone (see Installation), then run that checkout's `setup --host auto` |
| `bin/update-check` is not a readable executable file | `git checkout -- bin/update-check` in that checkout, then `setup --host auto` |
| `bin/update-check` lacks `# extend-root-protocol: v1` (older checkout, or not gstack-extend) | `git pull --ff-only` in that checkout, then `setup --host auto` |
| The pointer names a non-absolute path | `setup --host auto` from your gstack-extend checkout |

Copy-paste checks, replacing `<skill>` and `<root>`:

```bash
readlink ~/.claude/skills/<skill>/SKILL.md
cat ~/.codex/skills/<skill>/.extend-root
grep -x '# extend-root-protocol: v1' <root>/bin/update-check
```

Running `setup` from a worktree repoints every host at that worktree. Re-run `setup --host auto` from the stable checkout before archiving the worktree.

The resolver probes Claude, then Codex, then OpenCode, then Cursor, and uses the first verified checkout. If those installs point at different checkouts, a session on any host updates the Claude one. Host-aware ordering is not implemented.
