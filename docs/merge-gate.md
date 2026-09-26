# Merge gate

`merge-gate` answers "would merge: yes or no, and why" for a git range or a
pull request. It is shadow-only: there is no merge command, no `--enforce`
flag, and the process cannot push, merge, or update refs. A "no" verdict exits
0. Exit 1 is an operational failure. Exit 2 is usage.

The store is per machine. Point it at a directory the caller owns with
`GSTACK_EXTEND_STATE_DIR`. Check-time lines in `verdicts.jsonl` are the
pre-registered record. Budgets tried with `replay` have to be validated on a
later time window, and backtest write-ups should cite `policy_sha256`.

## Quick start

Prerequisites: git 2.41 or newer (2.45 in a partial clone), bun, and `gh` for
pull-request mode. The binary is not on `PATH` until a later track wires it.
From a fresh state directory the git-only command below should print a verdict
in under two minutes.

```sh
GATE="$HOME/.claude/skills/gstack-extend/bin/merge-gate"
export GSTACK_EXTEND_STATE_DIR="${TMPDIR:-/tmp}/merge-gate-try"

"$GATE" check --base HEAD~1 --no-record
# WOULD_MERGE: yes or no, TIMING: unanchored, EVIDENCE: not recorded (--no-record)

git fetch origin pull/108/head main
"$GATE" check --pr 108 --json
# timing retroactive on an already merged pull request; budget still decides

"$GATE" replay --all --jsonl
```

## Usage

```text
merge-gate check --base <ref> [--head <ref>] [--repo-root <path>] [budget flags] [--json] [--no-record]
merge-gate check --pr <number|url> [--repo-root <path>] [--remote <name>] [--decision-id <id>] [--timeout <s>] [budget flags] [--json] [--no-record]
merge-gate replay (--evidence <id|path> [--json] | --all [--jsonl]) [budget flags]
merge-gate --version [--json]
merge-gate [<subcommand>] (-h | --help)

Budget flags (a number, or none to turn a limit off):
  --max-net-lines N      default 500
  --max-new-files N      default 10
  --max-new-deps N       default 0
  --max-new-public-api N default 10
  --max-churn N          default none
  --exclude <glob>       repeatable; * within a segment, ** across segments
  --policy <path|->      a verdict.policy JSON object; flags override it
```

`--base` / `--head` is offline and scores the complexity budget only. `--head`
defaults to `HEAD`. `--pr` reads one `gh pr view` response and never fetches.
Missing commits exit `commit_not_local` with a single `git fetch <remote> ...`
line naming only the missing refspecs, shell-quoted.

`--remote` defaults to `origin`. A fork clone whose base repository is
`upstream` passes `--remote upstream`. `--repo-root` is a checkout path. A
value that looks like `owner/name` is usage: pass the pull request URL instead.
Flags from the other subcommand are usage, as is a flag value that starts
with `-` (except `--policy -` and negative budget values, which get their own
message).

Defaults are experimental and uncalibrated. `*` matches inside one path
segment and `**` matches across segments (`**/*.ts` matches a root `a.ts`; a
trailing `vendor/**` or a bare `**` matches every file below it). Brackets and
braces are rejected. `?` and `+` are literal.

`--policy <path|->` reads a JSON object with the `verdict.policy` shape, from
a file or from stdin. Unknown keys and unreadable files are usage. A missing
key means not enforced (null). Explicit flags override the file.

`--decision-id` is pull-request mode only, and not with `--no-record`. The
first recorded verdict for a repository, pull request number, and id is
authoritative; a later call with a different policy returns it unchanged
(`idempotent: true`), collects nothing, and does not append.

## What the budget rewards

The defaults are a starting point, not a calibrated bar.

- A replacement-heavy refactor can stay under the net-line cap while churn is
  large. Set `--max-churn` when that distinction matters.
- Swapping a dependency for a hand-written replacement adds zero dependencies
  and can still add a large public API and many new lines.
- Splitting one change across several pull requests keeps each observation
  under the cap. The consumer's backtest has to look across the series.

## Consumer contract

Fetch the pull request head and base, then call `check --pr <n> --json` once
at the caller's merge-decision point and pass the caller's `--decision-id`.

