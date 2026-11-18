# Review Run-State Measurement and Default Decision Record (`run-state=record`)

This record evaluates Track 86A (**Measure the recorded run-state path on real runs and decide its default**) against [`docs/SPEC.md`](../SPEC.md) (`O6.2`–`O6.3` and `P1`), the [workflow efficiency program](../designs/workflow-efficiency-program.md) (`E15`), and [`docs/designs/review-run-state.md`](../designs/review-run-state.md) (`D1`, `D14`, and `D15`).

**Verdict (`2026-11-18`).** The decision is **`insufficient-evidence`** for promoting `run-state=record` to the `/review-and-prep` default. The three orchestrated after-runs averaged 27.3% fewer bookkeeping-plus-resume output tokens than the four before-runs, short of the 50% threshold. The sample includes zero of the two required owner by-hand runs. All ten segments have records in all three stores, and all recorded findings reached the ledgers. The three reviews reached `prepared` and used the published receipt and handoff grammar, including when two runs fell back to inline handoff rendering. The runs used different PRs, so the outcome each candidate would have received on the inline path is unknown. The bounded next measurement is two owner by-hand opted-in runs by `2026-12-25`. The policy value stays opt-in and the per-record `seq` and `input_sha256` proposals are **dropped**.

## 1. Scope, environment, adoption threshold, and sample bounds

| Field | Value |
|---|---|
| Baseline repository revision | `dd10953` (`v0.99.0`) on `main` |
| Operating system and runtime | `Linux` (private state root), Bun `1.4.3` |
| Recorded `gstack-extend` writer versions | `0.98.0` (PR `#270`, merged commit `23f0bfc`), `0.98.1` (PR `#272`, merged commit `a9b8d5a`), `0.98.2` (PR `#274`, merged commit `dd10953`). State stores the helper version from the latest write. |
| Installed upstream `gstack` version | `1.99.5.0` |
| Harness and model provenance (`stage-runs`) | `codex` with `gpt-6.1-sol` (`effort: max`) on PRs `#270` and `#272` and `gpt-6.2-sol` (`effort: max`) on PR `#274`. The harness CLI version is `unknown` in `stage-runs`. Backfilled first-segment rows have `agent: null`, `model: null`, and `effort: null` with `run_mode: orchestrated`. |
| Out-of-sample owner machines | Other owner machines are `unknown` (never `0`, per [`docs/SPEC.md`](../SPEC.md) `O6.1`); all measurements in this record come from the local Linux workstation's retained artifacts and parent rollouts |
| `E15` six-week measurement window | Track 78A shipped in `v0.92.0` on `2026-11-13` (commit `d051274`, PR `#249`; [`docs/roadmap-shipped.md`](../roadmap-shipped.md)), bounding the six-week window (`>= 4` opted-in runs: `>= 2` owner by-hand and `>= 2` orchestrated) to `2026-12-25` |
| Owner adoption threshold (`2026-11-14T22:38Z`) | Recorded in the Track 79A part 2 card notes on `2026-11-14T22:38Z` (`1 - your suggestion is fine`) before any owner by-hand after-run and before all post-builder-fix orchestrated after-runs: adopt `run-state=record` as the default if bookkeeping-plus-resume output tokens drop by at least half (about `50%` relative) across the after-runs, with every guardrail held (`complete records in every segment`, `no lost findings`, `unchanged review outcomes`) |
| Early pre-`build` pilot runs vs. measured after-runs | Early pre-`build` orchestrated pilot runs (`2026-11-12T22:01Z` through `2026-11-14T20:18Z`, `writer` `0.89.1`–`0.94.0`) predate the `2026-11-14T22:38Z` threshold and the Track 85A/85E/85H builder fixes (`v0.97.1`–`v0.98.1`), and are classified as reliability telemetry in [`docs/designs/review-run-state.md`](../designs/review-run-state.md) `D15` rather than counted as after-runs. All three measured post-builder-fix orchestrated after-runs (`2026-11-17T17:52Z` through `2026-11-18T03:49Z`, `writer` `0.98.0`–`0.98.2`) postdate `2026-11-14T22:38Z` |
| Sample size and missingness | **Before:** four orchestrated runs (PRs `#229` and `#231` in this repository and runs A and B in consumer A). Owner by-hand before figures are unknown. **After:** three orchestrated runs (PRs `#270`, `#272`, and `#274`). The local retained sample has zero of the two required owner by-hand opted-in runs. |

The owner selected the three latest repository reviews after the first builder fixes in Tracks 85A and 85E. PR `#270` used writer `0.98.0`, before the coverage-input fixes in Track 85H, which shipped with that PR. PRs `#272` and `#274` used writers with those later fixes.

## 2. Before and after figures from the four caller-owned scripts

### 2.1 Verified script digests

All four caller-owned scripts were verified on disk by SHA-256 digest before running read-only outside the repository without modification:

1. `6c02683e386f595eebb4df9593b8510db71c8ca5d823d748621b9545ec6c18f4` — parent-rollout tool-call classifier across `B` (bookkeeping), `R-read` (review reads), `S-protocol` (skill/protocol reads), `R-delegate` (delegated review work), `R-test` (tests/pregate), `R-adjudicate` (finding adjudication), `R-repair` (code/doc repairs), `R-merge` (base merge), `O-other`, and `O-final/idle`, attributing active wall time (`task_started` to `task_complete`/`turn_aborted`) and token deltas (`token_count` events) per tool call.
2. `21ecde089c5314c1a2ca214c16de5e3d35e69d7ee0efd6ad2c1db184e8cf7514` — phase classifier wrapping the tool-call classifier into `0 protocol reading`, `1 scope/plan matrix`, `2 core review (merge base)`, `2 core review`, `3 specialist dispatch+wait`, `4 adjudication`, `5 repairs+tests`, `6 docs audit`, `7 greptile`, `8 pregate/tests+wait`, `9 bookkeeping`, `10 continuation/resume`, `O other/sleep`, and `O-final/idle` (with task-boundary `ACTIVE[1:]` tracking for `360 s` continuation reassignment).
3. `184c3d84c550750c0f178fa3805e1d30d7ea9d11525549f528f9b1466f30d6c8` — telemetry, `derive`, and workflow-span call and exit-status inspector.
4. `c4054469f29d6ea43d650a0569940113a45ca188f92bf73cbfa953e75059e9f9` — initial-prompt and pattern-matched tool-call/output inspector.

Each script was run against the single `subagent=False` parent Codex rollout JSONL of each run, excluding child `subagent=True` rollouts to match the `2026-11-10` baseline methodology.

