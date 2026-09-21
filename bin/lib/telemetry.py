"""Optional local telemetry helpers.

The guarded shell entrypoint runs this module as __main__. The doctor report
imports capture, resolve, sink_path, and the wrapper checks so both CLIs share
one sink ladder and one compatibility rule.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone

INT64_MAX = 2**63 - 1  # the logger stores durations as 64-bit integers
INT64_DIGITS = len(str(INT64_MAX))
CONFIG_TIMEOUT_S = 10  # git and gstack-config lookups
LOGGER_TIMEOUT_S = 15  # the delegated completion logger
# The skill blocks in skills/*.md grep the wrapper for this exact text (also a comment in bin/gstack-extend-telemetry).
# Bump it with any incompatible change to the start/finish call shape so older/newer pairs fail closed.
PROTOCOL_MARKER = b"telemetry-protocol: start-finish-v1"


def debug(problem, fix):
    if os.environ.get("GSTACK_EXTEND_TELEMETRY_DEBUG") == "1":
        print(f"telemetry skipped: {problem}. Fix: {fix}. See docs/telemetry.md.", file=sys.stderr)


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


def executable(path):
    # Absolute only: a relative PATH or GSTACK_DIR entry (e.g. node_modules/.bin) must never
    # resolve to a file planted in the current repository.
    return bool(path) and os.path.isabs(path) and os.path.isfile(path) and os.access(path, os.X_OK)


def resolve(name):
    candidates = [shutil.which(name)]
    if os.environ.get("GSTACK_DIR"):
        candidates.append(str(Path(os.environ["GSTACK_DIR"]) / "bin" / name))
    candidates.append(str(Path.home() / ".claude/skills/gstack/bin" / name))
    return next((p for p in candidates if executable(p)), None)


def compatible_wrapper(path):
    # An older wrapper forwards the unknown positional `start` to the logger and writes a garbage completion row,
    # so a wrapper without the protocol marker is treated as absent.
    try:
        return executable(path) and PROTOCOL_MARKER in Path(path).read_bytes()
    except OSError:
        return False


def supports_no_sweep(logger):
    # gstack before 1.80.0.0 ignores --no-sweep and still finalizes other sessions' in-flight markers.
    try:
        return b"--no-sweep" in Path(logger).read_bytes()
    except OSError:
        return False


def sink_path():
    # gstack-telemetry-log honors STATE_DIR only. HOME/STATE_ROOT affect config.
    return Path(os.environ.get("GSTACK_STATE_DIR") or Path.home() / ".gstack") / "analytics/skill-usage.jsonl"


def capture(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            text=True, timeout=CONFIG_TIMEOUT_S)
    return result.stdout.removesuffix("\n") if result.returncode == 0 else ""


def read_state(path):
    try:
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


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


def main(args):
    if args and args[0] in ("-h", "--help"):
        print('Usage: gstack-extend-telemetry start|finish --skill "extend:<name>"')
        print("  finish: [--start EPOCH] [--session-id ID] [--outcome success|error|abort|unknown]")
        print("  finish also forwards: [--used-browse true|false] [--error-class CLASS] [--error-message TEXT] [--failed-step STEP]")
        print("  Missing/malformed start and session values fall back to the repository + skill handoff.")
        print("  Bare flags retain legacy finish compatibility (--duration SECONDS).")
        print("  GSTACK_EXTEND_TELEMETRY_DEBUG=1 explains skips. See docs/telemetry.md.")
        return
    legacy = not args or args[0] not in ("start", "finish")
    command = args.pop(0) if not legacy else "finish"
    values = {}
    # --source and --event-type are accepted but never forwarded, so callers cannot override them;
    # --duration counts only for legacy finish calls.
    flags = {"--skill", "--start", "--session-id", "--duration", "--outcome",
             "--used-browse", "--error-class", "--error-message", "--failed-step",
             "--event-type", "--source"}
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
    logger, config = resolve("gstack-telemetry-log"), resolve("gstack-config")
    if not logger or not config:
        debug("gstack absent or gstack-config unavailable", "run setup in your gstack checkout")
        return
    tier = capture([config, "get", "telemetry"]).strip()
    if tier not in ("anonymous", "community"):
        debug(f"telemetry tier off, missing, or invalid ({tier!r})", "run gstack-config set telemetry community")
        return
    root = capture(["git", "rev-parse", "--show-toplevel"])
    # Outside git use cwd for isolation, while the row honestly says repo:unknown.
    key = hashlib.sha256(json.dumps([root or str(Path.cwd()), skill]).encode()).hexdigest()
    state_root = Path(os.environ.get("GSTACK_EXTEND_STATE_DIR") or Path.home() / ".gstack-extend")
    state_file = state_root / "telemetry" / (key + ".json")
    state = read_state(state_file)
    sink = sink_path()
    if os.environ.get("GSTACK_EXTEND_TELEMETRY_DEBUG") == "1":
        print(f"telemetry: logger={logger} config={config} tier={tier} sink={sink}", file=sys.stderr)
    if command == "start":
        now = int(time.time())
        sid = f"extend-{uuid.uuid4()}"
        row = dict(v=1, event_type="skill_start", skill=skill, session_id=sid,
                   ts=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   repo=Path(root).name if root else "unknown", source="gstack-extend")
        try:
            sink.parent.mkdir(parents=True, exist_ok=True)
            with sink.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(row, ensure_ascii=True, separators=(",", ":")) + "\n")
        except OSError as error:
            debug(f"sink unwritable at {sink}: {error.strerror}", "repair permissions on the telemetry state directory")
            return
        try:
            save_state(state_file, dict(session_id=sid, start=str(now)))
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
    if start is None and duration is None:
        start = integer(state.get("start"))
    if not valid_session(sid) or (start is None and duration is None):
        debug("missing or malformed start/session state",
              "run telemetry start first, or supply valid --start and --session-id")
        return
    if start is not None:
        # Session wall-clock including human wait time, NOT model/token spend.
        # Upstream nulls durations above 86400 seconds.
        duration = max(0, int(time.time()) - start)
    if not supports_no_sweep(logger):
        # Delegating anyway would let an old logger finalize other sessions' markers as phantom rows.
        debug(f"gstack-telemetry-log at {logger} lacks --no-sweep (gstack before 1.80.0.0)", "run gstack-upgrade")
        return
    try:
        sink.parent.mkdir(parents=True, exist_ok=True)
        with sink.open("a", encoding="utf-8"):
            pass
    except OSError as error:
        debug(f"sink unwritable at {sink}: {error.strerror}", "repair permissions on the telemetry state directory")
        return
    delegated =[logger, "--source", "gstack-extend", "--no-sweep", "--skill", skill,
                 "--session-id", sid, "--duration", str(duration)]
    for flag in ("--outcome", "--used-browse", "--error-class", "--error-message", "--failed-step"):
        if flag in values:
            delegated.extend([flag, values[flag]])
    # DEVNULL is load-bearing: upstream backgrounds its network sync with inherited stdio, so capturing
    # the output here would make finish wait on that sync until the timeout.
    result = subprocess.run(delegated, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=LOGGER_TIMEOUT_S)
    if result.returncode:
        debug("gstack-telemetry-log failed", "run gstack-extend doctor telemetry and check your gstack install")
        return
    # Consume only the matching handoff, preserving a later same-skill start.
    # Explicit retries can still supply their original session/start pair.
    if read_state(state_file).get("session_id") == sid:
        try:
            state_file.unlink()
        except OSError as error:
            debug(f"could not clear completed handoff: {error}", "repair GSTACK_EXTEND_STATE_DIR permissions")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as error:
        # Intentional boundary: optional telemetry cannot change a skill's status.
        debug(f"{type(error).__name__}: {error}", "run gstack-extend doctor telemetry")

