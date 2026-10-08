# Skill telemetry

Skill authors: [Author quickstart](#author-quickstart).
Operators: [Diagnose and interpret](#diagnose-and-interpret).
Consumers validating stage-runs rows: [Schema validation](#schema-validation).
Consumers joining the files: [Join contract](#join-contract).
Anyone checking claims: [Evidence](#evidence).

All nine installed skills carry optional start and finish calls. They record local
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
  effort level that finish recorded, and where each value came from, in the
  published [schema](stage-runs.schema.json) any caller can validate and join.
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

The sink follows the selected **gstack-telemetry-log**. Loggers using the shared
`gstack-state-root.sh` resolver (observed in gstack 1.91.11.0) select
GSTACK_STATE_ROOT → GSTACK_HOME → GSTACK_STATE_DIR → CLAUDE_PLUGIN_DATA
(only when CLAUDE_PLUGIN_ROOT contains `gstack`, ignoring case) → $HOME/.gstack.
Start, finish's private-file preflight, and the doctor ask that exact colocated
resolver, then use analytics/skill-usage.jsonl. Relative overrides and embedded
CR/LF characters follow upstream unchanged. An unavailable or failing resolver
skips usage writes and makes the doctor report unavailable; local provenance
can still record, without inventing a completion for an unwritten start.
An existing start keeps its handoff so finish can retry; a late resolver failure
also preserves the provenance acknowledgement, preventing a duplicate on retry.

Older loggers keep their GSTACK_STATE_DIR → $HOME/.gstack sink behavior.
Their **gstack-config** lookup is GSTACK_STATE_ROOT → GSTACK_HOME →
GSTACK_STATE_DIR → $HOME/.gstack, so setting only GSTACK_HOME changes config
lookup for those releases. With the shared resolver, upstream config selects
the most restrictive telemetry tier across the selected root and $HOME/.gstack;
an `off` in either keeps usage off. Tier selection stays upstream's responsibility.
Tests isolate HOME and overrides, copy the optional resolver, and omit the
network sync helper so they never upload fixture rows or write to the user sink.

### gstack helper lookup

`gstack-telemetry-log` and `gstack-config` share one candidate list. The doctor
prints that list when a helper is missing. First match wins, and two candidates
that name the same directory are listed once:

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
and list the searched locations as JSON-quoted paths (PATH remains the display token).
The doctor warning then says either `provenance
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

**Collision limit:** for non-resumable skills, misattribution remains within one
harness session or when either fingerprint is unknown. A distinct known session's
earlier finish is refused and the handoff stays. Resumable skills can still
misattribute a finish across different known sessions because they adopt at any age.
Two starts of one skill in one checkout share a slot; the later start replaces it.
If the adoption rule accepts the handoff and the earlier-started run finishes first,
stage-runs holds one row with the later start's `session_id` and `started_at` and
the earlier finish's outcome. With the tier on, skill-usage pairs the later
`skill_start` with that finish's `skill_run` and leaves the earlier `skill_start`
unpaired. The later finish then finds no handoff and writes nothing. If the later
run finishes first, the row is correctly its own and the earlier run has no row.
The unknown-fingerprint form of that defect is still current behavior. When the
two non-resumable runs carry different known fingerprints, the earlier finish is
refused and the later finish pairs with its own start. Explicit `--session-id` and `--start`
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
raises: a missing, empty, or non-string `harness` counts as an unknown fingerprint, and a
non-integer `start` counts as invalid. `start` is checked first. Bools, negatives, floats, and
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
skills. Observed on 2026-09-29 with Claude Code 2.1.284: `CLAUDE_CODE_SESSION_ID`
stayed constant across real CLI user turns and a `claude --resume`. Two start/finish
runs paired, including a finish after resume; debug named only that marker. The
check used isolated telemetry storage and real logger/config copies with network
sync omitted. Compaction and a Conductor chat continuation were not exercised.
Within-run marker stability in Codex, Cursor, and Grok has not been verified by
this real-harness check; their automated tests use simulated markers.
The marker stays in the fingerprint.

**Upgrading existing handoffs.** Handoffs written before this change have no
`skill`, `root`, or `harness`. A start-less finish of a non-resumable skill now
adopts one only within 24 hours. Resumable skills are unaffected. To finish an
older non-resumable run, pass the original wrapper-issued session id and start
epoch from that run's `GE_TELEMETRY: session=… start=…` line. Those values are
not harness markers such as `CODEX_THREAD_ID`. Do not run a new start for the run
being recovered: a new start replaces the slot.

If you previously disabled provenance with a relative `GSTACK_EXTEND_STATE_DIR`,
that old config is no longer read by telemetry. After upgrading, rerun
`"$HOME/.claude/skills/gstack-extend/bin/config" set provenance false` with the same
environment, or use an absolute state-directory override for both commands.

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
machine. It is created mode 0600. A symlink, FIFO, or extra hard link at that path is not written. The provenance config and the finish handoff are read the same way, so none of those stand-ins can stall a skill.

The machine-readable contract is [stage-runs.schema.json](stage-runs.schema.json),
a self-contained JSON Schema (draft-07) for gstack-extend's own hand-run rows
(`source` `gstack-extend`, `rung` 0); [Schema validation](#schema-validation)
shows how to check a ledger against it. External callers can join these rows by
session_id and write their own source labels under their own contracts. The
table below is the reader's reference; the schema is authoritative where they differ.

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
| `source` | `gstack-extend`: the writer label, which any caller can choose |
| `route` | `cli`, `conductor`, `sdk`, or `unknown`, from the selected harness markers |
| `entrypoint_raw` | The selected harness entrypoint marker, when present |
| `schema_version` | `1`: the row format, not a release |
| `producer_version` | Release in the VERSION file of the gstack-extend installation that constructed the row; null when unknown |
| `agent_source` | `flag`, `detected`, or `unknown`: where `agent` came from |
| `model_source` | `flag`, `detected`, or `unknown`: where `model` came from |
| `effort_source` | `flag`, `detected`, or `unknown`: where `effort` came from |

**Versions.** Every row this writer constructs has all 20 fields in table order,
with `schema_version` 1. `schema_version` names the row format. It is unrelated to
skill-usage's `v` and to the `telemetry-protocol` marker. A change to the row's
shape or meaning adds a new schema version as a new schema branch and keeps the
existing branches; a release that leaves the row alone keeps 1.

`producer_version` comes from the VERSION file of the installation the wrapper
resolves to (its real checkout, through any symlinks), never from the repository
the skill ran in, gstack's VERSION, or an environment variable. A missing, unsafe
(symlink, FIFO, hard link, non-regular), oversized, non-UTF-8, or malformed VERSION,
anything but four dot-separated ASCII numbers after trimming surrounding whitespace,
makes `producer_version` null. Null means unknown. The row still records, and
debug mode prints `producer_version unknown` with the reason class (never the file's
contents), the fix, and a pointer here. Restore or upgrade the installation to fix it.

Rows without `schema_version` are legacy rows from older writers. They carry the
13 fields from `stage` through `source`, plus `route` and `entrypoint_raw` when
their writer had them, and none of the v1 metadata. An absent key in a legacy row
is unknown: key presence does not identify an older release, and readers never
fill in a version, producer, or source. A row with `schema_version` 1 that lacks
any of the 20 fields is malformed, not legacy. Deleting only `schema_version` from
a v1 row does not make it legacy: the remaining metadata keeps it invalid.

**Retries keep their first construction.** When a finish cannot append, its handoff
saves the row, and the retry appends that saved row unchanged, even under a newer
release. Its `schema_version`, `producer_version`, and sources describe the attempt
that constructed it, not the release that later appended it. A row saved by a
writer older than `schema_version` is appended as that legacy row, with nothing
added. Repairing a broken VERSION improves only rows constructed afterwards; a saved
row keeps its null `producer_version`.

**Rolling back the writer.** Reverting to an older writer stops new v1 rows. Keep
the published schema and these rules: they still read both the legacy rows the old
writer appends and the v1 rows already in the ledger. Never delete, rewrite,
backfill, or re-stamp ledger rows to match a writer.

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
- **Cursor** exports `CURSOR_AGENT` or `CURSOR_CONVERSATION_ID`. Conductor store
  metadata and the native route use one captured observation, described in
  [Cursor and quota](#cursor-and-quota). An explicit `CURSOR_INVOKED_AS` stays
  CLI and does not read that store. Transcript mtime still breaks ties when the
  store does not supply a usable model or effort.

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

`agent_source`, `model_source`, and `effort_source` label the value the row
actually holds. `flag` means an accepted flag supplied it, even one equal to the
detected value. `detected` means the harness's markers or session log did.
`unknown` means the value is null, and a null value is always `unknown`. A
rejected flag changes nothing, so the detected value keeps `detected`: an
`--agent` outside the four harnesses, or a blank, non-printable, or over-200-character
`--model` or `--effort`. A valid `--agent` naming another harness drops the detected
model and effort first, so an omitted `--model` or `--effort` is then null and
`unknown`. `source` is the writer label; the three `*_source` fields are evidence
origins. A `flag` label records who supplied the value, not that it is correct.

**Switch.** Provenance is on by default and independent of gstack's tier, because
its rows stay local while enabling the tier also enables the upload. Turn it off
with `"$HOME/.claude/skills/gstack-extend/bin/config" set provenance false` (`off`
also works). For `provenance`, the config command follows telemetry: both ignore a
relative `GSTACK_EXTEND_STATE_DIR` and use `$HOME/.gstack-extend`. Other config keys
retain their existing state-directory behavior. Use an absolute override when quota
should read these provenance rows: quota still resolves a relative state root against
its working directory, so it would look for stage-runs in a different directory.
A missing config stays on. An unreadable config stays off: a file
that cannot be read is not evidence the switch is still on. With provenance on, start writes the handoff even when the tier is
off, and a missing or broken gstack costs only the skill-usage rows.

## Schema validation

[stage-runs.schema.json](stage-runs.schema.json) covers rows whose `source` is
`gstack-extend` (hand-run, `rung` 0). Check each JSONL line in this order:

1. Parse the line as one JSON object. Blank lines are skipped. Malformed JSON,
   `null`, an array, or a scalar is invalid.
2. Read `source`. A missing, blank, or non-string `source` is invalid. Any other
   label belongs to another producer: route that row to its own contract rather
   than reporting a malformed gstack-extend row.
3. Read `schema_version`. Absent means legacy and the integer 1 means v1. An
   integer 2 or greater is unsupported: report it, keep the row, and use a schema
   release that supports it. Anything else (null, a string, a fraction, zero, or a
   negative number) is invalid. Never guess a version.
4. Validate the row against the schema, which picks the legacy or v1 branch by
   whether `schema_version` is present. Never coerce values, fill defaults, or drop
   unknown keys to make a row pass.

Keep every row, duplicates included, and never rewrite the ledger to make it
validate. Pin a release tag or commit of the schema, or vendor a copy: the file
on main gains branches over time. A new schema version adds a branch and keeps
the existing ones, and a reader pinned to an older copy reports rows with a newer
version as unsupported (step 3) instead of misreading them.

Validity is shape, not truth. A valid row, including one whose sources say
`flag`, does not prove that capture was complete, that attribution is right, or
that a reviewer was independent (see the Join contract's
[What provenance can and cannot prove](#join-contract)).

### Validate with the checkout

The command needs Bun 1.2 or newer and the checkout's pinned development
dependencies. From the gstack-extend checkout root, install them once:

~~~sh
bun install --frozen-lockfile
~~~

The install uses the committed `bun.lock` and fails rather than change it. Ajv 8
is a development dependency only; the skills and telemetry need no package. The
command below runs with `--no-install`, so it never downloads anything. If Bun
reports `Cannot find package 'ajv'`, run the install above. Run the command from
the checkout root. With no input it validates its included 20-field v1 row:

~~~sh
bun --no-install -e '
import Ajv from "ajv";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";

const DOC = "See docs/telemetry.md#schema-validation";
const FIELDS = ["stage", "agent", "model", "effort", "rung", "outcome", "started_at", "duration_s", "session_id",
  "repo", "branch", "work_item", "source", "route", "entrypoint_raw", "schema_version", "producer_version",
  "agent_source", "model_source", "effort_source"];
const EXAMPLE = {"stage":"roadmap","agent":"claude","model":"claude-opus-5","effort":"xhigh","rung":0,"outcome":"success","started_at":"2026-09-20T12:00:00Z","duration_s":3,"session_id":"extend-example","repo":"acme/widget","branch":"main","work_item":null,"source":"gstack-extend","route":"cli","entrypoint_raw":"cli","schema_version":1,"producer_version":"1.2.3.4","agent_source":"detected","model_source":"detected","effort_source":"detected"};
const EVIDENCE = "a null value needs source unknown; any other value needs flag or detected";
const WHY = {
  required: ["a required field is missing", "write every field the contract requires, never a default"],
  additionalProperties: ["a field outside this contract", "remove it, or route the row to its own contract"],
  type: ["a value has the wrong JSON type", "write the documented type"],
  const: ["a value differs from the fixed contract value", "write the documented value"],
  enum: ["a value is outside the documented set", "write a documented value"],
  pattern: ["a string does not match the documented format", "write the documented format"],
  minimum: ["a number is below the documented minimum", "write a nonnegative value"],
  "false schema": ["v1 metadata without schema_version", "keep the row whole; never strip or add fields"],
};
const counts = { rows: 0, blank: 0, v1: 0, legacy: 0, invalid: 0, unsupported: 0, routed: 0 };
let shown = 0;
let hidden = 0;
function report(line, where, keyword, cause, fix) {
  if (shown === 20) return hidden++;
  shown++;
  console.log(`line ${line}: ${where} ${keyword}: ${cause}. Fix: ${fix}. ${DOC}`);
}

let validate;
try {
  validate = new Ajv({ strict: true, allErrors: true }).compile(JSON.parse(readFileSync("docs/stage-runs.schema.json", "utf8")));
} catch {
  console.error(`schema unavailable: run from the gstack-extend checkout root. ${DOC}`);
  process.exit(1);
}
async function* utf8(file) {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  for await (const chunk of createReadStream(file)) yield decoder.decode(chunk, { stream: true });
  yield decoder.decode();
}
const file = process.env.STAGE_RUNS_FILE;
let lines = [JSON.stringify(EXAMPLE)];
if (file) {
  try {
    if (!statSync(file).isFile()) throw new Error();
    lines = createInterface({ input: Readable.from(utf8(file)), crlfDelay: Infinity });
  } catch {
    console.error(`input unreadable: pass a readable JSONL file. ${DOC}`);
    process.exit(1);
  }
}

let line = 0;
try {
  for await (const text of lines) {
    line++;
    if (text.trim() === "") { counts.blank++; continue; }
    counts.rows++;
    let row;
    try { row = JSON.parse(text); } catch { row = undefined; }
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      counts.invalid++;
      report(line, "(root)", "json", "the line is not one JSON object", "write one JSON object per line");
      continue;
    }
    if (typeof row.source !== "string" || row.source.trim() === "") {
      counts.invalid++;
      report(line, "/source", "source", "the writer label is missing, blank or not a string", "every row names its writer");
      continue;
    }
    if (row.source !== "gstack-extend") { counts.routed++; continue; }
    let kind = "legacy";
    if (Object.hasOwn(row, "schema_version")) {
      const version = row.schema_version;
      if (Number.isInteger(version) && version >= 2) {
        counts.unsupported++;
        report(line, "/schema_version", "unsupported", "newer than this contract", "keep the row and use a schema release that supports it");
        continue;
      }
      if (version !== 1) {
        counts.invalid++;
        report(line, "/schema_version", "version", "not a positive integer", "correct the producer; never guess a version");
        continue;
      }
      kind = "v1";
    }
    if (validate(row)) { counts[kind]++; continue; }
    counts.invalid++;
    const seen = new Set();
    for (const error of validate.errors) {
      if (error.keyword === "if") continue;
      const field = error.keyword === "required" ? error.params.missingProperty : error.instancePath.slice(1);
      const where = FIELDS.includes(field) ? "/" + field : "(root)";
      if (seen.has(where + error.keyword)) continue;
      seen.add(where + error.keyword);
      const [cause, fix] = WHY[error.keyword] ?? ["the row fails the contract", "compare it with the schema"];
      const evidence = where.endsWith("_source") && (error.keyword === "const" || error.keyword === "enum");
      report(line, where, error.keyword, evidence ? EVIDENCE : cause, evidence ? "correct the producer, never the saved row" : fix);
    }
  }
} catch {
  console.error(`input unreadable or invalid UTF-8 after line ${line}. ${DOC}`);
  process.exit(1);
}
if (hidden) console.log(`${hidden} more diagnoses not shown`);
console.log(`summary: rows=${counts.rows} valid=${counts.v1 + counts.legacy} v1=${counts.v1} legacy=${counts.legacy} invalid=${counts.invalid} unsupported=${counts.unsupported} routed=${counts.routed} blank=${counts.blank}`);
process.exitCode = counts.invalid || counts.unsupported ? 1 : 0;
'
~~~

The command reads UTF-8 strictly. An unreadable file or invalid UTF-8 stops
validation with exit status 1 and a fixed diagnosis, without repairing bytes or
including private input in the diagnosis.

Expected output, with exit status 0:

~~~text
summary: rows=1 valid=1 v1=1 legacy=0 invalid=0 unsupported=0 routed=0 blank=0
~~~

To check a ledger instead, set `STAGE_RUNS_FILE` and run the same command;
`unset STAGE_RUNS_FILE` returns to the included row:

~~~sh
case "${GSTACK_EXTEND_STATE_DIR:-}" in
  /*) export STAGE_RUNS_FILE="$GSTACK_EXTEND_STATE_DIR/analytics/stage-runs.jsonl" ;;
  *) export STAGE_RUNS_FILE="$HOME/.gstack-extend/analytics/stage-runs.jsonl" ;;
esac
~~~

As the writer does, this uses an absolute state-directory override and ignores
a relative one. The command reads the file one line at a time and never writes it.
Line endings follow `readline`: LF, CRLF or CR. It compiles
the schema once, with Ajv's strict mode and all errors, and no coercion, defaults,
or network references. It prints at most 20 diagnoses, then a count of the rest,
and always the complete per-row counts; a row with several problems counts once.
Each diagnosis names the line, the field (from the fixed list of contract fields,
or `(root)` for unknown keys and whole-line problems), the failed check, the
cause, the fix, and this section. It never prints row values, unknown key names,
parser messages, raw validator details, or the input path. It exits 1 when any row
is invalid or unsupported, or when the input or schema cannot be read. Rows routed
to other producers and blank lines do not fail it. For example, a v1 row whose
`model` is null but whose `model_source` is `flag`, followed by a row with
`schema_version` 2, prints:

~~~text
line 1: /model_source const: a null value needs source unknown; any other value needs flag or detected. Fix: correct the producer, never the saved row. See docs/telemetry.md#schema-validation
line 2: /schema_version unsupported: newer than this contract. Fix: keep the row and use a schema release that supports it. See docs/telemetry.md#schema-validation
summary: rows=2 valid=0 v1=0 legacy=0 invalid=1 unsupported=1 routed=0 blank=0
~~~

### Contributor setup

Development and tests need Bun 1.3.3 or newer (`engines.bun` in `package.json`;
the text `bun.lock` alone needs 1.2). The suites run launchers that start Bun with
`--no-env-file --no-install --config=/dev/null`, whose three flags first coexist in
1.3.3. Telemetry itself needs no Bun: the wrapper is Python and the skill blocks
only call it. Run `bun install
--frozen-lockfile` once per checkout before `bun run test`, `bun run test:full`,
or the telemetry suites. The telemetry suites compile the actual schema and run
the exact command above. Tests never install packages: without the install they
stop at `Cannot find package 'ajv'`. `bun.lock` is a global touchfile, so a
lockfile change runs the full suite.

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
6. Dispatch stage-runs rows by `source`, then `schema_version`, as in [Schema validation](#schema-validation). Treat an absent key in a legacy row as unknown; a v1 row missing a key is malformed.

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
| Retry spans an upgrade | The retry appends the saved row unchanged: `producer_version` and the sources name the attempt that constructed it, and a row saved by a pre-version writer stays a legacy row | Do not read `producer_version` as the release that appended the row | `a retried row keeps its construction metadata across an upgrade; a saved legacy row stays legacy` in tests/telemetry.test.ts |
| Start without `skill_start` | Tier off, gstack unavailable at start, a transient gstack-config failure, or a failed append: the handoff records `usage: false` when provenance is on, so finish sends no `skill_run` even if the tier is on by then. With provenance off, a start that wrote no `skill_start` saves no handoff | Expected when the tier is off, not a failure | `a failed skill-usage start does not invent a completion; provenance off writes no handoff` in tests/telemetry.test.ts |
| Tier turned off before finish | Consumes the handoff and leaves that `skill_start` unpaired permanently. With provenance off, turning the tier off before finish leaves the handoff (`usage: true`) for a later start-less finish to adopt under the rule | Do not treat the unpaired start as a crash | `tier turned off before finish consumes the handoff and leaves that skill_start unpaired` in tests/telemetry.test.ts |
| Same-root collision | Non-resumable misattribution remains within one harness session or with an unknown fingerprint; a distinct known session's earlier finish is refused. Resumable skills can also misattribute across different known sessions. When adoption is allowed and the earlier-started run finishes first, its outcome lands on the later start's identity; when the later run finishes first, the row is correct and the earlier run has no row | A join is not proof of attribution; resumable adoption deliberately crosses sessions | `same-root collision misattributes the earlier finish (current behavior)` in tests/telemetry-contract.test.ts; `a fingerprinted same-root collision refuses the earlier session and pairs the later one` and `a resumable skill adopts another session 30 days later` in tests/telemetry.test.ts |
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
rows. Skill-usage rows carry no gstack-extend version. A v1 stage-runs row carries
`producer_version`, the release that constructed it; a legacy row carries none.

**What provenance can and cannot prove.** One stage-runs row per extend-skill
finish whose append succeeded. Unless a valid `--agent` overrides detection,
the agent is the harness detected for the finish command: the nearest marked
ancestor when several harness markers are present, otherwise the latest
comparable harness log when ancestry is unavailable. Model and effort are the pair behind the most turns in the
window. Subagent (sidechain) turns are skipped. Nested reviewer voices
(outside-voice CLIs, subagents, external review services) write no row. In a v1
row an accepted `--agent`, `--model`, or `--effort` override says `flag`. Legacy
rows do not mark overrides, so any legacy value may have come from a flag. Neither
a `flag` or `detected` label nor schema validity proves that a value is correct,
that capture was complete, or that attribution is right. These rows alone
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
{"stage":"roadmap","agent":"claude","model":"claude-opus-5","effort":"xhigh","rung":0,"outcome":"success","started_at":"2026-09-20T12:00:00Z","duration_s":3,"session_id":"extend-example","repo":"acme/widget","branch":"main","work_item":null,"source":"gstack-extend","route":"cli","entrypoint_raw":"cli","schema_version":1,"producer_version":"1.2.3.4","agent_source":"detected","model_source":"detected","effort_source":"detected"}
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
Conductor Cursor model and route diagnosis is in [Cursor and quota](#cursor-and-quota).
Doctor pairing is not model coverage. For that harness, prefix the first normal
finish in the same tool shell; a terminal export does not reach the GUI.

| Reason | Meaning | Fix |
|---|---|---|
| `no handoff for this repository root` | This finish's root+skill slot is empty. Start never ran here, the handoff was already consumed, this is the second finish of a same-root collision, or start ran in another root | Finish from the repository root where start ran, or pass `--session-id` and `--start` from the `GE_TELEMETRY` line |
| `handoff from another session` | A non-resumable skill found a handoff whose fingerprint is a different known session | Finish in the harness session that ran start, or pass those two values |
| `handoff too old` | A non-resumable skill found an unknown fingerprint older than 86400 seconds. The line includes the age and the bound | Run start again for a new run, or pass those two values |
| `gstack helper unresolvable:` | `gstack-telemetry-log` or `gstack-config` was not found. The line names the missing helper(s) and the searched locations. Provenance may still record | Install gstack for this host (`./setup --host <host>` in the gstack checkout) or set `GSTACK_DIR`, then rerun `gstack-extend doctor telemetry` |
| `gstack state resolver unavailable` | The selected modern logger's colocated resolver is missing or fails. Skill-usage stays unwritten; provenance may still record | Reinstall gstack, then rerun `gstack-extend doctor telemetry` |
| `producer_version unknown` | The installation's VERSION is missing, unsafe, oversized, not UTF-8, or not a four-part release. The row still records, with a null `producer_version` | Restore or upgrade the gstack-extend installation. Rows already saved for a retry keep their null |

Doctor is read-only and always exits zero for missing/empty sinks, malformed
JSON, partial tails, and bad arguments. Debug mode prints the resolved binaries,
tier and sink, the provenance switch and sink, and the detected agent, model, and
effort. It explains missing gstack/config, disabled tiers, rejected input,
unwritable sinks/state, an unknown producer release, or upstream failure with
corrective commands. Doctor reports skill-usage.jsonl only.
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
for periods without eligible observations is the deferred "Bounded handoff
cleanup and a tier-independent marker trigger" item in
[roadmap-future.md](roadmap-future.md).

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
the selected model. A model and effort taken from the Conductor SDK store are
requested configuration for one stage window. They support operator diagnosis
and an external handoff. They are not served or billed proof, and they do not
authorize quota routing or independence certification. Billed model and
consumption stay in the [quota ledger](quota-ledger.md). Telemetry start and
finish never start a quota sampler or write quota records. Only explicit quota
commands read vendor usage. The quota runs CLI is not this ledger: it fills
stage, agent, model, effort, and route from provenance and does not print
source labels. A quota row can name a model while the stage-runs source is
`unknown`. That is not a substitute for this row and not permission to sample.

The repair does not change supported Paseo behavior or Cursor CLI behavior.
`CURSOR_INVOKED_AS` is CLI. Finish does not copy model or effort from a matching
store on that path; an explicit `--model` or `--effort` stays `flag`. A row
whose only Cursor signal is `--agent cursor` has `agent_source` `flag` and
cannot become `route` `conductor` from a store that happens to be nearby.
Inherited `CLAUDECODE` or `CODEX_THREAD_ID` keep the existing order: a unique
valid native match is `conductor`, otherwise those nested markers are `cli`,
otherwise `unknown`. `detect()` has to have selected Cursor before any
`--agent` override. Changing another harness, or an unverifiable agent, to
`cursor` does not certify a native route. An inherited `CONDUCTOR_SESSION_ID`
never certifies Cursor by itself.

<a id="cursor-sdk-shape"></a>

### Supported store shape

The store is `~/Library/Application Support/com.conductor.app/cursor-sdk-store/<shard>/`.
Each shard has `agents.ndjson` and `runs.ndjson`. The reader takes one bounded
pass over those two regular files, then samples the stage end. A file larger
than 8 MiB is not parsed; it marks the capture incomplete.
Metadata and the native route share that captured selection. A later write is
invisible to both. There is no clock tolerance: `updatedAt` later than the
captured end is rejected.

Numeric `startedAt`, `endedAt`, and `updatedAt` are epoch milliseconds. The
Conductor call site opts in (`numeric_unit="milliseconds"`). The same parser
still accepts ISO-8601 strings, including a timezone and 3 to 9 fractional
digits, so an older dict-shaped record remains readable. Calls with no unit,
including Claude, Codex, and Grok logs, stay ISO-only and reject numbers.
Booleans, numeric strings, non-finite values, and values outside the UTC
datetime range are unknown. Zero and negative finite values inside that range
are real bounds. Missing is unknown, never a zero sentinel. An unsupported unit
argument raises `ValueError` at the call site.

`model` is read only when it is a dict. `model.id` is a printable string of at
most 200 characters, independent of `params`. `params` may be a dict with
`effort` and `reasoning_effort`, or a list of `{id, value}` entries. A valid
`effort` wins over a valid `reasoning_effort`. An invalid `effort` falls back.
Identical list duplicates keep that value. Conflicting values for one
recognized key make that key unknown and do not fall back. Entries such as
`fast`, malformed entries, and unsupported containers are ignored. Empty or
missing params do not erase a usable model id. A non-dict `model` yields
unknown fields and does not raise.

Identity is exact. `agents.ndjson` `cwd` must equal the process cwd, and when
`CURSOR_CONVERSATION_ID` is set it must equal `agentId`. Identity is per shard:
a run counts only when its own shard's `agents.ndjson` places that agent in the
process cwd. An unknown process cwd, such as a deleted directory, matches no
agent and the row still records. Within one shard, a
cleaned `agentId` plus a cleaned `runId` is one run; snapshots of that run are
not extra runs. A record with no usable `runId` stays its own candidate.
Duplicate equivalent snapshots collapse. The newest `updatedAt` snapshot is
kept whole, with no field merging, and only when `startedAt` is consistent.
Equal-timestamp conflicts and an inconsistent start make that run unverifiable.
An unverifiable run that could overlap the stage blocks certification even
beside one eligible run; one wholly outside the window does not.
The newest invalid or future snapshot is not replaced by an older one. Distinct
run ids stay ambiguous even when the model and effort agree. A malformed
neighbor does not erase a well-formed record. Unhashable ids are skipped.

The stage window is inclusive `[begin, end]`. The run window is inclusive
`[startedAt, endedAt]`. Only an absent or null `endedAt` is an open run, treated
as open through the stage end. `startedAt` and `updatedAt` are required, with
`startedAt <= updatedAt <= end`. A non-null `endedAt` that does not parse, an
inverted interval, `updatedAt` before `startedAt`, or `updatedAt` after the
captured end rejects that run. A run that ended before the stage does not
supply metadata. An open run that began earlier can. One eligible run can
certify `route` `conductor` and supply whatever model and effort survived
cleaning. Zero eligible runs, or more than one, leave model and effort null and
do not certify the route. A still-open stale run can overlap a later stage and
make the result honestly ambiguous. There is no freshness TTL.

A file over 8 MiB, an unreadable or non-regular sibling, a missing
`agents.ndjson` next to runs, or a missing `runs.ndjson` next to agents cannot
prove uniqueness, including when the session id is absent and a readable
sibling looks unique. This applies to every shard in the store, not only the
one for this cwd. The row still records.
Transcript mtime remains the activity fallback when no store was captured, the
candidate set is empty, ambiguous, or incomplete, the explicit CLI path is in
use, or both model and effort are null. A usable model with unknown effort, or
a usable effort with an unknown model id, stays a store result. Fallback does
not erase the field that survived, and a failed store match does not invent a
timestamp to beat another harness. A usable store result carries its chosen
snapshot's `updatedAt`, never the observation end, so a nested harness with
later activity still wins when process ancestry is unavailable.

<a id="cursor-sdk-historical-route"></a>

### Historical route caveat

Inspected producer `0.36.0.1` contains the pre-repair defect: numeric or
malformed SDK bounds could yield an overbroad `conductor` route. That route
alone is not proof of a correct run window. The statement in
[review-independence evidence](designs/review-independence.md#8-provenance-feasibility)
that integer dates and list params fail `cursor_turns()` is a dated pre-repair
observation, not a current claim that those shapes stay unreadable. Its
offline reproduction calls `cursor_turns()` without a captured selection and
`parse_ts()` without a unit, so it still prints no turn and no integer
timestamp after the repair. That output is expected; use the debug reasons
from the next planned run instead. Do not
rewrite old rows, the dated capture below, or Track 22A receipts. Schema
version and source labels are satisfied independently of native-route
correctness. A row with no `producer_version` keeps unknown producer status.
This change does not lexically compare four-part versions. The release that
ships the repair is the bound for the fixed implementation; earlier or unknown
producer rows stay uncertified without their own implementation evidence.
Invalid or ambiguous store evidence may now yield `route` `unknown`. If a
consumer relied on the old overbroad label, the release that ships this repair
has to apply the spec's compatibility policy. No release is authorized by the
reader change itself.

Reconsider this private reader if a supported host publishes an official
run-metadata contract, a qualified native shape changes, or the quota reader's
millisecond heuristic (magnitude above `100000000000`, plus numeric strings)
diverges from this explicit-unit contract. That is a revisit trigger, not a
second reader and not a quota change.

<a id="cursor-sdk-sources"></a>

### Sources, nulls, and native acceptance

`detected` means this reader or the transcript supplied the value. `flag` means
an accepted finish flag supplied it. `unknown` means the value is null. A null
is always `unknown`. None of those labels, and no schema-valid row, proves the
served model or that the window was right. Installed Conductor acceptance is
pending. Fixture output is not that acceptance. The next already-planned
Conductor Cursor run is the check: installed revision, host, harness, and
upstream versions, the known conversation and stage bounds, the expected model
and effort, sanitized booleans for process-cwd versus store-cwd equality and
for live conversation id versus store `agentId`, the observed snapshot shape,
and the fixed debug reasons. Unknown or absent identity stays unknown. No extra
launch is part of this repair. Logical and physical paths can disagree; compare
`pwd -P` with the store cwd privately and do not paste either path into a
receipt.

<a id="cursor-sdk-diagnosis"></a>

### Diagnosis

Doctor reports skill-usage pairing, not model coverage. Classify a known row in
three steps: locate it, read the whitelisted fields and source labels, then
follow the reason below. The 2-5 minute target is an unmeasured human
classification from an already-installed known row. It is not fresh-install
time, not an agent run, and it cannot recover why a null was written. Default
telemetry stays quiet. On the next already-planned run, prefix the first normal
finish in that tool shell with `GSTACK_EXTEND_TELEMETRY_DEBUG=1` and the
caller's existing arguments. Do not export it only in a terminal the GUI will
not inherit, and do not add a second start or finish. Whether the host UI keeps
that stderr is unverified. The `cursor-sdk` reason lines are fixed tokens plus
the anchor. They omit store fields, cwd, identity, exception text, and values.
The same debug output also carries the existing sink line, which prints the
ledger path, and the existing `provenance agent=… model=… effort=…` line,
which prints the values the row records. Leave both out of a receipt.

| Reason | Problem | Cause | Safe action |
|---|---|---|---|
| <a id="cursor-sdk-store-absent"></a>`store-absent` | No store metadata | The SDK directory is not there | Confirm Conductor wrote a store for this host. Do not invent a model |
| <a id="cursor-sdk-store-unreadable"></a>`store-unreadable` | No store metadata | The store directory cannot be listed | Restore the directory's permissions privately. The reason line is the whole diagnostic |
| <a id="cursor-sdk-incomplete-evidence"></a>`incomplete-evidence` | No certified route | A file over 8 MiB, or a missing, non-regular, or unreadable sibling in any shard, could hide a run | Do not treat a readable shard as unique. The row stays unknown |
| <a id="cursor-sdk-no-cwd-agent"></a>`no-cwd-agent` | No store metadata | No agent cwd equals the process cwd | Compare `pwd -P` with the store privately. Exact match is required. Do not paste paths |
| <a id="cursor-sdk-no-session-match"></a>`no-session-match` | No store metadata | The conversation id matches no agent or run | Record identity as unknown or absent. Do not copy the id into a receipt |
| <a id="cursor-sdk-malformed-bounds"></a>`malformed-bounds` | No certified route | A required bound is missing or unreadable, the interval is inverted, or `updatedAt` is in the future | Keep the null. Do not widen the window or fall back to an older snapshot |
| <a id="cursor-sdk-no-eligible-window"></a>`no-eligible-window` | No store metadata | Runs were readable and none overlap the stage | Confirm the stage begin and end. A completed earlier run is not this stage |
| <a id="cursor-sdk-ambiguous-candidates"></a>`ambiguous-candidates` | No certified route | More than one run overlaps, or a run whose snapshots conflict could overlap | Leave model, effort, and route unknown. A stale open run can do this |
| <a id="cursor-sdk-malformed-metadata"></a>`malformed-metadata` | A field is null | The model or a recognized effort value failed cleaning, or effort values conflicted | Keep a usable sibling field. Do not guess the dropped one |
| <a id="cursor-sdk-transcript-unreadable"></a>`transcript-unreadable` | No transcript activity | The store gave no usable result and the Cursor transcript could not be listed or read | Restore read access to the Cursor transcript directory privately. The row keeps the agent; model and effort stay null |

<a id="cursor-ledger-recipe"></a>

### Read a known row

The projections below are synthetic. They are not native evidence.

| Projection | What the whitelisted fields show |
|---|---|
| detected | `model_source` and `effort_source` are `detected`, and a unique in-window store match can set `route` to `conductor` |
| flag | `model_source` or `effort_source` is `flag` because finish passed `--model` or `--effort`. CLI stays `route` `cli` |
| unknown | `model` and `effort` are null and those sources are `unknown`. The route is not certified |

Several stage-runs lines for one session are a ledger choice: narrow with
`stage` and `started_at`. Do not keep the last line because it is last.
Several SDK runs are a different event: model and effort stay null and the
route is not certified. The recipe never reads the SDK store, never prints an
unlisted key, and never writes.

```python
# gstack-extend-cursor-ledger-recipe
import json
import os
import sys
from pathlib import Path

FIELDS = (
    "stage", "session_id", "started_at", "agent", "route", "model", "effort",
    "schema_version", "producer_version", "agent_source", "model_source",
    "effort_source", "outcome", "entrypoint_raw",
)

def state_root():
    override = os.environ.get("GSTACK_EXTEND_STATE_DIR")
    if override and os.path.isabs(override):
        return Path(override)
    return Path.home() / ".gstack-extend"

def project(row):
    projected = {}
    for field in FIELDS:
        value = row.get(field) if isinstance(row, dict) else None
        if isinstance(value, (str, int, float, bool)) or value is None:
            projected[field] = value
        else:
            projected[field] = None
    return projected

def main():
    session = sys.argv[1] if len(sys.argv) > 1 else ""
    stage = sys.argv[2] if len(sys.argv) > 2 else None
    started = sys.argv[3] if len(sys.argv) > 3 else None
    ledger = state_root() / "analytics" / "stage-runs.jsonl"
    try:
        if not ledger.is_file():
            print("missing-file")
            return
        stream = ledger.open("r", encoding="utf-8")
    except OSError:
        print("missing-file")
        return
    matches = []
    malformed = 0
    with stream:
        for line in stream:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except ValueError:
                malformed += 1
                continue
            if not isinstance(row, dict) or row.get("session_id") != session:
                continue
            if stage is not None and row.get("stage") != stage:
                continue
            if started is not None and row.get("started_at") != started:
                continue
            matches.append(project(row))
    if malformed:
        print("malformed-lines: " + str(malformed))
    if not matches:
        print("no-match")
        return
    if len(matches) > 1:
        print("multiple-match")
    for match in matches:
        print(json.dumps(match, ensure_ascii=True, separators=(",", ":")))

main()
```

Run it with the session you already know, under `python3 -I` so a module in
the current directory is never imported. Optional later arguments are the
exact `stage` and exact `started_at`. A relative `GSTACK_EXTEND_STATE_DIR` is
ignored. An absolute one is the state root. The default is `~/.gstack-extend`.

```sh
python3 -I - 'known-session' 'implement' '2026-10-08T18:00:00Z' <<'PY'
# gstack-extend-cursor-ledger-recipe
# paste the fenced program above, including its main() call
PY
```

`missing-file` means the ledger path is not a regular file. `no-match` means
the session, and any stage or start you passed, hit nothing. `multiple-match`
means more than one ledger line still qualifies; read those projections and
narrow the selectors. `malformed-lines: N` counts skipped lines and does not
print them. None of these results is a native Conductor receipt.

## Evidence

Records state their capture date up front, or identify the documentation date
when no capture timestamp was retained. Contract sections above stay undated.

### Observed coverage

Captured 2026-09-25T12:28:18Z: stage-runs rows were read and their key sets checked
on one machine's files; skill-usage has no v1 `skill_start` in the window, so
pairing is unvalidated. This is a one-machine field smoke check. The files carry
no machine identifier. Tier read at capture: off. The effective tier during the
window is not established. The config lookup documented at capture was
`GSTACK_STATE_ROOT`, then `GSTACK_HOME`, then `GSTACK_STATE_DIR`, then
`$HOME/.gstack`; that does not establish which root any earlier process used.
See [Configuration and storage](#configuration-and-storage) for the current
rules for both gstack generations.
Provenance config file was absent, which the writer treats as on.

| Question | Status | Evidence |
|---|---|---|
| Schema conformity | demonstrated | 14 stage-runs rows. 8 lack `route` and `entrypoint_raw`; 6 include both. Every row's other keys matched the field table as it stood at capture. The writer then wrote no schema version, so these are pre-version rows; they were not re-checked against the later published schema |
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

Sources: `analytics/skill-usage.jsonl` under the selected logger's state root
(default `~/.gstack`; see [Configuration and storage](#configuration-and-storage)),
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