Backtest selection, per pull request: use the verdict that carries the
caller's decision id. Without one, use the latest `open` observation whose
`observed_at` is before `mergedAt` and whose `subject.head_sha` equals the
merged head. Every other observation is readiness history. Verdicts do not
carry `mergedAt`: take it from `gh` (as in the recipe below) or from the
frozen `pr.raw` of a retroactive observation's evidence file.

`timing` is `open` for an observation of an open pull request (an observation
is not itself a decision), `retroactive` when GitHub reports `MERGED` or
`CLOSED`, and `unanchored` in git-only mode. Retroactive evidence is
post-decision state. The budget still decides; pull-request signals do not.
`replay` re-evaluates decide-side rules and budgets only. A collector change
needs a new observation while the git objects still exist. `replay` does not
preserve raw blobs.

Pull-request signal reasons are this gate's policy (any failing check blocks,
required or not), not GitHub's merge rules. A value the mapping does not name
fails closed: an unrecognized `reviewDecision` is `review_required` and an
absent rollup is `check_state_unknown`. `github_merge_state` reports
`mergeStateStatus` and does not block. GitHub often answers `mergeable:
UNKNOWN` on the first request. The gate waits once (3 seconds, or
`GSTACK_EXTEND_MERGE_GATE_RETRY_MS` in tests) and stores both responses.
Separate those verdicts in a backtest. A rollup of exactly 100 contexts is
`checks_truncated` because `gh` may return only the first page. Re-run checks
report their latest run only.

`author` in the frozen `gh` response includes the author's display name. It is
stored locally at mode 0600. Fork checkouts with no remote pointing at the
base repository are unsupported; pass `--remote`.

### Backfill

```sh
GATE="$HOME/.claude/skills/gstack-extend/bin/merge-gate"
gh pr list --state merged --limit 50 --json number,baseRefName --jq '.[] | "\(.number) \(.baseRefName)"' |
while read -r n base; do
  git fetch origin "pull/${n}/head" "$base" || continue
  "$GATE" check --pr "$n" --json || true
done
```

Read the log tolerantly (a torn or malformed line is skipped, not fatal), then
apply the selection rule with `mergedAt` and the merged head from `gh`. ISO
timestamps compare lexically:

```sh
LOG="$GSTACK_EXTEND_STATE_DIR/merge-gate/verdicts.jsonl"
jq -cR 'fromjson? // empty' "$LOG" > /tmp/log.jsonl
gh pr list --state merged --limit 200 --json number,mergedAt,headRefOid > /tmp/merged.json
jq -s --slurpfile merged /tmp/merged.json '
  ($merged[0] | map({key: (.number | tostring), value: .}) | from_entries) as $m
  | map(select(.subject.pr_number != null and $m[.subject.pr_number | tostring] != null))
  | group_by(.subject.pr_number)
  | map(
      $m[.[0].subject.pr_number | tostring] as $pr
      | (map(select(.subject.decision_id != null)) | first)
        // (map(select(.timing == "open" and .observed_at < $pr.mergedAt and .subject.head_sha == $pr.headRefOid))
            | sort_by(.observed_at) | last)
    )
  | map(select(. != null))
' /tmp/log.jsonl
```

To score a candidate policy, join replay output to the pre-registered log by
`evidence_id` and drop orphans that never received a check-time line:

```sh
"$GATE" replay --all --jsonl --max-net-lines 300 > /tmp/replay.jsonl
jq -s --slurpfile log /tmp/log.jsonl '
  ($log | map({key: .evidence_id, value: true}) | from_entries) as $recorded
  | map(select(.error == null and $recorded[.evidence_id] != null))
' /tmp/replay.jsonl
```

## Environment

| Variable | Role |
|---|---|
| `GSTACK_EXTEND_STATE_DIR` | production. Store root. Default `~/.gstack-extend`. |
| `GSTACK_EXTEND_MERGE_GATE_DEBUG` | production. Log redacted argv, status, and duration on stderr. Stdout is unchanged. |
| `GSTACK_EXTEND_MERGE_GATE_TEST` | tests-only. Required before the overrides below are honored. |
| `GSTACK_EXTEND_MERGE_GATE_NOW` | tests-only. Freezes the clock. |
| `GSTACK_EXTEND_MERGE_GATE_TIMEOUT_MS` | tests-only. Overrides git and gh timeouts. |
| `GSTACK_EXTEND_MERGE_GATE_RETRY_MS` | tests-only. Mergeability retry wait. |

