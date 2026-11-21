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

An orchestrator that launches workers through a host app or a terminal
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
Machines appear under generic host labels (host A, B and C; distinct labels are
distinct telemetry host labels, not necessarily distinct machines), and the
real hostnames are kept in local evidence.

| Date | Machine (host label) | OS | Harness and version | gstack-extend version | How launched | run_mode | run_mode_source |
|---|---|---|---|---|---|---|---|
| `2026-11-09T16:22:59Z` | host C | macOS (release `unknown`) | `claude` (`claude-opus-5-5`, `effort: "medium"`; CLI version `unknown`) | `0.78.0` (`0667987`) | Owner-reported by-hand terminal (`CLAUDE_CODE_ENTRYPOINT=cli`), stage `gstack-extend-upgrade`, PR `none` (non-PR stage; `report --by-host` `cells.user-directed.runs=1`, `outcomes.success=1`, `last_seen="2026-11-09T16:22:59Z"`) | `user-directed` | `cli` |
| `2026-11-14T05:22:21Z` | host B | Omarchy Linux | `claude` (`claude-opus-5-5`, `effort: "medium"`; CLI version `unknown`) | `0.93.1` (`36a66ad`) | Orchestrated interactive stage `project-spec` via Paseo (`CLAUDE_CODE_ENTRYPOINT=Paseo`, `GSTACK_EXTEND_RUN_MODE=orchestrated`), PR `none` (`report --by-host` `project-spec:orchestrated` `last_seen="2026-11-14T05:22:21Z"`) | `orchestrated` | `run-mode-env` |
| `2026-11-15T01:20:55Z` | host B | Omarchy Linux | `claude` (`claude-opus-5-5`, `effort: "high"`; CLI version `unknown`) | `0.94.0` (`6df3b69`) | Orchestrated interactive stage `roadmap` via Paseo (`CLAUDE_CODE_ENTRYPOINT=Paseo`, `GSTACK_SESSION_KIND=spawned`, `GSTACK_EXTEND_RUN_MODE=orchestrated`), PR #251 (`report --by-host` `roadmap:orchestrated` `last_seen="2026-11-15T01:20:55Z"`) | `orchestrated` | `session-kind` |
| `2026-11-15T02:49:37Z` | host A | Omarchy Linux | `claude` (CLI version `unknown`) | `0.94.1` (`0c1c33f`) | By-hand Paseo app, stage `docs-ship`, a consumer repository PR; raw row `outcome="success"`, confirmed by the owner's local `report --by-host` paste on `2026-11-15` | `user-directed` | `paseo-entrypoint` |

**Paseo readback provenance (`2026-11-15`):** The owner ran
`gstack-extend-telemetry report --by-host` on host A and pasted its output to
the manager: files `read=5 unreadable=0`; rows `counted=239 routed=0 malformed=0
invalid=0 unsupported=0`. Host A showed `user-directed` runs `3`, all
successful, last seen `2026-11-15T02:54:03Z`; the `docs-ship` `user-directed`
aggregate showed runs `3` (success `2`, blocked `1`), last seen
`2026-11-15T02:49:37Z`. Together with the owner's earlier raw row readback
(`agent="claude"`, `run_mode="user-directed"`,
`run_mode_source="paseo-entrypoint"`), this satisfies the local readback rule.
The earlier review-machine report had stale synced host A rows; qualification
uses the owner's report on the machine itself, without requiring sync repair.
The stage aggregate spans hosts; the paired raw row supplies this run's host
and source attribution, rather than treating the aggregate counts as one run.

## Pending post-merge by-hand readbacks

Non-Claude classifications added by the shared by-hand rule (`2026-11-19`) are
fixture-qualified in `tests/telemetry.test.ts` and
`tests/telemetry-contract.test.ts`. Each installed non-Claude harness has a
pending post-merge by-hand readback below, to be run with no orchestration or
workspace-owner signal and read back through
`gstack-extend-telemetry report --by-host` and the host ledger's `agent`,
`run_mode`, and `run_mode_source` fields:

