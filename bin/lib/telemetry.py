"""Optional local telemetry helpers.

The guarded shell entrypoint runs this module as __main__. The doctor report
imports capture, resolve, sink_path, and the wrapper checks so both CLIs share
one sink ladder and one compatibility rule.
"""
import errno
import fcntl
import hashlib
import json
import os
import stat
from collections import Counter
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import quote

INT64_MAX = 2**63 - 1  # the logger stores durations as 64-bit integers
INT64_DIGITS = len(str(INT64_MAX))
CONFIG_TIMEOUT_S = 10  # git and gstack-config lookups
LOGGER_TIMEOUT_S = 15  # the delegated completion logger
# The skill blocks in skills/*.md grep the wrapper for this exact text (also a comment in bin/gstack-extend-telemetry).
# Bump it with any incompatible change to the start/finish call shape so older/newer pairs fail closed.
PROTOCOL_MARKER = b"telemetry-protocol: start-finish-v1"
MIN_GSTACK_FOR_NO_SWEEP = "1.80.0.0"  # first gstack release whose gstack-telemetry-log honors --no-sweep
HARNESSES = ("claude", "codex", "grok")
OUTCOMES = ("success", "error", "abort", "unknown")
LOG_TAIL_BYTES = 8 << 20  # a stage's turns sit at the end of its session log; bounds finish latency on huge logs


def debug(problem, fix):
    if os.environ.get("GSTACK_EXTEND_TELEMETRY_DEBUG") == "1":
        print(f"telemetry skipped: {problem}. Fix: {fix}. See docs/telemetry.md.", file=sys.stderr)


def trace(message):
    if os.environ.get("GSTACK_EXTEND_TELEMETRY_DEBUG") == "1":
        print(f"telemetry: {message}", file=sys.stderr)


def integer(value):
    # Validate before conversion/arithmetic, including input length and overflow.
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and 0 <= value <= INT64_MAX:
        return value
    if isinstance(value, str) and re.fullmatch(rf"[0-9]{{1,{INT64_DIGITS}}}", value):
        number = int(value)
        if number <= INT64_MAX:
            return number
    return None


def valid_session(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,199}", value)


def clean(value):
    # Provenance values come from callers and from harness logs: keep short printable strings, drop anything else.
    return value if isinstance(value, str) and value.strip() and len(value) <= 200 and value.isprintable() else None


def executable(path):
    # Absolute only: a relative PATH or GSTACK_DIR entry (e.g. node_modules/.bin) must never
    # resolve to a file planted in the current repository. This is not a trust check: an
    # absolute PATH entry that points into a repo (direnv, npm run) still resolves there.
    return bool(path) and os.path.isabs(path) and os.path.isfile(path) and os.access(path, os.X_OK)


def which(name):
    # shutil.which stops at the first PATH hit, so a relative entry (node_modules/.bin) could hide a real
    # absolute helper behind it. Search only the absolute entries.
    entries = [entry for entry in os.environ.get("PATH", os.defpath).split(os.pathsep) if os.path.isabs(entry)]
    return shutil.which(name, path=os.pathsep.join(entries)) if entries else None


def resolve(name):
    candidates = [which(name)]
    if os.environ.get("GSTACK_DIR"):
        candidates.append(str(Path(os.environ["GSTACK_DIR"]) / "bin" / name))
    candidates.append(str(Path.home() / ".claude/skills/gstack/bin" / name))
    return next((p for p in candidates if executable(p)), None)


def compatible_wrapper(path):
    # A version-compatibility probe, not a trust boundary (anyone can add the line). An older wrapper forwards the
    # unknown positional `start` to the logger and writes a garbage completion row, so a wrapper without the
    # protocol marker is treated as absent.
    try:
        return executable(path) and PROTOCOL_MARKER in Path(path).read_bytes()
    except OSError:
        return False


def supports_no_sweep(logger):
    # A text sniff: the logger source must mention the flag. gstack before MIN_GSTACK_FOR_NO_SWEEP ignores
    # --no-sweep and still finalizes other sessions' in-flight markers. Test stubs advertise it with a comment.
    try:
        return b"--no-sweep" in Path(logger).read_bytes()
    except OSError:
        return False


