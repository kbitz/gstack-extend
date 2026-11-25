# Shared Bun prerequisite probe and refusal formatting for gstack-extend.
# POSIX sh. Source this file; do not execute directly.
#
# Safety contract:
# - Only BUN_PREREQ_* globals are assigned.
# - Never mutates IFS; splits via parameter expansion.
# - Every probe command runs in condition context so caller set -e / set -u /
#   ERR traps never fire before classification.
# - The version probe runs only shell builtins and the selected Bun:
#   --version, plus --help at the floor. The runtime-dependency check uses
#   system awk and formats refusals with system tr and sed.
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

_bun_prereq_floor_has_flag() {
  if ! { BUN_PREREQ_HELP=$(NO_COLOR=1 FORCE_COLOR=0 "$BUN_PREREQ_RAW_PATH" --help </dev/null); } 2>/dev/null; then
    return 1
  fi
  while IFS= read -r BUN_PREREQ_HELP_LINE; do
    BUN_PREREQ_HELP_LINE=${BUN_PREREQ_HELP_LINE#"${BUN_PREREQ_HELP_LINE%%[![:blank:]]*}"}
    case "$BUN_PREREQ_HELP_LINE" in
      --no-env-file|--no-env-file[[:blank:]]*) return 0 ;;
    esac
  done <<EOF
$BUN_PREREQ_HELP
EOF
  return 1
}

# bun_prereq_probe [resolved_bun_path]
# Sets:
#   BUN_PREREQ_CLASS       ok | missing | too_old | unknown
#   BUN_PREREQ_TOKEN       '' | PREREQ_BUN_MISSING | PREREQ_BUN_TOO_OLD | PREREQ_BUN_VERSION_UNKNOWN
#   BUN_PREREQ_ERROR_CODE  '' | bun_missing | bun_too_old | bun_version_unknown
#   BUN_PREREQ_FOUND       numeric core (on ok/too_old) or sanitized detail (on unknown) or ''
#   BUN_PREREQ_PATH        resolved path, sanitized on refusal, or 'not on PATH'
#   BUN_PREREQ_RAW_PATH    raw path when resolved, otherwise ''. Exec only on ok.
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
  # Preserve the command's input and suppress diagnostics from the shell itself.
  if { BUN_PREREQ_OUT=$("$BUN_PREREQ_RAW_PATH" --version </dev/null); } 2>/dev/null; then
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
      # Early canaries reported the stable floor before this flag landed.
      if [ "$BUN_PREREQ_CMP" -gt 0 ] ||
         { [ "$BUN_PREREQ_CMP" -eq 0 ] && _bun_prereq_floor_has_flag; }; then
        BUN_PREREQ_CLASS='ok'
        BUN_PREREQ_PATH=$BUN_PREREQ_RAW_PATH
        return 0
      fi
      _bun_prereq_sanitize "$BUN_PREREQ_RAW_PATH"
      BUN_PREREQ_PATH=${BUN_PREREQ_SAN:-bun}
      BUN_PREREQ_DETAIL="found $BUN_PREREQ_FOUND at $BUN_PREREQ_PATH"
      if [ "$BUN_PREREQ_CMP" -eq 0 ]; then
        BUN_PREREQ_DETAIL="$BUN_PREREQ_DETAIL, but its help did not confirm --no-env-file"
      fi
      _bun_prereq_refuse too_old PREREQ_BUN_TOO_OLD bun_too_old \
        "Bun >= $BUN_PREREQ_MIN is required ($BUN_PREREQ_DETAIL)" \
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

# Read the top-level dependencies or version field without starting Bun or jq.
_bun_runtime_manifest_field() {
  LC_ALL=C command -p awk -v key="\"$2\"" '
    # Skip quoted strings as a unit so scripts and nested fields cannot
    # impersonate a top-level dependency or version declaration.
    function next_token() {
      sub(/^[[:space:]]+/, "", json)
      if (match(json, /^"([^"\\]|\\.)*"/)) {
        token = substr(json, 1, RLENGTH)
      } else {
        token = substr(json, 1, 1)
      }
      json = substr(json, length(token) + 1)
      return token
    }
    function field(    depth, part, previous) {
      while ((part = next_token()) != "") {
        if (depth == 1 && part == key && (previous == "{" || previous == ",")) {
          if (next_token() == ":") return next_token()
        }
        if (part == "{" || part == "[") depth++
        if (part == "}" || part == "]") depth--
        previous = part
      }
      return ""
    }
    function refuse(message) {
      print message
      exit 1
    }
    { json = json $0 "\n" }
    END {
      if (json !~ /^[[:space:]]*\{/) refuse("invalid package.json")
      part = field()
      if (key == "\"version\"") {
        print part
        exit
      }
      if (part == "") exit 0
      if (part != "{") refuse("invalid dependencies in package.json")
      while ((name = next_token()) != "}") {
        if (name !~ /^"(@[a-zA-Z0-9_-][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9_-][a-zA-Z0-9._-]*"$/ ||
            next_token() != ":") refuse("invalid dependency name in package.json")
        want = next_token()
        if (want !~ /^"[0-9]+\.[0-9]+\.[0-9]+([-+][a-zA-Z0-9.+-]+)?"$/)
          refuse("dependency " name " must declare an exact version")
        print substr(name, 2, length(name) - 2), want
        part = next_token()
        if (part == "}") break
        if (part != ",") refuse("invalid dependencies in package.json")
      }
    }
  ' 2>/dev/null < "$1"
}