### 2.2 Summary comparison (before `n = 4` orchestrated vs. after `n = 3` orchestrated; owner by-hand `n = 0`, `unknown`)

Figures in the primary columns come directly from the unchanged phase classifier (`21ecde089c5314c1a2ca214c16de5e3d35e69d7ee0efd6ad2c1db184e8cf7514`), cross-checked against the retained `2026-11-09` parent rollouts for the four before runs and the `2026-11-17`–`2026-11-18` parent rollouts for PRs `#270`, `#272`, and `#274`.

| Run | Arm & writer | Rollout tasks / state segments | Active wall (`min`) | Output tokens | Uncached input tokens | Cached input tokens | `9 bookkeeping` (out / wall) | `10 continuation/resume` (out / wall) | Combined `9 + 10` (out / wall) | `0 protocol reading` uncached input | `O other/sleep` (out / wall) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PR `#229` (this repo) | Before (inline) | `5` / unrecorded seg 1 | `202` | `316k` | `592k` | `96M` | `12%` / `10%` | `42%` / `43%` | `54%` / `53%` | `16%` | `1%` / `1%` |
| PR `#231` (this repo) | Before (inline) | `2` / unrecorded seg 1 | `68` | `79k` | `333k` | `38M` | `13%` / `7%` | `23%` / `14%` | `36%` / `21%` | `25%` | `0%` / `0%` |
| `consumer A` run `A` | Before (inline) | `3` / unrecorded seg 1 | `89` | `146k` | `590k` | `53M` | `43%` / `47%` | `8%` / `8%` | `51%` / `55%` | `27%` | `3%` / `4%` |
| `consumer A` run `B` | Before (inline) | `2` / unrecorded seg 1 | `83` | `100k` | `535k` | `57M` | `20%` / `17%` | `17%` / `14%` | `37%` / `31%` | `31%` | `8%` / `1%` |
| **Before range (`n = 4`)** | **Inline** | **`2`–`5` tasks** | **`68`–`202`** | **`79k`–`316k`** | **`333k`–`592k`** | **`38M`–`96M`** | **`12%`–`43%` / `7%`–`47%`** | **`8%`–`42%` / `8%`–`43%`** | **`36%`–`54%` / `21%`–`55%`** | **`16%`–`31%`** | **`0%`–`8%` / `0%`–`4%`** |
| PR `#270` (`23f0bfc`) | After (`0.98.0`) | `3` tasks / `3` segs | `66.6` (`67`) | `97,641` (`98k`) | `471,625` (`472k`) | `65,917,696` (`66M`) | `30.3%` / `16.9%` | `11.8%` / `14.9%` | `42.2%` / `31.8%` | `42.6%` | `0.1%` / `0.7%` |
| PR `#272` (`a9b8d5a`) | After (`0.98.1`) | `4` tasks / `5` segs | `166.6` (`167`) | `243,293` (`243k`) | `799,512` (`800k`) | `98,144,768` (`98M`) | `20.2%` / `16.3%` | `26.1%` / `19.5%` | `46.3%` / `35.8%` | `25.0%` | `3.4%` / `6.2%` |
| PR `#274` (`dd10953`) | After (`0.98.2`) | `2` tasks / `2` segs | `92.9` (`93`) | `74,175` (`74k`) | `638,437` (`638k`) | `50,487,424` (`50M`) | `9.4%` / `5.2%` | `11.4%` / `9.4%` | `20.8%` / `14.6%` | `16.0%` | `33.0%` / `59.5%` |
| **After range (`n = 3`)** | **`build` (`0.98.x`)** | **`2`–`4` tasks / `2`–`5` segs** | **`66.6`–`166.6`** | **`74k`–`243k`** | **`472k`–`800k`** | **`50M`–`98M`** | **`9.4%`–`30.3%` / `5.2%`–`16.9%`** | **`11.4%`–`26.1%` / `9.4%`–`19.5%`** | **`20.8%`–`46.3%` / `14.6%`–`35.8%`** | **`16.0%`–`42.6%`** | **`0.1%`–`33.0%` / `0.7%`–`59.5%`** |
| **Owner by-hand (`n = 0`)** | **After (`user-directed`)** | **`unknown`** | **`unknown`** | **`unknown`** | **`unknown`** | **`unknown`** | **`unknown`** | **`unknown`** | **`unknown`** | **`unknown`** | **`unknown`** |

The primary figures use the classifier's printed buckets. The script marks the first 360 seconds of tasks in `ACTIVE[1:]` for a resume sensitivity check. Applying the reassignment of `0 protocol reading` and `9 bookkeeping` calls to `10 continuation/resume` moves 2 calls (1,234 output tokens) on PR `#270`, 4 (2,530 tokens) on PR `#272`, and 2 (2,759 tokens) on PR `#274`. Only moves from `0` add to combined `9 + 10`. Applied to both samples, the mean count falls from 82,172 to 58,424 (28.9%) and the mean per-run share from 47.2% to 38.3% (18.7% relative).

Using the four before-run counts of 169,745, 28,792, 74,214, and 37,489 output tokens in table order, the mean falls from 77,560 before to 56,408 after (27.3%). The mean of the unrounded per-run output shares falls from 44.6% to 36.4% (18.3% relative). The adoption threshold uses the mean count. The mean share puts review sizes in context. Both reductions are short of half. The reviewed changes, models, number of resumes, and use of inline rendering differ across the runs.

### 2.3 Full per-class breakdown on the three orchestrated after-runs

#### Phase classifier (`21ecde089c5314c1a2ca214c16de5e3d35e69d7ee0efd6ad2c1db184e8cf7514`)

