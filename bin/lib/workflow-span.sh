# gstack-extend workflow-span lib (Track 31A). Source this file in bash or zsh; do not execute it.
# workflow-span-protocol: v1
#
# Records one workflow-metrics span (an optional governing RUN decision plus the begin and end
# of a step) at the moment each boundary happens, through the telemetry launcher's `metrics`
# operations. It never changes the work it wraps: every function returns 0, the work's own exit
# status stays in the caller's `rc`, and a missing launcher, disabled capture or malformed reply
# only means no record. Contract and the site form: docs/telemetry.md#workflow-metrics-span.
#
# Caller-set values (retained from the run begin; set them before each call, the shell is new
# every Bash call): GX_STAGE (review-and-prep|ship-and-land), GX_SID (the start's session ID),
# GX_CAPTURE (1 only when the run begin was recorded or replayed), GX_LIB (this file's path;
# the launcher is its sibling bin/gstack-extend-telemetry).
#
#   gx_span_begin PHASE PARENT KIND [CTX]       KIND = phase|fix|voice; CTX = candidate override JSON
#   gx_span_begin_wait CATEGORY PARENT [CTX]    a wait step; no decision
#   gx_span_end STEP RC [BEGIN [OUTCOME]]       BEGIN = the begin= value of the step's SPAN line when
#                                               this shell did not begin it; OUTCOME overrides
#                                               completed|failed (paused, cancelled)
#   NODECISION=1 skips the RUN decision (a second step in one phase visit); GX_REASON sets its
#   reason (default required). GX_STEP holds the id the last begin minted: read it, never wrap
#   a call in $(...) or the assignment is lost.
#
# Each call prints one SPAN line to quote later:
#   SPAN step=<id> phase=<phase> begin=<status> end=pending
#   SPAN step=<id> phase=<phase> begin=<status> end=<status|skipped> rc=<n>
# An empty or nonnumeric RC emits no end and prints end=missing rc=unknown.
# Even an explicit OUTCOME requires RC (use 0 for an observed pause/cancel).
# Statuses are recorded, replayed, match (an unconfirmed write the read found), unconfirmed,
# missing, disabled, unavailable, conflict, partial or skipped. A decision that was not
# recorded appends decision=<status>. Variables start with _gx_/GX_ and avoid zsh's reserved
# names (status, path).

_gx_field() {
  printf '%s' "$1" | grep -o "\"$2\" *: *\"[^\"]*\"" | head -n 1 | sed 's/^[^:]*: *"//; s/"$//'
}

_gx_event_status() {
  printf '%s' "$1" | grep -o '"event" *: *{ *"status" *: *"[a-z]*"' | head -n 1 | sed 's/.*"\([a-z]*\)"$/\1/'
}

_gx_mint() {
  python3 -B -I -c 'import uuid;print(*[uuid.uuid4() for _ in range(3)])' 2>/dev/null
}

# _gx_emit OP EVENT_ID PAYLOAD REPLAY: sends one producer record and sets _GX_RES. An unconfirmed
# or unreadable reply is reconciled once with `metrics read --event-id`: a match counts without
# appending; absent leaves the boundary missing (a decision, which derives no interval, is
# replayed once with its identical payload).
_gx_emit() {
  _gx_out=$(printf '%s' "$3" | "$GX_BIN" metrics "$1" 2>/dev/null) || :
  _GX_RES=$(_gx_field "$_gx_out" status)
  case "$_GX_RES" in
    recorded|replayed|disabled|unavailable|conflict|partial) return 0 ;;
    unconfirmed|"") ;;
    *) _GX_RES=""; ;;
  esac
  _gx_out=$("$GX_BIN" metrics read --session-id "$GX_SID" --event-id "$2" 2>/dev/null) || :
  _gx_ev=$(_gx_event_status "$_gx_out")
  case "$_gx_ev" in
    match) _GX_RES=match; return 0 ;;
    absent)
      if [ "${4:-0}" = 1 ]; then
        _gx_out=$(printf '%s' "$3" | "$GX_BIN" metrics "$1" 2>/dev/null) || :
        _GX_RES=$(_gx_field "$_gx_out" status)
        case "$_GX_RES" in recorded|replayed) return 0 ;; esac
      fi
      ;;
  esac
  case "$_GX_RES" in unconfirmed) ;; *) _GX_RES=missing ;; esac
  return 0
}

_gx_ready() {
  [ "${GX_CAPTURE:-0}" = 1 ] && [ -n "${GX_SID:-}" ] && [ -n "${GX_STAGE:-}" ] && [ -n "${GX_LIB:-}" ] || return 1
  GX_BIN="${GX_LIB%/lib/workflow-span.sh}/gstack-extend-telemetry"
  [ -f "$GX_BIN" ] && [ -x "$GX_BIN" ]
}