The test-only variables are honored only when `GSTACK_EXTEND_MERGE_GATE_TEST=1`
and either `GSTACK_EXTEND_STATE_DIR` is set or `--no-record` is passed.
Otherwise the gate exits `test_env_refused`. Honored overrides are listed on
the evidence as `test_overrides`. The shim runs bun with `--no-env-file` and
`--config=/dev/null`, so a checkout's `.env` or `bunfig.toml` never loads.

## Storage

Under `$GSTACK_EXTEND_STATE_DIR/merge-gate/` (directories mode 0700, files
mode 0600, all owned by the current user):

- `evidence/<sha256>.json` — canonical evidence bytes, written once through a
  temp file and `link()`. Different bytes under an existing id are
  `evidence_corrupt`. A leftover temp file is harmless.
- `verdicts.jsonl` — append-only check-time verdicts. Each line is one
  `write()` followed by fsync; a torn trailing line from an earlier crash is
  terminated first. `evidence_path` and `idempotent` are not stored. Readers
  skip malformed lines and count them as `skipped_lines`.
- `decisions/<key>.json` — the authoritative verdict for one decision id.
  `<key>` is the sha256 of `merge-gate-decision/1`, the lowercased
  `owner/name`, the pull request number, and the decision id, joined by NUL
  bytes. Using `owner/name` rather than the remote URL means the https, ssh,
  and pull-request-URL spellings of one repository share a key.
- `decisions/<key>.logged` — created with exclusive create by whichever caller
  appends that decision's line. If the append fails, the marker is removed, so
  a retry appends the line instead of returning an unlogged decision. The
  file is claimed before the append, so a crash between the two can still
  lose that one line.

The store must be a local filesystem. Network filesystems are unsupported
because append atomicity is not guaranteed. An evidence file whose verdict
append failed is still valid evidence; `replay --all` includes it. A symlink,
a path owned by another user, or a directory that is not mode 0700 is
`store_refused`, checked before any read or write. A `store_error` during
`check` prints no verdict: an unrecorded verdict is not a shadow record, so
the caller retries.

`replay` spawns nothing and appends nothing. `--evidence` is an id when it
matches 64 hex characters, otherwise a path. `--all` reads every
`<64 hex>.json` file, sorted by `observed_at` then id, deciding one file at a
time. A file that fails prints `{"v":1,"evidence_id":"<filename stem>","error":{...}}`
under `--jsonl` or `error <filename stem> <code>` in human output; replay
continues and exits 1. Machine-readable `--all` output requires `--jsonl`.
`--all --json` is usage. An empty store exits 0 with no output.

## Versioning

| Field | Bump when |
|---|---|
| evidence `v` / verdict `v` | A field is removed, renamed, or changes meaning. Additive fields keep `v`. This release reads v1 evidence. |
| `gate_version` | Decide-side behavior changes: metrics, exclusions, test-path table, output caps, pull-request mapping, reason classes, default policy. New reason codes bump `gate_version`. |
| `collector_version` | Parser grammars, the public-API rule table, scan limits, or pinned git config change. Replay rejects evidence from a newer collector. |

Each table set is hashed and pinned beside its version, and a golden corpus
of evidence and verdicts is pinned per `gate_version`, so a behavior change
without a bump fails the tests. Release notes label each change as schema,
gate, or collector. Pin a backtest to an installed release plus `--policy`.
Back up the store before upgrading; roll back by restoring the store and the
previous binary. `policy_sha256` is the sha256 of the canonical policy object.

## Git facts

`git version` runs first, before any call that passes `--attr-source`. The
floor is 2.41, the release that added the global `--attr-source` option, and
2.45 in a partial clone, the first release where `GIT_NO_LAZY_FETCH` stops
lazy blob fetches. Every other git call runs with `--attr-source` set to the empty tree,
`GIT_CONFIG_NOSYSTEM`, an empty global config, `GIT_ATTR_NOSYSTEM`,
`GIT_NO_REPLACE_OBJECTS`, `GIT_NO_LAZY_FETCH`, and command-line config that
outranks the repository's own: `core.quotePath=false`, `core.fsmonitor=false`,
`core.attributesFile=/dev/null`, `core.bigFileThreshold=512m`, and
`diff.ignoreSubmodules=none`. Worktree and user attributes, replace refs, and
diff settings therefore do not change numstat.

