#!/usr/bin/env python3
"""Session-log token usage collector for workflow-metrics v2 usage records."""

from __future__ import annotations

import datetime
import hashlib
import json
import math
import os
import re
import stat
import sys
import time
import uuid
from pathlib import Path
from typing import Any

_LIB_DIR = str(Path(__file__).resolve().parent)
if not sys.path or sys.path[0] != _LIB_DIR:
    sys.path.insert(0, _LIB_DIR)

from quota.common import CLASSES  # noqa: E402
from quota.usage import parse_record, prefer, tokens  # noqa: E402
from telemetry import parse_ts  # noqa: E402

MAX_TAIL_BYTES = 32 * 1024 * 1024
SCAN_BUDGET_S = 3.0
SCAN_BUDGET_BYTES = 64 * 1024 * 1024

VOICES_MAX_FILES = 64
VOICES_MAX_BYTES = 1024 * 1024
VOICES_MAX_DEPTH = 4

MAX_SOURCES = 64
MAX_BUCKETS = 256
MAX_WINDOWS = 8
MAX_CLI_REPORTED = 64
MAX_MODELS_PER_SOURCE = 16

SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
SESSION_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,128}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

_FORBIDDEN_NAMES = frozenset({
    ".claude.json",
    ".credentials.json",
    "auth.json",
    "hosts.yml",
    "cli-config.json",
    "jev.json",
})
_FORBIDDEN_DIRS = frozenset({".ssh", "Keychains"})


class _DigestShim:
    """Stateless SHA-256 digest shim for quota.usage.parse_record."""

    @staticmethod
    def digest(value: Any, namespace: str) -> str:
        raw = f"{namespace}\0{value}".encode("utf-8")
        return hashlib.sha256(raw).hexdigest()


_SHIM = _DigestShim()


class _Budget:
    def __init__(self, seconds: float, byte_limit: int) -> None:
        self.deadline = time.monotonic() + seconds
        self.byte_limit = byte_limit
        self.bytes_read = 0
        self.exhausted = False
        self.discovery_failed = False

    def check(self) -> bool:
        if self.exhausted:
            return False
        if not self.check_time() or self.bytes_read >= self.byte_limit:
            self.exhausted = True
            return False
        return True

    def check_time(self) -> bool:
        # Reaching the input limit stops reads, not processing of buffered facts.
        if time.monotonic() >= self.deadline:
            self.exhausted = True
            return False
        return True

    def reserve(self, requested: int) -> int:
        if not self.check():
            return 0
        remaining = self.byte_limit - self.bytes_read
        # readline may consume far less than its allowance; charge actual bytes.
        return max(0, min(requested, remaining))

    def charge(self, count: int) -> None:
        self.bytes_read += count
        if self.bytes_read >= self.byte_limit or time.monotonic() >= self.deadline:
            self.exhausted = True


def _entries(path: Path, budget: _Budget):
    """Bound directory discovery too; eager glob/sorted(scandir()) cannot stop."""
    if not budget.check():
        return
    try:
        with os.scandir(path) as entries:
            for entry in entries:
                if not budget.check():
                    return
                yield entry
    except OSError:
        budget.discovery_failed = True
        return


def _own_logs(agent: str, session: str, config: Path, budget: _Budget):
    # Same directory layouts as telemetry.claude_logs/codex_logs, walked lazily
    # because their list-returning globs run outside the capture deadline.
    levels = 1 if agent == "claude" else 3
    root = config / ("projects" if agent == "claude" else "sessions")

    def walk(directory: Path, depth: int):
        for entry in _entries(directory, budget):
            if entry.is_symlink():
                continue
            if depth and entry.is_dir(follow_symlinks=False):
                yield from walk(Path(entry.path), depth - 1)
            elif not depth and entry.is_file(follow_symlinks=False):
                name = entry.name
                if (agent == "claude" and name == session + ".jsonl") or (
                    agent == "codex" and name.startswith("rollout-") and name.endswith("-" + session + ".jsonl")
                ):
                    yield Path(entry.path)
    yield from walk(root, levels)


def _source_ref(agent: str, raw_id: str) -> str:
    return hashlib.sha256(f"{agent}:{raw_id}".encode("utf-8")).hexdigest()


def _usage_event_id(sid: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "gstack-extend:usage:" + str(sid)))


def _safe_stat_regular(path: Path) -> os.stat_result | None:
    try:
        parts = path.parts
        if any(d in _FORBIDDEN_DIRS for d in parts):
            return None
        name = path.name
        if name in _FORBIDDEN_NAMES or name.startswith(".env"):
            return None
        st = os.lstat(path)
    except OSError:
        return None
    if not stat.S_ISREG(st.st_mode):
        return None
    return st


def _inside_root(candidate_cwd: Any, root: Any) -> bool:
    if not isinstance(candidate_cwd, str) or not candidate_cwd.strip():
        return False
    if not isinstance(root, str) or not root.strip():
        return False
    try:
        nc = os.path.normpath(candidate_cwd)
        nr = os.path.normpath(root)
        if nc == nr or nc.startswith(nr.rstrip("/") + "/"):
            return True
        rc = os.path.realpath(candidate_cwd)
        rr = os.path.realpath(root)
        return rc == rr or rc.startswith(rr.rstrip("/") + "/")
    except OSError:
        return False


def _clean_model(model: Any) -> tuple[str | None, bool]:
    """Return (valid_model_or_none, was_invalid_nonempty)."""
    if model is None:
        return None, False
    if isinstance(model, str) and SAFE_ID_RE.fullmatch(model):
        return model, False
    return None, True


def _nonneg_int_or_none(val: Any) -> int | None:
    if type(val) is int and val >= 0:
        return val
    return None


def _pos_int_or_none(val: Any) -> int | None:
    if type(val) is int and val >= 1:
        return val
    return None


class _SourceAcc:
    def __init__(
        self,
        agent: str,
        raw_id: str,
        relation: str,
        evidence: str,
        parent_ref: str | None = None,
        parent_raw_id: str | None = None,
    ) -> None:
        self.agent = agent
        self.raw_id = raw_id
        self.ref = _source_ref(agent, raw_id)
        self.relation = relation
        self.evidence = evidence
        self.parent_ref = parent_ref
        self.parent_raw_id = parent_raw_id
        self.link: dict[str, Any] | None = None
        self.link_evidence: str | None = None
        self.reasons: set[str] = set()
        if agent == "claude":
            self.reasons.add("window-not-reported")
        self.complete = True
        self.cwd: str | None = None
        self.parent_thread_id: str | None = None
        self.has_parent_link = False
        self.original_start_known = False
        self.spawn_depth: int | None = None
        self.tool_use_id: str | None = None
        self.emitted_tool_use_ids: set[str] = set()
        self.all_first_ms: int | None = None
        self.all_last_ms: int | None = None
        self.in_first_ms: int | None = None
        self.in_last_ms: int | None = None
        self.post_end_record = False
        self.all_fact_last_ms: int | None = None
        self.first_fact_ms: int | None = None
        self.first_fact_step_hi: int | None = None
        self.rate_readings: dict[str, list[dict[str, Any]]] = {"primary": [], "secondary": []}

    def note_record_ts(self, ts_ms: int, begin_ms: int, end_ms: int) -> None:
        if self.all_first_ms is None or ts_ms < self.all_first_ms:
            self.all_first_ms = ts_ms
        if self.all_last_ms is None or ts_ms > self.all_last_ms:
            self.all_last_ms = ts_ms
        if begin_ms <= ts_ms < end_ms:
            if self.in_first_ms is None or ts_ms < self.in_first_ms:
                self.in_first_ms = ts_ms
            if self.in_last_ms is None or ts_ms > self.in_last_ms:
                self.in_last_ms = ts_ms
        if ts_ms >= end_ms:
            self.post_end_record = True

    def note_fact_ts(self, ts_ms: int, begin_ms: int, end_ms: int) -> None:
        self.all_fact_last_ms = max(self.all_fact_last_ms or ts_ms, ts_ms)
        if begin_ms <= ts_ms < end_ms:
            self.first_fact_ms = min(self.first_fact_ms or ts_ms, ts_ms)
        self.note_record_ts(ts_ms, begin_ms, end_ms)


