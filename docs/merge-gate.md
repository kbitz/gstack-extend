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

Prerequisites: git 2.40 or newer (2.44 in a partial clone), bun, and `gh` for
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
merge-gate check --base <ref> [--head <ref>] [--repo-root <path>] [common] [--json] [--no-record]
merge-gate check --pr <number|url> [--repo-root <path>] [--remote <name>] [common] [--json] [--no-record]
merge-gate replay (--evidence <id|path> [--json] | --all [--jsonl]) [budget flags] [--policy <path|->] [--exclude <glob>]...
merge-gate --version [--json]
merge-gate [<subcommand>] (-h | --help)
```

`--base` / `--head` is offline and scores the complexity budget only. `--head`
defaults to `HEAD`. `--pr` reads one `gh pr view` response and never fetches.
Missing commits exit `commit_not_local` with a single `git fetch <remote> ...`
line naming only the missing refspecs.

`--remote` defaults to `origin`. A fork clone whose base repository is
`upstream` passes `--remote upstream`. `--repo-root` is a checkout path. A
value that looks like `owner/name` is usage: pass the pull request URL instead.

Budget flags accept a non-negative integer or `none` (stored as null, not
enforced). Defaults are experimental and uncalibrated: `--max-net-lines 500`,
`--max-new-files 10`, `--max-new-deps 0`, `--max-new-public-api 10`.
`--max-churn` is unset until passed. `--exclude` may be repeated. `*` matches
inside one path segment and `**` matches across segments (`**/*.ts` matches a
root `a.ts`). Brackets and braces are rejected. `?` and `+` are literal.

`--policy <path|->` reads a JSON object with the `verdict.policy` shape.
Unknown keys are usage. A missing key means not enforced (null). Explicit flags
override the file. `--decision-id` is pull-request mode only, and not with
`--no-record`. The first recorded verdict for that origin, number, and id is
authoritative; a later call with a different policy returns it unchanged
(`idempotent: true`) and does not append.

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
merged head. Every other observation is readiness history.

`timing` is `open` for an observation of an open pull request (an observation
is not itself a decision), `retroactive` when GitHub reports `MERGED` or
`CLOSED`, and `unanchored` in git-only mode. Retroactive evidence is
post-decision state. The budget still decides; pull-request signals do not.
`replay` re-evaluates decide-side rules and budgets only. A collector change
needs a new observation while the git objects still exist. `replay` does not
preserve raw blobs.

Pull-request signal reasons are this gate's policy (any failing check blocks,
required or not), not GitHub's merge rules. `github_merge_state` reports
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

Join replay output to the pre-registered log by `evidence_id`, drop orphans
that never received a check-time line, and apply the selection rule:

```sh
"$GATE" replay --all --jsonl > /tmp/replay.jsonl
jq -s --slurpfile log "$GSTACK_EXTEND_STATE_DIR/merge-gate/verdicts.jsonl" '
  ($log | map(select(.evidence_id != null)) | map({key: .evidence_id, value: .}) | from_entries) as $recorded
  | map(select(.evidence_id != null and $recorded[.evidence_id] != null))
' /tmp/replay.jsonl
```

## Environment

| Variable | Role |
|---|---|
| `GSTACK_EXTEND_STATE_DIR` | production. Store root. Default `~/.gstack-extend`. |
| `GSTACK_EXTEND_MERGE_GATE_DEBUG` | production. Log redacted argv, status, and duration on stderr. |
| `GSTACK_EXTEND_MERGE_GATE_TEST` | tests-only. Required before the overrides below are honored. |
| `GSTACK_EXTEND_MERGE_GATE_NOW` | tests-only. Freezes the clock. |
| `GSTACK_EXTEND_MERGE_GATE_TIMEOUT_MS` | tests-only. Overrides git and gh timeouts. |
| `GSTACK_EXTEND_MERGE_GATE_RETRY_MS` | tests-only. Mergeability retry wait. |

The test-only variables are honored only when `GSTACK_EXTEND_MERGE_GATE_TEST=1`
and either `GSTACK_EXTEND_STATE_DIR` is set or `--no-record` is passed.
Otherwise the gate exits `test_env_refused`. Honored overrides are listed on
the evidence as `test_overrides`.

## Storage

Under `$GSTACK_EXTEND_STATE_DIR/merge-gate/` (directories mode 0700, files
mode 0600):

- `evidence/<sha256>.json` — canonical evidence bytes, written once.
- `verdicts.jsonl` — append-only check-time verdicts. `evidence_path` is not
  stored. Readers skip malformed lines and count them as `skipped_lines`.
- `decisions/<sha256>.json` — one file per origin, pull request number, and
  decision id.

The store must be a local filesystem. Network filesystems are unsupported
because append atomicity is not guaranteed. An evidence file whose verdict
append failed is still valid evidence; `replay --all` includes it. Symlinks
in the store are `store_refused`.

`replay` spawns nothing and appends nothing. `--evidence` is an id when it
matches 64 hex characters, otherwise a path. `--all` reads every
`<64 hex>.json` file, sorted by `observed_at` then id. Machine-readable
`--all` output requires `--jsonl`. `--all --json` is usage. An empty store
exits 0 with no output.

## Versioning

| Field | Bump when |
|---|---|
| evidence `v` / verdict `v` | A field is removed, renamed, or changes meaning. Additive fields keep `v`. This release reads v1 evidence. |
| `gate_version` | Decide-side behavior changes: metrics, exclusions, pull-request mapping, reason classes, default policy. New reason codes bump `gate_version`. |
| `collector_version` | Parser grammars or the public-API rule table change. |

Release notes label each change as schema, gate, or collector. Pin a backtest
to an installed release plus `--policy`. Back up the store before upgrading;
roll back by restoring the store and the previous binary. `policy_sha256` is
the sha256 of the canonical policy object.

Git facts are collected with `GIT_CONFIG_NOSYSTEM`, an empty global config,
`GIT_NO_REPLACE_OBJECTS`, `core.quotePath=false`, `core.fsmonitor=false`, and
`--attr-source` set to the empty tree, so worktree attributes, replace refs,
and the user's diff settings do not change numstat. Rename detection uses
`-l10000`. If git skips inexact renames, the verdict blocks with
`rename_detection_incomplete`. Git's own helper processes are not visible to
a PATH shim in front of `git`.

## Metrics

`decide` owns line, file, dependency, and API totals. `collect` stores raw
per-file numstat and per-manifest added and removed names.

- Net lines: additions minus deletions over files that are not lockfiles,
  binaries, submodules, or `--exclude` matches.
- Churn: additions plus deletions over that same set. Human output lists the
  three largest files.
- New files: status `A`, excluding lockfiles, submodules, and user globs.
  Renames are not new. New binaries count.
- New dependencies: remote names present at head and absent from every section
  of that manifest at the base. Local specs (`workspace:`, `file:`, `link:`,
  `portal:`, Cargo `path` / `workspace = true`, Poetry `path`, requirements
  paths) are recorded and not counted. Manifests under `test`, `tests`,
  `__tests__`, `spec`, `fixtures`, `__fixtures__`, or `testdata` are ignored.
- New public API: multiset of `(rule, name)` additions minus removals, floored
  at zero, across the whole pull request, so a move cancels. The same name in
  two files can also cancel; that collision is a documented limitation.
  Executables added under any `bin/` segment (mode `100755`) count.

Lockfiles excluded from every metric: `bun.lock`, `bun.lockb`,
`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `go.sum`,
`poetry.lock`, `uv.lock`, `Gemfile.lock`, `Pipfile.lock`, `composer.lock`,
`Podfile.lock`, `pubspec.lock`, `mix.lock`, `Package.resolved`,
`npm-shrinkwrap.json`, `packages.lock.json`, `gradle.lockfile`, `flake.lock`.

Parsed manifests: `package.json` (dependencies, devDependencies,
peerDependencies, optionalDependencies), `requirements*.txt`, `pyproject.toml`
(`[project]` dependencies and optional-dependencies, Poetry dependency tables,
excluding the `python` key), `go.mod` requires that are not `// indirect`,
`Cargo.toml` dependency tables including target and workspace tables, and
`Gemfile` `gem` lines. A construct outside that grammar blocks only when it is
on an added line or the manifest is new. An unchanged `-r`/`-c` line or an
unchanged `gemspec` line does not. A deleted manifest never blocks.

Unsupported manifests that changed (not deleted) are `deps_unverifiable`:
`pom.xml`, `build.gradle`, `build.gradle.kts`, `build.sbt`, `composer.json`,
`Pipfile`, `setup.py`, `setup.cfg`, `environment.yml`, `*.gemspec`,
`Package.swift`, `Podfile`, `pubspec.yaml`, `deno.json`, `mix.exs`,
`*.csproj`, `packages.config`. Other ecosystems are not detected. That gap
fails open and is documented here.

Public API rules cover added and removed lines in non-test sources
(TypeScript/JavaScript declarations and lists, CommonJS `exports`, Python
top-level `def`/`class` not starting with `_`, exported Go names including
generic receivers, and Rust `pub` items other than `pub(crate)`, `pub(super)`,
and `pub(in …)`). Test paths (a `test`, `tests`, `__tests__`, or `spec`
segment, `*.test.*`, `*.spec.*`, `*_test.go`, `test_*.py`, `*_test.py`,
`conftest.py`) are excluded. Coverage is `partial` when a changed non-test
file is `.sh`, `.bash`, `.rb`, `.java`, `.kt`, `.swift`, `.c`, `.h`, `.cpp`,
`.hpp`, `.cs`, `.php`, `.scala`, `.ex`, `.exs`, `.lua`, or an extensionless
file under `bin/`, or when a file is skipped as `too_large` (more than 20,000
changed lines or a blob over 1 MiB). Docs, JSON, and data files do not make
coverage partial.

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
| `evidence_incomplete` | evidence | yes | A blob, patch, or status could not be read. The file list itself fails as `git_failed` instead. |
| `rename_detection_incomplete` | evidence | yes | Git skipped inexact rename detection. |
| `pr_draft` | readiness | yes | Open pull request is a draft. |
| `merge_conflict` | readiness | yes | `mergeable` is `CONFLICTING`. |
| `mergeability_unknown` | readiness | yes | `mergeable` is `UNKNOWN` or absent after one retry. |
| `checks_failing` | readiness | yes | A check failed. |
| `checks_pending` | readiness | yes | A check is not complete. |
| `check_state_unknown` | readiness | yes | A check state is not in the mapping table. |
| `changes_requested` | readiness | yes | `reviewDecision` is `CHANGES_REQUESTED`. |
| `review_required` | readiness | yes | `reviewDecision` is `REVIEW_REQUIRED`. |
| `checks_truncated` | readiness | yes | The rollup has exactly 100 contexts. |
| `binary_files_excluded` | info | no | Binaries were omitted from line metrics. |
| `pr_signals_not_checked` | info | no | Git-only mode. |
| `retroactive_pr_state` | info | no | Pull request is `MERGED` or `CLOSED`. |
| `no_checks_configured` | info | no | The check rollup is empty. |
| `github_merge_state` | info | no | Reports `mergeStateStatus` for an open pull request. |
| `api_coverage_partial` | info | no | At least one changed file has no API rule or was too large. |

## Errors

| Code | Exit | Meaning |
|---|---|---|
| `usage` | 2 | Unknown flag, missing mode, bad budget, bad URL, or bad decision id. The message names the flag and the value. |
| `not_a_repo` | 1 | `--repo-root` or the working directory is not a repository. |
| `git_missing` | 1 | `git` is not on `PATH`. |
| `git_unsupported_version` | 1 | Git is older than 2.40, or older than 2.44 in a partial clone. |
| `ref_not_found` | 1 | `--base` or `--head` does not resolve. The fix suggests `<remote>/<ref>` when that commit exists. |
| `no_merge_base` | 1 | The commits do not share an ancestor. A shallow clone's fix is `git fetch --unshallow`. |
| `commit_not_local` | 1 | A pull request SHA is missing locally. One fetch line names only the missing refspecs. |
| `no_remote` | 1 | The selected remote has no URL. |
| `repo_mismatch` | 1 | Owner and name differ, or both hosts are dotted hostnames and differ. |
| `gh_missing` | 1 | `gh` is not on `PATH`. |
| `gh_failed` | 1 | `gh` exited non-zero. The first stderr line is redacted. |
| `gh_bad_json` | 1 | The `gh` response is missing `state`, `url`, `headRefOid`, `baseRefOid`, or `number`. |
| `gh_auth` | 1 | `gh` exited 4. Fix: `gh auth status -h <host>` then `gh auth login -h <host>`. |
| `spawn_timeout` | 1 | Git (60s) or gh (30s) exceeded its timeout. `--timeout` overrides both. |
| `forbidden_command` | 1 | A spawn argv was outside the allowlist. Nothing was spawned. |
| `evidence_not_found` | 1 | Replay could not read the evidence file. |
| `evidence_corrupt` | 1 | The hash, filename, or structure does not match. |
| `evidence_unsupported_version` | 1 | Evidence `v` is not 1. |
| `store_error` | 1 | The store could not be written. Fix names `--no-record` and `GSTACK_EXTEND_STATE_DIR`. No verdict is printed. |
| `store_refused` | 1 | A store path is a symlink or a directory that is not mode 0700. |
| `internal_error` | 1 | An unexpected exception. The stack is on stderr. |
| `test_env_refused` | 1 | A test-only override was set without the test guard. |
| `bun_missing` | 1 | The shim could not find `bun`. |
| `git_failed` | 1 | Ref resolution, merge-base, or the file list failed. A recorded manifest or patch failure is `evidence_incomplete` instead. |

## Example verdict

```json
{"decided_at":"2020-01-01T00:00:00.000Z","evidence_collector_version":1,"evidence_complete":true,"evidence_id":"abc","evidence_path":null,"gate_version":1,"gstack_extend_version":"0.29.0.1","metrics":{"churn":1,"coverage":{"new_public_api":"complete"},"excluded":[],"excluded_count":0,"net_lines":1,"new_deps":0,"new_files":0,"new_public_api":0,"top_churn_files":[{"churn":1,"path":"f.txt"}],"unmeasured_api_count":0,"unmeasured_api_files":[]},"mode":"shadow","observed_at":"2020-01-01T00:00:00.000Z","policy":{"exclude":[],"max_churn":null,"max_net_lines":500,"max_new_deps":0,"max_new_files":10,"max_new_public_api":10},"policy_sha256":"0f0081951676035aa4c926775b42a25447b3cf35d48b7c26fe9feaaa0ad5c033","ready":null,"reasons":[{"blocking":false,"class":"info","code":"pr_signals_not_checked","detail":"git-only mode does not read pull request signals"}],"replay":false,"subject":{"base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","decision_id":null,"head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","merge_base_sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","origin":null,"pr_number":null,"pr_url":null},"timing":"unanchored","v":1,"within_budget":true,"would_merge":true}
```

## Example error

```json
{"v":1,"error":{"code":"usage","message":"missing --base or --pr","fix":"pass --base <ref> or --pr <number|url>","doc":"docs/merge-gate.md#errors"}}
```

## Schema

A `verdicts.jsonl` line is the `--json` verdict without `evidence_path` and
without `idempotent`. Evidence `v` 1 carries `observed_at`,
`collection_started_at`, `clock_overridden`, `test_overrides`,
`collector_version`, `gstack_extend_version`, `git_version`, `partial_clone`,
`attr_source`, `rename_limit`, `rename_detection_skipped`, `decision_id`,
`repo.origin` (credentials, query, and fragment removed; no absolute local
path), `git` file facts, `dependencies`, `public_api`, `collection`, and `pr`
(`raw`, `raw_first`, `retry_wait_ms`) in pull-request mode. Paths that are not
UTF-8 use U+FFFD plus `path_b64`.
