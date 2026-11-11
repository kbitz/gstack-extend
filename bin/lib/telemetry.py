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
# bin/lib/telemetry-call.sh, the helper the skill blocks call, greps the wrapper for this exact text (also a comment in bin/gstack-extend-telemetry).
# Bump it with any incompatible change to the start/finish call shape so older/newer pairs fail closed.
PROTOCOL_MARKER = b"telemetry-protocol: start-finish-v1"
MIN_GSTACK_FOR_NO_SWEEP = "1.80.0.0"  # first gstack release whose gstack-telemetry-log honors --no-sweep
HARNESSES = ("claude", "codex", "grok", "cursor")
OUTCOMES = ("success", "error", "abort", "blocked", "unknown")
ROUTE_CLI, ROUTE_SDK, ROUTE_UNKNOWN = "cli", "sdk", "unknown"
ROUTES = (ROUTE_CLI, ROUTE_SDK, ROUTE_UNKNOWN)
# Where a row's agent, model or effort value came from. A null value is always unknown.
SOURCE_FLAG, SOURCE_DETECTED, SOURCE_UNKNOWN = "flag", "detected", "unknown"
SOURCE_REQUESTED = "requested"
SOURCES = (SOURCE_FLAG, SOURCE_DETECTED, SOURCE_UNKNOWN)
# The stage-runs row format in docs/stage-runs.schema.json. Bump it, and add a schema branch, when the row's
# shape or meaning changes; a release alone does not. Unrelated to skill-usage's v and PROTOCOL_MARKER.
SCHEMA_VERSION = 4
WORKSPACE_OWNER_ENV = "GSTACK_EXTEND_WORKSPACE_OWNER"
RUN_MODE_ENV = "GSTACK_EXTEND_RUN_MODE"
RUN_MODES = ("user-directed", "orchestrated", "unknown")
RUN_MODE_SOURCES = (
    "session-kind",
    "work-item",
    "run-mode-env",
    "unrecognized-run-mode-env",
    "launcher-state-root",
    "malformed-signal",
    "host-managed-workspace",
    "cli",
    "paseo-entrypoint",
    "entrypoint-unqualified",
    "entrypoint-unavailable",
    "harness-unqualified",
    "no-harness",
)
USER_SIGNALS_SOURCES = (
    "session-log",
    "orchestrated",
    "no-harness",
    "harness-unsupported",
    "session-log-unavailable",
)
BLOCKED_REASON_SOURCES = ("flag", "not-blocked", "not-supplied", "orchestrated")
BLOCKED_REASON_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
HOST_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
REPORT_MODES = ("orchestrated", "user-directed", "unknown", "unrecorded")
KNOWN_SKILLS = (
    "pair-review",
    "roadmap",
    "project-spec",
    "full-review",
    "gstack-extend-upgrade",
    "gstack-extend-init",
    "review-and-prep",
    "implement",
    "ship-and-land",
    "docs-ship",
    "plan-track",
)
# The installation running this file, resolved so a symlinked bin/ names its real checkout. Never the caller's
# repository, an environment override, or gstack's VERSION.
VERSION_FILE = Path(__file__).resolve().parents[2] / "VERSION"
VERSION_BYTES = 128
RELEASE_RE = re.compile(r"[0-9]+(\.[0-9]+){2,3}")  # ASCII digits only; the schema's producer_version pattern
LOG_TAIL_BYTES = 8 << 20  # a stage's turns sit at the end of its session log; bounds finish latency on huge logs
# Fixed Cursor provenance diagnostics. The text after the hash is an anchor in docs/telemetry.md.
# Debug prints only these tokens: never a store path, id, cwd, exception, or field value.
CURSOR_SDK_REASONS = (
    ("transcript-unreadable", "cursor-sdk-transcript-unreadable"),
)
# Bare skill names. Finish strips the extend: prefix before consulting this set.
RESUMABLE = {"pair-review", "review-and-prep", "full-review"}
ADOPTION_BOUND_S = 86400  # same ceiling upstream uses when it nulls duration_s
REFUSAL_CAP = 10
HANDOFF_NAME_RE = re.compile(r"[0-9a-f]{64}\.json")  # a per-invocation handoff: sha256(session id) + ".json"
MARKER_RETENTION_S = 30 * 86400  # a completion marker outlives its handoff this long, for explicit retries
MARKER_OUTPUTS = ("provenance", "usage")
WORK_ITEM_ENV = "GSTACK_EXTEND_WORK_ITEM"
REQUESTED_MODEL_ENV, REQUESTED_EFFORT_ENV = "GSTACK_EXTEND_MODEL", "GSTACK_EXTEND_EFFORT"
REQUESTED_ENV = (("model", REQUESTED_MODEL_ENV), ("effort", REQUESTED_EFFORT_ENV))
# GROK_SESSION_ID counts only when GROK_AGENT=1, matching detect().
SESSION_MARKERS = ("CLAUDE_CODE_SESSION_ID", "CODEX_THREAD_ID", "CURSOR_CONVERSATION_ID", "GROK_SESSION_ID")
HELPER_FIX = ("install gstack for this host (run ./setup --host <host> in the gstack checkout) "
              "or set GSTACK_DIR to a gstack checkout")


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


def state_root():
    # A relative override is not a state directory: it would land in whatever cwd the skill ran from.
    override = os.environ.get("GSTACK_EXTEND_STATE_DIR")
    if override and os.path.isabs(override):
        return Path(override)
    return Path.home() / ".gstack-extend"


def host_file_name(state=None, nodename=None):
    base = Path(state) if state is not None else state_root()
    try:
        configured = config_value(base, "host_id")
    except OSError:
        configured = None
    if configured is not None:
        if HOST_ID_RE.fullmatch(configured):
            return configured
        trace("ignored invalid host_id config value (expected [a-z0-9][a-z0-9-]{0,62})")
    if nodename is None:
        try:
            nodename = os.uname().nodename
        except OSError:
            nodename = ""
    label = str(nodename).split(".", 1)[0].lower()
    sanitized = re.sub(r"[^a-z0-9]+", "-", label).strip("-")[:63].rstrip("-")
    return sanitized if sanitized and HOST_ID_RE.fullmatch(sanitized) else "unknown-host"


def stage_run_dir(state=None):
    base = Path(state) if state is not None else state_root()
    return base / "analytics/stage-runs"


def stage_run_path(state=None):
    base = Path(state) if state is not None else state_root()
    return stage_run_dir(base) / (host_file_name(base) + ".jsonl")


def stage_run_files(state=None):
    base = Path(state) if state is not None else state_root()
    files = []
    legacy = base / "analytics/stage-runs.jsonl"
    try:
        if not legacy.is_symlink() and legacy.is_file():
            files.append(legacy)
    except OSError:
        pass
    directory = stage_run_dir(base)
    if store_shape(directory) == "ok":
        try:
            names = sorted(os.listdir(directory))
        except OSError:
            names = []
        for name in names:
            if not name.endswith(".jsonl") or name == ".jsonl":
                continue
            entry = directory / name
            try:
                if not entry.is_symlink() and entry.is_file():
                    files.append(entry)
            except OSError:
                continue
    return files


def helper_candidates(name):
    """Deduplicated (label, path) pairs for one gstack helper.

    PATH outranks every home-anchored root. GSTACK_DIR is a fallback location, not an override.
    CLAUDE_CONFIG_DIR and CODEX_HOME count only when absolute. A relative or empty CODEX_HOME drops
    its own candidate; ~/.codex is still searched. Labels are display text: PATH is never expanded.
    """
    pairs, seen = [], set()

    def add(label, path):
        if label == "PATH (absolute entries)":
            key = label
        elif path:
            key = os.path.normpath(str(Path(path).parent))
        else:
            return
        if key in seen:
            return
        seen.add(key)
        pairs.append((label, path))

    add("PATH (absolute entries)", which(name))
    gstack_dir = os.environ.get("GSTACK_DIR")
    if gstack_dir and os.path.isabs(gstack_dir):
        directory = Path(gstack_dir) / "bin"
        add(str(directory), str(directory / name))
    claude_config = os.environ.get("CLAUDE_CONFIG_DIR")
    if claude_config and os.path.isabs(claude_config):
        directory = Path(claude_config) / "skills/gstack/bin"
        add(str(directory), str(directory / name))
    directory = Path.home() / ".claude/skills/gstack/bin"
    add(str(directory), str(directory / name))
    codex_home = os.environ.get("CODEX_HOME")
    if codex_home and os.path.isabs(codex_home):
        directory = Path(codex_home) / "skills/gstack/bin"
        add(str(directory), str(directory / name))
    directory = Path.home() / ".codex/skills/gstack/bin"
    add(str(directory), str(directory / name))
    directory = Path.home() / ".config/opencode/skills/gstack/bin"
    add(str(directory), str(directory / name))
    directory = Path.home() / ".cursor/skills/gstack/bin"
    add(str(directory), str(directory / name))
    return pairs


def resolve(name):
    return next((path for _label, path in helper_candidates(name) if executable(path)), None)


def gstack_helper_problem(resolved=None):
    """The stable 'gstack helper unresolvable:' text when a helper is missing, else None."""
    if resolved is None:
        resolved = {helper: resolve(helper) for helper in ("gstack-telemetry-log", "gstack-config")}
    missing = [helper for helper, path in resolved.items() if not path]
    if not missing:
        return None
    labels = []
    for label, _path in helper_candidates("gstack-telemetry-log"):
        if label not in labels:
            labels.append(label)
    searched = ", ".join(label if label == "PATH (absolute entries)" else quoted_path(label) for label in labels)
    return "gstack helper unresolvable: " + ", ".join(missing) + "; searched " + searched


def gstack_helper_warning(provenance_on, resolved=None):
    problem = gstack_helper_problem(resolved)
    if problem is None:
        return None
    provenance = "provenance rows still record" if provenance_on else "provenance is off, so nothing records"
    return (problem + "; " + provenance + ". Fix: " + HELPER_FIX
            + ". rerun gstack-extend doctor telemetry. See docs/telemetry.md.")