| Phase | PR `#270` (`calls` / `wall min` [`%`] / `out tok` [`%`] / `unc %`) | PR `#272` (`calls` / `wall min` [`%`] / `out tok` [`%`] / `unc %`) | PR `#274` (`calls` / `wall min` [`%`] / `out tok` [`%`] / `unc %`) |
|---|---|---|---|
| `0 protocol reading` | `19` / `2.3m` (`3.5%`) / `4,133` (`4.2%`) / `42.6%` | `58` / `14.9m` (`8.9%`) / `18,071` (`7.4%`) / `25.0%` | `18` / `2.8m` (`3.0%`) / `7,763` (`10.5%`) / `16.0%` |
| `1 scope/plan matrix` | `4` / `0.5m` (`0.7%`) / `810` (`0.8%`) / `8.1%` | `9` / `4.2m` (`2.5%`) / `2,401` (`1.0%`) / `7.8%` | `4` / `0.7m` (`0.7%`) / `698` (`0.9%`) / `1.9%` |
| `2 core review (merge base)` | `4` / `0.7m` (`1.1%`) / `4,391` (`4.5%`) / `2.0%` | `7` / `5.7m` (`3.4%`) / `10,947` (`4.5%`) / `2.8%` | `1` / `0.3m` (`0.3%`) / `0` (`0.0%`) / `0.0%` |
| `2 core review` | `0` / `0.0m` (`0.0%`) / `0` (`0.0%`) / `0.0%` | `6` / `1.6m` (`1.0%`) / `5,784` (`2.4%`) / `1.9%` | `1` / `0.1m` (`0.1%`) / `503` (`0.7%`) / `0.2%` |
| `3 specialist dispatch+wait` | `88` / `20.4m` (`30.7%`) / `17,415` (`17.8%`) / `7.8%` | `82` / `41.3m` (`24.8%`) / `29,102` (`12.0%`) / `8.9%` | `17` / `9.3m` (`10.0%`) / `4,814` (`6.5%`) / `8.0%` |
| `4 adjudication` | `11` / `5.8m` (`8.7%`) / `10,350` (`10.6%`) / `4.4%` | `9` / `5.4m` (`3.2%`) / `12,750` (`5.2%`) / `2.5%` | `10` / `2.9m` (`3.1%`) / `3,257` (`4.4%`) / `1.3%` |
| `5 repairs+tests` | `0` / `0.0m` (`0.0%`) / `0` (`0.0%`) / `0.0%` | `0` / `0.0m` (`0.0%`) / `0` (`0.0%`) / `0.0%` | `4` / `1.5m` (`1.7%`) / `2,137` (`2.9%`) / `1.7%` |
| `6 docs audit` | `11` / `4.8m` (`7.3%`) / `7,822` (`8.0%`) / `6.2%` | `14` / `7.9m` (`4.7%`) / `17,501` (`7.2%`) / `5.1%` | `8` / `2.3m` (`2.5%`) / `6,903` (`9.3%`) / `3.1%` |
| `7 greptile` | `3` / `1.8m` (`2.7%`) / `2,661` (`2.7%`) / `0.3%` | `0` / `0.0m` (`0.0%`) / `0` (`0.0%`) / `0.0%` | `3` / `1.2m` (`1.3%`) / `1,619` (`2.2%`) / `0.5%` |
| `8 pregate/tests+wait` | `31` / `8.2m` (`12.3%`) / `7,175` (`7.3%`) / `5.7%` | `31` / `15.2m` (`9.1%`) / `21,643` (`8.9%`) / `13.7%` | `10` / `2.7m` (`2.9%`) / `5,320` (`7.2%`) / `5.6%` |
| `9 bookkeeping` | `37` / `11.2m` (`16.9%`) / `29,634` (`30.3%`) / `18.8%` | `54` / `27.2m` (`16.3%`) / `49,202` (`20.2%`) / `18.9%` | `16` / `4.8m` (`5.2%`) / `6,973` (`9.4%`) / `7.7%` |
| `10 continuation/resume` | `13` / `9.9m` (`14.9%`) / `11,555` (`11.8%`) / `3.6%` | `45` / `32.5m` (`19.5%`) / `63,411` (`26.1%`) / `9.2%` | `14` / `8.8m` (`9.4%`) / `8,448` (`11.4%`) / `4.4%` |
| `O other/sleep` | `1` / `0.4m` (`0.7%`) / `78` (`0.1%`) / `0.1%` | `31` / `10.3m` (`6.2%`) / `8,186` (`3.4%`) / `3.5%` | `117` / `55.3m` (`59.5%`) / `24,479` (`33.0%`) / `49.4%` |
| `O-final/idle` | `0` / `0.4m` (`0.6%`) / `1,617` (`1.7%`) / `0.5%` | `0` / `0.6m` (`0.3%`) / `4,295` (`1.8%`) / `0.6%` | `0` / `0.3m` (`0.3%`) / `1,261` (`1.7%`) / `0.3%` |

#### Tool-call classifier (`6c02683e386f595eebb4df9593b8510db71c8ca5d823d748621b9545ec6c18f4`)

| Category | PR `#270` (`calls` / `wall min` [`%`] / `out tok` [`%`] / `unc %`) | PR `#272` (`calls` / `wall min` [`%`] / `out tok` [`%`] / `unc %`) | PR `#274` (`calls` / `wall min` [`%`] / `out tok` [`%`] / `unc %`) |
|---|---|---|---|
| `B` | `43` / `16.2m` (`24.3%`) / `32,688` (`33.5%`) / `23.3%` | `93` / `43.6m` (`26.2%`) / `70,346` (`28.9%`) / `23.3%` | `29` / `10.7m` (`11.5%`) / `12,128` (`16.4%`) / `10.9%` |
| `O-final/idle` | `0` / `0.4m` (`0.6%`) / `1,617` (`1.7%`) / `0.5%` | `0` / `0.6m` (`0.3%`) / `4,295` (`1.8%`) / `0.6%` | `0` / `0.3m` (`0.3%`) / `1,261` (`1.7%`) / `0.3%` |
| `O-other` | `4` / `0.8m` (`1.3%`) / `1,118` (`1.1%`) / `4.7%` | `17` / `3.9m` (`2.4%`) / `6,640` (`2.7%`) / `3.0%` | `118` / `55.6m` (`59.9%`) / `24,672` (`33.3%`) / `49.4%` |
| `R-adjudicate` | `13` / `7.7m` (`11.6%`) / `13,071` (`13.4%`) / `4.7%` | `14` / `14.4m` (`8.6%`) / `31,879` (`13.1%`) / `4.9%` | `2` / `0.6m` (`0.7%`) / `2,327` (`3.1%`) / `0.6%` |
| `R-delegate` | `92` / `22.5m` (`33.7%`) / `18,434` (`18.9%`) / `8.6%` | `84` / `42.1m` (`25.3%`) / `32,009` (`13.2%`) / `9.0%` | `19` / `10.2m` (`11.0%`) / `5,495` (`7.4%`) / `8.5%` |
| `R-merge` | `4` / `0.7m` (`1.1%`) / `4,391` (`4.5%`) / `2.0%` | `11` / `10.7m` (`6.5%`) / `15,222` (`6.3%`) / `3.0%` | `2` / `0.9m` (`1.0%`) / `675` (`0.9%`) / `0.4%` |
| `R-read` | `1` / `0.2m` (`0.2%`) / `288` (`0.3%`) / `1.5%` | `10` / `4.9m` (`2.9%`) / `6,919` (`2.8%`) / `3.9%` | `4` / `0.4m` (`0.4%`) / `2,905` (`3.9%`) / `0.5%` |
| `R-repair` | `0` / `0.0m` (`0.0%`) / `0` (`0.0%`) / `0.0%` | `0` / `0.0m` (`0.0%`) / `0` (`0.0%`) / `0.0%` | `4` / `1.5m` (`1.7%`) / `2,137` (`2.9%`) / `1.7%` |
| `R-test` | `38` / `13.8m` (`20.7%`) / `15,421` (`15.8%`) / `7.3%` | `43` / `25.0m` (`15.0%`) / `42,589` (`17.5%`) / `17.7%` | `18` / `8.1m` (`8.8%`) / `10,708` (`14.4%`) / `7.7%` |
| `S-protocol` | `27` / `4.3m` (`6.4%`) / `10,613` (`10.9%`) / `47.5%` | `74` / `21.5m` (`12.9%`) / `33,394` (`13.7%`) / `34.5%` | `27` / `4.4m` (`4.7%`) / `11,867` (`16.0%`) / `19.9%` |

