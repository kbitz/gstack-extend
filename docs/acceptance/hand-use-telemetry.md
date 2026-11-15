# Hand-use telemetry qualification

Status: qualified — Claude `cli` and `paseo-entrypoint` by-hand runs and an orchestrated interactive run read back through `report --by-host` (`2026-11-15`)

This record tracks real-run qualification for stage-runs v4 `run_mode` and
`run_mode_source` ([Run mode](../telemetry.md#run-mode)). Fixtures in
`tests/telemetry.test.ts` and `tests/telemetry-contract.test.ts` verify the
classifier and report helper against synthetic state; they do not establish
real by-hand capture on the owner's machines.

## What counts

On `2026-11-15`, the owner asked `"why is it a requirement to do this on every machine? that seems silly"` and approved `"ok"` to narrow Track 80D's hand-use qualification from every active machine to one real by-hand run per launch type the owner uses (`paseo-entrypoint` and `cli`), plus one orchestrated interactive run. ([SPEC.md](../SPEC.md) O6.1 retains the broader fleet-wide telemetry objective.)

Qualification requires all three of the following real runs, read back from the
owner's stage-runs ledgers through `gstack-extend-telemetry report --by-host`
without fabricating rows:

1. **One by-hand run for each launch type the owner uses**:
   - In the Paseo app (`CLAUDE_CODE_ENTRYPOINT=Paseo`, no orchestration or workspace-owner signal set), recording `run_mode: "user-directed"`, `run_mode_source: "paseo-entrypoint"`.
   - From Claude Code's terminal (`CLAUDE_CODE_ENTRYPOINT=cli`, no orchestration or workspace-owner signal set), recording `run_mode: "user-directed"`, `run_mode_source: "cli"`.
2. **One orchestrated run of an interactive stage** (`/plan-track`, `/roadmap`, or `/project-spec`) launched with `GSTACK_EXTEND_RUN_MODE=orchestrated`, recording `run_mode: "orchestrated"` and `run_mode_source: "session-kind"`, `"work-item"`, or `"run-mode-env"` according to the 10-rule classifier precedence in [docs/telemetry.md](../telemetry.md#run-mode) (`"run-mode-env"` when no higher-precedence `GSTACK_SESSION_KIND=spawned|unattended` or `GSTACK_EXTEND_WORK_ITEM` signal is set, such as `--docs project-spec`, and `"session-kind"` when the hand worker is spawned with `GSTACK_SESSION_KIND=spawned`).

An orchestrator that launches workers through Paseo or Claude's `cli`
entrypoint must set `GSTACK_EXTEND_RUN_MODE=orchestrated` (or
`GSTACK_EXTEND_WORKSPACE_OWNER`, `GSTACK_EXTEND_WORK_ITEM`, or
`GSTACK_SESSION_KIND=spawned|unattended`), or its workers are counted as hand
use (`user-directed`).

## Orchestrator cutover

Reported by the orchestrator's manager on 2026-11-10 and not independently
verified here; the orchestrator's own repository records the change. Its Track
94A merged as commit `b833096` (orchestrator release 0.5.65), and its transport
moved at about 2026-11-09 15:58Z. From then on:

- every transport stage and every hand-worker launch carries
  `GSTACK_EXTEND_RUN_MODE=orchestrated`;
- item stages also carry `GSTACK_EXTEND_WORK_ITEM`;
- hand launches, except `--docs project-spec`, also carry
  `GSTACK_SESSION_KIND=spawned`;
- manager launches carry none of these signals;
- `GSTACK_EXTEND_WORKSPACE_OWNER` is not set yet.

Rows that orchestrator wrote before the cutover may be recorded `user-directed`
although an orchestrator launched them, so read them as unattributed rather
than as hand use. Its manager sessions still classify by entrypoint. Rows from
later launches are candidates for the orchestrated run above; this cutover note
is not that run.

## Readback procedure

After running the stages above, inspect the aggregate and per-host counts with:

```sh
gstack-extend-telemetry report --by-host
gstack-extend-telemetry report --by-host --json
```

When reading synced or multi-machine state roots in place, pass repeatable
`--state-dir DIR` arguments:

```sh
gstack-extend-telemetry report --by-host --state-dir "$HOME/.gstack-extend"
```

Find the entry with the expected `host` label in the `hosts` array and check
its `cells.<mode>` counts. The report aggregates stages per host; inspect the
corresponding ledger locally to read only the
row's `stage`, `agent`, `run_mode`, and `run_mode_source` fields. Never paste
`session_id`, `work_item`, `repo`, `branch`, or local filesystem paths into
this record. Once all required rows are recorded in the table below, update the
`Status:` line above and remove the pending notice in
[docs/telemetry.md](../telemetry.md#run-mode).

## Recorded runs

These rows qualify the observed Claude launch types and orchestrated interactive
stages, not fleet-wide SPEC O6 acceptance or other harnesses. Exact harness CLI
binary versions remain unknown; the reported extension revisions are retained.

| Date | Machine (host label) | OS | Harness and version | gstack-extend version | How launched | run_mode | run_mode_source |
|---|---|---|---|---|---|---|---|
| `2026-11-09T16:22:59Z` | `349c-kb-ms` | macOS (release `unknown`) | `claude` (`claude-opus-5-5`, `effort: "medium"`; CLI version `unknown`) | `0.78.0` (`f036f50`) | Owner-reported by-hand terminal (`CLAUDE_CODE_ENTRYPOINT=cli`), stage `gstack-extend-upgrade`, PR `none` (non-PR stage; `report --by-host` `cells.user-directed.runs=1`, `outcomes.success=1`, `last_seen="2026-11-09T16:22:59Z"`) | `user-directed` | `cli` |
| `2026-11-14T05:22:21Z` | `3771h-kb-xps` | Omarchy Linux | `claude` (`claude-opus-5-5`, `effort: "medium"`; CLI version `unknown`) | `0.93.1` (`36a66ad`) | Orchestrated interactive stage `project-spec` via Paseo (`CLAUDE_CODE_ENTRYPOINT=Paseo`, `GSTACK_EXTEND_RUN_MODE=orchestrated`), PR `none` (`report --by-host` `project-spec:orchestrated` `last_seen="2026-11-14T05:22:21Z"`) | `orchestrated` | `run-mode-env` |
| `2026-11-15T01:20:55Z` | `3771h-kb-xps` | Omarchy Linux | `claude` (`claude-opus-5-5`, `effort: "high"`; CLI version `unknown`) | `0.94.0` (`6df3b69`) | Orchestrated interactive stage `roadmap` via Paseo (`CLAUDE_CODE_ENTRYPOINT=Paseo`, `GSTACK_SESSION_KIND=spawned`, `GSTACK_EXTEND_RUN_MODE=orchestrated`), PR #251 (`report --by-host` `roadmap:orchestrated` `last_seen="2026-11-15T01:20:55Z"`) | `orchestrated` | `session-kind` |
| `2026-11-15T02:49:37Z` | `kb-xps` | Omarchy Linux | `claude` (CLI version `unknown`) | `0.94.1` (`0c1c33f`) | By-hand Paseo app, stage `docs-ship`, PR #12; raw row `outcome="success"`, confirmed by the owner's local `report --by-host` paste on `2026-11-15` | `user-directed` | `paseo-entrypoint` |

**Paseo readback provenance (`2026-11-15`):** The owner ran
`gstack-extend-telemetry report --by-host` on `kb-xps` and pasted its output to
the manager: files `read=5 unreadable=0`; rows `counted=239 routed=0 malformed=0
invalid=0 unsupported=0`. Host `kb-xps` showed `user-directed` runs `3`, all
successful, last seen `2026-11-15T02:54:03Z`; the `docs-ship` `user-directed`
aggregate showed runs `3` (success `2`, blocked `1`), last seen
`2026-11-15T02:49:37Z`. Together with the owner's earlier raw row readback
(`agent="claude"`, `run_mode="user-directed"`,
`run_mode_source="paseo-entrypoint"`), this satisfies the local readback rule.
The earlier review-machine report had stale synced `kb-xps` rows; qualification
uses the owner's report on the machine itself, without requiring sync repair.
The stage aggregate spans hosts; the paired raw row supplies this run's host
and source attribution, rather than treating the aggregate counts as one run.

## Harnesses and entrypoints that read `unknown`

Non-Claude by-hand runs are outside this qualification. The owner identified a
by-hand Grok `docs-ship` run in Paseo on `kb-xps` at `2026-11-15T03:32:06Z`
(`producer_version: "0.94.1"`): the raw row has `agent: null`,
`run_mode: "unknown"`, and `run_mode_source: "no-harness"`. Two distinct
limitations were identified in the `2026-11-15` provider-parity audit:

1. **In-repo `GROK_SESSION_ID` gate (fixed):** Prior to this change,
   `bin/lib/telemetry.py` gated `GROK_SESSION_ID` on `GROK_AGENT=1` in both
   `detect()` and `harness_fingerprint()`, whereas `CODEX_THREAD_ID`,
   `CURSOR_CONVERSATION_ID`, and `CLAUDE_CODE_SESSION_ID` each stood on their
   own. `detect()`, `harness_fingerprint()`, `grok_logs()`, and `grok_turns()`
   now treat any valid `GROK_SESSION_ID` (`valid_session`) as a
   Grok session marker without requiring `GROK_AGENT=1` (while keeping a
   non-`"1"` `GROK_AGENT` profile name inert on its own). A Grok launch path
   that exports `GROK_SESSION_ID` (including hook runners and MCP child servers,
   or any ACP terminal that forwards `GROK_SESSION_ID`) now supplies detection
   and handoff-fingerprint evidence. Existing nested-harness selection and finish
   overrides still apply. When Grok is selected, model and effort come from its
   named session logs when available; without a higher-precedence launch signal,
   it records `run_mode: "unknown"` / `run_mode_source: "harness-unqualified"`.
2. **Upstream ACP `terminal/create` environment omission (`grok 1.0.77` + `paseo 0.15.2`):**
   Paseo registers Grok as an ACP provider (`grok acp`) and advertises
   `clientCapabilities.terminal: true`. When Grok runs a shell command in ACP
   mode (`xai-grok-shell-terminal`), it sends a `terminal/create` RPC
   (`CreateTerminalRequest`) to Paseo's `ACPAgentClient.createTerminal`, which
   spawns the command as a sibling child of Paseo rather than of `grok`. Unlike
   Grok's local shell (`xai-grok-tools`, which exports `GROK_AGENT=1`) and
   Grok's hook/MCP spawners (`xai-grok-hooks`, `xai-grok-mcp`, which export
   `GROK_SESSION_ID`), `xai-grok-shell-terminal` passes only cargo/npm progress
   variables in `CreateTerminalRequest.env`, omitting both `GROK_SESSION_ID` and
   `GROK_AGENT=1`. Simultaneously, Paseo's workspace catalog probe
   (`fetchCatalog`) invokes `grok acp` (`session/new`) whenever a workspace is
   opened for any provider, leaving zero-turn session directories under
   `$GROK_HOME/sessions/<encoded-cwd>/` even in Claude or Codex workspaces.
   Consequently, neither `PASEO_AGENT_ID` nor `$GROK_HOME/sessions/` directory
   presence can identify a Grok session when `CreateTerminalRequest.env` omits
   Grok's markers.

When Grok, Codex or Cursor is detected, by-hand mode remains `unknown` with
source `harness-unqualified` by design until a trustworthy launch signal
exists. Only `CLAUDE_CODE_ENTRYPOINT` currently proves the qualified Claude
by-hand launch types.

When no primary orchestration signal (`session-kind`, `work-item`,
`run-mode-env`) applies, `run_mode` is `"unknown"` for every case below, with
`run_mode_source` naming the exact reason:

| Case | `run_mode` | `run_mode_source` |
|---|---|---|
| Non-empty `GSTACK_EXTEND_RUN_MODE` other than `orchestrated` | `unknown` | `unrecognized-run-mode-env` |
| Non-default absolute `GSTACK_HOME` (different from `$HOME/.gstack`) | `unknown` | `launcher-state-root` |
| Malformed non-empty `GSTACK_SESSION_KIND` or `GSTACK_EXTEND_WORK_ITEM`, or relative non-empty `GSTACK_HOME` | `unknown` | `malformed-signal` |
| Any non-empty `GSTACK_EXTEND_WORKSPACE_OWNER` (even whitespace-only or malformed) with no orchestration signal | `unknown` | `host-managed-workspace` |
| No harness detected, regardless of a final `--agent` override | `unknown` | `no-harness` |
| A detected harness exists, and the detected or final harness is not Claude (`codex`, `cursor`, `grok`, or `--agent` override to/from another harness) | `unknown` | `harness-unqualified` |
| Detected Claude with missing, empty, or unclean `CLAUDE_CODE_ENTRYPOINT` | `unknown` | `entrypoint-unavailable` |
| Detected Claude with any `CLAUDE_CODE_ENTRYPOINT` other than `cli` or `Paseo` (`sdk-cli`, `sdk-ts`, `sdk-py`, `acp`, `claude-desktop`, `claude-vscode`, `remote-daemon`, `github-action`, …) | `unknown` | `entrypoint-unqualified` |

## Per-harness launch inventory (`2026-11-15`)

Inspected on `3771h-kb-xps` (Omarchy Linux, `gstack-extend 0.94.2`) across the
installed harness binaries (`claude 2.1.325`, `grok 1.0.77`,
`codex-cli 0.169.0`, `cursor-agent 2026.11.13-eacade1`) and workspace host
(`paseo 0.15.2`). Signal names, presence, and structural keys are recorded
below without raw marker values, session identifiers, account identifiers, or
prompt text.

The new session-ID-only Grok detection path is fixture-qualified only; no real
post-fix by-hand readback is claimed here. No additional harness or launch path
qualified for `user-directed`; the existing Claude readbacks above still stand.

| Harness and version | Launch paths inspected | Environment markers present (name and shape) | Session log path pattern and structural keys | Harness detection status | By-hand classification status |
|---|---|---|---|---|---|
| `claude 2.1.325` | Terminal CLI (`claude`), Paseo SDK (`paseo 0.15.2` `ClaudeAgentClient` with `claude-code-entrypoint-env` plugin) | `CLAUDECODE="1"`, `CLAUDE_CODE_SESSION_ID` (`valid_session` UUID shape), `CLAUDE_CODE_ENTRYPOINT` (`"cli"` in terminal, `"Paseo"` in Paseo, `"sdk-ts"`/`"sdk-cli"` in SDK workers) | `$CLAUDE_CONFIG_DIR/projects/<slug>/<session>.jsonl`: per-turn `assistant` records with `timestamp`, `isSidechain`, `message.model`, `message.effort`, `message.stop_reason`, `message.content[].type`/`name`/`id`, and `user` records | Qualified (`agent="claude"`, `model` and `effort` detected) | Qualified (`CLAUDE_CODE_ENTRYPOINT=cli` → `user-directed`/`cli`; `CLAUDE_CODE_ENTRYPOINT=Paseo` → `user-directed`/`paseo-entrypoint`) |
| `grok 1.0.77` | Terminal CLI (`grok`), hook/MCP child processes, Paseo ACP (`paseo 0.15.2` `GenericACPAgentClient` → `grok acp`) | Local shell (`xai-grok-tools`): `GROK_AGENT="1"` (`GROK_AGENT` is also a user-configurable agent profile variable when set to a profile name); hook/MCP spawners (`xai-grok-hooks`, `xai-grok-mcp`): `GROK_SESSION_ID` (`valid_session` UUID shape); Paseo ACP `terminal/create` (`xai-grok-shell-terminal` → `ACPAgentClient.createTerminal`): exports `PASEO_AGENT_ID`, `PASEO_AGENT_CWD`, `CARGO_TERM_PROGRESS_WHEN`, `CARGO_TERM_PROGRESS_WIDTH`, `NPM_CONFIG_PROGRESS` and omits both `GROK_SESSION_ID` and `GROK_AGENT` | `$GROK_HOME/sessions/<url-encoded-cwd>/<session>/events.jsonl` (`type="turn_started"`, `ts`, `model_id`, `role`, `turn_id`) and `summary.json` (`id`, `created_at`, `updated_at`, `current_model_id`, `reasoning_effort`, `last_message_id`, `turn_count`, `git_branch`). Note: Paseo's `fetchCatalog` probe creates zero-turn `summary.json` directories via `grok acp` whenever a workspace opens for any provider | Detection supported when valid `GROK_SESSION_ID` or `GROK_AGENT=1` is present (session-ID-only path fixture-qualified); unmarked under Paseo ACP `terminal/create` (`run_mode_source="no-harness"` until `GROK_SESSION_ID` or `GROK_AGENT=1` is forwarded) | Unqualified (`run_mode="unknown"`, `run_mode_source="harness-unqualified"` when detected; neither env vars nor `summary.json`/`events.jsonl` records a launch entrypoint) |
| `codex-cli 0.169.0` | Terminal CLI (`codex`), non-interactive (`codex exec`), Paseo app-server (`paseo 0.15.2` `CodexAppServerAgentClient` → `codex app-server`) | `CODEX_THREAD_ID` (`valid_session` UUID shape), `CODEX_CI`, `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED`, `CODEX_MANAGED_BY_NPM`/`CODEX_MANAGED_BY_BUN` (installer origin only). Under Paseo, `PASEO_AGENT_ID` and `PASEO_AGENT_CWD` are also present | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*-<thread>.jsonl`: `session_meta` (`payload.id`, `payload.timestamp`, `payload.cwd`, `payload.originator`, `payload.cli_version`, `payload.source`, `payload.model_provider`) and `turn_context` (`payload.model`, `payload.effort`). Observed `(originator, source)` pairs across 798 local logs on `3771h-kb-xps`: `("codex_cli_rs", "vscode")` (747), `("codex_exec", "exec")` (43), and subagent review/spawn entries (8) | Qualified (`agent="codex"`, `model` and `effort` detected) | Unqualified (`run_mode="unknown"`, `run_mode_source="harness-unqualified"`; neither `CODEX_*` env vars nor `session_meta.payload.originator`/`source` distinguishes a by-hand session from an orchestrated worker, and Paseo passes hardcoded `clientInfo.name="codex_app_server_daemon"`) |
| `cursor-agent 2026.11.13-eacade1` | Terminal CLI (`cursor-agent`), Paseo ACP (`paseo 0.15.2` `GenericACPAgentClient` → `cursor-agent acp`) | `CURSOR_AGENT="1"`, `CURSOR_CONVERSATION_ID` (`valid_session` shape), `CURSOR_INVOKED_AS` (`"cursor-agent"` or `"agent"`), `CURSOR_COMPILE_CACHE_IPC_PORT`, `CURSOR_TRACE_ID` | `.cursor/projects/<slug>/agent-transcripts/<id>.txt` or `<id>/<id>.jsonl`: `role` and `message.content` only (no model, effort, or entrypoint metadata) | Qualified when `CURSOR_AGENT` or `CURSOR_CONVERSATION_ID` is present (`agent="cursor"`; model/effort remain `null` unless supplied via flags or `GSTACK_EXTEND_MODEL`/`GSTACK_EXTEND_EFFORT`) | Unqualified (`run_mode="unknown"`, `run_mode_source="harness-unqualified"`; neither `CURSOR_*` env vars nor agent transcripts expose an entrypoint distinguishing interactive by-hand use from ACP or headless worker launches) |

## Drafted upstream requests

Each limitation above that cannot be closed inside `gstack-extend` without
sacrificing attribution accuracy has a concrete upstream request below:

1. **Grok CLI (`grok` / `xai-grok-shell-terminal`) — forward `GROK_SESSION_ID` and `GROK_AGENT=1` in ACP `terminal/create` requests and record launch entrypoint:**
   - *Missing signal:* `CreateTerminalRequest.env` in `xai-grok-shell-terminal/src/adapter.rs` currently forwards only `CARGO_TERM_PROGRESS_WHEN`, `CARGO_TERM_PROGRESS_WIDTH`, and `NPM_CONFIG_PROGRESS`, omitting `GROK_SESSION_ID` and `GROK_AGENT=1`. Neither the shell environment nor `$GROK_HOME/sessions/<encoded-cwd>/<session>/summary.json` records how Grok was entered (for example, `GROK_ENTRYPOINT=cli|acp|<clientInfo.name>`).
   - *Where commands/hooks need it:* Every command spawned via ACP `terminal/create` and every local shell command should inherit `GROK_SESSION_ID=<session-uuid>` and `GROK_AGENT=1` (matching `xai-grok-hooks` and `xai-grok-mcp`), plus a launch entrypoint variable or `summary.json` `entrypoint`/`client_name` field populated from the ACP `initialize` handshake's `clientInfo.name` (or `"cli"` for interactive TUI sessions).
   - *Why presence-only evidence is insufficient:* Paseo's `fetchCatalog` probe calls `grok acp` (`session/new`) whenever any workspace opens, creating zero-turn session directories under `$GROK_HOME/sessions/<encoded-cwd>/` even for Claude and Codex workspaces. Guessing Grok from `$GROK_HOME/sessions/` directory existence or `PASEO_AGENT_ID` would misattribute unmarkered runs in other harnesses and conflate sibling sessions.

2. **Paseo (`@getpaseo/server`) — provider-neutral launch entrypoint and ACP terminal session markers:**
   - *Missing signal:* Paseo's `claude-code-entrypoint-env` plugin (`CLAUDE_CODE_ENTRYPOINT=Paseo`) only runs when `request.provider === "claude"`. For ACP providers (`grok`, `cursor`, `opencode`) and `codex`, Paseo's `ACPAgentClient.createTerminal` and `CodexAppServerAgentClient` do not export a provider entrypoint or the ACP session's harness marker.
   - *Where commands/hooks need it:* In `ACPAgentClient.createTerminal` (and provider launch contexts), inject provider-specific or provider-neutral entrypoint metadata alongside the ACP session identifier when spawning terminal commands on behalf of an ACP session.
   - *Why presence-only evidence is insufficient:* `PASEO_AGENT_ID` is exported on every Paseo-managed agent regardless of whether a human launched it in the Paseo desktop app or an orchestrator spawned a worker through Paseo (`docs/telemetry.md#run-mode`), and `PASEO_AGENT_ID` alone does not identify which provider (`claude`, `grok`, `codex`, or `cursor`) owns the session.

3. **Codex CLI (`codex-cli` / `codex app-server`) — propagate `clientInfo.name` or an explicit entrypoint variable to child commands:**
   - *Missing signal:* `CODEX_THREAD_ID` identifies the rollout thread, but no `CODEX_ENTRYPOINT` variable is exported to child shells, and rollout `session_meta.payload` records `(originator, source)` only as `("codex_cli_rs", "vscode")` (for both interactive TUI and app-server sessions) or `("codex_exec", "exec")`.
   - *Where commands/hooks need it:* Export `CODEX_ENTRYPOINT` (for example, `cli`, `exec`, `app-server:<clientInfo.name>`) to child shell commands and record the app-server `initialize` `clientInfo.name` in `session_meta.payload`.
   - *Why presence-only evidence is insufficient:* `CODEX_THREAD_ID` and `$CODEX_HOME/sessions/` rollout files are present on both interactive terminal sessions, Paseo app-server sessions, and orchestrated workers, so presence of a thread ID or rollout file cannot distinguish by-hand use from orchestrated runs if an orchestrator omits `GSTACK_EXTEND_RUN_MODE=orchestrated`.

4. **Cursor Agent CLI (`cursor-agent`) — export an entrypoint signal and forward markers in ACP terminals:**
   - *Missing signal:* `CURSOR_AGENT=1`, `CURSOR_CONVERSATION_ID`, and `CURSOR_INVOKED_AS` do not distinguish interactive terminal use, IDE agent panes, ACP sessions (`cursor-agent acp`), or headless workers, and `.cursor/projects/<slug>/agent-transcripts/` omits model, effort, and entrypoint fields.
   - *Where commands/hooks need it:* Export `CURSOR_ENTRYPOINT` (or equivalent in `CURSOR_INVOKED_AS` / ACP `terminal/create` environment) and record `model`, `effort`, and `entrypoint` in the session transcript metadata.
   - *Why presence-only evidence is insufficient:* `CURSOR_AGENT=1` and `CURSOR_CONVERSATION_ID` are identical across interactive and automated CLI invocations, so treating them as by-hand proof would misclassify unflagged automated Cursor runs as `user-directed`.
