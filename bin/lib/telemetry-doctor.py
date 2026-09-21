"""Read-only local fidelity report. Transcripts are advisory, never a denominator."""
import json
from pathlib import Path
import shutil
import sys
from datetime import datetime, timezone, timedelta

from telemetry import MIN_GSTACK_FOR_NO_SWEEP, capture, compatible_wrapper, executable, resolve, sink_path, supports_no_sweep

SKILLS = ("pair-review", "roadmap", "full-review", "review-apparatus", "test-plan",
          "gstack-extend-upgrade", "gstack-extend-init", "review-and-prep", "implement")
RESUMABLE = {"pair-review", "review-and-prep", "test-plan"}
PAIRING_TARGET_PERCENT = 95
DECISION_WINDOW_DAYS = 30
MAX_DAYS = 365000
CAVEAT = ("Transcript counts are advisory: Claude-only, local-only, retention-deleted; "
          "includes nested subagents/ files. "
          "Fleet aggregates are not comparable to this local sink.")


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def lines(path, issues):
    try:
        with path.open(encoding="utf-8", errors="replace") as stream:
            for line in stream:
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                    if not isinstance(row, dict):
                        raise ValueError("not an object")
                    yield row
                except ValueError:
                    issues["malformed_lines"] += 1
    except OSError:
        issues["unreadable_files"] += 1


def transcripts(since, now):
    folder = Path.home() / ".claude/projects"
    counts = {skill: 0 for skill in SKILLS}
    issues = dict(malformed_lines=0, unreadable_files=0)
    if not folder.is_dir():
        return {skill: None for skill in SKILLS}, issues
    seen = set()
    for path in folder.rglob("*.jsonl"):
        for index, row in enumerate(lines(path, issues)):
            ts = timestamp(row.get("timestamp"))
            if ts is None or not since <= ts <= now:
                continue
            message = row.get("message")
            content = message.get("content", []) if isinstance(message, dict) else []
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict) or block.get("type") != "tool_use" or block.get("name") != "Skill":
                    continue
                inputs = block.get("input")
                name = inputs.get("skill") if isinstance(inputs, dict) else None
                if not isinstance(name, str):
                    continue
                name = name.lstrip("/").removeprefix("gstack-extend:").removeprefix("extend:")
                if name not in counts:
                    continue
                identity = block.get("id") or f"{path}:{index}:{name}"
                if not isinstance(identity, str) or identity in seen:
                    continue
                seen.add(identity)
                counts[name] += 1
    return counts, issues


def wrapper_candidates():
    # The ladder the skill blocks walk: PATH, the canonical install, then setup's .extend-root pointers.
    yield shutil.which("gstack-extend-telemetry")
    yield str(Path.home() / ".claude/skills/gstack-extend/bin/gstack-extend-telemetry")
    for directory in (Path.home() / ".claude/skills", Path.home() / ".codex/skills",
                      Path.home() / ".config/opencode/skills"):
        for pointer in sorted(directory.glob("*/.extend-root")):
            try:
                # Regular files only (a FIFO or device would block). Like the skill block's `IFS= read -r`, take
                # the first line, bounded, without stripping anything but the newline.
                if not pointer.is_file():
                    continue
                with pointer.open(encoding="utf-8", errors="replace") as stream:
                    root = stream.readline(4096).rstrip("\n")
            except OSError:
                continue
            yield str(Path(root) / "bin/gstack-extend-telemetry")


def extend_binary():
    """Return (compatible wrapper, stale wrapper). A stale wrapper is executable but predates the start/finish
    protocol, so the skill blocks skip it."""
    stale = None
    for candidate in wrapper_candidates():
        if compatible_wrapper(candidate):
            return candidate, stale
        if stale is None and executable(candidate):
            stale = candidate
    return None, stale