### 2.4 Builder request and caller render input bytes and `O-other` audit

- **Request and render input volume vs. PR `#231` (`62,110 B` across `33` calls) and `D12` (`~5.4 KB` single-pass estimate):**
  - **PR `#270` (`rev 61`, `3` segments, `2` review cycles):** `61` helper-written `request-<command>-<sha256-16>.json` files totaling `22,313 B` (`1` `start`, `30` `record-pass`, `8` `record-correction`, `8` `record-gate`, `4` `record-audit`, `9` `checkpoint`, `1` `finish`) plus `8` `render` input files totaling `1,640 B` (`69` files, `23,953 B` total; `61.4%` fewer bytes than PR `#231`). Because the caller invokes `bin/review-state build` with CLI flags rather than hand-authoring JSON payloads, the `22,313 B` of `request-*.json` files are generated by `build`, and caller-authored JSON is limited to the `1,640 B` of `render` input files.
  - **PR `#272` (`rev 141`, `5` segments, `2` review cycles, `56` finding corrections).** The 142 builder requests total 73,600 B (one `start`, 48 `record-pass`, 56 `record-correction`, 17 `record-gate`, five `record-audit`, 13 `checkpoint`, and two `finish`, including one refused 238-byte `needs-context` request while paused in segment 1). Seven caller-authored `render` inputs total 1,952 B. The 149 files total 75,552 B, 21.6% more than PR `#231`.
  - **PR `#274` (`rev 69`, `2` segments, `2` review cycles, `18` finding corrections):** `69` `request-*.json` files totaling `39,355 B` (`1` `start`, `31` `record-pass`, `18` `record-correction`, `11` `record-gate`, `3` `record-audit`, `4` `checkpoint`, `1` `finish`) plus `5` `render` input files totaling `1,478 B` (`74` files, `40,833 B` total; `34.3%` fewer bytes than PR `#231`, with caller-authored `render` JSON at `1,478 B`).
  - These are retained input file counts. The builder writes those requests from caller flags, so the file bytes omit the work of authoring the flags. The D12 estimate covers one pass, while the totals here include multiple cycles and resumes.
- **Audit of `bin/review-state` calls landing in `O other/sleep` (`O-other`):**
  - Because `6c02683e386f595eebb4df9593b8510db71c8ca5d823d748621b9545ec6c18f4` and `21ecde089c5314c1a2ca214c16de5e3d35e69d7ee0efd6ad2c1db184e8cf7514` were authored on `2026-11-10` before `bin/review-state` existed, every tool call mentioning `review-state` (`30` parent calls on PR `#270`, `45` on PR `#272`, `52` on PR `#274`, inspected with `c4054469f29d6ea43d650a0569940113a45ca188f92bf73cbfa953e75059e9f9`) was audited by category:
  - In the phase classifier (`21ecde089c5314c1a2ca214c16de5e3d35e69d7ee0efd6ad2c1db184e8cf7514`), **`0` `bin/review-state` calls** fell into `O other/sleep` across all three runs (`0` on PR `#270`, `0` on PR `#272`, `0` on PR `#274`), because each call's evidence directory path or flags matched the phase classifier's evidence/phase patterns.
  - In the base tool-call classifier (`6c02683e386f595eebb4df9593b8510db71c8ca5d823d748621b9545ec6c18f4`), `0` `bin/review-state` calls fell into `O-other` on PR `#270`, `0` on PR `#272`, and **`1` call** on PR `#274` (`0.36 min` / `0.38%` active wall time, `193` output tokens / `0.26%` output, `358` uncached input tokens; classified by the phase classifier into `10 continuation/resume`).
  - The large `O other/sleep` share on PR `#274` (`117` non-`review-state` calls, `55.3 min` / `59.5%` active wall time, `24,479` output tokens / `33.0%` output) consists of `59` `write_stdin` polling calls and `58` `wait` calls on backgrounded delegate/test cells whose initial output did not match the classifier's `session_id`/`cell ID` origin regexes.

### 2.5 Per-segment record completeness across all `10` segments

Every segment across PRs `#270` (3 segments), `#272` (5), and `#274` (2) has boundaries in `review-run-state.json`, a matching local `stage-runs` row, and a populated `workflow-metrics` ledger keyed by the SHA-256 digest of the exported `session_id`. Export marks all three sandboxed first segments `derived: true`, and each has its backfilled stage row. This establishes the presence of records for all ten segments. Section 3.1 accounts for missing inline spans and decisions within those segments.