The one setting carried over from the user's own config is `safe.directory`.
The gate reads it from the global and system config (honoring
`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`, and `GIT_CONFIG_NOSYSTEM`) and passes
each value as command-line config, which git trusts for that key. A checkout
owned by another user, such as a CI workspace, therefore works exactly when
plain `git` would. A `safe.directory` in the repository's own config is
ignored, as git itself ignores it.

Git has no switch that ignores `$GIT_DIR/info/attributes`. When that file has
any line other than a comment, collection records the failure
`{stage: "attributes", code: "info_attributes"}` and the verdict blocks with
`evidence_incomplete`.

A partial clone is detected from `extensions.partialClone` or any
`remote.<name>.promisor` / `remote.<name>.partialclonefilter` setting. A git
process that exits on a signal or fails to spawn counts as failed. Rename
detection uses `-l10000`; if git skips inexact renames, the verdict blocks
with `rename_detection_incomplete`. Git's own helper processes are not visible
to a PATH shim in front of `git`.

## Metrics

`decide` owns line, file, dependency, and API totals. `collect` stores raw
per-file numstat, per-manifest added and removed names, and per-file added and
removed API names.

- Net lines: additions minus deletions over files that are not lockfiles,
  binaries, submodules, or `--exclude` matches.
- Churn: additions plus deletions over that same set. Human output lists the
  three largest files.
- New files: status `A`, excluding lockfiles, submodules, and user globs.
  Renames are not new. New binaries count. The reason's subjects are exactly
  the counted files.
- New dependencies: remote names present at head and absent from every section
  of that manifest at the base. A manifest renamed from the same kind compares
  against its old path; one renamed from anything else is new. Local specs
  (`workspace:`, `file:`, `link:`, `portal:`, Cargo `path` / `workspace =
  true`, Poetry `path`, requirements paths and `file:` URLs) are recorded and
  not counted. Go `// indirect` requires are recorded as `indirect` and not
  counted. Manifests under `test`, `tests`, `__tests__`, `spec`, `fixtures`,
  `__fixtures__`, or `testdata` are ignored.
- New public API: multiset of `(rule, name)` additions minus removals, floored
  at zero, across the whole pull request. Rename sources and deleted files are
  scanned too, so a rename or a move cancels. The same name in two files can
  also cancel; that collision is a documented limitation. Executables added
  under any `bin/` segment (mode `100755`), and `100644` to `100755` flips,
  count.

Lockfiles excluded from every metric: `bun.lock`, `bun.lockb`,
`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `go.sum`,
`poetry.lock`, `uv.lock`, `Gemfile.lock`, `Pipfile.lock`, `composer.lock`,
`Podfile.lock`, `pubspec.lock`, `mix.lock`, `Package.resolved`,
`npm-shrinkwrap.json`, `packages.lock.json`, `gradle.lockfile`, `flake.lock`.

### Dependency grammar

Each parser implements a strict grammar. A construct outside it blocks
(`deps_unverifiable`) only when it is on an added line or the manifest is new;
an unchanged one does not. A deleted manifest never blocks.

- `package.json`: dependencies, devDependencies, peerDependencies,
  optionalDependencies. Moving a name between sections is not new. Invalid
  JSON or a non-string spec is unverifiable.
- `requirements*.txt`: lines ending in `\` are joined. Comments, environment
  markers (after `;`), extras, and version specifiers are stripped, and names
  use PEP 503 normalization (lowercase, runs of `-_.` become `-`). Trailing
  `--hash` options are stripped. Global options (`-i`, `--index-url`,
  `--extra-index-url`, `-f`, `--find-links`, `--trusted-host`, `--no-index`,
  `--pre`, `--prefer-binary`, `--require-hashes`, `--only-binary`,
  `--no-binary`, `--use-feature`) are ignored. `-e` and URL lines count by
  their full text. `-r` / `-c` includes and any other option are outside the
  grammar.
- `pyproject.toml`: `[project]` `dependencies` and `optional-dependencies`
  only (metadata keys are not dependencies), `[tool.poetry.dependencies]`,
  `[tool.poetry.dev-dependencies]`, and `[tool.poetry.group.<g>.dependencies]`,
  excluding `python`. Arrays may span lines.
- `Cargo.toml`: `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`
  (and the underscore spellings), their `[target.'…'.…]` forms,
  `[workspace.dependencies]`, and `[<table>.<name>]` sub-tables.
- TOML is read statement by statement: tables, arrays of tables, multi-line
  arrays and inline tables, and all four string forms. Keys resolve to their
  full dotted path, so dotted and quoted keys are supported. An array of
  tables under a dependency table is outside the grammar.
- `go.mod`: `require` lines and blocks, with `//` comments stripped. `module`,
  `go`, `toolchain`, `godebug`, and `tool` are ignored. `replace`, `exclude`,
  `retract`, and unknown directives are outside the grammar.
