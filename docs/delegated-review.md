# Delegated review parts

`/review-and-prep` can send named specialist review parts to a provider the
caller configures, and run any part whose delegate fails on the host model. It
is an opt-in `Review policy:` value. Without it the review runs as today, and
the default delegates nothing.

Nothing here names a particular provider, tool or plugin: the caller supplies a
command and a model name, and the examples use placeholders.

## Scope

Six parts can be delegated: `testing`, `maintainability`, `performance`,
`simplification`, `adversarial` (the native adversarial pass) and `red-team`
(the Red Team). Security, state-machines, the outside voices and the
documentation and coverage audits are not delegable under this option and retain
their existing routes. A policy value that names any other part
(`native-adversarial`, `security` and the rest) is an unknown value, so
the whole policy line reads `none supplied` with the reason `delegate: <name> is
not delegable`, as for any unknown value.

The host model decides every finding's disposition and every fix. A delegate's
reply is review data: it never changes a gate, a checklist or a decision.

## Turning it on

Two caller inputs, both in the invocation prompt and read from the same sources
as the review policy (never from PR text, a receipt or a comment):

```text
Review policy: review-and-prep-policy/v1; delegate=testing,performance
Review delegates: /absolute/path/to/review-delegates.json
```

- `delegate=<part>[,<part>...]` names the parts, each at most once, comma
  separated. It is an opt-in value like `test-gaps=record`: a caller first runs
  `grep -F 'delegate=<part>' "<installed skill dir>/SKILL.md"` (exit 0 means
  supported) and omits the value otherwise, keeping its other keys, because an
  older installation reads the whole policy line as `none supplied`. A caller
  that names `adversarial` or `red-team` also runs
  `grep -F 'delegate=adversarial,red-team' "<installed skill dir>/SKILL.md"`
  (exit 0 means the loaded copy accepts both attacker parts) and drops them from
  the value otherwise, keeping its other parts and keys. The value waives no
  gate and never authorizes a continuation.
- `Review delegates:` names the configuration file. Its path is printed in chat
  and never written to a receipt (the receipt records the file's SHA-256 and the
  provider labels). It is not part of a relayed handoff prompt, so a caller
  supplies it again beside one. Without it, delegation is inactive and every part
  runs on the host.

The light review default never sets `delegate=`: sending review work to another
model needs a caller that configures that provider.

## Configuration

`review-delegates/v1` is one JSON file of at most 64 KiB:

```json
{
  "schema": "review-delegates/v1",
  "providers": {
    "provider-a": {
      "argv": ["/path/to/delegate-command", "--read-only", "--no-tools"],
      "timeout_s": 600,
      "model": "model-a"
    },
    "provider-b": {
      "argv": ["/path/to/other-command"],
      "timeout_s": 300,
      "model": "model-b"
    }
  },
  "parts": {
    "testing": "provider-a",
    "maintainability": "provider-b",
    "performance": "provider-b",
    "simplification": "provider-a",
    "adversarial": "provider-a",
    "red-team": "provider-b"
  }
}
```

