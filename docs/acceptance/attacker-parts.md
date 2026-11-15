# Attacker parts and red-team step: acceptance record

Track 72B, recorded against source revision `2d1b3e4` plus this Track's
implementation, with upstream gstack qualified at
`297f50c7e1d46aab1404f5f2e8a9584af76ad6b2` (`1.97.0.0`). This record covers
prose, fixtures and tests of two optional `Review policy:` additions —
`red-team=ensure` and the attacker values `adversarial` and `red-team` in
`delegate=` (see
[the policy grammar](../workflow-handoffs.md#grammar-h-e-continue) and
[delegated review](../delegated-review.md)) — and of the `bin/upstream-check`
anchors behind them (`review-and-prep.attacker`). No installed-agent run backs
it yet: a static prose test is not installed-agent acceptance
([SPEC](../SPEC.md)). It establishes no saving and awards no checkpoint
([SPEC](../SPEC.md) selected target acceptance and P1).

## Opt-in decision

Both additions are **opt-in only**:

- `red-team=ensure` (its only value) runs `/review-and-prep`'s red-team step
  when the review text the host will execute contains neither `Red Team` nor
  `red-team`, gated by upstream's Red Team activation (`DIFF_LINES > 200` or any
  specialist produced a `CRITICAL` finding). Naming `red-team` in `delegate=`
  also turns the step on under the same gate when `/review` has none.
- `delegate=` accepts `adversarial` (the native adversarial pass) and `red-team`
  (the Red Team) alongside the four specialist parts, each mapped in the
  caller's `review-delegates/v1` file, with today's fallback to the host model
  when a delegate fails. Findings keep `found_by` `native-adversarial` or
  `red-team` plus the v:3 `delegate` fields, with no new attribution label.
- With no `Review policy:` line, and under the light review default, nothing
  changes and nothing is recorded. Neither addition adds a question or a hold.

## Older producers

Each addition has its own caller-side capability check against
`<installed skill dir>/SKILL.md`, distinct from `delegate=<part>` (which older
installs also match):

- `grep -F 'delegate=adversarial,red-team' "<installed skill dir>/SKILL.md"` for
  the two attacker values in `delegate=`.
- `grep -F 'red-team=ensure' "<installed skill dir>/SKILL.md"` for
  `red-team=ensure`.

An older `/review-and-prep` install reads a policy line carrying either addition
as `none supplied`, and an older H-E parser holds it as `policy-malformed`.

## Pending installed-agent runs

No installed-agent run has closed both post-merge rows for this Track yet. Criterion 6 tracks
two post-merge runs, recorded below with their dated observations and remaining open items:

