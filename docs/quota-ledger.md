# Quota ledger

The ledger records capacity samples and local consumption for any caller that
launches agent sessions. Capacity belongs to an account pool; model vendor is a
separate property. A failed read never means zero consumption or unlimited quota.
This is the normative specification for the quota commands and their v1 JSON.

## Quick start

### Check capacity (normally under 8 seconds)

```sh
gstack-extend quota status --refresh --json
gstack-extend doctor quota --json
```

If setup could not link the executable, use
`"$HOME/.claude/skills/gstack-extend/bin/gstack-extend"` in its place. Each pool
reports its own availability. All adapters are experimental until a deployment
trial records at least 95% successful reads over 24 hours.

### Bracket a stage (four commands plus identity attachment)

Ledger session IDs belong to the caller; harness session IDs belong to the vendor.
Use the same ledger ID in any independently written `stage-runs.jsonl` row.
For Claude, preassign a UUID with `claude -p --session-id`; Codex emits its thread
ID in the first `codex exec --json` event; Cursor returns `session_id` with
`--output-format json`. Capture that ID without printing the surrounding response.

```bash
gstack-extend quota sample --session-id example-build --phase start --stage build --agent codex --auth subscription --cwd "$PWD" --repo-root "$PWD" --json
# Launch the stage, then replace THREAD_ID with its captured harness ID.
gstack-extend quota sample --session-id example-build --phase attach --agent codex --harness-session THREAD_ID --json
gstack-extend quota runs --active --session-id example-build --json
# Wait for the stage to end before finishing the bracket.
gstack-extend quota sample --session-id example-build --phase finish --json
gstack-extend quota runs --session-id example-build --json
```

Start returns `{"v":1,"session_id":"example-build","lifecycle":"open",...}`;
finish returns `lifecycle: "recorded"` with `local_persisted_at`. Active monitoring
requires a starting identity or an attach. Multiple attach calls can register
different harness sessions. Calls are synchronous, transactional and idempotent;
retrying a completed phase returns its receipt. There is no queue or wait flag.

### Offline walkthrough

The fixture transport reads endpoint files from `tests/fixtures/quota/` and never
reads credentials or opens sockets. Use a temporary HOME and an explicitly
non-default state directory. The test helper is the reference for isolating the
environment; it does not inherit vendor credentials. Fixture mode announces
itself on stderr and labels all persisted records `fixture: true`.

```bash
python3 - <<'PY'
import os, pathlib, subprocess, tempfile
repo = pathlib.Path.cwd()
with tempfile.TemporaryDirectory() as home:
    isolated = {"HOME": home, "PATH": os.defpath,
        "GSTACK_EXTEND_STATE_DIR": home + "/state",
        "GSTACK_EXTEND_QUOTA_FIXTURES": str(repo / "tests/fixtures/quota")}
    subprocess.run([str(repo / "bin/gstack-extend"), "quota", "status", "--refresh", "--json"], env=isolated, check=True)
PY
```

## Consumer contract

Every JSON command emits exactly one object with `v: 1`. Exit codes are 0 for a
successful command (including unavailable or partial data), 1 for an operational
failure, and 2 for invalid usage. Errors are
`{"v":1,"error":{"code":"...","message":"...","fix":"...","doc":"..."}}`.
Report text and fixture banners never contaminate JSON stdout. Additive fields
preserve the version; removed fields, renames and meaning changes require a new
version and release notes. The database layout is private. `stage-runs.jsonl`
remains JSONL and is joined by `session_id`; consumers own work-item, tier and
outcome joins.

