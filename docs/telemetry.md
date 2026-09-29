# Skill telemetry

Skill authors: [Author quickstart](#author-quickstart).
Operators: [Diagnose and interpret](#diagnose-and-interpret).
Consumers joining the files: [Join contract](#join-contract).
Anyone checking claims: [Evidence](#evidence).

All eight installed skills carry optional start and finish calls. They record local
frequency, session wall-clock duration, and reported outcome, and finish records
which harness, model, and effort level ran the skill (see
[Execution provenance](#execution-provenance)). They do not measure token spend or
output quality. Python 3.9+ provides JSON escaping and state handling; missing
Python skips telemetry without failing the skill, and missing gstack skips only the
skill-usage rows.

## Three datasets

- **skill-usage.jsonl** contains local, model-invoked skill telemetry. A
  `skill_start` row means a start ran with gstack's tier on. A `skill_run` row
  records a completion append; it does not prove the wrapper saw a successful return. A
  missing row is not evidence that a run did not happen.
- **stage-runs.jsonl** contains a local provenance row when a finish ran with
  provenance on and the append succeeded. It answers which harness, model, and
  effort level that finish recorded, in the documented schema any caller can join.
  One row is one successful append, not proof of one independent run.
- **Transcript-derived counts from other tools** count transcript tool-use records
  whose name is Skill, potentially gathered across machines. Instrumenting these skills does
  not change those counts. Fleet totals cannot be the denominator of a local
  telemetry ratio.

Parse JSONL as JSON, never with grep: compact and spaced serialization are equally
valid. Pairing gstack-extend's own stage-runs rows with skill-usage uses
`(skill, session_id)`. Rows other callers write, and the quota ledger, join
stage-runs by `session_id` alone. Historical planning counts are in
[Evidence](#evidence).
Compare starts and finishes on the same machine and time window; fleet
invocation totals alone do not establish local pairing.

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
The effective tier is whichever file that ladder selects for the process that
ran. Tests isolate HOME as well as overrides and never write to the real user sink.

### gstack helper lookup

`gstack-telemetry-log` and `gstack-config` share one candidate list. The doctor
prints that list when a helper is missing. First match wins:

1. Absolute PATH entries, displayed as the token `PATH (absolute entries)` and never expanded.
2. `$GSTACK_DIR/bin`, only when `GSTACK_DIR` is absolute. PATH outranks it. `GSTACK_DIR` is a fallback location for a non-standard layout, not an override.
3. `$CLAUDE_CONFIG_DIR/skills/gstack/bin`, only when `CLAUDE_CONFIG_DIR` is set and absolute.
4. `~/.claude/skills/gstack/bin`.
5. `$CODEX_HOME/skills/gstack/bin`, only when `CODEX_HOME` is set and absolute. gstack's own setup installs there when `CODEX_HOME` is set.
6. `~/.codex/skills/gstack/bin`, always. A relative or empty `CODEX_HOME` drops only its own candidate.
7. `~/.config/opencode/skills/gstack/bin`.
8. `~/.cursor/skills/gstack/bin`.

Every candidate is home-anchored or an absolute `GSTACK_DIR`, `CLAUDE_CONFIG_DIR`,
or `CODEX_HOME`. Nothing cwd-relative or repository-local is probed. gstack's
Factory and Kiro roots are excluded, as are repository-local `.agents` and
`.cursor` roots. `GSTACK_DIR`, `CLAUDE_CONFIG_DIR`, and `CODEX_HOME` carry the
same trust as an absolute PATH entry: the path must be absolute, and an absolute
path that points into a repository is still accepted. A relative value is ignored.

When either helper does not resolve, debug output and `gstack-extend doctor telemetry`
share the substring `gstack helper unresolvable:`, name only the missing helper(s),
and list the searched locations. The doctor warning then says either `provenance
rows still record` or `provenance is off, so nothing records`, and ends with the
install fix (`./setup --host <host>` in the gstack checkout, or set `GSTACK_DIR`),
then `rerun gstack-extend doctor telemetry`, then `See docs/telemetry.md`. JSON
adds `gstack_logger` and `gstack_config`, each a resolved path or null. Such a
machine writes no skill-usage rows. With provenance on, stage-runs still records.

When `GSTACK_DIR` is unset, finish runs the logger with `GSTACK_DIR` set to the
real checkout containing that logger (its resolved path, two directories up), so
a helper under a host runtime root still reports gstack's real version. An
explicit `GSTACK_DIR` is passed through unchanged.

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
$HOME/.gstack-extend; a relative `GSTACK_EXTEND_STATE_DIR` is ignored), under
telemetry/<hash>.json. The hash includes repository root plus skill. The handoff
stores `skill` (the `extend:<name>` argument), `root` (the git toplevel, otherwise
cwd — the same string that enters the hash), and `harness`, beside `session_id`,
`start`, and `usage`. `harness` is a session-fingerprint hash, not a harness name:
the SHA-256 hex digest of the compact JSON list of `[name, value]` pairs, sorted
by name, for each marker whose value passes `valid_session`. The markers are
`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `CURSOR_CONVERSATION_ID`, and
`GROK_SESSION_ID` only when `GROK_AGENT=1` (the same gate `detect()` uses). Names
are hashed with the values, so equal IDs from different harnesses do not collide.
No valid marker stores null. Debug mode names the markers that contributed and
never prints their values.

A valid explicit `--session-id` keeps its previous behavior and is never
age-bounded. An explicit `--start` alone does not bypass adoption. With a valid
explicit `--session-id`, an explicit `--start` still supplies the time, and a
handoff whose `session_id` matches may supply `start` when `--start` is omitted.
A flag followed directly by another flag (a missing value) skips the call; a value
that merely starts with -- is accepted. Without valid state, finish writes nothing.
A finish that wrote every enabled output consumes only its matching handoff. After
a partial failure the handoff records the outputs whose writes were acknowledged,
so a retry skips those outputs. A logger timeout can leave an unacknowledged write;
an explicit retry after the handoff was consumed can also duplicate rows (see
[Join contract](#join-contract)). A start whose
skill-usage append fails still saves that handoff when provenance is on, and
finish records the provenance row without sending a skill-usage completion for
the start that never landed.
State is separate from gstack analytics. There is no sweep or crash
detection, no historical backfill, and no inferred failure. The age rule is
[Handoff adoption](#handoff-adoption).

**Collision limit:** misattribution remains only within one harness session, or
when either fingerprint is unknown. A distinct known session's earlier finish is
refused and the handoff stays. Two starts of one skill in one checkout still share
a slot; the later start replaces it. If the fingerprints are equal or unknown and
the adoption rule accepts the handoff, and the earlier-started run finishes first,
stage-runs holds one row with the later start's `session_id` and `started_at` and
the earlier finish's outcome. With the tier on, skill-usage pairs the later
`skill_start` with that finish's `skill_run` and leaves the earlier `skill_start`
unpaired. The later finish then finds no handoff and writes nothing. If the later
run finishes first, the row is correctly its own and the earlier run has no row.
The unknown-fingerprint form of that defect is still current behavior. When the
two runs carry different known fingerprints, the earlier finish is refused and the
later finish pairs with its own start. Explicit `--session-id` and `--start`
together are the escape hatch. Different checkouts have different roots and
separate slots. A finish never reads another root's slot. A same-skill handoff
already sitting in the destination root is judged by the adoption rule; it is not
read from the origin. Handoffs are local: cross-machine resumes must
carry explicit values to emit an identifiable completion; that row may remain
unpaired locally.

### Handoff adoption

A finish reads only its own root+skill slot. The rule applies when the finish has
no valid explicit `--session-id`, including a legacy `--duration` finish and a
handoff a previous finish already attempted (`done` or `row`). Evaluating it never
raises: a non-string `harness` counts as an unknown fingerprint, and a non-integer
`start` counts as invalid. `start` is checked first. Bools, negatives, floats, and
non-numeric strings are invalid. A numeric string and a JSON integer are valid.
An invalid or missing `start` keeps the older debug line, `missing or malformed
start/session state`, with no reason and no `root=`.

The 24-hour bound is 86400 seconds, inclusive. A future `start` counts as age 0.
The bound matches the ceiling upstream uses when it nulls `duration_s`.

| Skill class | Fingerprint | Age | Result | Debug reason | Fix |
|---|---|---|---|---|---|
| No handoff in this root+skill slot |  |  | write nothing | `no handoff for this repository root` | Start never ran in this root, the handoff was already consumed, this is the second finish of a same-root collision, or start ran in another root. Finish from the repository root where start ran, or pass `--session-id` and `--start` from the `GE_TELEMETRY: session=… start=…` line |
| Any |  | `start` missing or invalid | write nothing; older message, no reason |  | Run start again, or pass both flags |
| Resumable: `pair-review`, `review-and-prep`, `full-review` | any | any, once `start` is valid | adopt |  |  |
| Non-resumable | both non-null and equal | any | adopt |  |  |
| Non-resumable | both non-null and different | any | refuse; the handoff stays | `handoff from another session` | Finish in the harness session that ran start, or pass both flags from the `GE_TELEMETRY` line |
| Non-resumable | either value null | at most 86400 seconds | adopt |  |  |
| Non-resumable | either value null | older than 86400 seconds | refuse; the handoff stays | `handoff too old`, with age and bound | Run start again for a new run, or pass both flags from the `GE_TELEMETRY` line |

A refused handoff keeps every existing key and gains `refusals`, a list of at most
10 `{reason, at}` entries. The oldest entry is dropped first. `reason` is
`handoff from another session` or `handoff too old`.

A finish that adopts nothing prints exactly one debug line. Other debug lines,
such as `gstack helper unresolvable:`, may precede it. `root=` and `handoff=` are
JSON-quoted, so a newline in the path stays on one line:

~~~
telemetry skipped: missing or malformed start/session state (handoff from another session; root="/path/to/repo"; handoff="/Users/me/.gstack-extend/telemetry/<hash>.json"). Fix: finish in the harness session that ran start, or pass --session-id and --start from the GE_TELEMETRY: session=… start=… line. See docs/telemetry.md.
~~~

**Known limits.** A cross-root finish writes nothing unless it passes explicit
`--session-id` and `--start`. It never reads another root's handoff. A same-skill
handoff already in the destination root is judged by the rule above. Inside one
harness session, a start-less non-resumable finish adopts that session's open
start in the same root at any age. Subagents inherit the parent's session marker
and count as the same session. A finish inside a nested harness (`codex exec`
launched from Claude Code) carries an extra marker and counts as another session,
so a non-resumable finish there is refused. Resumable adoption stays unbounded,
so a start-less finish can adopt an abandoned resumable start; revisit that when
the doctor coverage report shows resumable pause durations. An unknown-fingerprint
adoption within 24 hours can still belong to another run, so a successful join is
not proof of attribution. A non-resumable skill resumed in a new harness session
is refused. The resume instruction holds across sessions only for the resumable
skills. Whether `CLAUDE_CODE_SESSION_ID` stays constant from start through a later
user turn and a `claude --resume` is unverified: Claude Code in this environment
was not logged in, so no session was observed. The marker stays in the fingerprint.

**Upgrading existing handoffs.** Handoffs written before this change have no
`skill`, `root`, or `harness`. A start-less finish of a non-resumable skill now
adopts one only within 24 hours. Resumable skills are unaffected. To finish an
older non-resumable run, pass the original wrapper-issued session id and start
epoch from that run's `GE_TELEMETRY: session=… start=…` line. Those values are
not harness markers such as `CODEX_THREAD_ID`. Do not run a new start for the run
being recovered: a new start replaces the slot.

~~~sh
gstack-extend-telemetry finish --skill "extend:roadmap" \
  --session-id extend-ORIGINAL --start ORIGINAL_EPOCH --outcome success
~~~

## Execution provenance

skill-usage.jsonl has no model or agent field, and gstack-skill-start drops its
`--model` argument (upstream), so no gstack row says which vendor ran a stage.
When provenance is on and the append succeeds, finish appends one row to
$GSTACK_EXTEND_STATE_DIR/analytics/stage-runs.jsonl (default
`$HOME/.gstack-extend/analytics/stage-runs.jsonl`). **The file is local-only**:
gstack-telemetry-sync never reads it, so branch and work item never leave the
machine. It is created mode 0600. A symlink, FIFO, or extra hard link at that path is not written. The provenance config and the finish handoff are read the same way, so none of those stand-ins can stall a skill. The schema is gstack-extend’s documented contract. External callers can join it
by session_id and use their own source labels:

| Field | Hand-run value |
|---|---|
| `stage` | Skill name without `extend:`, e.g. `roadmap` |
| `agent` | `claude`, `codex`, `grok`, or `cursor`; null when unverifiable |
| `model` | Model ID the harness logged, e.g. `claude-opus-5`, `gpt-6-astra` |
| `effort` | Effort level the harness logged, in its own vocabulary (`xhigh`, `high`) |
| `rung` | Always 0: a hand-run skill has no fallback chain |
| `outcome` | `success`, `error`, `abort`, or `unknown`; any other value becomes `unknown` |
| `started_at` | UTC start; null when an explicit `--start` or a legacy `--duration` cannot be represented as a UTC time |
| `duration_s` | Session wall-clock seconds including human waits, never capped |
| `session_id` | Wrapper-issued IDs are `extend-<uuid>`; an explicit `--session-id` can be any valid ID |
| `repo` | origin's owner/name (never its host or credentials); the root's name without a parseable origin; null outside git or when git cannot be read |
| `branch` | Branch at finish; null outside git or when detached |
| `work_item` | Null unless finish passes `--work-item` |
| `source` | `gstack-extend` |
| `route` | `cli`, `conductor`, `sdk`, or `unknown`, from the selected harness markers |
| `entrypoint_raw` | The selected harness entrypoint marker, when present |

Every stage-runs field except `route` and `entrypoint_raw` is present from
v0.28.0.0; those two are present from v0.29.0.0 and absent on earlier rows. The
`agent` value `cursor` appears from v0.29.0.0 (v0.28.0.0 accepted `claude`,
`codex`, and `grok`). Rows carry no schema or producer version, so an absent key
is unknown, not a known older release.

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
gstack's logger. The row does not record whether `model` or `effort` was supplied
by a flag or read from a log; `agent` overrides are likewise unmarked.

**Switch.** Provenance is on by default and independent of gstack's tier, because
its rows stay local while enabling the tier also enables the upload. Turn it off
with `"$HOME/.claude/skills/gstack-extend/bin/config" set provenance false` (`off`
also works). A missing config stays on. An unreadable config stays off: a file
that cannot be read is not evidence the switch is still on. With provenance on, start writes the handoff even when the tier is
off, and a missing or broken gstack costs only the skill-usage rows.

## Join contract

For a wrapper-issued start plus a finish that recovers both values from the
handoff, where one finish attempt both built the stage-runs row and delegated
the completion, and `duration_s` is at most 86400: the rows share
`(skill, session_id)`, `skill_start.ts` minus `started_at` is normally 0 or 1
second, and the durations are equal. A successful join establishes structural
correspondence, not correct run attribution. No bound on the start-time gap is
guaranteed: a process pause or a clock step can exceed one second.

The worked example is the three-line block under [Author quickstart](#author-quickstart).
Stage-runs `stage` `roadmap` joins skill-usage `skill` `extend:roadmap` with the
same `session_id`.

1. Keep rows with `source` equal to `gstack-extend`. `source` is a label the writer chooses: any caller that writes that label is indistinguishable from the wrapper.
2. Treat a skill-usage row as legacy unless `v` is the integer 1, `session_id` is a non-empty string, and `event_type` is `skill_start` or `skill_run` (the doctor's rule). Drop legacy rows. A modern v1 `skill_run` with no matching start is an unpaired completion of unknown issuance. `ts` and ID shape are hints only, and none is attributed to the pre-rollout wrapper without independent evidence.
3. To pair gstack-extend's own stage-runs rows with skill-usage, key on `(skill, session_id)`, mapping stage-runs `stage` to `extend:<stage>`. Rows other callers write to stage-runs, and the quota ledger, join by `session_id` alone. `(skill, session_id)` is a correlation key, not a unique key: expect duplicate or conflicting rows for one key and keep them visible rather than silently picking one.
4. A session ID without the `extend-<uuid>` shape came from explicit flags or an older writer and may stay unpaired locally. An explicit retry that reuses the original IDs pairs normally. The `extend-` prefix alone does not prove the wrapper issued the ID.
5. Sort per dataset. Stage-runs file order is finish order: sort by `started_at`, null last (an unrepresentable explicit start or legacy duration). Sort `skill_start` by `ts` (its start time). A `skill_run` `ts` is its finish time. Skill-usage file order interleaves starts and finishes.
6. Treat an absent key as unknown.

Session IDs match `[A-Za-z0-9][A-Za-z0-9._:-]{0,199}` (the wrapper's `valid_session`).
gstack-extend's `ts` and `started_at` use UTC `YYYY-MM-DDTHH:MM:SSZ` at second
precision, so string order equals time order. Upstream `skill_run.ts` uses the
same format, read in gstack 1.89.1.0 source and seen on captured `skill_run` rows
whose `gstack_version` is 1.87.4.0 and 1.87.5.0.

The upstream duration cap and successful exits without a write in the table
below were read in gstack 1.89.1.0's logger source. The `--no-sweep` guard is
the current wrapper's handling of a logger whose source lacks that flag.

| Case | Effect | Consumer handling | Source |
|---|---|---|---|
| Explicit `--session-id` finish | Carries the caller's ID, which need not have the `extend-<uuid>` shape | Do not require the `extend-` prefix | `an explicit --session-id never borrows the start time of a different session's handoff` in tests/telemetry.test.ts |
| Explicit `--start` or legacy `--duration` finish | `started_at` comes from that value, not from any `skill_start` row; a value that cannot be represented as a UTC time makes `started_at` null. A legacy `--duration` without `--session-id` writes only when [Handoff adoption](#handoff-adoption) accepts the slot. `--start` without `--session-id` does not bypass a refusal | Do not expect `started_at` to match a start row | `legacy finishes date the row from their duration; an unrepresentable start is null, never a crash` and `a legacy duration finish with an implicit session follows the rule` in tests/telemetry.test.ts |
| Different attempts | Stage-runs `duration_s` is fixed by the first attempt that built the row (a failed append saves the row for reuse). `skill_run.duration_s` comes from the attempt that delegated: null above 86400, which upstream nulls, or, on a later attempt with the handoff-recovered start and a nondecreasing clock, greater than or equal to stage-runs `duration_s`. A changed explicit `--start` gives no ordering. Stage-runs never caps | Do not equate the two durations across attempts | `a finish retried after a partial failure never duplicates either row` and `provenance duration stays wall-clock past a day while skill-usage nulls it` in tests/telemetry.test.ts |
| Start without `skill_start` | Tier off, gstack unavailable at start, a transient gstack-config failure, or a failed append: the handoff records `usage: false` when provenance is on, so finish sends no `skill_run` even if the tier is on by then. With provenance off, a start that wrote no `skill_start` saves no handoff | Expected when the tier is off, not a failure | `a failed skill-usage start does not invent a completion; provenance off writes no handoff` in tests/telemetry.test.ts |
| Tier turned off before finish | Consumes the handoff and leaves that `skill_start` unpaired permanently. With provenance off, turning the tier off before finish leaves the handoff (`usage: true`) for a later start-less finish to adopt under the rule | Do not treat the unpaired start as a crash | `tier turned off before finish consumes the handoff and leaves that skill_start unpaired` in tests/telemetry.test.ts |
| Same-root collision | Misattribution remains only within one harness session or with an unknown fingerprint. A distinct known session's earlier finish is refused. The unknown-fingerprint case is still current behavior: when the earlier-started run finishes first, its outcome lands on the later start's identity; when the later run finishes first, the row is correct and the earlier run has no row | Do not attribute that row's outcome to the start without other evidence when the fingerprint was unknown or shared | `same-root collision misattributes the earlier finish (current behavior)` in tests/telemetry-contract.test.ts; `a fingerprinted same-root collision refuses the earlier session and pairs the later one` in tests/telemetry.test.ts |
| Finish whose own start never ran | Adopts the same-root handoff only under [Handoff adoption](#handoff-adoption). An unknown fingerprint within 24 hours still joins while outcome and duration can belong to a different run | A join is not proof this finish's start wrote the handoff | `an unknown-fingerprint handoff within 24 hours is adopted and a join is not proof` in tests/telemetry.test.ts |
| Finish from a different repository root | Writes nothing. Debug says `no handoff for this repository root`. The other root's handoff is untouched. A same-skill handoff already in the destination root is judged by the adoption rule | Do not search other roots to repair it | `a finish from a different repository root writes nothing` and `a cross-root finish into an occupied destination slot is judged by the rule` in tests/telemetry.test.ts |
| Upstream logger exits 0 without writing | Its own tier read or a failed append: the wrapper records the completion as delivered and the `skill_start` stays unpaired | A delivered completion is not a `skill_run` row | untested |
| Logger without `--no-sweep` | `skill_start` is written, but this finish writes no `skill_run`. The handoff remains; with provenance on, a successful provenance append adds `done: ["provenance"]`. With provenance off it remains untouched. After upgrading the logger, another finish adopts the retained handoff only under [Handoff adoption](#handoff-adoption) | Upgrade gstack and retry finish; do not infer a permanent missing completion | `a logger without --no-sweep support is not delegated to; the handoff is kept and debug explains the upgrade` in tests/telemetry.test.ts |
| Run spans a gstack-extend upgrade | Notably `/gstack-extend-upgrade`: start and finish follow different wrapper versions and may leave no row | Do not infer a missing row is a skipped skill | untested |
| Explicit retry after success (current behavior) | A second finish with the original IDs appends a second stage-runs row and a second `skill_run` | Keep both rows; do not collapse the key | `explicit retry appends a second stage-runs row and a second skill_run (current behavior)` in tests/telemetry-contract.test.ts |
| Logger timeout after writing | Can leave an uncertain completion: the row may exist while the wrapper does not know the write finished | Treat a timeout as unknown, not as absence | untested |

`repo` does not join across datasets. `skill_start.repo` is the checkout directory
name (`Path(root).name`; under a workspace manager that is the workspace name, not
a repository). Stage-runs `repo` is the last two path segments of the origin URL
(nested groups collapse to those two); without a parseable origin it is the
checkout directory name; outside git or when git cannot be read it is null.
Upstream `skill_run` has no `repo`. Its
`_repo_slug` is upstream-owned: read in gstack 1.89.1.0 source, the logger sets it
from the trailing owner/name of `git remote get-url origin`, stripping `.git`
and replacing `/` with `-` (for example, `acme-widget`), and it is an empty
string outside git. It is not a join key. The same source sets `_branch` from
`git rev-parse --abbrev-ref HEAD`, which is `HEAD` on a detached checkout, while
stage-runs `branch` is null there. Both keys appear on captured `skill_run` rows
at gstack 1.87.4.0 and 1.87.5.0. Outside git, `skill_start.repo` is the string
`unknown` while stage-runs `repo` and `branch` are null. These divergences are
current behavior.

A `skill_start` row means a start ran with gstack's tier on. A `skill_run` row
records a completion append, even if the logger later timed out or failed. A stage-runs row means
a finish ran with provenance on and its append succeeded. A missing row is not
evidence that a run did not happen. Upstream nulls `skill_run.duration_s` above
86400 seconds (read in gstack 1.89.1.0 source, `gstack-telemetry-log`); stage-runs
never caps. `skill_run.gstack_version` is upstream's version, seen on captured
rows; no row carries a gstack-extend version.

**What provenance can and cannot prove.** One stage-runs row per extend-skill
finish whose append succeeded. Unless a valid `--agent` overrides detection,
the agent is the harness detected for the finish command: the nearest marked
ancestor when several harness markers are present, otherwise the latest
comparable harness log when ancestry is unavailable. Model and effort are the pair behind the most turns in the
window. Subagent (sidechain) turns are skipped. Nested reviewer voices
(outside-voice CLIs, subagents, external review services) write no row. Explicit
`--agent`, `--model`, and `--effort` overrides are not marked as supplied. These rows alone
cannot certify that a review had an independent voice.

## Author quickstart

After setup wires the binaries, run these independently from the same repository.
"Telemetry is enabled" means gstack's tier, which is distinct from the provenance
switch. With the tier on, one start and finish write two skill-usage rows plus
one stage-runs row. With the tier off and provenance on (the default), they write
no skill-usage rows and one stage-runs row. Python 3.9 or newer is optional; without
it every call is a silent no-op. When `~/.local/bin` is not wired, call the
binaries directly:
`~/.claude/skills/gstack-extend/bin/gstack-extend-telemetry` and
`~/.claude/skills/gstack-extend/bin/gstack-extend doctor telemetry`. The doctor's
`gstack_config` field is the resolved path of gstack's config helper, or null.
A skill that pauses across harness sessions has to be listed in `RESUMABLE` in
`bin/lib/telemetry.py`. Today that set is `pair-review`, `review-and-prep`, and
`full-review`. Other skills are refused when a later session finishes a start-less
run. See [Handoff adoption](#handoff-adoption), including the upgrade note for
handoffs written before that rule.

~~~sh
gstack-extend-telemetry start --skill "extend:roadmap"
gstack-extend-telemetry finish --skill "extend:roadmap" --outcome success
gstack-extend doctor telemetry --days 30
~~~

Start prints GE_TELEMETRY: session=extend-<uuid> start=<epoch>. Finish needs neither
value copied. The newest stage-runs row is:

~~~sh
tail -n 1 "${GSTACK_EXTEND_STATE_DIR:-$HOME/.gstack-extend}/analytics/stage-runs.jsonl"
~~~

`skill_start.repo` is the checkout directory name (a workspace name under
Conductor), not a repository identifier. The `skill_run` line below is abridged:
upstream adds metadata fields. No event key is introduced: historical rows already
use that key for prepared-not-started. **duration_s is session wall-clock**,
including human waiting and pauses, not model/token spend. Upstream silently nulls
values above 86400 seconds (gstack 1.89.1.0 source); resumable workflows will
routinely lose their duration.

~~~json
{"v":1,"event_type":"skill_start","skill":"extend:roadmap","session_id":"extend-example","ts":"2026-09-20T12:00:00Z","repo":"example","source":"gstack-extend"}
{"v":1,"ts":"2026-09-20T12:00:03Z","event_type":"skill_run","skill":"extend:roadmap","session_id":"extend-example","duration_s":3,"outcome":"success","source":"gstack-extend"}
{"stage":"roadmap","agent":"claude","model":"claude-opus-5","effort":"xhigh","rung":0,"outcome":"success","started_at":"2026-09-20T12:00:00Z","duration_s":3,"session_id":"extend-example","repo":"acme/widget","branch":"main","work_item":null,"source":"gstack-extend","route":"cli","entrypoint_raw":"cli"}
~~~

Copy both complete SHARED blocks below into a skill and replace the quoted
"extend:full-review" argument with its name. Keep the quotes: the drift lock
substitutes that exact string. Each block has one telemetry invocation; its guard
only resolves the install and contains a missing binary. Lookup is PATH →
$HOME/.claude/skills/gstack-extend/bin → setup's .extend-root pointers under
$HOME host skill directories (setup writes one for Claude, Codex, OpenCode, and Cursor).
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
  for _GE_PTR in "$HOME"/.claude/skills/*/.extend-root "$HOME"/.codex/skills/*/.extend-root "$HOME"/.config/opencode/skills/*/.extend-root "$HOME"/.cursor/skills/*/.extend-root; do
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
  for _GE_PTR in "$HOME"/.claude/skills/*/.extend-root "$HOME"/.codex/skills/*/.extend-root "$HOME"/.config/opencode/skills/*/.extend-root "$HOME"/.cursor/skills/*/.extend-root; do
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

Run the doctor first. A manual `start` replaces that slot's handoff, and a manual
`finish` can adopt and consume one, so never run another start for the run being
diagnosed. To debug a real run, export `GSTACK_EXTEND_TELEMETRY_DEBUG=1` before
launching the harness. Run synthetic smoke checks in a scratch repository.
The adoption reasons are defined in [Handoff adoption](#handoff-adoption).

| Reason | Meaning | Fix |
|---|---|---|
| `no handoff for this repository root` | This finish's root+skill slot is empty. Start never ran here, the handoff was already consumed, this is the second finish of a same-root collision, or start ran in another root | Finish from the repository root where start ran, or pass `--session-id` and `--start` from the `GE_TELEMETRY` line |
| `handoff from another session` | A non-resumable skill found a handoff whose fingerprint is a different known session | Finish in the harness session that ran start, or pass those two values |
| `handoff too old` | A non-resumable skill found an unknown fingerprint older than 86400 seconds. The line includes the age and the bound | Run start again for a new run, or pass those two values |
| `gstack helper unresolvable:` | `gstack-telemetry-log` or `gstack-config` was not found. The line names the missing helper(s) and the searched locations. Provenance may still record | Install gstack for this host (`./setup --host <host>` in the gstack checkout) or set `GSTACK_DIR`, then rerun `gstack-extend doctor telemetry` |

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
| pair-review, review-and-prep, full-review | Resumable: unmatched starts are deferred finishes, excluded from the ratio. Adoption is unbounded. Revisit when the doctor coverage report shows resumable pause durations |
| Pause/resume | One invocation: skip another start for the same paused run; finish when complete. The resume instruction holds across harness sessions only for resumable skills. A non-resumable skill resumed in a new harness session is refused |
| Other unfinished runs | Unpaired starts until finish arrives; can temporarily lower the ratio, without proving failure |
| Disabled telemetry | No new observations; historical rows still display; no inferred disabled-period invocations |
| Missing transcripts | Advisory count unavailable, not zero; pairing remains measurable |
| No eligible starts | Insufficient evidence, never a fabricated 0% or 100% |
| Every skill shows insufficient evidence and the tier is off | No skill-usage rows are written while the tier is off; stage-runs still records. To collect pairing evidence run `gstack-config set telemetry anonymous` or `gstack-config set telemetry community`. Both write local pairing rows; the logger adds a persistent `installation_id` only for `community`, while `anonymous` writes null and also drops the field from uploads (gstack 1.89.1.0 logger/sync source). Sync strips `repo`, `_repo_slug`, and `_branch` before upload (read in gstack 1.89.1.0 `gstack-telemetry-sync`: jq deletes the fields; the sed fallback mis-strips a value containing an escaped quote). Either tier also enables gstack's upload |

Transcripts are read recursively, including subagents/, with tool-use IDs
deduplicated. They are **Claude-only, local-only, retention-deleted** and do not
cover Codex, Grok, or Cursor. The counter reads `~/.claude/projects` only and
ignores `CLAUDE_CONFIG_DIR`. These counts are advisory, never ratio inputs.
A skipped start has no row and cannot be detected by in-skill telemetry; perfect
pairing does not establish complete invocation coverage.

## Decision rule

The doctor evaluates the 95% rule from historical rows whatever the current tier.
Turning the tier off stops new evidence and does not erase old evidence. Where a
window has no eligible v1 starts, the rule has insufficient evidence: the deferred
marker and crash-detection work has no trigger there. A tier-independent trigger
for periods without eligible observations is the "Doctor coverage report over
stage-runs and leftover handoffs" follow-up in [TODOS](TODOS.md).

After rollout, collect a fresh 30-day report and publish per-skill pairing.
If any skill is below 95% with an eligible start denominator and nonzero local
transcript invocations, **schedule the deferred in-flight marker and crash-detection work** rather than
re-arguing that trigger. Doctor exposes schedule_marker_work in JSON and a
decision message in text. Deferred resumable runs are excluded. Missing
transcripts or zero eligible starts provide insufficient evidence for the trigger.
Diagnose skipped starts separately: markers cannot repair a command never run.

The capture in [Observed coverage](#observed-coverage) found no eligible v1 starts
in its window, so the post-rollout 30-day report has insufficient evidence on the
files that were read. This change ships no hook, gstack sweep patch, or
marker/crash detection subsystem.

## Cursor and quota

Cursor is an execution harness (`agent: cursor`), independently of the vendor of
the selected model. The Conductor SDK store shape described in the linked evidence uses
numeric timestamps and list-valued model parameters that the current reader
cannot parse, so model and effort remain null even when the store names a model.
See [review-independence evidence](designs/review-independence.md#8-provenance-feasibility).
The dated capture below did not cross-tabulate nulls by agent, so it does not
establish which captured rows encountered this limitation. Cursor transcript activity supports nested-harness
detection. Billed model and consumption belong to the separate
[quota ledger](quota-ledger.md). Telemetry start and finish never start a quota
sampler or write quota records. Only explicit quota commands read vendor usage.

## Evidence

Records state their capture date up front, or identify the documentation date
when no capture timestamp was retained. Contract sections above stay undated.

### Observed coverage

Captured 2026-09-25T12:28:18Z: stage-runs rows were read and their key sets checked
on one machine's files; skill-usage has no v1 `skill_start` in the window, so
pairing is unvalidated. This is a one-machine field smoke check. The files carry
no machine identifier. Tier read at capture: off. The effective tier during the
window is not established, because each process resolves config through
`GSTACK_STATE_ROOT`, then `GSTACK_HOME`, then `GSTACK_STATE_DIR`, then `HOME`.
Provenance config file was absent, which the writer treats as on.

| Question | Status | Evidence |
|---|---|---|
| Schema conformity | demonstrated | 14 stage-runs rows. 8 lack `route` and `entrypoint_raw`; 6 include both. Every row's other keys match the field table. Rows carry no schema version |
| Pairing among recorded starts | unmeasured | 0 v1 `skill_start` and 0 v1 `skill_run` with `source` `gstack-extend` in the window |
| Invocation capture completeness | unmeasured | Claude transcript counts disagree with Claude stage-runs counts for two skills; Codex, Grok, and Cursor have no transcript counter |
| Attribution correctness | unmeasured | No paired start exists in the window to check. The same-root collision is characterized in code, not observed as a field row here |
| Producer identity | unmeasured | All 14 stage-runs rows declare `source` `gstack-extend`. Label presence is demonstrated, but the label is self-declared: any caller writing it is indistinguishable from the wrapper |

Window: 2026-09-22T14:50:06Z through 2026-09-25T12:28:18Z, from the earliest
stage-runs `started_at` to capture time. Sources: skill-usage.jsonl (1975 rows,
1 malformed line, 84 with `source` `gstack-extend`), stage-runs.jsonl (14 rows,
0 malformed), leftover handoff files, lock files, and `transcripts(since, now)`
over that window. gstack-extend doctor telemetry --json reported tier off, zero
warnings, `logger_supports_no_sweep` true, and insufficient evidence for all nine
skills (0 skills with an eligible v1 denominator).
The nine-skill set is historical (gstack-extend 0.29.0.1): it includes the
since-retired review-apparatus and test-plan skills and predates ship-and-land.

| Skill | stage-runs (by harness) | Leftover handoffs | Claude transcripts | v1 skill_start | v1 skill_run |
|---|---|---:|---:|---:|---:|
| pair-review | 1 (codex 1) | 1 | 0 | 0 | 0 |
| roadmap | 3 (claude 1, codex 2) | 0 | 1 | 0 | 0 |
| full-review | 0 | 0 | 0 | 0 | 0 |
| review-apparatus | 0 | 0 | 0 | 0 | 0 |
| test-plan | 0 | 0 | 0 | 0 | 0 |
| gstack-extend-upgrade | 3 (claude 3) | 0 | 1 | 0 | 0 |
| gstack-extend-init | 0 | 0 | 0 | 0 | 0 |
| review-and-prep | 1 (grok 1) | 2 | 1 | 0 | 0 |
| implement | 6 (claude 1, codex 3, cursor 2) | 1 | 1 | 0 | 0 |
| unattributed | 0 | 2 |  | 0 | 0 |

All 14 stage-runs rows have `source` `gstack-extend` and `outcome` `success`.
Agents: claude 5, codex 6, grok 1, cursor 2. Routes: 8 rows have no `route` key,
4 `conductor`, 1 `cli`, 1 `unknown`. Model is non-null on 12 rows and null on 2;
effort is non-null on 12 and null on 2. The capture does not cross-tabulate those
nulls with agent.

Of 84 gstack-extend skill-usage rows, 44 are legacy under the doctor's modern-row
rule, 40 are v1 `skill_run`, and 0 are v1 `skill_start`. None of them fall inside
the window. The last gstack-extend row is a `skill_run` at 2026-09-21T03:25:14Z
with `gstack_version` 1.87.4.0. Another source, `live`, has a tier-gated
`skill_run` at 2026-09-22T15:06:51Z with `gstack_version` 1.87.5.0, inside the
window. A stage-runs window that overlaps landed tier-gated upstream rows and
contains no `skill_start` is unexplained. It is not attributed to the tier read
at capture.

Six leftover handoffs, all start-only (no `done` key and no saved `row`).
Lifecycle of a start-only handoff is unknown: the file stores no lifecycle state.
Three are resumable skills (pair-review 1, review-and-prep 2), one is
non-resumable (implement), and two matched no enumerated checkout and are
unattributed. No handoff held a saved stage-runs row. The capturing run identified
no handoff of its own. An orphan handoff omits the skill, so it is attributable
only by rehashing `sha256(json([root, skill]))` unless it holds a saved
stage-runs row. 22 lock files: 6 share a hash with a current handoff, 5 rehash to
a skill that has a stage-runs row, and 11 are slot-used with no handoff and no
attributed stage-runs row. Locks identify persistent repository/skill slots,
not invocations; stage-runs rows carry no root to link them conclusively. The
lock counts do not establish a run count or place those runs in this window.

Gaps from this capture: zero v1 skill-usage rows in the window; four skills have
no stage-runs row (full-review, review-apparatus, test-plan, gstack-extend-init);
six start-only handoffs whose lifecycle is unknown; two handoffs unattributed;
eleven slot locks with no current handoff or attributable row, not eleven
missing runs; rows were read from one machine's files and carry no
machine identifier; no Codex, Grok, or Cursor transcript denominator. Claude
transcripts versus Claude stage-runs in the window match for seven skills.
gstack-extend-upgrade is unexplained (1 transcript, 3 Claude rows).
review-and-prep is unexplained (1 transcript, 0 Claude rows). Candidate causes,
not a finding: the doctor's whole-day window differs from this exact window; the
counter counts only Skill tool_use blocks, so a typed slash command may not
count; a paused run has a handoff but no row; the counter reads only
`~/.claude/projects` and ignores `CLAUDE_CONFIG_DIR`; a run spanning an upgrade
may leave no row.

### How this record was captured

Documented method, not a re-runnable script. The script stays private. A
re-runnable capture is the doctor-coverage TODO. Re-capture after any change to
the writer, the doctor, or the upstream fields this contract names
(`_repo_slug`, `_branch`, `gstack_version`, the 86400-second nulling).

Sources: `$GSTACK_STATE_DIR/analytics/skill-usage.jsonl` (default `~/.gstack`),
`$GSTACK_EXTEND_STATE_DIR/analytics/stage-runs.jsonl`, `telemetry/*.json`, and
`telemetry-locks/*.lock` (default `~/.gstack-extend`). An absent file is zero
rows with the absence recorded. Malformed JSONL lines are counted. A failure to
load the transcript counter is recorded as unavailable, never 0. Classification:
a skill-usage row is modern only when `v` is the integer 1, `session_id` is a
non-empty string, and `event_type` is `skill_start` or `skill_run`; everything
else with `source` `gstack-extend` is legacy. Handoffs split into start-only,
finish-attempted (a `done` key), and append-failed (a `row` key). A saved `row`
is attributed by `row.stage`; otherwise the hash is matched against git toplevels
enumerated under the home directory's clone and workspace parents, count only.
Claude counts call `transcripts(since, now)` on the exact window. gstack-extend
VERSION at capture: 0.29.0.1, commit af56fceba44df88139be2d51a9ab865245b03cc0.
gstack VERSION file at capture: 1.89.1.0. Upstream field behavior above was read
in that version's `gstack-telemetry-log` and `gstack-telemetry-sync` source;
`_branch`, `_repo_slug`, and `gstack_version` were also present on captured
`skill_run` rows. Unresolved: the two per-skill transcript mismatches, and the
absence of `skill_start` rows beside in-window tier-gated upstream rows.

### Pre-rollout baseline

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
This is a pre-rollout baseline, not a zero-percent failure score. It includes
the since-retired review-apparatus and test-plan skills for historical accuracy.

### Review-apparatus diagnosis

In the 2026-09-20 planning sample, the review-apparatus claim of two invocations
but zero rows was a
**fleet-denominator versus local-numerator comparison error, not a skipped
block**. On the examined machine, zero local invocations and zero rows were
consistent. That diagnosis discharged the coverage hard stop. In that sample,
71% of recent transcript files were nested under
subagents.

### Full-history planning counts

Recorded in v0.27.2.0 on 2026-09-21; the original capture timestamp was not
retained. Corrected full-history planning counts, separate from the 2026-09-25
capture: roadmap 31 activation / 32 completion, full-review 3/3,
test-plan 1/1, pair-review 7/3, review-apparatus 0/0, plus one nameless
completion. Those totals alone do not establish pairing.