| Status | Harness and installed version | How to launch by hand | Expected `agent` | Expected `run_mode` | Expected `run_mode_source` |
|---|---|---|---|---|---|
| `pending` | `codex` (`codex-cli 0.170.0`) | Start a new Codex thread by hand in the terminal TUI and run one gstack-extend stage with no orchestration signal | `codex` | `user-directed` | `terminal-session` |
| `pending` | `muse` (`Muse Code 1.4.24`) | Run one gstack-extend stage by hand in Muse from the Paseo host app with no orchestration signal | `muse` | `user-directed` | `host-app-session` |
| `pending` | `grok` (`grok 1.0.89`) | Run one gstack-extend stage by hand in Grok from a terminal (`GROK_AGENT=1`) with no orchestration signal (unmarked Paseo ACP `terminal/create` still records `agent: null`, `no-harness`) | `grok` | `unknown` | `harness-unqualified` |
| `discharged` (Cursor support dropped 2026-11-21) | `cursor` (`cursor-agent 2026.11.19-f005e9d`) | Run one gstack-extend stage by hand in Cursor from a terminal (`CURSOR_AGENT=1`) with no orchestration signal | `cursor` | `unknown` | `harness-unqualified` |

## Harnesses and entrypoints that read `unknown`

Every harness goes through the same by-hand rule in `bin/lib/telemetry.py`
`run_mode()` ([Run mode](../telemetry.md#run-mode)): when no orchestration or
workspace-owner signal applies (rules 1 to 7) and a harness is detected without
a conflicting `--agent` override, one per-harness launch-surface reader maps raw
evidence from the detected session's own environment or its own named regular
session log (bounded to the first 64 KiB, `LOG_HEAD_BYTES`) onto the shared
launch-surface classes `terminal` (`run_mode_source: "terminal-session"`, or
Claude's legacy `"cli"`), `host-app` (`run_mode_source: "host-app-session"`, or
Claude's legacy `"paseo-entrypoint"`), `other` (`entrypoint-unqualified`), or no
class (`entrypoint-unavailable`). A harness with no qualifying evidence has no
reader and records `unknown` / `harness-unqualified`.

The Codex reader uses the rollout creation header for the named thread. Codex
CLI 0.170.0 appends on resume without writing a fresh header. A launcher using
`codex exec resume` must supply the orchestration signal because the header
alone cannot identify the current client. See [Run mode](../telemetry.md#run-mode).

Historical observations that motivated the shared rule and its per-harness
boundaries:

1. **In-repo `GROK_SESSION_ID` gate (fixed `2026-11-15`) and Grok launch-surface boundary (`grok 1.0.77` and `1.0.89`):**
   The owner identified a by-hand Grok `docs-ship` run in Paseo on host A at
   `2026-11-15T03:32:06Z` (`producer_version: "0.94.1"`): the raw row had
   `agent: null`, `run_mode: "unknown"`, and `run_mode_source: "no-harness"`.
   `detect()`, `harness_fingerprint()`, `grok_logs()`, and `grok_turns()` accept
   any valid `GROK_SESSION_ID` (`valid_session`) without requiring
   `GROK_AGENT=1` (while keeping a non-`"1"` `GROK_AGENT` profile name inert on
   its own). However, two upstream Grok boundaries remain at `grok 1.0.89` +
   `paseo 0.16.1`:
   - *Unmarked ACP `terminal/create`:* Paseo registers Grok as an ACP provider
     (`grok acp`) with `clientCapabilities.terminal: true`. When Grok runs a
     shell command in ACP mode (`xai-grok-shell-terminal`), its
     `CreateTerminalRequest.env` forwards only `CARGO_TERM_PROGRESS_WHEN`,
     `CARGO_TERM_PROGRESS_WIDTH`, and `NPM_CONFIG_PROGRESS` to Paseo's
     `ACPAgentClient.createTerminal`, omitting both `GROK_SESSION_ID` and
     `GROK_AGENT=1`. Simultaneously, Paseo's workspace catalog probe
     (`fetchCatalog`) invokes `grok acp` (`session/new`) whenever a workspace is
     opened for any provider, leaving zero-turn session directories under
     `$GROK_HOME/sessions/<encoded-cwd>/` even in Claude or Codex workspaces.
     Neither `PASEO_AGENT_ID` nor `$GROK_HOME/sessions/` directory presence can
     identify a Grok session when `CreateTerminalRequest.env` omits Grok's
     markers, so that path records `agent: null`, `unknown` / `no-harness`.
   - *No positive launch-surface evidence when detected:* When Grok is detected
     via `GROK_AGENT=1` or `GROK_SESSION_ID`, `GROK_AGENT=1` is exported on both
     interactive and headless shell runs, and `$GROK_HOME/sessions/<encoded-cwd>/<session>/summary.json`
     records `session_kind` only for `"headless"` and `"subagent"` while
     omitting `session_kind` on both interactive CLI and ACP (`grok acp`)
     sessions. Because absence of a headless marker is not positive launch
     evidence when the field is omitted across interactive and ACP sessions,
     Grok has no launch-surface reader and records `run_mode: "unknown"` /
     `run_mode_source: "harness-unqualified"`.
2. **Muse detection (`2026-11-18`) and host-app qualification (`2026-11-19`):**
   On `2026-11-18`, the owner ran `full-review` (started `17:52:10Z`) and
   `gstack-extend-upgrade` (started `18:18:53Z`) by hand in Muse, launched from
   the Paseo app on host C (the same host ledger that holds the
   `2026-11-09T16:22:59Z` host C row above), with `producer_version: "0.101.0"`.
   Those pre-detection rows recorded `agent: null`, `run_mode: "unknown"`, and
   `run_mode_source: "no-harness"`, and retain their original values. Track 89B
   added `MUSE_SESSION_ID` detection (`0.102.0`), and the shared by-hand rule
   now reads `session.opened.observed` `payload.record.client_info_name` from
   the detected session's own named top-level `session.jsonl`, mapping
   `"paseo"` (through `HOST_APP_CLIENTS`) to `host-app` (`user-directed` /
   `host-app-session`).

When no primary orchestration signal (`session-kind`, `work-item`,
`run-mode-env`) applies, `run_mode` is `"unknown"` for every case below, with
`run_mode_source` having one shared meaning across all harnesses:

| Case | `run_mode` | `run_mode_source` |
|---|---|---|
| Non-empty `GSTACK_EXTEND_RUN_MODE` other than `orchestrated` | `unknown` | `unrecognized-run-mode-env` |
| Non-default absolute `GSTACK_HOME` (different from `$HOME/.gstack`) | `unknown` | `launcher-state-root` |
| Malformed non-empty `GSTACK_SESSION_KIND` or `GSTACK_EXTEND_WORK_ITEM`, or relative non-empty `GSTACK_HOME` | `unknown` | `malformed-signal` |
| Any non-empty `GSTACK_EXTEND_WORKSPACE_OWNER` (even whitespace-only or malformed) with no orchestration signal | `unknown` | `host-managed-workspace` |
| No harness detected, regardless of a final `--agent` override | `unknown` | `no-harness` |
| Detected and final harness differ (an `--agent` override to or from another harness), or the detected harness has no launch-surface reader (`grok`, `cursor`) | `unknown` | `harness-unqualified` |
| Detected harness has a launch-surface reader (`claude`, `codex`, `muse`), and its launch-surface evidence is missing, empty, unclean, unreadable, past the 64 KiB `LOG_HEAD_BYTES` head-read bound, reached through a link inside the harness's configured home or under a relative one, from a non-regular file, or the reader raised (`CLAUDE_CODE_ENTRYPOINT` missing/unclean for Claude; rollout or `session_meta` missing/malformed/over-bound or naming another thread, or a relative `CODEX_HOME`, for Codex; `session.jsonl`, `session.opened.observed` or `client_info_name` missing/malformed/over-bound for Muse, including `tui`/`exec` opens and pre-`#23124` `1.4.14` logs) | `unknown` | `entrypoint-unavailable` |
| Detected harness has a launch-surface reader (`claude`, `codex`, `muse`), and its launch-surface evidence names a headless, SDK, exec, subagent, or unlisted client surface (`sdk-*`, `acp`, `claude-desktop`, `claude-vscode`, `remote-daemon`, `github-action`, lowercase `paseo`, … for Claude; `("codex_exec", "exec")`, subagent object `source`, or unlisted `(originator, source)` for Codex; clean `client_info_name` not in `HOST_APP_CLIENTS` for Muse) | `unknown` | `entrypoint-unqualified` |

## Per-harness launch inventory

### `2026-11-19` inventory and launch-surface qualification

Inspected on host B (Omarchy Linux, `gstack-extend 0.103.0`) across the
installed harness binaries (`claude 2.1.328`, `codex-cli 0.170.0`,
`grok 1.0.89`, `cursor-agent 2026.11.19-f005e9d`,
`Muse Code 1.4.24 (1.4.24-R9131.1)`) and workspace host (`paseo 0.16.1`). No new
harness sessions were launched to collect evidence; structural field tallies and
key names were read from existing local session logs and binary string tables,
and runtime environment markers that cannot be observed without a launch reuse
the dated `2026-11-15` inventory below (re-checked against the installed binary
launchers and string tables). No prompt text, session identifiers, account
identifiers, local user paths, or credential/auth files were read or recorded.

Qualification rule (applied identically to every harness): raw evidence maps to
`terminal` (`terminal-session`, or Claude's legacy `cli`) or `host-app`
(`host-app-session`, or Claude's legacy `paseo-entrypoint`) only when it is read
from the detected session's own environment or its own named regular session log
(within the first 64 KiB, `LOG_HEAD_BYTES`), positively identifies that launch
surface, and differs from that harness's headless, SDK, exec, and subagent
surfaces (`other` → `entrypoint-unqualified`). Absence of a headless marker is
not positive evidence when the field is omitted on non-interactive or ACP
sessions. A value that names the harness's own interactive client maps to
`terminal` even when a host app drove that client without naming itself in the
log. Client names map to `host-app` only through the shared host table
`HOST_APP_CLIENTS` (exact case-sensitive match), except Claude's
legacy `CLAUDE_CODE_ENTRYPOINT=Paseo` mapping.

| Harness and version | Surfaces and local logs inspected | Environment and session-log launch evidence observed | Raw evidence → shared class mapping and reason | Qualification status under shared rule |
|---|---|---|---|---|
| `claude 2.1.328` | Reused `2026-11-15` environment inventory (`claude` terminal CLI, Paseo `ClaudeAgentClient` `claude-code-entrypoint-env` plugin, SDK workers) | Environment: `CLAUDECODE="1"`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_ENTRYPOINT`. Session log: `$CLAUDE_CONFIG_DIR/projects/<slug>/<session>.jsonl` | `CLAUDE_CODE_ENTRYPOINT`: `"cli"` → `terminal` (`user-directed` / legacy `cli`); `"Paseo"` → `host-app` (`user-directed` / legacy `paseo-entrypoint`); any other clean value (`"sdk-cli"`, `"sdk-ts"`, `"sdk-py"`, `"acp"`, `"claude-desktop"`, `"claude-vscode"`, `"remote-daemon"`, `"github-action"`, lowercase `"paseo"`, …) → `other` (`unknown` / `entrypoint-unqualified`); missing, empty or unclean value → no class (`unknown` / `entrypoint-unavailable`) | Qualified for `terminal` (`cli`) and `host-app` (`paseo-entrypoint`); real by-hand readbacks recorded above |
| `codex-cli 0.170.0` | 1,116 local rollouts under `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*-<thread>.jsonl`; `codex-cli 0.170.0` binary (`login/src/auth/default_client.rs`) and `paseo 0.16.1` `codex-app-server-agent.js`; runtime environment markers reused from `2026-11-15` inventory | Environment: `CODEX_THREAD_ID`, `CODEX_CI`, `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED`, `CODEX_MANAGED_BY_NPM`/`CODEX_MANAGED_BY_BUN` (plus `PASEO_AGENT_ID`, `PASEO_AGENT_CWD` under Paseo); no `CODEX_ENTRYPOINT`. Session log: every rollout's first line is `type="session_meta"` (max first-line length 29,296 bytes, within the 64 KiB head bound). Observed `(payload.originator, payload.source, payload.thread_source)` tallies across 1,116 rollouts: `("codex_cli_rs", {"subagent": ...}, "guardian_review")` 921; `("codex_exec", "exec", "user")` 148; `("codex_cli_rs", {"subagent": ...}, "subagent")` 23; `("codex_exec", {"subagent": ...}, "subagent")` 18; `("codex_cli_rs", "vscode", null)` 5 (`0.169.0` and `0.170.0` Paseo worktree checkouts; 747 across TUI and app-server rollouts in the `2026-11-15` inventory); `("codex-tui", "vscode", "user")` 1 (`0.166.0` non-Paseo repo checkout). Paseo's `CodexAppServerAgentClient` passes `clientInfo.name="codex_app_server_daemon"` (`CODEX_NON_ORIGINATING_APP_SERVER_CLIENT_INFO`), which Codex treats as non-originating so app-server sessions keep Codex's default CLI originator `"codex_cli_rs"` and `source="vscode"` | `(payload.originator, payload.source)` in `session_meta`: `("codex_cli_rs", "vscode")` and `("codex-tui", "vscode")` → `terminal` (`user-directed` / `terminal-session`, naming Codex's own interactive client and differing from `codex exec` and subagent/guardian-review rollouts; also covers Paseo app-server sessions because Paseo uses Codex's non-originating daemon client name); `("codex_exec", "exec")`, any dict `source` (`{"subagent": ...}`), or any other clean `(originator, source)` → `other` (`unknown` / `entrypoint-unqualified`); missing, symlinked, over-bound or malformed rollout/`session_meta` → no class (`unknown` / `entrypoint-unavailable`) | Fixture-qualified for `terminal` (`terminal-session`); `host-app` unqualified (shares `terminal` evidence); post-merge by-hand readback pending |
| `Muse Code 1.4.24 (1.4.24-R9131.1)` | 31 top-level session logs under `$XDG_DATA_HOME/muse/sessions/YYYY/MM/DD/<session>/session.jsonl` and 34 subagent logs under `<session>/subagent/<child>/session.jsonl`; `muse-bin-1.4.24-R9131.1` embedded schema table; runtime environment markers reused from `2026-11-15` / `2026-11-18` inventory | Environment: `MUSE_SESSION_ID`, `MUSE_THREAD_ID`, `MUSE_TOOL_USE_ID` (plus `PASEO_AGENT_ID`, `PASEO_AGENT_CWD` under Paseo); no `MUSE_ENTRYPOINT` in launcher or binary. Session log: all 31 top-level logs contain `payload_type="session.opened.observed"` (`payload.kind="session_opened"`, ending within the first 7,702 bytes of every log, within the 64 KiB head bound); 0 of 34 subagent logs contain `session.opened.observed`. In 29 of 31 top-level logs (`build.semver="1.4.23"` in 5, `build` omitted in 24), `payload.record.client_info_name` is `"paseo"` (`client_info_version="1"`, `workspace_kind="git"`). In 2 of 31 top-level logs (`build.semver="1.4.14"`, accompanied by `runtime.session.route_facts`), `client_info_name` is absent. Per `muse-bin-1.4.24-R9131.1` (`session.opened.observed.client_info_name (#23124, MSP serve open boundary)`), `client_info_name` records the MSP serve connection's negotiated `initialize` `clientInfo.name` and is omitted on both interactive `tui` and headless `exec` opens, pre-`#23124` (`1.4.14`) logs, and empty wire values | `payload.record.client_info_name` in `session.opened.observed`: value in `HOST_APP_CLIENTS` (`"paseo"`) → `host-app` (`user-directed` / `host-app-session`, positively identifying an orchestrator-host MSP session and differing from subagent logs, `tui`/`exec` opens, and unlisted MSP clients); any other clean non-empty string `client_info_name` → `other` (`unknown` / `entrypoint-unqualified`); absent `client_info_name` (including `tui`/`exec` opens and `1.4.14` logs), missing `session.opened.observed`, or missing/symlinked/over-bound log → no class (`unknown` / `entrypoint-unavailable`) | Fixture-qualified for `host-app` (`host-app-session`); `terminal` unqualified (`client_info_name` is omitted on both `tui` and `exec` opens); post-merge by-hand readback pending |
| `grok 1.0.89` | 670 local `summary.json` and `events.jsonl` session directories under `$GROK_HOME/sessions/<url-encoded-cwd>/<session>/`; `grok 1.0.89` binary (`xai-grok-shell-terminal/src/adapter.rs`, `xai-grok-shell/src/agent/mvp_agent/session_setup.rs`); runtime environment markers reused from `2026-11-15` inventory | Environment: local shell (`xai-grok-tools`) exports `GROK_AGENT="1"`; hook/MCP spawners export `GROK_SESSION_ID`; ACP `terminal/create` (`xai-grok-shell-terminal/src/adapter.rs` in `grok 1.0.89`) still forwards only `CARGO_TERM_PROGRESS_WHEN`, `CARGO_TERM_PROGRESS_WIDTH`, and `NPM_CONFIG_PROGRESS`, omitting `GROK_SESSION_ID` and `GROK_AGENT`. Session log: across 670 `summary.json` files (`agent_name="grok-build-plan"` in 665, `"general-purpose"` in 1, absent in 4), `session_kind` is `"headless"` in 1, `"subagent"` in 1, and omitted in 668 (436 zero-message sessions from Paseo's `fetchCatalog` `grok acp` probe, 36 with messages and 0 trace turns, 196 with trace turns). `events.jsonl` records no launch-surface or client-name field | No qualifying evidence: `GROK_AGENT="1"` does not separate interactive TUI from headless runs, `summary.json` writes `session_kind` only for `"headless"` and `"subagent"` while omitting it on both interactive CLI and ACP (`grok acp`) sessions, and ACP `terminal/create` exports no Grok marker (`no-harness`) | Unqualified (no reader; detected runs record `unknown` / `harness-unqualified`, unmarked ACP `terminal/create` runs record `unknown` / `no-harness`); post-merge by-hand readback pending |
| `cursor-agent 2026.11.19-f005e9d` | Installed `cursor-agent` launcher and `index.js` bundle (`2026.11.19-f005e9d`), `paseo 0.16.1` `cursor-acp-agent.js`, and `.cursor/projects/*/agent-transcripts/` (0 local transcripts present); runtime environment markers reused from `2026-11-15` inventory | Environment: launcher exports `CURSOR_INVOKED_AS="$(basename "$0")"` (`"cursor-agent"` or `"agent"`); runtime exports `CURSOR_AGENT="1"`, `CURSOR_CONVERSATION_ID`, `CURSOR_REQUEST_ID`, `CURSOR_TRACE_ID`, `CURSOR_COMPILE_CACHE_IPC_PORT`, `CURSOR_AGENT_STORE*`; no `CURSOR_ENTRYPOINT` or client-name variable exists in `2026.11.19-f005e9d`. Session log: `.cursor/projects/<slug>/agent-transcripts/` records only `role` and `message.content` | No qualifying evidence: `CURSOR_AGENT="1"`, `CURSOR_CONVERSATION_ID`, and `CURSOR_INVOKED_AS` are identical across interactive terminal use, Paseo ACP (`cursor-agent acp`), and headless runs, and transcripts record no launch metadata | Unqualified (no reader; detected runs record `unknown` / `harness-unqualified`); post-merge by-hand readback pending |

### `2026-11-15` inventory (historical)

Inspected on host B (Omarchy Linux, `gstack-extend 0.94.2`) across the
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
| `codex-cli 0.169.0` | Terminal CLI (`codex`), non-interactive (`codex exec`), Paseo app-server (`paseo 0.15.2` `CodexAppServerAgentClient` → `codex app-server`) | `CODEX_THREAD_ID` (`valid_session` UUID shape), `CODEX_CI`, `CODEX_SANDBOX`, `CODEX_SANDBOX_NETWORK_DISABLED`, `CODEX_MANAGED_BY_NPM`/`CODEX_MANAGED_BY_BUN` (installer origin only). Under Paseo, `PASEO_AGENT_ID` and `PASEO_AGENT_CWD` are also present | `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*-<thread>.jsonl`: `session_meta` (`payload.id`, `payload.timestamp`, `payload.cwd`, `payload.originator`, `payload.cli_version`, `payload.source`, `payload.model_provider`) and `turn_context` (`payload.model`, `payload.effort`). Observed `(originator, source)` pairs across 798 local logs on host B: `("codex_cli_rs", "vscode")` (747), `("codex_exec", "exec")` (43), and subagent review/spawn entries (8) | Qualified (`agent="codex"`, `model` and `effort` detected) | Unqualified (`run_mode="unknown"`, `run_mode_source="harness-unqualified"`; neither `CODEX_*` env vars nor `session_meta.payload.originator`/`source` distinguishes a by-hand session from an orchestrated worker, and Paseo passes hardcoded `clientInfo.name="codex_app_server_daemon"`) |
| `cursor-agent 2026.11.13-eacade1` | Terminal CLI (`cursor-agent`), Paseo ACP (`paseo 0.15.2` `GenericACPAgentClient` → `cursor-agent acp`) | `CURSOR_AGENT="1"`, `CURSOR_CONVERSATION_ID` (`valid_session` shape), `CURSOR_INVOKED_AS` (`"cursor-agent"` or `"agent"`), `CURSOR_COMPILE_CACHE_IPC_PORT`, `CURSOR_TRACE_ID` | `.cursor/projects/<slug>/agent-transcripts/<id>.txt` or `<id>/<id>.jsonl`: `role` and `message.content` only (no model, effort, or entrypoint metadata) | Qualified when `CURSOR_AGENT` or `CURSOR_CONVERSATION_ID` is present (`agent="cursor"`; model/effort remain `null` unless supplied via flags or `GSTACK_EXTEND_MODEL`/`GSTACK_EXTEND_EFFORT`) | Unqualified (`run_mode="unknown"`, `run_mode_source="harness-unqualified"`; neither `CURSOR_*` env vars nor agent transcripts expose an entrypoint distinguishing interactive by-hand use from ACP or headless worker launches) |
| `muse 1.4.23` | Paseo-launched sessions (`client_info_name="paseo"` in the session log; Paseo version `unknown`), inspected `2026-11-18` on an Omarchy Linux machine; terminal launch not inspected at runtime | `MUSE_SESSION_ID` (`valid_session` UUID-shaped and equal to the session directory name), `MUSE_THREAD_ID` (equal to the session id in the observed main session), `MUSE_TOOL_USE_ID` (changes per tool call), and under Paseo `PASEO_AGENT_ID` and `PASEO_AGENT_CWD` (observed in a filtered environment listing captured by a Paseo-launched Muse 1.4.20 session on `2026-11-15`; the 1.4.23 binary still names `MUSE_SESSION_ID` and `MUSE_THREAD_ID` for shell launches and contains no `CLAUDECODE` or `CLAUDE_CODE_SESSION_ID`) | `$XDG_DATA_HOME/muse/sessions/YYYY/MM/DD/<session>/session.jsonl` (default `$HOME/.local/share`), with subagent logs at `<session>/subagent/<child>/session.jsonl`: `recorded_at` (epoch microseconds) and `payload_type`; `runtime.session` `model_completed` (`model`, `usage`); `runtime.session.metadata` (`model_id`, `provider_id`, `build.semver`); `session.opened.observed` (`client_info_name`); no effort value (only the key `meta.reasoning.effort` appears) | Detection supported when a valid `MUSE_SESSION_ID` is present (`agent="muse"`, `model` detected from `model_completed`, `effort` `null`; fixture-qualified) | Unqualified (`run_mode="unknown"`, `run_mode_source="harness-unqualified"`; Muse exports no entrypoint variable, no terminal-launch log was available to qualify `client_info_name`, and Paseo launches both by-hand and orchestrated sessions) |

## Drafted upstream requests

**No upstream request is filed**, per the owner's standing direction
(`2026-11-15` and `2026-11-18`). Harnesses and launch paths that expose no
qualifying launch-surface evidence (`grok`, `cursor`, Muse terminal opens, and
Grok's unmarked ACP `terminal/create` path) are documented above as recording
`unknown` (`harness-unqualified`, `entrypoint-unavailable`, or `no-harness`).
The `2026-11-15` drafts below are retained as historical notes on those upstream
boundaries, with items made moot by the `2026-11-19` shared rule marked:

1. **Grok CLI (`grok` / `xai-grok-shell-terminal`) — forward `GROK_SESSION_ID` and `GROK_AGENT=1` in ACP `terminal/create` requests and record launch entrypoint (not filed; remains the reason Grok reads `no-harness` under ACP `terminal/create` and `harness-unqualified` when detected):**
   - *Missing signal:* `CreateTerminalRequest.env` in `xai-grok-shell-terminal/src/adapter.rs` currently forwards only `CARGO_TERM_PROGRESS_WHEN`, `CARGO_TERM_PROGRESS_WIDTH`, and `NPM_CONFIG_PROGRESS`, omitting `GROK_SESSION_ID` and `GROK_AGENT=1`. Neither the shell environment nor `$GROK_HOME/sessions/<encoded-cwd>/<session>/summary.json` records how Grok was entered (for example, `GROK_ENTRYPOINT=cli|acp|<clientInfo.name>`).
   - *Where commands/hooks need it:* Every command spawned via ACP `terminal/create` and every local shell command should inherit `GROK_SESSION_ID=<session-uuid>` and `GROK_AGENT=1` (matching `xai-grok-hooks` and `xai-grok-mcp`), plus a launch entrypoint variable or `summary.json` `entrypoint`/`client_name` field populated from the ACP `initialize` handshake's `clientInfo.name` (or `"cli"` for interactive TUI sessions).
   - *Why presence-only evidence is insufficient:* Paseo's `fetchCatalog` probe calls `grok acp` (`session/new`) whenever any workspace opens, creating zero-turn session directories under `$GROK_HOME/sessions/<encoded-cwd>/` even for Claude and Codex workspaces. Guessing Grok from `$GROK_HOME/sessions/` directory existence or `PASEO_AGENT_ID` would misattribute unmarkered runs in other harnesses and conflate sibling sessions.

2. **Paseo (`@getpaseo/server`) — provider-neutral launch entrypoint and ACP terminal session markers (not filed; moot for Muse and Codex under the `2026-11-19` shared rule, still relevant to Grok and Cursor ACP sessions):**
   - *Missing signal:* Paseo's `claude-code-entrypoint-env` plugin (`CLAUDE_CODE_ENTRYPOINT=Paseo`) only runs when `request.provider === "claude"`. For ACP providers (`grok`, `cursor`, `opencode`) and `codex`, Paseo's `ACPAgentClient.createTerminal` and `CodexAppServerAgentClient` do not export a provider entrypoint or the ACP session's harness marker.
   - *Where commands/hooks need it:* In `ACPAgentClient.createTerminal` (and provider launch contexts), inject provider-specific or provider-neutral entrypoint metadata alongside the ACP session identifier when spawning terminal commands on behalf of an ACP session.
   - *Why presence-only evidence is insufficient:* `PASEO_AGENT_ID` is exported on every Paseo-managed agent regardless of whether a human launched it in the Paseo desktop app or an orchestrator spawned a worker through Paseo (`docs/telemetry.md#run-mode`), and `PASEO_AGENT_ID` alone does not identify which provider (`claude`, `grok`, `codex`, or `cursor`) owns the session.

3. **Codex CLI (`codex-cli` / `codex app-server`) — propagate `clientInfo.name` or an explicit entrypoint variable to child commands (not filed; moot for by-hand classification under the `2026-11-19` shared rule, which classifies `session_meta` `("codex_cli_rs", "vscode")` and `("codex-tui", "vscode")` as `user-directed` / `terminal-session` when no orchestration signal is set):**
   - *Missing signal:* `CODEX_THREAD_ID` identifies the rollout thread, but no `CODEX_ENTRYPOINT` variable is exported to child shells, and rollout `session_meta.payload` records `(originator, source)` only as `("codex_cli_rs", "vscode")` (for both interactive TUI and app-server sessions) or `("codex_exec", "exec")`.
   - *Where commands/hooks need it:* Export `CODEX_ENTRYPOINT` (for example, `cli`, `exec`, `app-server:<clientInfo.name>`) to child shell commands and record the app-server `initialize` `clientInfo.name` in `session_meta.payload`.
   - *Why presence-only evidence is insufficient:* `CODEX_THREAD_ID` and `$CODEX_HOME/sessions/` rollout files are present on both interactive terminal sessions, Paseo app-server sessions, and orchestrated workers, so the orchestration contract requires orchestrators to set a run-mode signal (`GSTACK_EXTEND_RUN_MODE=orchestrated`, `GSTACK_EXTEND_WORK_ITEM`, or `GSTACK_SESSION_KIND=spawned|unattended`).

4. **Cursor Agent CLI (`cursor-agent`) — export an entrypoint signal and forward markers in ACP terminals (not filed; remains the reason Cursor reads `harness-unqualified`):**
   - *Missing signal:* `CURSOR_AGENT=1`, `CURSOR_CONVERSATION_ID`, and `CURSOR_INVOKED_AS` do not distinguish interactive terminal use, IDE agent panes, ACP sessions (`cursor-agent acp`), or headless workers, and `.cursor/projects/<slug>/agent-transcripts/` omits model, effort, and entrypoint fields.
   - *Where commands/hooks need it:* Export `CURSOR_ENTRYPOINT` (or equivalent in `CURSOR_INVOKED_AS` / ACP `terminal/create` environment) and record `model`, `effort`, and `entrypoint` in the session transcript metadata.
   - *Why presence-only evidence is insufficient:* `CURSOR_AGENT=1` and `CURSOR_CONVERSATION_ID` are identical across interactive and automated CLI invocations, so treating them as by-hand proof would misclassify unflagged automated Cursor runs as `user-directed`.