| Command | Result and semantics |
|---|---|
| `quota status [--refresh] [--force]` | `pools[]` with `meters[]`, last attempt, freshness, reason/fix/doc and `since_last_ok`, the open interval after the latest good observation. Refresh honors the throttle; force bypasses only that throttle. |
| `quota sample --pool KIND` | Periodic capacity sample, with sample IDs and `reused_sample`. |
| `quota sample --session-id ID --phase start\|attach\|finish\|abandon` | Durable lifecycle receipt. Finish without a start fails `no_start_state`; attach after completion fails `run_finished`; changed metadata on an open start fails `conflict`. Abandon records `interrupted`. |
| `quota runs [--active] [--session-id ID]` | `runs[]` with native consumption and configuration, source evidence, lifecycle, `local_persisted_at`, `settled_at`, `as_of`, completeness and `observed_through`. |
| `quota summary [--by stage,agent,model]` | `groups[]` with unique run counts, median/p90 per token class, attribution/settlement counts, excluded counts and reasons. Cursor totals deduplicate canonical events across all groups. Shared cost is listed separately and never allocated to a configuration. |
| `quota intervals` | Consecutive same-pool sample pairs, derived from current indexed events; `as_of`, per-meter changes and coverage. Late records and charge revisions update past intervals. |
| `quota settle` | Refresh Cursor event facts and recompute affected rows, including previously final or expired rows. |
| `quota probe KIND --raw` | One foreground response on stdout, intended only for a direct pipe into the fixture scrubber. Raw responses must never be saved or pasted into an agent session. |
| `doctor quota` | Read-only report: sources, reasons/counts, drift, coverage, bytes, refusals, open/stale runs, pending settlement and exchange counts. Report exits 0 even if the store cannot be read. |

All commands support `--json` and help with an example. Filters accept a pool kind
or full pool ID in `--pool`; `--since` accepts ISO-8601 or durations such as `7d`
and `12h`; `--days N` is an alias. Runs and summary also accept stage, agent,
model, effort and route filters. Summary grouping supports these fields and pool.
Filtering never reallocates shared Cursor cost.
For lifecycle sampling, `--pool` restricts capacity reads while consumption still
covers all locally observed pools. Settlement fetches only the current Cursor
account; a different full pool ID reports `identity_unknown`. Doctor applies pool
and time filters to its sample coverage. Probe requires its pool filter to match
the requested adapter and current account. All network paths honor pool disable,
sandbox and rate-limit backoff settings.

### Samples

A sample contains `v`, `sample_id`, `ts` (write time), `observed_at` (source time),
`pool`, `pool_kind`, `source`, `status`, `reason`, `meters`, identity evidence,
`raw_shape_hash` and bounded `unknown_fields`. Trigger is
`run_start|run_finish|attach|periodic|refresh|status|settle`; a run-triggered sample
includes `session_id`. Status is `ok|partial|unavailable`. Partial reads keep only
valid meters; unavailable reads have none. No raw response or credential is stored.

Each meter has stable `meter`, display label, `used`, `limit`, `unit`, `resolution`,
`resets_at`, `window_s`, `window_kind`, and provider severity/active flags where
available. Percent meters have resolution 1; cents resolution 0.01. Unknown
resolution is null. Whole-percent observations bound a change only to within one
resolution step. Claude identity includes kind, group and full model/surface scope;
Codex includes limit ID and primary/secondary slot, independently of duration.
Unknown valid meters are preserved. Data-keyed maps expose counts, never their raw
keys; other unexpected paths are hashed and capped at 50.

Freshness is per meter: `stale_after` is the earlier of observed time plus 300
seconds and a non-null reset boundary. An older meter is unknown after its reset,
never assumed refilled. A meter omitted by a later ok sample is `absent`; partial
samples update only parsed meters. Negative age clamps to zero with `clock_skew`.
Human output includes plan/window labels, age, and time until reset.

### Runs and consumption

The key is `(session_id, pool_kind, pool)`. Unresolved run identity uses `pending`
once per session and kind. Resolved rows indicate `resolves_pending`; queries hide
the replaced pending row. Different known accounts retain different rows. Historic
events lacking account evidence live in `unresolved` and are excluded from known
pool totals. A current account must not acquire old logs discovered after a switch.

Run configuration includes stage, agent, route, model, model_vendor, effort,
gstack_extend_version, gstack_version, captured cwd/repository and discovery roots.
Row agent/model describe the stage; each `sources[]` entry describes its own
agent/model, hashed session, kind (`own|subagent|child`), attribution,
`status`, `reason`, consumption and observation time. Source attribution orders
`exact > turn > window > unknown`; a row uses its weakest source. Missing values
carry `why`. A source with no usage must not imply zero. Grok has local tokens if
reported but no capacity reader; an unidentified harness remains unknown.

Token classes are disjoint: uncached `input`, `cache_read`, `cache_write`, and
`output`. `reasoning` is an informational subset of output and is never added.
Unreported classes are null. Claude maps input/cache-read/cache-creation/output
directly and takes thinking tokens from output details. Codex subtracts cached
reads and reported cache writes from inclusive input. Cursor event input is
uncached; its output includes reasoning if reported. Local SDK input includes
cached reads and is reduced accordingly. Consumption is grouped by billed model.

