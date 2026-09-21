# Skill telemetry

All nine installed skills carry optional start and finish calls. They record local
frequency, session wall-clock duration, and reported outcome. They do not measure
model effort, token spend, or output quality. Python 3.9+ provides JSON escaping
and state handling; missing Python or gstack skips telemetry without failing the
skill.

## Two different datasets

- **skill-usage.jsonl** contains local, model-invoked skill telemetry. It answers
  which observed runs started, finished, and reported an outcome, and how long
  their sessions lasted.
- **mm retro-fleet** counts Claude Code transcript tool-use records whose name is
  Skill, gathered across machines by mind-meld. Instrumenting these skills does
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

The off tier (also missing, unreadable, or invalid config) produces no new rows
or handoffs. Anonymous and community tiers enable local rows. Enabling is an
explicit choice: gstack-config set telemetry community.

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
gstack. Start never uses the logger, so it is unaffected.

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
starts with -- is accepted. Without valid state, finish writes nothing. A successful finish
consumes only its matching handoff; explicit retries can still supply their IDs.
State is separate from gstack analytics. There is no sweep, age bound, crash
detection, historical backfill, or inferred failure.

**Collision limit:** simultaneous runs of the same skill in the same repository
share a slot; the later start replaces it. Explicit start/session flags are the
escape hatch. Different Conductor workspaces have different roots and separate
slots. Handoffs are local: cross-machine resumes must carry explicit values to
emit an identifiable completion; that row may remain unpaired locally.

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
tier and sink, and explains missing gstack/config, disabled tiers, rejected
input, unwritable sink/state, or upstream failure with corrective commands.
The skill guard and doctor diagnose an unresolvable extend binary: a missing
binary cannot diagnose itself. Normal skip paths remain silent. Missing Python
is diagnosed by the shell guard in debug mode, or by doctor. Doctor also warns
(text mode, and `warnings` plus `stale_wrapper` and `logger_supports_no_sweep` in
JSON) about a stale wrapper that predates the start/finish protocol and about a
gstack logger without --no-sweep; both mean completions or starts are being
skipped rather than misfiled.

Every installed skill appears, including zero-row skills. Activity counts include
legacy rows, but ratios exclude them. JSON also includes duplicate/retry/legacy
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
