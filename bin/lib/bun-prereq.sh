# Shared Bun prerequisite probe and refusal formatting for gstack-extend.
# POSIX sh. Source this file; do not execute directly.
#
# Safety contract:
# - Only BUN_PREREQ_* globals are assigned.
# - Never mutates IFS; splits via parameter expansion.
# - Every probe command runs in condition context so caller set -e / set -u /
#   ERR traps never fire before classification.
# - On the ok path, runs only shell builtins plus "$BUN_PREREQ_RAW_PATH" --version.
# - Probe-derived strings printed in messages are sanitized to a single line
#   of [0-9A-Za-z.+/_-] truncated at 64 characters.

BUN_PREREQ_MIN='1.3.3'

_bun_prereq_sanitize() {
  BUN_PREREQ_SAN=''
  BUN_PREREQ_S_IN=$1
  BUN_PREREQ_S_NL='
'
  BUN_PREREQ_S_IN=${BUN_PREREQ_S_IN%%"$BUN_PREREQ_S_NL"*}
  BUN_PREREQ_S_CR=$(printf '\r')
  BUN_PREREQ_S_IN=${BUN_PREREQ_S_IN%%"$BUN_PREREQ_S_CR"*}
  while [ "${#BUN_PREREQ_SAN}" -lt 64 ]; do
    # Skip an entire run of discarded characters before copying the next one.
    BUN_PREREQ_S_PREFIX=${BUN_PREREQ_S_IN%%[0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.+/_-]*}
    BUN_PREREQ_S_IN=${BUN_PREREQ_S_IN#"$BUN_PREREQ_S_PREFIX"}
    [ -n "$BUN_PREREQ_S_IN" ] || break
    BUN_PREREQ_S_REST=${BUN_PREREQ_S_IN#?}
    BUN_PREREQ_SAN="${BUN_PREREQ_SAN}${BUN_PREREQ_S_IN%"$BUN_PREREQ_S_REST"}"
    BUN_PREREQ_S_IN=$BUN_PREREQ_S_REST
  done
}

# Parse $1 into 4 numeric components (BUN_PREREQ_P1..P4) with leading zeros
# stripped. Accepts 2..4 dot-separated decimal components, each 1..9 digits.
# Returns 0 on valid numeric core, 1 otherwise.
_bun_prereq_parse_core() {
  BUN_PREREQ_P_REM=$1
  BUN_PREREQ_P1=0
  BUN_PREREQ_P2=0
  BUN_PREREQ_P3=0
  BUN_PREREQ_P4=0
  BUN_PREREQ_P_CNT=0
  [ -n "$BUN_PREREQ_P_REM" ] || return 1
  while :; do
    BUN_PREREQ_P_CNT=$((BUN_PREREQ_P_CNT + 1))
    [ "$BUN_PREREQ_P_CNT" -le 4 ] || return 1
    case "$BUN_PREREQ_P_REM" in
      *.*)
        BUN_PREREQ_P_SEG=${BUN_PREREQ_P_REM%%.*}
        BUN_PREREQ_P_REM=${BUN_PREREQ_P_REM#*.}
        BUN_PREREQ_P_MORE=1
        ;;
      *)
        BUN_PREREQ_P_SEG=$BUN_PREREQ_P_REM
        BUN_PREREQ_P_REM=''
        BUN_PREREQ_P_MORE=0
        ;;
    esac
    case "$BUN_PREREQ_P_SEG" in
      ''|*[!0123456789]*) return 1 ;;
    esac
    [ "${#BUN_PREREQ_P_SEG}" -le 9 ] || return 1
    while case "$BUN_PREREQ_P_SEG" in 0?*) true ;; *) false ;; esac; do
      BUN_PREREQ_P_SEG=${BUN_PREREQ_P_SEG#0}
    done
    case "$BUN_PREREQ_P_CNT" in
      1) BUN_PREREQ_P1=$BUN_PREREQ_P_SEG ;;
      2) BUN_PREREQ_P2=$BUN_PREREQ_P_SEG ;;
      3) BUN_PREREQ_P3=$BUN_PREREQ_P_SEG ;;
      4) BUN_PREREQ_P4=$BUN_PREREQ_P_SEG ;;
    esac
    [ "$BUN_PREREQ_P_MORE" -eq 1 ] || break
  done
  [ "$BUN_PREREQ_P_CNT" -ge 2 ] || return 1
  return 0
}