class _Facts(dict):
    """Deduplicated facts with incremental aggregates; deadline finalization is bounded."""
    def __init__(self, steps, budget):
        super().__init__()
        self.steps = steps
        self.budget = budget
        self.groups = {}
        self.compacted = False
        self.capacity = False

    def _adjust(self, item, sign):
        if self.capacity:
            return
        source, fact = item
        model, invalid = _clean_model(fact.get("model"))
        if invalid:
            source.reasons.add("unsupported")
        if sign < 0:
            placement, step_id = fact.get("_usage_placement", ("outside-steps", None))
        else:
            timestamp = int(round(float(fact["ts"]) * 1000))
            placement, step_id = _place_step(timestamp, self.steps, self.budget)
            fact["_usage_placement"] = (placement, step_id)
            if timestamp == source.first_fact_ms:
                source.first_fact_step_hi = self.steps[step_id][1] if placement == "step" else None
        if self.compacted:
            placement, step_id = "outside-steps", None
        bucket_group = (source.ref, model, placement, step_id)
        if bucket_group not in self.groups and len(self.groups) >= MAX_BUCKETS and not self.compacted:
            compact = {}
            for (ref, old_model, _placement, _step), old in self.groups.items():
                merged = compact.setdefault((ref, old_model, "outside-steps", None),
                                           {"responses": 0, "sums": {c: 0 for c in CLASSES}, "nulls": {c: 0 for c in CLASSES}})
                merged["responses"] += old["responses"]
                for cls in CLASSES:
                    merged["sums"][cls] += old["sums"][cls]
                    merged["nulls"][cls] += old["nulls"][cls]
            self.groups = compact
            self.compacted = True
            bucket_group = (source.ref, model, "outside-steps", None)
        if bucket_group not in self.groups and len(self.groups) >= MAX_SOURCES * MAX_MODELS_PER_SOURCE:
            self.capacity = True
            self.groups.clear()
            return
        group = self.groups.setdefault(bucket_group, {"responses": 0, "sums": {c: 0 for c in CLASSES}, "nulls": {c: 0 for c in CLASSES}})
        group["responses"] += sign
        for cls in CLASSES:
            value = fact["tokens"].get(cls)
            if value is None:
                group["nulls"][cls] += sign
            else:
                group["sums"][cls] += sign * int(value)
        if not group["responses"]:
            del self.groups[bucket_group]

    def __setitem__(self, key, value):
        if key in self:
            self._adjust(self[key], -1)
        super().__setitem__(key, value)
        self._adjust(value, 1)

    def __delitem__(self, key):
        self._adjust(self[key], -1)
        super().__delitem__(key)


def _merge_fact(facts, source, fact):
    previous = facts.get(fact["id"])
    if previous is None:
        facts[fact["id"]] = (source, fact)
        return
    old_source, old_fact = previous
    # Direct membership wins over a merely correlated candidate, including copies
    # in a resumed session. Within direct sources preserve child ownership.
    if old_source.evidence == "direct" and source.evidence != "direct":
        return
    if old_source.evidence != "direct" and source.evidence == "direct":
        facts[fact["id"]] = (source, fact)
        return
    owner = source if old_source.relation == "own" and source.relation != "own" else old_source
    facts[fact["id"]] = (owner, prefer(old_fact, fact))


def _extract_codex_windows(
    acc: _SourceAcc,
    percent_list: list[dict[str, Any]],
    begin_ms: int,
    end_ms: int,
) -> None:
    for entry in percent_list:
        ts = entry.get("ts")
        limits = entry.get("limits")
        if ts is None or not isinstance(limits, dict):
            continue
        ts_ms = int(round(float(ts) * 1000))
        if not (begin_ms <= ts_ms < end_ms):
            continue
        raw_lid = limits.get("limit_id", limits.get("limitId"))
        limit_id = raw_lid if isinstance(raw_lid, str) and SAFE_ID_RE.fullmatch(raw_lid) else None
        for slot_name in ("primary", "secondary"):
            slot_obj = limits.get(slot_name)
            if not isinstance(slot_obj, dict):
                continue
            raw_win = slot_obj.get("window_minutes", slot_obj.get("windowDurationMins"))
            win_mins = raw_win if type(raw_win) is int and raw_win >= 1 else None
            raw_pct = slot_obj.get("used_percent", slot_obj.get("usedPercent"))
            used_pct: int | float | None = None
            if type(raw_pct) in (int, float) and math.isfinite(raw_pct) and 0 <= raw_pct <= 1000:
                used_pct = raw_pct
            raw_resets = slot_obj.get("resets_at", slot_obj.get("resetsAt"))
            resets_at: int | None = None
            if type(raw_resets) is int and raw_resets >= 0:
                resets_at = raw_resets
            elif isinstance(raw_resets, str):
                parsed_r = parse_ts(raw_resets)
                if parsed_r is not None and parsed_r >= 0:
                    resets_at = int(round(parsed_r))
            reading = {
                "slot": slot_name,
                "limit_id": limit_id,
                "window_minutes": win_mins,
                "used_percent": used_pct,
                "resets_at": resets_at,
                "ts_ms": ts_ms,
                "reset_crossed": False,
                "attributable": False,
            }
            readings = acc.rate_readings[slot_name]
            if not readings:
                readings.append(reading)
            else:
                previous = readings[-1]
                crossed = previous["reset_crossed"]
                if previous["resets_at"] is not None and resets_at is not None:
                    crossed = crossed or abs(previous["resets_at"] - resets_at) > 60
                if previous["used_percent"] is not None and used_pct is not None:
                    crossed = crossed or used_pct < previous["used_percent"]
                ordered = sorted(readings + [reading], key=lambda r: r["ts_ms"])
                first, last = dict(ordered[0]), dict(ordered[-1])
                first["reset_crossed"] = False
                last["reset_crossed"] = crossed
                acc.rate_readings[slot_name] = [first, last]


def _build_windows_for_source(acc: _SourceAcc) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for slot_name in ("primary", "secondary"):
        readings = acc.rate_readings.get(slot_name) or []
        if not readings:
            continue
        readings_sorted = sorted(readings, key=lambda r: r["ts_ms"])
        first = dict(readings_sorted[0])
        if len(readings_sorted) == 1:
            first["reset_crossed"] = False
            out.append(first)
            continue
        last = dict(readings_sorted[-1])
        crossed = last["reset_crossed"]
        pairs = list(zip(readings_sorted, readings_sorted[1:])) + [(first, last)]
        for prev_r, next_r in pairs:
            r1, r2 = prev_r.get("resets_at"), next_r.get("resets_at")
            if r1 is not None and r2 is not None and abs(r2 - r1) > 60:
                crossed = True
            p1, p2 = prev_r.get("used_percent"), next_r.get("used_percent")
            if p1 is not None and p2 is not None and p2 < p1:
                crossed = True
        first["reset_crossed"] = False
        last["reset_crossed"] = crossed
        out.append(first)
        out.append(last)
    return out


