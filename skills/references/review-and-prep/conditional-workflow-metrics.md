# /review-and-prep reference: Workflow metrics capture and span wrappers

## From Workflow metrics (optional, local)

Resolve `gstack-extend-telemetry` exactly as the telemetry blocks do. Each
inline producer (`decision` for raw `REUSE`/`N/A`, and the span library's
`begin`/`end`) calls `gstack-extend-telemetry metrics <begin|end|decision>`
with one JSON object (`v:1`, `stage:"review-and-prep"`, `session_id` from
`GX_SID`, a fresh lowercase UUID `event_id` you keep stable for that
event) on stdin. `metrics read` takes the flags listed below. Every ID you
mint is lowercase and random (below).
The launcher always exits 0: inspect the JSON envelope's `status` for capture
state and preserve the wrapped work's own exit status separately. A
disabled, unavailable, conflicting or unconfirmed capture is recorded as
capture state only — it never changes a review finding, a gate, Greptile
applicability, readiness, or any outward action, and never delays the fresh
checks that precede one. Never rerun completed work to manufacture telemetry.
For an `unconfirmed` or missing envelope of a `decision`, keep the exact
payload and `event_id`, run
`metrics read --session-id <id> --event-id <event_id>`, and replay that
identical payload at most once when the read reports the event present or
safely absent; on conflict/partial/unknown stop and leave capture unknown. A
`begin` or `end` is never replayed later: the span library reconciles it once
in its own call (`match` counts it as written; `absent` leaves the boundary
missing), and no interval is derived from a `decision`
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
  GX_STAGE='review-and-prep'; GX_SID='<session ID the start printed>'; GX_CAPTURE=1; GX_LIB='<retained library path>'; GX_RUN='<run step_id>'
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

- One governing `decision` per executed phase visit, recorded under the phase of
  the work decided about: `gx_span_begin` emits it (`RUN`, reason `required`
  unless `GX_REASON` names another controlled reason) and shares its `step_id`
  with the step's `begin`. A reused phase records a `REUSE` decision, and a
  reached-but-inapplicable phase `N/A` with its controlled reason, through the
  raw `decision` producer with a fresh `step_id` and no interval; unreached
  phases emit nothing and stay unknown. A `tests` decision made inside a pregate
  run carries the enclosing `pregate` step's `step_id` (send it with the raw
  `decision` producer in the call that begins the pregate span, using
  `$GX_STEP`). Each execution has its own `step_id`; phase names are labels only. Parent review intervals enclose
  their parallel voice intervals (`parent_step_id`); under parallel dispatch
  those are parent-observed, not per-voice runtime, and a voice step sets
  `NODECISION=1`.

- Waits as `kind:"wait"` steps (`gx_span_begin_wait`) with `wait_category`
  (`human` at the manual testing checkpoint and while a question to the user is
  open, `external-review` from the Greptile request's submission until its
  results are observed, `checks` at the external full-suite pause), ended
  `paused` only at an actual pause rather than
  inventing a finish (its duration then reads unknown). Unlabeled time stays unclassified; elapsed wall time is never
  model/inference time, and every duration is clock-sensitive
  (`clock_basis=utc-wall`).
