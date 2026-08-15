#!/usr/bin/env bash
# run-migrations.sh — version-window + ledger runner for gstack-extend upgrades.
#
# Usage:
#   bash bin/lib/run-migrations.sh <install-dir> <state-dir> <old-version> <new-version>
#
# Invoked from bin/update-run AFTER ./setup and BEFORE checkout-restore.
# Read from the pulled tree so a newer helper can run without re-execing
# update-run. A pre-15B update-run that pulled this file will not call it —
# the first reliable hop is the first upgrade AFTER this helper is installed.
#
# Ledger (not the version window) is the applied-set:
#   $STATE_DIR/migrations-applied
#   $STATE_DIR/migrations-failed
# Run if (in-window OR listed failed) AND not listed applied.
# Scripts must be idempotent — failed names retry on the next update-run
# even when OLD==NEW.
#
# Scripts receive INSTALL_DIR, STATE_DIR, OLD_VERSION, NEW_VERSION in the
# environment. Do not cd. Do not mutate the git checkout.
#
# Script failures print MIGRATION_WARN and continue. Unexpected helper
# aborts print MIGRATION_WARN helper and exit 0. update-run also uses || true.
set -euo pipefail

_CLEAN=""
on_helper_exit() {
  _ec=$?
  [ -n "$_CLEAN" ] && return 0
  _CLEAN=1
  echo "MIGRATION_WARN helper exit=$_ec"
  exit 0
}
trap on_helper_exit EXIT

finish() {
  _CLEAN=1
  exit 0
}

INSTALL_DIR="${1:-}"
STATE_DIR="${2:-}"
OLD_VERSION="${3:-}"
NEW_VERSION="${4:-}"

if [ -z "$INSTALL_DIR" ] || [ -z "$STATE_DIR" ] || [ -z "$OLD_VERSION" ] || [ -z "$NEW_VERSION" ]; then
  echo "MIGRATION_WARN helper exit=missing-args"
  finish
fi

SEMVER="$INSTALL_DIR/bin/lib/semver.sh"
if [ ! -f "$SEMVER" ]; then
  echo "MIGRATION_WARN helper exit=semver-missing"
  finish
fi
# shellcheck disable=SC1090
. "$SEMVER"

is_semver() {
  case "$1" in
    *[!0-9.]*) return 1 ;;
    [0-9]*.[0-9]*.[0-9]*) return 0 ;;
    *) return 1 ;;
  esac
}

_WINDOW_OK=1
if ! is_semver "$OLD_VERSION" || ! is_semver "$NEW_VERSION"; then
  echo "MIGRATION_WARN helper exit=bad-version"
  _WINDOW_OK=""
fi

MIGDIR="$INSTALL_DIR/migrations"
if [ ! -d "$MIGDIR" ]; then
  finish
fi

mkdir -p "$STATE_DIR"
APPLIED="$STATE_DIR/migrations-applied"
FAILED="$STATE_DIR/migrations-failed"
touch "$APPLIED" "$FAILED"

ledger_has() {
  grep -qxF "$2" "$1"
}

ledger_add() {
  if ! grep -qxF "$2" "$1"; then
    printf '%s\n' "$2" >> "$1"
  fi
}

ledger_remove() {
  local tmp ec
  tmp=$(mktemp)
  set +e
  grep -vxF "$2" "$1" > "$tmp"
  ec=$?
  set -e
  # 0 = lines remain, 1 = empty result. Anything else is a write/read error.
  if [ "$ec" -eq 0 ] || [ "$ec" -eq 1 ]; then
    mv "$tmp" "$1"
  else
    rm -f "$tmp"
  fi
}

in_window() {
  version_gt "$1" "$OLD_VERSION" || return 1
  semver_lte "$1" "$NEW_VERSION"
}

# Collect "ver<TAB>path" lines, skip non-semver names.
_CANDS=$(mktemp)
for _f in "$MIGDIR"/v*.sh; do
  [ -f "$_f" ] || continue
  if [ -L "$_f" ]; then
    continue
  fi
  _base=$(basename "$_f")
  _ver="${_base#v}"
  _ver="${_ver%.sh}"
  case "$_ver" in
    *[!0-9.]*) continue ;;
    [0-9]*.[0-9]*.[0-9]*) ;;
    *) continue ;;
  esac
  printf '%s\t%s\n' "$_ver" "$_f" >> "$_CANDS"
done

# Version-ascending sort via version_gt (no sort -V on stock macOS).
_SORTED=$(mktemp)
if [ -s "$_CANDS" ]; then
  while IFS= read -r _line; do
    _ver="${_line%%	*}"
    _inserted=""
    if [ ! -s "$_SORTED" ]; then
      printf '%s\n' "$_line" > "$_SORTED"
      continue
    fi
    _OUT=$(mktemp)
    while IFS= read -r _exist; do
      _ever="${_exist%%	*}"
      if [ -z "$_inserted" ] && version_gt "$_ever" "$_ver"; then
        printf '%s\n' "$_line" >> "$_OUT"
        _inserted=1
      fi
      printf '%s\n' "$_exist" >> "$_OUT"
    done < "$_SORTED"
    if [ -z "$_inserted" ]; then
      printf '%s\n' "$_line" >> "$_OUT"
    fi
    mv "$_OUT" "$_SORTED"
  done < "$_CANDS"
fi
rm -f "$_CANDS"

if [ ! -s "$_SORTED" ]; then
  rm -f "$_SORTED"
  finish
fi

while IFS= read -r _line; do
  _ver="${_line%%	*}"
  _path="${_line#*	}"
  _base=$(basename "$_path")

  if ledger_has "$APPLIED" "$_base"; then
    continue
  fi
  _should=""
  if [ -n "$_WINDOW_OK" ] && in_window "$_ver"; then
    _should=1
  elif ledger_has "$FAILED" "$_base"; then
    if semver_lte "$_ver" "$NEW_VERSION"; then
      _should=1
    fi
  fi
  [ -n "$_should" ] || continue

  # Close stdin so a script that reads stdin cannot consume later candidates.
  if INSTALL_DIR="$INSTALL_DIR" STATE_DIR="$STATE_DIR" \
     OLD_VERSION="$OLD_VERSION" NEW_VERSION="$NEW_VERSION" \
     bash "$_path" </dev/null; then
    ledger_add "$APPLIED" "$_base"
    ledger_remove "$FAILED" "$_base"
  else
    _ec=$?
    echo "MIGRATION_WARN $_base exit=$_ec"
    ledger_add "$FAILED" "$_base"
  fi
done < "$_SORTED"
rm -f "$_SORTED"
finish
