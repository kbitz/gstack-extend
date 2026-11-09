# Hand-use telemetry qualification

Status: pending — no real runs recorded

This record tracks real-run qualification for stage-runs v4 `run_mode` and
`run_mode_source` ([Run mode](../telemetry.md#run-mode)). Fixtures in
`tests/telemetry.test.ts` and `tests/telemetry-contract.test.ts` verify the
classifier and report helper against synthetic state; they do not establish
real by-hand capture on the owner's machines.

## What counts

Qualification requires all of the following real runs, read back from the
owner's stage-runs ledgers without fabricating rows:

1. **By-hand runs on each of the owner's two machines** (macOS and Omarchy Linux):
   - In the Paseo app (`CLAUDE_CODE_ENTRYPOINT=Paseo`, no orchestration or workspace-owner signal set), recording `run_mode: "user-directed"`, `run_mode_source: "paseo-entrypoint"`.
   - Where the owner also runs stages from Claude Code's terminal (`CLAUDE_CODE_ENTRYPOINT=cli`, no orchestration or workspace-owner signal set), recording `run_mode: "user-directed"`, `run_mode_source: "cli"`.
2. **One orchestrated run of an interactive stage** (`/plan-track`, `/roadmap`, or `/project-spec`) launched with `GSTACK_EXTEND_RUN_MODE=orchestrated`, recording `run_mode: "orchestrated"`, `run_mode_source: "run-mode-env"`.

An orchestrator that launches workers through Paseo or Claude's `cli`
entrypoint must set `GSTACK_EXTEND_RUN_MODE=orchestrated` (or
`GSTACK_EXTEND_WORKSPACE_OWNER`, `GSTACK_EXTEND_WORK_ITEM`, or
`GSTACK_SESSION_KIND=spawned|unattended`), or its workers are counted as hand
use (`user-directed`).

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

| Date | Machine (host label) | OS | Harness and version | gstack-extend version | How launched | run_mode | run_mode_source |
|---|---|---|---|---|---|---|---|

## Harnesses and entrypoints that read `unknown`

When no primary orchestration signal (`session-kind`, `work-item`,
`run-mode-env`) applies, `run_mode` is `"unknown"` for every case below, with
`run_mode_source` naming the exact reason:

| Case | `run_mode` | `run_mode_source` |
|---|---|---|
| Non-empty `GSTACK_EXTEND_RUN_MODE` other than `orchestrated` | `unknown` | `unrecognized-run-mode-env` |
| Non-default absolute `GSTACK_HOME` (different from `$HOME/.gstack`) | `unknown` | `launcher-state-root` |
| Malformed non-empty `GSTACK_SESSION_KIND` or `GSTACK_EXTEND_WORK_ITEM`, or relative non-empty `GSTACK_HOME` | `unknown` | `malformed-signal` |
| Any non-empty `GSTACK_EXTEND_WORKSPACE_OWNER` (even whitespace-only or malformed) with no orchestration signal | `unknown` | `host-managed-workspace` |
| No harness detected and no `--agent` override (`agent: null`) | `unknown` | `no-harness` |
| Non-Claude harness (`codex`, `cursor`, `grok`, or `--agent` override to/from another harness) | `unknown` | `harness-unqualified` |
| Detected Claude with missing, empty, or unclean `CLAUDE_CODE_ENTRYPOINT` | `unknown` | `entrypoint-unavailable` |
| Detected Claude with any `CLAUDE_CODE_ENTRYPOINT` other than `cli` or `Paseo` (`sdk-cli`, `sdk-ts`, `sdk-py`, `acp`, `claude-desktop`, `claude-vscode`, `remote-daemon`, `github-action`, …) | `unknown` | `entrypoint-unqualified` |