- Receipts: immediately before writing each receipt this workflow already
  produces (the PAUSED receipt, the STOPPED receipt, a blocked-exit receipt,
  the Step 6 body receipt and its pre-ready receipt comment), run `metrics read --session-id <id>` and
  include that snapshot's `receipt_text` (at most 2 KiB) in the full receipt
  (`full-receipt-<n>.md`), or, when the read is
  unavailable, the literal line
  `Workflow metrics (local, optional): capture=disabled|unavailable|partial (<reason>).`
  with the actual status. Use `GX_SID` as the read ID when derive supplies the
  current segment's binding. When there is no ID, use the status line with the
  actual reason in place of the read. An open run reads as in progress.
  If any metrics call after the run `begin` ended without `recorded` or
  `replayed` and was not reconciled, also add the literal line
  `Workflow metrics (local, optional): capture=partial (<reason>).` beside
  the snapshot, since the read cannot see a dropped call. When this segment
  continues a paused run (its segment started after a pause via `--resume` or a resume invocation's preamble), the snapshot
  counts this segment only, so also add the literal line
  `Workflow metrics (local, optional): this segment only; earlier segments are recorded under their own session IDs.`
  derive writes the run `end` after the pause checkpoint or `finish` and before
  Telemetry finish (calls doc **Fixed points**). Never write or edit a PR body or comment only to refresh
  metrics, and never after `gh pr ready`. Existing receipt and handoff labels,
  markers and the manual-testing rules are unchanged; the metrics line cannot
  authorize readiness. An interrupted run that produces no receipt needs none
  for metrics.

Phase mapping and span sites (stable metric phase IDs, anchored to this file's
headings — the owner of a wrapper change updates this mapping in the same
change). The Spans column is the closed list of span sites: a phase visit at an
anchor not listed there is a change to this table first. `(cross-call)` marks
the long sites that use the cross-call form. A `none` row supplies guidance
only: it emits no separate `RUN` decision or span; the executing site owns both. At a cycle-cap stop, close the existing
`local-pass` span and span each stop-only commit, publication and handoff visit.

| Anchor in this skill | Metric phases | Spans |
|---|---|---|
| `Take recommended fix-scope options without asking` | `local-pass`, `fix` | none |
| `Report elapsed time and stop on provider failures`, `Hosts with bounded subagent waits` | `local-pass`, `voice` | none |
| `1. Establish the branch, PR, and review inputs` | `evidence`, `scope` | `evidence`, `scope` |
| `Read an optional review policy`, `Use the light review default` | `scope` | none |
| `2. Review and verify locally` | `local-pass`, `voice`, `fix` | `local-pass`, `voice`, `fix` |
| `Merge the latest base before review` | `base-integration` | `base-integration` |
| `Bound Claude Code outside calls` | `local-pass`, `voice` | none |
| `Scope a re-review to its delta` | `local-pass`, `voice` | `local-pass`, `voice` |
| `Delegate named specialist parts` | `voice` | `voice` (cross-call) |
| `Run a red team where /review has none` | `voice` | `voice` |
| `Fold specialist checklists into cycle 1` | `local-pass`, `voice` | none |
| `Overlap independent first-cycle reviewers` | `local-pass`, `voice` | `voice` (cross-call) |
| `Reopen review only for behavior-changing repairs` | `fix`, `tests` | `fix`, `tests` (cross-call) |
| `Give review parts the settled decisions` | `local-pass`, `voice`, `fix` | none |
| `Block readiness only on shown findings` | `local-pass`, `fix` | none |
| `When /review stops at its cycle cap` | `local-pass`, `commit`, `publication`, `handoff` | `commit`, `publication`, `handoff` |
| `Verify agent-checkable items before any pause` | `completion` | `completion` (cross-call) |
| `Enforce completion, beyond /review's informational audit` | `completion` | `completion` |
| `Prove /ship's release gates on this head` | `pregate`, `coverage`, `documentation`, `tests` | `pregate` (cross-call), `coverage`, `documentation`, `tests` (cross-call) |
| `Classify changes after the documentation audit's last attempt` | `documentation` | none |
| `Bound the documentation audit` | `documentation` | none |
| `Repair a test-only final-gate failure` | `pregate`, `tests` | `pregate` (cross-call), `tests` (cross-call) |
| `Capture evidence and commit` | `evidence`, `commit` | `evidence`, `commit` |
| `3. Push and create or update the draft` | `publication` | `publication` |
| `Manual testing checkpoint and resume` | wait `human` | wait `human` |
| `Pause for an external full-suite gate` | wait `checks` | wait `checks` (cross-call) |
| `Narrow the pregate after an accepted pass` | `pregate` | `pregate` (cross-call) |
| `4. Trigger once and await Greptile` | `external-review`, wait `external-review` | `external-review` (cross-call), wait `external-review` (cross-call) |
| `5. Triage, fix, and verify locally` | `triage`, `fix`, `completion`, `pregate`, `tests` | `triage`, `fix`, `completion`, `pregate` (cross-call), `tests` (cross-call) |
| `Reviewed secret findings` | `pregate` | `pregate` (cross-call) |
| `6. Final readiness gate and handoff` | `readiness`, `handoff` | `readiness` |
| `7. Emit the copyable prompt for a new session` | `handoff` | `handoff` |

<!-- end of skills/references/review-and-prep/conditional-workflow-metrics.md -->