_bun_prereq_refuse() {
  BUN_PREREQ_CLASS=$1
  BUN_PREREQ_TOKEN=$2
  BUN_PREREQ_ERROR_CODE=$3
  BUN_PREREQ_WHAT=$4
  BUN_PREREQ_REMEDY=$5
  BUN_PREREQ_FIX="$BUN_PREREQ_REMEDY, then rerun the same command once; if it still refuses, report this line verbatim. No changes were made. See docs/installation.md#requirements"
  BUN_PREREQ_MSG="$BUN_PREREQ_TOKEN $BUN_PREREQ_WHAT"
}

# bun_prereq_probe [resolved_bun_path]
# Sets:
#   BUN_PREREQ_CLASS       ok | missing | too_old | unknown
#   BUN_PREREQ_TOKEN       '' | PREREQ_BUN_MISSING | PREREQ_BUN_TOO_OLD | PREREQ_BUN_VERSION_UNKNOWN
#   BUN_PREREQ_ERROR_CODE  '' | bun_missing | bun_too_old | bun_version_unknown
#   BUN_PREREQ_FOUND       numeric core (on ok/too_old) or sanitized detail (on unknown) or ''
#   BUN_PREREQ_PATH        sanitized resolved path or 'not on PATH'
#   BUN_PREREQ_RAW_PATH    unsanitized resolved path for exec on ok (or '')
#   BUN_PREREQ_WHAT        short sanitized description (without entry point)
#   BUN_PREREQ_REMEDY      install, upgrade or reinstall instructions
#   BUN_PREREQ_FIX         actionable fix + recovery + docs pointer
#   BUN_PREREQ_MSG         "<TOKEN> <WHAT>" for ERROR/FIX and JSON families
# Returns 0 when ok, 1 otherwise.
bun_prereq_probe() {
  BUN_PREREQ_CLASS=''
  BUN_PREREQ_TOKEN=''
  BUN_PREREQ_ERROR_CODE=''
  BUN_PREREQ_FOUND=''
  BUN_PREREQ_PATH='not on PATH'
  BUN_PREREQ_RAW_PATH=''
  BUN_PREREQ_WHAT=''
  BUN_PREREQ_REMEDY=''
  BUN_PREREQ_FIX=''
  BUN_PREREQ_MSG=''

  if [ "${1+set}" = set ] && [ -n "$1" ]; then
    BUN_PREREQ_RAW_PATH=$1
  else
    # The lookup must name a file, not a shell function or alias named bun.
    if [ -n "${PATH-}" ] && BUN_PREREQ_RAW_PATH=$(command -v bun 2>/dev/null) &&
       [ "${BUN_PREREQ_RAW_PATH#*/}" != "$BUN_PREREQ_RAW_PATH" ]; then
      :
    else
      BUN_PREREQ_RAW_PATH=''
      _bun_prereq_refuse missing PREREQ_BUN_MISSING bun_missing \
        "Bun >= $BUN_PREREQ_MIN is required (not on PATH)" \
        "install Bun >= $BUN_PREREQ_MIN (curl -fsSL https://bun.sh/install | bash and reload your shell or add ~/.bun/bin to PATH)"
      return 1
    fi
  fi

  case "$BUN_PREREQ_RAW_PATH" in
    /*) ;;
    *)
      if BUN_PREREQ_CWD=$(pwd -P 2>/dev/null); then
        BUN_PREREQ_RAW_PATH="${BUN_PREREQ_CWD%/}/$BUN_PREREQ_RAW_PATH"
      fi
      ;;
  esac
  BUN_PREREQ_OUT=''
  # Redirect the whole substitution, including diagnostics from the shell itself.
  if { BUN_PREREQ_OUT=$("$BUN_PREREQ_RAW_PATH" --version); } 2>/dev/null; then
    BUN_PREREQ_RC=0
  else
    BUN_PREREQ_RC=$?
  fi

  if [ "$BUN_PREREQ_RC" -eq 0 ] && [ -n "$BUN_PREREQ_OUT" ]; then
    BUN_PREREQ_NL='
'
    BUN_PREREQ_LINE=${BUN_PREREQ_OUT%%"$BUN_PREREQ_NL"*}
    BUN_PREREQ_CR=$(printf '\r')
    BUN_PREREQ_LINE=${BUN_PREREQ_LINE%%"$BUN_PREREQ_CR"*}
    BUN_PREREQ_CORE=$BUN_PREREQ_LINE
    case "$BUN_PREREQ_CORE" in
      v*) BUN_PREREQ_CORE=${BUN_PREREQ_CORE#v} ;;
    esac
    BUN_PREREQ_CORE=${BUN_PREREQ_CORE%%-*}
    BUN_PREREQ_CORE=${BUN_PREREQ_CORE%%+*}
    if _bun_prereq_parse_core "$BUN_PREREQ_CORE"; then
      BUN_PREREQ_F1=$BUN_PREREQ_P1
      BUN_PREREQ_F2=$BUN_PREREQ_P2
      BUN_PREREQ_F3=$BUN_PREREQ_P3
      BUN_PREREQ_F4=$BUN_PREREQ_P4
      _bun_prereq_parse_core "$BUN_PREREQ_MIN"
      BUN_PREREQ_CMP=0
      if [ "$BUN_PREREQ_F1" -lt "$BUN_PREREQ_P1" ]; then BUN_PREREQ_CMP=-1
      elif [ "$BUN_PREREQ_F1" -gt "$BUN_PREREQ_P1" ]; then BUN_PREREQ_CMP=1
      elif [ "$BUN_PREREQ_F2" -lt "$BUN_PREREQ_P2" ]; then BUN_PREREQ_CMP=-1
      elif [ "$BUN_PREREQ_F2" -gt "$BUN_PREREQ_P2" ]; then BUN_PREREQ_CMP=1
      elif [ "$BUN_PREREQ_F3" -lt "$BUN_PREREQ_P3" ]; then BUN_PREREQ_CMP=-1
      elif [ "$BUN_PREREQ_F3" -gt "$BUN_PREREQ_P3" ]; then BUN_PREREQ_CMP=1
      elif [ "$BUN_PREREQ_F4" -lt "$BUN_PREREQ_P4" ]; then BUN_PREREQ_CMP=-1
      elif [ "$BUN_PREREQ_F4" -gt "$BUN_PREREQ_P4" ]; then BUN_PREREQ_CMP=1
      fi
      BUN_PREREQ_FOUND=$BUN_PREREQ_CORE
      if [ "$BUN_PREREQ_CMP" -ge 0 ]; then
        BUN_PREREQ_CLASS='ok'
        BUN_PREREQ_PATH=$BUN_PREREQ_RAW_PATH
        return 0
      fi
      _bun_prereq_sanitize "$BUN_PREREQ_RAW_PATH"
      BUN_PREREQ_PATH=${BUN_PREREQ_SAN:-bun}
      _bun_prereq_refuse too_old PREREQ_BUN_TOO_OLD bun_too_old \
        "Bun >= $BUN_PREREQ_MIN is required (found $BUN_PREREQ_FOUND at $BUN_PREREQ_PATH)" \
        "upgrade Bun to >= $BUN_PREREQ_MIN (bun upgrade, or upgrade via your package manager)"
      return 1
    fi
  fi

  _bun_prereq_sanitize "$BUN_PREREQ_RAW_PATH"
  BUN_PREREQ_PATH=${BUN_PREREQ_SAN:-bun}
  if [ "$BUN_PREREQ_RC" -ne 0 ]; then
    BUN_PREREQ_FOUND="exit_${BUN_PREREQ_RC}"
  elif [ -z "$BUN_PREREQ_OUT" ]; then
    BUN_PREREQ_FOUND='empty_output'
  else
    _bun_prereq_sanitize "$BUN_PREREQ_OUT"
    BUN_PREREQ_FOUND=${BUN_PREREQ_SAN:-unparseable}
  fi
  _bun_prereq_refuse unknown PREREQ_BUN_VERSION_UNKNOWN bun_version_unknown \
    "Bun >= $BUN_PREREQ_MIN is required (could not determine version at $BUN_PREREQ_PATH; saw $BUN_PREREQ_FOUND)" \
    "upgrade or reinstall Bun >= $BUN_PREREQ_MIN (bun upgrade, or curl -fsSL https://bun.sh/install | bash and reload your shell)"
  return 1
}

# bun_prereq_print_shared <entry_name>
# Prints the single-line shared refusal message to stdout (callers redirect to stderr).
bun_prereq_print_shared() {
  printf '%s: %s; run: %s.\n' "$1" "$BUN_PREREQ_MSG" "$BUN_PREREQ_FIX"
}