def harness_fingerprint():
    """(hex digest or None, marker names that contributed). Values are hashed and never traced."""
    pairs = []
    for name in SESSION_MARKERS:
        if name == "GROK_SESSION_ID" and os.environ.get("GROK_AGENT") != "1":
            continue
        value = os.environ.get(name)
        if valid_session(value):
            pairs.append([name, value])
    pairs.sort(key=lambda item: item[0])
    if not pairs:
        return None, []
    digest = hashlib.sha256(json.dumps(pairs, separators=(",", ":")).encode()).hexdigest()
    return digest, [item[0] for item in pairs]


def quoted_path(value):
    return json.dumps(value, ensure_ascii=True)


def adoption_problem(reason, slot_root, handoff, candidates):
    return ("missing or malformed start/session state (" + reason
            + "; candidates=" + str(candidates)
            + "; root=" + quoted_path(slot_root)
            + "; handoff=" + quoted_path(str(handoff)) + ")")


def consider_adoption(state, skill, now, current):
    """('adopt', start) or ('malformed', None) or ('refuse', reason).

    Start is validated first. A non-string harness counts as an unknown fingerprint.
    A future start counts as age 0. Resumable skills are not age-bounded.
    """
    if not state:
        return "refuse", "no handoff for this repository root"
    start = integer(state.get("start"))
    if start is None:
        return "malformed", None
    if skill.removeprefix("extend:") in RESUMABLE:
        return "adopt", start
    stored = state.get("harness")
    if not isinstance(stored, str) or not stored:
        stored = None
    if stored is not None and current is not None:
        if stored == current:
            return "adopt", start
        return "refuse", "handoff from another session"
    age = 0 if start > now else now - start
    if age <= ADOPTION_BOUND_S:
        return "adopt", start
    return "refuse", f"handoff too old; age={age}; bound={ADOPTION_BOUND_S}"


def invocation_name(sid):
    return hashlib.sha256(sid.encode()).hexdigest() + ".json"


def sort_key(state):
    """Arrival order of a handoff whose session id is valid. Ordering only: never a duration or an age.

    start is whole epoch seconds, so concurrent starts share it; seq (nanoseconds, monotonic per root+skill) breaks
    the tie. A handoff from before seq existed falls back to its start. A handoff without a valid start sorts last."""
    sid = state["session_id"]
    start = integer(state.get("start"))
    if start is None:
        return 1, 0, sid
    seq = integer(state.get("seq"))
    return 0, seq if seq is not None else start * 1_000_000_000, sid


class Candidate:
    """One open handoff. Every later save, refusal record and unlink acts on path, the file it was read from, so a
    legacy single-slot file is never copied to a per-invocation twin. twin is a legacy file carrying the same session
    id as a per-invocation candidate: excluded from selection, unlinked with the candidate so it cannot return."""

    def __init__(self, state, path, is_legacy, twin=None):
        self.state = state
        self.path = path
        self.is_legacy = is_legacy
        self.twin = twin
        self.sort_key = sort_key(state)
        self.classification = None  # (kind, detail, rank, label) after classify()


def store_shape(directory):
    """'absent', 'ok' for a real directory, or 'bad' for a file, link or anything unreadable in its place."""
    try:
        info = os.lstat(directory)
    except FileNotFoundError:
        return "absent"
    except OSError:
        return "bad"
    return "ok" if stat.S_ISDIR(info.st_mode) else "bad"


def enumerate_candidates(store, legacy_file):
    """(candidates, present, broken) for one root+skill.

    Only <sha256>.json names in the per-key directory count (that excludes save_state's temp files), plus the legacy
    single-slot file. A per-invocation file is authoritative only under the name its own session id hashes to, so a
    copied handoff is malformed-class, like an unreadable or unparseable one. present: some handoff-shaped file
    exists, whether or not it parsed. broken: the per-key path is not a readable directory."""
    shape = store_shape(store)
    names = []
    if shape == "ok":
        try:
            names = sorted(name for name in os.listdir(store) if HANDOFF_NAME_RE.fullmatch(name))
        except OSError:
            shape = "bad"
    if shape == "bad":
        return [], True, True
    candidates = []
    for name in names:
        state = read_json(store / name)
        sid = state.get("session_id")
        if valid_session(sid) and name == invocation_name(sid):
            candidates.append(Candidate(state, store / name, False))
    legacy_present = os.path.lexists(legacy_file)
    legacy = read_json(legacy_file) if legacy_present else {}
    if valid_session(legacy.get("session_id")):
        twin = next((item for item in candidates if item.state["session_id"] == legacy["session_id"]), None)
        if twin:
            twin.twin = legacy_file
        else:
            candidates.append(Candidate(legacy, legacy_file, True))
    return candidates, bool(names) or legacy_present, False


def explicit_candidate(store, legacy_file, sid):
    """The open handoff of exactly this session, or None: the computed per-invocation path first, then the legacy file."""
    candidate = None
    shape = store_shape(store)
    if shape == "bad":
        debug(f"handoff store is not a readable directory at {store}",
              "repair the state directory; per-invocation retry metadata is unavailable, so only legacy state can be used")
    if shape == "ok":
        path = store / invocation_name(sid)
        state = read_json(path)
        if state.get("session_id") == sid:
            candidate = Candidate(state, path, False)
    legacy = read_json(legacy_file) if os.path.lexists(legacy_file) else {}
    if legacy.get("session_id") == sid:
        if candidate:
            candidate.twin = legacy_file
        else:
            candidate = Candidate(legacy, legacy_file, True)
    return candidate


def next_seq(candidates):
    """Arrival stamp for a new start, called under the root+skill lock: wall clock, but never at or below an open
    handoff's, so a stalled or backward clock cannot reorder starts."""
    newest = max((item.sort_key[1] for item in candidates if item.sort_key[0] == 0), default=-1)
    seq = max(time.time_ns(), newest + 1)
    if seq > INT64_MAX:
        raise OSError(errno.ERANGE, "the handoff arrival sequence exceeds the int64 range")
    return seq


def classify(candidate, skill, now, current):
    """Fill candidate.classification with consider_adoption's verdict plus, when adoptable, a pairing rank and label.

    Exact keeps consider_adoption's meaning: a stored non-empty fingerprint equal to a known current one. None is
    never exact, so two unknown fingerprints stay unknown in every class."""
    kind, detail = consider_adoption(candidate.state, skill, now, current)
    rank = label = None
    if kind == "adopt":
        stored = candidate.state.get("harness")
        exact = isinstance(stored, str) and bool(stored) and current is not None and stored == current
        if skill.removeprefix("extend:") in RESUMABLE:
            rank, label = (0, "resumable (exact)") if exact else (1, "resumable (newest)")
        else:
            rank, label = (2, "exact fingerprint") if exact else (3, "unknown fingerprint")
    candidate.classification = (kind, detail, rank, label)


def pick_adoption(candidates):
    """The adoptable candidate that pairs first, or None.

    Order: resumable-exact NEWEST first, resumable-other NEWEST first (each resume starts its own segment, so the
    newest open start is the current one; an older open start may be an interrupted segment, a lost pause finish
    or a pause from an older release, and must not capture it), then exact and unknown-fingerprint candidates oldest first. Ties break on
    arrival (sort_key), never on session id alone."""
    adoptable = [item for item in candidates if item.classification[0] == "adopt"]
    if not adoptable:
        return None
    rank = min(item.classification[2] for item in adoptable)
    tier = [item for item in adoptable if item.classification[2] == rank]
    return (max if rank <= 1 else min)(tier, key=lambda item: item.sort_key)


def adopt_candidate(store, legacy_file, skill, slot_root, current):
    """The handoff a start-less finish adopts, or None after explaining why not (refusals are recorded)."""
    candidates, present, broken = enumerate_candidates(store, legacy_file)
    malformed = ("missing or malformed start/session state",
                 "run telemetry start first, or supply valid --start and --session-id")
    if broken:
        debug(f"handoff store is not a readable directory at {store}",
              "repair the directory shape and permissions, preserving any open handoffs, then finish again")
        return None
    if not present:
        reason = "no handoff for this repository root"
    elif not candidates:
        debug(*malformed)  # files exist but none parses with a valid session: they stay
        return None
    else:
        now, valid = int(time.time()), []
        for item in candidates:
            classify(item, skill, now, current)
            if item.classification[0] != "malformed":
                valid.append(item)
        if not valid:
            debug(*malformed)  # a handoff without a valid start is never adopted and never the refusal target
            return None
        chosen = pick_adoption(valid)
        if chosen:
            trace(f"adopted handoff session={chosen.state['session_id']} pairing={chosen.classification[3]} "
                  f"candidates={len(candidates)} handoff={quoted_path(str(chosen.path))}")
            return chosen
        newest = max(valid, key=lambda item: item.sort_key)
        reason = newest.classification[1]
        remember_refusal(newest.path, newest.state, reason)
    fix = {
        "no handoff for this repository root":
            "start never ran in this root, the handoff was already consumed, or start ran in another root; finish "
            "from the repository root where start ran, or pass --session-id and --start from the "
            "GE_TELEMETRY: session=… start=… line",
        "handoff from another session":
            "finish in the harness session that ran start, or pass --session-id and --start from the "
            "GE_TELEMETRY: session=… start=… line",
    }.get(reason)
    if fix is None and reason.startswith("handoff too old"):
        fix = ("run start again for a new run, or pass --session-id and --start from the "
               "GE_TELEMETRY: session=… start=… line")
    if fix is None:
        debug(*malformed)
    else:
        debug(adoption_problem(reason, slot_root, newest.path if present else store, len(candidates)), fix)
    return None


