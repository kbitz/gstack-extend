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
`run_mode: "unknown"`, and `run_mode_source: "no-harness"`. This is a Grok
detection gap, recorded in [TODOS](../TODOS.md); it is not an observed
`harness-unqualified` row. In contrast, when Grok, Codex or Cursor is detected,
by-hand mode remains `unknown` with source `harness-unqualified` by design
until a trustworthy launch signal exists. Only `CLAUDE_CODE_ENTRYPOINT`
currently proves the qualified Claude by-hand launch types.

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