Claude response identity is message ID; streaming copies retain the entry with
the largest output and take all classes from that entry. Copied messages in a
resumed session count once globally. Codex uses ordered cumulative increments
within counter epochs, with per-record model from the latest turn_context.
Replayed counters add nothing; resets start a new epoch, and identical consecutive
requests remain distinct. Missing order makes a source partial. Line-one
session_meta defines a rollout; copied metadata later in the file is ignored.
Codex in-run rate limits retain first/last percent observations per limit/window,
with timestamps, reset flags and below-resolution flags.

Windows are half-open `[started_at, ended_at)`. Stable request identities and
known containment are required for exact attribution. Records crossing a boundary
or arriving late are marked uncertain. Adjacent runs cannot both own a record.
Child linkage follows parent-thread chains; linked children that started earlier
are window-attributed. Cross-harness children require a captured cwd inside the
repository and local creation within the stage window. In-window usage from a
child outliving the stage remains window-attributed with `outlived_stage`.
Multiple eligible parents make the child unknown for each parent, and the event
is reported once as unassigned/concurrent consumption.

Claude subagent transcripts belong to the explicitly attached stage session.
Cursor subagent IDs are used only when billing events actually join them; the T0
trial found no matching child billing IDs and this remains a coverage limitation.
A Cursor account event alone is never child evidence. Local transcript directories
provide cwd/creation evidence. Native SDK matching joins agents' cwd to runs on
agentId, requires one overlapping candidate, and is unknown with zero or several.
Private SDK stores are best-effort. Route is provenance; billed model, not route,
is the price-bearing fact.
Text-format Cursor transcripts establish local conversation identity and creation
evidence, but have no structured usage. Their coverage is `not_reported`, never a
zero-token observation.

### Cursor cost

One event store owns all charge facts. Canonical identity is provider event ID, or
`(pool, conversation_hash, event_ts, model)` when no ID exists. Unresolvable
same-key collisions are ambiguous, never silently merged. Relationships store
only event references. Facts include charged cents, tokens, revision,
last_changed_at and explicit turn-boundary evidence with its source.

Allocation is a query. A turn wholly within one stage is attributable. A turn
overlapping stages or extending outside a stage is `shared_turn`; runs list
`shared_cents` and other stage IDs. Without explicit start and end evidence it is
`boundary_unknown`, excluded from attributable cents and calibration. Polling
cadence cannot manufacture a turn end or change containment.

Mutable events are provisional. Two unchanged reads, at least five minutes after
run end, plus local completion evidence allow final settlement; otherwise stability
is assumed and remains revisable. After 48 hours without settlement the state is
expired. Any later revision increments revision and can restore final settlement.
Revision takes precedence over settlement rank (`final > expired > unavailable >
provisional`), then write time. Finish persists local consumption before settlement
work. Cursor sampling and explicit settle are the only settlement triggers. Event
queries cover start minus six hours to finish plus ten minutes, page size 1000,
maximum 20 pages; exhausted paging or time budgets report partial coverage.

## Troubleshooting

The reason registry in `bin/lib/quota/common.py` is shared by status, doctor and
this table. Null consumption and unknown changes always include an explanation.
Adapters fail independently. Disabled capacity readers still permit local usage.

