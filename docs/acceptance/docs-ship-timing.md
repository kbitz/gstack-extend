# `/docs-ship` Timing Method, Outlier Disposition and Baseline

## Method

Each `/docs-ship` run is decomposed into four interval classes under E1's boundary rules ([`docs/telemetry.md`](../telemetry.md#recording-a-span-at-its-boundary)):

- **Active review/test work:** model classification, scope, claim/link/rule verification, release bump and receipt binding, separated from recorded test execution spans (`gstack-evidence` labels `docs-ship-tests` and `docs-ship-release-tests`).
- **Host/tool stalls:** bounded tool or CI waits between recorded timestamps (for example `ready_for_review` to receipt completion during `gh pr checks`).
- **Human waits:** interactive pauses, the gap between a `blocked` segment finish and the resumed start, and the interval after `/docs-ship` finishes (or prints its step-11 result line) until the PR merges.
- **Unknown:** any interval missing a start or end timestamp, or any sub-span whose internal boundary was not recorded.

E1 rules enforced throughout:
1. An interval counts only between two recorded timestamps.
2. A missing boundary is `unknown`, never `0`.
3. No historical backfill or estimated split.
4. Wall-clock duration (`duration_s`) is not model or token consumption; unavailable token spend remains `unknown`.

Read-only sources consulted:
- `~/.gstack-extend/analytics/stage-runs.jsonl` and `stage-runs/<host>.jsonl` (`stage: docs-ship`): `started_at`, `duration_s`, `outcome`, `run_mode`, `agent`, `model`, `effort`, `producer_version`, `schema_version`, `questions`, `user_wait_s`, `resumes`, `user_signals_source`.
- `~/.gstack/analytics/skill-usage.jsonl` (`skill: extend:docs-ship`): start/finish `ts`, `duration_s`, `outcome`, `version`.
- `<state-root>/projects/<slug>/docs-ship/<run>/`: saved `pr-<n>-<UTC stamp>.json` filenames.
- `gstack-evidence` JSONL records for `docs-ship-tests` and `docs-ship-release-tests`: `ts`, `duration_s`, `tests_ran`, `exit`.
- Harness session-log signal summaries (`user_signals_source`, `user_wait_s`, `questions`, `resumes`).
- GitHub PR timeline (`gh pr view` and `issues/<n>/timeline`): `createdAt`, `committed`, `ready_for_review`, `mergedAt`.

## Reported 211-Minute Outlier vs. 34.5-Minute Run (2026-10-22 to 2026-10-25)