- `Gemfile`: `gem` lines with string, symbol, boolean, and flat-array options
  (`path:` is local), `source`, `group`, `platforms`, `ruby`, `end`, and
  comments. `gemspec` and dynamic Ruby (interpolation, method calls, `ENV`)
  are outside the grammar.

Unsupported manifests that changed (not deleted) are `deps_unverifiable`:
`pom.xml`, `build.gradle`, `build.gradle.kts`, `build.sbt`, `composer.json`,
`Pipfile`, `setup.py`, `setup.cfg`, `environment.yml`, `*.gemspec`,
`Package.swift`, `Podfile`, `pubspec.yaml`, `deno.json`, `mix.exs`,
`*.csproj`, `packages.config`. Other ecosystems are not detected. That gap
fails open and is documented here.

### Public API rules

Rules cover added and removed lines of a `-U0` patch in non-test sources:
TypeScript/JavaScript declarations (`const enum` included), `export default`,
export lists (`a as b`, inline `type`), `export *`, CommonJS `exports`,
Python top-level `def`/`class` not starting with `_`, exported Go names
(functions, methods on generic receivers, types, `var`/`const` lists), and
Rust `pub` items other than `pub(crate)`, `pub(super)`, and `pub(in …)`.

A multi-line `export { … }` list and a Go `const (` / `var (` / `type (` block
are read member by member. A `-U0` hunk omits the block's first line, so the
scan starts inside a block when git's hunk header context (the text after
`@@ … @@`, the nearest earlier line starting with a letter, `_`, or `$`) is
the block's opening line. The known residue: members written at column zero
are themselves context lines, so names added after them in an existing block
are not seen. Go block members must be indented with one tab, as `gofmt`
writes them.

Test paths (a `test`, `tests`, `__tests__`, or `spec` segment, `*.test.*`,
`*.spec.*`, `*_test.go`, `test_*.py`, `*_test.py`, `conftest.py`) are
excluded. Coverage is `partial` when a changed non-test file is listed in
`metrics.unmeasured_api_files` with one of these reasons:

| Reason | Meaning |
|---|---|
| `no_rule` | `.sh`, `.bash`, `.rb`, `.java`, `.kt`, `.swift`, `.c`, `.h`, `.cpp`, `.hpp`, `.cs`, `.php`, `.scala`, `.ex`, `.exs`, `.lua`, or an extensionless file under `bin/`. |
| `too_large` | More than 20,000 changed lines, or an old or new blob over 1 MiB. |
| `non_utf8_path` | The path is not UTF-8 and cannot be passed back to git as a pathspec. |
| `patch_missing` | The file changed but its patch was absent from git's output. |
| `patch_failed` | The patch call failed; the collection failure also blocks. |

Docs, JSON, and data files do not make coverage partial.

## Verdict fields

| Field | Meaning |
|---|---|
| `v`, `mode`, `gate_version` | Schema version, always `shadow`, and the decide-side rule version. |
| `gstack_extend_version` | Release of the binary that decided. |
| `evidence_collector_version` | `collector_version` of the evidence that was decided. |
| `policy`, `policy_sha256` | The normalized policy used and its canonical hash. |
| `evidence_id`, `evidence_path` | Evidence sha256, and (stdout only) its stored path or null with `--no-record`. |
| `subject` | `origin`, `pr_number`, `pr_url`, `base_sha`, `head_sha`, `merge_base_sha`, `decision_id`; pull-request fields are null in git-only mode. |
| `decided_at`, `observed_at` | When `decide` ran (replay time on replay) and when the evidence was observed. |
| `replay`, `idempotent` | True on replay; `idempotent` (stdout only) marks a recorded decision returned again. |
| `timing` | `open`, `retroactive`, or `unanchored`. |
| `metrics` | `net_lines`, `churn`, `new_files`, `new_deps`, `new_public_api`, `top_churn_files` (3), `excluded` (100) and `excluded_count`, `coverage.new_public_api`, `unmeasured_api_files` (50) and `unmeasured_api_count`. |
| `would_merge` | False when any reason blocks. |
| `within_budget`, `ready`, `evidence_complete` | False when a blocking `budget`, `readiness`, or `evidence` reason is present; `ready` is null unless timing is `open`. |
| `reasons` | Reason objects, below. |

