# gstack-extend

Extension skills for [gstack](https://github.com/garrytan/gstack): plan work,
implement it, review it, test it with a human, and ship it.

## Skills

Each skill links to its full instructions. **Stable** skills are used and tested
regularly; **New** skills are still settling in; **Beta** skills need more field use.

| Skill | What it does | Status |
|-------|-------------|--------|
| [`/project-spec`](skills/project-spec.md) | Establishes users, MVP outcomes, audience limits and release policy for a new or existing project, then runs roadmap. | New |
| [`/roadmap`](skills/roadmap.md) | Admits work against the selected product target and produces an execution plan with visible outcomes, audits and dependency-aware grouping. | Stable |
| [`/implement`](skills/implement.md) | Executes an approved plan, checks completeness, runs targeted tests, and hands off for review. | Stable |
| [`/review-and-prep`](skills/review-and-prep.md) | Reviews the work, runs local checks, prepares a draft PR, and marks it ready after required testing and applicable Greptile review. | Stable |
| [`/pair-review`](skills/pair-review.md) | Guides manual testing, tracks results, fixes failures, and resumes across sessions. Works with web, native, and CLI projects. | Stable |
| [`/ship-and-land`](skills/ship-and-land.md) | Reuses verified preparation, runs remaining release checks, then merges and verifies deployment through gstack. | New |
| [`/full-review`](skills/full-review.md) | Reviews the codebase with three specialist agents and turns approved findings into backlog items. | Stable |
| [`/gstack-extend-upgrade`](skills/gstack-extend-upgrade.md) | Checks for updates and upgrades the installed checkout. | Stable |
| [`/gstack-extend-init`](skills/gstack-extend-init.md) | Bootstraps project docs, registers the project, and audits the scaffold. | Beta |

## Installation

Requires [Git](https://git-scm.com/), [Bun](https://bun.sh/), and a supported
agent: Claude Code, Codex, OpenCode, or Cursor. The commands that start Bun with
`--no-env-file --no-install --config=/dev/null` need Bun 1.3.3 or newer: the
`/roadmap` audit tools, `gstack-extend init`, the merge gate, and
`bin/layout-scaffold`. `setup` only checks that `bun` is installed, not its
version. Install
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

Greptile's `labels` filter selects PRs; `autoReview` controls automatic events.
For a single explicitly requested review, use `"autoReview": []` while keeping
existing filters. If an approved repair starts from `.greptile.json`, the
workflow proposes renaming and amending it, preserving its settings. Existing
duplicate files are consolidated in the same approved change. Trigger checks
use the PR's source-branch configuration; a separate base-branch change is not
required.

`/review-and-prep` includes a `review-and-prep/v1` marker and reviewed snapshot
in its final prompt. Paste that prompt to run `/ship-and-land`; it trusts those
completed reviews across sessions/models after one receipt lookup and checks
subsequent changes.
Prose-only docs use one repo fact-check, the documentation audit and plan/scope
checks, with or without preparation.
Both code and docs use severity filtering and delta rechecks; code specialists
and Red Team run in parallel when needed. Use `/ship-and-land --reviewed` to
explicitly accept prior code review and coverage audit outside a marked
preparation handoff. Test runs, QA probes, CI, required manual testing and merge
approval retain their own gates.

Use `/project-spec` once at inception or to organize an existing project, and
again when deliberately changing its goals. It produces `docs/SPEC.md` and
finishes through `/roadmap`. Routine `/roadmap` runs use that spec to select work
for the intended users, preserving deferred items with revisit triggers. Each
Track states its outcome and acceptance; Groups summarize what their batch
delivers. `/full-review` remains the periodic codebase review.

Adoption consolidates existing intent into one current spec, retires replaced
plans/specs with explicit superseded notices, and updates active references.
Historical links preserve decision rationale without feeding old scope back
into routine planning; current implementation contracts and evidence retain
their declared roles.

The spec distinguishes MVP-1 (personal use), MVP-2 (a small supported alpha
group), public-beta and public-release, with private-only as an independent
audience policy. Projects choose their own version checkpoints before
public-beta; strict SemVer starts at public-beta by default. Stage acceptance
lives in progress records, not in the version number. `docs/SPEC.md` counts as
the product spec only when it carries the template's `## Authority` section, so
an existing file of another kind at that path keeps its meaning. See the
[project-spec workflow](skills/project-spec.md) for the spec format, adoption
path, local/issue backlog options and consumer-instruction block.

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

Development and tests need Bun 1.3.3 or newer (`engines.bun` in `package.json`).
Install the pinned development dependencies once per checkout, before any test
command:

```bash
bun install --frozen-lockfile   # Once per checkout; never changes bun.lock
bun run test        # Select tests from the committed diff against the base branch
bun run test:full   # Run all tests, including checks for uncommitted changes
```

Tests never install packages. If one stops at `Cannot find package 'ajv'`, run the
install command. [`CLAUDE.md`](CLAUDE.md) covers test selection, fixtures, and skill conventions.
[`VERSION`](VERSION) is the version source of truth, using up to four segments:
`MAJOR.MINOR.PATCH.MICRO`. Release history is in [CHANGELOG.md](CHANGELOG.md);
planned work is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Acknowledgments

Built by [@kbitz](https://github.com/kbitz) with [Claude Code](https://claude.com/claude-code)
(Anthropic), [Codex](https://openai.com/codex/) (OpenAI), and [Grok](https://x.ai/grok)
(xAI, via [Cursor](https://cursor.com/)).

## License

[MIT](LICENSE)