def sink_path():
    # gstack-telemetry-log honors STATE_DIR only. HOME/STATE_ROOT affect config.
    return Path(os.environ.get("GSTACK_STATE_DIR") or Path.home() / ".gstack") / "analytics/skill-usage.jsonl"


def capture(args):
    # Bytes, not text=True: universal-newline decoding would turn a path containing \r into \n and make
    # distinct repositories share a handoff key.
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=CONFIG_TIMEOUT_S)
    return os.fsdecode(result.stdout).removesuffix("\n") if result.returncode == 0 else ""


def read_capped(path, limit):
    # O_NONBLOCK plus a regular-file check: a FIFO or a symlink must not stall finish, and a hard
    # link must not pour provenance into the file gstack uploads.
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit:
            raise OSError(errno.EINVAL, "refusing a non-private or oversized file")
        with os.fdopen(descriptor, "rb") as stream:
            descriptor = -1
            return stream.read(limit)
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def read_json(path):
    try:
        data = json.loads(read_capped(path, 1 << 20).decode("utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    # Atomic replacement avoids partially read handoffs. This is not a crash marker.
    fd, temporary = tempfile.mkstemp(prefix=".handoff-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(state, stream)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def append_row(path, row, name):
    # 0600 and O_NOFOLLOW: the ledger holds branch and work item. A symlink planted at the
    # destination must not append those fields into a file gstack may upload.
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # O_NONBLOCK: a FIFO with no reader would otherwise block in open(). A FIFO that does open
        # is still not a ledger; refuse it before writing.
        descriptor = os.open(path, os.O_APPEND | os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            os.close(descriptor)
            debug(f"{name} is not a private regular file at {path}", "remove the symlink, FIFO, or extra link and retry")
            return False
        with os.fdopen(descriptor, "a", encoding="utf-8") as stream:
            stream.write(json.dumps(row, ensure_ascii=True, separators=(",", ":")) + "\n")
        return True
    except OSError as error:
        debug(f"{name} unwritable at {path}: {error.strerror}", "repair permissions on the telemetry state directory")
        return False


def provenance_enabled(state_root):
    # The bin/config key=value store (first match wins, like its awk reader). Rows are local-only, so on unless disabled.
    try:
        raw = read_capped(state_root / "config", 1 << 20)
    except FileNotFoundError:
        return True
    except OSError:
        # Missing means default on. A FIFO, symlink, or unreadable file is not evidence the switch is still on.
        return False
    lines = raw.decode("utf-8", "replace").splitlines()
    for line in lines:
        key, separator, value = line.partition("=")
        if separator and key == "provenance":
            return value.strip() not in ("false", "off")
    return True


def usage_logger():
    """The completion logger when gstack's tier enables skill-usage rows, else None (explained in debug mode)."""
    logger, config = resolve("gstack-telemetry-log"), resolve("gstack-config")
    if not logger or not config:
        debug("gstack absent or gstack-config unavailable", "run setup in your gstack checkout")
        return None
    try:
        result = subprocess.run([config, "get", "telemetry"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=CONFIG_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError) as error:
        # Provenance does not depend on gstack. A transient helper failure must be retried, not treated as tier off.
        debug(f"gstack-config failed ({type(error).__name__}: {error})", "run gstack-extend doctor telemetry")
        return "retry"
    if result.returncode != 0:
        debug(f"gstack-config failed (exit {result.returncode})", "run gstack-extend doctor telemetry")
        return "retry"
    tier = os.fsdecode(result.stdout).strip()
    if tier not in ("anonymous", "community"):
        debug(f"telemetry tier off, missing, or invalid ({tier!r})", "run gstack-config set telemetry community")
        return None
    trace(f"logger={logger} config={config} tier={tier} sink={sink_path()}")
    return logger


def delegate(logger, skill, sid, duration, values):
    if not supports_no_sweep(logger):
        # Delegating anyway would let an old logger finalize other sessions' markers as phantom rows.
        debug(f"gstack-telemetry-log at {logger} lacks --no-sweep (gstack before {MIN_GSTACK_FOR_NO_SWEEP})",
              "run gstack-upgrade")
        return False
    sink = sink_path()
    try:
        sink.parent.mkdir(parents=True, exist_ok=True)
        # Same private-file rules as the ledger, without writing. A blocking open here holds the repo+skill lock.
        descriptor = os.open(sink, os.O_APPEND | os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        info = os.fstat(descriptor)
        os.close(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            debug(f"sink is not a private regular file at {sink}", "remove the symlink, FIFO, or extra link and retry")
            return False
    except OSError as error:
        debug(f"sink unwritable at {sink}: {error.strerror}", "repair permissions on the telemetry state directory")
        return False
    delegated = [logger, "--source", "gstack-extend", "--no-sweep", "--skill", skill,
                 "--session-id", sid, "--duration", str(duration)]
    for flag in ("--outcome", "--used-browse", "--error-class", "--error-message", "--failed-step"):
        if flag in values:
            delegated.extend([flag, values[flag]])
    try:
        # DEVNULL is load-bearing: upstream backgrounds its network sync with inherited stdio, so capturing
        # the output here would make finish wait on that sync until the timeout.
        result = subprocess.run(delegated, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=LOGGER_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError) as error:
        debug(f"gstack-telemetry-log failed ({type(error).__name__}: {error})", "run gstack-extend doctor telemetry")
        return False
    if result.returncode:
        debug("gstack-telemetry-log failed", "run gstack-extend doctor telemetry and check your gstack install")
        return False
    return True


# ─── Execution provenance: which harness, model and effort ran a stage ───


def parse_ts(value):
    # Harness logs write ISO-8601 UTC with 3 to 9 fractional digits; datetime.fromisoformat before 3.11 takes only 3 or 6.
    match = isinstance(value, str) and re.fullmatch(r"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?(Z|[+-]\d\d:\d\d)?", value)
    if not match:
        return None
    try:
        moment = datetime.fromisoformat(match[1] + (match[3] if match[3] and match[3] != "Z" else "+00:00"))
    except ValueError:
        return None
    return moment.timestamp() + float(match[2] or 0)


def iso(epoch):
    try:
        return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (OverflowError, OSError, ValueError):
        return None


def tail_records(path):
    # JSON objects from the last LOG_TAIL_BYTES of a JSONL log; a line cut by the seek is dropped.
    # Regular files only: a FIFO or device named like a transcript blocks in open(). A bounded read keeps a
    # concurrent append from exceeding the cap; the Claude grace loop re-seeks and sees the later bytes.
    if not path.is_file():
        return
    with path.open("rb") as stream:
        size = stream.seek(0, os.SEEK_END)
        stream.seek(max(0, size - LOG_TAIL_BYTES))
        lines = stream.read(LOG_TAIL_BYTES).split(b"\n")
    for line in lines[1:] if size > LOG_TAIL_BYTES else lines:
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if isinstance(record, dict):
            yield record


def newest(paths):
    found = [(path.stat().st_mtime, str(path), path) for path in paths]
    return max(found)[2] if found else None


def claude_turns(session_id):
    # ~/.claude/projects/<cwd slug>/<session id>.jsonl records the model and effort each API response actually used.
    if not re.fullmatch(r"[A-Za-z0-9-]{1,128}", session_id):
        return []
    root = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    log = newest((root / "projects").glob(f"*/{session_id}.jsonl"))
    turns, seen = [], set()
    for record in tail_records(log) if log else ():
        message = record.get("message")
        # Sidechain turns belong to subagents the stage dispatched, not to the stage itself.
        if record.get("type") != "assistant" or record.get("isSidechain") or not isinstance(message, dict):
            continue
        model, ts = clean(message.get("model")), parse_ts(record.get("timestamp"))
        if model is None or model == "<synthetic>" or ts is None:
            continue
        # One API response is split across several transcript entries; count it once.
        ident = message.get("id") or record.get("uuid")
        if ident in seen:
            continue
        seen.add(ident)
        turns.append((ts, model, clean(record.get("perTurnEffort")) or clean(record.get("effort"))))
    return turns


def codex_turns(thread_id):
    # ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<thread id>.jsonl opens every turn with its model and effort.
    if not re.fullmatch(r"[A-Za-z0-9-]{1,128}", thread_id):
        return []
    root = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    log = newest((root / "sessions").glob(f"*/*/*/rollout-*-{thread_id}.jsonl"))
    turns = []
    for record in tail_records(log) if log else ():
        payload, ts = record.get("payload"), parse_ts(record.get("timestamp"))
        if record.get("type") == "turn_context" and isinstance(payload, dict) and ts is not None and clean(payload.get("model")):
            turns.append((ts, payload["model"], clean(payload.get("effort"))))
    return turns


def grok_logs(root):
    sessions = Path(os.environ.get("GROK_HOME") or Path.home() / ".grok") / "sessions"
    places = {quote(os.getcwd(), safe="")} | ({quote(root, safe="")} if root else set())
    named = os.environ.get("GROK_SESSION_ID", "")
    # The shell exports the session id. Use that file only; sibling sessions (subagents) are not this run.
    if re.fullmatch(r"[A-Za-z0-9-]{1,128}", named):
        named_logs = []
        for place in places:
            log = sessions / place / named / "events.jsonl"
            if log.is_file():
                named_logs.append(log)
        return named_logs
    return [log for place in places for log in (sessions / place).glob("*/events.jsonl") if log.is_file()]


def grok_turns(root, begin):
    # Without a session id, only a single events log touched since the stage began is attributable.
    # Several (a concurrent session or subagent) leave the model unverifiable.
    named = bool(re.fullmatch(r"[A-Za-z0-9-]{1,128}", os.environ.get("GROK_SESSION_ID", "")))
    logs = grok_logs(root)
    active = logs if named else [log for log in logs if log.stat().st_mtime >= begin]
    if len(active) != 1:
        return []
    summary_path = active[0].with_name("summary.json")
    summary = read_json(summary_path) if summary_path.is_file() and summary_path.stat().st_size <= (1 << 20) else {}
    effort = clean(summary.get("reasoning_effort"))  # recorded per session, not per turn
    turns = []
    for record in tail_records(active[0]):
        ts = parse_ts(record.get("ts"))
        if record.get("type") == "turn_started" and ts is not None and clean(record.get("model_id")):
            turns.append((ts, record["model_id"], effort))
    if not turns and clean(summary.get("current_model_id")):
        turns.append((active[0].stat().st_mtime, summary["current_model_id"], effort))
    return turns


def settle(turns, begin, carry):
    # Turns inside the stage, plus (carry) the per-turn record already open when it began: Codex and Grok log a turn
    # once, at its start, and a whole skill usually runs inside one turn. Claude logs every API response, so the stage's
    # own responses are always in the window; not carrying keeps a skill run by a subagent (its parent transcript idle)
    # from inheriting the parent's model. The (model, effort) pair behind the most turns wins, ties to the later pair.
    window = ([turn for turn in turns if turn[0] < begin][-1:] if carry else []) + [turn for turn in turns if turn[0] >= begin]
    if not window:
        return None, None
    counts = Counter((model, effort) for _, model, effort in window)
    last = {(model, effort): index for index, (_, model, effort) in enumerate(window)}
    return max(counts, key=lambda pair: (counts[pair], last[pair]))


def detect(begin, end, root):
    """(agent, model, effort) for the harness running this command, from its own session log; None when unverifiable."""
    readers = []
    if os.environ.get("CODEX_THREAD_ID"):
        readers.append(("codex", True, lambda: codex_turns(os.environ["CODEX_THREAD_ID"])))
    if os.environ.get("GROK_AGENT") == "1":  # Grok's shell forces this; a user-set profile name is not a marker
        readers.append(("grok", True, lambda: grok_turns(root, begin)))
    if os.environ.get("CLAUDECODE") == "1" or os.environ.get("CLAUDE_CODE_SESSION_ID"):
        readers.append(("claude", False, lambda: claude_turns(os.environ.get("CLAUDE_CODE_SESSION_ID", ""))))

    def turns(read):
        return sorted((turn for turn in read() if turn[0] <= end), key=lambda turn: turn[0])

    found = []
    for agent, carry, read in readers:
        # One unreadable log must not wipe a sibling harness that did parse.
        try:
            logged = turns(read)
        except Exception as error:
            trace(f"provenance detection failed ({type(error).__name__}: {error})")
            if len(readers) == 1:
                return agent, None, None
            logged = []
        found.append((agent, carry, read, logged))
    try:
        if len(found) > 1:
            # A nested harness (codex exec run from Claude Code, say) inherits the outer one's markers. The harness whose
            # log holds the latest turn is the one running this command; with no log to compare, it is unverifiable.
            logged = [candidate for candidate in found if candidate[3]]
            found = [max(logged, key=lambda candidate: candidate[3][-1][0])] if logged else []
        if not found:
            return None, None, None
        agent, carry, read, logged = found[0]
        model, effort = settle(logged, begin, carry)
        # Claude can start a command before appending the response that issued it. A stage too short to have logged any
        # later response gets a brief grace period instead of a null.
        for _ in range(4) if model is None and not carry else ():
            time.sleep(0.25)
            model, effort = settle(turns(read), begin, carry)
            if model is not None:
                break
    except Exception as error:
        # Intentional boundary: these logs belong to other tools and change without notice. An unreadable log costs
        # only the log-derived values (and the agent when nested markers need the logs to decide), never the row.
        trace(f"provenance detection failed ({type(error).__name__}: {error})")
        return (readers[0][0] if len(readers) == 1 else None), None, None
    return agent, model, effort


def repo_slug(url):
    # owner/name from an scp-like, scheme, or path remote. Userinfo, query, and fragment are dropped first;
    # a slug that still carries them is rejected rather than stored.
    url = url.strip()
    if "://" in url:
        rest = url.split("://", 1)[1].split("?", 1)[0].split("#", 1)[0]
        path = rest.split("/", 1)[1] if "/" in rest else ""
    elif re.match(r"[^/]+:", url):
        path = url.split(":", 1)[1]
    else:
        path = url
    path = path.split("?", 1)[0].split("#", 1)[0].strip().rstrip("/")
    if path.endswith(".git"):
        path = path[: -len(".git")]
    parts = [part for part in path.split("/") if part and part not in (".", "..")]
    # One path segment is not owner/name; taking two would keep the hostname.
    if len(parts) < 2:
        return None
    slug = "/".join(parts[-2:])
    if not slug or any(mark in slug for mark in "@?#"):
        return None
    return clean(slug)


def provenance_row(stage, sid, start, duration, values, root):
    now = time.time()
    begin = start if start is not None else int(now) - duration
    agent, model, effort = detect(begin, now, root)
    explicit = values.get("--agent")
    if explicit in HARNESSES:
        if explicit != agent:
            model = effort = None  # detected values describe a different harness
        agent = explicit
    elif explicit is not None:
        trace(f"ignored invalid --agent {explicit!r} (expected claude, codex or grok)")
    repo = branch = None
    if root:
        try:
            repo = repo_slug(capture(["git", "config", "--get", "remote.origin.url"])) or Path(root).name
            branch = clean(capture(["git", "symbolic-ref", "--quiet", "--short", "HEAD"]))
        except (OSError, subprocess.SubprocessError):
            # A stuck git must not skip the skill-usage completion that follows this row.
            repo = branch = None
    outcome = values.get("--outcome")
    # Field order is the schema shared with the orchestrator; rung is always 0 for a hand-run skill (no fallback chain).
    return dict(stage=stage, agent=agent, model=clean(values.get("--model")) or model,
                effort=clean(values.get("--effort")) or effort, rung=0,
                outcome=outcome if outcome in OUTCOMES else "unknown", started_at=iso(begin), duration_s=duration,
                session_id=sid, repo=repo, branch=branch, work_item=clean(values.get("--work-item")),
                source="gstack-extend")


def main(args):
    if args and args[0] in ("-h", "--help"):
        print('Usage: gstack-extend-telemetry start|finish --skill "extend:<name>"')
        print("  finish: [--start EPOCH] [--session-id ID] [--outcome success|error|abort|unknown]")
        print("  finish also forwards: [--used-browse true|false] [--error-class CLASS] [--error-message TEXT] [--failed-step STEP]")
        print("  finish provenance overrides: [--agent claude|codex|grok] [--model ID] [--effort LEVEL] [--work-item ID]")
        print("  Missing/malformed start and session values fall back to the repository + skill handoff.")
        print("  Bare flags retain legacy finish compatibility (--duration SECONDS).")
        print("  GSTACK_EXTEND_TELEMETRY_DEBUG=1 explains skips. See docs/telemetry.md.")
        return
    legacy = not args or args[0] not in ("start", "finish")
    command = args.pop(0) if not legacy else "finish"
    values = {}
    # --source and --event-type are accepted but never forwarded, so callers cannot override them;
    # --duration counts only for legacy finish calls. Provenance overrides stay local to the provenance row.
    flags = {"--skill", "--start", "--session-id", "--duration", "--outcome",
             "--used-browse", "--error-class", "--error-message", "--failed-step",
             "--event-type", "--source", "--agent", "--model", "--effort", "--work-item"}
    while args:
        flag = args.pop(0)
        if flag == "--no-sweep":
            continue  # Always forced on completion; start never invokes a sweeper.
        # A value that merely starts with "--" (--error-message "--dry-run rejected") is fine; only a
        # following flag means this flag's value is missing.
        if flag not in flags or not args or args[0] in flags or args[0] == "--no-sweep":
            debug(f"invalid flag or missing value for {flag!r}", "run gstack-extend-telemetry --help")
            return
        values[flag] = args.pop(0)
    skill = values.get("--skill", "")
    if not re.fullmatch(r"extend:[a-z0-9-]+", skill):
        debug("invalid --skill (expected extend:<kebab-name>)", 'pass --skill "extend:roadmap"')
        return
    state_root = Path(os.environ.get("GSTACK_EXTEND_STATE_DIR") or Path.home() / ".gstack-extend")
    provenance = provenance_enabled(state_root)
    # Two independent outputs: gstack's tier gates skill-usage rows (which gstack may upload); the provenance switch
    # gates the local-only stage-runs row. Either one needs the start/finish handoff.
    logger = usage_logger()
    retry_usage = logger == "retry"
    if retry_usage:
        logger = None
    if not logger and not provenance and not retry_usage:
        return
    ledger = state_root / "analytics/stage-runs.jsonl"
    trace(f"provenance={'on sink=' + str(ledger) if provenance else 'off'}")
    root = capture(["git", "rev-parse", "--show-toplevel"])
    # Outside git use cwd for isolation, while the row honestly says repo:unknown.
    key = hashlib.sha256(json.dumps([root or str(Path.cwd()), skill]).encode()).hexdigest()
    state_file = state_root / "telemetry" / (key + ".json")
    # One lock per repository+skill so a finish cannot append twice or replace a newer start.
    try:
        lock_dir = state_root / "telemetry-locks"
        lock_dir.mkdir(parents=True, exist_ok=True)
        held_lock = os.open(lock_dir / (key + ".lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        fcntl.flock(held_lock, fcntl.LOCK_EX)
    except OSError as error:
        debug(f"state handoff unwritable at {state_file}: {error.strerror}",
              "repair GSTACK_EXTEND_STATE_DIR permissions")
        # An explicit finish can still record skill-usage. The gstack sink is not this state directory.
        if command != "start" and logger:
            explicit = values.get("--session-id")
            explicit_start = integer(values.get("--start"))
            explicit_duration = integer(values.get("--duration")) if legacy else None
            if valid_session(explicit) and (explicit_start is not None or explicit_duration is not None):
                if explicit_start is not None:
                    explicit_duration = max(0, int(time.time()) - explicit_start)
                delegate(logger, skill, explicit, explicit_duration, values)
        return
    state = read_json(state_file)
    if command == "start":
        now = int(time.time())
        sid = f"extend-{uuid.uuid4()}"
        row = dict(v=1, event_type="skill_start", skill=skill, session_id=sid,
                   ts=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   repo=Path(root).name if root else "unknown", source="gstack-extend")
        # Provenance still needs the handoff when the skill-usage append fails. Finish must not then
        # invent a skill_run for a start that never landed.
        wrote_usage = bool(logger and append_row(sink_path(), row, "sink"))
        if not wrote_usage and not provenance:
            return
        try:
            save_state(state_file, dict(session_id=sid, start=str(now), usage=wrote_usage))
        except OSError as error:
            debug(f"state handoff unwritable at {state_file}: {error.strerror}",
                  "repair GSTACK_EXTEND_STATE_DIR permissions or supply explicit --start and --session-id")
        print(f"GE_TELEMETRY: session={sid} start={now}")
        return
    sid = values.get("--session-id")
    if not valid_session(sid):
        sid = state.get("session_id")
    start = integer(values.get("--start"))
    duration = integer(values.get("--duration")) if legacy else None
    # A valid legacy duration already supplies the time half of the handoff.
    if start is None and duration is None and state.get("session_id") == sid:
        # Only the handoff of the SAME session may supply the start; another session's would misdate this one.
        start = integer(state.get("start"))
    if not valid_session(sid) or (start is None and duration is None):
        debug("missing or malformed start/session state",
              "run telemetry start first, or supply valid --start and --session-id")
        return
    if start is not None:
        # Session wall-clock including human wait time, NOT model/token spend.
        # Upstream nulls durations above 86400 seconds.
        duration = max(0, int(time.time()) - start)
    # The handoff records which outputs a partial finish already wrote, so a retry never duplicates either row.
    done = state.get("done") if state.get("session_id") == sid and isinstance(state.get("done"), list) else []
    done = [output for output in done if output in ("provenance", "usage")]
    # Handoffs from before the usage flag still complete. A false flag means the start append never landed.
    usage_ok = state.get("usage") if state.get("session_id") == sid and "usage" in state else True
    saved = state.get("row") if state.get("session_id") == sid and isinstance(state.get("row"), dict) else None
    if provenance and "provenance" not in done:
        # Reuse the first attempt's row so a retry does not re-detect the model or stretch duration_s.
        row = saved or provenance_row(skill.removeprefix("extend:"), sid, start, duration, values, root)
        trace(f"provenance agent={row['agent']} model={row['model']} effort={row['effort']}")
        if append_row(ledger, row, "provenance sink"):
            done.append("provenance")
            saved = None
        else:
            saved = row
    if logger and usage_ok and "usage" not in done and delegate(logger, skill, sid, duration, values):
        done.append("usage")
    # Consume only the matching handoff, preserving a later same-skill start.
    # Explicit retries can still supply their original session/start pair.
    current = read_json(state_file)
    if current.get("session_id") != sid:
        return
    try:
        # A transient gstack-config failure is not "usage is off". Keep the handoff so a retry can delegate.
        usage_done = not (retry_usage and usage_ok) and ((not logger) or (not usage_ok) or ("usage" in done))
        if (not provenance or "provenance" in done) and usage_done and not saved:
            state_file.unlink()
        elif done or saved:
            payload = dict(current, done=done)
            if saved:
                payload["row"] = saved
            else:
                payload.pop("row", None)
            save_state(state_file, payload)
    except OSError as error:
        debug(f"could not update the handoff: {error}", "repair GSTACK_EXTEND_STATE_DIR permissions")


if __name__ == "__main__":
    if sys.version_info[:2] < (3, 9):
        # str.removesuffix needs 3.9; without this every call would die in the boundary below with no explanation.
        debug("python3 older than 3.9", "install python3 3.9 or newer")
        sys.exit(0)
    try:
        main(sys.argv[1:])
    except Exception as error:
        # Intentional boundary: optional telemetry cannot change a skill's status.
        debug(f"{type(error).__name__}: {error}", "run gstack-extend doctor telemetry")
