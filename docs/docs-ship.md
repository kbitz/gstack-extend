# /docs-ship contract

`/docs-ship` takes a docs-only pull request from review to the merge gate. It
replaces `/review-and-prep` and `/ship-and-land` for that PR. It runs narrow
checks in one session: the classification below, scope against the brief,
claims, project rules, links, the tests that read the changed files, and the
PR body. When the project's release policy bumps for docs changes, it writes
the bump. It records a receipt in the PR body, marks the PR ready, and stops
with the head the user approves. It never merges. Merge authority stays with
the user or with the caller's own gate.

It uses no subagents, no outside voices, no `/review`, no Greptile and no full
test suite. A Sonnet-class model can run it; the caller picks the model.

The skill is beta. The helper `bin/docs-ship` (`docs-ship --help`) does the
mechanical parts; `tests/docs-ship.test.ts` locks its behavior.

## Docs-only classification

One classification serves three skills. `/docs-ship` applies it, and
`/review-and-prep`'s Greptile docs-only rule and `/ship-and-land`'s `DOCS`
profile use it when the repository documents no classification of its own.
Those two skills skip the project's `docs-ship:docs` opt-ins, so agent
instructions stay behavioral there. They still inspect the actual hunks and
keep their own rules for release bookkeeping they write. `docs-ship classify`
applies the classification to the PR's own changes (merge-base to head),
reading the configuration from the base branch tip.

**Docs by default:**

- top-level `*.md` and `*.markdown` files, such as `README.md`, `TODOS.md` and
  `ROADMAP.md`;
- under `docs/`: prose (`.md`, `.markdown`, `.rst`, `.adoc`, `.txt`) and
  raster images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`);
- `CHANGELOG.md` lines, under the release-file rules below.

**Not docs by default (executable instructions):** `AGENTS.md`, `CLAUDE.md`,
`GEMINI.md` and `SKILL.md` at any depth (case-insensitive); anything under a `skills/`,
`prompts/`, `templates/` or `template/` directory; `*.tmpl` and `*.template`
files, with or without a further extension. A project opts such paths in with
`docs-ship:docs=` (see [Configuration](#configuration)).

**Everything else stops:** code, tests, build and CI files (including `docs/requirements.txt`), configuration,
non-prose files under `docs/` (SVG, HTML, scripts), Markdown outside the
allowlist, symlinks and submodules. Each stopped file gets a reason:
`version`, `agent-instructions`, `classification-config`, `project-excluded`,
`special-file`, `test`, `build`, `code` or `outside-allowlist`.

**Release files:**

- A change to `VERSION` or to any version field stops (reason `version`). Version
  fields include package-manifest and lockfile version slots and version
  constants in code and Markdown frontmatter. Version-like text in prose examples is not a version field. A version change, not a changelog line, signals a release.
- `CHANGELOG.md` lines are docs when no version changes and no version heading
  is added. Adding a version heading (`## [1.2.3]`, `## v1.2.3`, or linked headings at any level) stops. These section rules apply to the root `CHANGELOG.md`; other changelog names need project rules.
- Adding, changing or removing a line inside an already-released version's
  section is a finding, not a stop, because it rewrites shipped notes. Check it
  against the project's release policy. If the policy is silent, report it and
  suggest moving the line to `## [Unreleased]` or the next version's section.

A PR that changes a `docs-ship:` marker line stops (`classification-config`):
including a symlink target or a fence edit that activates a marker. The base tip's configuration applies, so a PR cannot opt itself in.

## Configuration

Settings are HTML comment markers in the base tip's `AGENTS.md` or `CLAUDE.md`,
like the existing `<!-- roadmap:parallelism_cap=N -->`. A symlinked
instructions file is read once. Markers inside fenced blocks or inline code are
examples, not settings. Globs use `*` (within one path segment) and `**` (any
depth); brackets and braces are rejected.

