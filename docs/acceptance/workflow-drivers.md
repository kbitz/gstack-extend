# Two-Driver Workflow Qualification Record

Date: `2026-11-22`
Base revision: `8077fa203777b3e1f6f6367288096c5b55a8790f` (`v0.109.0`, after Track 92A PRs `#289` `413842a` and `#290` `8077fa2`)
Status: **open — `0` pass, `23` hold** (`14` `WD-*` rows and `9` `DS-*` rows pending owner by-hand sessions and remaining post-92A external-orchestrator runs)

## Qualification Boundary

This record tracks real installed-agent qualification for Track 93A across two drivers — the owner running stages by hand and one real external orchestrator — supporting [SPEC](../SPEC.md) O3.3 and O4.5 while reading back O6.1 run modes ([telemetry](../telemetry.md#run-mode)).

- **No checkpoint awarded:** this file supplies evidence only and awards no [SPEC](../SPEC.md) O3, O4, or O6 acceptance checkpoint. Owner-confirmed acceptance lives in [PROGRESS.md](../PROGRESS.md#acceptance).
- **No unexercised combination claimed:** every combination not executed and verified on `producer_version >= 0.109.0` remains explicitly marked `hold`. Static prose checks, unit tests, and synthetic fixtures are contract checks, not installed-agent acceptance.
- **Pre-92A runs do not pass post-92A rows:** earlier telemetry runs (`producer_version < 0.109.0`) are cited only as historical context ([hand-use-telemetry.md](hand-use-telemetry.md)) or ordinary-path timing comparators ([docs-ship-timing.md](docs-ship-timing.md)), never as post-92A qualification passes.
- **Operational constraints honored:** no unattended release or merge, no consumer-repository edits, no new model or provider spend, and no acceptance inferred from an idle agent status or summary prose alone.

## Environment Provenance and Sanitization

Captured read-only on `2026-11-22` on the implementing host (`host B`, generic label matching [hand-use-telemetry.md](hand-use-telemetry.md)):

| Field | Observed Value (`2026-11-22`) | Notes |
|---|---|---|
| Operating system | `Linux` | Generic host labels (`host A`, `host B`, …); raw hostnames stay in local evidence |
| `gstack-extend` worktree `VERSION` | `0.109.0` (`8077fa203777b3e1f6f6367288096c5b55a8790f`) | Post-Track 92A (`#289` `413842a` fixed preamble + `#290` `8077fa2` two-host retirement) |
| Installed `gstack-extend` `VERSION` | `0.109.0` | Verified at installed `EXTEND_ROOT` |
| Installed upstream `gstack` `VERSION` | `1.102.2.0` | Read from installed upstream `gstack` `VERSION` |
| Bun runtime | `1.4.3` | Meets `>= 1.3.3` requirement |
| Supported install hosts | Claude Code (`2.1.330 (Claude Code)`), Codex (`codex-cli 0.171.0`) | Cursor and OpenCode retired in `v0.109.0` (`#290`); leftover host dirs emit `INSTALL_WARN ... reason=retired_host` until uninstalled ([installation.md](../installation.md)) |
| Additional installed owner harness | Muse (`Muse Code 1.4.25 (1.4.25-R9361.1)`) | Not an install host; tracked for telemetry readback in [hand-use-telemetry.md](hand-use-telemetry.md) |
| Workspace host contract | `GSTACK_EXTEND_WORKSPACE_OWNER` ([orchestration-contract.md](../orchestration-contract.md)) | Generic contract; Paseo is one documented provider; Conductor retired `2026-11-06` ([SPEC.md](../SPEC.md)) |

**Sanitization rules:** This record obeys Consumer independence and the [telemetry](../telemetry.md) / [workflow-handoffs](../workflow-handoffs.md) privacy bounds. Machines and external repositories appear only under generic labels (`host A`, `host B`, consumer repository A). No personal tooling names, private repository paths, `session_id` values, `work_item` IDs, raw hostnames, local home or evidence-root paths, or credentials appear here.

## Two-Driver Workflow Run Matrix (`WD-01`–`WD-11`)

Every row requires verified post-92A (`producer_version >= 0.109.0`, `schema_version: 4`) evidence read back via `gstack-extend-telemetry report --by-host --json` and the local host ledger's allowlisted fields (`started_at`, `duration_s`, `stage`, `outcome`, `agent`, `model`, `effort`, `producer_version`, `schema_version`, `workspace_host`, `run_mode`, `run_mode_source`, `questions`, `user_wait_s`, `resumes`, `user_signals_source`, `blocked_reason`).

| Row | Obligation (SPEC / Card) | Driver | Stages & Contract Anchors | Required Telemetry Readback (`v4`, `>= 0.109.0`) | Operator Interventions | Bound PR / Workspace & Artifact Evidence | Status |
|---|---|---|---|---|---|---|---|
| `WD-01` | Complete plan-to-ready-PR workflow (stop at ready PR without merging) | External orchestrator | `/plan-track` → `/implement` → `/review-and-prep`; H-A, H-B `review-and-prep/v1`, `stage-handoff/v1`, default `bin/review-state` recording, compact receipt | All stages `run_mode: "orchestrated"`, `producer_version >= 0.109.0`, `outcome: "success"` | `unknown` (pending) | Retained bound PR and host-managed workspace (no post-92A PR yet) | `hold — pending external orchestrator` |
| `WD-02` | Complete plan-to-authorized-release workflow | Owner by hand | `/plan-track` (or approved plan) → `/implement` → `/review-and-prep` → `/ship-and-land` with explicit live human merge approval | All stages `run_mode: "user-directed"`, `producer_version >= 0.109.0`, `outcome: "success"` | `unknown` (pending) | Bound PR merged only after explicit human approval | `hold — pending owner by-hand` |
| `WD-03` | Interrupted resume preserving uncommitted work and completed reviews | External orchestrator or Owner by hand | Fresh-session `/review-and-prep continue` on a `STOPPED` H-E cap stop or open `review-run-state.json` via `bin/review-state show`, or `/implement` run-dir reconciliation | Distinct per-session segments (`RESUMABLE` / `preamble --resume`), matching `run_mode`, `producer_version >= 0.109.0` | `unknown` (pending) | Same retained workspace and bound PR; prior completed review passes reused without loss | `hold — pending orchestrator or owner` |
| `WD-04` | Manual-testing pause and resume | Owner by hand | `/review-and-prep` H-C pause (`<!-- review-and-prep:paused:<sha> -->`) → `/pair-review` human-judgment items with H-C resume prompt and `stage-handoff/v1` → `/review-and-prep resume` | Pause segment `outcome: "blocked"`, `/pair-review` and resume segments `run_mode: "user-directed"`, `producer_version >= 0.109.0` | `unknown` (pending) | Bound draft PR retains pause marker until cleared by `/review-and-prep resume` | `hold — pending owner by-hand` |
| `WD-05` | `/full-review` finish and restart | Owner by hand | `/full-review` init → triage → Phase 6 finish (`phase: complete`, `session.yaml` under `<state-root>/projects/<slug>/full-review/`, `stage-handoff/v1`) → restart archiving finished session (or `PAUSE` → `outcome: "blocked"` → `/full-review resume`) | `stage: "full-review"`, `run_mode: "user-directed"`, `producer_version >= 0.109.0` | `unknown` (pending) | `session.yaml` completion and archive transition recorded in local evidence | `hold — pending owner by-hand` |
| `WD-06` | Explicit negative hold (no unauthorized advance or merge) | External orchestrator or Owner by hand | `/ship-and-land` refusing a draft, paused, or stopped PR (or release-only hand-back), `/review-and-prep` holding at `PAUSED`/`STOPPED`/`BLOCKED`, or human declining merge | Holding stage records `outcome: "blocked"` (or explicit non-merge exit), `producer_version >= 0.109.0` | `unknown` (pending) | Confirms idle status or summary prose never authorizes next stage or merge | `hold — pending orchestrator or owner` |
| `WD-07` | External-consumer handoff consumed from artifacts | External orchestrator | Consumer reads producer's `stage-handoff/v1`, H-A/H-B/H-E prompt, and bound PR/receipt artifacts directly from artifacts and live Git/GitHub bindings ([workflow-handoffs.md](../workflow-handoffs.md), [orchestration-contract.md](../orchestration-contract.md)) without manual prompt editing | Producer and consumer stages `run_mode: "orchestrated"`, `producer_version >= 0.109.0` | `unknown` (pending) | Artifact bindings and bound PR receipt match across producer and consumer | `hold — pending external orchestrator` |
| `WD-08` | Cross-session handoff | Both drivers | Fresh session in the retained workspace consumes prior stage's handoff prompt and artifact bindings, keeping the same bound PR | Distinct per-session `stage-runs` rows for both drivers (`orchestrated` and `user-directed`), `producer_version >= 0.109.0` | `unknown` (pending) | Same bound PR and retained workspace across sessions | `hold — pending both drivers` |
| `WD-09a` | Stale handoff (`FULL_CHECK_REQUIRED`) | External orchestrator or Owner by hand | Stale head, base, or receipt forces `FULL_CHECK_REQUIRED` with no silent trust reuse | `producer_version >= 0.109.0`, matching driver `run_mode` | `unknown` (pending) | Receipt records stale detection and full re-check | `hold — pending orchestrator or owner` |
| `WD-09b` | Partial verification handoff | External orchestrator or Owner by hand | `DONE_WITH_CONCERNS`, explicit `Checks not run:`, or unverified outside voice carried explicitly without claiming full pass | `producer_version >= 0.109.0`, matching driver `run_mode` | `unknown` (pending) | Handoff and receipt keep unrun or unverified checks explicit | `hold — pending orchestrator or owner` |
| `WD-09c` | Held handoff (`PAUSED`/`STOPPED`/`BLOCKED`) | External orchestrator or Owner by hand | Held handoff stops without advancing stage or marking PR ready | `outcome: "blocked"`, `producer_version >= 0.109.0` | `unknown` (pending) | PR remains draft/held; no next-stage launch authorized | `hold — pending orchestrator or owner` |
| `WD-10a` | Host-attribution check — by-hand without `GSTACK_EXTEND_WORKSPACE_OWNER` (v4 contract replacing retired Track 26A v2 check) | Owner by hand | By-hand stage on qualified harness without `GSTACK_EXTEND_WORKSPACE_OWNER`; confirms `PASEO_AGENT_ID` alone neither sets `workspace_host` nor blocks `user-directed` | `schema_version: 4`, `workspace_host: null`, `run_mode: "user-directed"`, `producer_version >= 0.109.0` | `unknown` (pending) | Local ledger readback on qualified harness (`claude`, `codex`, or `muse`) | `hold — pending owner by-hand` |
| `WD-10b` | Host-attribution check — host-owned launch exporting `GSTACK_EXTEND_WORKSPACE_OWNER=<label>` (v4 contract) | External orchestrator (or host-owned launch) | Stage launched with `GSTACK_EXTEND_WORKSPACE_OWNER=<label>` alongside an orchestration signal; stages perform no branch or worktree create, rename, switch, or delete | `schema_version: 4`, `workspace_host: "<label>"` (1–200 printable non-blank), `run_mode: "orchestrated"`, `producer_version >= 0.109.0` | `unknown` (pending) | Orchestrator currently leaves `workspace_host: null` on `2026-11-22`; Conductor (`2026-11-06`) and v2 `host_agent_id` (`v0.77.0`) are retired | `hold — pending orchestrator export of GSTACK_EXTEND_WORKSPACE_OWNER` |
| `WD-11` | Telemetry readback and operator-intervention accounting | Both drivers | `gstack-extend-telemetry report --by-host --json` proves owner runs read `user-directed` and orchestrated runs read `orchestrated` (never `user-directed`), with per-run operator interventions separating expected approvals/triage from workarounds/retries | Both `user-directed` and `orchestrated` post-92A (`>= 0.109.0`) rows verified in `report --by-host --json` | `unknown` (pending) | Overlaps Track 92C pending Codex/Muse readbacks in [hand-use-telemetry.md](hand-use-telemetry.md) without double-counting pre-92A runs | `hold — pending both drivers` |

**Note on Track 26A host-attribution translation (`WD-10a` / `WD-10b`):** Track 26A (`v0.37.0.0`) originally deferred v2 Paseo/Conductor attribution (`PASEO_AGENT_ID` / `CONDUCTOR_SESSION_ID` → `workspace_host` + `host_agent_id`). Conductor support was dropped on `2026-11-06` ([SPEC.md](../SPEC.md)), and `v0.77.0` (`93a55c4`) moved `stage-runs` to `schema_version: 4`, removed `host_agent_id`, stopped reading `PASEO_AGENT_ID` / `CONDUCTOR_SESSION_ID`, and populated `workspace_host` solely from `GSTACK_EXTEND_WORKSPACE_OWNER` ([telemetry.md](../telemetry.md#run-mode)). `WD-10a` and `WD-10b` qualify that live v4 contract.

## Verified Post-92A Observations (`2026-11-22`)

Read-only inspection of `gstack-extend-telemetry report --by-host --json` (`files: read=5, unreadable=0; rows: counted=1239, routed=0, malformed=0, invalid=0, unsupported=0`), local `stage-runs/*.jsonl` ledgers, and GitHub PR history on `2026-11-22` found:

- **GitHub PRs atop `8077fa2` (`v0.109.0`, merged `2026-11-22T06:19:49Z`):** `0` open or merged post-92A PRs at implementation time (Track 93B has not opened or merged a PR yet).
- **Post-92A `stage-runs` rows (`producer_version >= 0.109.0`):** `3` rows, all on `host B` (Linux), `producer_version: "0.109.0"`, `schema_version: 4`, `run_mode: "orchestrated"`, `run_mode_source: "session-kind"`, `user_signals_source: "orchestrated"`, `outcome: "success"`, `workspace_host: null`, `agent: null`, `model: null`, `effort: null`, `questions: null`, `user_wait_s: null`, `resumes: null`, `blocked_reason: null`:
  1. `2026-11-22T12:51:48Z` — stage `roadmap`, `duration_s: 912`, `outcome: "success"`.
  2. `2026-11-22T12:53:31Z` — stage `plan-track`, `duration_s: 628`, `outcome: "success"`.
  3. `2026-11-22T12:58:41Z` — stage `plan-track`, `duration_s: 556`, `outcome: "success"`.
- **Qualification impact:** `0` post-92A `user-directed` rows and `0` post-92A `implement`, `review-and-prep`, `pair-review`, `full-review`, `ship-and-land`, or `docs-ship` rows exist yet. The three observed orchestrated `roadmap`/`plan-track` rows confirm `v0.109.0` fixed-preamble `session-kind` run-mode recording and confirm `workspace_host: null` (the orchestrator still does not export `GSTACK_EXTEND_WORKSPACE_OWNER`), but close none of `WD-01`–`WD-11` or `DS-01`–`DS-09`. All `23` matrix rows therefore remain `hold`.

## Installed `/docs-ship` Acceptance (`DS-01`–`DS-09`)

Covers installed `/docs-ship` acceptance ([docs-ship.md](../docs-ship.md)) and the Next Measurement requirements in [docs-ship-timing.md](docs-ship-timing.md) on `producer_version >= 0.109.0`:

| Row | Obligation | Driver | Exact Contract Check | Telemetry Readback (`v4`, `>= 0.109.0`) | Operator Interventions | Status |
|---|---|---|---|---|---|---|
| `DS-01` | Docs-only classification | External orchestrator or Owner by hand | `bin/docs-ship classify --base origin/main` returns `STATUS: docs` on a real docs-only PR | `stage: "docs-ship"`, matching `run_mode` | `unknown` (pending) | `hold — pending post-92A docs-ship run` |
| `DS-02` | No-write classification hand-back | Owner by hand (or Orchestrator) | `STATUS: stop` produces `HANDED-BACK` with zero commits, pushes, PR/body edits, or receipts written, and exact `Run /review-and-prep` handoff | `stage: "docs-ship"`, `outcome: "blocked"` or non-writing exit | `unknown` (pending) | `hold — pending post-92A docs-ship run` |
| `DS-03` | Selected tests run once via pregate | External orchestrator or Owner by hand | `bin/docs-ship tests --base origin/main --pregate …` records `SELECTION:`, `COMPARED: pregate <n>; legacy scan <m>; legacy only <k>` ([docs-ship-timing.md](docs-ship-timing.md)), and `gstack-evidence run --label docs-ship-tests` | `stage: "docs-ship"`, `gstack-evidence` `docs-ship-tests` span recorded | `unknown` (pending) | `hold — pending post-92A docs-ship run` |
| `DS-04` | Same-tree test-record reuse | Owner by hand (or Orchestrator) | `gstack-evidence check --label docs-ship-tests --expect-cmd …` returns `FRESH`, skipping redundant test execution on an unchanged tree | `stage: "docs-ship"`, no duplicate `docs-ship-tests` run on same tree | `unknown` (pending) | `hold — pending post-92A docs-ship run` |
| `DS-05` | Final receipt hash and `docs-ship/v1` without merging | External orchestrator or Owner by hand | `bin/docs-ship hash` verified post-write, `bin/docs-ship receipt` in PR body, exact `docs-ship/v1` line printed without `gh pr merge` (under `GSTACK_SESSION_KIND=spawned` or user **Do not merge**) | `stage: "docs-ship"`, `outcome: "success"` | `unknown` (pending) | `hold — pending post-92A docs-ship run` |
| `DS-06` | Policy bump on a released docs-only PR | Owner by hand (outside factory release path) | Writes PATCH bump per [SPEC.md#release-policy](../SPEC.md#release-policy), runs `docs-ship-release-tests`, checks `docs-ship-tests` with `--allow-paths`, emits `docs-ship/v1` without merging (factory release script forbids `VERSION`/`CHANGELOG.md`/`package.json` edits on PR heads) | `stage: "docs-ship"`, `run_mode: "user-directed"`, `docs-ship-release-tests` span recorded | `unknown` (pending) | `hold — pending owner by-hand` |
| `DS-07` | Interactive merge question at `PASS` | Owner by hand | `MERGE_QUESTION: yes` asks once with **Merge** and **Do not merge** (recommending neither); verifies both explicit decline (`Not merged.`) and explicit **Merge** → single `gh pr merge <n> --<method> --match-head-commit <head>` → `Docs ship merge: merged; …` | `stage: "docs-ship"`, `run_mode: "user-directed"`, `outcome: "success"` | `unknown` (pending) | `hold — pending owner by-hand` |
| `DS-08` | Sonnet-class `/docs-ship` run and `/roadmap` → `/docs-ship` handoff | Owner by hand | One `/docs-ship` run with Sonnet-class `model` in `stage-runs` readback AND one `/roadmap` → `/docs-ship` handoff (`Run /docs-ship` with `Brief:`, `Allowed files:`, `Version:` from `/roadmap` Step 7) | `stage: "docs-ship"` with Sonnet-class `model` + paired `stage: "roadmap"` row, `producer_version >= 0.109.0` | `unknown` (pending) | `hold — pending owner by-hand` |
| `DS-09` | Work/wait wall-time comparison vs. ordinary `/review-and-prep` docs PR | Both drivers | Compare post-92A `/docs-ship` E1 intervals (active review/test work, host/tool stalls, human waits, unknown) and `COMPARED:` output against ordinary-path comparators below | `stage: "docs-ship"` + `gstack-evidence` spans (`producer_version >= 0.109.0`) | `unknown` (pending) | `hold — pending post-92A docs-ship run` |

### Ordinary-Path Timing Comparators for `DS-09`

Decomposed strictly from recorded GitHub timeline timestamps under [docs-ship-timing.md](docs-ship-timing.md)'s E1 rules (missing boundaries stay `unknown`, never `0` or estimated):

| PR | Date (UTC) | Path | Active review/test work | Host/tool stalls | Human waits | Unknown / Recorded PR Wall Intervals |
|---|---|---|---|---|---|---|
| `#276` (`20994ab`, Track 86A) | `2026-11-18` | Ordinary `/review-and-prep` (docs-only) | `unknown` | `unknown` | `unknown` | PR open-to-merge `24,637 s` (`410.6 min`: open `06:53:08Z`, ready `07:03:57Z` (`649 s`), draft `09:47:23Z` (`9,806 s` gap), ready `10:47:46Z` (`3,623 s`), merged `13:43:45Z` (`10,559 s` post-ready); first commit `05:44:25Z` to merge `28,760 s` = `479.3 min`) |
| `#233` (`f38423d`, Track 75B) | `2026-11-10` | Ordinary `/review-and-prep` (docs-only) | `unknown` | `unknown` | `unknown` | PR open-to-merge `1,180 s` (`19.7 min`: open `12:46:23Z`, ready `12:53:01Z` (`398 s`), merged `13:06:03Z` (`782 s` post-ready); first commit `12:10:23Z` to merge `3,340 s` = `55.7 min`) |
| `#159` (baseline in [docs-ship-timing.md](docs-ship-timing.md)) | `2026-10-22` | Ordinary review/ship (pre-`#165`) | `unknown` | `unknown` | `unknown` | PR open-to-merge `13,413 s` (`223.6 min`: open `15:45:05Z`, ready `15:49:34Z`, last commit `16:18:13Z`, merged `19:28:38Z`, including `11,425 s` = `190.4 min` last-commit-to-merge gap) |
| Post-92A `/docs-ship` run(s) | `unknown` (`hold`) | Installed `/docs-ship` (`>= 0.109.0`) | `unknown` | `unknown` | `unknown` | `hold` — awaiting post-92A `/docs-ship` run with `COMPARED: pregate <n>; legacy scan <m>; legacy only <k>` and `gstack-evidence` spans |

## Owner By-Hand Runbook (Minimum Consolidated Sessions)

After each session on `v0.109.0+`, read back telemetry with `gstack-extend-telemetry report --by-host --json` and inspect only the allowlisted local ledger fields. Note whether retired Cursor/OpenCode skill directories were removed (`setup --host cursor --uninstall` / `setup --host opencode --uninstall`) or left in place (emitting `INSTALL_WARN ... reason=retired_host`).

1. **By-hand Session 1 — Full workflow, `/pair-review`, negative/held check, authorized merge, and `WD-10a`:**
   On a supported install host (Claude Code or Codex, plain terminal or host app with no orchestration env vars and no `GSTACK_EXTEND_WORKSPACE_OWNER`), carry one real feature/fix PR through `/plan-track` → `/implement` → `/review-and-prep` (triggering a real human-judgment H-C pause; confirm `/ship-and-land` holds on the paused draft) → `/pair-review` → `/review-and-prep resume` → `/ship-and-land` with explicit live human merge approval.
   Covers: `WD-02`, `WD-04`, `WD-06`, `WD-08`, `WD-09c`, `WD-10a`, `WD-11`.
2. **By-hand Session 2 — `/full-review` finish and restart:**
   Run `/full-review` through Phase 6 completion (`phase: complete`), then start `/full-review` again to confirm the Init state block archives the finished session cleanly (optionally also exercising `PAUSE` → `/full-review resume`).
   Covers: `WD-05`, `WD-11`.
3. **By-hand Session 3 — `/docs-ship` interactive, Sonnet-class, `/roadmap` handoff, no-write hand-back, and PATCH policy bump:**
   Run `/roadmap` (which can record Track 92A PRs `#289`–`#290`) and hand off to `/docs-ship` on a Sonnet-class model; capture `COMPARED:` and same-tree `FRESH` reuse; exercise a no-write `STATUS: stop` → `HANDED-BACK` probe before committing; exercise the interactive merge question (decline once, then approve); and run one by-hand PATCH policy bump (`DS-06`) on a released docs-only PR outside the factory release path.
   Covers: `DS-01`–`DS-09`, `WD-11`.
4. **External orchestrator runs (on `v0.109.0+`, including Track 93B):**
   Real orchestrated runs stopping at a ready PR without merging, exercising fresh-session continuation/resume, artifact-consumed handoffs, stale/partial/held handoffs, and `GSTACK_EXTEND_WORKSPACE_OWNER` export once enabled.
   Covers: `WD-01`, `WD-03`, `WD-07`, `WD-08`, `WD-09a`, `WD-09b`, `WD-10b`, `WD-11`, and orchestrated `DS-01`/`DS-03`/`DS-05`.

## Open Holds and Non-Claims Summary

- **Owner by-hand holds (`15` rows):** `WD-02`, `WD-04`, `WD-05`, `WD-08` (by-hand half), `WD-10a`, `WD-11` (by-hand half), `DS-01`–`DS-09` (specifically `DS-02`, `DS-04`, `DS-06`, `DS-07`, `DS-08`, `DS-09`).
- **External orchestrator holds (`10` rows):** `WD-01`, `WD-03`, `WD-06` (either driver), `WD-07`, `WD-08` (orchestrator half), `WD-09a`, `WD-09b`, `WD-09c` (either driver), `WD-10b` (blocked until orchestrator exports `GSTACK_EXTEND_WORKSPACE_OWNER`), `WD-11` (orchestrator half).
- **Non-claims:** No unexercised host, harness, or stage combination is claimed; no [SPEC](../SPEC.md) O3, O4, or O6 acceptance checkpoint is awarded by this record.
