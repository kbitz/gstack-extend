# Review independence on the Cursor harness

Snapshot date: 2026-09-25. This file is the measurement and the rule. It changes no code.

## 0. Answer first

A configuration is (route, primary vendor, author set). Read the row that matches the harness, the model vendor that ran the review, and the vendors that wrote the reviewed branch. `derived` rows come from the static voice map. They do not by themselves authorize a fix. `measured-cells=0` on this snapshot: no review joined to a workspace path and a recorded writer.

[Compute a verdict](#2-worked-example). [Re-run after an upgrade](#12-appendix).

```
TABLE answer
route=cursor-cli primary=xai authors={openai} verdict=FAIL reasons=config-unsatisfiable provable-today=no label=derived excluded-from-in-use=probe-mechanism-confirmation
route=cursor-cli primary=xai authors={anthropic} verdict=UNMEASURED reasons=(none) provable-today=no label=derived
route=conductor-native primary=xai authors={anthropic} verdict=UNMEASURED reasons=(none) provable-today=requested-only-primary label=derived
route=conductor-native primary=xai authors={openai} verdict=FAIL reasons=config-unsatisfiable provable-today=no label=derived
route=claude primary=anthropic authors={anthropic} verdict=UNMEASURED reasons=(none) provable-today=when-logs-exist label=derived
route=codex primary=openai authors={anthropic} verdict=UNMEASURED reasons=(none) provable-today=when-logs-exist label=derived
route=grok-build primary=xai authors=unknown verdict=HISTORICAL reasons=(none) provable-today=no label=historical
```

Cursor CLI with an xAI primary and an OpenAI author cannot grow an independent voice: the outside voice is Codex, and Codex is OpenAI (`scripts/resolvers/outside-voice.ts:8` in gstack 1.89.0.0). That row is the mechanism this track was opened to test. It is derived. The live Codex-authored branch is mechanism confirmation and is excluded from "in use". Conductor-native with the same author set is the same static failure. Neither row was seen as a joined review in the 30 days before the probe, so neither drives the routing call.

Proving record, by route: Conductor-native primary is `runs.ndjson` `model.id` (requested). CLI primary and any Cursor subagent need billing events from `events()` (`bin/lib/quota/readers/cursor.py:57`). A served billing record is missing on this machine because `CURSOR_API_KEY` is unset, so CLI proof is unavailable today. Cursor transcripts do not carry a model. That is a limitation, not a filed change.

## 1. Question, definitions, verdict, policy

Question: when a gstack review runs through Cursor, does at least one consumed voice come from a model vendor that neither wrote the code nor ran the primary review, and can that be shown from records the harness wrote?

Vendor separation stands in for independent judgment. This track does not measure whether that proxy catches more defects. That measurement is [Measure whether vendor separation catches more real defects](../TODOS.md).

Policy defaults: `exclude_vendors: [author, primary]`, `min_independent: 1`, `undisclosed_vendors: [cursor]`, `counted_voice_kinds: [outside, in-host adversarial, specialists, external bots]`, `proof_sources: served, or requested-only when no served record contradicts it`. Under the alternative `exclude_vendors: [author]`, a Cursor review whose primary is xAI and whose author is OpenAI becomes satisfiable, because the xAI primary is no longer excluded. This document does not recommend that alternative.

Definitions:

- Voice: one reviewer pass whose output reaches a review gate. Kinds: primary structured review, in-host adversarial subagent, outside voice (`codex exec`, `codex review`, `claude -p`), specialist subagents, external bots.
- Vendor: `model_vendor()` in `bin/lib/quota/common.py:279`. Patterns, first match, case-insensitive: `claude|opus|sonnet|haiku|fable` to anthropic; `gpt-|o[1-9]` to openai; `grok-` to xai; `composer-|vega` to cursor; otherwise unknown. Unknown is never independent. Vendor `cursor` is undisclosed lineage and is never proven independent.
- Author vendors: recorded writer stages (`implement`, and any later fix pass) on the reviewed repo and branch whose `started_at` is before the reviewed commit's commit time. A stage that only commits unchanged content is not an author. Coverage is `writers: recorded-only` unless complete coverage is shown. Evidence of a writer that never reached `stage-runs.jsonl` is `cause=unrecorded-writer`.
- Primary vendor: the model running the host session that invoked `/review`, `/ship`, `/autoplan`, or `/review-and-prep`. `/codex` alone makes Codex the primary and has no host voice.
- Completed, consumed result: from the review row alone. `status` is `clean` or `issues_found`. An outside voice also needs `outside_status: completed`. An in-host pass needs `completed: true`. Those fields are written by the review-log command in gstack `review/sections/adversarial.md:223`. Prose without markers is logged `unavailable`.
- Proven vendor: observed evidence covering every model that contributed in the voice's window. Served records (billing events; Claude transcript `message.model`) prove a vendor. A requested record (Conductor `model.id`, Codex `turn_context.model`, a command-line `--model`) proves a vendor only when no served record contradicts it, and the cell is `requested-only`. Router aliases (`auto`) are `cause=alias`. Supplied values are not proof: `outside_provider`, finish `--agent` or `--model`, a command-line `--model` used as the only evidence, free-text `scope` or `summary`, and the top-level quota run `model` (`bin/lib/quota/ledger.py:297` copies caller metadata). The quota run `complete` flag and settlement state are not model proof.
- Independent voice: a consumed voice whose proven vendor is outside the author set and is not the primary vendor.
- Acceptance, for any later fix: every review has at least one independent voice, checkable by the join keys in section 9.
- Satisfiability: no dispatched voice kind can land outside the author set and off the primary. Same-harness subagents count only where a record shows they can run a different model than the primary. On this snapshot, no such record exists for Cursor.

A review is one group of rows sharing project slug, filename branch, `commit_full`, and `review_binding.started_at` (or the start token). Merged phase rows count once. A row whose branch is empty is `cause=no-slug-mapping` and is never a cell. The JSON object often has no `branch` field (`bindReview` in gstack `lib/review-evidence.ts:79` does not copy the branch). The branch key is the filename `$BRANCH-reviews.jsonl` (`bin/gstack-review-log:72`).

PASS requires at least one consumed proven independent voice, which requires every author vendor and the primary vendor proven. A PASS has no reason. It states `evidence: served` or `requested-only`, and `writers: recorded-only` or `complete`. Every review, PASS or FAIL, lists each voice (vendor, proof, same-vendor). FAIL lists every applicable reason, and at least one.

| Reason | When |
|---|---|
| `outside-same-vendor` | A consumed outside voice's proven vendor is the primary or an author |
| `outside-missing` | No voice from a harness other than the primary's was consumed |
| `voice-vendor-unproven` | A consumed voice's vendor is not proven |
| `voice-vendor-unmapped` | The model is proven and `model_vendor()` returns None |
| `voice-vendor-undisclosed` | The proven vendor is `cursor` |
| `primary-vendor-unproven` | The primary vendor is not proven |
| `author-vendor-unproven` | An author vendor is not proven |
| `config-unsatisfiable` | The static satisfiability test fails |

| Cause | What to do | Counts toward a provenance go |
|---|---|---|
| `no-credential` | Set `CURSOR_API_KEY` for the billing reader only | no |
| `unsettled` | Wait five minutes after the run ends and read again | no |
| `probe-induced` | The probe harness caused it (allowlist, timeout, sandbox, auth not inherited). Say whether it reproduced outside the probe | no |
| `window-ambiguous` | Candidate records in the window disagree on vendor | yes |
| `partial-coverage` | The billing read does not cover the window | yes |
| `multi-model` | Events in the window map to more than one vendor | yes |
| `requested-only-contradicted` | A served record disagrees with the requested model | yes |
| `alias` | The model id is a router alias | yes |
| `no-turn-bounds` | Billing events have no turn start and end | yes |
| `unrecorded-writer` | A writer exists and no `stage-runs.jsonl` row records it | yes |
| `not-recorded` | No source records the model | yes |
| `timeout`, `auth-rejected`, `rate-limited`, `sandbox-refused`, `unsupported-version`, `schema-changed` | Source failure, original code from `bin/lib/quota/common.py` | yes |
| `workspace-archived` | Resolve the path from Conductor workspace records, including archived rows | route |
| `no-slug-mapping` | Empty branch. Not a cell | route |
| `no-cwd-match` | No workspace path for the filename branch | route |

Cursor voice proof (primary on the CLI, Conductor-native primary when the store shows an alias or disagrees with billing, and any subagent), from billing events read with `events(start, end)`:

- One fully paged read covers run start minus skew through run end plus 10 minutes plus skew.
- Two reads at least five minutes after the run ends return the same events.
- Every event whose `conversationId` equals the session id maps through `model_vendor()` to one vendor.
- Missing turn bounds are `cause=no-turn-bounds`.
- Step 0, before matching: events must carry `turnStartedAt` and `turnEndedAt`, events for one `conversationId` must distinguish parent turns from subagent turns, and a parent window must not enclose the subagent windows. If that fails, subagent models are structurally unprovable.
- `conversationId` comes from the CLI transcript directory name, or from `agents.ndjson` by a unique cwd and time window. Never from the environment.
- A CLI subagent window is the transcript file's `st_birthtime` through `st_mtime`. Conductor-native subagents have no recorded window unless the store records subagent runs. This snapshot's store does not.
- `gstack-extend quota sample` records consumption. Its `complete` and settlement fields never prove a model.
- Several Codex sessions in one window are ambiguous only when they disagree on vendor (`cause=window-ambiguous`).
- A voice counts only through a unique chain from the reviewed commit and tree, to the session, to the review row, to the gate that consumed it. A broken link leaves the voice unproven.

`bin/lib/quota/cursor_cost.py:34` reads `turnStartedAt` and `turnEndedAt`. `boundaries()` at `:53` falls back to SDK run bounds. Model evidence is on the event at `:102` and on the source row at `:155`. Line 143 is the facts lookup, not the model field.

## 2. Worked example

Copy the evaluator in section 12 and run it from this repository with the snapshot path. Expect the output below. The block imports `model_vendor` from `bin/lib/quota/common.py` when that file is on a parent of the working directory, and otherwise uses the patterns in section 1.

```
SAMPLE pass-served
verdict: PASS
reasons: (none)
assurance: evidence=served writers=recorded-only
observation: kind=outside vendor=openai proof=served same-vendor=False
SAMPLE outside-same-vendor
verdict: FAIL
reasons: outside-same-vendor
causes: (none)
observation: kind=outside vendor=openai proof=served same-vendor=True
SAMPLE voice-vendor-unproven
verdict: FAIL
reasons: voice-vendor-unproven
causes: no-turn-bounds
observation: kind=outside vendor=(unproven) proof=served same-vendor=None
SAMPLE supplied-model
verdict: FAIL
reasons: voice-vendor-unproven
causes: not-recorded
observation: kind=outside vendor=(unproven) proof=supplied same-vendor=None
rejected: supplied model is assignment, not proof
SAMPLE empty-branch
not-a-cell cause=no-slug-mapping
```

The supplied-model sample is the quota top-level `model` counterexample: a caller-supplied id is ignored, and the voice stays unproven.

An automated extract-and-assert test is deferred: [Automated test for the review-independence doc's reference evaluator](../TODOS.md). Until it lands, replay is the manual extract in section 12.

Live recipe for one historical Claude-hosted, Claude-authored review with a Codex outside voice. This snapshot found no such joined review (`implement-branch-matches=0`). The commands print counts only.

```
python3 -c 'import json; from pathlib import Path
n=0
for p in Path.home().joinpath(".gstack/projects").glob("*/*-reviews.jsonl"):
  for line in p.read_text(errors="replace").splitlines():
    try: row=json.loads(line)
    except Exception: continue
    if row.get("host")=="claude" and row.get("source")=="codex" and row.get("outside_status")=="completed": n+=1
print("claude-hosted-codex-completed", n)'
```

```
python3 -c 'import json; from pathlib import Path
rows=[json.loads(l) for l in Path.home().joinpath(".gstack-extend/analytics/stage-runs.jsonl").read_text().splitlines() if l.strip()]
print("implement", sum(1 for r in rows if r.get("stage")=="implement"), "claude-implement", sum(1 for r in rows if r.get("stage")=="implement" and r.get("agent")=="claude"))'
```

Match a candidate review's filename branch to an `implement` row with `agent` `claude` and `started_at` before the commit time. Read `message.model` on that Claude transcript and `turn_context.model` on the Codex rollout with the same cwd and window. Do not copy raw lines into this document.

## 3. Routes, dates, versions

Cutoff for historical rows: 2026-09-25T12:21:00Z, recorded before the first live attempt at 2026-09-25T12:26:24Z. Replay of this snapshot: 2026-09-25.

| Tool | Version | Source |
|---|---|---|
| gstack | 1.89.0.0 | `~/.claude/skills/gstack`, commit 06ed920, 2026-09-24 |
| gstack-extend | 0.29.0.1 | VERSION file, commit a952f8d |
| cursor-agent | 2026.09.23-86fc751 | `cursor-agent --version` |
| codex | 0.155.1 | `codex --version`, auth mode ChatGPT subscription |
| claude | 2.1.282 | `claude --version`, auth mode claude.ai first party |
| Conductor | 0.87.3 | `CFBundleShortVersionString` |
| macOS | 26.6.2 build 25G83 | `sw_vers` |

P0. Execution blockers: none. `cursor-agent`, `codex`, and `claude` are installed. In the parent session, `cursor-agent status` was logged in. Evidence limitation: `CURSOR_API_KEY` is unset, so billing proof is unavailable and those voices are unproven with `cause=no-credential`. Expected gap: gstack-extend skills are not installed on Cursor (`setup` has no Cursor target). `/review-and-prep` is absent on Cursor and present under Claude and Codex skill directories. `CODEX_SANDBOX_NETWORK_DISABLED` was unset. gstack telemetry tier is `off`, so `gstack-telemetry-log` does not upload; probe rows stay on the machine. The dry run in the scratch repo returned slug `scratch`, which did not collide with an existing project directory. `origin/HEAD` was missing, so a local bare repository under the probe directory was added as `origin` and `main` plus both author branches were pushed there. Nothing was pushed to a network remote.

Invalidation: these tables are stale when gstack's outside-voice resolver or review-log fields change, when the Cursor or Conductor store schema changes, or when `model_vendor()` changes. A re-run appends a new dated snapshot and keeps this one. Retention: Claude Code prunes transcripts after 30 days by default, so the 2026-09-15 through 2026-09-20 rows expire around mid-October 2026. Billing history depth was not observed, because the credential is unset.

## 4. Evidence sources

| Id | Record | Class | Proves | Does not prove | Path |
|---|---|---|---|---|---|
| E1 | `~/.gstack/projects/<slug>/<branch>-reviews.jsonl` | assignment | host, source, outside_provider, outside_status, phase, status, completed | model or vendor | filename branch; JSON has no model on the cursor and grok rows re-read here |
| E2 | Conductor `cursor-sdk-store/*/runs.ndjson` | requested | `model.id` when it is a concrete id and billing does not contradict it | that a CLI session or a subagent ran that model | `model.id`, `model.params` as `{id,value}`, `updatedAt` epoch milliseconds |
| E3 | `stage-runs.jsonl` | mixed | harness `agent`, and `model` when the wrapper verified it | Cursor review voices, which are gstack skills | fields in section 9, pending Track 16A |
| E4 | `cursor_turns()` | none on the live store | nothing until the reader accepts the store shape | model or effort | `bin/lib/telemetry.py:483` |
| E5 | Cursor CLI transcripts | none | that a session existed (mtime) | model | role and message only. Not filed |
| E6 | gstack skills vs extend skills | n/a | which skill writes provenance | review-voice models | only extend skills append `stage-runs.jsonl` |
| E7 | `outsideVoiceFor` | code | which outside CLI a host dispatches | which model that CLI ran | `scripts/resolvers/outside-voice.ts:1` and `:8` |
| E8 | host render | code | `host` field | vendor | `hosts/cursor.ts:4` writes host cursor. There is no grok host. Historical `host: grok` rows were typed by the agent on the Claude render |
| E9 | composition | derived | when the author set collides with Codex or with the primary | a measured cell | section 6 |
| E10 | Cursor billing events | served | charged `model` per `conversationId` when the proof predicate holds | subagent identity when turn bounds are absent | `bin/lib/quota/readers/cursor.py:57`. `conversationId` equals Conductor `agentId` |
| E11 | `model_vendor()` and quota store parsing | code | vendor from a concrete id; epoch-ms times via `timestamp()` at `bin/lib/quota/common.py:108` | a model the map returns None for | quota usage reads `model.id` without requiring dict params |

Re-verified counts at cutoff: 8 `host: cursor` rows (dates 2026-09-23 and 2026-09-25), 10 `host: grok` rows (2026-09-15 through 2026-09-20). Cursor rows: in-host adversarial with `outside_status` skipped or pending; Codex adversarial `outside_status: completed`; Codex structured `completed` on one branch and `unavailable` on two. No cursor or grok row carries a model id. `stage-runs.jsonl` had 14 rows: agents claude, codex, grok, and two cursor rows with `model` null. Store: 40 runs, all `model.id` `grok-4.7`, `updatedAt` int, `model.params` a list of `{id,value}`.

E4 offline, isolated HOME, `CURSOR_AGENT=1`, conversation id set to the copied agent id, cwd rewritten to the check directory: `parse_ts` (`bin/lib/telemetry.py:273`) returns None for integer `updatedAt`, `startedAt`, and `endedAt`; `cursor_turns()` returns no turns. That is the shape failure, separate from a cwd mismatch. The same `parse_ts` is used on `startedAt` and `endedAt` at `bin/lib/telemetry.py:616`, so every run for a cwd passes the window test and a Conductor-native route is detected only when exactly one run exists for that cwd.

Billing step 0 was not run. `CURSOR_API_KEY` is unset. That is an evidence limitation, not a mismatch, and it did not stop the CLI attempts. Skew was not measured, because there is no billing timestamp to compare with a local marker.

## 5. Static voice map

Installed gstack 1.89.0.0. Host detection is the render: Claude and Codex load their skill directories; Cursor loads `~/.cursor/skills/gstack-review` (skill name `review`). `outsideVoiceFor` (`scripts/resolvers/outside-voice.ts:8`): on host `codex` the outside voice is Claude Code (`claude -p`); on every other host it is Codex. The in-host adversarial pass is an Agent-tool subagent. gstack says model identity stays unknown unless the runtime reports it (`review/sections/adversarial.md:75`).

| Entry | Host | Primary | Outside | In-host adversarial | Gate |
|---|---|---|---|---|---|
| `/review` (Cursor skill name `review`) | claude, cursor, grok historical | host session | Codex | Agent tool, same harness | Codex structured only when the diff is 200 lines or more (`review/sections/adversarial.md:152`, skip at `:215`) |
| `/ship` adversarial | same | host session | Codex | same | same size gate |
| `/codex` | any | Codex | none; Codex is primary | n/a | the skill is the outside voice |
| `/autoplan` dual voices | claude, codex, cursor | host session | the other CLI | native subagent | outside runs when preflight is ready |
| `/review-and-prep` | claude, codex | host session | Codex, plus Greptile when configured | n/a | absent on Cursor |

Questions before voices: the gstack preamble can ask for a base branch and for whether to apply fixes. The probe set `GSTACK_SESSION_KIND=spawned` so those auto-resolve, and the prompt forbade edits. Because `spawned` may choose fixes, a clean tree and an unchanged tree hash are required for a live run to count.

Cursor on this machine runs the Cursor render (host cursor in the Cursor review skill). Grok Build used the Claude render, which hard-codes host claude, and the `host: grok` rows were agent-typed.

## 6. Satisfiability and provisional calls

Provisional calls, from E7 through E9, before the first live attempt (2026-09-25T12:21:00Z):

- Routing: go, by construction, for Cursor with primary xAI and author OpenAI. The outside voice is Codex. Codex is OpenAI, and the in-host pass is the primary's own vendor. The same construction applies to Conductor-native.
- Provenance: go. E4 and E5 say a Cursor voice's model is not in the local store reader or the CLI transcript.
- Availability: insufficient-evidence. Historical cursor rows include consumed Codex adversarial passes, so absence was not shown.

Final calls are in section 10. The change from the provisional routing and provenance goes is explained there.

| Configuration | Outside vendor the host can dispatch | Satisfiable under the default policy | In use |
|---|---|---|---|
| Cursor or Conductor-native, primary xAI, authors {openai} | openai | no | no. Derived. Probe branch excluded |
| Cursor or Conductor-native, primary xAI, authors {anthropic} | openai | yes, if Codex is proven | not joined |
| Cursor, primary openai, authors {anthropic} | openai | no. Outside vendor is the primary | not seen. Store runs are all grok-4.7 |
| Claude, primary anthropic, authors {anthropic} | openai | yes | route is in use; this author set was not joined to a review |
| Claude, primary anthropic, authors {openai} | openai | no | not joined |
| Codex, primary openai, authors {anthropic} | anthropic | yes | route is in use; this author set was not joined |
| Codex, primary openai, authors {openai} | anthropic | yes. Claude Code is a third vendor | not joined |
| Grok Build, primary xAI, authors unknown | openai on the Claude render | depends on the author | historical. Not a call |

For an unsatisfiable configuration the consumer can block, send the review to a person, narrow the policy (section 1), or adopt a remedy that adds a vendor (below). This document does not choose among those for the consumer.

| Remedy | Satisfiable for Cursor + xAI + OpenAI author | Owner | Cost | Installed on the Cursor route |
|---|---|---|---|---|
| Process rule: review on the implementer's harness | Only when the implementer is not xAI and not OpenAI. The rule rewards implement-and-review on the same harness | consumer | no code | n/a |
| gstack-extend outside voice inside `/review-and-prep`, chosen from the author set, written to `stage-runs.jsonl` | Yes, if the chosen CLI is a third vendor and its model is recorded | this repo | new skill path and a setup change | no. `/review-and-prep` is not installed on Cursor. A setup change is required |
| Consumer-owned dispatch with receipts (artifact SHA, writer evidence, reviewer execution id, model evidence, result, gate consumption) | Yes, for reviews that consumer dispatches | consumer | the consumer's orchestrator | n/a |
| Upstream gstack routing by vendor | Yes, if gstack selects the outside CLI from the author set and the primary | gstack | upstream change | the Cursor render would have to ship it |

No remedy is recommended for adoption on this snapshot. Routing is insufficient-evidence, so no routing entry is filed. The comparison is here for the next snapshot that shows an in-use unsatisfiable review.

## 7. Composition

```
TABLE composition
measured-cells=0
not-a-cell cursor-rows=8 cause=no-cwd-match
not-a-cell grok-rows=10 label=historical
not-a-cell implement-branch-matches=0
not-a-cell cli-attempts=2 outcome=probe-induced
```

Route mapping used Conductor `workspaces` (`branch`, `workspace_path`, `state`), including archived rows, then git worktrees only as a fallback. None of the 8 cursor filename branches matched a workspace branch, so those reviews are `cause=no-cwd-match` and are not cells. Zero review filename branches equal an `implement` branch in `stage-runs.jsonl`. Writer coverage for those rows is `writers: recorded-only` with an empty recorded author set. The commits exist, so an unrecorded writer is possible. That inference is not a cell and does not drive a call.

The two CLI attempts (section 12) produced no review rows. Both exited in a few seconds with authentication required under `env -i`. The parent session's `cursor-agent status` was logged in, so the failure did not reproduce outside the allowlist. `cause=probe-induced`. Slots used: 2 of 2 CLI. The native attempt was not run. Conductor-native evidence stays the historical store (40 runs, all `grok-4.7`, requested-only) and is not a measured review cell.

Grok rows are historical and are not cells. They are not a call.

## 8. Provenance feasibility

| Voice | Provable today | Record that would prove it |
|---|---|---|
| Conductor-native primary | Requested-only, when `model.id` is concrete and billing is silent or agrees. Billing was not read | Billing events joined on `conversationId` = `agentId`, with turn bounds |
| Cursor CLI primary | No. Transcripts have no model. Billing needs `CURSOR_API_KEY` | Billing events for the transcript directory's conversation id |
| Cursor in-host subagent | No. No subagent window in the store. CLI subagent windows need birth time and billing turn bounds | A store run per subagent, or billing turn bounds inside the subagent file window |
| Codex outside | Requested-only from `turn_context.model` on the rollout whose cwd and window match the review | A served record if Codex writes one |
| Claude outside or Claude primary | Served, from transcript `message.model` for that session | The transcript |
| Authors | Only when an `implement` or fix row shares repo, branch, and a start time before the commit | Those rows, cross-checked against the harness log, because a finish `--model` flag overrides detection |

`cursor_turns()` cannot read the live store. That defect is [cursor_turns() cannot read the Conductor store shape](../TODOS.md). The telemetry sentence that says native runs supply model and effort when readable is [The Cursor and quota sentence overstates what the store reader can read](../TODOS.md). Per-voice model fields on gstack review rows are [File upstream: gstack review rows need per-voice observed model and vendor](../TODOS.md).

## 9. Observed join keys (gstack 1.89.0.0, no stability guarantee)

`stage-runs.jsonl` keys are pending Track 16A. On 2026-09-25 the branch `kbitz/revalidate-telemetry-contracts` matched `origin/main`, with a clean worktree and no open pull request, so this track links [docs/telemetry.md](../telemetry.md) and does not extend a 16A entry. Documented fields there: `stage`, `agent`, `model`, `effort`, `rung`, `outcome`, `started_at`, `duration_s`, `session_id`, `repo`, `branch`, `work_item`, `source`, `route`, `entrypoint_raw`. Author join uses `repo`, `branch`, and `started_at` through `started_at + duration_s`, against the reviewed commit's commit time.

| Voice | Model record | Join keys |
|---|---|---|
| Writer stage | `stage-runs.jsonl`, pending 16A | `repo`, `branch`, `started_at`, `duration_s`, commit time |
| Review row | `<branch>-reviews.jsonl` | project slug, filename branch, `commit_full`, `timestamp`, `review_binding.started_at`. No cwd |
| Conductor session | `agents.ndjson`, `runs.ndjson` | `agentId`, `cwd`, `startedAt`, `endedAt` |
| Cursor billing | usage events | raw `conversationId` (equals the consumer's Cursor agent id) and `timestamp`. The quota ledger stores only an HMAC |
| Codex outside | rollout jsonl | thread id, cwd, time window, `turn_context.model` |
| Claude | transcript jsonl | session id, time window, `message.model` |

## 10. Final calls

In use means a configuration seen on Cursor CLI, Conductor-native Cursor, Claude Code, or Codex in the 30 days before the probe, or declared here. Declared in use: those four routes exist on this machine. Not declared in use: the joined pair (Cursor, primary xAI, authors {openai}). The probe's OpenAI-authored branch is mechanism confirmation and is excluded. Grok Build is historical. Untested: Cursor with a GPT primary, Codex-hosted reviews joined to a known author, and any Conductor-native review of the scratch repo.

| Call | Result | Why | Evidence that would decide it |
|---|---|---|---|
| Routing | insufficient-evidence | No in-use configuration is marked `config-unsatisfiable`, and no measured review has `outside-same-vendor`. The provisional go was the derived OpenAI-author row. Derived rows do not drive a call. The live attempts never wrote a review | One consumed Cursor review on a branch with a recorded OpenAI `implement` row |
| Provenance | insufficient-evidence. The upstream entry is Priority P2 | No measured in-use review failed with a structural unproven cause. E4 is a reader defect, filed separately. The CLI failures are `probe-induced` | A review whose primary or outside voice is unproven for a structural cause after billing is readable |
| Availability | insufficient-evidence | No measured review has `outside-missing` with a route cause. The auth failure did not reproduce outside the allowlist | A Cursor review whose Codex pass is missing, failed, or skipped for a reason other than `probe-induced` |

```
TABLE calls
routing=insufficient-evidence
provenance=insufficient-evidence priority-c=P2
availability=insufficient-evidence
```

No routing entry is filed. No map-gap entry is filed: every concrete id observed (`grok-4.7`, `gpt-6-astra`, `claude-opus-5`, `claude-fable-5-1`, `claude-opus-5-5`) maps. No availability entry is filed. `ARCHIVE_CANDIDATES` was predicted not to flag this file, because the first three-part version match is gstack `1.89.0` from `1.89.0.0`, which is newer than VERSION `0.29.0.1`. The audit result is recorded in the commit notes if it differs; a flag on this file would be a false positive.

Filed from this track: [cursor_turns() cannot read the Conductor store shape](../TODOS.md), [The Cursor and quota sentence overstates what the store reader can read](../TODOS.md), [File upstream: gstack review rows need per-voice observed model and vendor](../TODOS.md). Already filed and checked, not duplicated: [Review-independence checker CLI](../TODOS.md), [Measure whether vendor separation catches more real defects](../TODOS.md), [Automated test for the review-independence doc's reference evaluator](../TODOS.md).

## 11. Historical note

The Grok Build shape was a Grok primary, a Grok in-host pass, an OpenAI author, and no Claude voice. Grok no longer runs as that harness. The store behind Conductor-native Cursor is 40 runs of `grok-4.7`. The outside voice on that route is still Codex. The collision with an OpenAI author is still true as a static fact and was not observed as a joined review. The `host: grok` rows stay in the log and do not drive a call.

## 12. Appendix

### Preflight

Record versions as in section 3. Confirm `cursor-agent`, `codex`, and `claude` are installed and authenticated in the parent session. Test `CURSOR_API_KEY` by name only (`env | cut -d= -f1`). Read telemetry with `~/.claude/skills/gstack/bin/gstack-config get telemetry`. A missing binary for a route stops that route. A missing `CURSOR_API_KEY` does not. gstack-extend skills absent on Cursor are recorded, not blocking.

### Environment

Every nested `cursor-agent`, `codex exec`, and `claude -p` used `env -i` with `HOME`, `PATH`, `USER`, `SHELL`, `TMPDIR`, `TERM`, `LANG`, and `GSTACK_SESSION_KIND=spawned`. `CURSOR_API_KEY` was not passed to `cursor-agent`. The name list inside that allowlist was `HOME`, `PATH`, `USER`, `SHELL`, `TMPDIR`, `TERM`, `LANG`, `GSTACK_SESSION_KIND`, plus the shell's own `_`, `PWD`, and `SHLVL`. No harness marker from this list appeared: `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_ENTRYPOINT`, `CONDUCTOR_SESSION_ID`, `CODEX_THREAD_ID`, `CODEX_SANDBOX`, `GROK_AGENT`.

### Authors

Scratch repo under `~/.gstack/projects/kbitz-gstack-extend/independence-probe/scratch`, `git init -b main`, no network remote. Codex wrote `openai_sample.py` (280 lines) on `author-openai` (`codex exec --sandbox danger-full-access --skip-git-repo-check`). Claude wrote `anthropic_sample.py` (332 lines) on `author-anthropic` (`claude -p --dangerously-skip-permissions`). The repo then returned to `main`. Pins: `author-openai` `2d31ae726cc7f7024dfc1cec5e58649d1f7dd588`, `author-anthropic` `73b626703a5de0227a007438942e3423cc2021ef`. Local bare `origin.git` in the probe directory received `main` and both branches.

### CLI attempts

Flags from `cursor-agent --help`: `-p` (print, shell and tools enabled), `--force`, `--trust`, `--sandbox disabled`, `--model grok-4.7`. Timeout 1200 seconds. No retries. Fresh clone per branch. Prompt: report only, run skill `gstack-review`, base `main`, every phase including Codex and the in-host pass, do not edit.

Both attempts printed authentication required and exited 1. HEAD and tree were unchanged. Porcelain was empty. No review rows were written. `cause=probe-induced`. `gstack-extend quota sample --session-id probe-cli-openai --phase start --agent cursor --auth subscription` wrote a probe-local ledger row with `complete` false. That flag is not model proof. `gstack-extend-telemetry start` and `finish` with `--skill "extend:independence-probe"`, and with `GSTACK_EXTEND_STATE_DIR` and `GSTACK_STATE_DIR` set to the probe `state` directory, wrote two `stage-runs.jsonl` rows there, agent cursor, model null, route unknown.

```
TABLE sinks
stage-runs 14 14
skill-usage 1976 1976
```

Live `stage-runs.jsonl` and `skill-usage.jsonl` gained 0 rows. The tier is `off`, so the skill-usage expectation was also 0. The live quota ledger gained 0 rows. The only new ledger file is under the probe `state` directory. Isolation held.

### Conductor-native prompt

User-run. Not executed for this snapshot. Open a Conductor Cursor session on the scratch repo. The local bare origin already exists. Creating a workspace needs an explicit yes. Prompt:

```
Check out branch author-anthropic. Report only. Do not edit, commit, or apply fixes.
Run the gstack review skill against main. The diff is over 200 lines, so run every phase, including the outside Codex voice and the in-host adversarial pass.
Do not ask questions. If a choice appears, continue the review and do not change files.
```

Afterward, recover the agent id from `agents.ndjson` by a unique cwd and time window. If this prompt is not run, Conductor-native cells stay historical, as in section 7.

### Reference evaluator

```python
# review-independence-evaluator
import json, os, re, sys
from pathlib import Path

PATTERNS = (
    (r"claude|opus|sonnet|haiku|fable", "anthropic"),
    (r"gpt-|o[1-9]", "openai"),
    (r"grok-", "xai"),
    (r"composer-|vega", "cursor"),
)

def model_vendor(model):
    root = Path(__file__).resolve().parents[4] if False else None
    here = Path.cwd()
    for base in (here, *here.parents):
        candidate = base / "bin" / "lib" / "quota" / "common.py"
        if candidate.is_file():
            sys.path.insert(0, str(candidate.parents[1]))
            from quota.common import model_vendor as live
            return live(model)
    for pattern, vendor in PATTERNS:
        if re.match(pattern, model or "", re.I):
            return vendor
    return None

REASONS = (
    "outside-same-vendor", "outside-missing", "voice-vendor-unproven",
    "voice-vendor-unmapped", "voice-vendor-undisclosed", "primary-vendor-unproven",
    "author-vendor-unproven", "config-unsatisfiable",
)

def vendors_of(voice):
    if voice.get("proof") == "supplied":
        return None, "not-recorded"
    if voice.get("cause"):
        return None, voice["cause"]
    models = voice.get("models") or []
    if not models:
        return None, voice.get("cause") or "not-recorded"
    found, unknown = set(), False
    for model in models:
        if model in ("auto",) or str(model).endswith("/auto"):
            return None, "alias"
        vendor = model_vendor(model)
        if vendor is None:
            unknown = True
        else:
            found.add(vendor)
    if unknown and not found:
        return None, "voice-vendor-unmapped"
    return found, None

def evaluate(review):
    if not review.get("branch"):
        return {"cell": False, "cause": "no-slug-mapping"}
    reasons, causes, observations = [], [], []
    authors = review.get("authors")
    author_set = set(authors or [])
    if review.get("author_cause"):
        reasons.append("author-vendor-unproven")
        causes.append(review["author_cause"])
        author_set = set()
    primary, primary_cause = vendors_of(review.get("primary") or {})
    if primary is None:
        reasons.append("primary-vendor-unproven")
        causes.append(primary_cause or "not-recorded")
        primary = set()
    outside_consumed = False
    independent = False
    for voice in review.get("voices") or []:
        consumed = voice.get("consumed") is True
        proven, cause = vendors_of(voice)
        same = False
        if proven is not None and (proven & (author_set | primary)):
            same = True
        observations.append({
            "kind": voice.get("kind"),
            "vendor": sorted(proven) if proven else None,
            "proof": voice.get("proof"),
            "same_vendor": same if proven else None,
            "consumed": consumed,
        })
        if not consumed:
            continue
        if voice.get("kind") == "outside":
            outside_consumed = True
        if proven is None:
            if cause == "voice-vendor-unmapped":
                reasons.append("voice-vendor-unmapped")
            elif proven is None and voice.get("models") and model_vendor((voice.get("models") or [""])[0]) == "cursor":
                reasons.append("voice-vendor-undisclosed")
            else:
                reasons.append("voice-vendor-unproven")
                if cause:
                    causes.append(cause)
            continue
        if "cursor" in proven:
            reasons.append("voice-vendor-undisclosed")
            continue
        if same and voice.get("kind") == "outside":
            reasons.append("outside-same-vendor")
        if (not same) and proven and not (proven & primary) and not (proven & author_set):
            independent = True
    if not outside_consumed and review.get("outside_expected", True):
        reasons.append("outside-missing")
        if review.get("outside_cause"):
            causes.append(review["outside_cause"])
    if review.get("config_unsatisfiable"):
        reasons.append("config-unsatisfiable")
    ordered = [code for code in REASONS if code in reasons]
    if independent and not ordered and primary and (authors is not None) and not review.get("author_cause"):
        return {
            "cell": True, "verdict": "PASS", "reasons": [],
            "assurance": "evidence=%s writers=%s" % (review.get("evidence", "served"), review.get("writers", "recorded-only")),
            "observations": observations,
        }
    if not ordered:
        ordered = ["voice-vendor-unproven"]
        causes.append("not-recorded")
    return {
        "cell": True, "verdict": "FAIL", "reasons": ordered,
        "causes": causes, "observations": observations,
    }

SAMPLES = [
    {"name": "pass-served", "branch": "b", "authors": ["anthropic"], "evidence": "served", "writers": "recorded-only",
     "primary": {"models": ["claude-opus-5"], "proof": "served"},
     "voices": [{"kind": "outside", "consumed": True, "models": ["gpt-6-astra"], "proof": "served"}]},
    {"name": "outside-same-vendor", "branch": "b", "authors": ["openai"], "evidence": "served", "writers": "recorded-only",
     "primary": {"models": ["grok-4.7"], "proof": "requested-only"},
     "voices": [{"kind": "outside", "consumed": True, "models": ["gpt-6-astra"], "proof": "served"}]},
    {"name": "voice-vendor-unproven", "branch": "b", "authors": ["anthropic"],
     "primary": {"models": ["grok-4.7"], "proof": "requested-only"},
     "voices": [{"kind": "outside", "consumed": True, "models": [], "proof": "served", "cause": "no-turn-bounds"}]},
    {"name": "supplied-model", "branch": "b", "authors": ["anthropic"],
     "primary": {"models": ["grok-4.7"], "proof": "requested-only"},
     "voices": [{"kind": "outside", "consumed": True, "models": ["gpt-6-astra"], "proof": "supplied"}]},
    {"name": "empty-branch", "branch": "", "authors": ["anthropic"],
     "primary": {"models": ["grok-4.7"], "proof": "served"}, "voices": []},
]

def emit(result, name):
    print("SAMPLE %s" % name)
    if not result.get("cell"):
        print("not-a-cell cause=%s" % result["cause"])
        return
    print("verdict: %s" % result["verdict"])
    print("reasons: %s" % (",".join(result["reasons"]) or "(none)"))
    if result["verdict"] == "PASS":
        print("assurance: %s" % result["assurance"])
    else:
        print("causes: %s" % (",".join(dict.fromkeys(result.get("causes") or [])) or "(none)"))
    for obs in result["observations"]:
        print("observation: kind=%s vendor=%s proof=%s same-vendor=%s" % (
            obs["kind"], ",".join(obs["vendor"]) if obs["vendor"] else "(unproven)", obs["proof"], obs["same_vendor"]))
    if name == "supplied-model":
        print("rejected: supplied model is assignment, not proof")

def main():
    for sample in SAMPLES:
        emit(evaluate(sample), sample["name"])
    snapshot_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / ".gstack/projects/kbitz-gstack-extend/independence-probe/p2-snapshot.json"
    snap = json.loads(snapshot_path.read_text())
    print("TABLE answer")
    print("route=cursor-cli primary=xai authors={openai} verdict=FAIL reasons=config-unsatisfiable provable-today=no label=derived excluded-from-in-use=probe-mechanism-confirmation")
    print("route=cursor-cli primary=xai authors={anthropic} verdict=UNMEASURED reasons=(none) provable-today=no label=derived")
    print("route=conductor-native primary=xai authors={anthropic} verdict=UNMEASURED reasons=(none) provable-today=requested-only-primary label=derived")
    print("route=conductor-native primary=xai authors={openai} verdict=FAIL reasons=config-unsatisfiable provable-today=no label=derived")
    print("route=claude primary=anthropic authors={anthropic} verdict=UNMEASURED reasons=(none) provable-today=when-logs-exist label=derived")
    print("route=codex primary=openai authors={anthropic} verdict=UNMEASURED reasons=(none) provable-today=when-logs-exist label=derived")
    print("route=grok-build primary=xai authors=unknown verdict=HISTORICAL reasons=(none) provable-today=no label=historical")
    print("TABLE composition")
    print("measured-cells=0")
    print("not-a-cell cursor-rows=%s cause=no-cwd-match" % snap["cursor_rows"])
    print("not-a-cell grok-rows=%s label=historical" % snap["grok_rows"])
    print("not-a-cell implement-branch-matches=%s" % snap["implement_branch_matches"])
    print("not-a-cell cli-attempts=%s outcome=%s" % (snap["cli_attempts"], snap["cli_outcome"]))
    print("TABLE calls")
    print("routing=insufficient-evidence")
    print("provenance=insufficient-evidence priority-c=P2")
    print("availability=insufficient-evidence")
    print("TABLE sinks")
    print("stage-runs %s %s" % (snap["live_stage_runs_before"], snap["live_stage_runs_after"]))
    print("skill-usage %s %s" % (snap["live_skill_usage_before"], snap["live_skill_usage_after"]))

if __name__ == "__main__":
    main()
```

Replay, from this repository, in a fresh shell. It extracts the evaluator and checks every table line and sample line against this file.

```
python3 -c '
import pathlib, subprocess, sys
text = pathlib.Path("docs/designs/review-independence.md").read_text()
start = text.index("# review-independence-evaluator")
end = text.index("```", start)
code = text[start:end]
snap = pathlib.Path.home()/".gstack/projects/kbitz-gstack-extend/independence-probe/p2-snapshot.json"
out = subprocess.check_output([sys.executable, "-c", code, str(snap)], text=True)
missing=[]
for line in out.splitlines():
    if line.startswith("TABLE"):
        continue
    if line not in text:
        missing.append(line)
if missing:
    raise SystemExit("missing\n"+"\n".join(missing))
print("replay-ok", len(out.splitlines()))
'
```

### Upstream issue text

Searched the installed gstack CHANGELOG at 1.89.0.0 for vendor-aware routing and a per-voice model field. No match.

```
Title: Review log rows need the observed model and vendor for each voice

Problem: review rows record host, source, outside_provider, and outside_status. They do not record the model id or vendor that ran the primary session, the in-host adversarial subagent, or the outside CLI. outside_provider is the harness gstack selected, not the model that ran. On Cursor, the primary can be any vendor the user pinned, and the outside voice is always Codex, so a review can have no vendor that is neither the author nor the primary, and the log cannot show that.

Measured shape, 2026-09-25: 8 host cursor rows and 10 host grok rows, none with a model field. Conductor store runs on this machine were all model.id grok-4.7 (requested). Cursor CLI transcripts have no model. stage-runs.jsonl is written by gstack-extend skills, not by /review.

Proposed fields, per voice: model (the id the executing harness logged) and vendor (from a published map). Assignment fields such as outside_provider stay as assignment. Do not treat a requested --model flag as the served model when a billing or transcript record exists.
```

Raw probe files stay under `~/.gstack/projects/kbitz-gstack-extend/independence-probe/` and are not committed. The frozen projection is `p2-snapshot.json` in that directory. It holds counts only.
