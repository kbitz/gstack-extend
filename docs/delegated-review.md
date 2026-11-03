# Delegated review parts

`/review-and-prep` can send named specialist review parts to a provider the
caller configures, and run any part whose delegate fails on the host model. It
is an opt-in `Review policy:` value. Without it the review runs as today, and
the default delegates nothing.

Nothing here names a particular provider, tool or plugin: the caller supplies a
command and a model name, and the examples use placeholders.

## Scope

Four parts can be delegated: `testing`, `maintainability`, `performance` and
`simplification`. Security, Red Team, state-machines, the native adversarial
pass, the outside voices and the documentation and coverage audits are not
delegable under this option and retain their existing routes. A policy value
that names any other part is an unknown value, so
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
  older installation reads the whole policy line as `none supplied`. The value
  waives no gate and never authorizes a continuation.
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
    "simplification": "provider-a"
  }
}
```

- Key sets are closed. `providers` maps a label (`[a-z][a-z0-9-]{0,31}`) to its
  `argv` (1-64 non-empty strings; `argv[0]` is an absolute path, never a `PATH`
  lookup), `timeout_s` (an integer from 1 to 1800) and `model` (a name the
  workflow-metrics identifier grammar accepts). `parts` maps each delegable part
  to a label; every part the policy names needs a mapping, and a mapping to an
  unknown label is malformed.
- The prompt goes on the command's standard input only. There is no placeholder
  substitution and no shell.
- The command must run with no tools, no agents and no write access. The runner
  grants and requests none, and it cannot observe what a command does inside
  itself: that limit is yours to configure (see [Limits](#limits)).

## The call

A delegated part is one bounded, read-only call:

- **Sent.** A fixed policy, one JSON line `{part, base, candidate}`, then
  `{"diff": ..., "checklist": ...}`: the frozen diff and that specialist's
  checklist from `<gstack-root>/review/specialists/<part>.md`. Nothing else: no
  learnings, stack notes, repository files, skill text or plan.
- **Environment.** Only `HOME PATH USER LOGNAME SHELL TMPDIR LANG LC_ALL LC_CTYPE
  TZ`, and only those that are set. No key or credential is passed; a command
  keeps its own login under `HOME`.
- **Where it runs.** A fresh, empty, private temporary directory as its working
  directory, removed afterwards, in its own process group.
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
a fresh directory to retry.

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
review-delegate check --config FILE --gstack-root DIR --parts P[,P...]
review-delegate run --config FILE --gstack-root DIR --parts P[,P...] --repo DIR --base SHA --candidate SHA --calls DIR
```

`check` validates without any call. Exit 0 prints
`{"v":1,"status":"ok","config_sha256":...,"parts":[{"part","provider","model"}]}`.
Exit 1 prints `{"v":1,"status":"refused","reason":...}` with `config-missing`,
`config-malformed`, `part-unmapped`, `helper-missing` (the installed classifier
cannot be loaded) or `checklist-anchor` (a named part's checklist no longer
matches the anchors). Exit 2 is a usage error decided before any work (an
unknown flag, a part outside the four, a repeated part, a relative path, a
`--calls` inside `--repo`): standard output is empty and standard error has
`ERROR USAGE: ...` and `FIX: ...`.

`run` takes the same flags plus the repository, the frozen scope's two full
SHAs and the calls directory. It runs `check` first (a repository git cannot
read refuses with `repo-unreadable`), takes the diff once and runs the parts
concurrently. Exit 0 means every part was credited, 4 means a part fell back, and
1 means a refusal before any call or a `worktree-changed` result. It prints
`{"v":1,"status":"ran","config_sha256":...,"parts":[...]}`; each part carries
`part provider model call_id replay dispatched dispatched_at returned_at wall_ms
input_tokens output_tokens cache_read_input_tokens cache_creation_input_tokens
parse verdict outcome fallback_reason findings`. The output never carries prompt
text, reply prose or standard error.

## Layouts

The option works on both installed layouts, the nested (Claude Code) install and
the sibling (Codex) install. Its anchors are text both carry: four lines of the
installed `/review` file and, for each delegated part, three lines of its
`review/specialists/<part>.md` checklist, which the Codex root links to the
nested copy. Nothing is anchored in a section only one layout installs, and
drift is reported by [`upstream-check`](upstream-check.md#what-it-checks) (the
`review-and-prep.delegate` IDs). When the anchors match, a delegated part runs
through its delegate whichever model hosts the review.

On the nested layout, the named parts that Review Army selects run through the
delegate, so delegation never adds or removes a part there. On the sibling layout
every named part runs through its delegate. On either layout the delegate
replaces that part's host dispatch for the cycle, however the host would have
run it, and a delegated part is never also run on the host except after a
recorded fallback. A fell-back part runs on the host from the same checklist: the
nested host dispatches it as Review Army would, and a sibling host applies the
checklist to the frozen diff with the same output contract.

## Receipts and metrics

- The receipt records `delegation: active (parts=<list>; config=<sha256>)` or
  `delegation: inactive — <reason>`, and one `Delegated part:` line per part with
  `provider`, `model`, `outcome`, `reason`, `wall_ms`, the four token counts,
  `findings` and `call` (the call id). Unknown values read `unknown`. The PAUSED
  and STOPPED receipts carry the same lines.
- Findings enter the review as that specialist's findings and keep the
  `specialist:<part>` attribution; the provider and model are recorded on the
  part, not inside a finding.
- The [workflow metrics](telemetry.md#workflow-metrics-delegated) record each
  delegated part as a `pass` v3 attempt with a `delegate` object, so a reader can
  count usage per provider label. Earlier receipts and rows stay readable.
- `voices.jsonl` carries an optional content-free `delegate` object per part
  ([reviewer join file](telemetry.md#reviewer-join-file)).

## Privacy

The frozen diff, including any secret it contains, is sent to the command you
configured and on to whatever provider it calls. Configure a provider you would
trust with the repository's diff; the runner passes no credential, but it cannot
stop a command from reading its own.

## Measurement

Delegation is evaluated against today's default, in which every selected part
runs on the host, and against the opt-in folded first cycle (Track 58A). No
saving is claimed here: record a real run's wall time and per-provider usage
(`data.delegated`) beside the default before treating delegation as an
optimization, as SPEC P1 requires.

## Limits

- The runner builds every control it can observe: no tool or agent grant, a
  prompt that forbids tools, an empty temporary directory, an environment
  allowlist, one process per part and a before-and-after work-tree check. It
  cannot see inside a configured command, so "starts no subagents and writes
  nothing" depends on that command's own configuration, and a write that lands
  outside the work tree is not detected. Ignored files are outside the check.
  A before-and-after snapshot
  also cannot detect a write that is restored before the second snapshot.
- After a normal exit the runner does not signal the command's process group, so
  a command that leaves a background process behind must clean it up itself.
- Concurrent parts on one provider can hit its rate limit together and all fall
  back; that costs spend, not coverage.
- The four parts are the only delegable ones, `/ship-and-land` and
  `/full-review` do not delegate, and routing by remaining quota is a non-goal.
- An older helper answers `unsupported-version` to a v3 `pass` and reads a stored
  v3 line as `malformed-record`.
