#!/usr/bin/env bash
# Fixed skill start command: setup installs a copy at $HOME/.gstack-extend/bin/preamble.
# Resolves the verified gstack-extend root from Claude Code or Codex, runs update-check,
# and starts telemetry. See docs/installation.md#start-command.

_usage() {
  echo "preamble: usage: preamble <skill> [--force] [--require <helper>] [--root | --resume]" >&2
}

_fail_usage() {
  echo "preamble: PREAMBLE_USAGE: $1" >&2
  _usage
  exit 2
}

_print_help() {
  cat <<'EOF'
Usage: preamble <skill> [--force] [--require <helper>] [--root | --resume]

Resolve the gstack-extend install for <skill>, run update-check, and start telemetry.

Options:
  --force             pass --force to bin/update-check
  --require <helper>  require a verified install and executable bin/<helper> (exit 1 on ERROR)
  --root              print only the root lines
  --resume            start a new telemetry segment
  -h, --help          show this help and exit 0
EOF
}

_is_valid_name() {
  case "$1" in
    ''|-*) return 1 ;;
    *[!abcdefghijklmnopqrstuvwxyz0123456789-]*) return 1 ;;
    *) return 0 ;;
  esac
}

_run_telemetry_start() {
  _GE_CALL="$HOME/.gstack-extend/bin/telemetry-call"
  if [ -f "$_GE_CALL" ] && [ -x "$_GE_CALL" ]; then
    "$_GE_CALL" start --skill "extend:$_ER_SKILL" || true
  elif [ "${GSTACK_EXTEND_TELEMETRY_DEBUG:-}" = "1" ]; then
    echo 'telemetry skipped: gstack-extend-telemetry unresolvable or stale. Fix: re-run ./setup. See docs/telemetry.md.' >&2
  fi
}

if [ "$#" -eq 1 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; then
  _print_help
  exit 0
fi

if [ "$#" -lt 1 ]; then
  _fail_usage "missing required <skill> argument"
fi

_ER_SKILL="$1"
shift
if ! _is_valid_name "$_ER_SKILL"; then
  _fail_usage "invalid skill name: $_ER_SKILL"
fi

_FORCE=0
_REQUIRE=""
_MODE_ROOT=0
_MODE_RESUME=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --force)
      _FORCE=1
      shift
      ;;
    --require)
      if [ "$#" -lt 2 ]; then
        _fail_usage "--require requires a <helper> value"
      fi
      _REQUIRE="$2"
      if ! _is_valid_name "$_REQUIRE"; then
        _fail_usage "invalid helper name for --require: $_REQUIRE"
      fi
      shift 2
      ;;
    --root)
      _MODE_ROOT=1
      shift
      ;;
    --resume)
      _MODE_RESUME=1
      shift
      ;;
    *)
      _fail_usage "unknown argument: $1"
      ;;
  esac
done

if [ "$_MODE_ROOT" -eq 1 ] && [ "$_MODE_RESUME" -eq 1 ]; then
  _fail_usage "--root and --resume cannot be used together"
fi

if [ "$_MODE_RESUME" -eq 1 ]; then
  _run_telemetry_start
  exit 0
fi