| Row | Status | Date | Scope | What it must show and where its evidence lives |
|---|---|---|---|---|
| `PM1` | pending | `2026-11-09` (inspected `2026-11-15`) | By-hand `/review-and-prep` run with no `Review policy:` and no `Review delegates:` line | After the release carrying this Track is installed, run one real by-hand `/review-and-prep` with no `Review policy:` and no `Review delegates:` line. Read its receipt back: it has no `Red team:`, `adversarial-pass:` or `delegation:` line, the same gates and stops run, and it passes as before. Record the date, revision, host and harness versions, and the PR in this table through a docs-only change. **Candidate inspected (`2026-11-15`):** `2026-11-09T04:07:03Z` on host `kb-xps` (Omarchy Linux, `workspace_host: "paseo"`), `gstack-extend` `0.76.1` (local stage-runs readback, post-Track 72B `v0.75.0` / `aa2f429`; upstream `gstack` `1.98.0.0`), harness version `unknown` (`agent: null`, `agent_source: "unknown"`), `kbitz/omarchy-dropbox` PR #11 (pre-ship head `57dc60f265438a086d66c794d89674ace356bae9`, merged head `94deda578ecae898aa32fe73dec4beb46e033dc6`). **Remains pending:** the `2026-11-09T04:07:03Z` segment was a 14-second post-`pair-review` resume (initial review passes ran `2026-11-08T18:46Z–19:47Z` without a `stage-runs` row proving `v0.75.0+` was loaded then); `/ship-and-land` at `2026-11-09T04:11:52Z` replaced the PR body (`Path: independently verified reuse (no marked review-and-prep handoff); FULL profile`), PR #11 has no issue comments, and the retained project evidence contains no `/review-and-prep` receipt, so neither the invoking prompt nor the `/review-and-prep` receipt is available; and harness version was not captured. Waits on the owner's next by-hand `/review-and-prep` run with retained invocation and receipt evidence. |
| `PM2` | pending | `2026-11-13`–`2026-11-15` (inspected `2026-11-15`) | Orchestrated `/review-and-prep` run with `delegate=adversarial,red-team` and per-part models | Run one orchestrated `/review-and-prep` whose caller sends `Review policy: …; delegate=adversarial,red-team` (plus `red-team=ensure` on a host whose `/review` has no Red Team) and a `Review delegates:` file that maps `adversarial` and `red-team` to different providers or models (effort in each provider's `argv`). Record the `Delegated part:` lines, the v3 attempts, the `found_by` labels (`native-adversarial`, `red-team`) and any fallbacks in this table. **Partial observations recorded below (`kbitz/gstack-extend` PR #250, `kbitz/gstack-extend` PR #253, and `kbitz/mmm-factory` PR #185); remains pending** only on explicit harness CLI binary version provenance (`stage-runs` v4 records `agent` and `model`, not CLI binary version) and, in PR #250 alone, `workflow-metrics` v3 `pass` attempts when `Run state: unavailable (invalid-input)` prevented helper recording before Track 80A (PR #253). |

### `PM2` dated observations (`2026-11-15` inventory)

- **`kbitz/gstack-extend` PR #250 (`2026-11-13`, Track 79A part 1):**
  - **Date and revisions:** `2026-11-13T19:27:49Z`–`2026-11-13T21:14:51Z`; `gstack-extend` `0.92.0` (base `d05127415d481e54ad07a9f8a43c026b36a55f34`, cycle-1 head `eb7fdf71ab9a2b37d9b60889d2c5f7366d05c5f9`, cycle-2 repair head `13592e35bfef01d09a0c4526098a4850b21872c3`, prepared head `6baf740c1ec8b047181331e2af2f90d1d539c789`, merge commit `31f59ad2971c7c1da5bb5db45d8e2bc430628496`); upstream `gstack` `1.98.0.0`.
  - **Host and harness:** `3771h-kb-xps` (Omarchy Linux, `workspace_host: "paseo"`), agent `claude` (`model: "claude-opus-5-5"`, `effort: "max"`, `entrypoint_raw: "Paseo"`); exact Claude Code CLI binary version `unknown` (not persisted in `stage-runs` v4).
  - **PR and receipt:** `https://github.com/kbitz/gstack-extend/pull/250` (`#issuecomment-6864973579`; `full-receipt-2.md` SHA-256 `b0764f675adb2de22f19b33e5a62feedac3e06e64dfa2b1659ad72b2dfc719bc`).
  - **Policy and headers:** `Review policy: review-and-prep-policy/v1; ...; delegate=maintainability,adversarial,red-team; ...; run-state=record; ...`; `delegation: active (parts=maintainability,adversarial,red-team; config=fbd20a1e3b89152244f7d442622f0aa395c4ed732ee4f3dea5de100a199c002f)`; `adversarial-pass: waived (delegate; cycles=1)`; `Red team: upstream — installed /review source section carries one`.
  - **`Delegated part:` receipt lines:**
    - `Delegated part: red-team; provider=antigravity-2; model=gemini-4-carbon-high; outcome=credited; reason=none; wall_ms=508332; input_tokens=48930; output_tokens=48445; cache_read_input_tokens=0; cache_creation_input_tokens=unknown; findings=4; call=6b18f0eba98f6f03becb5d75f742eae1f08f29ff52696ebb3eac80bf30b15707`
    - `Delegated part: adversarial; provider=claude-1; model=claude-opus-5-5; outcome=credited; reason=none; wall_ms=276135; input_tokens=2; output_tokens=28766; cache_read_input_tokens=658; cache_creation_input_tokens=51730; findings=9; call=30ff45877e0f43992e7c7162e04b6b9aa3b525161de117a19d15f866a4c1039f`
    - `Delegated part: adversarial; provider=claude-1; model=claude-opus-5-5; outcome=credited; reason=none; wall_ms=123969; input_tokens=2; output_tokens=12878; cache_read_input_tokens=658; cache_creation_input_tokens=18336; findings=5; call=4d806dea46bc407fe40a12cba7ea1291b6eb33975d2b3cb8f1745ab2863dadcf`
    - (`maintainability` ran on `provider=antigravity-1; model=gemini-4-argon-high` in cycles 1 and 2 with `outcome=credited; reason=none; findings=0`.)
  - **`found_by` labels and fallbacks:** findings carry `found_by=core,red-team,native-adversarial,outside:challenge,outside:structured` (`docs/review-run-state-calls.md:41:resume-contract`), `found_by=red-team` (`src/review-state/show.ts:230:red-team`), `found_by=core,specialist:testing,qa,native-adversarial,outside:challenge,outside:structured` (`src/review-state/show.ts:272:testing`), and `found_by=native-adversarial` on non-blocking findings (`src/review-state/state.ts:681,772`, `src/review-state/show.ts:231,279`, `docs/review-run-state-calls.md:37,38,51`). Fallbacks: `0` (all five delegated calls succeeded; `voices.jsonl` records all five `delegate` objects).
  - **Unsatisfied in PR #250 alone:** `Run state: unavailable (invalid-input)` (before Track 80A accepted policy delegate names in `bin/review-state`) prevented `review-run-state.json` creation and `workflow-metrics` v3 `pass` attempt derivation (`Workflow metrics (local, optional): capture=partial (run-state unavailable: invalid-input; initial telemetry start state-unwritable, no session ID)`), and the exact CLI binary version was not recorded.
- **`kbitz/gstack-extend` PR #253 (`2026-11-13` / `2026-11-14`, Track 80A — supplies `workflow-metrics` v3 `pass` attempts):**
  - **Date and revisions:** `2026-11-13T23:03:09Z`–`2026-11-14T00:31:44Z`; `gstack-extend` `0.93.0` (base `731066074b7e3ac58f79d87371e5d68c62981728`, prepared head `beeac3551d7ea69d7e5e5d287b825e6ca21bdcea`, later re-prepared after base merge at `323fab974ed7ee245ab849a6eec97884c093c15f` `#issuecomment-6873040048` and merged as `50c641fee7f548b2630f0f7a24826ddbcd0c9eab` / `v0.93.2`).
  - **Host and harness:** `3771h-kb-xps` (Omarchy Linux, `workspace_host: "paseo"`), segment 1 agent `claude` (`model: "claude-opus-5-5"`, `effort: "max"`) and segment 2 agent `codex` (`model: "gpt-6.1-sol"`, `effort: "max"`); exact CLI binary versions `unknown` (not persisted in `stage-runs` v4).
  - **PR and receipt:** `https://github.com/kbitz/gstack-extend/pull/253` (`#issuecomment-6868547148`; `full-receipt-1.md` SHA-256 `4a5c65fd51bd8c2aa81869e9cc6109bdd2f044b903b80902649c725d8e0879fc`; `Run state: recorded` (revision `67`)).
  - **Policy and `Delegated part:` receipt lines:** `delegation: active (parts=maintainability,adversarial,red-team; config=6989bdfe12ac054ef8da9174ed89fd01b419b3fcce415b48fc7767e173edd440)`; `adversarial-pass: waived (delegate; cycles=1,2,3)`; `Red team: wrapper (source=delegate=red-team; cycles=1:ran,2:skipped — light default repair cycle; source: repair-cycles=light,3:skipped — light default repair cycle; source: repair-cycles=light)`:
    - `Delegated part: red-team; provider=antigravity-2; model=gemini-4-carbon-high; outcome=credited; reason=none; wall_ms=251615; input_tokens=36530; output_tokens=24985; cache_read_input_tokens=0; cache_creation_input_tokens=unknown; findings=1; call=489028efbd325162c90242ae2c676732b3c9696c4f4441f9c7e57d69f656bb1f`
    - `Delegated part: adversarial; provider=claude-1; model=claude-opus-5-5; outcome=credited; reason=none; wall_ms=165103; input_tokens=2; output_tokens=17093; cache_read_input_tokens=658; cache_creation_input_tokens=34363; findings=3; call=cd395e2fe73f25f465080a4f5814ff19f4f8d4d8fec4f1819a307cbad29d9b93`
    - `Delegated part: adversarial; provider=claude-1; model=claude-opus-5-5; outcome=credited; reason=none; wall_ms=71737; input_tokens=2; output_tokens=7011; cache_read_input_tokens=658; cache_creation_input_tokens=9411; findings=2; call=dcf338d5d744cfc40d3acf3682671905c78248945878496f959ee50d44ad0e91`
    - `Delegated part: adversarial; provider=claude-1; model=claude-opus-5-5; outcome=credited; reason=none; wall_ms=58447; input_tokens=2; output_tokens=6090; cache_read_input_tokens=658; cache_creation_input_tokens=10585; findings=3; call=c72eb8875cac86c5dca7fd72327240a71d65a4e8d38ad5d3a8a748ef729e83e1`
  - **v3 `workflow-metrics` attempts, `found_by` labels, and fallbacks:** the retained local workflow-metrics ledger for PR #253 (lines 52–55, 68–70, 78–80; derived via `derive-finished.json` with `replayed: 44, failed: 0`) records `v: 3`, `op: "pass"`, `state: "attempt"` events for both `voice_id: "red-team"` (`provider: "antigravity-2"`, `model: "gemini-4-carbon-high"`, `outcome: "credited"`, `findings: [{"finding_id": "F-RT1", ..., "found_by": ["red-team"]}]`) and `voice_id: "native-adversarial"` (`provider: "claude-1"`, `model: "claude-opus-5-5"`, `outcome: "credited"`, `findings: [{"finding_id": "F-ADV1", ..., "found_by": ["native-adversarial"]}, ...]`); receipt findings carry `found_by=red-team,qa` (`src/review-state/state.ts:317:red-team`) and `found_by=native-adversarial,outside:challenge,outside:structured` (`src/review-state/state.ts:317:adversarial`). Fallbacks: `0`.
- **`kbitz/mmm-factory` PR #185 (`2026-11-14` / `2026-11-15` — supplies fallback-to-host-subagent observation):**
  - **Date and revisions:** `2026-11-14T20:18:07Z`–`2026-11-15T03:08:05Z`; `gstack-extend` `0.93.2`–`0.94.0` (`producer_version: "0.94.0"` on the v3 `pass` attempt rows; `kbitz/mmm-factory` base `84ea3b1b267dd77e7f9b05f292c4becd07bba85a`, prepared head `8fa303f9fb8e7529eabcb87193fd75577ecfb539`).
  - **Host, harness, PR, and receipt:** `3771h-kb-xps` (Omarchy Linux, `workspace_host: "paseo"`), agent `codex` (`model: "gpt-6.1-sol"`, `effort: "max"`, CLI binary version `unknown`); `https://github.com/kbitz/mmm-factory/pull/185` (`#issuecomment-6888192357`; `full-receipt-8.md` SHA-256 `3fbe4b8ea29c9294a8aff84cd808aac969360a5b2a737ef4c95705067ebf25fb`).
  - **Fallback and v3 `pass` attempt evidence:** in the retained local workflow-metrics ledger for PR #185 (lines 56–58), `voice_id: "red-team"` (`provider: "antigravity-2"`, `model: "gemini-4-carbon-high"`) returned `outcome: "fell-back"`, `fallback_reason: "needs-context"` (`attempt_outcome: "failed"` on line 56; receipt `Delegated part: red-team; provider=antigravity-2; model=gemini-4-carbon-high; outcome=fell-back; reason=needs-context; wall_ms=36662; input_tokens=81531; output_tokens=2627; cache_read_input_tokens=0; cache_creation_input_tokens=unknown; findings=0; call=bfa7bf1e940f82f9b683a24d7f375d37cb6b3359592d7e9673ebd9c6a9526c42`), and the host subagent immediately ran as the fallback (`state: "attempt"`, `voice_id: "red-team"`, `attempt_outcome: "completed"`, `delegate: null` on line 57, recording 2 findings with `found_by: ["red-team"]`), while `voice_id: "native-adversarial"` (`provider: "claude-1"`, `model: "claude-opus-5-5"`) completed as `outcome: "credited"` on line 58 with 11 `found_by: ["native-adversarial"]` findings.

## Release-note input

Release files (`CHANGELOG.md`, `VERSION`, `package.json`, `bun.lock`) are
written at the release step, not on the implementation branch:

- **Level:** `minor` (0.x compatible addition to a stable surface: new opt-in
  `review-and-prep-policy/v1` values, [SPEC](../SPEC.md) Release policy "During
  0.x: compatible additions use MINOR").
- **User-facing change:** `/review-and-prep` accepts two opt-in review-policy
  additions: `red-team=ensure` runs a red team when the installed `/review` has
  none, and `delegate=` now also takes `adversarial` (the native adversarial
  pass) and `red-team`, each sent to the provider and model its
  `review-delegates/v1` file maps; a run with no `Review policy:` line is
  unchanged.
- **Upgrade risk:** an older `/review-and-prep` install reads a policy line
  carrying either addition as `none supplied`, and an older H-E parser holds it
  as `policy-malformed`, so callers first check `grep -F 'red-team=ensure'` and
  `grep -F 'delegate=adversarial,red-team'` against the installed skill;
  `bin/review-delegate` gains `--adversarial` and `--caught` and the refusal
  `caught-unreadable`, while its existing flags, exits and output keys are
  unchanged.

## What this Track does not claim

- No saving or quality result: delegated attacker parts see only the frozen
  diff (with fixture bytes in full), never repository files, and retained
  quality is unmeasured until `PM2`.
- No spend: nothing in the test suite calls a model or provider.
- No default change: no value, light default or config key turns `red-team=ensure`
  or `delegate=` on.
- Open acceptance rows remain pending: `PM1` waits on a by-hand `/review-and-prep`
  run with retained invocation and receipt evidence, and `PM2` records its dated
  observations across PRs #250, #253, and #185 while remaining pending on
  explicit harness CLI binary version provenance.