- Key sets are closed. `providers` maps a label (`[a-z][a-z0-9-]{0,31}`) to its
  `argv` (1-64 non-empty strings; `argv[0]` is an absolute path, never a `PATH`
  lookup), `timeout_s` (an integer from 1 to 1800) and `model` (a name the
  workflow-metrics identifier grammar accepts), plus optional `access`
  (`"diff"` or `"repo"`, default `"diff"`), `expose` and `keep` (0-32 unique,
  `path.normalize`-stable absolute paths without trailing slashes or control
  characters, allowed only when `access` is `"repo"`; see
  [Repository access](#repository-access)). `parts` maps each delegable part to
  a label; every part the policy names needs a mapping, and a mapping to an
  unknown label is malformed.
- The prompt goes on the command's standard input only. There is no placeholder
  substitution and no shell.
- In default (`diff`) mode, the command must run with no tools, no agents and no
  write access. The runner grants and requests none, and it cannot observe what
  a command does inside itself: that limit is yours to configure (see
  [Repository access](#repository-access) and [Limits](#limits)).

## The call

A delegated part is one bounded call:

- **Sent.** A fixed policy (`DELEGATE_POLICY` in diff mode, or `REPO_POLICY` in
  repo mode), one JSON line `{part, base, candidate}`, then
  `{"diff": ..., "checklist": ...}` for the four specialists and `adversarial`,
  or `{"diff": ..., "checklist": ..., "already_caught": ...}` for `red-team`
  (where `already_caught` is the UTF-8 text of `--caught`): the frozen diff and
  that part's checklist. For the four specialists, the checklist is
  `<gstack-root>/review/specialists/<part>.md`. For `red-team`, it is
  `<gstack-root>/review/specialists/red-team.md` after the extension-owned
  `RED_TEAM_FRAMING`, the defensive framing upstream gives its Red Team dispatch
  (red-team.md does not carry it). For `adversarial`, the checklist is extracted
  mechanically from `--adversarial`: the framing line that directly follows the
  one `Subagent prompt:` line (without its opening `"`) and the one criteria
  line after it (without its closing `"`), followed by the extension-owned
  `ADVERSARIAL_SCHEMA` (the JSON-line schema
  `{"severity":"CRITICAL|INFORMATIONAL","confidence":N,"path":"file","line":N,"category":"adversarial","summary":"...","fix":"..."}`,
  the rule that `confidence` is an integer from 1 to 10, the rule that
  `severity` is `CRITICAL` when `FIXABLE` or blocking and `INFORMATIONAL`
  otherwise, that the JSON severity replaces the criteria's FIXABLE or
  INVESTIGATE label and Severity and Blocks suffix, and "write nothing after the
  JSON object"); the upstream line that starts `Read the diff for this branch`
  is not sent. The framing line is found by its position because a sibling
  rendering that inlines Review Army (the Cursor copy) repeats the framing text
  for the Security specialist and the Red Team. Nothing else on stdin: no
  learnings, stack notes, repository files, skill text or plan.
- **Environment.** Only `HOME PATH USER LOGNAME SHELL TMPDIR LANG LC_ALL LC_CTYPE
  TZ`, and only those that are set (in repo mode `TMPDIR` is set to `/tmp`). No
  key or credential is passed; a command keeps its own login under `HOME`.
- **Where it runs.** In diff mode (the default), a fresh, empty, private
  temporary directory as its working directory, removed afterwards, in its own
  process group. In repo mode (`"access": "repo"`), a bubblewrap sandbox whose
  working directory is a disposable copy of the repository at `--candidate`;
  see [Repository access](#repository-access).
- **Bounds.** Its configured timeout (the whole group gets SIGKILL, and the exit
  is recorded as the classifier's timeout code, 124), standard output capped at
  1 MiB and standard error at 64 KiB. One process per part, never retried with
  unchanged input.
- **Work tree.** The runner hashes HEAD, `git status --porcelain=v1 -z
  --untracked-files=all`, index entries and the bytes of tracked and nonignored
  untracked files before the calls and again after. Symlinks contribute their
  target text; they are never followed. Unreadable files or unsupported entries
  (including submodule directories) refuse the run.
  Any detected change
  discards the result of every part that call dispatched (`worktree-changed`),
  exits 1, and the review stops before any commit. Nothing is reverted.

The call directory (`--calls`) is branch-scoped, private, outside the repository
and kept across invocations of the branch. Each call writes a claim before it
spawns and a result after the shared work-tree check; a saved result replays
with no spawn. A result discarded for `worktree-changed` stays discarded on
every replay and still exits 1. A claim
without a result is `unresolved-claim` with no spawn. Never delete a claim or pick
a fresh directory to retry. A call id hashes the prompt, `argv`, `model` and the
provider label; for a repo-mode provider it also covers `access`, `expose` and
`keep`, so correcting either list after a failed call dispatches again.

## Repository access

A provider in `review-delegates/v1` may opt into repository access by setting
`"access": "repo"` (omitted or `"diff"` keeps diff-only mode) with optional
`"expose"` and `"keep"` path lists. Any of the six delegable parts (`testing`,
`maintainability`, `performance`, `simplification`, `adversarial` and
`red-team`) may map to a repo-mode provider. A caller that sets `"access":
"repo"` first runs `grep -F '"access": "repo"' "<installed skill dir>/SKILL.md"`
(exit 0 means supported) and leaves `access`, `expose` and `keep` out otherwise,
because an older runner rejects unknown provider keys as `config-malformed` and
runs every part on the host.

```json
{
  "schema": "review-delegates/v1",
  "providers": {
    "provider-a": {
      "argv": ["/path/to/delegate-command", "--read-only", "--no-tools"],
      "timeout_s": 600,
      "model": "model-a"
    },
    "provider-b": {
      "argv": ["/path/to/repo-delegate-command", "--sandbox-net=api-only"],
      "timeout_s": 900,
      "model": "model-b",
      "access": "repo",
      "expose": ["/path/to/provider-config"],
      "keep": ["/path/to/delegate-login"]
    }
  },
  "parts": {
    "testing": "provider-a",
    "adversarial": "provider-b",
    "red-team": "provider-b"
  }
}
```

- **Keys and path rules.** `expose` and `keep` are allowed only when `access` is
  `"repo"`. Each list holds 0 to 32 entries. Every entry must be a unique
  (across both lists), `path.normalize`-stable absolute path without trailing
  slashes, NUL or control characters. An entry may lie inside a directory the
  sandbox hides, never at it or above it: an entry that is `/`, `HOME`, the
  account's passwd home (read from the passwd database, since Bun's
  `os.userInfo()` follows `HOME`), `/tmp`, `/var`, `/run`, the runner's
  temporary directory, `XDG_RUNTIME_DIR` or an ancestor of any of them, or that
  lies inside `XDG_RUNTIME_DIR` (its session bus and agents, whose tmpfs would
  cover the entry at run time), is `config-malformed`, compared both as written
  and with its symlinks resolved. At run time each listed path is
  checked with `lstat`: an `expose` directory becomes a throwaway overlay, an
  `expose` regular file is staged into `<tmp>/staged/<n>` and bound read-write
  at its path, and a `keep` directory or regular file is bound read-write.
  Missing paths, symlinks, sockets or other file types fail that part (`failed`).
- **The command must be visible.** The sandbox hides `HOME`, the passwd home,
  `/tmp`, `/var`, `/run` and the runner's temporary directory. The runner
  follows `argv[0]`'s link chain (at most 16 hops) and compares each hop, with
  its ancestor directories resolved, against each entry's resolved path: every
  hop under a hidden directory must lie inside some entry, or the provider is
  `config-malformed` at `check`. The runner cannot see the command's other
  needs: an interpreter's script, a runtime under `HOME` (for example an
  `npm`, `bun` or `mise` install), its configuration and its login. List each in
  `expose` or `keep`, or the part fails on every call.
- **What the runner builds.** On Linux with bubblewrap (`bwrap`), the runner
  first hides the real repository and stages the listed paths, then creates a
  disposable copy: `git init --template=` of an empty repository, a
  `git fetch --no-tags --no-recurse-submodules` of `--candidate` alone from the
  real repository (through `upload-pack` with `uploadpack.allowAnySHA1InWant`,
  so a frozen snapshot commit that no ref reaches is fetched too), and a detached
  checkout with hooks and LFS smudge/process filters disabled
  (`-c core.hooksPath=/dev/null -c filter.lfs.process= -c filter.lfs.smudge= -c filter.lfs.required=false`).
  Every setup `git` call runs without the caller's `GIT_*` variables and with
  global and system configuration off (`GIT_CONFIG_GLOBAL=/dev/null`,
  `GIT_CONFIG_NOSYSTEM=1`, and an empty `HOME` and `XDG_CONFIG_HOME` for a git
  older than 2.32), so no filter, hook or clone setting from the host runs on
  the candidate's files. That also drops a `safe.directory` entry, so a
  repository owned by another account fails setup (`failed`). The copy has no remote. Setup runs
  asynchronously, is bounded by the provider's `timeout_s` and counted in
  `wall_ms`, and never delays another part's deadline. It then spawns the
  provider through `bwrap` in this order:
  - `--unshare-all --share-net --die-with-parent --new-session`
  - `--ro-bind / /`, `--dev /dev`, `--proc /proc`
  - `--tmpfs` over `/tmp`, `/var` (with an empty `/var/tmp` and
    `/var/run` linked to `../run`), `/run`, `$HOME`, the passwd home when it
    differs and the runner's temporary directory when it lies elsewhere,
    followed by a read-only `--ro-bind` of the DNS resolver configuration when
    `realpath('/etc/resolv.conf')` resolves under `/run/` (its directory) or
    `/var/` (the file alone, since `/var` directories may hold daemons' sockets)
  - the `expose` layers (`--overlay-src <dir> --tmp-overlay <dir>` for
    directories; `--bind <staged> <file>` for files) and the `keep` binds
    (`--bind <path> <path>`), a parent path before any listed path inside it,
    so the more specific entry wins: an `expose` file inside a `keep` directory
    stays throwaway, and a `keep` file inside an `expose` directory persists
  - `--tmpfs` over each hidden path that exists: the real repository's
    `git rev-parse --show-toplevel`, `--absolute-git-dir` and
    `--git-common-dir` (made absolute), every worktree `git worktree list`
    names (the main checkout and each linked worktree; `--porcelain -z`, or the
    newline form only when git answers `-z` with its usage exit, 129), the
    `--calls` directory, and `XDG_RUNTIME_DIR` (written and resolved) when it
    resolves outside `/run` or an `expose` or `keep` entry lies under `/run`;
    each hidden path is mounted both as written and resolved; these come after
    the `expose` and `keep` mounts, so they also hide any repository path inside
    a listed directory
  - a read-write `--bind` of the disposable copy and `--chdir` into it, with
    `TMPDIR=/tmp` in the child environment
- **Platform rule and `sandbox-unavailable`.** When any named part maps to a
  repo-mode provider, `check` and `run` require `linux`, an executable at the
  first existing path in `['/usr/bin/bwrap', '/bin/bwrap', '/usr/local/bin/bwrap']`
  (never a `PATH` lookup), and a 10 s probe that verifies user namespaces and
  `--tmp-overlay`. If any check fails, the whole invocation refuses before any
  call with `{"v":1,"status":"refused","reason":"sandbox-unavailable"}`, so
  every part of that call (including diff-mode parts named in the same command)
  runs on the host model.
- **Contents of the disposable copy and its cost.** The copy holds the files of
  the `--candidate` commit (a `/review-and-prep` frozen snapshot includes the
  untracked, nonignored files it captured) and that commit's history. Other
  branches and tags, ignored files (such as `.env` or `node_modules`), build
  outputs and submodule contents are absent, and Git LFS files contain pointer
  text only. Each repo-mode part fetches its own copy into the runner's
  temporary directory, which may be a RAM-backed tmpfs (as on Arch or Fedora),
  and holds it until its call ends, so concurrent repo-mode parts hold one copy
  each.
- **Hosts whose system files live under `/var`.** The `/var` tmpfs also hides
  host files that `/etc` or `/usr` resolve into on some systems: a CA bundle
  under `/var/lib/ca-certificates` (openSUSE), `/usr/local` or `/opt` linked into
  `/var` (Fedora Atomic), snap or flatpak runtimes, and SSSD's `/var/lib/sss`.
  A provider that needs one fails (`failed`); list that directory in `expose`.
- **A failed setup.** A setup step that fails (a missing or unsupported
  `expose` or `keep` path, a `git` failure, the deadline) records `failed` or
  `timeout`, and the saved result's standard error names the step
  (`review-delegate: repo-mode setup failed (<step>)`).
- **`keep` versus `expose` for rotating logins.** Writes to an `expose` path
  land in a throwaway layer and vanish when the call ends. If a provider CLI
  rotates its refresh token during a call, discarding that write under `expose`
  can lose the refreshed token and may invalidate the host's stored login (not
  established here). Use a dedicated delegate login under `keep` for credentials
  that rotate, and never list a directory in `expose` or `keep` that holds
  unrelated credentials or SSH keys.
- **Code from the reviewed head runs.** `REPO_POLICY` lets the model run
  commands in the copy to reproduce a defect, and those commands can execute
  code from the reviewed head (its tests, build or install scripts). That code
  runs with the shared network, the `expose` and `keep` paths and the Unix
  sockets listed below. Use diff mode for changes from contributors you would
  not let run code on this machine.
- **What the runner cannot observe or enforce.**
  - Anything inside the provider command itself.
  - The tool network bound: the sandbox keeps `--share-net` because the
    provider command must reach its API, so the runner cannot tell API traffic
    from tool traffic. Keeping the model's tools off other network hosts and
    starting no agents is the provider command's own sandbox configuration.
  - Unix sockets the sandbox can still connect to: abstract-namespace sockets,
    reachable through the shared network namespace (`--share-net`), and path
    sockets under paths that are not hidden. `connect()` needs no write access
    on a read-only mount, and the sandbox keeps the account's supplementary
    groups, so a group that grants a privileged daemon's socket outside the
    hidden paths makes repo mode host access for that account.
  - Reads of world-readable host paths that are not hidden by a `--tmpfs`, such
    as `/etc`, `/usr`, `/sys` and other non-hidden mounts.
  - Reads of paths the caller listed in `expose` or `keep`, and writes to paths
    the caller listed in `keep`.
  - Prompt injection from the reviewed diff or repository files steering tools
    inside the sandbox.
  - A finding's text (including `evidence`) carrying data read by tools inside
    the sandbox into the review receipt.
  - Size: the `--tmpfs` mounts, the overlay layers and the copy are unsized,
    so a runaway command can fill memory or disk within its timeout, and a
    runner killed before its cleanup leaves its temporary directory, staged
    `expose` copies included.

## The reply

The delegate returns, in this form:

- one line per finding, `[P0|P1|P2|P3] <one JSON object in the checklist's
  schema>`: P0 and P1 for `severity` `CRITICAL`, P2 and P3 for `INFORMATIONAL`.
  Required fields are `confidence` (an integer from 1 to 10), `path`,
  `category` and `summary`; `line`, `fix`, `fingerprint`, `evidence`, `test_stub`,
  `advisory`, `evidence_paths`, `helper_target` (`path` and `symbol`), `cause`
  (`path` and positive `line`) and `lines_removable` are optional. These retain
  their upstream meaning. Simplification findings require `INFORMATIONAL`
  severity and `advisory: true`. The runner overwrites `specialist` with the
  part and drops keys outside this schema;
- `evidence` is text or the testing checklist's object with exactly `detects`,
  `non_test_callers`, `search_command` and `stronger_proof`. Their JSON values
  are preserved without imposing types the checklist does not specify;
- a clean reply has `NO_FINDINGS: none` immediately before the closing
  `Recommendation: <action> because <reason>`;
- a reply that lacks context returns `NEEDS_CONTEXT: <what>`.

Every reply needs its closing `Recommendation` line; a reply with no findings
also needs the explicit `NO_FINDINGS: none` marker. Classifier recovery does
not waive either requirement. Blank lines are allowed; fences, prose or finding lines outside this form make
the whole reply fall back, so a partially parsed reply never loses findings.
These response-format instructions override the checklist's output-format
directions while preserving its schema and review criteria.

The upstream checklist's own plain JSON-line output is not credited by the
installed classifier (it needs a `Recommendation: ... because ...` line and a
severity label), which is why the runner asks for this form. The runner reads
the reply from standard output: one JSON object with a string `result` is an
envelope (its `usage` token counts are read when they are non-negative
integers, and `is_error: true` counts as a failure); any other output is the
reply itself with no token counts. The classifier is the installed upstream
one, loaded through the same helper list as the outside adapter.

## Fallback

A part runs on the host model instead when its delegate cannot be credited.
A detected work-tree change takes precedence over the other reasons and stops
the review before any commit; host coverage remains incomplete until those
parts actually run on the host. Otherwise, the first matching reason wins:

| Reason | Cause |
|---|---|
| `unresolved-claim` | An earlier call for the same input has a claim and no result. No call is made. |
| `timeout` | The delegate ran past its configured timeout. |
| `failed` | Its temporary directory could not be created or cleaned up, it could not start, exited nonzero or by signal, produced more than 1 MiB, or reported `is_error`. |
| `refused` | The installed classifier read the reply as a refusal. |
| `needs-context` | The reply says `NEEDS_CONTEXT`. |
| `uncredited` | The installed classifier did not credit the reply. |
| `unparsed-finding` | Any reply content is outside the required form, a finding has malformed fields, or the classifier saw findings the runner could not parse. |
| `worktree-changed` | The work tree or HEAD changed during the calls; applies to every part that call dispatched. |

A fell-back part is never sent back to the delegate. Coverage is never lost
silently: the receipt names the part and the reason.

## The command line

`bin/review-delegate` is internal to `/review-and-prep`.

```text
review-delegate check --config FILE --gstack-root DIR --parts P[,P...] [--adversarial FILE]
review-delegate run --config FILE --gstack-root DIR --parts P[,P...] [--adversarial FILE] --repo DIR --base SHA --candidate SHA --calls DIR [--caught FILE]
```

`--adversarial FILE` (check and run; absolute path) is required when `--parts`
names `adversarial`, and is a usage error otherwise. `--caught FILE` (run only;
absolute path; outside `--repo`) is required when `--parts` names `red-team`,
and is a usage error otherwise. Its text is part of the red-team prompt, so a
changed list is a new call id: `/review-and-prep` writes it once per cycle as
`caught-<cycle>-<S>.txt` under the branch-scoped calls directory (created with
mode 0700 when missing), mode 0600, before the cycle's first red-team call. It
writes the file through a temporary file in that directory renamed into place
(so a crash never leaves a partial list to reuse), never rewrites it, and
reuses it unchanged on a resume.

`check` validates without any call. Exit 0 prints
`{"v":1,"status":"ok","config_sha256":...,"parts":[{"part","provider","model"}]}`,
adding `"access":"repo"` to each part object whose provider sets `"access": "repo"`
(diff-mode parts keep `{part, provider, model}`).
Exit 1 prints `{"v":1,"status":"refused","reason":...}` with `config-missing`,
`config-malformed`, `part-unmapped`, `helper-missing` (the installed classifier
cannot be loaded), `checklist-anchor` (a named part's checklist or
`--adversarial` file no longer matches the anchors, or its adversarial framing
line does not directly follow the one `Subagent prompt:` line, or the prompt or
criteria line does not occur once) or `sandbox-unavailable` (a named part maps
to a repo-mode provider and the host is not Linux, has no executable at the
fixed `bwrap` paths, or fails the 10 s bubblewrap probe). Exit 2 is a usage error decided before
any work (an unknown flag, a part outside the six, a repeated part, a missing or
extra `--adversarial` or `--caught`, a relative path, a `--calls` or `--caught`
inside `--repo`): standard output is empty and standard error has
`ERROR USAGE: ...` and `FIX: ...`.

`run` takes the same flags plus the repository, the frozen scope's two full
SHAs, the calls directory and (for `red-team`) `--caught`. It runs `check`
first (a missing or >64 KiB `--caught` file refuses with `caught-unreadable`,
and a repository git cannot read refuses with `repo-unreadable`), takes the diff
once and runs the parts concurrently. Exit 0 means every part was credited, 4
means a part fell back, and 1 means a refusal before any call or a
`worktree-changed` result. It prints
`{"v":1,"status":"ran","config_sha256":...,"parts":[...]}`; each part carries
`part provider model call_id replay dispatched dispatched_at returned_at wall_ms
input_tokens output_tokens cache_read_input_tokens cache_creation_input_tokens
parse verdict outcome fallback_reason findings`. The output never carries prompt
text, reply prose or standard error.

`/review-and-prep` makes one `run` call per review stage that runs named parts.
After a refusal (exit 1) or a usage error (exit 2) it runs that stage's parts on
the host and records the reason, and it handles any other exit code like exit 1.
An exit 1 or 2 that prints no `parts` array records only a receipt note naming
the exit, with no delegate attempt.

## Layouts

The option works on both installed layouts, the nested (Claude Code) install and
the sibling (Codex and Cursor) installs. Most of its specialist anchors are text
every copy carries: six lines of the installed `/review` file and, for each
delegated specialist part, three lines of its `review/specialists/<part>.md`
checklist, which the sibling root links to the nested copy. Three more lines
anchor upstream's `specialists-dispatched` contract item all-or-none, because
the Codex sibling copy declares no item while the nested and Cursor copies do.
The attacker parts add three `review/specialists/red-team.md` anchors, four
adversarial anchors in `review/sections/adversarial.md` (nested) or the review
file itself (sibling), and two all-or-none `adversarial-pass` contract-item
anchors. Drift is reported by
[`upstream-check`](upstream-check.md#what-it-checks) (the
`review-and-prep.delegate` and `review-and-prep.attacker` IDs). When the anchors
match, a delegated part runs through its delegate whichever model hosts the
review.

On the nested layout, the named specialist parts that Review Army selects run
through the delegate, so delegation never adds or removes a specialist part
there. On the sibling layout every named specialist part runs through its
delegate. `adversarial` replaces the native adversarial subagent in every pass
that runs Step 4.8. `red-team` replaces the Red Team dispatch whenever a red
team runs (upstream's on its own gate, or the wrapper's red-team step where
`/review` has none); the sibling rule never removes the red team's gate. On
either layout the delegate replaces that part's host dispatch for the cycle,
however the host would have run it, and a delegated part is never also run on
the host except after a recorded fallback. A fell-back part runs on the host
from the same checklist or subagent prompt: the nested host dispatches it as
`/review` would, and a sibling host applies the checklist or runs the host
subagent with the same output contract.

## With `specialists=fold`

`specialists=fold` folds the first full-scope cycle into the main review pass:
the main pass reads the selected specialists' checklists itself and no
specialist is dispatched, to a subagent or to a delegate (see
[the fold record](acceptance/review-fold.md)). The two values exclude each other.
A policy line carrying both reads `none supplied` with the reason
`specialists=fold excludes delegate=`, so every key on that line is lost, as for
any other malformed line, and an H-E parser holds the same line as
`policy-malformed`. A caller picks one arm per invocation. Under that rule a part
is never reviewed twice (once folded and once delegated) and never left
unreviewed (named by one value and run by neither), because the two never take
effect together. A `Review delegates:` line beside a policy that carries only
`specialists=fold` is not read: delegation needs its own value.

## Receipts and metrics

- The receipt records `delegation: active (parts=<list>; config=<sha256>)` (or
  `delegation: active (parts=<list>; config=<sha256>; repo=<part>[,<part>...])`
  when `check` reports `"access":"repo"` for any part) or
  `delegation: inactive — <reason>`, one `specialists-dispatched:` line when the
  section is active (`waived`, `met`, `not declared` or `unmet`), one
  `adversarial-pass:` line while `delegate=adversarial` is active (`waived`,
  `met`, `not declared` or `unmet`), one `Red team:` line when the policy
  carries `red-team=ensure` or `delegate=` names `red-team`, and one
  `Delegated part:` line per part with
  `provider`, `model`, `outcome`, `reason`, `wall_ms`, the four token counts,
  `findings` and `call` (the call id). Unknown values read `unknown`. The PAUSED
  and STOPPED receipts carry the same lines.
- The `specialists-dispatched:` status describes the current upstream item
  result, and its waiver is scoped to credited specialist parts (a credited
  `red-team` or `adversarial` alone waives nothing there); `adversarial-pass:`
  follows the same current-result and history rule for `delegate=adversarial`.
  A met selection outranks an earlier waiver. Mixed cycle outcomes append
  `; history=<cycle>:<outcome>[,...]` to the line, retaining successful
  waivers' parts and failed calls' causes even when the current result is met
  or waived. A later failed call does not erase an earlier successful waiver.
- Findings enter the review as that part's findings and keep its `found_by`
  attribution (`specialist:<part>` for the four specialists, `red-team` for
  `red-team`, and `native-adversarial` for `adversarial`); the provider and
  model are recorded on the part, not inside a finding. A credited specialist
  part is recorded as dispatched in the review's `specialists` object, as is a
  credited `red-team` part in both layouts; a credited `adversarial` part adds
  no `specialists` entry.
- The [workflow metrics](telemetry.md#workflow-metrics-delegated) record each
  delegated part as a `pass` v3 attempt with a `delegate` object, so a reader can
  count usage per provider label. Earlier receipts and rows stay readable.
- `voices.jsonl` carries an optional content-free `delegate` object per part
  ([reviewer join file](telemetry.md#reviewer-join-file)).

## Privacy

In diff mode, the frozen diff, including any secret it contains, is sent to the
command you configured and on to whatever provider it calls. In repo mode
(`"access": "repo"`), the command and its tools can also read every committed
file in the repository and its git history. Configure a provider you would
trust with that scope; the runner passes no credential, but it cannot stop a
command from reading its own `expose` or `keep` paths.

## Measurement

Delegation is evaluated against today's default, in which every selected part
runs on the host, and against the opt-in folded first cycle
(`specialists=fold`, Track 58A), each arm measured separately on the same heads
because the two values exclude each other. No saving is claimed here: record a
real run's wall time and per-provider usage (`data.delegated`) beside the
default before treating delegation as an optimization, as SPEC P1 requires.
The attacker parts' pending by-hand and orchestrated runs are listed in
[the attacker-parts record](acceptance/attacker-parts.md), and the pending
repo-mode run is listed in
[the repo-access record](acceptance/delegate-repo-access.md).

## Limits

- In diff mode, the runner builds every control it can observe: no tool or agent
  grant, a prompt that forbids tools, an empty temporary directory, an
  environment allowlist, one process per part and a before-and-after work-tree
  check. It cannot see inside a configured command, so "starts no subagents and
  writes nothing" depends on that command's own configuration, and a write that
  lands outside the work tree is not detected. Ignored files are outside the
  check. A before-and-after snapshot also cannot detect a write that is restored
  before the second snapshot. In repo mode (`"access": "repo"`), bubblewrap
  enforces the mount and PID-namespace bounds listed there, within the socket
  and unhidden-path limits it names, while the tool network bound and
  no-agents rule remain the command's own configuration (see
  [Repository access](#repository-access)).
- In diff mode, after a normal exit the runner does not signal the command's
  process group, so a command that leaves a background process behind must clean
  it up itself. In repo mode, bubblewrap's PID namespace and `--die-with-parent`
  end the process tree when the command exits.
- Concurrent parts on one provider can hit its rate limit together and all fall
  back; that costs spend, not coverage.
- In diff mode, a delegated attacker part sees only the diff, never repository
  files, unlike the native subagent; fixture bytes go in full, as they already
  do to outside voices. In repo mode, a part mapped to an `"access": "repo"`
  provider sees a disposable copy of the `--candidate` commit's files and history.
- The six parts are the only delegable ones, `/ship-and-land` and
  `/full-review` do not delegate, and routing by remaining quota is a non-goal.
- An older helper answers `unsupported-version` to a v3 `pass` and reads a stored
  v3 line as `malformed-record`.
