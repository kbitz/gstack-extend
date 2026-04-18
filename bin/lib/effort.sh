#!/usr/bin/env bash
# gstack-extend effort/ceiling lib.
# Source this file; do not execute directly.
#
# Provides:
#   - effort_to_loc <S|M|L|XL>         : LOC forecast for a task effort tier.
#   - ceiling <key>                    : Integer ceiling, respecting overrides.
#   - _config_int_get <key> <default> <env_var> : Numeric lookup w/ fallback.
#
# Fallback order for every value: env var > bin/config > hardcoded default.
#
# Seed defaults are the median of "~N lines" hints in existing ROADMAP.md
# tasks. Tune via retrospective telemetry (deferred) or explicit override.

# Hardcoded defaults — the seed values documented in the CEO plan.
# LOC per effort tier.
EFFORT_S_LOC_DEFAULT=50
EFFORT_M_LOC_DEFAULT=150
EFFORT_L_LOC_DEFAULT=300
EFFORT_XL_LOC_DEFAULT=500

# Size caps per track.
ROADMAP_MAX_TASKS_PER_TRACK_DEFAULT=5
ROADMAP_MAX_LOC_PER_TRACK_DEFAULT=300
ROADMAP_MAX_FILES_PER_TRACK_DEFAULT=8
ROADMAP_MAX_TRACKS_PER_GROUP_DEFAULT=8

# Resolve the extend root so bin/config can be invoked regardless of caller cwd.
# The caller is expected to have set EXTEND_DIR (roadmap-audit does this).
# Fall back to our own location.
_EFFORT_EXTEND_DIR="${EXTEND_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"

# _config_int_get <config_key> <default> <env_var_name>
# Prints an integer value. Order: env > bin/config > default.
# Validates numeric — non-numeric overrides emit CONFIG_INVALID to stderr
# and fall through to the default (so an unrelated audit run still succeeds).
_config_int_get() {
  local key="$1" default="$2" env_name="$3"
  local env_val="${!env_name-}"
  local cfg_val=""
  if [ -n "$env_val" ]; then
    if _is_positive_int "$env_val"; then
      echo "$env_val"
      return 0
    fi
    echo "CONFIG_INVALID: env $env_name='$env_val' (expected positive integer, using default $default)" >&2
  fi
  cfg_val=$("$_EFFORT_EXTEND_DIR/bin/config" get "$key" 2>/dev/null || true)
  if [ -n "$cfg_val" ]; then
    if _is_positive_int "$cfg_val"; then
      echo "$cfg_val"
      return 0
    fi
    echo "CONFIG_INVALID: $key='$cfg_val' (expected positive integer, using default $default)" >&2
  fi
  echo "$default"
}

# _is_positive_int <value>
# 0 if value is a positive integer (1+), 1 otherwise.
_is_positive_int() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    0) return 1 ;;
    *) return 0 ;;
  esac
}

# effort_to_loc <S|M|L|XL>
# Prints the LOC forecast for an effort tier, or 0 for unknown labels.
effort_to_loc() {
  case "${1:-}" in
    S) _config_int_get roadmap_effort_s_loc "$EFFORT_S_LOC_DEFAULT" ROADMAP_EFFORT_S_LOC ;;
    M) _config_int_get roadmap_effort_m_loc "$EFFORT_M_LOC_DEFAULT" ROADMAP_EFFORT_M_LOC ;;
    L) _config_int_get roadmap_effort_l_loc "$EFFORT_L_LOC_DEFAULT" ROADMAP_EFFORT_L_LOC ;;
    XL) _config_int_get roadmap_effort_xl_loc "$EFFORT_XL_LOC_DEFAULT" ROADMAP_EFFORT_XL_LOC ;;
    *) echo 0 ;;
  esac
}

# ceiling <cap_key>
# Resolves one of the four track/group caps.
ceiling() {
  case "${1:-}" in
    max_tasks_per_track) _config_int_get roadmap_max_tasks_per_track "$ROADMAP_MAX_TASKS_PER_TRACK_DEFAULT" ROADMAP_MAX_TASKS_PER_TRACK ;;
    max_loc_per_track) _config_int_get roadmap_max_loc_per_track "$ROADMAP_MAX_LOC_PER_TRACK_DEFAULT" ROADMAP_MAX_LOC_PER_TRACK ;;
    max_files_per_track) _config_int_get roadmap_max_files_per_track "$ROADMAP_MAX_FILES_PER_TRACK_DEFAULT" ROADMAP_MAX_FILES_PER_TRACK ;;
    max_tracks_per_group) _config_int_get roadmap_max_tracks_per_group "$ROADMAP_MAX_TRACKS_PER_GROUP_DEFAULT" ROADMAP_MAX_TRACKS_PER_GROUP ;;
    *) echo 0 ;;
  esac
}
