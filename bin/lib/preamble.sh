#!/usr/bin/env bash
# Fixed skill start command: setup installs a copy at $HOME/.gstack-extend/bin/preamble.
# Resolves the verified gstack-extend root from Claude Code or Codex, runs update-check,
# and starts telemetry. See docs/installation.md#start-command.

_usage() {
  echo "preamble: usage: preamble <skill> [--force] [--require <helper>] [--root | --resume | --ref <file> --expect <digest> [--lines <a>-<b>]]" >&2
}

_fail_usage() {
  echo "preamble: PREAMBLE_USAGE: $1" >&2
  _usage
  exit 2
}

_fail_ref_usage() {
  printf 'SKILL_REFERENCE_USAGE: /%s ref %s (cause: usage; root %s; VERSION %s; detail: %s) Fix: run ~/.gstack-extend/bin/preamble <skill> --ref <file> --expect <digest> [--lines <a>-<b>]. See docs/installation.md#skill-references\n' \
    "$_ER_SKILL" "${_REF_FILE:-none}" "${_EXTEND_ROOT:-unknown}" "${_REF_VER:-unknown}" "$1" >&2
  exit 2
}

_fail_ref_missing() {
  printf 'SKILL_REFERENCE_MISSING: /%s ref %s (cause: %s; path %s; root %s; VERSION %s) Fix: %s See docs/installation.md#skill-references\n' \
    "$_ER_SKILL" "$_REF_FILE" "$1" "$_REF_PATH" "$_EXTEND_ROOT" "$_REF_VER" "$2"
  exit 1
}

_print_help() {
  cat <<'EOF'
Usage: preamble <skill> [--force] [--require <helper>] [--root | --resume | --ref <file> --expect <digest> [--lines <a>-<b>]]

Resolve the gstack-extend install for <skill>, run update-check, and start telemetry.
With --ref, fetch a skill reference file from the verified checkout, verify its digest,
and print numbered lines followed by a REFERENCE_END trailer.

Options:
  --force             pass --force to bin/update-check
  --require <helper>  require a verified install and executable bin/<helper> (exit 1 on ERROR)
  --root              print only the root lines
  --resume            start a new telemetry segment
  --ref <file>        fetch skills/references/<skill>/<file>.md from the verified checkout
  --expect <digest>   expected 16-hex SHA-256 content digest (required with --ref)
  --lines <a>-<b>     optional 1-based inclusive line range for --ref
  -h, --help          show this help and exit 0
EOF
}

_sha256_16() {
  local hash
  if command -v sha256sum >/dev/null 2>&1; then
    hash=$(sha256sum) || return 1
  elif command -v shasum >/dev/null 2>&1; then
    hash=$(shasum -a 256) || return 1
  elif command -v openssl >/dev/null 2>&1; then
    hash=$(openssl dgst -sha256) || return 1
    hash=${hash##* }
  else
    return 1
  fi
  printf '%s\n' "${hash:0:16}"
}

_is_valid_digest() {
  case "$1" in
    ????????????????)
      case "$1" in
        *[!0123456789abcdef]*) return 1 ;;
        *) return 0 ;;
      esac
      ;;
    *) return 1 ;;
  esac
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
_REF_FILE=""
_REF_EXPECT=""
_REF_LINES=""
_HAS_REF=0
_HAS_LINES=0

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
    --ref)
      [ "$_HAS_REF" -eq 0 ] || _fail_ref_usage "repeated --ref"
      _HAS_REF=1
      if [ "$#" -lt 2 ]; then
        _fail_ref_usage "--ref requires a <file> value"
      fi
      if ! _is_valid_name "$2"; then
        _fail_ref_usage "invalid reference name"
      fi
      _REF_FILE="$2"
      shift 2
      ;;
    --expect)
      [ -z "$_REF_EXPECT" ] || _fail_ref_usage "repeated --expect"
      if [ "$#" -lt 2 ]; then
        _fail_ref_usage "--expect requires a <digest> value"
      fi
      _REF_EXPECT="$2"
      if ! _is_valid_digest "$_REF_EXPECT"; then
        _fail_ref_usage "--expect requires 16 lowercase hex characters"
      fi
      shift 2
      ;;
    --lines)
      [ "$_HAS_LINES" -eq 0 ] || _fail_ref_usage "repeated --lines"
      _HAS_LINES=1
      if [ "$#" -lt 2 ]; then
        _fail_ref_usage "--lines requires an <a>-<b> range"
      fi
      _REF_LINES="$2"
      shift 2
      ;;
    *)
      if [ "$_HAS_REF" -eq 1 ] || [ "$_HAS_LINES" -eq 1 ] || [ -n "$_REF_EXPECT" ]; then
        _fail_ref_usage "unknown argument in reference mode"
      fi
      _fail_usage "unknown argument: $1"
      ;;
  esac
done