def _read_file_lines(
    path: Path,
    budget: _Budget,
    tail: bool,
    is_codex: bool,
) -> tuple[bytes | None, list[bytes], int, bool, bool]:
    """Return (line0_bytes_if_midfile_codex, lines, offset, truncated_by_budget, stat_ok)."""
    st = _safe_stat_regular(path)
    if st is None:
        return None, [], 0, False, False
    size = st.st_size
    if size == 0:
        return None, [], 0, False, True
    if not budget.check():
        return None, [], 0, True, True

    offset = max(0, size - MAX_TAIL_BYTES) if tail else 0
    if not tail and size > MAX_TAIL_BYTES:
        offset = max(0, size - MAX_TAIL_BYTES)

    line0: bytes | None = None
    try:
        with path.open("rb") as stream:
            if offset > 0:
                allow0 = budget.reserve(min(MAX_TAIL_BYTES, size))
                if allow0 <= 0 and budget.exhausted:
                    return None, [], offset, True, True
                raw0 = stream.readline(allow0)
                budget.charge(len(raw0))
                if raw0.endswith(b"\n"):
                    line0 = raw0.rstrip(b"\r\n")
            stream.seek(offset)
            to_read = size - offset
            allow = budget.reserve(to_read)
            chunk = stream.read(allow) if allow > 0 else b""
            budget.charge(len(chunk))
            hit_budget = allow < to_read or budget.exhausted
    except OSError:
        return None, [], 0, False, False

    if not chunk:
        return line0, [], offset, hit_budget, True

    raw_lines = chunk.split(b"\n")
    if raw_lines and raw_lines[-1] == b"":
        raw_lines.pop()
    elif hit_budget and raw_lines:
        # Drop incomplete trailing line cut by byte budget.
        raw_lines.pop()

    if offset > 0 and raw_lines:
        # Drop partial first line when seeking mid-file.
        raw_lines = raw_lines[1:]

    return line0, raw_lines, offset, hit_budget, True


def _parse_claude_file(
    path: Path,
    acc: _SourceAcc,
    inline_children: dict[str, _SourceAcc] | None,
    facts_by_id: dict[str, tuple[_SourceAcc, dict[str, Any]]],
    begin_ms: int,
    end_ms: int,
    budget: _Budget,
    tail: bool,
    top_reasons: set[str],
) -> bool:
    line0, lines, offset, hit_budget, ok = _read_file_lines(path, budget, tail=tail, is_codex=False)
    if not ok:
        acc.complete = False
        acc.reasons.add("log-missing")
        top_reasons.add("log-missing")
        return False
    if hit_budget:
        acc.complete = False
        acc.reasons.add("scan-budget")
        top_reasons.add("scan-budget")

    states: dict[str, dict[str, Any]] = {acc.raw_id: {}}
    first_seen_ts_ms: int | None = None
    original_first_pending = offset == 0
    # A tail's first timestamp is not the session's start. Keep the real header
    # for foreign-session checks without feeding its usage into the tail.
    if offset > 0:
        try:
            first = json.loads(line0) if line0 is not None else None
        except (ValueError, RecursionError):
            first = None
        if isinstance(first, dict):
            acc.cwd = first.get("cwd") if isinstance(first.get("cwd"), str) else None
            acc.has_parent_link = first.get("isSidechain") is True
            first_ts = parse_ts(first.get("timestamp", first.get("ts")))
            if first_ts is not None:
                acc.original_start_known = True
                acc.note_record_ts(int(round(first_ts * 1000)), begin_ms, end_ms)
        if not acc.original_start_known:
            acc.complete = False
            acc.reasons.add("log-truncated")
            top_reasons.add("log-truncated")

    for idx, raw_line in enumerate(lines):
        if not budget.check_time():
            acc.complete = False
            acc.reasons.add("scan-budget")
            top_reasons.add("scan-budget")
            break
        if not raw_line.strip():
            continue
        is_original_first = original_first_pending
        original_first_pending = False
        try:
            row = json.loads(raw_line)
        except (ValueError, RecursionError):
            acc.complete = False
            acc.reasons.add("malformed-record")
            top_reasons.add("malformed-record")
            continue
        if not isinstance(row, dict):
            acc.complete = False
            acc.reasons.add("malformed-record")
            top_reasons.add("malformed-record")
            continue

        target_acc = acc
        if inline_children is not None and row.get("isSidechain") is True:
            aid = row.get("agentId")
            if isinstance(aid, str) and aid:
                norm_aid = aid[6:] if aid.startswith("agent-") else aid
                if SESSION_ID_RE.fullmatch(norm_aid):
                    target_acc = inline_children.get(norm_aid)
                    if target_acc is None:
                        if len(inline_children) >= MAX_SOURCES - 1:
                            top_reasons.add("too-many-sources")
                            continue
                        target_acc = _SourceAcc(
                            agent="claude",
                            raw_id=norm_aid,
                            relation="subagent",
                            evidence="direct",
                            parent_ref=acc.ref,
                            parent_raw_id=acc.raw_id,
                        )
                        inline_children[norm_aid] = target_acc
                else:
                    continue
            else:
                continue
        elif inline_children is None and acc.relation == "cross-harness":
            if row.get("isSidechain") is True:
                acc.has_parent_link = True

        if isinstance(row.get("cwd"), str) and row["cwd"] and target_acc.cwd is None:
            target_acc.cwd = row["cwd"]
        if isinstance(row.get("cwd"), str) and row["cwd"] and acc.cwd is None:
            acc.cwd = row["cwd"]

        if target_acc.spawn_depth is None and type(row.get("spawnDepth")) is int:
            target_acc.spawn_depth = row["spawnDepth"]
        for tu_key in ("toolUseId", "parentToolUseID"):
            tu_val = row.get(tu_key)
            if target_acc.tool_use_id is None and isinstance(tu_val, str) and tu_val:
                target_acc.tool_use_id = tu_val

        # Record tool_use ids from assistant message.content only.
        msg = row.get("message")
        if isinstance(msg, dict) and isinstance(msg.get("content"), list):
            for item in msg["content"]:
                if isinstance(item, dict) and item.get("type") == "tool_use":
                    tu_id = item.get("id")
                    if isinstance(tu_id, str) and tu_id:
                        target_acc.emitted_tool_use_ids.add(tu_id)

        rec_ts = parse_ts(row.get("timestamp", row.get("ts")))
        if rec_ts is not None:
            if is_original_first:
                acc.original_start_known = True
            rec_ts_ms = int(round(rec_ts * 1000))
            if first_seen_ts_ms is None:
                first_seen_ts_ms = rec_ts_ms
            target_acc.note_record_ts(rec_ts_ms, begin_ms, end_ms)

        st_dict = states.setdefault(target_acc.raw_id, {})
        try:
            fact = parse_record(_SHIM, "claude", row, st_dict, idx)
        except Exception:
            target_acc.complete = False
            target_acc.reasons.add("malformed-record")
            top_reasons.add("malformed-record")
            continue

        if fact is not None:
            f_ts_ms = int(round(float(fact["ts"]) * 1000))
            target_acc.note_fact_ts(f_ts_ms, begin_ms, end_ms)
            if begin_ms <= f_ts_ms < end_ms:
                _merge_fact(facts_by_id, target_acc, fact)

    if (offset > 0 and (first_seen_ts_ms is None or first_seen_ts_ms > begin_ms)) or (
        acc.relation == "cross-harness" and not acc.original_start_known
    ):
        acc.complete = False
        acc.reasons.add("log-truncated")
        top_reasons.add("log-truncated")

    return True


def _peek_codex_meta(path: Path, budget: _Budget) -> dict[str, Any] | None:
    st = _safe_stat_regular(path)
    if st is None or st.st_size == 0:
        return None
    if not budget.check():
        return None
    try:
        with path.open("rb") as stream:
            allow = budget.reserve(min(MAX_TAIL_BYTES, st.st_size))
            if allow <= 0:
                return None
            raw0 = stream.readline(allow)
            budget.charge(len(raw0))
    except OSError:
        return None
    if not raw0:
        return None
    try:
        row0 = json.loads(raw0)
    except (ValueError, RecursionError):
        return None
    if not isinstance(row0, dict) or row0.get("type") != "session_meta":
        return None
    payload = row0.get("payload")
    if not isinstance(payload, dict):
        return None
    ptid = payload.get("parent_thread_id")
    if not isinstance(ptid, str) or not ptid:
        src = payload.get("source")
        sub = src.get("subagent") if isinstance(src, dict) else None
        ts_spawn = sub.get("thread_spawn") if isinstance(sub, dict) else None
        ptid = ts_spawn.get("parent_thread_id") if isinstance(ts_spawn, dict) else None
    return {
        "row0": row0,
        "id": payload.get("id") if isinstance(payload.get("id"), str) else None,
        "parent_thread_id": ptid if isinstance(ptid, str) else None,
        "cwd": payload.get("cwd") if isinstance(payload.get("cwd"), str) else None,
        "subagent_history_start_ordinal": (
            payload.get("subagent_history_start_ordinal")
            if type(payload.get("subagent_history_start_ordinal")) is int
            else None
        ),
    }


