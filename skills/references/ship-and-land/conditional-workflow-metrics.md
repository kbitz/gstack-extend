# /ship-and-land reference: Workflow metrics capture, span wrappers, and receipts

## From Workflow metrics (optional, local)

Resolve `gstack-extend-telemetry` exactly as the telemetry blocks do. Every
producer is `gstack-extend-telemetry metrics <begin|end|decision|pass|correction>`
with one JSON object (`v:1`, `stage:"ship-and-land"`, the retained
`session_id`, a fresh lowercase UUID `event_id` you keep stable for that
event) on stdin. Every ID you mint is lowercase and random (below).
The launcher always exits 0: inspect the JSON envelope's `status` for capture
state and preserve the wrapped work's own exit status separately. A disabled,
unavailable, conflicting or unconfirmed capture is capture state only — it
never changes a reuse decision, a review requirement, Greptile applicability,
ship/land readiness, merge approval, or any outward action, and never delays
the fresh checks that precede one. Never rerun completed work to manufacture
telemetry. For an `unconfirmed` or missing envelope of a `decision`, `pass` or
`correction`, keep the exact payload and `event_id`, run
`metrics read --session-id <id> --event-id <event_id>`, and replay that
identical payload at most once when the read reports the event present or
safely absent; on conflict/partial/unknown stop and leave capture unknown. A
`begin` or `end` is never replayed later: the span library reconciles it once
in its own call (`match` counts it as written; `absent` leaves the boundary
missing), and no interval is derived from a `decision`, `pass` or `correction`
timestamp. Never mint a fresh `event_id` for a replay.

Issue metrics calls one at a time from this session, never as parallel tool
calls or from subagents: the run lock never waits, so concurrent calls drop
as `lock-busy`. If the run `begin` is not `recorded` or `replayed`, emit
nothing further in this invocation and use the core metrics status line in
its receipts. If context compaction loses the retained IDs or a pending
payload, that capture stays unknown; never guess an ID. When a metrics call
shares a tool call with other work, capture that work's exit first
(`rc=$?`), report it, and use it for the step's `outcome`; the launcher's own
exit is always 0.