_gx_begin() {
  _gx_sv=$-
  set +e
  _gx_kind=$1 _gx_label=$2 _gx_parent=$3 _gx_ctx=${4:-}
  GX_STEP=-
  _gx_dec=none
  if _gx_ready; then
    _gx_ids=$(_gx_mint) || _gx_ids=
    case "$_gx_ids" in
      *-*-*-*-*" "*-*-*-*-*" "*-*-*-*-*) ;;
      *) _gx_ids= ;;
    esac
  else
    _gx_ids=
  fi
  if [ -z "$_gx_ids" ]; then
    GX_BEGUN="${GX_BEGUN:-} -=skipped:$_gx_label"
    printf 'SPAN step=- phase=%s begin=skipped end=pending\n' "$_gx_label"
    case "$_gx_sv" in *e*) set -e ;; esac
    return 0
  fi
  _gx_step=${_gx_ids%% *}
  _gx_rest=${_gx_ids#* }
  _gx_devent=${_gx_rest%% *}
  _gx_bevent=${_gx_rest#* }
  _gx_head="\"v\":1,\"stage\":\"$GX_STAGE\",\"session_id\":\"$GX_SID\""
  if [ "$_gx_kind" != wait ] && [ "${NODECISION:-0}" != 1 ]; then
    _gx_json="{$_gx_head,\"event_id\":\"$_gx_devent\",\"step_id\":\"$_gx_step\",\"phase\":\"$_gx_label\",\"decision\":\"RUN\",\"reason\":\"${GX_REASON:-required}\"}"
    _gx_emit decision "$_gx_devent" "$_gx_json" 1
    _gx_dec=$_GX_RES
  fi
  case "$_gx_parent" in ""|null) _gx_pj=null ;; *) _gx_pj="\"$_gx_parent\"" ;; esac
  if [ "$_gx_kind" = wait ]; then
    _gx_what="\"wait_category\":\"$_gx_label\""
  else
    _gx_what="\"phase\":\"$_gx_label\""
  fi
  _gx_cj=
  [ -n "$_gx_ctx" ] && _gx_cj=",\"context\":$_gx_ctx"
  _gx_json="{$_gx_head,\"event_id\":\"$_gx_bevent\",\"step_id\":\"$_gx_step\",\"parent_step_id\":$_gx_pj,\"kind\":\"$_gx_kind\",$_gx_what$_gx_cj}"
  _gx_emit begin "$_gx_bevent" "$_gx_json" 0
  GX_STEP=$_gx_step
  GX_BEGUN="${GX_BEGUN:-} $_gx_step=$_GX_RES:$_gx_label"
  _gx_line="SPAN step=$_gx_step phase=$_gx_label begin=$_GX_RES end=pending"
  case "$_gx_dec" in none|recorded|replayed|match) ;; *) _gx_line="$_gx_line decision=$_gx_dec" ;; esac
  printf '%s\n' "$_gx_line"
  case "$_gx_sv" in *e*) set -e ;; esac
  return 0
}

gx_span_begin() {
  _gx_begin "${3:-phase}" "$1" "${2:-}" "${4:-}"
}

gx_span_begin_wait() {
  _gx_begin wait "$1" "${2:-}" "${3:-}"
}

gx_span_end() {
  _gx_sv=$-
  set +e
  _gx_step=${1:-} _gx_rc=${2:-} _gx_bstat=${3:-} _gx_outcome=${4:-}
  _gx_label=-
  _gx_reg=${GX_BEGUN:-}
  _gx_known=${_gx_reg#*" $_gx_step="}
  if [ "$_gx_known" != "$_gx_reg" ] && [ -n "$_gx_step" ]; then
    _gx_known=${_gx_known%% *}
    [ -n "$_gx_bstat" ] || _gx_bstat=${_gx_known%%:*}
    _gx_label=${_gx_known#*:}
  fi
  [ -n "$_gx_bstat" ] || _gx_bstat=unknown
  # A new shell has no prior rc: without the observed result, leave the span open.
  case "$_gx_rc" in
    ""|*[!0-9]*)
      printf 'SPAN step=%s phase=%s begin=%s end=missing rc=unknown\n' "${_gx_step:--}" "$_gx_label" "$_gx_bstat"
      case "$_gx_sv" in *e*) set -e ;; esac
      return 0
      ;;
  esac
  _gx_endstat=skipped
  case "$_gx_bstat" in
    recorded|replayed|match)
      if [ -n "$_gx_step" ] && [ "$_gx_step" != - ] && _gx_ready; then
        case "$_gx_outcome" in
          completed|failed|paused|cancelled) ;;
          *) case "$_gx_rc" in 0) _gx_outcome=completed ;; *) _gx_outcome=failed ;; esac ;;
        esac
        _gx_ids=$(_gx_mint) || _gx_ids=
        _gx_eevent=${_gx_ids%% *}
        case "$_gx_eevent" in
          *-*-*-*-*)
            _gx_json="{\"v\":1,\"stage\":\"$GX_STAGE\",\"session_id\":\"$GX_SID\",\"event_id\":\"$_gx_eevent\",\"step_id\":\"$_gx_step\",\"outcome\":\"$_gx_outcome\"}"
            _gx_emit end "$_gx_eevent" "$_gx_json" 0
            _gx_endstat=$_GX_RES
            ;;
        esac
      fi
      ;;
  esac
  printf 'SPAN step=%s phase=%s begin=%s end=%s rc=%s\n' "${_gx_step:--}" "$_gx_label" "$_gx_bstat" "$_gx_endstat" "$_gx_rc"
  case "$_gx_sv" in *e*) set -e ;; esac
  return 0
}
