"""Optional local step/pass metrics for /review-and-prep and /ship-and-land (Track 24A).

Loaded only by telemetry.py's early `metrics` dispatch, through a path derived from
telemetry.py itself, so it works under `python3 -I`. Records live in
<state>/analytics/workflow-metrics/<sha256(session_id)>.jsonl. This module never
touches the legacy start/finish handoff except to bind the first run event to it,
never calls the gstack logger or provenance detectors, and never changes a
workflow outcome: every result is one JSON envelope and the launcher exits 0.
See docs/telemetry.md#workflow-metrics and docs/workflow-metrics.schema.json.
"""
import errno
import fcntl
import hashlib
import json
import math
import os
import re
import select
import stat
import subprocess
import sys
import time
import traceback
from pathlib import Path

V = 1
STDIN_LIMIT = 16 * 1024
MAX_DEPTH = 8
MAX_ARRAY = 256
MAX_RECORDS = 4096
MAX_BYTES = 8 * 1024 * 1024
ENVELOPE_LIMIT = 16 * 1024
DIAGNOSTICS_LIMIT = 4 * 1024
RECEIPT_LIMIT = 2 * 1024
STDIN_DEADLINE_S = 0.25
GIT_DEADLINE_S = 0.25
OPS = ("begin", "end", "decision", "pass", "correction", "read")
STAGES = ("review-and-prep", "ship-and-land")
PHASES = ("run", "evidence", "scope", "base-integration", "local-pass", "voice",
          "completion", "pregate", "coverage", "documentation", "tests", "commit",
          "publication", "external-review", "triage", "fix", "readiness", "handoff",
          "reuse", "release", "ship", "landing")
WAIT_CATEGORIES = ("human", "external-review", "checks", "deploy", "tool", "other")
DECISIONS = ("RUN", "REUSE", "N/A")
DECISION_REASONS = ("required", "matching-evidence", "candidate-changed", "base-changed",
                    "policy-changed", "evidence-missing", "evidence-stale",
                    "not-applicable", "user-deferred", "unknown")
SEVERITIES = ("P0", "P1", "P2", "P3", "critical", "high", "medium", "low", "info", "unknown")
RUBRICS = ("core", "specialist", "adversarial", "greptile", "gstack-review", "other", "unknown")
ADJUDICATIONS = ("accepted", "rejected", "deferred", "duplicate", "unclassified")
RESOLUTIONS = ("open", "fixed", "unknown")
NORMALIZED = {"P0": "critical", "critical": "critical", "P1": "high", "high": "high",
              "P2": "medium", "medium": "medium", "P3": "low", "low": "low",
              "info": "info", "unknown": "unclassified"}
FIX_TEXT = {
    "capture-disabled": "Detailed capture is off; no action is needed.",
    "invalid-input": "Send one valid JSON object on stdin; see the operation help.",
    "unsupported-version": "Use v=1, or upgrade gstack-extend.",
    "identity-missing": "Provide the exact GE_TELEMETRY start session ID, or continue without capture.",
    "identity-mismatch": "Use the start ID from this invocation in this checkout, or continue without capture.",
    "unsafe-path": "Inspect the configured state root; nothing was moved, deleted or chmodded.",
    "lock-busy": "Drop this capture attempt; do not retry it.",
    "capacity": "Mark capture partial and continue the workflow; do not truncate the run file.",
    "malformed-record": "Mark capture partial and continue the workflow; do not repair the run file in place.",
    "partial-tail": "Mark capture partial and continue the workflow; do not append behind torn bytes.",
    "event-conflict": "Preserve the original event; a changed payload needs a new caller decision, never an overwrite.",
    "io-error": "Inspect the configured state root; continue the workflow without this capture.",
    "capture-missing": "No bound run exists for that ID; continue without capture.",
    "ambiguous-binding": "Run the first metrics call from the same git checkout as the legacy start, or continue without capture.",
    "clock-invalid": "Treat the affected duration as unknown; wall time is clock-sensitive.",
    "candidate-changed": "Start a new pass for the new candidate; keep the observed wall time labelled mixed.",
}
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
SESSION_RE = re.compile(r"extend-" + UUID_RE.pattern)
VOICE_RE = re.compile(r"(?:[a-z][a-z0-9-]{0,63}|" + UUID_RE.pattern + r")")
SAFE_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
HASH_RE = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})")
SHA256_RE = re.compile(r"[0-9a-f]{64}")
RELEASE_RE = re.compile(r"[0-9]+(\.[0-9]+){2,3}")  # three-part releases and retained legacy four-part records
CANDIDATE_KEYS = ("candidate_head", "candidate_tree", "candidate_base", "binding")
# Why a read summary left something unknown (data.unknown_reasons; docs/telemetry.md#workflow-metrics-unknown).
UNKNOWN_REASONS = ("malformed-record", "partial-tail", "event-conflict", "missing-begin", "missing-end",
                   "missing-reference", "conflicting-terminal", "competing-correction", "incomplete-pass",
                   "cross-candidate", "clock-invalid", "open-wait", "unrecorded-work")
# The subset that means the stored records contradict or orphan each other: the read is partial.
INTEGRITY_REASONS = ("malformed-record", "partial-tail", "event-conflict", "missing-begin",
                     "missing-reference", "conflicting-terminal", "competing-correction", "cross-candidate")
# Reads pair a RUN decision with a begun step by step_id. A record written by this release
# or earlier (or with no readable producer_version) may instead be offset by an unpaired
# top-level same-phase step, because those producers gave decisions fresh IDs; any later
# producer must match step_id exactly (docs/telemetry.md#workflow-metrics-untimed).
LEGACY_PAIRING_MAX = (0, 50, 0, 0)


class Fail(Exception):
    def __init__(self, status, reason, field=None, expected=None, actual=None, limit=None,
                 cause=None, side_effects="none"):
        super().__init__(reason)
        self.status, self.reason = status, reason
        self.field, self.expected = field, expected
        self.actual, self.limit, self.cause = actual, limit, cause
        self.side_effects = side_effects
        self.trace = None


def _now_ms():
    return int(time.time() * 1000)


def producer_version():
    try:
        text = _read_capped(Path(__file__).resolve().parents[2] / "VERSION", 128).decode("utf-8").strip()
    except (OSError, UnicodeDecodeError):
        return None
    return text if RELEASE_RE.fullmatch(text) else None


def state_root():
    override = os.environ.get("GSTACK_EXTEND_STATE_DIR")
    if override and os.path.isabs(override):
        return Path(override)
    return Path.home() / ".gstack-extend"


def metrics_disabled():
    """(disabled, config_source env names). Env off wins; provenance=false/off wins over detail."""
    sources = []
    env = os.environ.get("GSTACK_EXTEND_WORKFLOW_METRICS")
    if env is not None:
        sources.append("GSTACK_EXTEND_WORKFLOW_METRICS")
        if env in ("off", "false"):
            return True, sources
    try:
        raw = _read_capped(state_root() / "config", 1 << 20)
    except FileNotFoundError:
        return False, sources
    except OSError:
        return True, sources  # unreadable config is not evidence provenance is on (legacy rule)
    for line in raw.decode("utf-8", "replace").splitlines():
        name, sep, value = line.partition("=")
        if sep and name == "provenance":
            return value.strip() in ("false", "off"), sources
    return False, sources