Emit each record at its boundary, never afterward. The rules, the shell
library and both call forms are in
[docs/telemetry.md](https://github.com/kbitz/gstack-extend/blob/main/docs/telemetry.md#workflow-metrics-span):

- Boundary: a step's `begin` goes in the tool call that starts its work, ahead of
  that work's first command. Its `end` goes in the same call right after the
  command returns, or in the first tool call after a subagent, background command
  or external result returns. Work with no command of its own (completion audit,
  scope reading, triage) gets its `begin` and `end` in short dedicated calls,
  immediately before the work starts and right after its result is decided. When
  several voices are dispatched together, their `begin` records go one after
  another in a single Bash call immediately before the one dispatch message,
  never inside it. Each voice's `end` goes in the first tool call after that
  voice's own result arrives; voices whose results arrive together end together,
  parent-observed. A pass `started` precedes the dispatch of its voices. Each
  `attempt` and `voice-complete` is emitted as that voice's result is consumed,
  and `completed` when the round closes. Every phase visit this workflow
  executes gets a span, except a `tests` lane inside a pregate run. A RUN-decided
  visit with no span reads unknown by design.
- Never backfill: never write a `begin` or `end` for a boundary that has already
  passed or has not happened yet. A missed `begin` leaves only the phase's
  `decision`; if a step's `begin` was not `recorded`, `replayed` or reconciled,
  emit no `end` for it. A missed `end` leaves the step open. A wait is ended
  `paused` only at an actual pause. A command that fails, or hits its own
  timeout inside the call, ends `failed` in that call; work the user stops ends
  `cancelled`. If the host kills the tool call so the same-call `end` never runs,
  the step stays open.
- Mint IDs at random: mint each new `event_id`, `step_id`, `pass_id` and
  `attempt_id` from a random generator
  (`python3 -B -I -c 'import uuid;print(uuid.uuid4())'` or `uuidgen | tr A-Z a-z`) in
  the tool call that first uses it, and print it for later reference. Never
  derive an ID from the session ID, a counter, another ID or a typed pattern.
  Never reuse an ID for a different event or entity: a step keeps its `step_id`
  across its `begin`, `end` and governing `decision`; a pass and an attempt keep
  theirs; a replay keeps its `event_id`.
- Spans use `bin/lib/workflow-span.sh`, resolved once by the call that records
  the run `begin` (below). Same-call form, for a foreground command; the shell is
  new every call, so set the retained values first:

  ```bash
  GX_STAGE='ship-and-land'; GX_SID='<session ID the start printed>'; GX_CAPTURE=1; GX_LIB='<retained library path>'; GX_RUN='<run step_id>'
  [ -f "$GX_LIB" ] && . "$GX_LIB" 2>/dev/null || { gx_span_begin() { :; }; gx_span_begin_wait() { :; }; gx_span_end() { :; }; }
  gx_span_begin PHASE "$GX_RUN" phase
  GX_E=$-; set +e; ( set -e -o pipefail; WORK ); rc=$?; case "$GX_E" in *e*) set -e ;; esac
  gx_span_end "${GX_STEP:-}" "$rc"
  (exit "$rc")
  ```

  Cross-call form, for a background command, a subagent return, work with no
  command of its own or any command that may outlast the host's tool-call
  timeout (the table marks the long sites): the first call runs the first three
  lines, `gx_span_begin PHASE "$GX_RUN" phase`, and prints a `SPAN` line, then
  ends; the first call after the result arrives sets the same first two lines and
  runs `gx_span_end 'STEP-FROM-THE-SPAN-LINE' "$rc" 'BEGIN-FROM-THE-SPAN-LINE'`.
  Set `rc` explicitly from the observed completion result in that new shell
  (0 for success, nonzero for failure); if the result is unknown, leave the span
  open. An empty or nonnumeric `rc` emits no end. Never use the same-call form under background execution: its `end` would race
  the run lock and drop. `GX_CAPTURE` is `1` only when the run `begin` was
  `recorded` or `replayed`, else `0`, and the work still runs with no launcher
  call. `WORK` is written inline, never through `eval`; it runs in a subshell,
  so a variable or `cd` it makes does not persist. `gx_span_begin_wait CATEGORY
  "$GX_RUN"` opens a wait and emits no decision; a fourth argument to
  `gx_span_end` sets the outcome to `paused` or `cancelled`; `NODECISION=1` skips the
  decision for a second step in the same phase visit. Quote the `SPAN` lines
  in later calls; any `begin=`, `end=` or `decision=` value other than
  `recorded`, `replayed`, `match`, `pending` or `skipped` makes the receipt carry
  `capture=partial (<reason>)`.

  Once the candidate changes (you first observe it, a base merge, a fix or release commit),
  every later step `begin` and pass `started` carries a `context` override with
  the new HEAD/tree/base (the fourth argument of `gx_span_begin`); their ends,
  attempts and voice records inherit it.
- One governing `decision` per executed phase visit, recorded under the phase of
  the work decided about: `gx_span_begin` emits it (`RUN`, reason `required`
  unless `GX_REASON` names another controlled reason) and shares its `step_id`
  with the step's `begin`. A reused phase records a `REUSE` decision through the
  raw `decision` producer with a fresh `step_id` and no interval (a reused review
  is `local-pass`, reused tests are `tests`; `reuse` labels only the reuse
  evaluation itself), and trusted or release-only reuse records decisions without
  new work intervals. A reached-but-inapplicable phase is `N/A` with its
  controlled reason; unreached phases emit nothing and stay unknown. A `tests`
  decision made inside a pregate run carries the enclosing `pregate` step's
  `step_id` (send it with the raw `decision` producer in the call that begins the
  pregate span, using `$GX_STEP`). Each execution has its own `step_id`; phase
  names are labels only.
  Parent review intervals enclose their parallel voice intervals; under parallel
  dispatch those are parent-observed, not per-voice runtime, and a voice step
  sets `NODECISION=1`.
- Any local review actually run here as `pass` records (one round over one
  candidate; required voices declared, attempts separate, one selected attempt
  or an explicit policy-authorized `N/A` per voice; findings as allowlisted
  IDs/severities/dispositions only, never bodies, prompts or command output;
  an empty array means zero; `model_context` only when supplied, with an
  out-of-grammar identifier null and `unknown_reason:"unsupported"`; a
  `finding_id` unique within an attempt, duplicates declared on the finding
  with `duplicate_of`). A fix batch actually run here is a `kind:"fix"` step,
  counted separately from passes. Greptile is `scope:"greptile"` with its own
  count and its once-per-PR rule unchanged; a reused Greptile result is a
  `REUSE` decision with no new pass and no new request, and metrics never
  triggers one.
- Corrections, appended as they happen: `correction_kind:"finding"` with the
  finding's `finding_id`, `pass_id`, `voice_id` and `attempt_id` when its
  resolution or adjudication changes after its attempt was recorded (a fix
  lands: `resolution:"fixed"`; a later change to the same finding names the
  previous correction in `supersedes_event_id`); `retry` or `fallback` with
  the new `attempt_id` when a voice attempt is retried or replaced; and
  `fix-cycle` with `fix_step_id` set to the fix step's `step_id` when a fix
  batch closes.
- Waits as `kind:"wait"` steps (`gx_span_begin_wait`; `human` while a question
  to the user, such as merge approval, is open; `external-review`, `checks`,
  `deploy`) only for waits actually performed, each ended `paused` only at an
  actual pause. Unlabeled time stays unclassified;
  elapsed wall time is never model/inference time, and every duration is
  clock-sensitive (`clock_basis=utc-wall`).
- Receipts: immediately before writing the wrapper receipt and the landing
  readiness report, run `metrics read --session-id <id>` and include that
  snapshot's `receipt_text` (at most 2 KiB), or, when the read is
  unavailable, the literal line
  `Workflow metrics (local, optional): capture=disabled|unavailable|partial (<reason>).`
  with the actual status. An open run reads as in progress; that is expected.
  If any metrics call after the run `begin` ended without `recorded` or
  `replayed` and was not reconciled, also add the literal line
  `Workflow metrics (local, optional): capture=partial (<reason>).` beside
  the snapshot, since the read cannot see a dropped call.
  The metrics line precedes the readiness report's merge decision, which
  stays last. `end` the run step just before the legacy telemetry finish.
  Never write or edit a PR body, comment or report only to refresh metrics,
  and never after the merge. Existing receipt, handoff and readiness labels
  are unchanged; the metrics line cannot authorize landing or merge. An
  interrupted run that produces no receipt needs none for metrics.

Phase mapping and span sites (stable metric phase IDs, anchored to this file's
headings — the owner of a wrapper change updates this mapping in the same
change). The Spans column is the closed list of span sites: a phase visit at an
anchor not listed there is a change to this table first. `(cross-call)` marks
the long sites that use the cross-call form. A `none` row supplies guidance
only: it emits no separate `RUN` decision or span; the executing site owns both.

| Anchor in this skill | Metric phases | Spans |
|---|---|---|
| `1. Resolve the workflows and target` | `handoff`, `evidence` | `handoff`, `evidence` |
| `2. Decide what can be reused`, `Independently verified reuse` | `reuse`, plus `REUSE` decisions under each reused phase | `reuse` |
| `Release-only path` | `reuse`, `pregate`, `tests`, plus `REUSE` decisions under each reused phase | `reuse`, `pregate` (cross-call), `tests` (cross-call) |
| `Project release policy` | `completion`, `coverage`, `documentation` | `completion`, `coverage`, `documentation` |
| `Reviewed secret findings` | `pregate` | `pregate` (cross-call) |
| `Test evidence` | `pregate`, `tests` | `pregate` (cross-call), `tests` (cross-call) |
| `Docs test policy` | `tests` | `tests` |
| `Shared review execution (DOCS and FULL)` | `local-pass`, `voice`, `fix`, `coverage`, `documentation` | `local-pass`, `voice`, `fix`, `coverage`, `documentation` |
| `Greptile and new feedback` | `external-review` decision; wait `external-review` only if actually awaited | `external-review` (cross-call), wait `external-review` (cross-call), only when actually performed |
| `3. Execute ship and verify its final changes` | `release`, `ship`, `publication` | `release`, `ship`, `publication` |
| `4. Land and verify` | `readiness`, `landing`, wait `deploy`, wait `human` | `readiness`, `landing`, wait `deploy`, wait `human` |

<!-- end of skills/references/ship-and-land/conditional-workflow-metrics.md -->