A reason has `code`, `class` (`budget`, `readiness`, `evidence`, or `info`),
`blocking`, and `detail` (the observed condition, or the documented
limitation). Budget reasons add `measured` and `limit`. Blocking reasons add
`subjects` (paths, check names, or `manifest:name`, capped at 20) and
`subjects_count`.

## Reasons

| Code | Class | Blocking | Meaning |
|---|---|---|---|
| `net_lines_over_budget` | budget | yes | Net lines exceed the policy limit. |
| `new_files_over_budget` | budget | yes | New files exceed the policy limit. |
| `new_deps_over_budget` | budget | yes | New remote dependencies exceed the policy limit. |
| `new_public_api_over_budget` | budget | yes | New public API symbols exceed the policy limit. |
| `churn_over_budget` | budget | yes | Churn exceeds `--max-churn`. |
| `deps_unverifiable` | evidence | yes | A supported manifest could not be parsed, or an unsupported manifest changed. |
| `empty_diff` | evidence | yes | Merge-base equals head, or the file list is empty. |
| `evidence_incomplete` | evidence | yes | A blob, patch, status, buffer, or `.git/info/attributes` made collection incomplete. The file list itself fails as `git_failed` instead. |
| `rename_detection_incomplete` | evidence | yes | Git skipped inexact rename detection. |
| `pr_draft` | readiness | yes | Open pull request is a draft. |
| `merge_conflict` | readiness | yes | `mergeable` is `CONFLICTING`. |
| `mergeability_unknown` | readiness | yes | `mergeable` is `UNKNOWN` or absent after one retry. |
| `checks_failing` | readiness | yes | A check failed. |
| `checks_pending` | readiness | yes | A check is not complete. |
| `check_state_unknown` | readiness | yes | A check state is not in the mapping table, or the rollup is absent. |
| `changes_requested` | readiness | yes | `reviewDecision` is `CHANGES_REQUESTED`. |
| `review_required` | readiness | yes | `reviewDecision` is `REVIEW_REQUIRED`, or a value the mapping does not recognize. |
| `checks_truncated` | readiness | yes | The rollup has exactly 100 contexts. |
| `binary_files_excluded` | info | no | Binaries were omitted from line metrics. |
| `pr_signals_not_checked` | info | no | Git-only mode. |
| `retroactive_pr_state` | info | no | Pull request is `MERGED` or `CLOSED`. |
| `no_checks_configured` | info | no | The check rollup is empty. |
| `github_merge_state` | info | no | Reports `mergeStateStatus` for an open pull request. |
| `api_coverage_partial` | info | no | At least one changed file was not scanned for public API; see `unmeasured_api_files`. |

## Errors

