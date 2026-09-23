# Skill telemetry

All nine installed skills carry optional start and finish calls. They record local
frequency, session wall-clock duration, and reported outcome, and finish records
which harness, model, and effort level ran the skill (see
[Execution provenance](#execution-provenance)). They do not measure token spend or
output quality. Python 3.9+ provides JSON escaping and state handling; missing
Python skips telemetry without failing the skill, and missing gstack skips only the
skill-usage rows.

## Three datasets

- **skill-usage.jsonl** contains local, model-invoked skill telemetry. It answers
  which observed runs started, finished, and reported an outcome, and how long
  their sessions lasted.
- **stage-runs.jsonl** contains one local-only provenance row per finished run. It
  answers which harness, model, and effort level ran each stage, in the documented schema any caller can join.
- **Transcript-derived counts from other tools** count transcript tool-use records
  whose name is Skill, potentially gathered across machines. Instrumenting these skills does
  not change those counts. Fleet totals cannot be the denominator of a local
  telemetry ratio.

The review-apparatus claim of two invocations but zero rows was a
**fleet-denominator versus local-numerator comparison error, not a skipped
block**. On the examined machine, zero local invocations and zero rows were
consistent. That diagnosis discharged the coverage hard stop.

Parse JSONL as JSON, never with grep: compact and spaced serialization are equally
valid. Corrected full-history planning counts were roadmap 31 activation / 32
completion, full-review 3/3, test-plan 1/1, pair-review 7/3, review-apparatus 0/0,
plus one nameless completion. Those totals alone do not establish pairing.

## Configuration and storage

~~~sh
gstack-config get telemetry
gstack-config set telemetry off
~~~

The off tier (also missing, unreadable, or invalid config) produces no new
skill-usage rows. Anonymous and community tiers enable them, and also let
gstack-telemetry-sync upload the file. Enabling is an explicit choice:
gstack-config set telemetry community. Provenance rows have their own switch; with
both off, start and finish write nothing, not even a handoff.

The sink exactly follows **gstack-telemetry-log**: GSTACK_STATE_DIR, defaulting to
$HOME/.gstack, then analytics/skill-usage.jsonl. **gstack-config** instead reads
config.yaml from GSTACK_STATE_ROOT → GSTACK_HOME → GSTACK_STATE_DIR →
$HOME/.gstack. Setting only GSTACK_HOME changes config lookup, not the sink.
Tests isolate HOME as well as overrides and never write to the real user sink.

Activation directly appends a JSON-escaped v1 skill_start row. Completion delegates
to gstack-telemetry-log with --source gstack-extend and **--no-sweep**. Upstream
still owns its richer completion schema and tier-dependent sync. Start never
invokes a sweeper. Neither path creates a .pending-* marker or finalizes other
sessions. This repairs the old wrapper's missing --no-sweep defect. The flag needs
gstack 1.80.0.0 or newer: an older logger ignores it and still finalizes other
sessions' markers, so finish checks that the logger mentions the flag and, if it
does not, writes nothing, keeps the handoff, and (in debug mode) says to upgrade
gstack. Start never invokes the logger, so an old logger does not affect it. Start
rows are ordinary rows in gstack's shared sink, which gstack's own dashboards
(`gstack-analytics`, `/retro`) do not know about, so they may count a start as a
run; the old activation rows behaved the same way.

Routing activation through the logger would put background network sync on the
skill-start critical path, a cost identified in the earlier design. Direct
activation avoids that cost and supplies proper escaping instead of upstream's
stripping escaper. Repository names containing quotes, backslashes, newlines, or
Unicode are escaped, never rejected. Only the controlled skill argument is
validated against ^extend:[a-z0-9-]+$.

Start atomically writes a handoff to GSTACK_EXTEND_STATE_DIR (default
$HOME/.gstack-extend), under telemetry/<hash>.json. The hash includes repository
root plus skill. Finish recovers missing or malformed start/session values from
it; each valid explicit --start or --session-id takes precedence. A flag followed
directly by another flag (a missing value) skips the call; a value that merely
starts with -- is accepted. Without valid state, finish writes nothing. A finish that
wrote every enabled output consumes only its matching handoff. After a partial
failure the handoff records which output was written, so a retry never duplicates
either row; explicit retries can still supply their IDs. A start whose
skill-usage append fails still saves that handoff when provenance is on, and
finish records the provenance row without sending a skill-usage completion for
the start that never landed.
State is separate from gstack analytics. There is no sweep, age bound, crash
detection, historical backfill, or inferred failure.

**Collision limit:** simultaneous runs of the same skill in the same repository
share a slot; the later start replaces it. Explicit start/session flags are the
escape hatch. Different Conductor workspaces have different roots and separate
slots. Handoffs are local: cross-machine resumes must carry explicit values to
emit an identifiable completion; that row may remain unpaired locally.

## Execution provenance

skill-usage.jsonl has no model or agent field, and gstack-skill-start drops its
`--model` argument (upstream), so no gstack row says which vendor ran a stage.
Finish therefore also appends one row per run to
$GSTACK_EXTEND_STATE_DIR/analytics/stage-runs.jsonl (default
`$HOME/.gstack-extend/analytics/stage-runs.jsonl`). **The file is local-only**:
gstack-telemetry-sync never reads it, so branch and work item never leave the
machine. It is created mode 0600. A symlink, FIFO, or extra hard link at that path is not written. The provenance config and the finish handoff are read the same way, so none of those stand-ins can stall a skill. The schema is gstack-extend’s documented contract. External callers can join it
by session_id and use their own source labels:

| Field | Hand-run value |
|---|---|
| stage | Skill name without `extend:`, e.g. `roadmap` |
| agent | `claude`, `codex`, `cursor`, or `grok`: the harness, not the model |
| model | Model ID the harness logged, e.g. `claude-opus-5`, `gpt-6-astra` |
| effort | Effort level the harness logged, in its own vocabulary (`xhigh`, `high`) |
| rung | Always 0: a hand-run skill has no fallback chain |
| outcome | `success`, `error`, `abort`, or `unknown`; any other value becomes `unknown` |
| started_at, duration_s | UTC start; session wall-clock seconds including human waits, never capped |
| session_id | The `extend-<uuid>` shared with the skill-usage start and finish rows |
| repo | origin's owner/name (never its host or credentials); the root's name without origin; null outside git |
| branch | Branch at finish; null outside git or when detached |
| work_item | Null unless finish passes `--work-item` |
| source | `gstack-extend` |
| route | `cli`, `conductor`, `sdk`, or `unknown`, from the selected harness markers |
| entrypoint_raw | The selected harness entrypoint marker, when present |

**Nothing is guessed.** Agent, model, and effort come from the harness's own
session log for the stage's window. Any value the wrapper cannot verify is null,
never a configured default:

- **Claude Code** exports CLAUDECODE and CLAUDE_CODE_SESSION_ID. The transcript
  `~/.claude/projects/*/<session>.jsonl` (CLAUDE_CONFIG_DIR honored) records model
  and effort on every response. Only the stage's own responses count: sidechain
  (subagent) and synthetic entries are skipped, and a skill run inside a subagent,
  whose parent transcript sits idle, gets null rather than the parent's model.
  Claude can start a command before appending the response that issued it, so a
  window with no response yet is re-read for up to a second.
- **Codex** exports CODEX_THREAD_ID. Its rollout
  `~/.codex/sessions/year/month/day/rollout-*-<thread>.jsonl` (CODEX_HOME honored)
  opens each turn with a `turn_context` carrying model and effort. The turn open
  when the stage began counts, since a skill usually runs inside one turn.
- **Grok Build** sets GROK_AGENT=1 and GROK_SESSION_ID. The wrapper reads that
  session's `events.jsonl` under `~/.grok/sessions/<encoded directory>/`
  (GROK_HOME honored): model from `turn_started`, or from summary.json when the
  log has no turn, and effort from summary.json. A session id that is missing or
  not a single file leaves model and effort null. With no session id, only one
  events log changed since the stage began is attributable; zero or several
  leave model and effort null.

Logs are read from their last 8 MiB. The model/effort pair behind the most turns
in the window wins, ties going to the later pair, so a mid-stage fallback shows
only when it carried the stage. A nested harness (codex exec run from Claude Code)
inherits the outer markers: process ancestry chooses the nearest marked harness
by argv[0] basename, then command name. Arguments never enter logs or output.
When ancestry is unavailable, the latest comparable log wins; without evidence
the agent remains null. A failed
detection costs only the detected values, never the row.

Explicit finish flags override detection: `--agent claude|codex|cursor|grok`, `--model`,
`--effort`, and `--work-item`. When `--agent` names a different harness than the
detected one, the detected model and effort are dropped. These flags never reach
gstack's logger.

**Switch.** Provenance is on by default and independent of gstack's tier, because
its rows stay local while enabling the tier also enables the upload. Turn it off
with `"$HOME/.claude/skills/gstack-extend/bin/config" set provenance false` (`off`
also works). A missing config stays on. An unreadable config stays off: a file
that cannot be read is not evidence the switch is still on. With provenance on, start writes the handoff even when the tier is
off, and a missing or broken gstack costs only the skill-usage rows.

## Author quickstart

After setup wires the binaries and telemetry is enabled, run these independently
from the same repository:

~~~sh
gstack-extend-telemetry start --skill "extend:roadmap"
gstack-extend-telemetry finish --skill "extend:roadmap" --outcome success
gstack-extend doctor telemetry --days 30
~~~

Start prints GE_TELEMETRY: session=extend-<uuid> start=<epoch>. Finish needs neither
value copied. Expect two rows sharing a session_id:

~~~json
{"v":1,"event_type":"skill_start","skill":"extend:roadmap","session_id":"extend-example","ts":"2026-09-20T12:00:00Z","repo":"example","source":"gstack-extend"}
{"v":1,"event_type":"skill_run","skill":"extend:roadmap","session_id":"extend-example","ts":"2026-09-20T12:00:03Z","duration_s":3,"outcome":"success","source":"gstack-extend"}
~~~

Finish also appends one provenance row to stage-runs.jsonl (see
[Execution provenance](#execution-provenance)).

The completion example omits upstream metadata. No event key is introduced:
historical rows already use that key for prepared-not-started. **duration_s is
session wall-clock**, including human waiting and pauses, not model/token spend.
Upstream silently nulls values above 86400 seconds; resumable workflows will
routinely lose their duration.

Copy both complete SHARED blocks below into a skill and replace the quoted
"extend:full-review" argument with its name. Keep the quotes: the drift lock
substitutes that exact string. Each block has one telemetry invocation; its guard
only resolves the install and contains a missing binary. Lookup is PATH →
$HOME/.claude/skills/gstack-extend/bin → setup's .extend-root pointers under
$HOME host skill directories (setup writes one for Claude, Codex, and OpenCode).
A candidate must be an absolute regular file and carry the `telemetry-protocol:
start-finish-v1` line, so a relative PATH entry such as node_modules/.bin, or an
older wrapper another checkout re-linked onto PATH, is skipped instead of run.
The line is a version-compatibility probe, not a trust check, and the same
absolute-path rule protects the wrapper's lookup of gstack's own helpers. It does
not protect other commands: a relative PATH entry still affects git, python3, and
everything else an agent runs, so remove such entries from PATH.
The first line of the guard keeps an unmatched pointer glob from aborting the
block under zsh. GSTACK_EXTEND_DIR is not required. CWD-relative pointers are
ignored. Existing setup wiring already handles this binary, and upgrade invokes
setup again.

<!-- SHARED:telemetry-start -->
### Telemetry start

Run once when this skill begins. On resuming a paused invocation in the same repository, keep its existing handoff and skip another start. Telemetry is optional; see [docs/telemetry.md](https://github.com/kbitz/gstack-extend/blob/main/docs/telemetry.md). State, tier gating, and session wall-clock duration are handled by the binary; do not copy session values between calls.

```bash
if [ -n "${ZSH_VERSION:-}" ]; then setopt +o nomatch; fi
_ge_ok() { case "$1" in /*) [ -f "$1" ] && [ -x "$1" ] && grep -q 'telemetry-protocol: start-finish-v1' "$1" ;; *) false ;; esac; }
_GE_BIN=$(command -v gstack-extend-telemetry 2>/dev/null || true)
if ! _ge_ok "$_GE_BIN"; then _GE_BIN="$HOME/.claude/skills/gstack-extend/bin/gstack-extend-telemetry"; fi
if ! _ge_ok "$_GE_BIN"; then
  _GE_BIN=""
  for _GE_PTR in "$HOME"/.claude/skills/*/.extend-root "$HOME"/.codex/skills/*/.extend-root "$HOME"/.config/opencode/skills/*/.extend-root; do
    if [ -f "$_GE_PTR" ] && [ -r "$_GE_PTR" ]; then
      IFS= read -r _GE_ROOT < "$_GE_PTR" || true
      if _ge_ok "$_GE_ROOT/bin/gstack-extend-telemetry"; then _GE_BIN="$_GE_ROOT/bin/gstack-extend-telemetry"; break; fi
    fi
  done
fi
if [ -n "$_GE_BIN" ]; then
  "$_GE_BIN" start --skill "extend:full-review" || true
elif [ "${GSTACK_EXTEND_TELEMETRY_DEBUG:-}" = "1" ]; then
  echo 'telemetry skipped: gstack-extend-telemetry unresolvable or stale. Fix: re-run ./setup. See docs/telemetry.md.' >&2
fi
true
```
<!-- /SHARED:telemetry-start -->

<!-- SHARED:telemetry-finish -->
### Telemetry finish

Run when this invocation completes. Set `--outcome` to the actual result (`success`, `error`, `abort`, or `unknown`). A deliberate pause defers finish until completion. Telemetry is optional; see [docs/telemetry.md](https://github.com/kbitz/gstack-extend/blob/main/docs/telemetry.md). State, tier gating, and session wall-clock duration are handled by the binary; do not copy session values between calls.

```bash
if [ -n "${ZSH_VERSION:-}" ]; then setopt +o nomatch; fi
_ge_ok() { case "$1" in /*) [ -f "$1" ] && [ -x "$1" ] && grep -q 'telemetry-protocol: start-finish-v1' "$1" ;; *) false ;; esac; }
_GE_BIN=$(command -v gstack-extend-telemetry 2>/dev/null || true)
if ! _ge_ok "$_GE_BIN"; then _GE_BIN="$HOME/.claude/skills/gstack-extend/bin/gstack-extend-telemetry"; fi
if ! _ge_ok "$_GE_BIN"; then
  _GE_BIN=""
  for _GE_PTR in "$HOME"/.claude/skills/*/.extend-root "$HOME"/.codex/skills/*/.extend-root "$HOME"/.config/opencode/skills/*/.extend-root; do
    if [ -f "$_GE_PTR" ] && [ -r "$_GE_PTR" ]; then
      IFS= read -r _GE_ROOT < "$_GE_PTR" || true
      if _ge_ok "$_GE_ROOT/bin/gstack-extend-telemetry"; then _GE_BIN="$_GE_ROOT/bin/gstack-extend-telemetry"; break; fi
    fi
  done
fi
if [ -n "$_GE_BIN" ]; then
  "$_GE_BIN" finish --skill "extend:full-review" --outcome unknown || true
elif [ "${GSTACK_EXTEND_TELEMETRY_DEBUG:-}" = "1" ]; then
  echo 'telemetry skipped: gstack-extend-telemetry unresolvable or stale. Fix: re-run ./setup. See docs/telemetry.md.' >&2
fi
true
```
<!-- /SHARED:telemetry-finish -->

## Diagnose and interpret

~~~sh
gstack-extend doctor telemetry --days 30
gstack-extend doctor telemetry --days 30 --json
GSTACK_EXTEND_TELEMETRY_DEBUG=1 gstack-extend-telemetry start --skill "extend:roadmap"
~~~

Doctor is read-only and always exits zero for missing/empty sinks, malformed
JSON, partial tails, and bad arguments. Debug mode prints the resolved binaries,
tier and sink, the provenance switch and sink, and the detected agent, model, and
effort. It explains missing gstack/config, disabled tiers, rejected input,
unwritable sinks/state, or upstream failure with corrective commands. Doctor
reports skill-usage.jsonl only.
The skill guard and doctor diagnose an unresolvable extend binary: a missing
binary cannot diagnose itself. Normal skip paths remain silent. Missing Python
is diagnosed by the shell guard in debug mode, or by doctor. Doctor also warns
(text mode, and `warnings` plus `stale_wrapper` and `logger_supports_no_sweep` in
JSON) about a stale wrapper that predates the start/finish protocol and about a
gstack logger without --no-sweep; both mean completions or starts are being
skipped rather than misfiled.

Every installed skill appears, including zero-row skills. Activity counts include
legacy rows, but ratios exclude them. Completions the pre-rollout wrapper wrote
carry the current row shape but no matching start, so they show as unpaired-finish
until they age out of the window. JSON also includes duplicate/retry/legacy
counts, window-crossing completions, and parse diagnostics.

| Case | Treatment |
|---|---|
| Numerator | Distinct (skill, session_id) in-window v1 skill_start records with v1 skill_run completion |
| Denominator | Those distinct in-window starts, excluding deferred resumable finishes |
| Window | Inclusive UTC [now - days, now], default 30 days; future rows excluded |
| Duplicate starts | One invocation per key; earliest start sets the window; duplicates reported |
| Retried finishes | One match per key; extra finishes reported |
| File order | Join all history before filtering; finish-before-start file order still pairs |
| Start outside window | An in-window finish is crossing-window, not unpaired |
| Legacy / session alias / missing v or ID | Visible separately; no invented IDs or pairing |
| Finish without matching start | Unpaired-finish, never a crash or negative numerator |
| pair-review, review-and-prep, test-plan | Resumable: unmatched starts are deferred finishes, excluded from ratio |
| Pause/resume | One invocation: skip another start for the same paused run; finish when complete |
| Other unfinished runs | Unpaired starts until finish arrives; can temporarily lower the ratio, without proving failure |
| Disabled telemetry | No new observations; historical rows still display; no inferred disabled-period invocations |
| Missing transcripts | Advisory count unavailable, not zero; pairing remains measurable |
| No eligible starts | Insufficient evidence, never a fabricated 0% or 100% |

Transcripts are read recursively, including subagents/, with tool-use IDs
deduplicated. They are **Claude-only, local-only, retention-deleted** and do not
cover Codex or other hosts. In a sample taken on 2026-09-20 during planning, 71%
of recent transcript files were nested under subagents. These counts are advisory,
never ratio inputs.
A skipped start has no row and cannot be detected by in-skill telemetry; perfect
pairing does not establish complete invocation coverage.

## Baseline and decision rule

Local implementation baseline captured 2026-09-20, before installing the
new blocks. Window: 2026-08-21T23:33:55.854332+00:00 through 2026-09-20T23:33:55.854332+00:00.

| Skill | Activation rows | Completion rows | Paired / eligible | Advisory transcripts |
|---|---:|---:|---:|---:|
| pair-review | 5 | 2 | 0/0 | 1 |
| roadmap | 20 | 20 | 0/0 | 15 |
| full-review | 2 | 2 | 0/0 | 0 |
| review-apparatus | 0 | 0 | 0/0 | 0 |
| test-plan | 1 | 1 | 0/0 | 0 |
| gstack-extend-upgrade | 0 | 0 | 0/0 | 0 |
| gstack-extend-init | 0 | 0 | 0/0 | 1 |
| review-and-prep | 0 | 0 | 0/0 | 0 |
| implement | 0 | 0 | 0/0 | 0 |

All nine ratios are **insufficient evidence**: historical starts lack the new
joinable schema. The scan also found one malformed line and one nameless row.
This is a pre-rollout baseline, not a zero-percent failure score.


After rollout, collect a fresh 30-day report and publish per-skill pairing.
If any skill is below 95% with an eligible start denominator and nonzero local
transcript invocations, **schedule the deferred in-flight marker and crash-detection work** rather than
re-arguing that trigger. Doctor exposes schedule_marker_work in JSON and a
decision message in text. Deferred resumable runs are excluded. Missing
transcripts or zero eligible starts provide insufficient evidence for the trigger.
Diagnose skipped starts separately: markers cannot repair a command never run.

This is a baseline plus a future decision rule, not a claim that this rollout
already demonstrates 95% capture. This change ships no hook, gstack sweep patch,
or marker/crash detection subsystem.

## Cursor and quota

Cursor is an execution harness (`agent: cursor`), independently of the vendor of
the selected model. Local native SDK runs supply model and effort when readable;
otherwise these are null. Cursor transcript activity supports nested-harness
detection. Billed model and consumption belong to the separate
[quota ledger](quota-ledger.md). Telemetry start and finish never start a quota
sampler or write quota records. Only explicit quota commands read vendor usage.