| Marker | Effect |
|---|---|
| `<!-- docs-ship:docs=AGENTS.md,runbooks/** -->` | Treat these paths as docs, overriding the default exclusions and allowlist. Release-file rules, marker changes, symlinks and `not-docs` still apply. |
| `<!-- docs-ship:not-docs=docs/templates/** -->` | Stop on these paths even inside the allowlist (reason `project-excluded`). |
| `<!-- docs-ship:tests=tests/test_docs.py -->` | Always run these tests, in addition to the discovered ones. Use it for tests that read docs through imports, globs or computed paths. |
| `<!-- docs-ship:rules=docs/writing-rules.md -->` | The rules file to check the diff against. Default: `AGENTS.md`, else `CLAUDE.md`. |
| `<!-- docs-ship:test-command=python3 -m pytest {tests} -->` | The runner command; `{tests}` becomes the selected test paths. Without it, the skill builds the command from the project's documented test instructions. |

List markers may repeat; their values merge. A scalar set twice with different
values, an unknown key or an invalid glob refuses with `CONFIG_INVALID`. A `tests` pattern matching no tracked file at head refuses with `CONFIG_TESTS_MISSING`; it never silently drops an always-run test.

## Stops and choices

When classification stops, `/docs-ship` changes nothing until the user picks
one of three choices:

- **Proceed anyway.** The receipt records the stopped files, their reasons and
  the user's choice. A stopped version change also means `/docs-ship` writes no
  bump of its own.
- **Drop the offending change.** Restore each stopped path to its merge-base
  content (delete it if the PR added it), commit, push, and classify again.
- **Run the normal review.** End with verdict `HANDED-BACK` and a
  `/review-and-prep` handoff. At initial classification nothing is written. A later hand-back because a test itself needs changing preserves prior commits, pushes and PR creation and makes no further writes.

A caller that cannot answer questions gets `HANDED-BACK`.

## Doc-pinning tests

A docs edit can break a test that reads the file, for example one that slices
a runbook by position. `docs-ship tests` selects every runnable test file whose
text names a changed path or file name, plus the `docs-ship:tests` files.
Runnable means it matches a test-file name pattern (`*.test.*`, `*.spec.*`,
`test_*.py`, `*_test.py`, `*_test.go`, `*_spec.rb`) with a supported code extension
(JS/TS including JSX/TSX and CJS/MJS variants, Python, Ruby, Go, Rust, Java,
Kotlin, Swift, shell `.sh`/`.bash`, PHP or Elixir). Only when a repository has
no such files does it fall back to code files under a test directory.
Fixtures, snapshots and helpers are not tests. An extensionless name such as
`VERSION` counts only inside a string or as a path segment. Imports and
computed paths are not followed; list those tests in the marker. Other naming
conventions, extensions and capitalized test directories also need that marker.
`tests --config-ref REF` pins configuration independently from `--base`, which
selects the diff; it defaults to `--base`. Release-delta checks pass the original
verified base as `--config-ref`, so PR edits cannot choose their own runner.

Run only the selected tests, never the full suite. When upstream gstack's
`gstack-evidence` is installed, run them as
`gstack-evidence run --label docs-ship-tests -- '<command>'`. Before a rerun,
`gstack-evidence check --label docs-ship-tests --expect-cmd '<command>'`
reports `FRESH` for the same tree and command, and `/docs-ship` reuses the
record. After its own release bump, it runs the tests that read the bump's
files under `docs-ship-release-tests`. The first record stays valid with
`--allow-paths` naming exactly those files. Without the helper, it runs the
command directly and records the run as uncached. `/ship-and-land` does not
consume these records. No-test runs have no cache to check; uncached runs rerun their original command after a bump. Any failing selected test yields `CHANGES`. A new invocation still classifies the complete PR: an existing version bump, including one from a previous run, stops under the release-file rule and offers the same three choices.

## Release

`/docs-ship` reads the project's release policy (its spec, versioning
instructions or `CONTRIBUTING`). When the policy bumps for documentation
changes, `/docs-ship` writes the bump after the checks pass. It updates
`VERSION`, the version slots the project keeps in step, and a `CHANGELOG.md`
entry in the file's existing format. The next version comes from the base
tip's `VERSION` at the level the policy names. The bump is one
`chore: bump version and changelog (v<version>)` commit, then pinned-test
reruns as above. When the policy is silent or says docs changes do not bump,
nothing is bumped and the receipt says so.

