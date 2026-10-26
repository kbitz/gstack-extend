# gstack-extend

Extension skills for [gstack](https://github.com/garrytan/gstack): plan work,
implement it, review it, test it with a human, and ship it.

## Product direction

The project is in public beta. [The project spec](docs/SPEC.md) defines the
1.0 contract: a dependable complete skill workflow on **Paseo and Conductor
with equal priority**, plus stable handoffs for external orchestrators.
Quota-driven routing and unattended shipping remain later work. The
[roadmap](docs/ROADMAP.md) lists the required work;
[acceptance records](docs/PROGRESS.md#acceptance) distinguish pending proof from
shipped code. Workspace hosts and agent harnesses are separate support axes.

## Skills

Each skill links to its full instructions. **Stable** skills are used and tested
regularly; **New** skills are still settling in; **Beta** skills need more field use.

| Skill | What it does | Status |
|-------|-------------|--------|
| [`/project-spec`](skills/project-spec.md) | Establishes users, MVP outcomes, audience limits and release policy for a new or existing project, then runs roadmap. | New |
| [`/roadmap`](skills/roadmap.md) | Admits work against the selected product target and produces an execution plan with visible outcomes, audits and dependency-aware grouping. | Stable |
| [`/autoplan-lean`](skills/autoplan-lean.md) | Runs upstream `/autoplan`'s full review from the installed phase skills, keeps the plan within a size budget set by its card using a hashed review-record sidecar and bounded reviewer prompts, and finishes with a copyable `/implement` handoff. | New |
| [`/implement`](skills/implement.md) | Executes an approved plan, checks completeness, runs targeted tests, and hands off for review. | Stable |
| [`/review-and-prep`](skills/review-and-prep.md) | Reviews the work, runs local checks and `/ship`'s pre-release gates, prepares a draft PR, and marks it ready after required testing and applicable Greptile review. | Stable |
| [`/pair-review`](skills/pair-review.md) | Guides manual testing, tracks results, fixes failures, and resumes across sessions. Works with web, native, and CLI projects. | Stable |
| [`/ship-and-land`](skills/ship-and-land.md) | Reuses verified preparation, runs remaining release checks, then merges and verifies deployment through gstack. | New |
| [`/docs-ship`](skills/docs-ship.md) | Takes a docs-only PR to the merge gate in one session: classifies it, checks scope, claims, rules, links and the tests that read the changed files, writes any bump the release policy asks for, and records a receipt. Never merges. | New |
| [`/full-review`](skills/full-review.md) | Reviews the codebase with three specialist agents and turns approved findings into backlog items. | Stable |
| [`/gstack-extend-upgrade`](skills/gstack-extend-upgrade.md) | Checks for updates and upgrades the installed checkout. | Stable |
| [`/gstack-extend-init`](skills/gstack-extend-init.md) | Bootstraps project docs, registers the project, and audits the scaffold. | New |

## Installation

Requires [Git](https://git-scm.com/), [Bun](https://bun.sh/), and a supported
agent: Claude Code, Codex, OpenCode, or Cursor. The commands that start Bun with
`--no-env-file --no-install --config=/dev/null` need Bun 1.3.3 or newer: the
`/roadmap` audit tools, `gstack-extend init`, the merge gate,
`bin/layout-scaffold`, `bin/outside-review`, `bin/secret-dispositions`, `/autoplan-lean`'s
`bin/autoplan-lean` helper and `/docs-ship`'s `bin/docs-ship` helper. `setup` only checks that `bun` is installed, not its
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

Start with an approved plan (upstream `/autoplan`, or `/autoplan-lean` for a
smaller reviewed plan), then use a fresh session for each handoff:

```text
/implement          # Build the plan and check completeness
/review-and-prep    # Review, test, prepare the PR
/ship-and-land      # Version, ship, merge, and verify deployment
```

A docs-only PR, including the commit `/roadmap` or `/project-spec` leaves,
skips that path: run `/docs-ship`, which stops when the user should merge. See
the [docs-ship contract](docs/docs-ship.md) for what counts as docs-only.

If preparation pauses for manual testing, run `/pair-review`, then
`/review-and-prep resume`. Versioning and release notes happen during shipping.
The PR workflows require GitHub access through `gh`. `/review-and-prep` runs
Greptile at most once per PR when applicable, and asks you how to proceed
instead of blocking silently when that run fails, stalls, goes stale, or would
repeat when the PR is marked ready. The PR's receipt records the outcome. A
fix-scope question with one recommended, reversible option proceeds without
waiting; the receipt lists each such choice for your veto. For lighter
hand-launched reviews (one full cycle, then delta repair cycles), run
`~/.claude/skills/gstack-extend/bin/config set review_default light`. See
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
The [stage-handoff contract](docs/workflow-handoffs.md) specifies each handoff and how a caller should treat it.

Both wrappers support [reviewed secret-scanner dispositions](docs/secret-dispositions.md):
user-approved, committed exact-line exceptions for MEDIUM false positives, with
the raw pregate failure retained. HIGH findings remain blocking.
Preparation also runs `/ship`'s pregate, coverage audit and documentation audit
on the head it hands off. For a code PR (not the prose-only profile) whose
prepared head is still the PR head, with an unmoved base, `/ship-and-land` takes
a release-only path: it reuses the fresh test
evidence and those audits, writes only the version, CHANGELOG entry and PR
receipt, then runs the tests that release metadata selects (the full suite
instead when `full-suite=final` is in force), and hands a finding that needs any other change back to
`/review-and-prep`. `/ship-and-land --no-land` stops at the merge gate and
ends by asking whether to land: it names the head and what landing would ask
you to accept, such as no CI, and gives the command that starts the landing run,
which asks for merge approval itself. With a blocker, it names the repair instead.
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
  is on by default and never uploaded. `/review-and-prep` and `/ship-and-land`
  also keep optional local [workflow metrics](docs/telemetry.md#workflow-metrics)
  under the same provenance switch. [Configuration and data contracts](docs/telemetry.md).
  Claude Code outside calls use [bounded prompts and local parse recovery](docs/outside-review.md),
  with per-section byte counts and reported cache usage. Savings remain unmeasured
  until the first real review after release.
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

`bun run test` prints which test files it ran and skipped, and why. A run of
every file prints that reason once. Editing one
skill runs that skill's tests plus the shared skill rules. A release commit
(VERSION, CHANGELOG.md, package.json's version) runs the release and manifest
checks. Any other `package.json` change still runs everything.

Tests never install packages. If one stops at `Cannot find package 'ajv'`, run the
install command. [`CLAUDE.md`](CLAUDE.md) covers test selection, fixtures, and skill conventions.
[`VERSION`](VERSION) is the version source of truth. Starting with the first
release cut from a base containing this policy, gstack-extend uses SemVer core
`MAJOR.MINOR.PATCH`, without prefixes or suffixes. The first cutover is a 0.x
MINOR with disclosure and migration guidance; historical four-part tags and
records stay intact. Consumer projects retain their own schemes and init defaults.
See the [release policy](docs/SPEC.md#release-policy),
[cutover procedure](CLAUDE.md#versioning), and
[qualification evidence](docs/acceptance/release-compatibility.md).
[Stage-runs schema v2](docs/telemetry.md#producer-version) is one example of the
versioned provenance schemas in SPEC's [Stable surfaces](docs/SPEC.md#release-policy);
the full O5.1 catalog remains a required pending obligation in [TODOs](docs/TODOS.md).
Release history is in [CHANGELOG.md](CHANGELOG.md); planned work is in
[docs/ROADMAP.md](docs/ROADMAP.md).

## Acknowledgments

Built by [@kbitz](https://github.com/kbitz) with [Claude Code](https://claude.com/claude-code)
(Anthropic), [Codex](https://openai.com/codex/) (OpenAI), and [Grok](https://x.ai/grok)
(xAI, via [Cursor](https://cursor.com/)).

## License

[MIT](LICENSE)