def remove_handoff(handoff):
    """Unlink a consumed handoff and any legacy duplicate of its session, which could otherwise return as a sole candidate."""
    # Keep authoritative progress until the stale twin is gone, including when unlink fails or this process stops.
    if handoff.twin:
        handoff.twin.unlink(missing_ok=True)
    handoff.path.unlink(missing_ok=True)


def persist_handoff(handoff, done, saved, uncertain):
    """Record retry progress at the handoff's own path, so a crash mid-finish leaves accurate metadata.

    Each save stands alone: a failed one is noted and the finish carries on, so it never skips a delegate."""
    if not handoff:
        return
    payload = dict(handoff.state, done=list(done))
    if saved:
        payload["row"] = saved
    else:
        payload.pop("row", None)
    if uncertain:
        payload["usage_uncertain"] = True
    else:
        payload.pop("usage_uncertain", None)
    try:
        save_state(handoff.path, payload)
        handoff.state = payload
    except OSError as error:
        debug(f"could not update the handoff: {error}", "repair GSTACK_EXTEND_STATE_DIR permissions")


def remember_refusal(state_file, state, reason):
    # A refused handoff stays, with a capped record, so a later finish can still adopt or be diagnosed.
    prior = state.get("refusals")
    entries = [item for item in prior if isinstance(item, dict)] if isinstance(prior, list) else []
    stored = "handoff too old" if isinstance(reason, str) and reason.startswith("handoff too old") else reason
    entries.append({"reason": stored, "at": int(time.time())})
    del entries[:-REFUSAL_CAP]
    payload = dict(state)
    payload["refusals"] = entries
    try:
        save_state(state_file, payload)
    except OSError:
        pass


def work_item_problem(value):
    if not isinstance(value, str):
        return "not a string"
    if not value.strip():
        return "blank"
    if len(value) > 200:
        return "over 200 characters"
    return "contains non-printable characters"


def accepted_work_item(value, source):
    """clean(value), saying why a value that was present but unusable is ignored (debug mode only)."""
    cleaned = clean(value)
    if cleaned is None and value is not None:
        trace(f"ignored {source} work item ({work_item_problem(value)}; expected 1 to 200 printable characters)")
    return cleaned


def requested_value(name):
    """clean(os.environ.get(name)), saying why a value that was present but unusable is ignored (debug mode only)."""
    value = os.environ.get(name)
    cleaned = clean(value)
    if cleaned is None and value is not None:
        trace(f"ignored {name} ({work_item_problem(value)}; expected 1 to 200 printable characters)")
    return cleaned


def resolve_work_item(flag, saved):
    """The launcher's key for this run: a valid --work-item, else the value saved at start, else the finish
    environment's GSTACK_EXTEND_WORK_ITEM, else None. A rejected value counts as absent, so it changes nothing."""
    for value, source in ((flag, "--work-item flag"), (saved, "saved start")):
        cleaned = accepted_work_item(value, source)
        if cleaned is not None:
            return cleaned
    return accepted_work_item(os.environ.get(WORK_ITEM_ENV), "finish environment")


def validate_marker(data, sid, skill, root):
    """True only for a completion marker that describes exactly this finish: a damaged or foreign marker must never
    suppress rows."""
    if not isinstance(data, dict) or data.get("session_id") != sid or data.get("skill") != skill:
        return False
    if data.get("root") != root or integer(data.get("completed_at")) is None:
        return False
    done = data.get("done")
    return isinstance(done, list) and all(item in MARKER_OUTPUTS for item in done)


def read_marker(path, sid, skill, root):
    """The validated marker at path, or None. A marker that exists but does not validate is ignored, with one line."""
    shape = store_shape(path.parent)
    if shape == "bad":
        debug(f"completion marker store is not a readable directory at {path.parent}",
              "repair the state directory; this finish proceeds without a completion marker")
        return None
    if shape != "ok":
        return None
    try:
        os.lstat(path)
    except FileNotFoundError:
        return None
    except OSError:
        debug(f"completion marker store is not a readable directory at {path.parent}",
              "repair the state directory; this finish proceeds without a completion marker")
        return None
    data = read_json(path)
    if validate_marker(data, sid, skill, root):
        return data
    debug(f"completion marker at {path} is malformed or describes another run, so it is ignored",
          "delete the marker file, or leave it; the explicit finish proceeds without it")
    return None


def skip_completed(path, marker, provenance, logger):
    # A valid marker makes an explicit retry a pure no-op, even for an output enabled only after the first finish:
    # the marker holds no row, outcome or work item to complete one truthfully.
    skipped = [name for name, enabled in (("provenance", provenance), ("usage", bool(logger)))
               if enabled and name not in marker["done"]]
    extra = ("; currently enabled but not recorded as done, so not written: " + ", ".join(skipped)) if skipped else ""
    debug(f"this run already finished (completion marker at {path}){extra}",
          "delete the marker file to re-arm an explicit finish for this session")


def prune_markers(directory, now):
    """Delete this key's completion markers older than MARKER_RETENTION_S. Errors are ignored.

    Stat-gated: only a marker whose mtime is near the bound is read in full (completed_at, else mtime, decides). A
    recent mtime with an older completed_at only extends retention. Unreadable evidence keeps the marker."""
    if store_shape(directory) != "ok":
        return
    try:
        names = [name for name in os.listdir(directory) if HANDOFF_NAME_RE.fullmatch(name)]
    except OSError:
        return
    for name in names:
        path = directory / name
        try:
            info = os.lstat(path)
            if not stat.S_ISREG(info.st_mode) or now - info.st_mtime < MARKER_RETENTION_S - 86400:
                continue
            completed = integer(read_json(path).get("completed_at"))
            stamp = completed if completed is not None and completed <= now else info.st_mtime
            if now - stamp > MARKER_RETENTION_S:
                path.unlink()
        except OSError:
            continue


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


def sink_path(logger=None):
    # Use the selected logger's resolver, not a version guess or another install's helper.
    # A stray helper must not opt a legacy logger into modern sink rules.
    logger = logger or resolve("gstack-telemetry-log")
    try:
        modern = bool(logger and b"gstack_state_root_select" in Path(logger).read_bytes())
        if modern:
            bash = which("bash")
            if not bash:
                raise OSError("bash unavailable")
            helper = Path(logger).with_name("gstack-state-root.sh")
            result = subprocess.run(
                [bash, "-c", '. "$1" && gstack_state_root_select && printf "%s" "$_gstack_sr_root"',
                 "gstack-extend", str(helper)],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=CONFIG_TIMEOUT_S)
            if result.returncode != 0 or not result.stdout:
                # Never fall back to a different sink when a modern resolver fails.
                raise OSError("empty or failing state root")
            return Path(os.fsdecode(result.stdout)) / "analytics/skill-usage.jsonl"
    except (OSError, subprocess.SubprocessError):
        # Normalize helper failures for the doctor, without exposing helper output.
        raise OSError("gstack state resolver unavailable; reinstall gstack") from None
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
    except (OSError, ValueError, RecursionError):
        return {}
    return data if isinstance(data, dict) else {}


def producer_version():
    """This installation's release, or None. Only the producer is unknown then: the row still records."""
    try:
        text = read_capped(VERSION_FILE, VERSION_BYTES).decode("utf-8").strip()
    except FileNotFoundError:
        reason = "VERSION is missing"
    except OSError:
        reason = "VERSION is unreadable, oversized, or not a private regular file"
    except UnicodeDecodeError:
        reason = "VERSION is not UTF-8"
    else:
        if RELEASE_RE.fullmatch(text):
            return text
        reason = "VERSION is not a three- or four-part numeric release"
    # Never the file's contents. trace(), not debug(): nothing is skipped.
    trace(f"PRODUCER_VERSION_UNKNOWN: producer_version unknown ({reason}). Fix: restore or upgrade the "
          "gstack-extend installation so its VERSION holds a valid release; only newly constructed rows improve, "
          "saved retries retain their original producer. See docs/telemetry.md#producer-version.")
    return None


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
        # Only the per-host provenance directory must be real. Upstream usage supports
        # an analytics-directory symlink; the destination file itself remains protected.
        if name == "provenance sink" and path.parent.is_symlink():
            debug(f"{name} directory is a symlink at {path.parent}", "remove the symlink and retry")
            return False
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.parent.is_dir() or (name == "provenance sink" and path.parent.is_symlink()):
            debug(f"{name} directory is not a directory at {path.parent}", "remove the non-directory and retry")
            return False
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


def config_value(state_root, key, default=None):
    # The bin/config key=value store (first match wins, like its awk reader). Rows are local-only, so on unless disabled.
    try:
        raw = read_capped(state_root / "config", 1 << 20)
    except FileNotFoundError:
        return default
    except OSError:
        # Missing means default on. A FIFO, symlink, or unreadable file is not evidence the switch is still on.
        raise
    lines = raw.decode("utf-8", "replace").splitlines()
    for line in lines:
        name, separator, value = line.partition("=")
        if separator and name == key:
            return value.strip()
    return default


def config_enabled(state_root, key):
    try:
        return config_value(state_root, key) not in ("false", "off")
    except OSError:
        return False


def provenance_enabled(state_root):
    return config_enabled(state_root, "provenance")


def usage_logger():
    """The completion logger when gstack's tier enables skill-usage rows, else None (explained in debug mode)."""
    logger, config = resolve("gstack-telemetry-log"), resolve("gstack-config")
    problem = gstack_helper_problem({"gstack-telemetry-log": logger, "gstack-config": config})
    if problem:
        debug(problem, HELPER_FIX)
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
    try:
        sink = sink_path(logger)
    except (OSError, subprocess.SubprocessError) as error:
        debug(f"gstack state-root resolver failed ({error})", "reinstall gstack with ./setup or run gstack-upgrade")
        return "retry"
    trace(f"logger={logger} config={config} tier={tier} sink={sink}")
    return logger