# bun_runtime_deps_check <checkout_root>
bun_runtime_deps_check() {
  BUN_PREREQ_DEPS_TOKEN=''
  BUN_PREREQ_DEPS_WHAT=''
  BUN_PREREQ_DEPS_FIX=''
  [ -f "$1/package.json" ] || return 0

  BUN_PREREQ_DEPS_ROOT=$(CDPATH='' cd -P -- "$1" 2>/dev/null && pwd -P) || BUN_PREREQ_DEPS_ROOT=$1
  if BUN_PREREQ_DEPS_DECLS=$(_bun_runtime_manifest_field "$BUN_PREREQ_DEPS_ROOT/package.json" dependencies); then
    BUN_PREREQ_DEPS_DETAIL=''
    while IFS=' ' read -r BUN_PREREQ_DEPS_NAME BUN_PREREQ_DEPS_WANT; do
      [ -n "$BUN_PREREQ_DEPS_NAME" ] || continue
      BUN_PREREQ_DEPS_MANIFEST="$BUN_PREREQ_DEPS_ROOT/node_modules/$BUN_PREREQ_DEPS_NAME/package.json"
      if [ ! -f "$BUN_PREREQ_DEPS_MANIFEST" ] || [ ! -r "$BUN_PREREQ_DEPS_MANIFEST" ] ||
         ! BUN_PREREQ_DEPS_HAVE=$(_bun_runtime_manifest_field "$BUN_PREREQ_DEPS_MANIFEST" version) ||
         [ "$BUN_PREREQ_DEPS_HAVE" != "$BUN_PREREQ_DEPS_WANT" ]; then
        BUN_PREREQ_DEPS_VERSION=${BUN_PREREQ_DEPS_WANT#\"}
        BUN_PREREQ_DEPS_DETAIL="missing or mismatched runtime dependency $BUN_PREREQ_DEPS_NAME@${BUN_PREREQ_DEPS_VERSION%\"}"
        break
      fi
    done <<EOF
$BUN_PREREQ_DEPS_DECLS
EOF
    [ -n "$BUN_PREREQ_DEPS_DETAIL" ] || return 0
  else
    # A validation failure can occur after one or more valid entries.
    BUN_PREREQ_DEPS_DETAIL=${BUN_PREREQ_DEPS_DECLS##*"
"}
  fi

  BUN_PREREQ_DEPS_TOKEN='PREREQ_DEPS_MISSING'
  BUN_PREREQ_DEPS_DISPLAY=$(printf '%s' "$BUN_PREREQ_DEPS_ROOT" | LC_ALL=C command -p tr -d '[:cntrl:]' 2>/dev/null) ||
    BUN_PREREQ_DEPS_DISPLAY='<checkout>'
  BUN_PREREQ_DEPS_WHAT="${BUN_PREREQ_DEPS_DETAIL:-could not verify runtime dependencies} in $BUN_PREREQ_DEPS_DISPLAY"
  case "$BUN_PREREQ_DEPS_ROOT" in
    *[[:cntrl:]]*) BUN_PREREQ_DEPS_SETUP='./setup' ;;
    *) BUN_PREREQ_DEPS_SETUP="'$(printf '%s/setup' "$BUN_PREREQ_DEPS_ROOT" | LC_ALL=C command -p sed "s/'/'\\\\''/g" 2>/dev/null)'" ||
        BUN_PREREQ_DEPS_SETUP='./setup' ;;
  esac
  BUN_PREREQ_DEPS_FIX="$BUN_PREREQ_DEPS_SETUP --host auto or run bun install --production --frozen-lockfile --ignore-scripts --config=/dev/null --no-env-file from the checkout. No changes were made. See docs/installation.md#requirements"
  return 1
}

bun_runtime_deps_print_shared() {
  printf '%s: %s %s; run: %s.\n' "$1" "$BUN_PREREQ_DEPS_TOKEN" "$BUN_PREREQ_DEPS_WHAT" "$BUN_PREREQ_DEPS_FIX"
}