<!-- quota-reasons:start -->
| Reason | Cause / what is shown | Fix |
|---|---|---|
| no_sample | No capacity observation recorded | Run gstack-extend quota status --refresh. |
| no_credentials | No usable credential source; capacity unknown | Sign in with the vendor CLI; Cursor needs CURSOR_API_KEY. |
| auth_expired | Access token expired; capacity unknown | Use the vendor CLI to sign in again. |
| missing_executable | Vendor CLI absent | Install the vendor CLI and check PATH. |
| unsupported_version | Required CLI flags unavailable | Upgrade the vendor CLI. |
| http_401 | Authentication rejected | Sign in again with the vendor CLI. |
| http_403 | Account access denied | Check account permissions with the vendor. |
| http_429 | Vendor backoff active | Wait until retry_at; force does not bypass backoff. |
| http_4xx | Endpoint rejected the request | Run doctor quota and check adapter compatibility. |
| http_5xx | Vendor service failure | Retry after the service recovers. |
| network_error | Connection, DNS or TLS failure | Check connectivity and retry. |
| timeout | Read, process or lock budget exhausted | Retry when the source is responsive. |
| schema_changed | Response does not match the adapter | Upgrade or regenerate a scrubbed fixture. |
| spawn_failed | Vendor process could not start | Check executable permissions and retry. |
| disabled | Pool disabled in quota_pools | Enable the pool in quota_pools. |
| sandboxed | Network forbidden by sandbox markers | Retry from an unsandboxed caller. |
| exchange_throttled | Cursor key exchanged within 60 seconds | Retry after retry_at. |
| identity_unknown | Paying account cannot be established | Attach a session with verified subscription identity. |
| identity_changed | Account changed during observation | Finish this run and start a new bracket. |
| log_too_large | Source exceeds the per-file read cap | Narrow declared roots or archive completed vendor logs. |
| source_unreadable | A declared source cannot be scanned | Repair source permissions and retry. |
| scan_budget | Discovery or parsing budget exhausted | Repeat the query to advance checkpoints. |
| malformed_record | A source contains an invalid record | Check vendor log integrity. |
| no_usage | No attributable usage record is available | Attach the correct harness session and retry. |
| not_reported | Source does not report structured usage | Keep consumption unknown; inspect another supported source. |
| ordering_unknown | Usage counter order cannot be established | Check vendor log integrity. |
| boundary_unknown | Turn boundaries are not recorded | Keep the charge uncertain; do not allocate it. |
| ambiguous | Evidence matches several identities or parents | Supply an explicit harness identity. |
| store_refused | Store path is not a private regular file | Remove the unsafe link or repair permissions. |
| store_error | Transaction could not commit | Free disk space and retry the same command. |
| no_start_state | Run has no start state | Start this session ID before attaching or finishing. |
| run_finished | Run has already finished | Start a new session ID before attaching more work. |
| conflict | Session ID has different start metadata | Retry with the original metadata or use a new session ID. |
| fixture_refused | Test variables require an isolated fixture state directory | Unset test variables, or set fixture mode and a private state directory. |
| usage | Invalid command arguments | Run the command with --help. |
<!-- quota-reasons:end -->

## Config and environment

`bin/config set quota off` disables every quota command: exit 0,
`{"v":1,"disabled":true}`, no store, source, credential or network reads after
the configuration check. A missing quota key enables explicit commands; unreadable
configuration disables them. `quota_pools` is a comma list (default all three
readable kinds); `quota_min_interval` is seconds (default 60). Turning quota off
leaves existing data in place. Telemetry has no quota hook and starts no sampler.
There is no upgrade migration or consent command.

| Variable | Scope |
|---|---|
| GSTACK_EXTEND_STATE_DIR | Production; local state root, default ~/.gstack-extend |
| GSTACK_EXTEND_TELEMETRY_DEBUG | Production; existing telemetry diagnostics |
| CURSOR_API_KEY | Production; in-memory Cursor exchange credential, never forwarded to vendor child processes |
| CLAUDE_CONFIG_DIR, CODEX_HOME | Production; default roots when caller flags are absent |
| CODEX_SANDBOX, CODEX_SANDBOX_NETWORK_DISABLED | Production; sandbox detection, disables network readers |
| GSTACK_EXTEND_QUOTA_FIXTURES | Tests only; endpoint fixture directory, requires isolated state |
| GSTACK_EXTEND_QUOTA_NOW | Tests only; injected UTC clock |
| GSTACK_EXTEND_QUOTA_BUDGET_SCALE | Tests only; shortened process and lock budgets |

Doctor warns about test variables. A test variable with default state is refused.
Vendor binaries resolve through one resolver; in fixture mode only its fixture
bin directory is searched. Tests reduce the environment to an allowlist and
assert no real Cursor key or vendor binary is reachable. Production vendor
children receive HOME, PATH, USER, TMPDIR, LANG and the relevant config root only.
Harness and Conductor markers never reach those children. Values and process
arguments are never printed. Ancestry uses argv[0] in memory, then command name;
process-list output contains only PID, PPID and command name, never arguments.

## Spec

### Storage, budgets and discovery