def delegate(logger, skill, sid, duration, values):
    """'done', 'failed' or 'uncertain'.

    failed: provably before the logger ran (missing --no-sweep, sink checks, exec never happened). done: exit 0.
    uncertain: the logger may have started, so a row may exist: a timeout, a nonzero exit, any other subprocess error.
    Callers that use the result compare against "done" explicitly: the strings are all truthy."""
    if not supports_no_sweep(logger):
        # Delegating anyway would let an old logger finalize other sessions' markers as phantom rows.
        debug(f"gstack-telemetry-log at {logger} lacks --no-sweep (gstack before {MIN_GSTACK_FOR_NO_SWEEP})",
              "run gstack-upgrade")
        return "failed"
    try:
        sink = sink_path(logger)
    except (OSError, subprocess.SubprocessError) as error:
        debug(f"gstack state-root resolver failed ({error})", "reinstall gstack with ./setup or run gstack-upgrade")
        return "failed"
    try:
        sink.parent.mkdir(parents=True, exist_ok=True)
        # Same private-file rules as the ledger, without writing. A blocking open here holds the repo+skill lock.
        descriptor = os.open(sink, os.O_APPEND | os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        info = os.fstat(descriptor)
        os.close(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            debug(f"sink is not a private regular file at {sink}", "remove the symlink, FIFO, or extra link and retry")
            return "failed"
    except OSError as error:
        debug(f"sink unwritable at {sink}: {error.strerror}", "repair permissions on the telemetry state directory")
        return "failed"
    delegated = [logger, "--source", "gstack-extend", "--no-sweep", "--skill", skill,
                 "--session-id", sid, "--duration", str(duration)]
    for flag in ("--outcome", "--used-browse", "--error-class", "--error-message", "--failed-step"):
        if flag in values:
            delegated.extend([flag, values[flag]])
    try:
        # DEVNULL is load-bearing: upstream backgrounds its network sync with inherited stdio, so capturing
        # the output here would make finish wait on that sync until the timeout.
        # An unset GSTACK_DIR would make a runtime-root logger report its own directory as the checkout.
        # Point it at the real gstack root (the logger's grandparent) unless the caller already set one.
        # The work item is local: the launcher's variable must not reach upstream by inheritance either.
        env = os.environ.copy()
        env.pop(WORK_ITEM_ENV, None)
        env.pop(RUN_MODE_ENV, None)
        if not env.get("GSTACK_DIR"):
            env["GSTACK_DIR"] = str(Path(os.path.realpath(logger)).parent.parent)
        result = subprocess.run(delegated, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                timeout=LOGGER_TIMEOUT_S, env=env)
    except OSError as error:
        # exec never happened (missing or non-executable logger): nothing was written.
        debug(f"gstack-telemetry-log failed ({type(error).__name__}: {error})", "run gstack-extend doctor telemetry")
        return "failed"
    except subprocess.SubprocessError as error:
        # Timeout included: the logger may have appended before it was killed.
        debug(f"gstack-telemetry-log failed ({type(error).__name__}: {error})", "run gstack-extend doctor telemetry")
        return "uncertain"
    if result.returncode:
        debug("gstack-telemetry-log failed", "run gstack-extend doctor telemetry and check your gstack install")
        return "uncertain"
    return "done"


def scan_sink_tail(sink, skill, sid):
    """True when the sink's last LOG_TAIL_BYTES hold a skill_run for this skill and session, False when not, None when
    the sink cannot be read safely.

    delegate's private-file rules (no symlink, regular, one link), a seek-bounded read, and the torn first line dropped:
    not read_capped, which refuses oversized files, and not tail_records, which follows symlinks. A skill_start row
    never matches. A missing sink is empty."""
    try:
        descriptor = os.open(sink, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return False
    except OSError:
        return None
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            return None
        with os.fdopen(descriptor, "rb") as stream:
            descriptor = -1
            stream.seek(max(0, info.st_size - LOG_TAIL_BYTES))
            lines = stream.read(LOG_TAIL_BYTES).split(b"\n")
    except OSError:
        return None
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    for line in lines[1:] if info.st_size > LOG_TAIL_BYTES else lines:
        try:
            record = json.loads(line)
        except (ValueError, RecursionError):
            continue
        if (isinstance(record, dict) and record.get("event_type") == "skill_run"
                and record.get("skill") == skill and record.get("session_id") == sid):
            return True
    return False


def deliver_usage(logger, skill, sid, duration, values, uncertain):
    """(result, uncertain): result is done, failed, uncertain or hold. Hold writes nothing and keeps the flag.

    After an uncertain delegate the row may already exist, so a retry looks in the sink first and delegates only when
    it is absent. A sink that cannot be read or resolved holds: an unverifiable retry must not risk a duplicate."""
    if uncertain:
        try:
            found = scan_sink_tail(sink_path(logger), skill, sid)
        except (OSError, subprocess.SubprocessError) as error:
            debug(f"gstack state-root resolver failed ({error})", "reinstall gstack with ./setup or run gstack-upgrade")
            return "hold", True
        if found is None:
            debug("skill-usage sink is unreadable, so an earlier unconfirmed completion cannot be checked",
                  "repair the sink's permissions or links and finish again; to select another invocation, use its "
                  "--session-id and --start from its GE_TELEMETRY: line (this run still needs the sink check)")
            return "hold", True
        if found:
            return "done", False
    outcome = delegate(logger, skill, sid, duration, values)
    if outcome == "done":
        return "done", False
    return outcome, uncertain or outcome == "uncertain"


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
    if path.is_symlink() or not path.is_file():
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


def claude_logs(session_id, config_dir=None):
    if not isinstance(session_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,128}", session_id):
        return []
    root = Path(config_dir or os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    found = []
    for path in (root / "projects").glob(f"*/{session_id}.jsonl"):
        try:
            if not path.is_symlink() and path.is_file():
                found.append(path)
        except OSError:
            continue
    return found


def _is_human_prompt(record, message):
    if record.get("isMeta") is True:
        return False
    content = message.get("content")
    if isinstance(content, str):
        return bool(content.strip())
    if isinstance(content, list) and content:
        has_nonblank = False
        for item in content:
            if not isinstance(item, dict) or item.get("type") not in ("text", "image"):
                return False
            if item.get("type") == "image":
                has_nonblank = True
            elif isinstance(item.get("text"), str) and item["text"].strip():
                has_nonblank = True
        return has_nonblank
    return False


def claude_user_signals(session_id, begin, end):
    """Aggregate (questions, wait_s, resumes) from the Claude transcript in [begin, end], or None.

    Only aggregate non-negative integer counts and seconds are returned; prompt text, question text and answers
    are never stored or traced.
    """
    if not isinstance(session_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,128}", session_id):
        return None
    try:
        log = newest(claude_logs(session_id))
        if log is None or log.is_symlink() or not log.is_file():
            return None
        size = log.stat().st_size
        records = list(tail_records(log))
    except OSError:
        return None
    if size > LOG_TAIL_BYTES:
        first_ts = next((parse_ts(r.get("timestamp")) for r in records if parse_ts(r.get("timestamp")) is not None), None)
        if first_ts is None or first_ts > begin:
            return None
    questions = 0
    total_wait = 0.0
    resumes = 0
    saw_window_assistant = False
    ask_times = {}
    answered_asks = set()
    seen_pos_asks = set()
    prev_type = None
    prev_stop_reason = None
    prev_ts = None
    for record_idx, record in enumerate(records):
        if record.get("isSidechain") is True:
            continue
        rtype = record.get("type")
        if rtype not in ("user", "assistant"):
            continue
        ts = parse_ts(record.get("timestamp"))
        if ts is None or ts > end:
            continue
        message = record.get("message")
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if ts >= begin:
            if rtype == "assistant":
                saw_window_assistant = True
                if isinstance(content, list):
                    for block_idx, block in enumerate(content):
                        if not isinstance(block, dict) or block.get("type") != "tool_use" or block.get("name") != "AskUserQuestion":
                            continue
                        block_id = block.get("id") if isinstance(block.get("id"), str) and block.get("id") else None
                        if block_id is not None:
                            if block_id not in ask_times:
                                ask_times[block_id] = ts
                                questions += 1
                        else:
                            position = (record_idx, block_idx)
                            if position not in seen_pos_asks:
                                seen_pos_asks.add(position)
                                questions += 1
            elif rtype == "user":
                if isinstance(content, list):
                    for item in content:
                        if not isinstance(item, dict) or item.get("type") != "tool_result":
                            continue
                        tuid = item.get("tool_use_id")
                        if isinstance(tuid, str) and tuid in ask_times and tuid not in answered_asks:
                            answered_asks.add(tuid)
                            total_wait += max(0.0, ts - ask_times[tuid])
                if _is_human_prompt(record, message) and prev_type == "assistant" and prev_stop_reason == "end_turn" and prev_ts is not None:
                    resumes += 1
                    total_wait += max(0.0, ts - max(prev_ts, float(begin)))
        prev_type = rtype
        prev_stop_reason = message.get("stop_reason") if rtype == "assistant" else None
        prev_ts = ts
    if not saw_window_assistant:
        return None
    return questions, max(0, int(round(total_wait))), resumes


def codex_logs(thread_id, codex_home=None):
    if not isinstance(thread_id, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,128}", thread_id):
        return []
    root = Path(codex_home or os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    return list((root / "sessions").glob(f"*/*/*/rollout-*-{thread_id}.jsonl"))


def claude_turns(session_id):
    # ~/.claude/projects/<cwd slug>/<session id>.jsonl records the model and effort each API response actually used.
    if not re.fullmatch(r"[A-Za-z0-9-]{1,128}", session_id):
        return []
    log = newest(claude_logs(session_id))
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
    # Dated ~/.codex/sessions rollouts open every turn with its model and effort.
    if not re.fullmatch(r"[A-Za-z0-9-]{1,128}", thread_id):
        return []
    log = newest(codex_logs(thread_id))
    turns = []
    for record in tail_records(log) if log else ():
        payload, ts = record.get("payload"), parse_ts(record.get("timestamp"))
        if record.get("type") == "turn_context" and isinstance(payload, dict) and ts is not None and clean(payload.get("model")):
            turns.append((ts, payload["model"], clean(payload.get("effort"))))
    return turns


def grok_logs(root, cwd=None, grok_home=None, session_id=None):
    sessions = Path(grok_home or os.environ.get("GROK_HOME") or Path.home() / ".grok") / "sessions"
    places = {quote(cwd or os.getcwd(), safe="")} | ({quote(root, safe="")} if root else set())
    named = session_id if session_id is not None else os.environ.get("GROK_SESSION_ID", "")
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


def process_argv0(pid):
    """Read only argv[0]; never format or return the argument vector."""
    try:
        if sys.platform == "darwin":
            import ctypes
            libc = ctypes.CDLL(None, use_errno=True)
            mib = (ctypes.c_int * 3)(1, 49, pid)  # CTL_KERN, KERN_PROCARGS2
            size = ctypes.c_size_t(1 << 20)
            buffer = ctypes.create_string_buffer(size.value)
            if libc.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0) != 0:
                return None
            # argc, executable path, padding, argv[0]. Discard everything else.
            data = buffer.raw[4:size.value]
            _, _, data = data.partition(b"\0")
            return os.fsdecode(data.lstrip(b"\0").split(b"\0", 1)[0])
        with open(f"/proc/{pid}/cmdline", "rb") as stream:
            return os.fsdecode(stream.read(4096).split(b"\0", 1)[0])
    except (OSError, ValueError):
        return None


def harness_ancestor(candidates, table=None, pid=None):
    """Nearest marked harness; injectable table contains (ppid, argv0, comm)."""
    names = {"claude": "claude", "codex": "codex", "cursor-agent": "cursor", "agent": "cursor", "grok": "grok"}
    if table is None:
        ps = which("ps")
        if not ps:
            return None
        try:
            result = subprocess.run([ps, "-A", "-o", "pid=,ppid=,comm="], stdout=subprocess.PIPE,
                                    stderr=subprocess.DEVNULL, timeout=1)
            table = {}
            for line in result.stdout.splitlines():
                parts = line.split(None, 2)
                if len(parts) == 3:
                    table[int(parts[0])] = (int(parts[1]), None, os.fsdecode(parts[2]))
        except (OSError, ValueError, subprocess.SubprocessError):
            return None
    current, seen = pid or os.getppid(), set()
    while current in table and current not in seen:
        seen.add(current)
        parent, arg0, comm = table[current]
        arg0 = arg0 if arg0 is not None else process_argv0(current)
        for name in (arg0, comm):
            agent = names.get(Path(name).name) if name else None
            if agent in candidates:
                return agent
        current = parent
    return None


def cursor_logs(session_id, projects=None):
    if not valid_session(session_id):
        return []
    root = Path(projects or Path.home() / ".cursor/projects")
    return list(root.glob(f"*/agent-transcripts/{session_id}.jsonl")) + list(root.glob(f"*/agent-transcripts/{session_id}/*.jsonl")) + list(root.glob(f"*/agent-transcripts/{session_id}/*.txt"))


def _cursor_debug(reasons):
    for code, anchor in CURSOR_SDK_REASONS:
        if code in reasons:
            trace(f"cursor-sdk {code}. See docs/telemetry.md#{anchor}.")


def cursor_turns(root, begin):
    log = newest(cursor_logs(os.environ.get("CURSOR_CONVERSATION_ID")))
    return [(log.stat().st_mtime, None, None)] if log else []


def route_for(agent):
    entry = os.environ.get("CLAUDE_CODE_ENTRYPOINT", "") if agent == "claude" else os.environ.get("CURSOR_INVOKED_AS", "") if agent == "cursor" else ""
    if agent == "claude" and entry.startswith("sdk-"):
        route = ROUTE_SDK
    elif entry or (agent == "codex" and (os.environ.get("CLAUDECODE") or os.environ.get("CURSOR_AGENT") or os.environ.get("GROK_AGENT"))) or (agent == "claude" and (os.environ.get("CURSOR_AGENT") or os.environ.get("CODEX_THREAD_ID"))) or (agent == "cursor" and (os.environ.get("CLAUDECODE") or os.environ.get("CODEX_THREAD_ID"))):
        route = ROUTE_CLI
    else:
        route = ROUTE_UNKNOWN
    return route, clean(entry)


def _trace_detection_error(agent, error):
    # A Cursor reader failure comes from its transcript fallback and gets a fixed reason without the exception text.
    # Other harnesses keep the existing exception text.
    if agent == "cursor":
        _cursor_debug(["transcript-unreadable"])
        return
    trace(f"provenance detection failed ({type(error).__name__}: {error})")


def detect(begin, end, root):
    """(agent, model, effort) for the harness running this command, from its own session log; None when unverifiable."""
    readers = []
    if os.environ.get("CURSOR_AGENT") or os.environ.get("CURSOR_CONVERSATION_ID"):
        readers.append(("cursor", True, lambda: cursor_turns(root, begin)))
    if os.environ.get("CODEX_THREAD_ID"):
        readers.append(("codex", True, lambda: codex_turns(os.environ["CODEX_THREAD_ID"])))
    if os.environ.get("GROK_AGENT") == "1":  # Grok's shell forces this; a user-set profile name is not a marker
        readers.append(("grok", True, lambda: grok_turns(root, begin)))
    if os.environ.get("CLAUDECODE") == "1" or os.environ.get("CLAUDE_CODE_SESSION_ID"):
        readers.append(("claude", False, lambda: claude_turns(os.environ.get("CLAUDE_CODE_SESSION_ID", ""))))
    nearest = harness_ancestor({agent for agent, _, _ in readers}) if len(readers) > 1 else None
    if nearest:
        readers = [reader for reader in readers if reader[0] == nearest]

    def turns(read):
        return sorted((turn for turn in read() if turn[0] <= end), key=lambda turn: turn[0])

    found = []
    for agent, carry, read in readers:
        # One unreadable log must not wipe a sibling harness that did parse.
        try:
            logged = turns(read)
        except Exception as error:
            _trace_detection_error(agent, error)
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
        _trace_detection_error(readers[0][0] if len(readers) == 1 else None, error)
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


def workspace_host():
    """Explicit inherited launch context at first row construction, independently of harness/route."""
    value = os.environ.get(WORKSPACE_OWNER_ENV)
    if not value:
        return None
    label = clean(value)
    if label is None:
        trace(f"HOST_LABEL_INVALID: {WORKSPACE_OWNER_ENV} is not a valid host label (expected 1–200 printable Unicode "
              "code points and not blank); recording workspace_host=null. Saved replay cannot repair attribution. Fix: "
              "set GSTACK_EXTEND_WORKSPACE_OWNER to a clean label on the next new invocation; never invent a label or "
              "rewrite this row. See docs/telemetry.md#host-attribution.")
    return label


def run_mode(detected_agent="claude", agent="claude", saved_work_item=None):
    """Return (run_mode, run_mode_source) from consumer-neutral launcher signals and interactive entrypoints."""
    session_kind = os.environ.get("GSTACK_SESSION_KIND")
    if session_kind in ("spawned", "unattended"):
        return "orchestrated", "session-kind"
    finish_env_work_item = os.environ.get(WORK_ITEM_ENV)
    accepted_item = clean(saved_work_item)
    if accepted_item is None and finish_env_work_item not in (None, ""):
        accepted_item = clean(finish_env_work_item)
    if accepted_item is not None:
        return "orchestrated", "work-item"
    raw_run_mode = os.environ.get(RUN_MODE_ENV)
    if raw_run_mode == "orchestrated":
        return "orchestrated", "run-mode-env"
    if raw_run_mode not in (None, ""):
        trace(f"ignored {RUN_MODE_ENV} (unrecognized value; expected 'orchestrated'). See docs/telemetry.md#run-mode.")
        return "unknown", "unrecognized-run-mode-env"
    gstack_home = os.environ.get("GSTACK_HOME")
    home = os.environ.get("HOME") or str(Path.home())
    if (
        isinstance(gstack_home, str)
        and gstack_home.strip()
        and os.path.isabs(gstack_home)
        and isinstance(home, str)
        and os.path.isabs(home)
        and os.path.normpath(gstack_home) != os.path.normpath(os.path.join(home, ".gstack"))
    ):
        return "unknown", "launcher-state-root"
    raw_owner = os.environ.get(WORKSPACE_OWNER_ENV)
    if (
        session_kind not in (None, "")
        or finish_env_work_item not in (None, "")
        or saved_work_item is not None
        or (gstack_home is not None and gstack_home != "" and not os.path.isabs(gstack_home))
    ):
        return "unknown", "malformed-signal"
    if raw_owner not in (None, ""):
        return "unknown", "host-managed-workspace"
    if detected_agent is None:
        return "unknown", "no-harness"
    if detected_agent != "claude" or agent != "claude":
        return "unknown", "harness-unqualified"
    raw_entrypoint = os.environ.get("CLAUDE_CODE_ENTRYPOINT")
    entry = clean(raw_entrypoint)
    if entry is None or raw_entrypoint != entry:
        return "unknown", "entrypoint-unavailable"
    if entry == "cli":
        return "user-directed", "cli"
    if entry == "Paseo":
        return "user-directed", "paseo-entrypoint"
    return "unknown", "entrypoint-unqualified"


def resolve_blocked_reason(raw_reason, outcome, mode):
    if mode == "orchestrated":
        if raw_reason is not None:
            trace("ignored --blocked-reason flag (run_mode is orchestrated)")
        return None, "orchestrated"
    if outcome != "blocked":
        if raw_reason is not None:
            trace("ignored --blocked-reason flag (outcome is not blocked; expected --outcome blocked)")
        return None, "not-blocked"
    if isinstance(raw_reason, str) and BLOCKED_REASON_RE.fullmatch(raw_reason):
        return raw_reason, "flag"
    if raw_reason is not None:
        trace("ignored --blocked-reason flag (invalid token; expected [a-z0-9][a-z0-9-]{0,63})")
    return None, "not-supplied"


def provenance_row(stage, sid, start, duration, values, root, work_item=None, observed=None, saved_work_item=None):
    now = time.time()
    begin = start if start is not None else int(now) - duration
    agent, model, effort = detect(begin, now, root)
    detected_agent = agent
    if isinstance(observed, dict):
        observed.update(begin=begin, end=now, agent=detected_agent)
    # A source labels the value finally written, so a rejected flag leaves the detected value's source in place.
    flagged = set()
    explicit = values.get("--agent")
    if explicit in HARNESSES:
        if explicit != agent:
            model = effort = None  # detected values describe a different harness
        agent = explicit
        flagged.add("agent")
    elif explicit is not None:
        trace(f"ignored invalid --agent {explicit!r} (expected claude, codex, cursor or grok)")
    model_flag, effort_flag = clean(values.get("--model")), clean(values.get("--effort"))
    if model_flag is not None:
        model = model_flag
        flagged.add("model")
    if effort_flag is not None:
        effort = effort_flag
        flagged.add("effort")
    requested = set()
    if model is None:
        model = requested_value(REQUESTED_MODEL_ENV)
        if model is not None:
            requested.add("model")
    if effort is None:
        effort = requested_value(REQUESTED_EFFORT_ENV)
        if effort is not None:
            requested.add("effort")

    def source(field, value):
        return (SOURCE_UNKNOWN if value is None else SOURCE_FLAG if field in flagged
                else SOURCE_REQUESTED if field in requested else SOURCE_DETECTED)

    repo = branch = None
    if root:
        try:
            repo = repo_slug(capture(["git", "config", "--get", "remote.origin.url"])) or Path(root).name
            branch = clean(capture(["git", "symbolic-ref", "--quiet", "--short", "HEAD"]))
        except (OSError, subprocess.SubprocessError):
            # A stuck git must not skip the skill-usage completion that follows this row.
            repo = branch = None
    raw_outcome = values.get("--outcome")
    resolved_outcome = raw_outcome if raw_outcome in OUTCOMES else "unknown"
    route, entrypoint = route_for(agent)
    # Field order is part of the published contract (docs/stage-runs.schema.json): new fields append after the existing
    # ones. rung is always 0 for a hand-run skill (no fallback chain).
    host = workspace_host()
    finish_env_item = os.environ.get(WORK_ITEM_ENV)
    saved_for_mode = saved_work_item if saved_work_item is not None else (
        work_item if "--work-item" not in values and finish_env_item in (None, "") else None
    )
    resolved_work_item = (
        work_item
        if work_item is not None
        else clean(values.get("--work-item"))
        if "--work-item" in values
        else clean(finish_env_item)
    )
    mode, mode_source = run_mode(detected_agent, agent, saved_for_mode)
    signal_end = now if begin <= now < begin + max(0, duration) + 1 else begin + max(0, duration)
    if mode == "orchestrated":
        questions, user_wait_s, resumes, signals_source = None, None, None, "orchestrated"
    elif agent is None:
        questions, user_wait_s, resumes, signals_source = None, None, None, "no-harness"
    elif agent != "claude" or (detected_agent is not None and detected_agent != "claude"):
        questions, user_wait_s, resumes, signals_source = None, None, None, "harness-unsupported"
    else:
        try:
            signals = claude_user_signals(os.environ.get("CLAUDE_CODE_SESSION_ID", ""), begin, signal_end)
        except Exception:
            signals = None
        if signals is None:
            questions, user_wait_s, resumes, signals_source = None, None, None, "session-log-unavailable"
        else:
            questions, user_wait_s, resumes = signals
            signals_source = "session-log"
    blocked_reason, blocked_reason_source = resolve_blocked_reason(
        values.get("--blocked-reason"), resolved_outcome, mode
    )
    return dict(stage=stage, agent=agent, model=model, effort=effort, rung=0,
                outcome=resolved_outcome, started_at=iso(begin), duration_s=duration,
                session_id=sid, repo=repo, branch=branch,
                work_item=resolved_work_item,
                source="gstack-extend", route=route, entrypoint_raw=entrypoint,
                schema_version=SCHEMA_VERSION, producer_version=producer_version(),
                agent_source=source("agent", agent), model_source=source("model", model),
                effort_source=source("effort", effort), workspace_host=host,
                run_mode=mode, run_mode_source=mode_source,
                questions=questions, user_wait_s=user_wait_s, resumes=resumes,
                user_signals_source=signals_source,
                blocked_reason=blocked_reason, blocked_reason_source=blocked_reason_source)


def _load_workflow_metrics():
    import importlib.util
    target = Path(__file__).resolve().parent / "workflow_metrics.py"
    spec = importlib.util.spec_from_file_location("workflow_metrics", target)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _metrics_dispatch(args):
    """Track 24A: route `metrics ...` to the installation-adjacent workflow_metrics.py.

    Runs before legacy flag parsing, logger resolution, model detection and the blocking
    handoff lock, and loads only by a path derived from this file (never cwd/PYTHONPATH),
    so it works under the launcher's `python3 -I`. A failed load or a crash with no
    envelope means capture is unavailable; metrics never change a workflow outcome."""
    try:
        _load_workflow_metrics().main(args)
    except Exception:
        # Fixed text only: no exception, path or input reaches the caller. Callers that
        # need capture state treat a missing/invalid envelope as unavailable, never success.
        print('{"v":1,"status":"unavailable","reason":"io-error","session_id":null,'
              '"event_id":null,"data":null,"diagnostics":null}')
        if sys.stderr is not None:  # print(file=None) would add this line to stdout
            try:
                print("workflow-metrics: unavailable (io-error). See docs/telemetry.md#workflow-metrics-io-error.",
                      file=sys.stderr)
            except OSError:
                pass


def _empty_cell():
    return {
        "runs": 0,
        "outcomes": {outcome: 0 for outcome in OUTCOMES},
        "last_seen": None,
        "_last_ts": None,
    }


def _discover_installed_skills():
    skills_dir = Path(__file__).resolve().parents[2] / "skills"
    if store_shape(skills_dir) != "ok":
        return None
    try:
        stems = {
            name[:-3]
            for name in os.listdir(skills_dir)
            if name.endswith(".md") and not (skills_dir / name).is_symlink() and (skills_dir / name).is_file()
        }
    except OSError:
        return None
    ordered = [s for s in KNOWN_SKILLS if s in stems]
    ordered.extend(sorted(stems - set(ordered)))
    return ordered


def _host_label_for(base, path):
    if path == base / "analytics/stage-runs.jsonl":
        return "(legacy)"
    prefix = path.name.split(".", 1)[0]
    return prefix if HOST_ID_RE.fullmatch(prefix) else "(unattributed)"


def run_report(args):
    """Print the skill-by-mode stage-runs table across the legacy and per-host files."""
    report_usage = "gstack-extend-telemetry report [--json] [--by-host] [--state-dir DIR]..."
    if args in (["-h"], ["--help"]):
        print(f"Usage: {report_usage}")
        return 0
    as_json = False
    by_host = False
    state_dirs = []
    idx = 0
    invalid_args = False
    while idx < len(args):
        arg = args[idx]
        if arg == "--json":
            if as_json:
                invalid_args = True
                break
            as_json = True
            idx += 1
        elif arg == "--by-host":
            if by_host:
                invalid_args = True
                break
            by_host = True
            idx += 1
        elif arg == "--state-dir":
            if idx + 1 >= len(args) or not args[idx + 1] or not os.path.isabs(args[idx + 1]):
                invalid_args = True
                break
            state_dirs.append(Path(args[idx + 1]))
            idx += 2
        else:
            invalid_args = True
            break
    if invalid_args:
        print(f"telemetry report: invalid arguments; use '{report_usage}'", file=sys.stderr)
        return 0
    roots = state_dirs if state_dirs else [state_root()]
    unreadable_count = 0
    candidate_files = []
    for root_idx, base in enumerate(roots):
        readable_files = stage_run_files(base)
        readable_set = set(readable_files)
        legacy = base / "analytics/stage-runs.jsonl"
        if os.path.lexists(legacy) and legacy not in readable_set:
            unreadable_count += 1
        directory = stage_run_dir(base)
        dir_shape = store_shape(directory)
        if dir_shape == "bad":
            unreadable_count += 1
        elif dir_shape == "ok":
            try:
                entries = sorted(os.listdir(directory))
            except OSError:
                entries = []
                unreadable_count += 1
            for name in entries:
                if name.endswith(".jsonl") and name != ".jsonl" and directory / name not in readable_set:
                    unreadable_count += 1
        for path in readable_files:
            candidate_files.append((root_idx, base, path))
    installed_skills = _discover_installed_skills()
    installed_set = set(installed_skills or ())
    stage_cells = {
        skill: {mode: _empty_cell() for mode in REPORT_MODES}
        for skill in (installed_skills or ())
    }
    host_cells = {}
    label_roots = {}
    seen_inodes = set()
    files_read = 0
    row_counts = {"counted": 0, "routed": 0, "malformed": 0, "invalid": 0, "unsupported": 0}
    for root_idx, base, path in candidate_files:
        fd = -1
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                unreadable_count += 1
                continue
            file_id = (info.st_dev, info.st_ino)
            if file_id in seen_inodes:
                continue
            seen_inodes.add(file_id)
            host_label = _host_label_for(base, path)
            label_roots.setdefault(host_label, set()).add(root_idx)
            host_cells.setdefault(host_label, {m: _empty_cell() for m in REPORT_MODES})
            with os.fdopen(fd, "rb") as stream:
                fd = -1
                files_read += 1
                for raw_line in stream:
                    if not raw_line.strip():
                        continue
                    try:
                        line = raw_line.decode("utf-8")
                        row = json.loads(line)
                    except (UnicodeDecodeError, ValueError, RecursionError):
                        row_counts["malformed"] += 1
                        continue
                    if not isinstance(row, dict):
                        row_counts["malformed"] += 1
                        continue
                    source = row.get("source")
                    if not isinstance(source, str) or not source.strip():
                        row_counts["invalid"] += 1
                        continue
                    if source != "gstack-extend":
                        row_counts["routed"] += 1
                        continue
                    if "schema_version" not in row:
                        mode = "unrecorded"
                    else:
                        sv = row.get("schema_version")
                        if isinstance(sv, bool) or not isinstance(sv, int) or sv < 1 or sv > 2**53 - 1:
                            row_counts["invalid"] += 1
                            continue
                        if sv in (1, 2):
                            mode = "unrecorded"
                        elif sv in (3, 4):
                            rm = row.get("run_mode")
                            if rm in RUN_MODES:
                                mode = rm
                            else:
                                row_counts["invalid"] += 1
                                continue
                        else:
                            row_counts["unsupported"] += 1
                            continue
                    stage_name = clean(row.get("stage"))
                    outcome = row.get("outcome")
                    if stage_name is None or outcome not in OUTCOMES:
                        row_counts["invalid"] += 1
                        continue
                    row_counts["counted"] += 1
                    started_at = row.get("started_at")
                    ts = parse_ts(started_at)
                    for target_cells in (
                        stage_cells.setdefault(stage_name, {m: _empty_cell() for m in REPORT_MODES}),
                        host_cells[host_label],
                    ):
                        cell = target_cells[mode]
                        cell["runs"] += 1
                        cell["outcomes"][outcome] += 1
                        if ts is not None and (cell["_last_ts"] is None or ts > cell["_last_ts"]):
                            cell["_last_ts"] = ts
                            cell["last_seen"] = started_at
        except OSError:
            unreadable_count += 1
            continue
        finally:
            if fd >= 0:
                os.close(fd)
    dup_labels = sum(1 for root_set in label_roots.values() if len(root_set) > 1)
    if dup_labels:
        print(
            f"telemetry report: {dup_labels} host label(s) appeared in more than one state directory; "
            "copied ledgers, if present, are counted twice",
            file=sys.stderr,
        )
    extra_skills = sorted(s for s in stage_cells if s not in installed_set)
    all_skills = list(installed_skills or ()) + extra_skills
    skills_payload = []
    for skill in all_skills:
        cells = stage_cells[skill]
        skills_payload.append({
            "skill": skill,
            "installed": skill in installed_set,
            "cells": {
                mode: {
                    "runs": cells[mode]["runs"],
                    "outcomes": dict(cells[mode]["outcomes"]),
                    "last_seen": cells[mode]["last_seen"],
                }
                for mode in REPORT_MODES
            },
        })
    empty_cells = [
        [skill, mode]
        for skill in (installed_skills or ())
        for mode in ("orchestrated", "user-directed", "unknown")
        if stage_cells[skill][mode]["runs"] == 0
    ]
    payload = {
        "v": 1,
        "modes": list(REPORT_MODES),
        "skills": skills_payload,
        "empty_cells": empty_cells,
        "files": {"read": files_read, "unreadable": unreadable_count},
        "rows": row_counts,
    }
    if installed_skills is None:
        payload["installed_skills"] = None
    hosts_payload = []
    if by_host:
        sorted_hosts = sorted(host_cells, key=lambda h: (h in ("(legacy)", "(unattributed)"), h))
        for host in sorted_hosts:
            cells = host_cells[host]
            hosts_payload.append({
                "host": host,
                "cells": {
                    mode: {
                        "runs": cells[mode]["runs"],
                        "outcomes": dict(cells[mode]["outcomes"]),
                        "last_seen": cells[mode]["last_seen"],
                    }
                    for mode in REPORT_MODES
                },
            })
        payload["hosts"] = hosts_payload
    if as_json:
        print(json.dumps(payload, indent=2))
        return 0
    print(
        f"Stage-runs report — files: read={files_read} unreadable={unreadable_count}; "
        f"rows: counted={row_counts['counted']} routed={row_counts['routed']} "
        f"malformed={row_counts['malformed']} invalid={row_counts['invalid']} unsupported={row_counts['unsupported']}"
    )
    print("Skill                   Mode           Runs  Success  Blocked  Error  Abort  Unknown  Last seen")
    for entry in skills_payload:
        skill = entry["skill"]
        for mode in REPORT_MODES:
            c = entry["cells"][mode]
            o = c["outcomes"]
            last = c["last_seen"] or "-"
            print(
                f"{skill:<22}  {mode:<13}  {c['runs']:>4}  {o['success']:>7}  {o['blocked']:>7}  "
                f"{o['error']:>5}  {o['abort']:>5}  {o['unknown']:>7}  {last}"
            )
    if empty_cells:
        formatted = ", ".join(f"{s}:{m}" for s, m in empty_cells)
        print(f"Empty cells ({len(empty_cells)}): {formatted}")
    else:
        print("Empty cells (0): none")
    if by_host:
        print("Host                    Mode           Runs  Success  Blocked  Error  Abort  Unknown  Last seen")
        for entry in hosts_payload:
            host = entry["host"]
            for mode in REPORT_MODES:
                c = entry["cells"][mode]
                o = c["outcomes"]
                last = c["last_seen"] or "-"
                print(
                    f"{host:<22}  {mode:<13}  {c['runs']:>4}  {o['success']:>7}  {o['blocked']:>7}  "
                    f"{o['error']:>5}  {o['abort']:>5}  {o['unknown']:>7}  {last}"
                )
    return 0


def main(args):
    if args and args[0] == "metrics":
        _metrics_dispatch(args[1:])
        return
    if args and args[0] == "report":
        run_report(args[1:])
        return
    if args and args[0] in ("-h", "--help"):
        print('Usage: gstack-extend-telemetry start|finish --skill "extend:<name>"')
        print("       gstack-extend-telemetry report [--json] [--by-host] [--state-dir DIR]...")
        print("  finish: [--start EPOCH] [--session-id ID] [--outcome success|error|abort|blocked|unknown] [--blocked-reason TOKEN]")
        print("  finish also forwards: [--used-browse true|false] [--error-class CLASS] [--error-message TEXT] [--failed-step STEP]")
        print("  finish provenance overrides: [--agent claude|codex|cursor|grok] [--model ID] [--effort LEVEL] [--work-item ID]")
        print("  blocked_reason: --blocked-reason when --outcome blocked ([a-z0-9][a-z0-9-]{0,63}, local-only, otherwise null).")
        print("  work_item: --work-item, else the value start saved from GSTACK_EXTEND_WORK_ITEM, else that variable at finish;")
        print("  at most 200 printable characters, otherwise null.")
        print("  Missing/malformed start and session values fall back to this repository root's skill handoff.")
        print("  Adoption: resumable skills (pair-review, review-and-prep, full-review) adopt at any age;")
        print("  a non-resumable skill adopts the same harness session at any age, refuses a different known session,")
        print("  and adopts an unknown fingerprint only within 24 hours. A finish never reads another root's handoff.")
        print("  Pairing: resumable starts newest first, exact matches first;")
        print("  non-resumable exact matches, then unknown fingerprints, each oldest first. See docs/telemetry.md.")
        print("  A deliberate pause finishes with --outcome blocked, and a resume starts a new segment.")
        print("  Explicit --session-id is never age-bounded; --start alone does not bypass adoption.")
        print("  An explicit finish repeated for the same skill and repository root writes nothing after completion")
        print("  (until its marker is pruned).")
        print("  Bare flags retain legacy finish compatibility (--duration SECONDS).")
        print("  GSTACK_EXTEND_TELEMETRY_DEBUG=1 explains skips. See docs/telemetry.md.")
        print("  report: print the skill-by-mode stage-runs table across legacy and per-host files (--json for JSON).")
        print("  metrics: optional local step/pass capture for review-and-prep and ship-and-land;")
        print("  run 'gstack-extend-telemetry metrics --help'. See docs/telemetry.md#workflow-metrics.")
        return
    legacy = not args or args[0] not in ("start", "finish")
    command = args.pop(0) if not legacy else "finish"
    values = {}
    # --source and --event-type are accepted but never forwarded, so callers cannot override them;
    # --duration counts only for legacy finish calls. Provenance overrides stay local to the provenance row.
    flags = {"--skill", "--start", "--session-id", "--duration", "--outcome",
             "--used-browse", "--error-class", "--error-message", "--failed-step",
             "--event-type", "--source", "--agent", "--model", "--effort", "--work-item", "--blocked-reason"}
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
    extend_state = state_root()
    provenance = provenance_enabled(extend_state)
    # Two independent outputs: gstack's tier gates skill-usage rows (which gstack may upload); the provenance switch
    # gates the local-only stage-runs row. Either one needs the start/finish handoff.
    logger = usage_logger()
    retry_usage = logger == "retry"
    if retry_usage:
        logger = None
    if not logger and not provenance and not retry_usage:
        return
    ledger = stage_run_path(extend_state)
    trace(f"provenance={'on sink=' + str(ledger) if provenance else 'off'}")
    root = capture(["git", "rev-parse", "--show-toplevel"])
    # Outside git use cwd for isolation, while the row honestly says repo:unknown.
    slot_root = root or str(Path.cwd())
    key = hashlib.sha256(json.dumps([slot_root, skill]).encode()).hexdigest()
    # One handoff file per invocation under telemetry/<key>/, so a second start never replaces the first. The
    # legacy telemetry/<key>.json is read and updated on retry/refusal; new starts never create or replace it.
    handoff_dir = extend_state / "telemetry" / key
    legacy_file = extend_state / "telemetry" / (key + ".json")
    # A finish that completed every output leaves a marker here, so an explicit retry with the original ids is a no-op.
    marker_dir = extend_state / "telemetry-completed" / key
    # One lock per repository+skill so concurrent finishes serialize and enumeration is atomic. It is held to process
    # exit and spans selection, marker checks, both appends, the sink scan, the marker write and the unlink: a second
    # same-key finish waits for the holders ahead of it and then sees the first one's marker.
    try:
        lock_dir = extend_state / "telemetry-locks"
        lock_dir.mkdir(parents=True, exist_ok=True)
        held_lock = os.open(lock_dir / (key + ".lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        fcntl.flock(held_lock, fcntl.LOCK_EX)
    except OSError as error:
        debug(f"state handoff unwritable at {handoff_dir}: {error.strerror}",
              "repair GSTACK_EXTEND_STATE_DIR permissions")
        if command == "start":
            err_name = errno.errorcode.get(error.errno, "unknown")
            print(f"GE_TELEMETRY: unavailable reason=state-unwritable dir={quoted_path(str(extend_state))} error={err_name}")
            return
        # An explicit finish can still record skill-usage. The gstack sink is not this state directory.
        if command != "start" and logger:
            explicit = values.get("--session-id")
            explicit_start = integer(values.get("--start"))
            explicit_duration = integer(values.get("--duration")) if legacy else None
            if valid_session(explicit) and (explicit_start is not None or explicit_duration is not None):
                # Marker reads need no lock: a completed run is not delegated again.
                marker_file = marker_dir / invocation_name(explicit)
                marker = read_marker(marker_file, explicit, skill, slot_root)
                if marker:
                    skip_completed(marker_file, marker, provenance, logger)
                    return
                if explicit_start is not None:
                    explicit_duration = max(0, int(time.time()) - explicit_start)
                delegate(logger, skill, explicit, explicit_duration, values)
        return
    if command == "start":
        prune_markers(marker_dir, time.time())
        now = int(time.time())
        sid = f"extend-{uuid.uuid4()}"
        row = dict(v=1, event_type="skill_start", skill=skill, session_id=sid,
                   ts=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   repo=Path(root).name if root else "unknown", source="gstack-extend")
        # Provenance still needs the handoff when the skill-usage append fails. Finish must not then
        # invent a skill_run for a start that never landed.
        wrote_usage = False
        if logger:
            try:
                wrote_usage = append_row(sink_path(logger), row, "sink")
            except (OSError, subprocess.SubprocessError) as error:
                debug(f"gstack state-root resolver failed ({error})", "reinstall gstack with ./setup or run gstack-upgrade")
        if not wrote_usage and not provenance:
            return
        fingerprint, marker_names = harness_fingerprint()
        trace("harness markers: " + (", ".join(marker_names) if marker_names else "none"))
        # The launcher's key for this run, saved so a finish in a later session keeps it.
        work_item = accepted_work_item(os.environ.get(WORK_ITEM_ENV), "start environment")
        handoff_saved = False
        handoff_error = None
        try:
            candidates, _, broken = enumerate_candidates(handoff_dir, legacy_file)
            if broken:
                raise OSError(errno.ENOTDIR, "the handoff store is not a readable directory")
            seq = next_seq(candidates)
            # harness is a session-fingerprint hash, not a harness name.
            saved_state = dict(session_id=sid, start=str(now), seq=str(seq), usage=wrote_usage,
                               skill=skill, root=slot_root, harness=fingerprint)
            if work_item is not None:
                saved_state["work_item"] = work_item
            save_state(handoff_dir / invocation_name(sid), saved_state)
            handoff_saved = True
        except OSError as error:
            handoff_error = errno.errorcode.get(error.errno, "unknown")
            debug(f"state handoff unwritable at {handoff_dir}: {error.strerror}",
                  ("inspect handoff seq/start values and the system clock; supply explicit --start and --session-id"
                   if error.errno == errno.ERANGE else
                   "repair GSTACK_EXTEND_STATE_DIR permissions or supply explicit --start and --session-id"))
        # quoted_path: clean() admits spaces, "=", quotes and backslashes, so recovery parses the value as JSON.
        print(f"GE_TELEMETRY: session={sid} start={now}"
              + (f" work_item={quoted_path(work_item)}" if handoff_saved and work_item is not None else ""))
        if handoff_error is not None:
            print(f"GE_TELEMETRY: unavailable reason=handoff-unwritable dir={quoted_path(str(handoff_dir))} error={handoff_error}")
        return
    explicit_sid = values.get("--session-id")
    explicit_start = integer(values.get("--start"))
    duration = integer(values.get("--duration")) if legacy else None
    # A valid explicit session id keeps today's behavior and is never age-bounded.
    # --start alone does not bypass adoption: a refusable handoff is still refused.
    if valid_session(explicit_sid):
        sid = explicit_sid
        # Only this session's own handoff: other invocations' handoffs are never read or touched.
        handoff = explicit_candidate(handoff_dir, legacy_file, sid)
        # Checked with or without a handoff, before the missing-start return: no explicit path bypasses the bound.
        marker_file = marker_dir / invocation_name(sid)
        marker = read_marker(marker_file, sid, skill, slot_root)
        if marker:
            skip_completed(marker_file, marker, provenance, logger)
            if handoff:  # a crash between the marker write and the unlink left it: the marker wins
                try:
                    remove_handoff(handoff)
                except OSError as error:
                    debug(f"could not remove the handoff: {error}", "repair GSTACK_EXTEND_STATE_DIR permissions")
            return
        state = handoff.state if handoff else {}
        start = explicit_start
        if start is None and duration is None and handoff:
            start = integer(state.get("start"))
        if start is None and duration is None:
            debug("missing or malformed start/session state",
                  "run telemetry start first, or supply valid --start and --session-id")
            return
    else:
        current, _names = harness_fingerprint()
        handoff = adopt_candidate(handoff_dir, legacy_file, skill, slot_root, current)
        if not handoff:
            return
        state = handoff.state
        sid = state.get("session_id")
        start = explicit_start
        # A legacy duration already supplies the time half; otherwise the adopted handoff's start does.
        if start is None and duration is None:
            start = handoff.classification[1]
        if not valid_session(sid) or (start is None and duration is None):
            debug("missing or malformed start/session state",
                  "run telemetry start first, or supply valid --start and --session-id")
            return
    if start is not None:
        # Session wall-clock including human wait time, NOT model/token spend.
        # Upstream nulls durations above 86400 seconds.
        duration = max(0, int(time.time()) - start)
    # The handoff records which outputs a partial finish already wrote, so a retry never duplicates either row.
    done = state.get("done") if isinstance(state.get("done"), list) else []
    done = [output for output in done if output in MARKER_OUTPUTS]
    # Handoffs from before the usage flag still complete. A false flag means the start append never landed.
    usage_ok = state.get("usage") if "usage" in state else True
    saved = state.get("row") if isinstance(state.get("row"), dict) else None
    # A delegate that timed out or exited nonzero may already have written: retries check the sink before delegating.
    uncertain = state.get("usage_uncertain") is True
    if provenance and "provenance" not in done:
        was_saved = saved is not None
        observed = {}
        # Reuse the first attempt's row so a retry does not re-detect the model or stretch duration_s. A saved row is
        # appended as saved, even by a later release: its version, producer and sources describe its construction.
        row = saved or provenance_row(skill.removeprefix("extend:"), sid, start, duration, values, root,
                                      resolve_work_item(values.get("--work-item"), state.get("work_item")),
                                      observed=observed, saved_work_item=state.get("work_item"))
        trace(f"provenance agent={row['agent']} model={row['model']} effort={row['effort']}")
        if append_row(ledger, row, "provenance sink"):
            done.append("provenance")
            saved = None
            persist_handoff(handoff, done, saved, uncertain)
        else:
            saved = row
        if not was_saved and skill in ("extend:review-and-prep", "extend:ship-and-land"):
            try:
                cap = _load_workflow_metrics().capture_usage(
                    sid, skill.removeprefix("extend:"), observed.get("begin"), observed.get("end"),
                    observed.get("agent"), slot_root)
                if cap is not None:
                    trace(f"workflow-metrics usage={cap}")
            except Exception:
                pass
    if logger and usage_ok and "usage" not in done:
        result, uncertain_now = deliver_usage(logger, skill, sid, duration, values, uncertain)
        if result == "done":
            done.append("usage")
        if result in ("done", "uncertain"):
            persist_handoff(handoff, done, saved, uncertain_now)
        uncertain = uncertain_now
    # A transient gstack-config failure is not "usage is off". Keep the handoff so a retry can delegate.
    usage_done = not (retry_usage and usage_ok) and ((not logger) or (not usage_ok) or ("usage" in done))
    if (not provenance or "provenance" in done) and usage_done and not saved:
        # Every output that was owed is recorded: leave the marker an explicit retry will find, then consume only
        # this handoff (other invocations' files are never touched). A marker that cannot be written keeps the handoff
        # with its progress saved, so the retry completes without duplicating.
        try:
            if store_shape(marker_dir) == "bad":
                raise OSError(errno.ENOTDIR, "the completion marker store is not a directory")
            save_state(marker_dir / invocation_name(sid), dict(session_id=sid, skill=skill, root=slot_root,
                                                              done=done, completed_at=int(time.time())))
            marked = True
        except OSError as error:
            marked = False
            debug(f"could not write the completion marker: {error}", "repair GSTACK_EXTEND_STATE_DIR permissions")
        if handoff and marked:
            try:
                remove_handoff(handoff)
            except OSError as error:
                debug(f"could not update the handoff: {error}", "repair GSTACK_EXTEND_STATE_DIR permissions")
    elif done or saved:
        persist_handoff(handoff, done, saved, uncertain)


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