| Run & segment | `segments[]` `started_at` → `ended_at` | `end` | `segments[].session_id` | `stage-runs` row (`outcome` / `model` / `run_mode`) | `workflow-metrics` ledger rows & `op` breakdown |
|---|---|---|---|---|---|
| PR `#270` seg `1` | `2026-11-17T17:52:23.173Z` → `2026-11-17T18:27:18.032Z` | `paused` | `null` (derived UUIDv5 via `export`/`derive`) | Present (`blocked` / `null` [`unknown`] / `orchestrated`, `duration_s: 2095`, derived from state) | `79` rows (`18` `begin`, `17` `end`, `6` `decision`, `30` `pass`, `8` `correction`) |
| PR `#270` seg `2` | `2026-11-17T18:45:19.837Z` → `2026-11-17T18:50:54.241Z` | `paused` | Recorded (`extend-<uuid>`) | Present (`blocked` / `gpt-6.1-sol` / `orchestrated`, `duration_s: 391`) | `11` rows (`4` `begin`, `4` `end`, `2` `decision`, `1` `usage`) |
| PR `#270` seg `3` | `2026-11-17T19:06:37.010Z` → `2026-11-17T19:23:44.478Z` | `finished` | Recorded (`extend-<uuid>`) | Present (`success` / `gpt-6.1-sol` / `orchestrated`, `duration_s: 1085`) | `15` rows (`5` `begin`, `5` `end`, `4` `decision`, `1` `usage`) |
| PR `#272` seg `1` | `2026-11-17T21:43:35.158Z` → `2026-11-17T22:21:56.831Z` | `paused` | `null` (derived UUIDv5 via `export`/`derive`) | Present (`blocked` / `null` [`unknown`] / `orchestrated`, `duration_s: 2302`, derived from state) | `68` rows (`3` `begin`, `2` `decision`, `24` `pass`, `39` `correction`) |
| PR `#272` seg `2` | `2026-11-17T22:24:07.473Z` → `2026-11-17T23:18:48.614Z` | `paused` | Recorded (`extend-<uuid>`) | Present (`blocked` / `gpt-6.1-sol` / `orchestrated`, `duration_s: 3328`) | `51` rows (`2` `begin`, `2` `end`, `1` `decision`, `24` `pass`, `21` `correction`, `1` `usage`) |
| PR `#272` seg `3` | `2026-11-17T23:29:39.178Z` → `2026-11-17T23:32:04.562Z` | `paused` | Recorded (`extend-<uuid>`) | Present (`blocked` / `gpt-6.1-sol` / `orchestrated`, `duration_s: 191`) | `5` rows (`2` `begin`, `2` `end`, `1` `usage`) |
| PR `#272` seg `4` | `2026-11-17T23:45:25.031Z` → `2026-11-18T00:17:59.040Z` | `paused` | Recorded (`extend-<uuid>`) | Present (`blocked` / `gpt-6.1-sol` / `orchestrated`, `duration_s: 2053`) | `5` rows (`2` `begin`, `2` `end`, `1` `usage`) |
| PR `#272` seg `5` | `2026-11-18T00:31:15.843Z` → `2026-11-18T00:56:34.339Z` | `finished` | Recorded (`extend-<uuid>`) | Present (`success` / `gpt-6.1-sol` / `orchestrated`, `duration_s: 1697`) | `3` rows (`1` `begin`, `1` `end`, `1` `usage`) |
| PR `#274` seg `1` | `2026-11-18T02:09:51.470Z` → `2026-11-18T03:22:40.074Z` | `paused` | `null` (derived UUIDv5 via `export`/`derive`) | Present (`blocked` / `null` [`unknown`] / `orchestrated`, `duration_s: 4369`, derived from state) | `50` rows (`1` `begin`, `31` `pass`, `18` `correction`) |
| PR `#274` seg `2` | `2026-11-18T03:34:21.016Z` → `2026-11-18T03:48:33.624Z` | `finished` | Recorded (`extend-<uuid>`) | Present (`success` / `gpt-6.2-sol` / `orchestrated`, `duration_s: 853`) | `3` rows (`1` `begin`, `1` `end`, `1` `usage`) |

Every exported event ID matched a ledger row, including all finding corrections. Counts of findings on attempt records also matched: 8 on PR `#270`, 56 on PR `#272`, and 18 on PR `#274`. A finding on an attempt and a later correction are different record types. For PR `#272`, the 60 correction rows consist of 56 finding corrections and four fallback corrections for linked failed delegate and completed host attempts. All three receipts report no unresolved findings.

## 3. Measurements requested by opted-in reviews (PRs `#244` and `#262`)

### 3.1 Capture lost when the first `derive` cannot bind

Inspected via [`docs/review-run-state-calls.md`](../review-run-state-calls.md) (`## Derive and spans`, `:104-106`), `bin/lib/telemetry.py` (`run_derive`, `:1926-2075`), the `derived-*.json` and `resume-*-derive*.json` artifacts in `--dir`, the `workflow-metrics` ledgers above, and `184c3d84c550750c0f178fa3805e1d30d7ea9d11525549f528f9b1466f30d6c8`:

- **Why the initial sandboxed `telemetry-call start` fails in segment 1:** In all three runs (PRs `#270`, `#272`, and `#274`), the initial non-escalated `telemetry-call start --skill extend:review-and-prep` call in segment 1 returned `GE_TELEMETRY: unavailable reason=state-unwritable` (`EROFS` on the private telemetry root), leaving `segments[0].session_id` as `null` when `bin/review-state build start` ran in the writable evidence directory `--dir`.
- **What a later writable `derive` recovers in full:** When `bin/gstack-extend-telemetry derive --dir <evidence directory>` runs with write access to the telemetry root (either via an escalated call during segment 1 or on a later resumed segment), `bin/review-state export --dir <evidence directory>` deterministically mints a UUIDv5 `session_id` (`extend-<uuid>`) and `run_step_id` for the `session_id: null` segment, and `derive` replays into that segment's `workflow-metrics` ledger:
  1. Run `begin` for every segment. The latest segment reports binding in `data.current.run_begin` as `recorded` or `replayed`.
  2. The pass states (`started`, `attempt`, `voice-complete`, `completed`). Eligible finding corrections project into the target pass's segment. Receipt-only or `fixed_in`-only corrections stay in state, and corrections with unknown segment identity are skipped. The ledger shows 30 pass records and eight finding corrections for PR `#270`, 48 and 56 for PR `#272`, and 31 and 18 for PR `#274`. PR `#272` also has four fallback corrections projected from `predecessor_attempt_id`.
  3. Run `end` for non-derived segments that paused or finished (PR `#270` segments 2–3, `#272` segments 2–5, and `#274` segment 2). This excludes interrupted segments.
  4. Backfilled `stage-runs` rows (`bin/lib/telemetry.py:2104-2159`) for closed `session_id: null` segments, with `outcome: "blocked"` on pause and `duration_s` from the segment boundaries.