_er_ok() { case "$_ER" in /*) [ -f "$_ER/bin/update-check" ] && [ -x "$_ER/bin/update-check" ] && grep -qx '# extend-root-protocol: v1' "$_ER/bin/update-check" 2>/dev/null ;; *) false ;; esac; }
_EXTEND_ROOT=""
_ER_SEEN=""
for _ER_SRC in "$HOME"/.claude/skills/"$_ER_SKILL"/SKILL.md "$HOME"/.codex/skills/"$_ER_SKILL"/SKILL.md; do
  case "$_ER_SRC" in /*) ;; *) continue ;; esac
  _ER=$(readlink "$_ER_SRC" 2>/dev/null || true)
  [ -n "$_ER" ] || continue
  case "$_ER" in /*) ;; *) _ER="$(dirname "$_ER_SRC")/$_ER" ;; esac
  _ER=$(dirname "$(dirname "$_ER")")
  if _er_ok; then _EXTEND_ROOT="$_ER"; break; fi
  _ER_SEEN="${_ER_SEEN:-$_ER}"
done
if [ -z "$_EXTEND_ROOT" ]; then
  for _ER_SRC in "$HOME"/.claude/skills/"$_ER_SKILL"/.extend-root "$HOME"/.codex/skills/"$_ER_SKILL"/.extend-root; do
    case "$_ER_SRC" in /*) ;; *) continue ;; esac
    [ -f "$_ER_SRC" ] && [ -r "$_ER_SRC" ] || continue
    _ER=""
    IFS= read -r _ER < "$_ER_SRC" || true
    if _er_ok; then _EXTEND_ROOT="$_ER"; break; fi
    _ER_SEEN="${_ER_SEEN:-${_ER:-empty:$_ER_SRC}}"
  done
fi
_ER_UNVERIFIED=""
if [ -z "$_EXTEND_ROOT" ] && [ -n "$_ER_SEEN" ]; then
  _ER="$_ER_SEEN/bin/update-check"
  case "$_ER_SEEN" in
    empty:*) _ER_UNVERIFIED="${_ER_SEEN#empty:} is empty. Fix: run setup --host auto from your gstack-extend checkout" ;;
    /*) if [ ! -e "$_ER" ]; then _ER_UNVERIFIED="$_ER_SEEN has no bin/update-check (checkout moved or deleted). Fix: re-clone gstack-extend (README: Installation), then run its setup --host auto"
        elif [ ! -f "$_ER" ] || [ ! -x "$_ER" ] || [ ! -r "$_ER" ]; then _ER_UNVERIFIED="$_ER is not a readable executable file. Fix: git -C \"$_ER_SEEN\" checkout -- bin/update-check, then run \"$_ER_SEEN/setup\" --host auto"
        else _ER_UNVERIFIED="$_ER lacks the line '# extend-root-protocol: v1' (checkout older than this skill, or not gstack-extend). Fix: git -C \"$_ER_SEEN\" pull --ff-only, then run \"$_ER_SEEN/setup\" --host auto"; fi ;;
    *) _ER_UNVERIFIED="an install pointer names a non-absolute path ($_ER_SEEN). Fix: run setup --host auto from your gstack-extend checkout" ;;
  esac
fi

if [ -n "$_REQUIRE" ]; then
  if [ -z "$_EXTEND_ROOT" ]; then
    echo "ERROR: cannot locate a verified gstack-extend install. ${_ER_UNVERIFIED:-No gstack-extend skill link or .extend-root pointer under ~/.claude or ~/.codex. Fix: run setup --host auto from your gstack-extend checkout (README: Installation).}"
    exit 1
  fi
  if [ ! -f "$_EXTEND_ROOT/bin/$_REQUIRE" ] || [ ! -x "$_EXTEND_ROOT/bin/$_REQUIRE" ]; then
    echo "ERROR: $_EXTEND_ROOT/bin/$_REQUIRE is missing or not executable. Fix: git -C \"$_EXTEND_ROOT\" checkout -- bin/$_REQUIRE, or re-clone gstack-extend"
    exit 1
  fi
fi

if [ -n "$_EXTEND_ROOT" ]; then
  echo "EXTEND_ROOT: $_EXTEND_ROOT"
  printf '_EXTEND_ROOT=%q\n' "$_EXTEND_ROOT"
elif [ -n "$_ER_UNVERIFIED" ]; then
  echo "EXTEND_ROOT_UNVERIFIED: $_ER_UNVERIFIED"
else
  echo "preamble: no gstack-extend install under ~/.claude/skills/$_ER_SKILL or ~/.codex/skills/$_ER_SKILL" >&2
fi

if [ "$_MODE_ROOT" -eq 1 ]; then
  exit 0
fi

if [ -n "$_EXTEND_ROOT" ]; then
  _UPD_EXIT=0
  if [ "$_FORCE" -eq 1 ]; then
    _UPD=$(GSTACK_EXTEND_DIR="$_EXTEND_ROOT" "$_EXTEND_ROOT/bin/update-check" --force 2>/dev/null) || _UPD_EXIT=$?
  else
    _UPD=$(GSTACK_EXTEND_DIR="$_EXTEND_ROOT" "$_EXTEND_ROOT/bin/update-check" 2>/dev/null) || _UPD_EXIT=$?
  fi
  if [ "$_UPD_EXIT" -ne 0 ]; then
    echo "preamble: update-check exited $_UPD_EXIT; run $_EXTEND_ROOT/bin/update-check directly to see why" >&2
  fi
  [ -n "$_UPD" ] && echo "$_UPD" || true
fi

_run_telemetry_start
exit 0