Stdlib sqlite3 owns `quota/quota.sqlite3` under the state root, WAL mode with a
bounded busy timeout. Samples, runs, lifecycle state, completion receipts, event
facts, identity bindings, backoff and source checkpoints use transactions and
upserts. Database, WAL, shared-memory, key and lock paths reject symlinks, special
files and extra hard links; files are mode 0600 in a private directory. Refusals
are visible in doctor. No retention or automatic deletion is performed.

Pool IDs are `<kind>:<HMAC-SHA256(account)[:12]>`, keyed by one per-install 0600
random key. Claude uses organization UUID, Codex account ID, Cursor owningUser.
No email or raw account identity is retained. IDs are stable locally and cannot
be compared across machines. Do not synchronize this ledger across machines.

| Operation | Budget |
|---|---|
| Snapshot refresh | 8 seconds total; pools read concurrently, each remote call at most 5 seconds |
| Claude usage | Included in the 8-second cap; T0 measured below 5 seconds |
| Cursor pages / settlement | 60 seconds, independent of snapshot work |
| Active runs / interval source parsing | 2 seconds, up to 50 MiB per pass; resumes from checkpoint |
| Discovery | Separate bounded inventory pass; uncovered roots listed |
| Single source | 512 MiB maximum, streaming rather than tail-only |
| Vendor response | 1 MiB maximum |

Process groups are killed at deadline, including a process ignoring SIGTERM.
Locks poll nonblocking within the same operation budget. Snapshot locks are per
pool and freshness/backoff is rechecked after acquisition. Cursor exchanges have
a separate cross-process 60-second budget per hashed key, with tokens kept only
in process memory. Retry-After is respected; unspecified 429 backoff is 300 seconds.

Source discovery records explicit roots: Claude projects, Codex sessions, Cursor
projects and native SDK stores. Flags `--claude-config-dir`, `--codex-home`,
`--cursor-projects-dir`, `--conductor-store`, `--cwd`, `--repo-root` capture context
for later reads. Locators take this context instead of using the query's cwd.
Each file has device/inode/size, offset, parser state and coverage. Rotation resets
its checkpoint. Partial final lines are retried after append; malformed records
are counted. Discovery and parse budgets are distinct, with `complete: false`
and uncovered roots on exhaustion or read failure. Zero is valid only when every
declared source was fully scanned and identity is resolved. Identity evidence is
captured at read time, including credential metadata mtime. A historical record
without a contemporaneous binding remains unresolved.

Intervals join consecutive ok observations on the same verified pool. Each meter
has its own reset epoch. Changed reset times tolerate 60 seconds; a falling used
value, changed reset boundary or a boundary crossed in time flags reset_crossed.
A zero Codex weekly window rolling forward approximately with elapsed time is
window_rolled. A null reset time means no active window. Below-resolution changes
are labeled, not promoted to exact measurements. Local usage is deduplicated by
event identity across all discovered sessions. Claude and Codex always declare
remote_unobservable: other machines and chat surfaces cannot be counted locally.
Known subagents and attributed children belong to their parent's activity family;
unrelated local families and foreign Cursor events indicate concurrency. Boundary,
incomplete and provisionally settled observations are excluded from calibration.

Run state becomes stale after 48 hours without activity, remains finishable, and
is renewed by every sample call. Abandon explicitly records interruption. Finish
atomically commits consumption, rows and a receipt. No successful acknowledgement
precedes commit. Finish overrides start metadata; conflicting earlier identity
remains as a source. Auth comes from `--auth subscription|api|unknown`, default
unknown; caller flags win. Explicit API mode never charges a subscription pool.
Inside-stage detection recognizes API keys and alternative provider markers.
Claude account JSON is capped at 16 MiB; larger files leave identity pending.

### Adapters and network calls

Claude uses `claude -p /usage --output-format stream-json --verbose
--no-session-persistence --safe-mode --strict-mcp-config --mcp-config
'{"mcpServers":{}}'`. It parses the assistant event's usage_report limits, with
legacy limit parsing where supplied. Missing report is schema_changed. There is
no direct OAuth request, User-Agent imitation, Keychain fallback or consent state.
The pool comes from account JSON and any returned account evidence; disagreement
leaves it pending. Sampler calls produce no transcript consumption.

