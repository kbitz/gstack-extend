# Delegated review parts

`/review-and-prep` can send named specialist review parts to a provider the
caller configures, and run any part whose delegate fails on the host model. It
is an opt-in `Review policy:` value. Without it the review runs as today, and
the default delegates nothing.

In default diff mode (`"access": "diff"` or omitted), nothing here names a
particular provider, tool or plugin: the caller supplies a command and a model
name, and the examples use placeholders. For opt-in tools-mode delegation
(`"access": "tools"`), see [Tools mode](#tools-mode).

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
  workflow-metrics identifier grammar accepts). `parts` maps each delegable part
  to a label; every part the policy names needs a mapping, and a mapping to an
  unknown label is malformed.
- The prompt goes on the command's standard input only. There is no placeholder
  substitution and no shell.
- In default diff mode, the command must run with no tools, no agents and no
  write access. The runner grants and requests none, and it cannot observe what
  a command does inside itself: that limit is yours to configure (see
  [Limits](#limits) and [Tools mode](#tools-mode)).

## The call

A delegated part is one bounded call:

- **Sent.** A fixed policy, one JSON line `{part, base, candidate}`, then
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
  for the Security specialist and the Red Team. Nothing else: no learnings,
  stack notes, repository files, skill text or plan.
- **Environment.** Only `HOME PATH USER LOGNAME SHELL TMPDIR LANG LC_ALL LC_CTYPE
  TZ`, and only those that are set (plus `DISABLE_AUTOUPDATER=1` and `PATH`
  filtered to absolute entries in [Tools mode](#tools-mode)). No key or
  credential is passed; a command keeps its own login under `HOME`.
- **Where it runs.** In diff mode, a fresh, empty, private temporary directory
  as its working directory, removed afterwards, in its own process group (in
  [Tools mode](#tools-mode), a detached shallow copy of the repository at
  `--candidate`).
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
`{"v":1,"status":"ok","config_sha256":...,"parts":[{"part","provider","model"}]}`
(adding `"access":"tools"` on parts whose provider configures tools mode).
Exit 1 prints `{"v":1,"status":"refused","reason":...}` with `config-missing`,
`config-malformed`, `tools-unsupported`, `part-unmapped`, `helper-missing` (the
installed classifier cannot be loaded) or `checklist-anchor` (a named part's
checklist or `--adversarial` file no longer matches the anchors, or its
adversarial framing line does not directly follow the one `Subagent prompt:`
line, or the prompt or criteria line does not occur once). When a tools-mode
provider is refused by configuration validation, `ERROR <reason>: <detail>` and
`FIX: <fix>` are also written to standard error naming `provider <label>
<key>[<index>]` without echoing configuration values. Exit 2 is a usage error
decided before any work (an unknown flag, a part outside the six, a repeated
part, a missing or extra `--adversarial` or `--caught`, a relative path, a
`--calls` or `--caught` inside `--repo`): standard output is empty and standard
error has `ERROR USAGE: ...` and `FIX: ...`.

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
text, reply prose or standard error; when a tools-mode part falls back, standard
error prints `review-delegate: <part> fell back (<reason>); saved result:
<calls>/<call_id>.json`.

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

- The receipt records `delegation: active (parts=<list>; config=<sha256>; tools=<part>[,<part>...])`
  when any check row carries `"access":"tools"`, `delegation: active (parts=<list>; config=<sha256>)`
  otherwise, or `delegation: inactive — <reason>`, one `specialists-dispatched:` line when the
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

The frozen diff, including any secret it contains, is sent to the command you
configured and on to whatever provider it calls. Configure a provider you would
trust with the repository's diff; the runner passes no credential, but it cannot
stop a command from reading its own.

## Measurement

Delegation is evaluated against today's default, in which every selected part
runs on the host, and against the opt-in folded first cycle
(`specialists=fold`, Track 58A), each arm measured separately on the same heads
because the two values exclude each other. No saving is claimed here: record a
real run's wall time and per-provider usage (`data.delegated`) beside the
default before treating delegation as an optimization, as SPEC P1 requires.
The attacker parts' pending by-hand and orchestrated runs are listed in
[the attacker-parts record](acceptance/attacker-parts.md), and tools-mode
qualification and post-merge verification live in
[the tools-mode acceptance record](acceptance/delegate-tools-mode.md).

## Limits

- In diff mode, the runner builds every control it can observe: no tool or agent
  grant, a prompt that forbids tools, an empty temporary directory, an
  environment allowlist, one process per part and a before-and-after work-tree
  check. It cannot see inside a configured command, so "starts no subagents and
  writes nothing" depends on that command's own configuration, and a write that
  lands outside the work tree is not detected. Ignored files are outside the
  check. A before-and-after snapshot also cannot detect a write that is restored
  before the second snapshot.
- In diff mode, after a normal exit the runner does not signal the command's
  process group, so a command that leaves a background process behind must clean
  it up itself (tools mode kills the process group on exit; see
  [Tools mode](#tools-mode)).
- Concurrent parts on one provider can hit its rate limit together and all fall
  back; that costs spend, not coverage.
- In diff mode, a delegated attacker part sees only the diff, never repository
  files, unlike the native subagent; fixture bytes go in full, as they already
  do to outside voices (for repository and test-execution access, see
  [Tools mode](#tools-mode)).
- The six parts are the only delegable ones, `/ship-and-land` and
  `/full-review` do not delegate, and routing by remaining quota is a non-goal.
- An older helper answers `unsupported-version` to a v3 `pass` and reads a stored
  v3 line as `malformed-record`.

## Tools mode

A provider may opt into subagent-style tool access (`"access": "tools"`) so a
delegated part (such as `adversarial` or `red-team` from a non-Claude host or a
separate subscription pool) can read surrounding files, edit files inside a
disposable copy at `--candidate`, and run named `Bash(<entry>)` test commands to
verify hypotheses before emitting findings.

**Prerequisite:** Enable tools mode only on candidates whose tests you would run
on the host. Its exposure is the same as a host subagent running the diff's
tests: the delegate CLI runs with the caller's normal environment and sign-in,
without an OS sandbox.

### Quickstart

1. **Resolve the real binary** (never use a version-manager shim such as
   `~/.local/share/mise/shims/claude`):
   ```bash
   mise which claude
   ```
2. **Probe caller support** before passing a tools-mode config:
   ```bash
   "<extend-root>/bin/review-delegate" --help | grep -qF '"access": "tools"'
   ```
   Exit `0` means the installed `review-delegate` supports `"access": "tools"`;
   exit `1` means an older install is loaded (keep diff-only providers or omit
   `delegate=`).
3. **Configure a tools-mode provider:**

```json
{
  "schema": "review-delegates/v1",
  "providers": {
    "claude-tools": {
      "access": "tools",
      "cli": "claude-code",
      "argv": ["/path/to/claude", "--effort", "high", "--max-budget-usd", "0.25"],
      "timeout_s": 600,
      "model": "sonnet",
      "commands": ["bun install --frozen-lockfile", "bun test *"]
    }
  },
  "parts": {
    "adversarial": "claude-tools"
  }
}
```
4. **Validate (`check`):**
   ```bash
   "<extend-root>/bin/review-delegate" check \
     --config /absolute/path/to/review-delegates.json \
     --gstack-root "<upstream-root>" \
     --parts adversarial \
     --adversarial "<upstream-root>/review/sections/adversarial.md"
   ```
   Expected stdout includes `"access":"tools"` on the part row:
   `{"v":1,"status":"ok","config_sha256":"...","parts":[{"part":"adversarial","provider":"claude-tools","model":"sonnet","access":"tools"}]}`.
5. **Smoke-run by hand (`run`):**
   ```bash
   "<extend-root>/bin/review-delegate" run \
     --config /absolute/path/to/review-delegates.json \
     --gstack-root "<upstream-root>" \
     --parts adversarial \
     --adversarial "<upstream-root>/review/sections/adversarial.md" \
     --repo "<repo>" --base "<base-sha>" --candidate "<candidate-sha>" \
     --calls /tmp/delegate-smoke-calls
   ```
   Exit `0` prints `"status":"ran"` with `"outcome":"credited"` on the
   `adversarial` row.

### Configuration grammar (`"access": "tools"`)

- `"access"` is optional on a provider (`"diff"` default, or `"tools"`).
- When `"access": "tools"`:
  - `"cli"` is required (`[a-z][a-z0-9-]{0,31}`). Structural validation runs
    first; any structurally valid `"cli"` other than `"claude-code"` refuses
    with `tools-unsupported` (exit 1).
  - `"argv"` allows only `argv[0]` (the absolute path to the real `claude`
    binary) followed by optional `--effort <value>` and `--max-budget-usd
    <value>` flag pairs (each at most once, with a non-empty value not starting
    with `-`). Passing `--model` or any other flag in `argv` refuses with
    `config-malformed` because the runner supplies `--model <provider.model>` and
    all permission flags.
  - `"commands"` is a non-empty array of unique strings matching words in
    `[A-Za-z0-9_./:=@+-]+` (no commas) separated by single spaces, no word
    ending in `:` (`Bash(prefix:*)` is deprecated; use a space before `*`), and
    an optional final word `*`. Pin install commands without ` *` (for example
    `"bun install --frozen-lockfile"`).

### Runner-owned flags, copy lifecycle, and environment

- **Appended flags (`effectiveArgv`):** After `provider.argv`, the runner appends
  `--model <provider.model>` and then:
  ```text
  -p --output-format json --safe-mode --restricted --strict-mcp-config --disable-slash-commands --no-session-persistence --permission-mode dontAsk --permission-prompts none --tools Read,Grep,Glob,Bash,Edit,Write --allowedTools Read Grep Glob Edit(./**) <one Bash(<entry>) per commands entry> --disallowedTools NotebookEdit WebFetch WebSearch Agent Task
  ```
  `callId` hashes `[prompt, effectiveArgv(provider), provider.model, label]`, so
  any change to `commands` or runner-owned flags produces a distinct call id.
- **Prompt (`TOOLS_POLICY`):** Replaces the diff-only no-tools lines while
  keeping the response format (`POLICY_FORMAT`) identical. The prompt names each
  allowed `Bash(<entry>)` pattern, instructs the delegate to clean up
  reproduction edits or include a unified diff in the finding's `evidence`
  field, and requires the host to re-verify reproduction claims:
  `A tools-mode finding's reproduction evidence is the delegate's claim: re-run it, after applying any reproduction patch it carries, before relying on it.`
- **Disposable copy (`prepareCopy`):** Inside `$TMPDIR/extend-delegate-*/copy`,
  the runner executes three async steps under the part's `timeout_s` budget:
  1. `git init -q <copy>`
  2. `git -C <copy> fetch -q --depth=1 --upload-pack="git -c uploadpack.allowAnySHA1InWant=true upload-pack" <real-top> <base> <candidate>`
  3. `git -C <copy> checkout -q --detach <candidate>`
  Requires git 2.32+. `GIT_*` variables are stripped, `GIT_CONFIG_GLOBAL=/dev/null`,
  `GIT_CONFIG_NOSYSTEM=1`, `GIT_TERMINAL_PROMPT=0`, and `PATH` is filtered to
  absolute entries. Git LFS pointer files are not hydrated unless an allowed
  command fetches them; repositories requiring submodules or partial-clone
  promisor fetches that cannot shallow-fetch `<base>` and `<candidate>` locally
  fail setup cleanly (`failed`). Concurrent tools-mode parts each fetch into
  their own copy and count against their `timeout_s`.
- **Environment and sign-in:** `CHILD_ENV` (`HOME`, `PATH` filtered to absolute
  entries, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `LANG`, `LC_ALL`, `LC_CTYPE`,
  `TZ`) plus `DISABLE_AUTOUPDATER=1`. Supported sign-in is Claude Code's stored
  login under the caller's normal `HOME`. Unsupported sign-in methods
  (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, a relocated
  `CLAUDE_CONFIG_DIR`, or settings-file `apiKeyHelper`/`env` entries requiring
  stripped variables) are not passed. Qualified on Linux with Claude Code
  `2.1.319`; macOS Keychain sign-in is unexercised. When upgrading Claude Code,
  re-run the behavioral permission probe in
  [docs/acceptance/delegate-tools-mode.md](acceptance/delegate-tools-mode.md).
- **Exit and cleanup:** On normal exit or timeout, the runner sends `SIGKILL` to
  the child's process group (`-pid`) and removes the temporary directory
  asynchronously (`rm`, retrying once after `chmod -R u+rwx <cwd>`, bounded by
  5 s) so a read-only mode-`0500` artifact or a slow removal does not stall
  sibling parts.

### Trust boundary

- **Protects against:**
  - `Edit` or `Write` tool calls modifying files outside the disposable copy or
    creating new files (`--restricted`, `Edit(./**)` in `--allowedTools`, and
    `Write` omitted from `--allowedTools`), including symlink targets outside
    the copy and protected `.git/` or `.claude/` paths inside the copy.
  - `Bash` tool calls outside the configured `commands` allowlist.
  - Candidate repository `.claude/settings.local.json`, MCP servers, slash
    commands, or hooks widening permissions (`--safe-mode --strict-mcp-config
    --disable-slash-commands`).
  - Relative `PATH` entries or version-manager shims hijacking `git` or
    `claude`.
  - Unverified reproduction claims being trusted without host re-run.
  - Mutations to the real repository's `HEAD`, index, tracked files, or
    nonignored untracked files (`worktreeState` before-and-after check ->
    `worktree-changed`).
- **Does not protect against:**
  - Arbitrary actions by code executed inside an allowed `Bash(<entry>)` command
    (such as `bun test *` or `bun install --frozen-lockfile` running candidate
    tests or package scripts with the caller's `HOME` and network).
  - Background processes that call `setsid` to escape the child's process group
    before exit-time `SIGKILL`.
  - Reads outside the copy (`--restricted` bounds writes to the working
    directory, not reads; `a reply can quote anything the delegate read or an
    allowed command printed`).
  - Writes outside the real repository's `worktreeState` check: `--calls`
    (including planted saved results), the gstack root, the extend root,
    `~/.claude`, or gitignored files in the real repository.

### Pre-enable checklist

1. Candidate diff has been inspected enough that you would run its tests on the
   host.
2. `argv[0]` points to the real `claude` binary (`mise which claude`), not a
   shim, and matches the qualified version (or has passed the behavioral
   requalification probe).
3. `commands` pins install commands without ` *` (for example `"bun install
   --frozen-lockfile"`) and scopes test runners narrowly.
4. `--max-budget-usd` and `timeout_s` are sized for shallow fetch + install +
   test execution.

### Diagnosing a tools-mode fallback

When a tools-mode part falls back, the runner prints the saved result path on
stderr:
`review-delegate: <part> fell back (<reason>); saved result: <calls>/<call_id>.json`.
Inspect setup timing and CLI stderr with:

```bash
jq -r .spawned.stderr "<calls>/<call_id>.json"
```

| Symptom in `.spawned.stderr` or `.spawned.stdout` | Meaning and fix |
|---|---|
| `review-delegate: tools-mode setup failed (init\|fetch\|checkout)` | Disposable copy setup failed (for example git < 2.32, missing commit, or submodule/promisor fetch). Fix the repository state; remove the saved `<call_id>.claim` and `<call_id>.json` only when intentionally resetting a by-hand smoke run. |
| `review-delegate: tools-mode setup failed (<step>: timeout)` | Copy setup exceeded `timeout_s`. Increase `timeout_s` in the provider config (which changes `config_sha256`, or if `argv`/`commands` change, `call_id`). |
| `error: unknown option '--restricted'` (or another runner-owned flag) | The configured `claude` binary predates the qualified CLI flags. Point `argv[0]` at Claude Code `2.1.319`+. |
| Authentication / login error in stdout or stderr | Stored login under `HOME` is missing or expired, or sign-in relies on an unsupported env var (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CONFIG_DIR`). Run `claude` interactively under normal `HOME` to refresh stored sign-in. |
| `"subtype":"error_max_budget_usd"` (`is_error: true`) | The delegate exceeded `--max-budget-usd` during tool turns. Raise `--max-budget-usd` in `argv` (which produces a new `call_id`). |
| Version-manager shim failure (`mise` / `asdf` env error) | `argv[0]` points to a shim instead of the real binary. Replace `argv[0]` with the output of `mise which claude`. |
| `fallback_reason: "worktree-changed"` (exit 1) | The real repository's `HEAD`, index, tracked files, or nonignored untracked files changed while parts ran. Stop before any commit, inspect `git status` in the real work tree, and do not delete claims. |
