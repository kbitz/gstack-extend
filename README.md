# gstack-extend

Extension skills for [gstack](https://github.com/garrytan/gstack): plan work,
implement it, review it, test it with a human, and ship it.

## Skills

Each skill links to its full instructions. **Stable** skills are used and tested
regularly; **New** skills are still settling in; **Beta** skills need more field use.

| Skill | What it does | Status |
|-------|-------------|--------|
| [`/roadmap`](skills/roadmap.md) | Turns the backlog into a sequenced execution plan, with audits and dependency-aware grouping. | Stable |
| [`/implement`](skills/implement.md) | Executes an approved plan, checks completeness, runs targeted tests, and hands off for review. | Stable |
| [`/review-and-prep`](skills/review-and-prep.md) | Reviews the work, runs local checks, prepares a draft PR, and marks it ready after required testing and applicable Greptile review. | Stable |
| [`/pair-review`](skills/pair-review.md) | Guides manual testing, tracks results, fixes failures, and resumes across sessions. Works with web, native, and CLI projects. | Stable |
| [`/ship-and-land`](skills/ship-and-land.md) | Reuses verified preparation, runs remaining release checks, then merges and verifies deployment through gstack. | New |
| [`/full-review`](skills/full-review.md) | Reviews the codebase with three specialist agents and turns approved findings into backlog items. | Stable |
| [`/gstack-extend-upgrade`](skills/gstack-extend-upgrade.md) | Checks for updates and upgrades the installed checkout. | Stable |
| [`/gstack-extend-init`](skills/gstack-extend-init.md) | Bootstraps project docs, registers the project, and audits the scaffold. | Beta |

## Installation

Requires [Git](https://git-scm.com/), [Bun](https://bun.sh/) 1.0+, and a supported
agent: Claude Code, Codex, OpenCode, or Cursor. Install
[gstack](https://github.com/garrytan/gstack#install--30-seconds) for the review,
shipping, and deployment workflows these skills build on.

```bash
git clone https://github.com/kbitz/gstack-extend.git ~/.claude/skills/gstack-extend
~/.claude/skills/gstack-extend/setup --host auto
```

`--host auto` installs for detected agents. To target one, use `--host claude`,
`--host codex`, `--host opencode`, or `--host cursor`. Without a host flag,
setup installs for Claude only.

Update with `/gstack-extend-upgrade`. Uninstall with:

```bash
~/.claude/skills/gstack-extend/setup --host auto --uninstall
```

See [installation and troubleshooting](docs/installation.md) for host paths,
install ownership, and recovery steps.

## Typical workflow

Start with an approved plan, then use a fresh session for each handoff:

```text
/implement          # Build the plan and check completeness
/review-and-prep    # Review, test, prepare the PR
/ship-and-land      # Version, ship, merge, and verify deployment
```

If preparation pauses for manual testing, run `/pair-review`, then
`/review-and-prep resume`. Versioning and release notes happen during shipping.
The PR workflows require GitHub access through `gh`. `/review-and-prep` runs
Greptile at most once per PR when applicable, and asks you how to proceed
instead of blocking silently when that run fails, stalls, goes stale, or would
repeat when the PR is marked ready. The PR's receipt records the outcome. See
the linked skill instructions for setup and gates.

Use `/roadmap` to organize upcoming work and `/full-review` for periodic
codebase reviews.

## Command-line tools

Setup exposes `gstack-extend` through `~/.local/bin` when available. If it is not
on your PATH, use `~/.claude/skills/gstack-extend/bin/gstack-extend` directly.

- **Project setup:** `gstack-extend init /path/to/project --dry-run` previews the
  scaffold; `--migrate` fills missing files in an existing project. Writes require
  `jq`. See [`/gstack-extend-init`](skills/gstack-extend-init.md) and `gstack-extend init --help`.
- **Quota ledger (experimental):** `gstack-extend quota status --refresh` checks
  remaining vendor capacity; `gstack-extend doctor quota` diagnoses adapters.
  Only explicit quota commands sample vendors. [Quick start and JSON contract](docs/quota-ledger.md).
- **Telemetry:** `gstack-extend doctor telemetry` checks local skill-run records.
  Optional usage telemetry follows gstack's settings; local execution provenance
  is on by default and never uploaded. [Configuration and data contracts](docs/telemetry.md).
- **Merge gate (shadow-only):** `~/.claude/skills/gstack-extend/bin/merge-gate check --base <ref>`
  reports whether a change would merge, and why. It never merges, pushes, or updates
  refs, and it is not on PATH. [Usage and verdict contract](docs/merge-gate.md).

## Development

```bash
bun run test        # Select tests from the committed diff against the base branch
bun run test:full   # Run all tests, including checks for uncommitted changes
```

[`CLAUDE.md`](CLAUDE.md) covers test selection, fixtures, and skill conventions.
[`VERSION`](VERSION) is the version source of truth, using up to four segments:
`MAJOR.MINOR.PATCH.MICRO`. Release history is in [CHANGELOG.md](CHANGELOG.md);
planned work is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Acknowledgments

Built by [@kbitz](https://github.com/kbitz) with [Claude Code](https://claude.com/claude-code)
(Anthropic), [Codex](https://openai.com/codex/) (OpenAI), and [Grok](https://x.ai/grok)
(xAI, via [Cursor](https://cursor.com/)).

## License

[MIT](LICENSE)