Codex prefers rate_limits in rollouts younger than five minutes. Otherwise it
starts app-server only after a read-only auth check finds an access token valid
beyond the read budget. It uses initialize/initialized/account/rateLimits/read;
no thread or turn is started and no credential is written by this implementation.
Expired or missing tokens prevent spawn. It does not implement refresh or a
second Bearer endpoint. Vendor-side refresh on unexpected revocation remains a
vendor behavior; the live trial did not force a credential rotation.

Cursor uses only CURSOR_API_KEY, exchanging it at
`https://api2.cursor.sh/auth/exchange_user_api_key`, then calling
`aiserver.v1.DashboardService/GetCurrentPeriodUsage`, `GetPlanInfo` and
`GetFilteredUsageEvents` on that host. Cents and percent meters remain separate;
auto/API percent denominators are unknown. Snapshot identity comes from the same
credential's hashed owningUser cache or one event page. Missing identity is shown
as pending and never assigned a different account's cached sample.

| Adapter | macOS / Linux | Inside / outside Conductor | Credential | Trial |
|---|---|---|---|---|
| Claude | Native CLI required on either OS | Both | Vendor-managed subscription sign-in | experimental; 24-hour trial pending |
| Codex | Native CLI or readable rollout on either OS | Both | Read-only account metadata; fresh token for app-server | experimental; 24-hour trial pending |
| Cursor | HTTP and local logs on either OS | Both | CURSOR_API_KEY; set it yourself outside Conductor | experimental; 24-hour trial pending |
| Grok | Local usage only | Both | None read by quota | No capacity adapter |

For reset/retention, stop quota commands, back up the private quota directory,
then remove the database together with its WAL/SHM files. This discards samples,
bindings, pending settlements and receipts. Preserve the key for stable pool IDs;
removing it starts a new identity namespace. Never truncate a live SQLite file.
`stage-runs.jsonl` is independent. Disabling quota is sufficient to stop new work.

## Evidence appendix

T0 was run in the foreground on 2026-09-23. Responses and tokens stayed in memory;
only shape, counts and decisions were recorded. No environment values or process
arguments were printed. The sampler uses a process group for bounded cleanup,
while the foreground caller waits for it.

### DX-13 decision table

| Probe | Observed outcome | Shipped decision |
|---|---|---|
| Claude flags / sampler conditions | JSON mode omits the report; stream-json plus verbose supplies three limits. 1.3–2.0 seconds, zero tokens/cost, no transcript, no MCP servers. SessionStart sentinel did not fire under safe-mode. Five short-lived internal child processes were observed. | Stream-json reader within snapshot budget; suppress custom hooks/MCP/persistence. |
| Keychain path | Structured native usage works. | No Keychain access or consent code. |
| Cursor subagent billing IDs | 27 local subagent IDs checked against 18 recent billing events; none matched. | Do not invent child billing links; expose incomplete child coverage. |
| Cursor cwd slug | One existing project matched absolute cwd with non-alphanumeric characters replaced by hyphens and leading separators removed. A fresh CLI probe exited before creating a transcript. | Use the observed mapping with local evidence only; no time-only account-feed attribution. |
| Codex token classes | 504 local records inspected; 288 included cache_write_input_tokens; input was compatible with inclusive cached read/write counts. | Subtract both caches; absent classes null; fixture locks mapping. |
| Codex app-server | Fresh-token read completed in 0.63 seconds, no child process observed, auth bytes unchanged. Concurrent account/read used refreshToken false. | Gate spawn on token expiry; no MCP/thread startup. Expired case is a gate refusal. |
| Cursor exchange | Two exchanges at least 60 seconds apart; old and new tokens both still read capacity (HTTP 200). Native session token was not read. | Per-key cross-process exchange budget; no stored-token mutation. Native-session coexistence remains operational verification. |
| Comparison reader | Codex reference CLI's weekly percentage matched the implemented rollout reader. Cursor reference CLI rejected this credential route. | Reference tool remains optional, never a runtime dependency; Cursor comparison unavailable. |

The Codex protocol is documented in [OpenAI's app-server reference](https://learn.chatgpt.com/docs/app-server).
The live probe verifies the installed protocol path, not all vendor refresh races.
Operational verification still requires an expired/revoked-token concurrency trial
without modifying live credentials, native Cursor coexistence, and each adapter's
24-hour coverage trial. Until those observations exist, status and doctor retain
the experimental label. Unknown Cursor exhaustion behavior and future Codex window
changes remain provider observations, not assumptions encoded as zero/unlimited.