## Receipt

The receipt is one block in the PR body between
`<!-- docs-ship:receipt:start -->` and `<!-- docs-ship:receipt:end -->`, each on
its own line outside fenced or indented code. Quoted code examples remain body text;
`docs-ship receipt` inserts or replaces it. Write it with this template:

```markdown
## Docs ship

- **Verdict:** PASS | CHANGES | HANDED-BACK
- **Head:** `<full head SHA>`
- **Base:** `<base branch>` at `<full base SHA>`
- **Body SHA-256:** `<docs-ship hash output>`
- **Classification:** docs, <N> files | stop: <path> (<reason>), ... [; proceeded by user choice]
- **Scope:** <brief or allowed list>: <result> | no brief given
- **Claims:** <N> listed; unconfirmed: <claims or none>
- **Rules:** <rules file>: <result>
- **Links:** <N> checked, <M> broken
- **Tests:** `<command>`: <exit, count, FRESH reuse or new run> | none selected
- **Release:** none (<policy reason>) | <old> -> <new> (<level>)
- **CI:** <checks state on the head>
- **Findings:** none | <N>, listed in the result
```

`Body SHA-256` is the SHA-256 of the PR body without the receipt block: line
endings normalized to LF, the whitespace around the block collapsed, and
trailing whitespace trimmed. It survives writing the receipt, so anyone can
recompute it from the final body with `docs-ship hash`. `docs-ship receipt`
refuses a receipt whose recorded hash does not match the body, repeated or empty
required fields, an unknown verdict, or a head/base identity without a full SHA.

Body updates use a fresh read and a post-write check. GitHub's body edit is not
an atomic compare-and-swap: an edit in the final read/write interval can still
race. Keep the saved body snapshots for recovery; the hash proves the resulting
body binding, not exclusive ownership of the edit window.

## Result line

The skill's final message ends with one line a caller can parse (put outcome-specific text before it):

```text
Docs ship: docs-ship/v1; verdict: <PASS|CHANGES|HANDED-BACK>; pr: <number>; head: <40-hex SHA>; base: <40-hex SHA>; body-sha256: <64-hex>
```

- `PASS` includes `Merge when ready:` and the exact merge command
  (`gh pr merge <number> --<method> --match-head-commit <head>`). The skill
  never runs it.
- `CHANGES` includes one `- <file>:<line> — <what is wrong> — fix: <fix>`
  line per finding.
- `HANDED-BACK` includes the `/review-and-prep` handoff.

With no PR, `pr: 0` and the SHA-256 of the empty body (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`) represent absence. Early exits use observed head/base identities and never authorize merging. PASS requires the verified local, remote and PR head and reviewed base still match after CI and receipt publication.

Fields stay in this order. A breaking change to them needs `docs-ship/v2`.
An idle agent or a success summary never stands in for this line.

## Limits

The helper decides two claim kinds mechanically: a SHA that names no commit in
this repository, and a quotation that nearly matches a brief passage without
matching it verbatim. A SHA that exists may still be the wrong commit. Other
numbers, dates, versions, PR numbers and IDs are a checklist that the reviewer
confirms against the cited source. Inbound links to a heading the PR renamed
or a deleted or moved docs file are not checked; inspect inbound references to those paths manually. Near-quote matching is bounded to 128 quote tokens, 25,000 brief tokens and one million comparison cells per quote/brief; exceeding a bound leaves the quote unconfirmed, while exact matches are still checked. Classification by path cannot see a code reader that loads a
docs file at runtime; list such files in `docs-ship:not-docs`. This also applies
to imported instruction files and host-specific instruction names outside the
explicit list above. Nonstandard changelog headings and metadata formats need
project rules or exclusions; the helper is not a complete Markdown/YAML parser.