- **What is lost while `data.current.run_begin` is not `recorded` or `replayed`:**
  1. While the initial `derive` cannot write to the telemetry root (or when `GX_CAPTURE=1` is not exported into subsequent shell commands after a writable `derive`), inline `workflow-span.sh` phase `begin`/`end` spans (`base-integration`, `local-pass`, `voice`, `fix`, `completion`, `coverage`, `documentation`, `pregate`, `publication`, `readiness`, `handoff`), wait sub-spans (`greptile-wait`, `external-gate-wait`), and `decision` events are suppressed. On PR `#270` seg 1, the agent ran `derive` and `workflow-span.sh` under escalated permissions, capturing `17` phase `begin`/`end` pairs and `6` `decision` rows (`79` total rows). On PR `#272` seg 1, only `2` `begin:voice` spans (`0` matching `end` rows) and `2` `decision` rows were captured alongside `1` `begin:run`, `24` `pass`, and `39` `correction` rows (`68` rows). On PR `#274` seg 1, `derived-start.json` bound `run_begin: "recorded"`, but no inline `workflow-span.sh` or `decision` calls were bound during segment 1, so the ledger holds only the `50` `derive`-projected records (`1` `begin:run`, `31` `pass`, `18` `correction`, `0` phase spans, `0` `decision` rows).
  2. `derive` intentionally omits fix-cycle corrections (`correction_kind: "fix-cycle"`) and attempt `model_context` from the projection. See [design D9's metrics projection](../designs/review-run-state.md) and the [derive contract](../telemetry.md#review-state-derive).
  3. If `bin/review-state build start` itself fails before creating `review-run-state.json`, `derive` has no state file to export and the entire metrics run is lost unless the caller falls back inline.

### 3.2 Whether a `helper-missing` activation suppresses Step 1's spans

Inspected across [`skills/review-and-prep.md`](../../skills/review-and-prep.md) (`:185-189`, `:222`, `:933-942`, `:1100-1110`), [`docs/review-run-state-calls.md`](../review-run-state-calls.md) (`:9`, `:67`), and all `1,230` local receipt files:

- **Live incidence.** The scan found zero `Run state: unavailable (helper-missing)` markers in 1,230 retained local receipts. Runs without a retained receipt are outside that check.
- **Exact Step 1 ordering at `dd10953`.** The [skill's metrics section](../../skills/review-and-prep.md) (lines 185–189) defers inline writes under `run-state=record` to **Read an optional review policy** (lines 933–942 and 1100–1110). The [activation check](../review-run-state-calls.md#activation) runs `"<extend-root>/bin/review-state" --version` at that point. A failure switches to inline capture and records `Run state: unavailable (helper-missing)`. Line 222 of the skill forbids backfilling boundaries for earlier `evidence` or `scope` work. Later inline capture still requires a retained telemetry session ID and a recorded or replayed run begin.

### 3.3 Always-loaded pointer and fence overhead

Exact line and byte counts across revisions (`git show <rev>:<path>`), paired with the `0 protocol reading` uncached-input share from `21ecde089c5314c1a2ca214c16de5e3d35e69d7ee0efd6ad2c1db184e8cf7514`:

| Revision | `skills/review-and-prep.md` (always loaded) | `docs/review-run-state-calls.md` (loaded on demand when `run-state=record` is active) | Combined when `run-state=record` is active |
|---|---|---|---|
| `9c0d297` (`v0.89.0`, Track 77B opt-in caller land) | `4,972` lines / `329,384 B` | `44` lines / `8,550 B` | `5,016` lines / `337,934 B` |
| `d051274` (`v0.92.0`, Track 78A render land) | `4,983` lines / `330,277 B` | `47` lines / `13,711 B` | `5,030` lines / `343,988 B` |
| `dd10953` (`v0.99.0`, baseline for Track 86A) | `5,009` lines / `334,787 B` | `118` lines / `36,745 B` | `5,127` lines / `371,532 B` |

At `dd10953`, the measured blocks occupy 41 lines and 4,042 bytes in the always-loaded [`skills/review-and-prep.md`](../../skills/review-and-prep.md). Counts include line endings and count the whole policy grammar line containing the token.

| Block | Lines | Bytes |
|---|---|---|
| Five pointers at lines 185–189, 710, 800, 1590–1593, and 3160–3162 | 14 | 1,374 |
| Policy grammar line 937 and policy bullet at lines 1100–1110 | 12 | 1,191 |
| `REVIEW_STATE_DIR` fence precheck at lines 2608–2622 | 15 | 1,477 |

The opted-in reviewer reads the 334,787-byte skill, which still carries the inline procedures, and the 36,745-byte calls document. The calls document adds 11.0% over the skill alone, before any help reads. The phase classifier assigned 42.6% of uncached input (200,776 tokens) to protocol reading on PR `#270`, 25.0% (199,934) on PR `#272`, and 16.0% (102,393) on PR `#274`. The before range was 16%–31%. The three after-runs show no consistent drop in the protocol-reading share.

### 3.4 Installed caller journey and unchanged outward lines

The three measured builder runs exercise the [installed caller procedure](../review-run-state-calls.md). Earlier pilots supply additional refusal and finish evidence. The outward comparison uses the [published receipt and handoff contract](../workflow-handoffs.md).

1. **Activation, `build start`, and `derive`.** All three measured runs parsed `run-state=record`, passed the helper version check, recorded `start` through `bin/review-state build` to revision 1, and invoked `bin/gstack-extend-telemetry derive`. Earlier pilots predated the builder.
2. **`record pass` (`started`, `attempt`, `voice-complete`, `completed`).** PRs `#270`, `#272`, and `#274` retained 30, 48, and 31 requests, respectively, including native attempts and delegated attempts read through `--delegate-file` for maintainability, Red Team, and native adversarial. PR `#272` linked four failed delegate attempts to completed host fallbacks across maintainability and Red Team. On PR `#274`, the failed first-cycle outside challenge recorded unknown findings (`null`). The second-cycle challenge was a separate pass and recorded two findings.
3. **`record correction` (`supersedes`, rejected `unknown` resolution, and `build-overrides.jsonl`).** PRs `#270`, `#272`, and `#274` recorded 8, 56, and 18 finding corrections, respectively. Rejected findings have `resolution: "unknown"`. All those corrections were the first for their target and have `supersedes: null`. The latest-prior-correction rule and override logging are covered by `tests/review-state.test.ts`. No `build-overrides.jsonl` file was present in these three runs.
4. **`record gate` (`greptile`, `probe-<id>` + `REVIEW_STATE_DIR` baseline fence, `pregate`, `external-gate`) and `record audit` (`coverage`, `documentation`):**
   - `greptile`: recorded `not-run` on all three PRs;
   - `probe-<id>` gates in the retained states cover completion and scope, exploratory QA, plan test selection, and targeted reruns. The `REVIEW_STATE_DIR` fence checks that the cycle-one pass and a gate for each baseline probe are present on the same candidate before it writes the baseline.
   - `pregate` passed and `external-gate` was attested after resume on all three PRs. PR `#274` also recorded a failed probe before its repair.
   - `coverage` and `documentation` audits: recorded numeric thresholds (`80` with `pct: 94` on PR `#274`), string threshold explanations (`"PASS target 80%; gaps recorded (3)"` with `pct: 83.33` on PR `#270`), skipped `"n/a"` coverage (`pct: null, threshold: "n/a"` on PR `#272` after Track 85H's fix), and `current`/`updated` documentation audit reports with `{report_id, section_path, section_sha256}`.
5. **`checkpoint` (`before-fix`, `next-cycle`, `external-gate` + `pause`, `resume` via `show`, `ready`):** Exercised `before-fix` and `next-cycle` across multi-cycle repairs, `external-gate` + `pause` before external test handoffs, read-only `bin/review-state show --dir <evidence directory>` followed by `checkpoint resume` across `1` resume on PR `#274`, `2` resumes on PR `#270`, and `4` resumes on PR `#272`, and `checkpoint ready` before final rendering.
6. **Degraded capture and state refusals:** Historical pilot refusals `C1`–`C19` fell back inline as documented in [`docs/designs/review-run-state.md`](../designs/review-run-state.md) `D15`. On PR `#272` segment 1, the caller recorded `checkpoint pause` first and then attempted `build finish --outcome needs-context` (`238 B` `request-finish-<sha256-16>.json`), which the helper rightly refused with `status: "refused", reason: "paused"` (without incrementing `rev` or mutating state) because `finish` is only valid on an active unpaused segment; segment 2 then cleanly resumed via `show` and `checkpoint resume` and completed to `rev 141` (`finish.outcome: "prepared"`).
7. **`finish` and `render` (`full-receipt`, `comment`, `body`, `final`).**
   - `finish` recorded `prepared` on all three PRs, `stopped` in consumer C's `0.98.1` run at revision 96, and `needs-context` in an earlier `0.97.0` run at revision 15.
   - The runs exercised full-receipt, comment, body, and final rendering. PR `#270` retained a helper-rendered prepared handoff. PR `#272`'s prepared `final` call refused `auto_choice_lines` for that exit and the run published the handoff inline. PR `#274`'s prepared `final` calls refused an incorrect comment filename and then a comment that did not match finished state. The run used inline handoff lines with the v2 locators in the PR's compact receipt.
   - The retained compact comments and outward handoffs keep the published labels and field order, including `<!-- review-and-prep:receipt:<40-hex-head-sha> -->`, `Prepared HEAD:` with the appropriate tree/base or readiness fields, `Review handoff: review-and-prep/v1; review: COMPLETE; …`, `User-facing change:`, and the final `Stage handoff: stage-handoff/v1; stage: review; next: ship-and-land; status: done; …`. The 12-segment `Delegated part:` line ends with `cache_read_input_tokens`, `cache_creation_input_tokens`, `findings`, and `call` in that order. Local full receipts keep `delegation: active (…)` and `Run state: recorded (…)`.
   - On PR `#274`, the locally retained public comment matches the second rendered compact comment byte for byte. Both compact renders match the finished head, tree, and base. The public version uses [v2 receipt locators](../workflow-handoffs.md#receipt-locators) for `Full receipt:`, pregate `record:`, and documentation `section:`. The plan reference and evidence locators differ from the first render, which used local paths.

### 3.5 `D15` three-consecutive delegated-review `build` target

[`docs/designs/review-run-state.md`](../designs/review-run-state.md) `D15` (`:341-345`) states both the repository-local target (`:341`, three consecutive factory `/review-and-prep` runs of this repository) and the cross-repository restatement (`:343, 345`, three consecutive factory-orchestrated `/review-and-prep` runs with an active `delegate=` value on a helper release containing `build`, measured from the factory's own reviews' evidence directories across any repository it reviews):

1. **This repository (three consecutive reviews recorded through `build`).**
   - **PR `#270`** (`23f0bfc`, `writer: 0.98.0`, started `2026-11-17T17:52:23Z`): active `delegate=maintainability,adversarial,red-team`, recorded through `bin/review-state build` to `rev 61`, `finish.outcome: "prepared"`, and `Run state: recorded (…; rev 61)` in `full-receipt-1.md` and `full-receipt-2.md`.
   - *(PR `#271` ran `/docs-ship`, not `/review-and-prep`.)*
   - **PR `#272`** (`a9b8d5a`, `writer: 0.98.1`, started `2026-11-17T21:43:35Z`): active `delegate=maintainability,adversarial,red-team`, recorded through `bin/review-state build` to `rev 141`, `finish.outcome: "prepared"`, and `Run state: recorded (…; rev 141)` in `full-receipt-3.md`.
   - *(PR `#273` ran `/docs-ship`, not `/review-and-prep`.)*
   - **PR `#274`** (`dd10953`, `writer: 0.98.2`, started `2026-11-18T02:09:51Z`): active `delegate=maintainability,adversarial,red-team`, recorded through `bin/review-state build` to `rev 69`, `finish.outcome: "prepared"`, and `Run state: recorded (…; rev 69)` in `full-receipt-1.md`.
   - All three recorded delegated attempts with zero observed `invalid-input` refusals from `build`. That meets the repository-local writer check. The broader reading of D15's no-refusal condition is unfulfilled locally because both PR `#272` and PR `#274` had prepared `final` render refusals (section 3.4).
2. **All orchestrator-reviewed repositories (`docs/designs/review-run-state.md:343, 345` — not yet closed across all repositories):**
   - This timeline starts with the observed `0.98.x` cohort on 2026-11-17 and uses the latest writer in each saved state. The builder shipped in `0.96.0` (PR `#262`). Earlier `0.96.x` and `0.97.x` pilots provide separate reliability evidence, including the builder refusals cataloged in D15 as C16–C19. The cutoff separates the owner's three-run after sample from those pilots.
     1. `2026-11-17T17:16:30Z` (`consumer A`, `writer: 0.98.0`, `rev 66`, paused at external gate, `finish: null`);
     2. `2026-11-17T17:52:23Z` (**this repository PR `#270`**, `writer: 0.98.0`, `rev 61`, `finish: "prepared"`, `0` build `invalid-input` refusals);
     3. `2026-11-17T18:20:22Z` (consumer A, writer `0.98.1`, revision 122, open). The builder refused a new pass attempt on a closed voice with `invalid-input` and rule `voice-completed`.
     4. `2026-11-17T21:43:35Z` (**this repository PR `#272`**, `writer: 0.98.1`, `rev 141`, `finish: "prepared"`, `0` build `invalid-input` refusals);
     5. `2026-11-17T21:55:13Z` (`consumer A`, `writer: 0.98.1`, `rev 9`, `finish: null`) — hit a caller ID-format `invalid-input` refusal (`findings[0].finding_id` failing `safe-id`);
     6. `2026-11-17T22:01:08Z` (`consumer C`, `writer: 0.98.1`, `rev 96`, `finish: "stopped"`, `0` build `invalid-input` refusals, followed by its open continuation started `2026-11-17T23:45:26Z` on `writer: 0.98.2` at `rev 77`);
     7. `2026-11-18T02:09:51Z` (**this repository PR `#274`**, `writer: 0.98.2`, `rev 69`, `finish: "prepared"`, `0` build `invalid-input` refusals); and
     8. `2026-11-18T02:16:56Z` (`consumer A`, `writer: 0.99.0`, `rev 110`, open at `checkpoint ready`, `finish: null`, `0` build `invalid-input` refusals so far).
   - Only two finished runs with `Run state: recorded` follow the last builder refusal in the measured cross-repository sequence: consumer C's stopped run and PR `#274`. The other two runs were still open at measurement time. The cross-repository target remains open even when counted solely on builder refusals.
   - A later read found consumer A's last listed run prepared at revision 117. Consumer C's intervening continuation was still open. The acceptance snapshot above keeps the states observed at its cutoff.

## 4. Decisions (`E15` default and `D14` `seq` / `input_sha256`)

### 4.1 Default decision: `insufficient-evidence` (no default change)

Under [`docs/SPEC.md`](../SPEC.md) `O6.3` and `P1` and [`docs/designs/workflow-efficiency-program.md`](../designs/workflow-efficiency-program.md) `E15`, the decision on promoting `run-state=record` from opt-in to the default is **`insufficient-evidence`**:

1. **Missing data:**
   - **Owner by-hand (`user-directed`) runs (`0` of `>= 2` required):** `E15` requires at least `4` opted-in after-runs (`>= 2` by hand by the owner and `>= 2` orchestrated), measured with the same four caller-owned scripts (`6c02683e386f595eebb4df9593b8510db71c8ca5d823d748621b9545ec6c18f4`, `21ecde089c5314c1a2ca214c16de5e3d35e69d7ee0efd6ad2c1db184e8cf7514`, `184c3d84c550750c0f178fa3805e1d30d7ea9d11525549f528f9b1466f30d6c8`, and `c4054469f29d6ea43d650a0569940113a45ca188f92bf73cbfa953e75059e9f9`). At measurement time (`2026-11-18`), `n = 3` post-builder-fix orchestrated after-runs and `n = 0` owner by-hand after-runs exist.
   - **Other owner machines (`unknown`):** Synced telemetry and session records from the owner's other machines are not yet included (`unknown` per [`docs/SPEC.md`](../SPEC.md) `O6.1`).
   - **Cross-repository `D15` sequence.** The observed fleet sequence has yet to establish three consecutive qualifying runs. See section 3.5.
2. **Threshold and guardrails.** Mean bookkeeping-plus-resume output fell 27.3% in the available sample, short of the 50% target. For record completeness, all ten segment boundaries, stage rows, and expected projected events are present, including in sandboxed segments. Inline timing capture was partial in sections 2.5 and 3.1. For finding retention, each exported attempt's findings and eligible corrections matched the ledgers. For review outcomes, all three reviews reached `prepared` with the retained finding outcomes and compatible outward lines. An inline review of those same candidates was outside the sample, so outcome parity is unverified. The sample shows no dropped projected record or observed change in review disposition caused by recording. The two missing owner runs and the unverified guardrails prevent adoption.
3. **Bounded next measurement.
   - Complete at least two owner by-hand (`user-directed`) `/review-and-prep` runs sending `run-state=record` by `2026-12-25`, six weeks from the Track 78A release. Use the same four scripts and evaluate the combined after sample against the mean-count threshold and all three guardrails. With exactly five after-runs, half the before mean is 38,780 tokens per run. The two by-hand runs would have a combined budget of 24,677 bookkeeping-plus-resume tokens after accounting for the three measured runs. Retain each review's findings and dispositions before projection, and compare them with the exported records and outward outcome for the same head. Report missing phase or wait capture separately.
   - Under the [current roadmap rules](../ROADMAP.md), the regeneration that records this `insufficient-evidence` decision moves Tracks 88A and 89A to [Future](../roadmap-future.md). Promotion becomes eligible through those tracks when a follow-up within the window records `adopt` with the threshold and guardrails met. If the window closes short of the evidence required for adoption, this decision stands.
4. **Default status in this Track.** `run-state=record` remains an explicit opt-in `Review policy:` value.

### 4.2 Per-record `seq` and `input_sha256` decision: `dropped`

Design [D14](../designs/review-run-state.md) placed the decision on per-record `seq` and `input_sha256` in Track 86A. Both fields are **dropped**. No ordering or replay defect attributable to their absence was observed in the retained local sample from writer `0.89.1` through `0.99.0`, including PRs `#270`, `#272`, and `#274`.

1. **Locking, root revision, and ordered collections.** `src/review-state/store.ts` serializes mutations through `review-run-state.json.lock`. Each committed mutation increments root `rev` once. The state appends passes, attempts, corrections, gates, audits, and checkpoints in write order. Attempts inherit the pass segment, voice completion updates the pass, and finish stamps `finished_at`. The resulting order and segment bindings are stable for `render`, `export` and `show`. Export uses deterministic UUIDv5 event IDs.
2. **`D4` structural canonical comparison beats raw `--input` byte hashing (`input_sha256`):** Replay detection in `src/review-state/state.ts` compares normalized structural record fields (`D4`), ignoring helper-stamped timestamps (`started_at`, `completed_at`, `recorded_at`), `rev`, and `build` compatibility normalizations (such as `CRITICAL`/`INFORMATIONAL` severity mapping, derived `supersedes`, and `"n/a"` coverage thresholds). Requiring `input_sha256` match on raw request bytes would break legitimate normalized replays through `build` while duplicating the `request-<command>-<sha256-16>.json` files `build` already writes in `--dir`.
3. **Mixed-version schema compatibility.** Closed record validators in `src/review-state/state.ts` reject added keys in `review-run-state/v1` objects. Older readers would refuse a state containing the new keys. With a valid newer writer version, the refusal is `newer-schema`. Other validation failures under the same schema read as `corrupt`. See [design D6 and D14](../designs/review-run-state.md).

The remaining `D14` default-only items — automatic stale-lock reclamation, cross-host detection/refusal, moving a corrupt state aside, and the exit-5 internal-error result (`docs/designs/review-run-state.md:298-301`) — remain gated on Track 88A if a future measurement adopts `run-state=record` as the default.