def _parse_codex_file(
    path: Path,
    acc: _SourceAcc,
    facts_by_id: dict[str, tuple[_SourceAcc, dict[str, Any]]],
    begin_ms: int,
    end_ms: int,
    budget: _Budget,
    tail: bool,
    top_reasons: set[str],
) -> bool:
    line0, lines, offset, hit_budget, ok = _read_file_lines(path, budget, tail=tail, is_codex=True)
    if not ok:
        acc.complete = False
        acc.reasons.add("log-missing")
        top_reasons.add("log-missing")
        return False
    if hit_budget:
        acc.complete = False
        acc.reasons.add("scan-budget")
        top_reasons.add("scan-budget")

    state: dict[str, Any] = {}
    start_ordinal: int | None = None
    first_seen_ts_ms: int | None = None

    def _apply_meta(row0: dict[str, Any]) -> None:
        nonlocal start_ordinal
        payload = row0.get("payload")
        if isinstance(payload, dict):
            if isinstance(payload.get("cwd"), str) and payload["cwd"]:
                acc.cwd = payload["cwd"]
            ptid = payload.get("parent_thread_id")
            if not isinstance(ptid, str) or not ptid:
                src = payload.get("source")
                sub = src.get("subagent") if isinstance(src, dict) else None
                ts_spawn = sub.get("thread_spawn") if isinstance(sub, dict) else None
                ptid = ts_spawn.get("parent_thread_id") if isinstance(ts_spawn, dict) else None
            if isinstance(ptid, str) and ptid:
                acc.parent_thread_id = ptid
                acc.has_parent_link = True
            sho = payload.get("subagent_history_start_ordinal")
            if type(sho) is int:
                start_ordinal = sho
        rec_ts = parse_ts(row0.get("timestamp", row0.get("ts")))
        if rec_ts is not None:
            acc.original_start_known = True
            acc.note_record_ts(int(round(rec_ts * 1000)), begin_ms, end_ms)
        try:
            parse_record(_SHIM, "codex", row0, state, 0)
        except Exception:
            pass

    if offset > 0 and line0 is not None:
        try:
            row0 = json.loads(line0)
            if isinstance(row0, dict):
                _apply_meta(row0)
            else:
                acc.complete = False
                acc.reasons.add("malformed-record")
                top_reasons.add("malformed-record")
        except (ValueError, RecursionError):
            acc.complete = False
            acc.reasons.add("malformed-record")
            top_reasons.add("malformed-record")

    need_seed = offset > 0

    for idx, raw_line in enumerate(lines):
        if not budget.check_time():
            acc.complete = False
            acc.reasons.add("scan-budget")
            top_reasons.add("scan-budget")
            break
        if not raw_line.strip():
            continue
        try:
            row = json.loads(raw_line)
        except (ValueError, RecursionError):
            acc.complete = False
            acc.reasons.add("malformed-record")
            top_reasons.add("malformed-record")
            continue
        if not isinstance(row, dict):
            acc.complete = False
            acc.reasons.add("malformed-record")
            top_reasons.add("malformed-record")
            continue

        line_index = idx if offset == 0 else idx + 1
        if line_index == 0 and row.get("type") == "session_meta":
            _apply_meta(row)

        rec_ts = parse_ts(row.get("timestamp", row.get("ts")))
        if rec_ts is not None:
            rec_ts_ms = int(round(rec_ts * 1000))
            if first_seen_ts_ms is None and not (line_index == 0 and offset > 0):
                first_seen_ts_ms = rec_ts_ms
            acc.note_record_ts(rec_ts_ms, begin_ms, end_ms)

        ordinal = row.get("ordinal")
        if start_ordinal is not None:
            eff_ordinal = ordinal if type(ordinal) is int else (line_index if offset == 0 else None)
            if eff_ordinal is None:
                acc.complete = False
                acc.reasons.add("log-truncated")
                top_reasons.add("log-truncated")
            elif eff_ordinal < start_ordinal:
                continue

        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        is_token_count = payload.get("type") == "token_count" and isinstance(payload.get("info"), dict)

        try:
            fact = parse_record(_SHIM, "codex", row, state, line_index)
        except Exception:
            acc.complete = False
            acc.reasons.add("malformed-record")
            top_reasons.add("malformed-record")
            continue

        _extract_codex_windows(acc, state.pop("percent", []), begin_ms, end_ms)

        if need_seed and is_token_count:
            need_seed = False
            continue

        if fact is not None:
            f_ts_ms = int(round(float(fact["ts"]) * 1000))
            acc.note_fact_ts(f_ts_ms, begin_ms, end_ms)
            if begin_ms <= f_ts_ms < end_ms:
                _merge_fact(facts_by_id, acc, fact)

    if (offset > 0 and (first_seen_ts_ms is None or first_seen_ts_ms > begin_ms)) or (
        acc.relation == "cross-harness" and not acc.original_start_known
    ):
        acc.complete = False
        acc.reasons.add("log-truncated")
        top_reasons.add("log-truncated")

    return True


