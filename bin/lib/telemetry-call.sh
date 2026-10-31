#!/usr/bin/env bash
# Resolver the skills' telemetry start/finish blocks call: setup copies it to
# $HOME/.gstack-extend/bin/telemetry-call. See docs/telemetry.md.
#   telemetry-call --resolve   print the compatible wrapper's path, or nothing
#   telemetry-call <args>      exec that wrapper with <args>; with none, exit 0
# The blocks run it as `telemetry-call start|finish --skill "extend:<name>"`. exec keeps the
# block shell as the wrapper's parent, which the harness ancestry lookup in lib/telemetry.py relies on.
# A wrapper must carry the protocol line (also a comment in bin/gstack-extend-telemetry and PROTOCOL_MARKER in
# lib/telemetry.py), so an older wrapper on PATH is skipped instead of receiving `start` calls it would misfile.
_ge_ok() { case "$_GE_CAND" in /*) [ -f "$_GE_CAND" ] && [ -x "$_GE_CAND" ] && grep -q 'telemetry-protocol: start-finish-v1' "$_GE_CAND" ;; *) false ;; esac; }
_GE_BIN=$(command -v gstack-extend-telemetry 2>/dev/null || true)
if ! _GE_CAND="$_GE_BIN" _ge_ok; then _GE_BIN="$HOME/.claude/skills/gstack-extend/bin/gstack-extend-telemetry"; fi
if ! _GE_CAND="$_GE_BIN" _ge_ok; then
  _GE_BIN=""
  for _GE_PTR in "$HOME"/.claude/skills/*/.extend-root "$HOME"/.codex/skills/*/.extend-root "$HOME"/.config/opencode/skills/*/.extend-root "$HOME"/.cursor/skills/*/.extend-root; do
    if [ -f "$_GE_PTR" ] && [ -r "$_GE_PTR" ]; then
      IFS= read -r _GE_ROOT < "$_GE_PTR" || true
      if _GE_CAND="$_GE_ROOT/bin/gstack-extend-telemetry" _ge_ok; then _GE_BIN="$_GE_ROOT/bin/gstack-extend-telemetry"; break; fi
    fi
  done
fi
if [ "${1:-}" = "--resolve" ]; then
  [ -z "$_GE_BIN" ] || printf '%s\n' "$_GE_BIN"
  exit 0
fi
if [ -n "$_GE_BIN" ]; then
  [ "$#" -gt 0 ] || exit 0
  exec "$_GE_BIN" "$@"
elif [ "${GSTACK_EXTEND_TELEMETRY_DEBUG:-}" = "1" ]; then
  echo 'telemetry skipped: gstack-extend-telemetry unresolvable or stale. Fix: re-run ./setup. See docs/telemetry.md.' >&2
fi
exit 0