The originating private research ([`docs/designs/workflow-efficiency-program.md`](../designs/workflow-efficiency-program.md#verified-planning-snapshot-2026-10-25)) reported two docs-only runs of `34.5` and `211` minutes on or before `2026-10-25`. `/docs-ship` shipped on `2026-10-23` (`888185c`, PR #165).

Searching the local analytics stores, evidence logs and harness session logs for `2026-10-22` through `2026-10-25` finds no `stage-runs` or `skill-usage` rows for `docs-ship` (local `docs-ship` telemetry rows on this machine begin `2026-11-06`) and no session log recording a 211-minute `/docs-ship` invocation. Four docs-only PRs in that window are recorded as leads, not identifications:

| PR | Date (UTC) | Path | Recorded timestamps and intervals |
|---|---|---|---|
| #159 | 2026-10-22 | Ordinary review/ship (pre-#165) | First commit `14:48:39Z`; PR created `15:45:05Z`; `ready_for_review` `15:49:34Z`; last commit `16:18:13Z`; merged `19:28:38Z`. PR open-to-merge wall time `13,413 s` (`223.6 min`), including an uninstrumented `11,425 s` (`190.4 min`) gap from the last commit to merge. |
| #163 | 2026-10-23 | Pre-#165 docs PR | First commit `12:58:00Z`; PR created `13:14:13Z`; `ready_for_review` `13:14:29Z`; merged `13:17:15Z` (`182 s` = `3.0 min` PR open-to-merge; `1,155 s` = `19.3 min` from first commit). |
| #169 | 2026-10-25 | `/docs-ship` | First commit `13:28:13Z`; PR created `13:43:52Z`; saved PR JSON `13:43:55Z`; `docs-ship-tests` finished `13:48:02Z` (`59.0 s`, `811` tests, exit `0`); bump commit `13:49:59Z`; `docs-ship-release-tests` finished `14:01:45Z` (`687.8 s`, `1,717` tests, exit `1`); `ready_for_review` `15:27:12Z`; merged `15:27:15Z` (`6,203 s` = `103.4 min` PR open-to-merge; `5,127 s` between failed release test and ready is `unknown`). |
| #170 | 2026-10-25 | `/docs-ship` | First commit `19:44:21Z`; PR created `19:45:33Z`; saved PR JSON `19:45:37Z` and `19:47:51Z`; `docs-ship-tests` finished `19:47:09Z` (`48.8 s`, `576` tests, exit `0`); `ready_for_review` `19:47:58Z`; merged `20:14:12Z` (`1,719 s` = `28.7 min` PR open-to-merge, including `1,574 s` = `26.2 min` post-ready merge wait). |

### Outlier Disposition (Open)

Because no local record binds the reported `211`-minute (`12,660 s`) figure to a `/docs-ship` invocation with verified start and finish timestamps, its four interval classes remain **open**:

- **Active review/test work:** `unknown` (open)
- **Host/tool stalls:** `unknown` (open)
- **Human waits:** `unknown` (open)
- **Unattributed remainder:** `unknown` (open)

**Evidence required to close:** either the owner's synced telemetry and session records from other machines used between `2026-10-22` and `2026-10-25` ([`docs/SPEC.md`](../SPEC.md#o6-bounded-measured-stage-effort) O6.1), or the originating private research notes identifying which PR and clock boundaries produced the `211`-minute and `34.5`-minute numbers. No owner deferral has been recorded.

## Local Baseline (`2026-11-06` to `2026-11-08`, `n = 6` Stage-Run Rows)

### Provenance and Missingness

- **Environment:** OS `Linux`; harness `claude` (`model: claude-opus-5-5`, `effort: high`); installed upstream gstack `1.97.0.0` (recorded on the 4 `skill-usage.jsonl` completions; `null`/`unknown` on the 2 legacy rows); `gstack-extend` `producer_version` `0.68.0` (`schema_version: 2`, 2 legacy rows), `0.72.0` (`schema_version: 3`, 2 `user-directed` rows) and `0.73.0` (`schema_version: 3`, 2 `orchestrated` rows).
- **Sample size and missingness:** `6` stage-run rows across `3` PRs (#209, #214, #219). The `2` legacy rows (`stage-runs.jsonl`, `2026-11-06`) have `run_mode: null` (`unknown`) and `user_wait_s: null` (`unknown`). The `2` `user-directed` rows (`2026-11-07`) record `user_wait_s: 0`, `questions: 0`, `resumes: 0` (`user_signals_source: session-log`). The `2` `orchestrated` rows (`2026-11-08`) record `user_wait_s: null` (`user_signals_source: orchestrated`). Model token usage is not present in `stage-runs` (`unknown` on all `6` rows).

### Per-Run Interval Breakdown

| Date / PR | Mode & versions | Stage wall (`duration_s`) | Active test work (`gstack-evidence`) | Active non-test work | Host/tool stalls | Human waits (in-stage & between/post-stage) | Unknown sub-spans |
|---|---|---|---|---|---|---|---|
| `2026-11-06` PR #209 seg 1 (`19:54:00Z`–`19:55:35Z`) | `unknown`; extend `0.68.0`, gstack `unknown` | `95 s` (`blocked`) | `33.2 s` (`docs-ship-tests` at `19:55:32Z`, `2,317` tests, exit `0`) | `<= 61.8 s` (PR snapshot `19:54:07Z`) | `unknown` | `43 s` between seg 1 end (`19:55:35Z`) and seg 2 start (`19:56:18Z`) | In-stage `user_wait_s` `unknown` (schema v2) |
| `2026-11-06` PR #209 seg 2 (`19:56:18Z`–`19:58:47Z`) | `unknown`; extend `0.68.0`, gstack `unknown` | `149 s` (`success`) | `66.8 s` (`33.3 s` exit `1` at `19:57:03Z` + `33.5 s` exit `0` at `19:57:52Z`, `2,317` tests) | `<= 82.2 s` | `unknown` | `3,004 s` post-stage wait until merge (`20:48:51Z`) | In-stage `user_wait_s` `unknown` (schema v2) |
| `2026-11-07` PR #214 seg 1 (`16:19:55Z`–`16:20:03Z`) | `user-directed`; extend `0.72.0`, gstack `1.97.0.0` | `8 s` (`blocked`) | `0 s` (no test record) | `8.0 s` | `0 s` | `0 s` in-stage (`user_wait_s: 0`); `171 s` between seg 1 end and seg 2 start (`16:22:54Z`) | None |
| `2026-11-07` PR #214 seg 2 (`16:22:54Z`–`16:34:46Z`) | `user-directed`; extend `0.72.0`, gstack `1.97.0.0` | `712 s` (`success`) | `457.8 s` (`37.2 s` `docs-ship-tests` at `16:25:18Z`, `2,227` tests + `420.6 s` `docs-ship-release-tests` at `16:33:59Z`, `2,244` tests) | `206.9 s` pre-release-test review & bump (`16:26:47Z` commit) | `<= 47.3 s` (`16:33:59Z`–`16:34:46Z` CI check + receipt) | `0 s` in-stage (`user_wait_s: 0`); `170 s` post-stage wait until merge (`16:37:36Z`) | Exact CI poll share inside final `47.3 s` |
| `2026-11-08` PR #219 run 1 (`02:38:36Z`–`02:41:45Z`) | `orchestrated`; extend `0.73.0`, gstack `1.97.0.0` | `189 s` (`success`) | `10.4 s` (`docs-ship-tests` at `02:40:44Z`, `663` tests, exit `0`) | `135.6 s` (PR snapshot `02:39:36Z`, ready `02:41:02Z`) | `<= 43.0 s` (`02:41:02Z` ready to `02:41:45Z` finish) | `0 s` in-stage (orchestrated) | Exact CI poll vs. receipt edit split in final `43.0 s` |
| `2026-11-08` PR #219 run 2 (`03:21:09Z`–`03:22:04Z`) | `orchestrated`; extend `0.73.0`, gstack `1.97.0.0` | `55 s` (`success`) | `10.4 s` (`docs-ship-tests` at `03:21:41Z`, `663` tests, exit `0`) | `44.6 s` | `unknown` | `0 s` in-stage; `653 s` post-stage wait until merge (`03:32:57Z`) | None |

In the longest recorded local run (`712 s` on `2026-11-07`, PR #214), `457.8 s` (`64.3%`) was active test execution — primarily `420.6 s` in `docs-ship-release-tests` when legacy filename scanning matched `2,244` tests on the release bump.

## Next Measurement

Track 76B ("Include installed `/docs-ship` acceptance", [`docs/ROADMAP.md`](../ROADMAP.md) Group 76) applies this method to subsequent installed `/docs-ship` runs and records `docs-ship tests --pregate`'s `COMPARED: pregate <n>; legacy scan <m>; legacy only <k>` line alongside the interval breakdown.