| Code | Exit | Meaning |
|---|---|---|
| `usage` | 2 | Unknown or cross-mode flag, missing value, missing mode, bad budget, bad URL, bad remote name, unreadable policy, or bad decision id. The message names the flag and the value. |
| `not_a_repo` | 1 | `--repo-root` or the working directory is not a repository. |
| `git_missing` | 1 | `git` is not on `PATH`. |
| `git_unsupported_version` | 1 | Git is older than 2.41, or older than 2.45 in a partial clone. |
| `ref_not_found` | 1 | `--base` or `--head` does not resolve. The fix suggests `<remote>/<ref>` when that commit exists. |
| `no_merge_base` | 1 | The commits do not share an ancestor. A shallow clone's fix is `git fetch --unshallow`. |
| `commit_not_local` | 1 | A pull request SHA is missing locally. One fetch line names only the missing refspecs. |
| `no_remote` | 1 | The selected remote has no URL, or its URL is not host/owner/repo. |
| `repo_mismatch` | 1 | Owner and name differ, or both hosts are dotted hostnames and differ. |
| `gh_missing` | 1 | `gh` is not on `PATH`. |
| `gh_failed` | 1 | `gh` exited non-zero. The first stderr line is redacted. |
| `gh_bad_json` | 1 | The `gh` response is not an object or is missing or mistypes `state`, `url`, `headRefOid`, `baseRefOid`, or `number`. |
| `gh_auth` | 1 | `gh` exited 4. Fix: `gh auth status -h <host>` then `gh auth login -h <host>`. |
| `spawn_timeout` | 1 | Git (60s) or gh (30s) exceeded its timeout. `--timeout` overrides both. |
| `forbidden_command` | 1 | A spawn argv was outside the allowlist. Nothing was spawned. |
| `evidence_not_found` | 1 | Replay could not read the evidence file. |
| `evidence_corrupt` | 1 | The hash, filename, or structure does not match, or a field has the wrong type. |
| `evidence_unsupported_version` | 1 | Evidence `v` is not 1, or its `collector_version` is newer than this gate's. |
| `store_error` | 1 | The store could not be read or written. Fix names `--no-record` and `GSTACK_EXTEND_STATE_DIR`. No verdict is printed. |
| `store_refused` | 1 | A store path is a symlink, is owned by another user, or is a directory that is not mode 0700. |
| `internal_error` | 1 | An unexpected exception. The stack is on stderr. |
| `test_env_refused` | 1 | A test-only override was set without the test guard. |
| `bun_missing` | 1 | The shim could not find `bun`. |
| `git_failed` | 1 | Ref resolution, merge-base, or the file list failed. A recorded manifest or patch failure is `evidence_incomplete` instead. |

Every error, from the CLI or the shim, has the same canonical key order.

## Example verdict

```json
{"decided_at":"2020-01-01T00:00:00.000Z","evidence_collector_version":1,"evidence_complete":true,"evidence_id":"b199a020ef829355f1b1ad596c483f885b3010d7d2629afc02314921a932cab1","evidence_path":null,"gate_version":1,"gstack_extend_version":"0.29.1.0","metrics":{"churn":1,"coverage":{"new_public_api":"complete"},"excluded":[],"excluded_count":0,"net_lines":1,"new_deps":0,"new_files":0,"new_public_api":0,"top_churn_files":[{"churn":1,"path":"f.txt"}],"unmeasured_api_count":0,"unmeasured_api_files":[]},"mode":"shadow","observed_at":"2020-01-01T00:00:00.000Z","policy":{"exclude":[],"max_churn":null,"max_net_lines":500,"max_new_deps":0,"max_new_files":10,"max_new_public_api":10},"policy_sha256":"0f0081951676035aa4c926775b42a25447b3cf35d48b7c26fe9feaaa0ad5c033","ready":null,"reasons":[{"blocking":false,"class":"info","code":"pr_signals_not_checked","detail":"git-only mode does not read pull request signals"}],"replay":false,"subject":{"base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","decision_id":null,"head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","merge_base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","origin":"https://github.com/acme/widgets.git","pr_number":null,"pr_url":null},"timing":"unanchored","v":1,"within_budget":true,"would_merge":true}
```

## Example error

```json
{"error":{"code":"usage","doc":"docs/merge-gate.md#errors","fix":"pass --base <ref> or --pr <number|url>","message":"missing --base or --pr"},"v":1}
```

## Schema

A `verdicts.jsonl` line is the `--json` verdict without `evidence_path` and
without `idempotent`. Evidence `v` 1 carries `observed_at`,
`collection_started_at`, `clock_overridden`, `test_overrides`,
`collector_version`, `gstack_extend_version`, `git_version`, `partial_clone`,
`attr_source`, `rename_limit`, `rename_detection_skipped`, `decision_id`,
`repo.origin` (credentials, query, and fragment removed; a local-path or
`file://` remote is stored as `local:<last segment>`), `git` file facts
(including `api_skipped`), `dependencies`, `public_api`, `collection`, and
`pr` (`number`, `url`, `repo`, `raw`, `raw_first`, `retry_wait_ms`) in
pull-request mode. Paths that are not UTF-8 use U+FFFD plus `path_b64`.