def report(days):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    issues = dict(malformed_lines=0, unreadable_files=0, invalid_timestamps=0, nameless_rows=0)
    stats = {skill: dict(skill=skill, resumable=skill in RESUMABLE, activations=0, completions=0,
                        legacy=0, duplicate_starts=0, retried_finishes=0, paired=0,
                        unpaired_start=0, unpaired_finish=0, deferred_finish=0,
                        crossing_window=0, denominator=0, pairing_percent=None)
             for skill in SKILLS}
    starts, finishes = {}, {}
    sink = sink_path()
    if sink.exists():
        for row in lines(sink, issues):
            name = row.get("skill")
            if row.get("source") != "gstack-extend":
                continue
            if not isinstance(name, str) or not name:
                issues["nameless_rows"] += 1
                continue
            name = name.removeprefix("extend:")
            if name not in stats:
                continue
            ts = timestamp(row.get("ts"))
            if ts is None:
                issues["invalid_timestamps"] += 1
                continue
            if ts > now:
                continue
            stat = stats[name]
            in_window = since <= ts
            event = row.get("event_type")
            sid = row.get("session_id")
            modern = (type(row.get("v")) is int and row["v"] == 1 and
                      isinstance(sid, str) and bool(sid) and event in ("skill_start", "skill_run"))
            if not modern:
                if in_window:
                    stat["legacy"] += 1
                    if "duration_s" in row or "outcome" in row:
                        stat["completions"] += 1
                    elif row.get("event") != "prepared-not-started":
                        stat["activations"] += 1
                continue
            if in_window:
                stat["activations" if event == "skill_start" else "completions"] += 1
            target = starts if event == "skill_start" else finishes
            target.setdefault((name, sid), []).append(ts)
    # Join all history before window filtering. File order never determines pairing.
    for key, occurrences in starts.items():
        name, sid = key
        stat = stats[name]
        start = min(occurrences)
        if not since <= start <= now:
            continue
        stat["duplicate_starts"] += len(occurrences) - 1
        if key in finishes:
            stat["paired"] += 1
        elif name in RESUMABLE:
            stat["deferred_finish"] += 1
        else:
            stat["unpaired_start"] += 1
    for key, occurrences in finishes.items():
        if not any(since <= ts <= now for ts in occurrences):
            continue
        stat = stats[key[0]]
        stat["retried_finishes"] += len(occurrences) - 1
        if key not in starts:
            stat["unpaired_finish"] += 1
        elif min(starts[key]) < since:
            stat["crossing_window"] += 1
    advisory, transcript_issues = transcripts(since, now)
    for name, stat in stats.items():
        stat["denominator"] = stat["paired"] + stat["unpaired_start"]
        stat["transcripts"] = advisory[name]
        if stat["denominator"]:
            stat["pairing_percent"] = round(100 * stat["paired"] / stat["denominator"], 2)
            stat["status"] = "below target" if stat["pairing_percent"] < PAIRING_TARGET_PERCENT else "paired"
        else:
            stat["status"] = "insufficient evidence"
        stat["schedule_marker_work"] = (days == DECISION_WINDOW_DAYS and stat["pairing_percent"] is not None and
                                        stat["pairing_percent"] < PAIRING_TARGET_PERCENT and (stat["transcripts"] or 0) > 0)
    config = resolve("gstack-config")
    tier = capture([config, "get", "telemetry"]).strip() if config else "unavailable"
    binary, stale = extend_binary()
    logger = resolve("gstack-telemetry-log")
    no_sweep = supports_no_sweep(logger) if logger else None
    warnings = []
    if stale:
        warnings.append(f"Stale gstack-extend-telemetry at {stale} predates the start/finish protocol and is skipped; "
                        "re-run ./setup from the current checkout.")
    if no_sweep is False:
        warnings.append(f"gstack-telemetry-log lacks --no-sweep (gstack before {MIN_GSTACK_FOR_NO_SWEEP}), so "
                        "completions are skipped; run gstack-upgrade.")
    return dict(days=days, since=since.isoformat(), as_of=now.isoformat(), sink=str(sink),
                sink_exists=sink.exists(), tier=tier, telemetry_binary=binary,
                stale_wrapper=stale, logger_supports_no_sweep=no_sweep, warnings=warnings,
                diagnostic=None if binary else "gstack-extend-telemetry unresolvable; re-run ./setup. See docs/telemetry.md.",
                transcript_caveat=CAVEAT, transcript_issues=transcript_issues, issues=issues,
                duration_note="duration_s is session wall-clock, not model/token spend; values above 86400s are null.",
                skills=list(stats.values()))


def main(args):
    days, as_json = DECISION_WINDOW_DAYS, "--json" in args
    while args:
        flag = args.pop(0)
        if flag == "--json":
            continue
        if flag in ("-h", "--help"):
            print("Usage: gstack-extend doctor telemetry [--days N] [--json]")
            return
        if flag == "--days" and args and args[0].isascii() and args[0].isdigit() and len(args[0]) <= len(str(MAX_DAYS)):
            days = int(args.pop(0))
            if 1 <= days <= MAX_DAYS:
                continue
        message = f"Invalid arguments: use doctor telemetry [--days N] [--json], with N from 1 to {MAX_DAYS}."
        print(json.dumps(dict(error=message)) if as_json else message)
        return
    result = report(days)
    if as_json:
        print(json.dumps(result, indent=2))
        return
    print(f"Telemetry fidelity — last {days} days — tier: {result['tier']}")
    print(f"Sink: {result['sink']} ({'present' if result['sink_exists'] else 'missing'})")
    if result["diagnostic"]:
        print(result["diagnostic"])
    for warning in result["warnings"]:
        print(warning)
    print("skill                  activation completion paired/eligible deferred unpaired-finish transcripts status")
    for stat in result["skills"]:
        ratio = f"{stat['paired']}/{stat['denominator']}"
        advisory = stat["transcripts"] if stat["transcripts"] is not None else "unavailable"
        status = stat["status"]
        if stat["pairing_percent"] is not None:
            status = f"{stat['pairing_percent']}% {status}"
        print(f"{stat['skill']:22} {stat['activations']:10} {stat['completions']:10} {ratio:15} "
              f"{stat['deferred_finish']:8} {stat['unpaired_finish']:15} {str(advisory):10} {status}")
        if stat["legacy"] or stat["duplicate_starts"] or stat["retried_finishes"] or stat["crossing_window"]:
            print(f"  legacy={stat['legacy']} duplicate-starts={stat['duplicate_starts']} "
                  f"retried-finishes={stat['retried_finishes']} crossing-window={stat['crossing_window']}")
        if stat["schedule_marker_work"]:
            print("  Decision rule triggered: schedule the deferred in-flight marker and crash-detection work; "
                  "diagnose skipped starts separately.")
    print("Diagnostics: " + json.dumps(result["issues"], sort_keys=True))
    print(CAVEAT)
    print(result["duration_note"])
    print("Ratio: distinct in-window starts paired / eligible starts; deferred resumable finishes and legacy rows excluded.")
    print("Unfinished runs can lower the ratio; no missing row proves a crash. See docs/telemetry.md.")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except Exception as error:
        # A diagnostic command must survive the dispatcher's set -e and ERR trap.
        message = f"Telemetry report unavailable: {type(error).__name__}: {error}. See docs/telemetry.md."
        print(json.dumps(dict(error=message)) if "--json" in sys.argv else message)