def _read_capped(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit:
            raise OSError(errno.EINVAL, "not a private regular file")
        with os.fdopen(fd, "rb") as stream:
            fd = -1
            return stream.read(limit)
    finally:
        if fd >= 0:
            os.close(fd)


def diagnostics_for(op, fail, config_sources=()):
    diag = {
        "operation": op, "component": "workflow-metrics", "field": fail.field,
        "expected": fail.expected, "actual": fail.actual, "limit": fail.limit,
        "code": fail.reason, "doc_anchor": "docs/telemetry.md#workflow-metrics-" + fail.reason,
        "fix": FIX_TEXT.get(fail.reason, FIX_TEXT["io-error"]),
        "side_effects": fail.side_effects, "retry_bound": 0,
        "helper_version": producer_version(), "schema_version": V,
        "config_source": list(config_sources), "cause": fail.cause, "trace": fail.trace,
    }
    if len(json.dumps(diag).encode()) > DIAGNOSTICS_LIMIT:
        # Fields are bounded by construction; drop the variable ones rather than exceed the cap.
        diag.update(expected=None, actual=None, limit=None, cause=None, trace=None)
    return diag


def emit(status, reason, session_id, event_id, data, op, fail=None, config_sources=()):
    diag = diagnostics_for(op, fail, config_sources) if fail is not None else None
    envelope = {"v": V, "status": status, "reason": reason, "session_id": session_id,
                "event_id": event_id, "data": data, "diagnostics": diag}
    text = json.dumps(envelope, ensure_ascii=True, separators=(",", ":"))
    if len(text.encode()) > ENVELOPE_LIMIT:
        envelope = {"v": V, "status": "partial", "reason": "capacity", "session_id": session_id,
                    "event_id": event_id, "data": {"capture": "partial"},
                    "diagnostics": diagnostics_for(op, Fail("partial", "capacity"), config_sources)}
        text = json.dumps(envelope, ensure_ascii=True, separators=(",", ":"))
    print(text)
    # A closed fd 2 leaves sys.stderr None, and print(file=None) would add a second line to stdout.
    if status not in ("recorded", "replayed", "ok") and sys.stderr is not None:
        try:  # a broken stderr pipe must not turn into a second envelope on stdout
            print(f"workflow-metrics: {status} ({reason}). See docs/telemetry.md#workflow-metrics-{reason}.",
                  file=sys.stderr)
        except OSError:
            pass
    return envelope


def read_stdin():
    # Python sets sys.stdin to None when fd 0 was closed at startup. Check that first: a file the
    # interpreter opened since may now occupy fd 0 (seen on Python 3.9) and must never be read as input.
    if sys.stdin is None:
        raise Fail("unavailable", "invalid-input", field="stdin", cause="stdin-unavailable")
    if os.isatty(0):
        raise Fail("unavailable", "invalid-input", field="stdin", expected="pipe-or-file",
                   cause="stdin-tty")
    try:
        info = os.fstat(0)
    except OSError:
        raise Fail("unavailable", "invalid-input", field="stdin", cause="stdin-unavailable") from None
    chunks, total = [], 0
    if stat.S_ISREG(info.st_mode):
        while True:
            chunk = os.read(0, min(8192, STDIN_LIMIT + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > STDIN_LIMIT:
                break
    else:
        # O_NONBLOCK lives on the shared open file description, so restore it for any
        # sibling process that inherited the same stdin.
        was_blocking = os.get_blocking(0)
        os.set_blocking(0, False)
        try:
            deadline = time.monotonic() + STDIN_DEADLINE_S
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not select.select([0], [], [], remaining)[0]:
                    raise Fail("unavailable", "invalid-input", field="stdin", cause="input-timeout",
                               limit=int(STDIN_DEADLINE_S * 1000))
                try:
                    chunk = os.read(0, min(8192, STDIN_LIMIT + 1 - total))
                except BlockingIOError:
                    continue
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
                if total > STDIN_LIMIT:
                    break
        finally:
            try:
                os.set_blocking(0, was_blocking)
            except OSError:
                pass
    data = b"".join(chunks)
    if len(data) > STDIN_LIMIT:
        raise Fail("unavailable", "invalid-input", field="stdin", actual=len(data), limit=STDIN_LIMIT,
                   cause="input-too-large")
    if not data:
        raise Fail("unavailable", "invalid-input", field="stdin", cause="input-empty")
    return data


def _no_dupes(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError("duplicate-key")
        obj[key] = value
    return obj


def _const(_value):
    raise ValueError("nonfinite")


def parse_request(data):
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise Fail("unavailable", "invalid-input", field="stdin", cause="invalid-utf8") from None
    try:
        parsed = json.loads(text, object_pairs_hook=_no_dupes, parse_constant=_const)
    except ValueError:
        raise Fail("unavailable", "invalid-input", field="stdin", cause="invalid-json") from None
    except RecursionError:
        # Some interpreters' JSON decoders (e.g. Python 3.9) hit the recursion limit before depth 8 is checked.
        raise Fail("unavailable", "invalid-input", field="stdin", cause="too-deep", limit=MAX_DEPTH) from None
    if not isinstance(parsed, dict):
        raise Fail("unavailable", "invalid-input", field="stdin", expected="object", cause="not-object")
    _check_bounds(parsed, 1)
    return parsed


def _check_bounds(value, depth):
    if depth > MAX_DEPTH:
        raise Fail("unavailable", "invalid-input", cause="too-deep", limit=MAX_DEPTH)
    if isinstance(value, float) and not math.isfinite(value):
        raise Fail("unavailable", "invalid-input", cause="nonfinite")
    if isinstance(value, list):
        if len(value) > MAX_ARRAY:
            raise Fail("unavailable", "invalid-input", cause="array-too-large",
                       actual=len(value), limit=MAX_ARRAY)
        for item in value:
            _check_bounds(item, depth + 1)
    elif isinstance(value, dict):
        for item in value.values():
            _check_bounds(item, depth + 1)


# --- request validation: exact key sets, no free text anywhere ---

def _bad(field, expected="valid", cause="invalid-value"):
    return Fail("unavailable", "invalid-input", field=field, expected=expected, cause=cause)


def _keys(obj, required, optional, where):
    keys = set(obj)
    if not set(required) <= keys:
        raise _bad(where, "keys:" + ",".join(required), "missing-key")
    if keys - set(required) - set(optional):
        raise _bad(where, "no unknown keys", "unknown-key")


def _enum(obj, field, values):
    if obj.get(field) not in values:
        raise _bad(field, "|".join(values))


def _uuid(value, field):
    if not (isinstance(value, str) and UUID_RE.fullmatch(value)):
        raise _bad(field, "uuid")


def _nullable_uuid(obj, field):
    if obj[field] is not None:
        _uuid(obj[field], field)


def _session(value, field):
    if not (isinstance(value, str) and SESSION_RE.fullmatch(value)):
        raise _bad(field, "extend-uuid")


def _hash_or_null(value, field):
    if value is not None and not (isinstance(value, str) and HASH_RE.fullmatch(value)):
        raise _bad(field, "hex40-or-hex64-or-null")


def _context(value, full):
    if not isinstance(value, dict):
        raise _bad("context", "object")
    if full:
        _keys(value, ("candidate_head", "candidate_tree", "candidate_base", "binding",
                      "skill_sha256", "parent_session_id"), (), "context")
        if value["parent_session_id"] is not None:
            _session(value["parent_session_id"], "context.parent_session_id")
        skill = value["skill_sha256"]
        if skill is not None and not (isinstance(skill, str) and SHA256_RE.fullmatch(skill)):
            raise _bad("context.skill_sha256", "hex64-or-null")
    else:
        _keys(value, (), ("candidate_head", "candidate_tree", "candidate_base", "binding"), "context")
        if not value:
            raise _bad("context", "at least one candidate field")
    for field in ("candidate_head", "candidate_tree", "candidate_base"):
        if field in value:
            _hash_or_null(value[field], "context." + field)
    if "binding" in value:
        _enum(value, "binding", ("clean", "dirty", "unknown"))


def _model_context(value):
    if not isinstance(value, dict):
        raise _bad("model_context", "object")
    _keys(value, ("requested_model", "requested_effort", "reported_model", "reported_effort",
                  "requested_source", "reported_source", "unknown_reason"), (), "model_context")
    for field in ("requested_model", "requested_effort", "reported_model", "reported_effort"):
        item = value[field]
        if item is not None and not (isinstance(item, str) and SAFE_ID_RE.fullmatch(item)):
            raise _bad("model_context." + field, "bounded-identifier-or-null")
    _enum(value, "requested_source", ("launcher-config", "tool-result", "unavailable"))
    _enum(value, "reported_source", ("tool-result", "unavailable"))  # configuration is requested, never observed
    for side in ("requested", "reported"):
        if value[side + "_source"] == "unavailable" and (value[side + "_model"] is not None
                                                         or value[side + "_effort"] is not None):
            raise _bad("model_context." + side + "_source", "null-values-when-unavailable")
    if value["unknown_reason"] not in (None, "not-reported", "unsupported", "ambiguous", "capture-missing"):
        raise _bad("model_context.unknown_reason")
    if any(value[f] is None for f in ("requested_model", "reported_model", "requested_effort", "reported_effort")) \
            and value["unknown_reason"] is None:
        raise _bad("model_context.unknown_reason", "required-when-a-value-is-null")


def _finding(value):
    if not isinstance(value, dict):
        raise _bad("findings[]", "object")
    _keys(value, ("finding_id", "severity_source", "severity_rubric", "adjudication",
                  "resolution", "duplicate_of"), (), "findings[]")
    if not (isinstance(value["finding_id"], str) and SAFE_ID_RE.fullmatch(value["finding_id"])):
        raise _bad("findings[].finding_id", "bounded-identifier")
    _enum(value, "severity_source", SEVERITIES)
    _enum(value, "severity_rubric", RUBRICS)
    _enum(value, "adjudication", ADJUDICATIONS)
    _enum(value, "resolution", RESOLUTIONS)
    if value["duplicate_of"] is not None and not (
            isinstance(value["duplicate_of"], str) and SAFE_ID_RE.fullmatch(value["duplicate_of"])):
        raise _bad("findings[].duplicate_of", "bounded-identifier-or-null")
    if value["adjudication"] in ("rejected", "duplicate") and value["resolution"] != "unknown":
        raise _bad("findings[].resolution", "unknown-for-rejected-or-duplicate")
    if value["adjudication"] == "duplicate" and value["duplicate_of"] is None:
        raise _bad("findings[].duplicate_of", "required-for-duplicate")
    if value["duplicate_of"] == value["finding_id"]:
        raise _bad("findings[].duplicate_of", "another-finding")


def validate_request(op, req):
    if type(req.get("v")) is not int:
        raise _bad("v", "integer-1")
    if req["v"] != V:
        actual = req["v"] if -(1 << 31) <= req["v"] < (1 << 31) else None  # never echo an unbounded value
        raise Fail("unavailable", "unsupported-version", field="v", expected="1", actual=actual)
    _enum(req, "stage", STAGES)
    _session(req.get("session_id"), "session_id")
    _uuid(req.get("event_id"), "event_id")
    base = ("v", "stage", "session_id", "event_id")
    if op == "begin":
        _keys(req, base + ("step_id", "parent_step_id", "kind"), ("phase", "wait_category", "context"), "begin")
        _uuid(req["step_id"], "step_id")
        _nullable_uuid(req, "parent_step_id")
        _enum(req, "kind", ("run", "phase", "voice", "wait", "fix"))
        if req["kind"] == "run":
            if req.get("phase") != "run" or "wait_category" in req or req["parent_step_id"] is not None:
                raise _bad("begin", "run kind needs phase=run, null parent, no wait_category")
            if "context" not in req:
                raise _bad("context", "required-for-run")
            _context(req["context"], full=True)
        elif req["kind"] == "wait":
            _enum(req, "wait_category", WAIT_CATEGORIES)
            if "phase" in req:
                _enum(req, "phase", PHASES)
            if "context" in req:
                _context(req["context"], full=False)
        else:
            _enum(req, "phase", PHASES)
            if "wait_category" in req:
                raise _bad("wait_category", "wait-kind-only")
            if "context" in req:
                _context(req["context"], full=False)
    elif op == "end":
        _keys(req, base + ("step_id", "outcome"), ("context",), "end")
        _uuid(req["step_id"], "step_id")
        _enum(req, "outcome", ("completed", "failed", "paused", "cancelled"))
        if "context" in req:
            _context(req["context"], full=False)
    elif op == "decision":
        _keys(req, base + ("step_id", "phase", "decision", "reason"), ("context",), "decision")
        _uuid(req["step_id"], "step_id")
        _enum(req, "phase", PHASES)
        _enum(req, "decision", DECISIONS)
        _enum(req, "reason", DECISION_REASONS)
        if "context" in req:
            _context(req["context"], full=False)
    elif op == "pass":
        _validate_pass(base, req)
    elif op == "correction":
        _validate_correction(base, req)
    else:
        raise _bad("operation", "|".join(OPS))
    return req


def _validate_pass(base, req):
    state = req.get("state")
    if state not in ("started", "attempt", "voice-complete", "completed"):
        raise _bad("state", "started|attempt|voice-complete|completed")
    common = base + ("pass_id", "scope", "state")
    if state == "started":
        _keys(req, common + ("required_voice_ids",), ("context",), "pass.started")
        voices = req["required_voice_ids"]
        if not isinstance(voices, list) or not voices or not all(isinstance(v, str) for v in voices) \
                or len(set(voices)) != len(voices):
            raise _bad("required_voice_ids", "nonempty-unique-array")
        for voice in voices:
            if not (isinstance(voice, str) and VOICE_RE.fullmatch(voice)):
                raise _bad("required_voice_ids[]", "voice-id")
    elif state == "attempt":
        _keys(req, common + ("voice_id", "attempt_id", "predecessor_attempt_id", "attempt_outcome"),
              ("findings", "model_context", "context"), "pass.attempt")
        if not (isinstance(req["voice_id"], str) and VOICE_RE.fullmatch(req["voice_id"])):
            raise _bad("voice_id", "voice-id")
        _uuid(req["attempt_id"], "attempt_id")
        _nullable_uuid(req, "predecessor_attempt_id")
        _enum(req, "attempt_outcome", ("completed", "failed", "partial"))
        if req["attempt_outcome"] == "completed":
            if not isinstance(req.get("findings"), list):
                raise _bad("findings", "array-required-for-completed-attempt (empty means zero)")
            for finding in req["findings"]:
                _finding(finding)
            ids = [finding["finding_id"] for finding in req["findings"]]
            if len(set(ids)) != len(ids):
                raise _bad("findings[].finding_id", "unique-within-attempt")
        elif "findings" in req:
            raise _bad("findings", "completed-attempts-only")
        if "model_context" in req:
            _model_context(req["model_context"])
    elif state == "voice-complete":
        _keys(req, common + ("voice_id", "voice_status"), ("selected_attempt_id", "na_reason", "context"),
              "pass.voice-complete")
        if not (isinstance(req["voice_id"], str) and VOICE_RE.fullmatch(req["voice_id"])):
            raise _bad("voice_id", "voice-id")
        _enum(req, "voice_status", ("completed", "not-applicable"))
        if req["voice_status"] == "completed":
            _uuid(req.get("selected_attempt_id"), "selected_attempt_id")
            if "na_reason" in req:
                raise _bad("na_reason", "not-applicable-only")
        else:
            _enum(req, "na_reason", ("not-applicable", "user-deferred"))
            if "selected_attempt_id" in req:
                raise _bad("selected_attempt_id", "completed-only")
    else:
        _keys(req, common, ("context",), "pass.completed")
    _uuid(req["pass_id"], "pass_id")
    _enum(req, "scope", ("local", "greptile"))
    if "context" in req:
        _context(req["context"], full=False)


def _validate_correction(base, req):
    allowed = ("supersedes_event_id", "pass_id", "voice_id", "attempt_id", "finding_id", "step_id",
               "parent_step_id", "fix_step_id", "selected_attempt_id", "adjudication", "resolution")
    _keys(req, base + ("correction_kind",), allowed, "correction")
    _enum(req, "correction_kind", ("retry", "fallback", "parent", "finding", "fix-cycle"))
    for field in ("supersedes_event_id", "pass_id", "attempt_id", "step_id", "parent_step_id",
                  "fix_step_id", "selected_attempt_id"):
        if field in req and req[field] is not None:
            _uuid(req[field], field)
    if "voice_id" in req and req["voice_id"] is not None and not (
            isinstance(req["voice_id"], str) and VOICE_RE.fullmatch(req["voice_id"])):
        raise _bad("voice_id", "voice-id")
    if "finding_id" in req and req["finding_id"] is not None and not (
            isinstance(req["finding_id"], str) and SAFE_ID_RE.fullmatch(req["finding_id"])):
        raise _bad("finding_id", "bounded-identifier")
    if "adjudication" in req and req["adjudication"] is not None:
        _enum(req, "adjudication", tuple(a for a in ADJUDICATIONS if a != "duplicate"))
    if "resolution" in req and req["resolution"] is not None:
        _enum(req, "resolution", RESOLUTIONS)
    kind = req["correction_kind"]
    if kind in ("retry", "fallback") and not req.get("attempt_id"):
        raise _bad("attempt_id", "required-for-retry-or-fallback")
    if kind == "parent" and not (req.get("step_id") and req.get("parent_step_id")):
        raise _bad("correction", "parent needs step_id and parent_step_id")
    if kind == "finding" and not (req.get("finding_id") and (req.get("adjudication") or req.get("resolution"))):
        raise _bad("correction", "finding needs finding_id and adjudication or resolution")
    if kind == "fix-cycle" and not req.get("fix_step_id"):
        raise _bad("fix_step_id", "required-for-fix-cycle")


def request_digest(op, req):
    canonical = json.dumps({"op": op, "request": req}, ensure_ascii=True, sort_keys=True,
                           separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


# --- storage: private no-follow files, per-run nonblocking lock, checked appends ---

def run_paths(session_id):
    digest = hashlib.sha256(session_id.encode()).hexdigest()
    root = state_root()
    metrics_dir = root / "analytics" / "workflow-metrics"
    return {
        "root": root, "analytics": root / "analytics", "metrics_dir": metrics_dir,
        "ledger": metrics_dir / (digest + ".jsonl"),
        "lock_dir": root / "workflow-metrics-locks",
        "lock": root / "workflow-metrics-locks" / (digest + ".lock"),
    }


def _dir_ok(path):
    """True absent-or-real-dir; False for symlink/file/other. No following, no repair."""
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return True
    except OSError:
        return False
    return stat.S_ISDIR(info.st_mode)


def _ensure_dirs(paths):
    # The state root and analytics/ predate this companion and may be user-managed
    # (even symlinked) exactly as the legacy sinks allow; only the two directories
    # this feature introduces must not be stand-ins.
    for directory in (paths["metrics_dir"], paths["lock_dir"]):
        if not _dir_ok(directory):
            raise Fail("unavailable", "unsafe-path", cause="unsafe-directory")
    try:
        paths["metrics_dir"].mkdir(parents=True, exist_ok=True, mode=0o700)
        paths["lock_dir"].mkdir(parents=True, exist_ok=True, mode=0o700)
    except PermissionError:
        raise Fail("unavailable", "io-error", cause="permission") from None
    except OSError:
        raise Fail("unavailable", "io-error", cause="mkdir") from None
    for directory in (paths["metrics_dir"], paths["lock_dir"]):
        if not _dir_ok(directory):
            raise Fail("unavailable", "unsafe-path", cause="unsafe-directory")


def _acquire_lock(paths):
    try:
        fd = os.open(paths["lock"], os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    except PermissionError:
        raise Fail("unavailable", "io-error", cause="permission") from None
    except OSError:
        raise Fail("unavailable", "unsafe-path", cause="unsafe-lock") from None
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise Fail("unavailable", "unsafe-path", cause="unsafe-lock")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        os.close(fd)
        raise Fail("unavailable", "lock-busy", cause="contention") from None
    except Fail:
        os.close(fd)
        raise
    except OSError:
        os.close(fd)
        raise Fail("unavailable", "io-error", cause="lock") from None
    return fd


def _open_ledger_read(paths):
    try:
        fd = os.open(paths["ledger"], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    except PermissionError:
        raise Fail("unavailable", "io-error", cause="permission") from None
    except OSError:
        raise Fail("unavailable", "unsafe-path", cause="unsafe-ledger") from None
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        os.close(fd)
        raise Fail("unavailable", "unsafe-path", cause="unsafe-ledger")
    return fd


def _read_snapshot(fd):
    chunks, total = [], 0
    while True:
        chunk = os.read(fd, min(65536, MAX_BYTES + 1 - total))
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
        if total > MAX_BYTES:
            break
    return b"".join(chunks), total > MAX_BYTES


def parse_ledger(data, overflow=False):
    """(records, malformed, partial_tail). Exact duplicate lines stay; the reducer dedupes."""
    records, malformed = [], 0
    partial_tail = overflow
    if data and not data.endswith(b"\n"):
        partial_tail = True
        data = data[: data.rfind(b"\n") + 1]
    for line in data.split(b"\n"):
        if not line:
            continue
        try:
            record = json.loads(line.decode("utf-8"), object_pairs_hook=_no_dupes, parse_constant=_const)
            _validate_record(record)
        except (ValueError, UnicodeDecodeError, Fail, RecursionError, TypeError, AttributeError, KeyError):
            # Any structurally wrong stored line is malformed, never an unreadable run.
            malformed += 1
            continue
        records.append(record)
    return records, malformed, partial_tail


def _validate_record(record):
    if not isinstance(record, dict):
        raise ValueError("record")
    _keys(record, ("v", "op", "event_id", "request_digest", "captured_at_ms", "producer_version", "request"),
          (), "record")
    if type(record["v"]) is not int or record["v"] != V:
        raise ValueError("version")
    if record["op"] not in OPS or record["op"] == "read":
        raise ValueError("op")
    _uuid(record["event_id"], "event_id")
    if not (isinstance(record["request_digest"], str) and SHA256_RE.fullmatch(record["request_digest"])):
        raise ValueError("digest")
    if type(record["captured_at_ms"]) is not int or record["captured_at_ms"] < 0:
        raise ValueError("captured_at_ms")
    version = record["producer_version"]
    if version is not None and not (isinstance(version, str) and RELEASE_RE.fullmatch(version)):
        raise ValueError("producer_version")
    if not isinstance(record["request"], dict):
        raise ValueError("request")
    validate_request(record["op"], record["request"])
    if record["request"]["event_id"] != record["event_id"]:
        raise ValueError("event-id-mismatch")
    if request_digest(record["op"], record["request"]) != record["request_digest"]:
        raise ValueError("digest-mismatch")


def _fsync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _confirm(paths, file_fd):
    """File fsync plus the directory entries that make the file reachable. Any failure: unconfirmed."""
    os.fsync(file_fd)
    _fsync_dir(paths["metrics_dir"])
    _fsync_dir(paths["analytics"])
    _fsync_dir(paths["root"])


def _git_root():
    try:
        result = subprocess.run(["git", "rev-parse", "--show-toplevel"], stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=GIT_DEADLINE_S)
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0 or not result.stdout or len(result.stdout) > 16384:
        return None
    return os.fsdecode(result.stdout).removesuffix("\n") or None


def bind_initial(req):
    """Exact saved-handoff lookup for the first begin(kind=run). Raises Fail when unbound."""
    root = _git_root()
    if root is None:
        raise Fail("unavailable", "ambiguous-binding", cause="git-root-unavailable")
    skill = "extend:" + req["stage"]
    key = hashlib.sha256(json.dumps([root, skill]).encode()).hexdigest()
    sid = req["session_id"]
    store = state_root() / "telemetry" / key
    candidates = [store / (hashlib.sha256(sid.encode()).hexdigest() + ".json"),
                  state_root() / "telemetry" / (key + ".json")]
    saw_file = False
    for path in candidates:
        try:
            state = json.loads(_read_capped(path, 1 << 20).decode("utf-8"))
        except FileNotFoundError:
            continue
        except (OSError, ValueError, UnicodeDecodeError):
            saw_file = True
            continue
        saw_file = True
        if isinstance(state, dict) and state.get("session_id") == sid:
            if state.get("skill") == skill and state.get("root") == root:
                return
            raise Fail("unavailable", "identity-mismatch", cause="handoff-fields")
    if saw_file:
        raise Fail("unavailable", "ambiguous-binding", cause="handoff-unreadable")
    raise Fail("unavailable", "identity-missing", cause="no-handoff")


def mutate(op, req):
    """Append one validated event, or replay/conflict an existing one. Returns (status, data)."""
    paths = run_paths(req["session_id"])
    digest = request_digest(op, req)
    initial = op == "begin" and req.get("kind") == "run"
    ledger_exists = os.path.lexists(paths["ledger"])
    if not ledger_exists:
        if initial:
            bind_initial(req)  # before any directory or file creation
        else:
            raise Fail("unavailable", "capture-missing", cause="no-bound-run")
    _ensure_dirs(paths)
    lock_fd = _acquire_lock(paths)
    read_fd = None
    try:
        read_fd = _open_ledger_read(paths)
        data, overflow = (b"", False)
        if read_fd is not None:
            data, overflow = _read_snapshot(read_fd)
        records, malformed, partial_tail = parse_ledger(data, overflow)
        for record in records:
            if record["event_id"] == req["event_id"]:
                if record["request_digest"] != digest:
                    raise Fail("conflict", "event-conflict", cause="digest-differs")
                # Re-confirm the very file the record was read from: a replay acknowledgment
                # needs the same file fsync plus directory chain as a fresh append.
                try:
                    _confirm(paths, read_fd)
                except OSError:
                    raise Fail("unconfirmed", "io-error", cause="replay-confirm",
                               side_effects="unknown") from None
                return "replayed", {"captured_at_ms": record["captured_at_ms"],
                                     "request_digest": digest, "op": op}
        if partial_tail:
            raise Fail("partial", "partial-tail", side_effects="partial")
        if malformed or overflow:
            raise Fail("partial", "malformed-record", actual=malformed, side_effects="partial")
        bound = next((r for r in records
                      if r["op"] == "begin" and r["request"].get("kind") == "run"), None)
        if bound is not None and bound["request"]["stage"] != req["stage"]:
            raise Fail("unavailable", "identity-mismatch", cause="stage-differs-from-bound-run")
        if bound is not None and initial:
            raise Fail("conflict", "event-conflict", cause="run-already-bound")
        if ledger_exists and initial and bound is None:
            bind_initial(req)  # file existed without a bound run (e.g. empty): still bind exactly
        if not initial and bound is None:
            raise Fail("unavailable", "capture-missing", cause="no-bound-run")
        captured = _now_ms()
        record = {"v": V, "op": op, "event_id": req["event_id"], "request_digest": digest,
                  "captured_at_ms": captured, "producer_version": producer_version(), "request": req}
        line = (json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n").encode()
        if len(records) >= MAX_RECORDS or len(data) + len(line) > MAX_BYTES:
            raise Fail("unavailable", "capacity", actual=len(records), limit=MAX_RECORDS)
        try:
            fd = os.open(paths["ledger"], os.O_APPEND | os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW
                         | os.O_NONBLOCK, 0o600)
        except PermissionError:
            raise Fail("unavailable", "io-error", cause="permission") from None
        except OSError:
            raise Fail("unavailable", "unsafe-path", cause="unsafe-ledger") from None
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise Fail("unavailable", "unsafe-path", cause="unsafe-ledger")
            written = os.write(fd, line)
            if written != len(line):
                raise Fail("unconfirmed", "io-error", cause="short-write", actual=written,
                           limit=len(line), side_effects="partial")
            try:
                _confirm(paths, fd)
            except OSError:
                raise Fail("unconfirmed", "io-error", cause="confirm", side_effects="unknown") from None
        finally:
            os.close(fd)
        return "recorded", {"captured_at_ms": captured, "request_digest": digest, "op": op}
    finally:
        if read_fd is not None:
            os.close(read_fd)
        os.close(lock_fd)


# --- read projection: raw observations in, qualified summaries out ---

def _legacy_pairing(version):
    if not isinstance(version, str) or not RELEASE_RE.fullmatch(version):
        return True
    parts = tuple(int(part) for part in version.split("."))
    return parts + (0,) * (4 - len(parts)) <= LEGACY_PAIRING_MAX


def _union_ms(intervals):
    if not intervals:
        return None
    total, start, end = 0, None, None
    for lo, hi in sorted(intervals):
        if start is None:
            start, end = lo, hi
        elif lo <= end:
            end = max(end, hi)
        else:
            total += end - start
            start, end = lo, hi
    return total + (end - start)


def _candidate(run_context, req, inherited=None):
    """Effective candidate: the entity's inherited candidate (else the run's), then this record's
    explicit override. A record without context inherits; nothing is guessed."""
    if inherited is not None:
        base = dict(zip(CANDIDATE_KEYS, inherited))
    else:
        base = {"candidate_head": None, "candidate_tree": None, "candidate_base": None, "binding": "unknown"}
        if run_context:
            base.update({k: run_context[k] for k in CANDIDATE_KEYS if k in run_context})
    override = req.get("context") or {}
    base.update({k: override[k] for k in CANDIDATE_KEYS if k in override})
    return tuple(base[k] for k in CANDIDATE_KEYS)


def summarize(records, malformed, partial_tail, overflow):
    unknown = set()
    if malformed:
        unknown.add("malformed-record")
    if partial_tail or overflow:
        unknown.add("partial-tail")
    by_event, effective = {}, []
    conflicts = set()
    for record in records:
        prior = by_event.get(record["event_id"])
        if prior is None:
            by_event[record["event_id"]] = record
            effective.append(record)
        elif prior["request_digest"] != record["request_digest"]:
            conflicts.add(record["event_id"])
    if conflicts:
        unknown.add("event-conflict")
        effective = [r for r in effective if r["event_id"] not in conflicts]
        by_event = {r["event_id"]: r for r in effective}
    stages = {r["request"]["stage"] for r in effective}
    run_begins = [r for r in effective if r["op"] == "begin" and r["request"].get("kind") == "run"]
    run_context = run_begins[0]["request"]["context"] if len(run_begins) == 1 else None
    if len(run_begins) > 1:
        unknown.add("conflicting-terminal")
    run = None
    if run_context is not None:
        run = {"bound": True,
               "candidate": dict(zip(CANDIDATE_KEYS, _candidate(run_context, {}))),
               "skill_sha256": run_context.get("skill_sha256"),
               "parent_session_id": run_context.get("parent_session_id"),
               "producer_version": run_begins[0]["producer_version"]}
    steps, phases, waits, union_intervals, fix_completed = _steps(effective, run_context, unknown)
    # Phases with RUN decisions or executed steps: their work happened, so a missing pass or
    # fix record makes that count unknown rather than zero.
    ran = {p["phase"] for p in phases if p["decisions"]["RUN"] or p["steps_started"]}
    corrections = _correction_counts(effective)
    passes = _passes(effective, by_event, run_context, unknown, ran)
    fix_unknown = "missing-begin" in unknown or steps["fix_invalid"]
    if "fix" in ran and not steps["fix_started"]:
        unknown.add("unrecorded-work")
        fix_unknown = True
    if any(c.get("fix_step_id") and c["fix_step_id"] not in steps["ids"]
           for c in (r["request"] for r in effective if r["op"] == "correction")):
        unknown.add("missing-reference")
        fix_unknown = True
    if malformed or partial_tail or overflow:
        # An unreadable line may have been any pass, correction or fix record: those counts are unknown.
        passes["local"] = {"attempted": None, "completed": None, "findings": None}
        passes["greptile"] = {"attempted": None, "completed": None, "findings": None}
        passes["excluded_na"] = None
        corrections = {kind: None for kind in corrections}
        fix_unknown = True
    integrity = any(reason in unknown for reason in INTEGRITY_REASONS)
    data = {
        "capture": "partial" if integrity else "ok",
        "records": len(effective), "malformed_records": malformed, "partial_tail": partial_tail,
        "conflicting_event_ids": len(conflicts),
        "stage": stages.pop() if len(stages) == 1 else None,
        "clock_basis": "utc-wall", "clock_quality": "clock-sensitive",
        "qualified_elapsed_ms": None, "qualified_reason": "unavailable-clock-domain",
        "run": run, "phases": phases, "waits": waits,
        "union_observed_wall_ms": _union_ms(union_intervals),
        "unknown_parents": steps["unknown_parents"],
        "mixed_candidate_steps": steps["mixed_candidate"],
        "local_passes": passes["local"]["completed"], "local_attempted": passes["local"]["attempted"],
        "greptile_passes": passes["greptile"]["completed"],
        "greptile_attempted": passes["greptile"]["attempted"],
        "fix_cycles": None if fix_unknown else fix_completed, "findings": passes["local"]["findings"],
        "greptile_findings": passes["greptile"]["findings"],
        "excluded_na_voices": passes["excluded_na"],
        "corrections": corrections,
        "unknown_reasons": sorted(unknown),
    }
    data["receipt_text"] = receipt_text(data)
    return data


def _phase_slot(phase_data, phase):
    return phase_data.setdefault(phase, {"intervals": [], "started": 0, "completed": 0, "unknown": 0,
                                         "decisions": {d: 0 for d in DECISIONS}})


def _steps(effective, run_context, unknown):
    begins, ends, decisions = {}, {}, []
    for record in effective:
        req = record["request"]
        if record["op"] == "begin":
            begins.setdefault(req["step_id"], []).append(record)
        elif record["op"] == "end":
            ends.setdefault(req["step_id"], []).append(record)
        elif record["op"] == "decision":
            decisions.append(record)
    phase_data, wait_data, union_intervals = {}, {}, []
    unknown_parents = mixed = fix_completed = fix_started = 0
    fix_invalid = False
    for step_id in set(begins) | set(ends):
        starts = begins.get(step_id, [])
        finishes = ends.get(step_id, [])
        if not starts:
            unknown.add("missing-begin")
            continue
        first = starts[0]["request"]
        begin_candidate = _candidate(run_context, first)
        sigs = {(r["request"].get("kind"), r["request"].get("phase"), r["request"].get("wait_category"),
                 r["request"].get("parent_step_id"), _candidate(run_context, r["request"])) for r in starts}
        outcomes = {r["request"]["outcome"] for r in finishes}
        valid = (len(sigs) == 1 and len(outcomes) == 1 and len(finishes) >= 1
                 and len({r["captured_at_ms"] for r in starts}) == 1
                 and len({r["captured_at_ms"] for r in finishes}) == 1)
        interval = None
        if valid and first.get("kind") == "wait" and outcomes == {"paused"}:
            # The pause ended this invocation, not the wait: its real end was never observed.
            unknown.add("open-wait")
        elif valid:
            lo, hi = starts[0]["captured_at_ms"], finishes[0]["captured_at_ms"]
            if hi >= lo:
                interval = (lo, hi)
                union_intervals.append(interval)
            else:
                unknown.add("clock-invalid")
        elif finishes:
            unknown.add("conflicting-terminal")
        else:
            unknown.add("missing-end")
        # An end without its own context inherits the begin's candidate; only an explicit
        # override observed at the end can make the step's attribution mixed.
        if finishes and _candidate(run_context, finishes[0]["request"], begin_candidate) != begin_candidate:
            mixed += 1
        parent = first.get("parent_step_id")
        if parent is not None and parent not in begins:
            unknown_parents += 1
            unknown.add("missing-reference")
        if any(sig[0] == "fix" for sig in sigs) and (len(sigs) > 1 or (finishes and not valid)):
            fix_invalid = True  # a fix step declared or closed inconsistently: its cycle cannot be counted
        if first.get("kind") == "fix":
            fix_started += 1
            if outcomes == {"completed"}:
                fix_completed += 1
        if first.get("kind") == "wait":
            slot = wait_data.setdefault(first["wait_category"], {"intervals": [], "count": 0, "unknown": 0})
            slot["count"] += 1
        elif first.get("phase"):
            slot = _phase_slot(phase_data, first["phase"])
            slot["started"] += 1
            if outcomes == {"completed"}:
                slot["completed"] += 1
        else:
            continue
        if interval is not None:
            slot["intervals"].append(interval)
        else:
            slot["unknown"] += 1
    # One decision per (step_id, phase): distinct-ID repeats of the same choice count once;
    # differing choices for the same decision are a conflict and count as none.
    choices, legacy = {}, {}
    for record in decisions:
        req = record["request"]
        key = (req["step_id"], req["phase"])
        choices.setdefault(key, set()).add((req["decision"], req["reason"]))
        legacy.setdefault(key, _legacy_pairing(record["producer_version"]))
    # A RUN decision is timed by the begun step that shares its step_id and phase (a `tests`
    # decision may also name its enclosing `pregate` step). The run step never times a decision.
    first_of = {step_id: recs[0]["request"] for step_id, recs in begins.items()}
    paired, unpaired = {}, {}
    for (step_id, phase), made in choices.items():
        slot = _phase_slot(phase_data, phase)
        if len(made) != 1:
            unknown.add("conflicting-terminal")
            continue
        choice = next(iter(made))[0]
        slot["decisions"][choice] += 1
        if choice != "RUN":
            continue
        step = first_of.get(step_id)
        if (step is not None and step.get("kind") != "run"
                and (step.get("phase") == phase or (phase == "tests" and step.get("phase") == "pregate"))):
            paired.setdefault(phase, set()).add(step_id)
        else:
            unpaired.setdefault(phase, []).append(legacy[(step_id, phase)])
    # Older producers minted fresh decision IDs: an unpaired older decision is covered by one
    # unpaired top-level step of its phase (a step nested under a same-phase step never covers).
    untimed = 0
    for phase, flags in unpaired.items():
        spare = 0
        if any(flags):
            spare = sum(1 for step_id, step in first_of.items()
                        if step.get("kind") != "run" and step.get("phase") == phase
                        and step_id not in paired.get(phase, ())
                        and first_of.get(step.get("parent_step_id"), {}).get("phase") != phase)
        left = len(flags) - min(sum(flags), spare)
        if left:
            phase_data[phase]["unknown"] += left
            untimed += left
    if untimed:
        unknown.add("unrecorded-work")
    phases = [{"phase": phase, "decisions": slot["decisions"], "steps_started": slot["started"],
               "steps_completed": slot["completed"],
               "observed_wall_duration_ms": None if slot["unknown"] else _union_ms(slot["intervals"]),
               "unknown_durations": slot["unknown"]}
              for phase, slot in sorted(phase_data.items())]
    waits = [{"wait_category": cat, "count": slot["count"],
              "observed_wall_duration_ms": None if slot["unknown"] else _union_ms(slot["intervals"]),
              "unknown_durations": slot["unknown"]} for cat, slot in sorted(wait_data.items())]
    return ({"ids": set(begins) | set(ends), "unknown_parents": unknown_parents, "mixed_candidate": mixed,
             "fix_started": fix_started, "fix_invalid": fix_invalid},
            phases, waits, union_intervals, fix_completed)


def _correction_counts(effective):
    counts = {"retry": 0, "fallback": 0, "parent": 0, "finding": 0, "fix-cycle": 0}
    for record in effective:
        if record["op"] == "correction":
            counts[record["request"]["correction_kind"]] += 1
    return counts


def _supersede_map(effective, by_event, unknown):
    mapping = {}
    for record in effective:
        if record["op"] != "correction":
            continue
        target = record["request"].get("supersedes_event_id")
        if target is None:
            continue
        if target not in by_event:
            unknown.add("missing-reference")
            continue
        mapping.setdefault(target, []).append(record)
    for target, items in mapping.items():
        if sum(1 for item in items if item["request"]["correction_kind"] != "finding") > 1:
            unknown.add("competing-correction")
    selections = {}
    for target, items in mapping.items():
        kept = [item for item in items if item["request"]["correction_kind"] != "finding"]
        if kept:
            selections[target] = kept
    return selections


def _effective_selection(record, mapping, unknown):
    """selected_attempt_id after an unambiguous acyclic supersession chain, or None when unknown."""
    selected = record["request"].get("selected_attempt_id")
    seen, current = set(), record["event_id"]
    while current in mapping:
        if current in seen:
            unknown.add("competing-correction")
            return None
        seen.add(current)
        items = mapping[current]
        if len(items) != 1:
            return None
        correction = items[0]
        if correction["request"].get("selected_attempt_id"):
            selected = correction["request"]["selected_attempt_id"]
        current = correction["event_id"]
    return selected


def _unknown_totals():
    return {"accepted": None, "fixed": None, "open": None, "rejected": None, "deferred": None,
            "duplicate": None, "unclassified": None,
            "by_normalized_severity": {k: None for k in ("critical", "high", "medium", "low", "info",
                                                         "unclassified")}}


def _finding_totals(selected, corrections, unknown, known_ids):
    """selected: [(pass_id, voice_id, attempt_id, finding)] -> totals, or all-None when a correction
    or duplicate link is ambiguous. A correction targets exactly one finding by its origin (finding_id
    plus any pass/voice/attempt it names) and applies only as one linear supersession chain in append
    order: each later correction supersedes its predecessor. Anything else is unknown, never last-write-wins."""
    totals = {"accepted": 0, "fixed": 0, "open": 0, "rejected": 0, "deferred": 0,
              "duplicate": 0, "unclassified": 0,
              "by_normalized_severity": {"critical": 0, "high": 0, "medium": 0, "low": 0,
                                         "info": 0, "unclassified": 0}}
    findings = [(p, v, a, dict(f)) for p, v, a, f in selected]
    competing = dangling = False
    chains = {}
    index = _index(findings)
    for correction in corrections:
        targets = _targets(findings, index, correction)
        # A duplicate claim needs its duplicate_of link, which only the finding record carries.
        if len(targets) != 1 or correction.get("adjudication") == "duplicate":
            competing = True
            continue
        chains.setdefault(targets[0], []).append(correction)
    for index, items in chains.items():
        ids = {c["event_id"] for c in items}
        linear = items[0].get("supersedes_event_id") not in ids and all(
            items[k].get("supersedes_event_id") == items[k - 1]["event_id"] for k in range(1, len(items)))
        if not linear:
            competing = True
            continue
        target = findings[index][3]
        for correction in items:
            if correction.get("adjudication"):
                target["adjudication"] = correction["adjudication"]
            if correction.get("resolution"):
                target["resolution"] = correction["resolution"]
            if target["adjudication"] in ("rejected", "duplicate"):
                target["resolution"] = "unknown"
    if any(f["duplicate_of"] is not None and f["duplicate_of"] not in known_ids for _p, _v, _a, f in findings):
        dangling = True
    if competing:
        unknown.add("competing-correction")
    if dangling:
        unknown.add("missing-reference")
    if competing or dangling:
        return _unknown_totals()
    for _p, _v, _a, finding in findings:
        adj, res = finding["adjudication"], finding["resolution"]
        totals["by_normalized_severity"][NORMALIZED[finding["severity_source"]]] += 1
        if adj == "accepted":
            totals["accepted"] += 1
            if res == "fixed":
                totals["fixed"] += 1
            elif res == "open":
                totals["open"] += 1
        elif adj in totals:
            totals[adj] += 1
    return totals


def _index(findings):
    index = {}
    for position, (_p, _v, _a, finding) in enumerate(findings):
        index.setdefault(finding["finding_id"], []).append(position)
    return index


def _targets(findings, index, correction):
    """Positions of the findings a correction names: its finding_id plus any pass/voice/attempt it gives."""
    return [i for i in index.get(correction.get("finding_id"), [])
            if correction.get("pass_id") in (None, findings[i][0])
            and correction.get("voice_id") in (None, findings[i][1])
            and correction.get("attempt_id") in (None, findings[i][2])]


def _passes(effective, by_event, run_context, unknown, ran):
    mapping = _supersede_map(effective, by_event, unknown)
    finding_corrections = [r["request"] for r in effective
                           if r["op"] == "correction" and r["request"]["correction_kind"] == "finding"]
    known_ids = {f["finding_id"] for r in effective
                 if r["op"] == "pass" and r["request"]["state"] == "attempt"
                 for f in r["request"].get("findings") or []}
    grouped = {}
    for record in effective:
        if record["op"] != "pass":
            continue
        slot = grouped.setdefault(record["request"]["pass_id"],
                                  {"all": [], "started": [], "attempts": {}, "voice": {}, "completed": []})
        req = record["request"]
        slot["all"].append(record)
        if req["state"] == "started":
            slot["started"].append(record)
        elif req["state"] == "attempt":
            slot["attempts"].setdefault(req["attempt_id"], []).append(record)
        elif req["state"] == "voice-complete":
            slot["voice"].setdefault(req["voice_id"], []).append(record)
        else:
            slot["completed"].append(record)
    out = {scope: {"attempted": 0, "completed": 0, "findings": None} for scope in ("local", "greptile")}
    excluded_na = 0
    selected_by_scope = {"local": [], "greptile": []}
    scope_bad = {"local": False, "greptile": False}
    completed_unknown = {"local": False, "greptile": False}
    scope_unknown = {"local": False, "greptile": False}
    seen = set()
    pass_scope = {}
    for pass_id, slot in grouped.items():
        scopes = {r["request"]["scope"] for r in slot["all"]}
        seen |= scopes
        if not slot["started"]:
            # Orphaned pass records: that scope's counts cannot be zero or complete.
            unknown.add("missing-reference")
            for scope in scopes:
                scope_unknown[scope] = True
            continue
        if len(scopes) != 1:
            unknown.add("conflicting-terminal")
            for scope in scopes:
                scope_unknown[scope] = True
            continue
        starts = slot["started"]
        voice_sets = {tuple(r["request"]["required_voice_ids"]) for r in starts}
        candidates = {_candidate(run_context, r["request"]) for r in starts}
        scope = next(iter(scopes))
        if len(voice_sets) != 1 or len(candidates) != 1:
            unknown.add("conflicting-terminal")
            scope_unknown[scope] = True
            continue
        pass_scope[pass_id] = scope
        required = list(voice_sets.pop())
        candidate = candidates.pop()
        out[scope]["attempted"] += 1
        closed, selected = True, []
        for voice in required:
            declarations = slot["voice"].get(voice, [])
            if len(declarations) != 1:
                closed = False
                if len(declarations) > 1:
                    unknown.add("conflicting-terminal")
                continue
            declaration = declarations[0]["request"]
            if declaration["voice_status"] == "not-applicable":
                excluded_na += 1
                continue
            attempt_id = _effective_selection(declarations[0], mapping, unknown)
            attempts = slot["attempts"].get(attempt_id or "", [])
            if len(attempts) != 1:
                closed = False
                unknown.add("missing-reference")
                continue
            attempt = attempts[0]["request"]
            if attempt["voice_id"] != voice or attempt["attempt_outcome"] != "completed":
                closed = False
                unknown.add("incomplete-pass")
                continue
            # An attempt inherits its pass's candidate; only an explicit different override is cross-candidate.
            if _candidate(run_context, attempt, candidate) != candidate:
                closed = False
                unknown.add("cross-candidate")
                continue
            selected.extend((pass_id, voice, attempt_id, f) for f in attempt["findings"])
        completed = bool(slot["completed"])
        if completed and closed:
            out[scope]["completed"] += 1
            selected_by_scope[scope].extend(selected)
        else:
            scope_bad[scope] = True
            unknown.add("incomplete-pass")
            if completed:
                completed_unknown[scope] = True
    # Review work recorded as a phase but with no pass records at all: unknown, not zero.
    for scope, phase in (("local", "local-pass"), ("greptile", "external-review")):
        if phase in ran and scope not in seen:
            scope_unknown[scope] = True
            unknown.add("unrecorded-work")
    # Resolve each finding correction once across every selected finding in the run, so one
    # correction never lands in two scopes and an unmatched one is never silently dropped.
    pool = [(scope, item) for scope in ("local", "greptile") for item in selected_by_scope[scope]]
    pool_findings = [item for _scope, item in pool]
    pool_index = _index(pool_findings)
    recorded = [(r["request"]["pass_id"], r["request"]["voice_id"], r["request"]["attempt_id"], f)
                for r in effective if r["op"] == "pass" and r["request"]["state"] == "attempt"
                for f in r["request"].get("findings") or []]
    recorded_index = _index(recorded)
    routed = {"local": [], "greptile": []}
    tainted = set()
    for correction in finding_corrections:
        hits = _targets(pool_findings, pool_index, correction)
        if len(hits) == 1:
            routed[pool[hits[0]][0]].append(correction)
            continue
        if not hits and _targets(recorded, recorded_index, correction):
            # The finding exists but is not counted (an unclosed pass or an unselected attempt):
            # its scope is already unknown or unaffected, so this is neither missing nor ambiguous.
            continue
        named = pass_scope.get(correction.get("pass_id"))
        tainted |= {pool[i][0] for i in hits} or ({named} if named else {"local", "greptile"})
        unknown.add("competing-correction" if hits else "missing-reference")
    for scope in ("local", "greptile"):
        if scope_unknown[scope]:
            out[scope] = {"attempted": None, "completed": None, "findings": None}
            continue
        if completed_unknown[scope]:
            out[scope]["completed"] = None
        if out[scope]["completed"] and not scope_bad[scope]:
            out[scope]["findings"] = (_unknown_totals() if scope in tainted else
                                      _finding_totals(selected_by_scope[scope], routed[scope], unknown, known_ids))
    return {"local": out["local"], "greptile": out["greptile"], "excluded_na": excluded_na}


def _fmt(value):
    return "unknown" if value is None else str(value)


def receipt_text(data):
    findings = data.get("findings") or {}
    greptile = data.get("greptile_findings") or {}
    # partial means stored records are broken or contradict each other; an in-progress run
    # (open steps, unfinished passes) stays ok and names its unknowns below.
    status = data.get("capture", "unavailable")
    text = ("Workflow metrics (local, optional): capture=" + status
            + "; clock=utc-wall clock-sensitive; qualified_elapsed=unknown (unavailable-clock-domain)"
            + "; local_passes=" + _fmt(data.get("local_passes"))
            + "; local_attempted=" + _fmt(data.get("local_attempted"))
            + "; greptile_passes=" + _fmt(data.get("greptile_passes"))
            + "; fix_cycles=" + _fmt(data.get("fix_cycles"))
            + "; local_findings accepted=" + _fmt(findings.get("accepted"))
            + " fixed=" + _fmt(findings.get("fixed")) + " open=" + _fmt(findings.get("open"))
            + " rejected=" + _fmt(findings.get("rejected")) + " deferred=" + _fmt(findings.get("deferred"))
            + " duplicate=" + _fmt(findings.get("duplicate"))
            + "; greptile_findings accepted=" + _fmt(greptile.get("accepted"))
            + " fixed=" + _fmt(greptile.get("fixed")) + " open=" + _fmt(greptile.get("open"))
            + "; na_voices=" + _fmt(data.get("excluded_na_voices"))
            + "; union_wall_ms=" + _fmt(data.get("union_observed_wall_ms"))
            + "; unknown=" + (",".join(data.get("unknown_reasons") or []) or "none") + ".")
    if len(text.encode()) > RECEIPT_LIMIT:
        text = "Workflow metrics (local, optional): capture=" + status + "."
    return text


HELP = """Usage: gstack-extend-telemetry metrics <operation>
Operations: begin, end, decision, pass, correction, read.
Producers take exactly one JSON object (v=1) on stdin (16 KiB max) and print one
JSON result envelope; inspect its status, the launcher always exits 0.
metrics <operation> --help shows that operation's fields. metrics read takes
--session-id <extend-UUID> [--event-id <UUID>] and never writes.
Detailed capture inherits provenance and GSTACK_EXTEND_WORKFLOW_METRICS=off disables
it. Wall durations are utc-wall and clock-sensitive; qualified elapsed is unavailable.
See docs/telemetry.md#workflow-metrics."""

OP_HELP = {
    "begin": "begin: v, stage, session_id, event_id, step_id, parent_step_id, kind=run|phase|voice|wait|fix; "
             "kind=run needs phase=run and a full context and binds to the exact legacy start handoff; "
             "kind=wait needs wait_category; other kinds need a controlled phase.",
    "end": "end: v, stage, session_id, event_id, step_id, outcome=completed|failed|paused|cancelled; "
           "optional candidate context override.",
    "decision": "decision: v, stage, session_id, event_id, step_id, phase, decision=RUN|REUSE|N/A, "
                "reason (controlled). One per visited phase; begin/end only around executed work.",
    "pass": "pass: v, stage, session_id, event_id, pass_id, scope=local|greptile, "
            "state=started|attempt|voice-complete|completed with that state's fields; a completed attempt "
            "carries findings (empty means zero); voice-complete selects one attempt or records N/A.",
    "correction": "correction: v, stage, session_id, event_id, correction_kind=retry|fallback|parent|finding|fix-cycle "
                  "plus the explicit referenced IDs for that kind; corrections append, never rewrite.",
    "read": "read: --session-id <extend-UUID> [--event-id <UUID>]. Observation-free named-run summary "
            "(16 KiB max) or one event's digest/timestamp for reconciliation. Receipt text is at most 2 KiB.",
}


def read_op(args):
    session_id, event_id = None, None
    items = list(args)
    while items:
        flag = items.pop(0)
        if flag == "--session-id" and items and session_id is None:
            session_id = items.pop(0)
        elif flag == "--event-id" and items and event_id is None:
            event_id = items.pop(0)
        else:
            raise Fail("unavailable", "invalid-input", field="argv", cause="unexpected-argv")
    if session_id is None or not SESSION_RE.fullmatch(session_id):
        raise Fail("unavailable", "invalid-input", field="session_id", expected="extend-uuid")
    if event_id is not None and not UUID_RE.fullmatch(event_id):
        raise Fail("unavailable", "invalid-input", field="event_id", expected="uuid")
    paths = run_paths(session_id)
    fd = _open_ledger_read(paths)
    if fd is None:
        raise Fail("unavailable", "capture-missing", cause="no-run-file")
    try:
        data, overflow = _read_snapshot(fd)
    finally:
        os.close(fd)
    records, malformed, partial_tail = parse_ledger(data, overflow)
    summary = summarize(records, malformed, partial_tail, overflow)
    valid_snapshot = not malformed and not partial_tail and not overflow
    if event_id is not None:
        match = next((r for r in records if r["event_id"] == event_id), None)
        if match is not None:
            summary["event"] = {"status": "match", "request_digest": match["request_digest"],
                                "captured_at_ms": match["captured_at_ms"]}
        elif valid_snapshot:
            summary["event"] = {"status": "absent", "request_digest": None, "captured_at_ms": None}
        else:
            summary["event"] = {"status": "unknown", "request_digest": None, "captured_at_ms": None}
    # Broken references and event conflicts make the read partial too (S4), not only bad bytes.
    if summary["capture"] == "ok":
        status, reason = "ok", None
    elif partial_tail:
        status, reason = "partial", "partial-tail"
    elif malformed or "event-conflict" not in summary["unknown_reasons"]:
        status, reason = "partial", "malformed-record"
    else:
        status, reason = "partial", "event-conflict"
    summary["receipt_text"] = receipt_text(summary)
    return status, reason, summary


def main(args):
    if not args or args[0] in ("-h", "--help"):
        print(HELP)
        return
    op = args[0]
    if op in OP_HELP and len(args) == 2 and args[1] in ("-h", "--help"):
        print(OP_HELP[op] + "\nSee docs/telemetry.md#workflow-metrics.")
        return
    if op not in OPS:
        fail = Fail("unavailable", "invalid-input", field="operation", expected="|".join(OPS))
        emit(fail.status, fail.reason, None, None, None, "unknown", fail)
        return
    sources = []
    session_id = event_id = None
    try:
        disabled, sources = metrics_disabled()
        if disabled:
            fail = Fail("disabled", "capture-disabled")
            emit("disabled", "capture-disabled", None, None, {"capture": "disabled"}, op, fail, sources)
            return
        if op == "read":
            if len(args) < 2:
                raise Fail("unavailable", "invalid-input", field="argv", cause="unexpected-argv")
            sid = args[args.index("--session-id") + 1] if "--session-id" in args and args.index("--session-id") + 1 < len(args) else None
            session_id = sid if sid and SESSION_RE.fullmatch(sid) else None
            status, reason, data = read_op(args[1:])
            fail = Fail(status, reason) if reason else None
            emit(status, reason, sid, None, data, op, fail, sources)
            return
        if len(args) != 1:
            raise Fail("unavailable", "invalid-input", field="argv", cause="unexpected-argv")
        req = validate_request(op, parse_request(read_stdin()))
        session_id, event_id = req["session_id"], req["event_id"]
        status, data = mutate(op, req)
        emit(status, None, session_id, event_id, data, op, None, sources)
    except Fail as fail:
        emit(fail.status, fail.reason, session_id, event_id, None, op, fail, sources)
    except (ValueError, TypeError) as error:
        fail = Fail("unavailable", "invalid-input", cause=type(error).__name__.lower())
        emit(fail.status, fail.reason, session_id, event_id, None, op, fail, sources)
    except (ImportError, OSError) as error:
        fail = Fail("unavailable", "io-error", cause=type(error).__name__.lower())
        emit(fail.status, fail.reason, session_id, event_id, None, op, fail, sources)
    except Exception as error:  # unexpected: sanitized trace only (basename, line, class)
        fail = Fail("unavailable", "io-error", cause="unexpected", side_effects="unknown")
        frames = traceback.extract_tb(error.__traceback__)
        if frames:
            last = frames[-1]
            fail.trace = {"file": Path(last.filename).name, "line": last.lineno,
                          "exception_class": type(error).__name__}
        emit(fail.status, fail.reason, session_id, event_id, None, op, fail, sources)