def _codex_date_dirs(codex_cfg: Path, begin_ms: int, end_ms: int, extra_dir: Path | None = None, budget: _Budget | None = None) -> list[Path]:
    sessions_root = codex_cfg / "sessions"
    dirs: list[Path] = []
    seen: set[Path] = set()
    if extra_dir is not None and extra_dir.is_dir() and not extra_dir.is_symlink():
        dirs.append(extra_dir)
        seen.add(extra_dir)
    if not sessions_root.is_dir() or sessions_root.is_symlink():
        return dirs
    lo_s = max(0, int(begin_ms // 1000) - 86400)
    hi_s = max(lo_s, int(end_ms // 1000) + 86400)
    lo_date = datetime.datetime.fromtimestamp(lo_s, tz=datetime.timezone.utc).date()
    hi_date = datetime.datetime.fromtimestamp(hi_s, tz=datetime.timezone.utc).date()
    days = (hi_date - lo_date).days
    if days > 14:
        lo_date = hi_date - datetime.timedelta(days=14)
    cur = lo_date
    while cur <= hi_date:
        if budget is not None and not budget.check():
            break
        d = sessions_root / f"{cur.year:04d}" / f"{cur.month:02d}" / f"{cur.day:02d}"
        if d not in seen and d.is_dir() and not d.is_symlink():
            dirs.append(d)
            seen.add(d)
        cur += datetime.timedelta(days=1)
    return dirs


def _claude_project_dirs(claude_cfg: Path, root: str | None, cwd: str | None, extra_dir: Path | None = None, budget: _Budget | None = None) -> list[Path]:
    proj_root = claude_cfg / "projects"
    dirs: list[Path] = []
    seen: set[Path] = set()
    if extra_dir is not None and extra_dir.is_dir() and not extra_dir.is_symlink():
        dirs.append(extra_dir)
        seen.add(extra_dir)
    if not proj_root.is_dir() or proj_root.is_symlink():
        return dirs
    slugs: set[str] = set()
    for place in (root, cwd):
        if not isinstance(place, str) or not place:
            continue
        for variant in (place, os.path.realpath(place)):
            slugs.add(variant.replace("/", "-"))
            slugs.add(re.sub(r"[^A-Za-z0-9-]", "-", variant))
            slugs.add(re.sub(r"[^A-Za-z0-9-]", "-", variant).strip("-"))
    for entry in _entries(proj_root, budget):
        if entry.is_symlink() or not entry.is_dir(follow_symlinks=False):
            continue
        d = Path(entry.path)
        if d not in seen and d.name in slugs:
            dirs.append(d)
            seen.add(d)
    return dirs


def _codex_thread_id_from_path(path: Path) -> str | None:
    stem = path.stem
    # Format: rollout-<timestamp>-<thread_id> or <thread_id>
    m = re.match(r"^rollout-[0-9T:-]+-(.+)$", stem)
    if m and SESSION_ID_RE.fullmatch(m.group(1)):
        return m.group(1)
    if SESSION_ID_RE.fullmatch(stem):
        return stem
    return None


def _find_voices_files(home_path: Path, stage: str, begin_ms: int, budget: _Budget, top_reasons: set[str]) -> list[Path]:
    state_override = os.environ.get("GSTACK_STATE_ROOT") or os.environ.get("GSTACK_HOME")
    if state_override and os.path.isabs(state_override) and home_path == Path.home():
        state_root = Path(state_override)
    else:
        state_root = home_path / ".gstack"

    search_roots: list[Path] = []
    projects_dir = state_root / "projects"
    if projects_dir.is_dir() and not projects_dir.is_symlink():
        try:
            for entry in _entries(projects_dir, budget):
                if entry.is_symlink() or not entry.is_dir(follow_symlinks=False):
                    continue
                stage_dir = Path(entry.path) / stage
                if stage_dir.is_dir() and not stage_dir.is_symlink():
                    search_roots.append(stage_dir)
        except OSError:
            pass
    scratch_stage = home_path / "scratch" / stage
    if scratch_stage.is_dir() and not scratch_stage.is_symlink():
        search_roots.append(scratch_stage)

    min_mtime = (begin_ms / 1000.0) - 2.0
    found: list[tuple[float, str, Path]] = []

    def _walk(curr: Path, depth: int) -> None:
        if depth > VOICES_MAX_DEPTH:
            return
        for entry in _entries(curr, budget):
            if entry.is_symlink():
                continue
            p = Path(entry.path)
            if entry.name == "voices.jsonl" and entry.is_file(follow_symlinks=False):
                st = _safe_stat_regular(p)
                if st is None:
                    top_reasons.add("log-missing")
                if st is not None and st.st_size > 0 and st.st_mtime >= min_mtime:
                    if st.st_size > VOICES_MAX_BYTES:
                        top_reasons.add("capacity")
                        continue
                    found.append((st.st_mtime, str(p), p))
                    if len(found) > VOICES_MAX_FILES:
                        top_reasons.add("capacity")
                        found.sort(reverse=True)
                        del found[VOICES_MAX_FILES:]
            elif depth < VOICES_MAX_DEPTH and entry.is_dir(follow_symlinks=False):
                _walk(p, depth + 1)

    for sroot in search_roots:
        _walk(sroot, 1)

    found.sort(reverse=True)
    return [item[2] for item in found[:VOICES_MAX_FILES]]


def _build_link(row: dict[str, Any]) -> dict[str, Any]:
    metrics = row.get("metrics") if isinstance(row.get("metrics"), dict) else {}
    raw_pid = metrics.get("pass_id")
    pass_id = raw_pid if isinstance(raw_pid, str) and UUID_RE.fullmatch(raw_pid) else None
    raw_aid = metrics.get("attempt_id")
    attempt_id = raw_aid if isinstance(raw_aid, str) and UUID_RE.fullmatch(raw_aid) else None
    raw_vid = row.get("voice_id")
    voice_id = raw_vid if isinstance(raw_vid, str) and SAFE_ID_RE.fullmatch(raw_vid) else None
    pass_num = _pos_int_or_none(row.get("pass"))
    attempt_num = _pos_int_or_none(row.get("attempt"))
    return {
        "pass_id": pass_id,
        "attempt_id": attempt_id,
        "voice_id": voice_id,
        "pass": pass_num,
        "attempt": attempt_num,
    }


def _read_voices_join(
    home_path: Path,
    stage: str,
    sid: str,
    begin_ms: int,
    direct_child_ids: set[str],
    budget: _Budget,
    top_reasons: set[str],
) -> tuple[dict[str, dict[str, Any]], list[tuple[int, int, dict[str, Any]]], list[dict[str, Any]]]:
    """Return (direct_links_by_raw_id, outside_intervals, cli_reported)."""
    files = _find_voices_files(home_path, stage, begin_ms, budget, top_reasons)
    direct_links: dict[str, dict[str, Any]] = {}
    outside_intervals: list[tuple[int, int, dict[str, Any]]] = []
    cli_reported: list[dict[str, Any]] = []

    for vpath in files:
        if not budget.check():
            top_reasons.add("scan-budget")
            break
        st = _safe_stat_regular(vpath)
        if st is None:
            top_reasons.add("log-missing")
            continue
        if st.st_size > VOICES_MAX_BYTES:
            top_reasons.add("capacity")
            continue
        allow = budget.reserve(st.st_size)
        if allow < st.st_size:
            top_reasons.add("scan-budget")
            break
        try:
            with vpath.open("rb") as stream:
                raw = stream.read(allow)
        except OSError:
            top_reasons.add("log-missing")
            continue
        budget.charge(len(raw))
        for raw_line in raw.splitlines():
            if not budget.check_time():
                top_reasons.add("scan-budget")
                break
            if not raw_line.strip():
                continue
            try:
                row = json.loads(raw_line)
            except (ValueError, RecursionError):
                top_reasons.add("malformed-record")
                continue
            if not isinstance(row, dict):
                top_reasons.add("malformed-record")
                continue
            row_stage = row.get("stage")
            if isinstance(row_stage, str) and row_stage != stage:
                continue

            metrics = row.get("metrics") if isinstance(row.get("metrics"), dict) else {}
            row_sid = metrics.get("session_id") if isinstance(metrics.get("session_id"), str) else None
            sub_ref = row.get("subagent_ref") if isinstance(row.get("subagent_ref"), dict) else {}
            raw_sub_id = sub_ref.get("id") if isinstance(sub_ref.get("id"), str) and sub_ref.get("id") else None
            norm_sub_id = raw_sub_id[6:] if raw_sub_id and raw_sub_id.startswith("agent-") else raw_sub_id

            matches_sid = row_sid == sid
            matches_child = (
                (row_sid is None or row_sid == sid)
                and norm_sub_id is not None
                and (norm_sub_id in direct_child_ids or (raw_sub_id is not None and raw_sub_id in direct_child_ids))
            )
            if not (matches_sid or matches_child):
                continue

            link_obj = _build_link(row)
            matched_direct_child = False
            if norm_sub_id is not None and norm_sub_id in direct_child_ids:
                direct_links[norm_sub_id] = link_obj
                matched_direct_child = True
            if raw_sub_id is not None and raw_sub_id in direct_child_ids:
                direct_links[raw_sub_id] = link_obj
                matched_direct_child = True

            # Outside-process call interval for cross-harness correlation.
            sub_kind = sub_ref.get("kind")
            is_outside_row = (
                sub_kind == "outside-process"
                or isinstance(row.get("outside"), dict)
                or isinstance(row.get("delegate"), dict)
            )
            if is_outside_row and not matched_direct_child:
                d_ts = parse_ts(row.get("dispatched_at") or row.get("started_at"))
                r_ts = parse_ts(row.get("returned_at") or row.get("finished_at") or row.get("recorded_at"))
                if d_ts is not None and r_ts is not None and r_ts >= d_ts:
                    interval = (
                        int(round(d_ts * 1000)),
                        int(round(r_ts * 1000)),
                        link_obj,
                    )
                    if len(outside_intervals) < MAX_CLI_REPORTED:
                        outside_intervals.append(interval)
                    else:
                        top_reasons.add("capacity")

            # Provider-reported outside / delegate token counts go to cli_reported.
            for block_key in ("outside", "delegate"):
                block = row.get(block_key)
                if not isinstance(block, dict):
                    continue
                if block.get("replay") is True:
                    continue
                has_token_keys = any(
                    k in block
                    for k in (
                        "input_tokens",
                        "output_tokens",
                        "cache_read_input_tokens",
                        "cache_creation_input_tokens",
                        "cached_input_tokens",
                        "cache_write_input_tokens",
                    )
                )
                if not has_token_keys and block_key == "outside":
                    continue
                if len(cli_reported) < MAX_CLI_REPORTED:
                    cli_reported.append({
                        "voice_id": link_obj["voice_id"],
                        "link": link_obj,
                        "input_tokens": _nonneg_int_or_none(block.get("input_tokens")),
                        "output_tokens": _nonneg_int_or_none(block.get("output_tokens")),
                        "cache_read_input_tokens": _nonneg_int_or_none(
                            block.get("cache_read_input_tokens", block.get("cached_input_tokens"))
                        ),
                        "cache_creation_input_tokens": _nonneg_int_or_none(
                            block.get("cache_creation_input_tokens", block.get("cache_write_input_tokens"))
                        ),
                    })

    return direct_links, outside_intervals, cli_reported


def _place_step(
    ts_ms: int,
    steps: dict[str, tuple[int, int | None, str | None]],
    budget: _Budget | None = None,
) -> tuple[str, str | None]:
    """Return (placement, step_id) for ts_ms given step_id -> (lo_ms, hi_ms, parent_step_id)."""
    containing: list[str] = []
    for step_id, bounds in steps.items():
        if budget is not None and not budget.check_time():
            return "outside-steps", None
        if not isinstance(bounds, (tuple, list)) or len(bounds) < 2:
            continue
        lo_ms = bounds[0]
        hi_ms = bounds[1]
        if lo_ms is None:
            continue
        if ts_ms >= lo_ms and (hi_ms is None or ts_ms <= hi_ms):
            containing.append(step_id)
    if not containing:
        return "outside-steps", None
    if len(containing) == 1:
        return "step", containing[0]

    # Ancestor elimination: remove any step that is a proper ancestor of another containing step.
    containing_set = set(containing)
    ancestors_of_containing: set[str] = set()
    for step_id in containing:
        seen: set[str] = {step_id}
        curr = steps[step_id][2] if len(steps[step_id]) > 2 else None
        while isinstance(curr, str) and curr not in seen:
            if budget is not None and not budget.check_time():
                return "outside-steps", None
            seen.add(curr)
            if curr in containing_set:
                ancestors_of_containing.add(curr)
            if curr in steps and len(steps[curr]) > 2:
                curr = steps[curr][2]
            else:
                break

    innermost = [s for s in containing if s not in ancestors_of_containing]
    if len(innermost) == 1:
        return "step", innermost[0]
    return "overlapping", None


def collect(
    agent: str | None,
    harness_session: str | None,
    begin_ms: int,
    end_ms: int,
    root: str | None,
    stage: str,
    sid: str,
    steps: dict[str, tuple[int, int | None, str | None]] | None,
    home: str | Path | None = None,
    run_end_ms: int | None = None,
) -> dict[str, Any]:
    """Collect token usage across own, subagent, nested and cross-harness logs for one run."""
    b_ms = max(0, int(begin_ms))
    e_ms = max(b_ms, int(end_ms))
    step_map = steps or {}
    harness_label = agent if agent in ("claude", "codex", "cursor", "grok") else "unknown"
    event_id = _usage_event_id(sid)

    def _empty_result(status: str, reasons: list[str]) -> dict[str, Any]:
        return {
            "v": 1,
            "stage": stage,
            "session_id": sid,
            "event_id": event_id,
            "status": status,
            "reasons": sorted(set(reasons)),
            "harness": harness_label,
            "window": {"begin_ms": b_ms, "end_ms": e_ms},
            "observed_through_ms": e_ms,
            "sources": [],
            "buckets": [],
            "windows": [],
            "cli_reported": [],
        }

    if agent in ("cursor", "grok"):
        return _empty_result("unavailable", ["unverified-source"])
    if agent not in ("claude", "codex"):
        return _empty_result("unavailable", ["harness-session-unknown"])
    if not isinstance(harness_session, str) or not SESSION_ID_RE.fullmatch(harness_session):
        return _empty_result("unavailable", ["harness-session-unknown"])

    home_path = Path(home) if home is not None else Path.home()
    use_env_dirs = home is None or Path(home) == Path.home()
    claude_cfg = (
        Path(os.environ["CLAUDE_CONFIG_DIR"])
        if use_env_dirs and os.environ.get("CLAUDE_CONFIG_DIR")
        else home_path / ".claude"
    )
    codex_cfg = (
        Path(os.environ["CODEX_HOME"])
        if use_env_dirs and os.environ.get("CODEX_HOME")
        else home_path / ".codex"
    )

    budget = _Budget(SCAN_BUDGET_S, SCAN_BUDGET_BYTES)
    own_log = None
    own_key = None
    for path in _own_logs(agent, harness_session, claude_cfg if agent == "claude" else codex_cfg, budget):
        info = _safe_stat_regular(path)
        if info is not None:
            log_order = (info.st_mtime, str(path))
            if own_key is None or log_order > own_key:
                own_key, own_log = log_order, path
    if own_log is None:
        if budget.exhausted:
            return _empty_result("partial", ["scan-budget"])
        return _empty_result("unavailable", ["log-missing"])
    top_reasons: set[str] = set()
    facts_by_id = _Facts(step_map, budget)

    own_acc = _SourceAcc(agent=agent, raw_id=harness_session, relation="own", evidence="direct")
    direct_sources: list[_SourceAcc] = [own_acc]
    direct_sources_by_identity: dict[tuple[str, str], _SourceAcc] = {(agent, harness_session): own_acc}

    if agent == "claude":
        inline_children: dict[str, _SourceAcc] = {}
        _parse_claude_file(
            own_log,
            own_acc,
            inline_children,
            facts_by_id,
            b_ms,
            e_ms,
            budget,
            tail=True,
            top_reasons=top_reasons,
        )
        # Discover subagents/<session>/subagents/agent-*.jsonl
        sub_dir = own_log.parent / harness_session / "subagents"
        sub_files: list[Path] = []
        if sub_dir.is_dir() and not sub_dir.is_symlink():
            try:
                for entry in _entries(sub_dir, budget):
                    if entry.is_symlink() or not entry.is_file(follow_symlinks=False):
                        continue
                    if entry.name.startswith("agent-") and entry.name.endswith(".jsonl"):
                        sub_files.append(Path(entry.path))
            except OSError:
                pass

        for sfile in sub_files:
            if len(direct_sources) >= MAX_SOURCES:
                top_reasons.add("too-many-sources")
                break
            if not budget.check():
                top_reasons.add("scan-budget")
                break
            raw_sub_id = sfile.stem[6:] if sfile.stem.startswith("agent-") else sfile.stem
            if not SESSION_ID_RE.fullmatch(raw_sub_id):
                continue
            child_acc = inline_children.pop(raw_sub_id, None)
            if child_acc is None:
                child_acc = _SourceAcc(
                    agent="claude",
                    raw_id=raw_sub_id,
                    relation="subagent",
                    evidence="direct",
                    parent_ref=own_acc.ref,
                    parent_raw_id=harness_session,
                )
            # Read sibling .meta.json if present.
            meta_path = sfile.with_suffix(".meta.json")
            meta_st = _safe_stat_regular(meta_path)
            if meta_st is not None and 0 < meta_st.st_size <= 65536 and budget.check():
                allow_m = budget.reserve(meta_st.st_size)
                if allow_m >= meta_st.st_size:
                    try:
                        with meta_path.open("rb") as stream:
                            meta_bytes = stream.read(allow_m)
                        budget.charge(len(meta_bytes))
                        meta_obj = json.loads(meta_bytes)
                        if isinstance(meta_obj, dict):
                            sd = meta_obj.get("spawnDepth")
                            if type(sd) is int:
                                child_acc.spawn_depth = sd
                            tuid = meta_obj.get("toolUseId")
                            if isinstance(tuid, str) and tuid:
                                child_acc.tool_use_id = tuid
                    except (OSError, ValueError, RecursionError):
                        pass

            _parse_claude_file(
                sfile,
                child_acc,
                None,
                facts_by_id,
                b_ms,
                e_ms,
                budget,
                tail=True,
                top_reasons=top_reasons,
            )
            direct_sources.append(child_acc)
            direct_sources_by_identity[("claude", raw_sub_id)] = child_acc

        for rem_id in inline_children:
            if len(direct_sources) >= MAX_SOURCES:
                top_reasons.add("too-many-sources")
                break
            c_acc = inline_children[rem_id]
            if not budget.check():
                # These bounded accumulators already contain observed facts.
                c_acc.complete = False
                c_acc.reasons.add("scan-budget")
                top_reasons.add("scan-budget")
            direct_sources.append(c_acc)
            direct_sources_by_identity[("claude", rem_id)] = c_acc

        # Resolve nested Claude subagents via toolUseId -> another subagent's tool_use ids, or spawnDepth > 1.
        child_list = [s for s in direct_sources if s.relation != "own"]
        for c_acc in child_list:
            if not budget.check():
                top_reasons.add("scan-budget")
                break
            linked_parent: _SourceAcc | None = None
            if c_acc.tool_use_id:
                for other in child_list:
                    if not budget.check():
                        break
                    if other is not c_acc and c_acc.tool_use_id in other.emitted_tool_use_ids:
                        linked_parent = other
                        break
            if linked_parent is not None:
                c_acc.relation = "nested"
                c_acc.parent_ref = linked_parent.ref
                c_acc.parent_raw_id = linked_parent.raw_id
            elif c_acc.spawn_depth is not None and c_acc.spawn_depth > 1:
                c_acc.relation = "nested"
                c_acc.parent_ref = None
                c_acc.parent_raw_id = None

    else:
        # agent == "codex"
        _parse_codex_file(
            own_log,
            own_acc,
            facts_by_id,
            b_ms,
            e_ms,
            budget,
            tail=True,
            top_reasons=top_reasons,
        )

    # Scan Codex date directories covering the window for Codex children/nested and cross-harness candidates.
    codex_Extra = own_log.parent if agent == "codex" else None
    codex_dirs = _codex_date_dirs(codex_cfg, b_ms, e_ms, extra_dir=codex_Extra, budget=budget)
    codex_rollouts: list[tuple[Path, str, dict[str, Any]]] = []
    for ddir in codex_dirs:
        if not budget.check():
            top_reasons.add("scan-budget")
            break
        for entry in _entries(ddir, budget):
            if not budget.check():
                top_reasons.add("scan-budget")
                break
            if entry.is_symlink() or not entry.is_file(follow_symlinks=False) or not entry.name.endswith(".jsonl"):
                continue
            rpath = Path(entry.path)
            if agent == "codex" and rpath == own_log:
                continue
            meta = _peek_codex_meta(rpath, budget)
            if meta is None:
                # Missing/truncated lineage must not turn a child into a guessed
                # cross-harness session. Keep capture explicitly incomplete.
                top_reasons.add("log-truncated")
                continue
            tid = (meta.get("id") if meta else None) or _codex_thread_id_from_path(rpath)
            if not tid or not SESSION_ID_RE.fullmatch(tid):
                continue
            if agent == "codex" and tid == harness_session:
                continue
            codex_rollouts.append((rpath, tid, meta or {}))

    if agent == "codex" and codex_rollouts:
        # Follow parent_thread_id chains starting from harness_session.
        parent_map: dict[str, str] = {}
        for _rpath, tid, meta in codex_rollouts:
            if not budget.check():
                top_reasons.add("scan-budget")
                break
            ptid = meta.get("parent_thread_id")
            if isinstance(ptid, str) and SESSION_ID_RE.fullmatch(ptid):
                parent_map[tid] = ptid

        def _codex_lineage(tid: str) -> tuple[str | None, str | None]:
            """Return (relation, parent_tid) if tid descends from harness_session, else (None, None)."""
            ptid = parent_map.get(tid)
            if not ptid:
                return None, None
            if ptid == harness_session:
                return "subagent", harness_session
            curr = ptid
            visited = {tid, curr}
            depth = 1
            while curr in parent_map and depth < 16:
                nxt = parent_map[curr]
                if nxt == harness_session:
                    return "nested", ptid
                if nxt in visited:
                    break
                visited.add(nxt)
                curr = nxt
                depth += 1
            return None, None

        for rpath, tid, _meta in codex_rollouts:
            if not budget.check():
                top_reasons.add("scan-budget")
                break
            rel, ptid = _codex_lineage(tid)
            if rel is None or ptid is None:
                continue
            if ("codex", tid) in direct_sources_by_identity:
                continue
            if len(direct_sources) >= MAX_SOURCES:
                top_reasons.add("too-many-sources")
                break
            c_acc = _SourceAcc(
                agent="codex",
                raw_id=tid,
                relation=rel,
                evidence="direct",
                parent_ref=_source_ref("codex", ptid),
                parent_raw_id=ptid,
            )
            _parse_codex_file(
                rpath,
                c_acc,
                facts_by_id,
                b_ms,
                e_ms,
                budget,
                tail=True,
                top_reasons=top_reasons,
            )
            direct_sources.append(c_acc)
            direct_sources_by_identity[("codex", tid)] = c_acc

    # Cross-harness and foreign session scan (Claude top-level logs in root/cwd project dirs + remaining Codex rollouts).
    try:
        proc_cwd: str | None = os.getcwd()
    except OSError:
        proc_cwd = None
    effective_root = root or own_acc.cwd or proc_cwd

    foreign_session_active = False
    candidate_sources: list[_SourceAcc] = []

    # 1. Claude top-level logs
    claude_extra = own_log.parent if agent == "claude" else None
    claude_dirs = _claude_project_dirs(claude_cfg, effective_root, proc_cwd, extra_dir=claude_extra, budget=budget)
    for cdir in claude_dirs:
        if not budget.check():
            top_reasons.add("scan-budget")
            break
        for entry in _entries(cdir, budget):
            if not budget.check():
                top_reasons.add("scan-budget")
                break
            if entry.is_symlink() or not entry.is_file(follow_symlinks=False) or not entry.name.endswith(".jsonl"):
                continue
            cpath = Path(entry.path)
            raw_cid = cpath.stem
            if not SESSION_ID_RE.fullmatch(raw_cid):
                continue
            if ("claude", raw_cid) in direct_sources_by_identity:
                continue
            cand_acc = _SourceAcc(
                agent="claude",
                raw_id=raw_cid,
                relation="cross-harness",
                evidence="unknown",
                parent_ref=None,
            )
            candidate_facts = {}
            if not _parse_claude_file(
                cpath,
                cand_acc,
                None,
                candidate_facts,
                b_ms,
                e_ms,
                budget,
                tail=False,
                top_reasons=top_reasons,
            ):
                continue
            if not _inside_root(cand_acc.cwd, effective_root):
                continue
            if cand_acc.all_first_ms is None:
                continue
            if not cand_acc.original_start_known and cand_acc.in_first_ms is not None:
                foreign_session_active = True
            if cand_acc.all_first_ms < b_ms:
                if not cand_acc.has_parent_link and (cand_acc.all_last_ms is None or cand_acc.all_last_ms >= b_ms):
                    foreign_session_active = True
                continue
            if b_ms <= cand_acc.all_first_ms < e_ms and not cand_acc.has_parent_link:
                if len(direct_sources) + len(candidate_sources) >= MAX_SOURCES:
                    top_reasons.add("too-many-sources")
                    continue
                candidate_sources.append(cand_acc)
                for source, fact in candidate_facts.values():
                    if not budget.check_time():
                        break
                    _merge_fact(facts_by_id, source, fact)

    # 2. Remaining Codex rollouts not already claimed as direct sources
    for rpath, tid, _meta in codex_rollouts:
        if not budget.check():
            top_reasons.add("scan-budget")
            break
        if ("codex", tid) in direct_sources_by_identity:
            continue
        cand_acc = _SourceAcc(
            agent="codex",
            raw_id=tid,
            relation="cross-harness",
            evidence="unknown",
            parent_ref=None,
        )
        candidate_facts = {}
        if not _parse_codex_file(
            rpath,
            cand_acc,
            candidate_facts,
            b_ms,
            e_ms,
            budget,
            tail=False,
            top_reasons=top_reasons,
        ):
            continue
        if not _inside_root(cand_acc.cwd, effective_root):
            continue
        if cand_acc.all_first_ms is None:
            continue
        if not cand_acc.original_start_known and cand_acc.in_first_ms is not None:
            foreign_session_active = True
        if cand_acc.all_first_ms < b_ms:
            if not cand_acc.has_parent_link and (cand_acc.all_last_ms is None or cand_acc.all_last_ms >= b_ms):
                foreign_session_active = True
            continue
        if b_ms <= cand_acc.all_first_ms < e_ms and not cand_acc.has_parent_link:
            if len(direct_sources) + len(candidate_sources) >= MAX_SOURCES:
                top_reasons.add("too-many-sources")
                continue
            candidate_sources.append(cand_acc)
            for source, fact in candidate_facts.values():
                if not budget.check_time():
                    break
                _merge_fact(facts_by_id, source, fact)

    # Pass join via voices.jsonl.
    direct_child_ids: set[str] = set()
    for s_acc in direct_sources:
        if s_acc.relation in ("subagent", "nested"):
            direct_child_ids.add(s_acc.raw_id)
            direct_child_ids.add(f"agent-{s_acc.raw_id}")

    direct_links, outside_intervals, cli_reported = _read_voices_join(
        home_path,
        stage,
        sid,
        b_ms,
        direct_child_ids,
        budget,
        top_reasons,
    )
    if budget.discovery_failed:
        top_reasons.add("log-missing")

    # Apply direct links to subagents, then propagate to linked nested children if unlinked.
    raw_to_direct: dict[str, _SourceAcc] = {s.raw_id: s for s in direct_sources}
    for s_acc in direct_sources:
        if s_acc.relation in ("subagent", "nested"):
            link = direct_links.get(s_acc.raw_id) or direct_links.get(f"agent-{s_acc.raw_id}")
            if link is not None:
                s_acc.link = link
                s_acc.link_evidence = "direct"

    for s_acc in direct_sources:
        if s_acc.relation == "nested" and s_acc.link is None and s_acc.parent_raw_id:
            curr_pid: str | None = s_acc.parent_raw_id
            visited_p: set[str] = set()
            while curr_pid and curr_pid not in visited_p:
                visited_p.add(curr_pid)
                p_acc = raw_to_direct.get(curr_pid)
                if p_acc is None or p_acc.relation == "own":
                    break
                if p_acc.link is not None:
                    s_acc.link = p_acc.link
                    s_acc.link_evidence = "direct"
                    break
                curr_pid = p_acc.parent_raw_id

    # Correlate cross-harness candidates.
    if candidate_sources:
        correlation_complete = not budget.exhausted and not ({
            "scan-budget", "too-many-sources", "capacity",
            "log-missing", "log-truncated", "malformed-record",
        } & top_reasons)
        # Map each interval index to the candidates whose first and last records fall inside it.
        interval_to_cands: dict[int, list[_SourceAcc]] = {i: [] for i in range(len(outside_intervals))}
        cand_to_intervals: dict[str, list[int]] = {c.ref: [] for c in candidate_sources}
        for c_acc in candidate_sources:
            c_first = c_acc.all_first_ms
            c_last = c_acc.all_last_ms
            if c_first is None or c_last is None:
                continue
            for idx, (iv_lo, iv_hi, _iv_link) in enumerate(outside_intervals):
                if iv_lo <= c_first <= c_last <= iv_hi:
                    interval_to_cands[idx].append(c_acc)
                    cand_to_intervals[c_acc.ref].append(idx)

        for c_acc in candidate_sources:
            matching_ivs = cand_to_intervals.get(c_acc.ref, [])
            if (
                c_acc.original_start_known
                and correlation_complete
                and
                len(matching_ivs) == 1
                and len(interval_to_cands[matching_ivs[0]]) == 1
            ):
                iv_idx = matching_ivs[0]
                c_acc.evidence = "correlated"
                c_acc.link = outside_intervals[iv_idx][2]
                c_acc.link_evidence = "correlated"
            elif c_acc.original_start_known and not foreign_session_active and correlation_complete:
                c_acc.evidence = "correlated"
                c_acc.link = None
                c_acc.link_evidence = None
            else:
                c_acc.evidence = "unknown"
                c_acc.link = None
                c_acc.link_evidence = None
                c_acc.reasons.add("ambiguous")
                top_reasons.add("ambiguous")

    all_sources = direct_sources + candidate_sources
    if len(all_sources) > MAX_SOURCES:
        all_sources = all_sources[:MAX_SOURCES]
        top_reasons.add("too-many-sources")

    # Parsing built bounded aggregates incrementally. Finalize at most 64 sources
    # and 1024 groups even after the input deadline, retaining observed work.
    sources_out: list[dict[str, Any]] = []
    windows_out: list[dict[str, Any]] = []
    buckets_out: list[dict[str, Any]] = []
    source_indices = {src.ref: idx for idx, src in enumerate(all_sources)}
    models_by_source = {}
    for (ref, model, placement, step_id), group in facts_by_id.groups.items():
        if ref not in source_indices:
            continue
        if model is not None:
            models = models_by_source.setdefault(ref, set())
            if len(models) < MAX_MODELS_PER_SOURCE:
                models.add(model)
        classes = {cls: None if group["nulls"][cls] else group["sums"][cls] for cls in CLASSES}
        null_reasons = ["not-reported"] if any(value is None for value in classes.values()) else []
        top_reasons.update(null_reasons)
        buckets_out.append({
            "source": source_indices[ref], "model": model, "step_id": step_id,
            "placement": placement, **classes, "null_reasons": null_reasons,
            "responses": group["responses"],
        })
    if facts_by_id.compacted:
        top_reasons.add("too-many-buckets")
    if facts_by_id.capacity:
        top_reasons.add("capacity")

    for s_acc in all_sources:
        if s_acc.relation in ("subagent", "nested"):
            if s_acc.first_fact_ms is not None:
                step_hi = s_acc.first_fact_step_hi
                if step_hi is not None and s_acc.all_fact_last_ms is not None and s_acc.all_fact_last_ms > step_hi:
                    s_acc.reasons.add("outlived-step")
            past_run_end = (
                type(run_end_ms) is int and run_end_ms >= b_ms
                and s_acc.all_last_ms is not None and s_acc.all_last_ms > run_end_ms
            )
            if s_acc.post_end_record or past_run_end:
                s_acc.reasons.add("may-continue")
                s_acc.complete = False
        if s_acc.agent == "codex":
            for window in _build_windows_for_source(s_acc):
                if len(windows_out) < MAX_WINDOWS:
                    windows_out.append(window)
        top_reasons.update(s_acc.reasons)
        sources_out.append({
            "ref": s_acc.ref, "agent": s_acc.agent, "relation": s_acc.relation,
            "evidence": s_acc.evidence, "parent_ref": s_acc.parent_ref,
            "link": s_acc.link, "link_evidence": s_acc.link_evidence,
            "models": sorted(models_by_source.get(s_acc.ref, ())),
            "first_ms": s_acc.in_first_ms, "last_ms": s_acc.in_last_ms,
            "complete": s_acc.complete, "reasons": sorted(s_acc.reasons),
        })

    if budget.exhausted:
        top_reasons.add("scan-budget")

    partial_triggers = {
        "log-missing",
        "log-truncated",
        "scan-budget",
        "malformed-record",
        "ambiguous",
        "may-continue",
        "too-many-sources",
        "too-many-buckets",
        "capacity",
    }
    status = "partial" if (top_reasons & partial_triggers) else "ok"

    return {
        "v": 1,
        "stage": stage,
        "session_id": sid,
        "event_id": event_id,
        "status": status,
        "reasons": sorted(top_reasons),
        "harness": harness_label,
        "window": {"begin_ms": b_ms, "end_ms": e_ms},
        "observed_through_ms": e_ms,
        "sources": sources_out,
        "buckets": buckets_out,
        "windows": windows_out,
        "cli_reported": cli_reported,
    }