if [ "$_HAS_REF" -eq 1 ] || [ -n "$_REF_EXPECT" ] || [ "$_HAS_LINES" -eq 1 ]; then
  if [ "$_HAS_REF" -eq 0 ]; then
    _fail_ref_usage "--expect and --lines require --ref"
  fi
  if [ -z "$_REF_EXPECT" ]; then
    _fail_ref_usage "--ref requires --expect <digest>"
  fi
  if [ "$_FORCE" -eq 1 ] || [ -n "$_REQUIRE" ] || [ "$_MODE_ROOT" -eq 1 ] || [ "$_MODE_RESUME" -eq 1 ]; then
    _fail_ref_usage "--ref cannot be combined with --force, --require, --root, or --resume"
  fi
  if [ "$_HAS_LINES" -eq 1 ]; then
    # Bound the numbers before shell arithmetic. References have far fewer lines.
    if [[ ! $_REF_LINES =~ ^([1-9][0-9]{0,8})-([1-9][0-9]{0,8})$ ]]; then
      _fail_ref_usage "invalid --lines range (expected positive line numbers in <a>-<b>)"
    fi
    _REF_LINE_START="${BASH_REMATCH[1]}"
    _REF_LINE_END="${BASH_REMATCH[2]}"
    [ "$_REF_LINE_END" -ge "$_REF_LINE_START" ] || _fail_ref_usage "invalid --lines range (expected a <= b)"
  fi
fi

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

if [ "$_HAS_REF" -eq 1 ]; then
  if [ -z "$_EXTEND_ROOT" ]; then
    echo "SKILL_REFERENCE_MISSING: /$_ER_SKILL ref $_REF_FILE (cause: no-root; root none; VERSION unknown) ${_ER_UNVERIFIED:-No gstack-extend install found under ~/.claude or ~/.codex. Project-local (vendored) installs are not supported. Fix: run setup --host auto from your gstack-extend checkout (README: Installation).} See docs/installation.md#skill-references"
    exit 1
  fi
  _REF_VER="unknown"
  if [ -f "$_EXTEND_ROOT/VERSION" ] && [ -r "$_EXTEND_ROOT/VERSION" ]; then
    IFS= read -r _REF_VER < "$_EXTEND_ROOT/VERSION" || true
    [ -n "$_REF_VER" ] || _REF_VER="unknown"
  fi
  _REF_PATH="$_EXTEND_ROOT/skills/references/$_ER_SKILL/$_REF_FILE.md"
  if [ ! -e "$_REF_PATH" ]; then
    if [ -f "$_EXTEND_ROOT/.git" ]; then
      _REF_FIX="\"$_EXTEND_ROOT\" is a linked worktree (bin/update-run refuses linked worktrees); run setup --host auto from your stable gstack-extend checkout."
    else
      _REF_FIX="run \"$_EXTEND_ROOT/bin/update-run\" \"$_EXTEND_ROOT\" (or git -C \"$_EXTEND_ROOT\" status -- skills/references if the checkout has local changes)."
    fi
    _fail_ref_missing absent "$_REF_FIX"
  fi
  if [ ! -f "$_REF_PATH" ] || [ ! -r "$_REF_PATH" ] || [ -L "$_REF_PATH" ]; then
    _fail_ref_missing unreadable "verify \"$_REF_PATH\" is a readable regular reference file and check its permissions."
  fi
  # Hash and print the same bytes even if an update replaces the checkout file.
  _REF_COPY=$(mktemp "${TMPDIR:-/tmp}/skill-reference.XXXXXX" 2>/dev/null) ||
    _fail_ref_missing unreadable "check write permission in the temporary directory."
  trap 'rm -f -- "$_REF_COPY"' EXIT
  cat -- "$_REF_PATH" 2>/dev/null > "$_REF_COPY" ||
    _fail_ref_missing unreadable "check read permission on \"$_REF_PATH\" and free space in the temporary directory."
  if ! _REF_ACTUAL=$(_sha256_16 2>/dev/null < "$_REF_COPY") || ! _is_valid_digest "$_REF_ACTUAL"; then
    _fail_ref_missing unreadable "check that sha256sum, shasum, or openssl can compute the reference digest."
  fi
  if [ "$_REF_ACTUAL" != "$_REF_EXPECT" ]; then
    echo "SKILL_REFERENCE_STALE: /$_ER_SKILL ref $_REF_FILE (cause: digest-mismatch; expected $_REF_EXPECT; actual $_REF_ACTUAL; path $_REF_PATH; root $_EXTEND_ROOT; VERSION $_REF_VER) Fix: restart /$_ER_SKILL so the loaded skill matches checkout VERSION $_REF_VER; if it still differs, run \"$_EXTEND_ROOT/setup\" --host auto from the checkout this host should use. See docs/installation.md#skill-references"
    exit 1
  fi
  _REF_TOTAL=$(awk 'END { print NR + 0 }' "$_REF_COPY" 2>/dev/null) ||
    _fail_ref_missing unreadable "check that awk can read the reference from the temporary directory."
  if [ "$_HAS_LINES" -eq 1 ] && [ "$_REF_LINE_END" -gt "$_REF_TOTAL" ]; then
    _fail_ref_usage "requested line range ends after line $_REF_TOTAL"
  fi
  awk -v a="${_REF_LINE_START:-1}" -v b="${_REF_LINE_END:-$_REF_TOTAL}" \
    'NR >= a && NR <= b { printf "%d: %s\n", NR, $0 }' "$_REF_COPY" || exit 1
  echo "REFERENCE_END $_ER_SKILL/$_REF_FILE lines=$_REF_TOTAL digest=$_REF_ACTUAL"
  exit 0
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
