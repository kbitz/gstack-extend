#!/usr/bin/env bash
# gstack-extend install-safety primitives.
# Source this file; do not execute directly.
#
# is_safe_install_path: Defense-in-depth check before any install-side
# mutation (mkdir -p, ln -snf, rm -f, rmdir, readlink) that could be
# subverted by an attacker who has planted a symlink at the install target
# or any ancestor.
#
# Exit codes: 0 = safe, 1 = unsafe (with stderr explanation).
#
# Threat model: an attacker can write into $HOME but cannot already control
# ~/.claude/skills (the install root). Mitigation: refuse to install if the
# resolved install root is foreign-owned, world-writable, outside the
# resolved $HOME, or unresolvable. Permits legitimate dotfiles/sync setups
# (Dropbox, chezmoi, GNU stow) where the user owns the resolved target.
#
# Cross-platform: macOS BSD stat takes -f, Linux GNU stat takes -c.
# Numeric uid via id -u (NOT $USER, which is unset under `set -u` and
# lies under sudo). Inside-$HOME check via slash-delimited case match
# (NOT naive prefix, which matches /Users/kb2 against /Users/kb*).
# World-writable via find -perm -o+w (portable across BSD and GNU find).
#
# Non-existent paths: walks up to nearest existing ancestor and validates
# THAT — `mkdir -p` will create the rest beneath an already-safe parent.

# Resolve a path through symlinks, BSD/GNU portable.
# Stdout: resolved absolute path (no trailing slash).
# Returns 0 on success, 1 if path cannot be resolved.
_resolve_path() {
  local path="$1"
  local resolved
  if resolved=$(cd -P "$path" 2>/dev/null && pwd -P); then
    printf '%s' "$resolved"
    return 0
  fi
  return 1
}

# Find the nearest existing ancestor of $1.
# Stdout: nearest existing ancestor path.
_nearest_existing_ancestor() {
  local check="$1"
  while [ ! -e "$check" ] && [ ! -L "$check" ]; do
    local parent
    parent=$(dirname "$check")
    if [ "$parent" = "$check" ]; then
      # Reached root or relative-path floor; bail out.
      printf '%s' "$check"
      return 0
    fi
    check="$parent"
  done
  printf '%s' "$check"
  return 0
}

# Get numeric owner uid, BSD/GNU portable.
# Stdout: numeric uid, or empty on failure.
_path_owner_uid() {
  stat -f '%u' "$1" 2>/dev/null || stat -c '%u' "$1" 2>/dev/null
}

# Check if path is world-writable (mode bit `o+w`).
# Returns 0 if world-writable, 1 if not (or if path doesn't exist).
_is_world_writable() {
  [ -n "$(find "$1" -maxdepth 0 -perm -o+w 2>/dev/null)" ]
}

# is_safe_install_path <path>
#
# Validates that <path> (or its nearest existing ancestor, if <path>
# doesn't exist yet) resolves to a location safe for gstack-extend install.
#
# Safe means: resolved target is owned by the current user (numeric uid
# match), is not world-writable, and is inside the resolved $HOME.
#
# Prints a specific stderr message on failure naming the resolved target
# so users can debug or fix the offending path.
is_safe_install_path() {
  local path="$1"
  if [ -z "$path" ]; then
    echo "Error: is_safe_install_path: empty path argument" >&2
    return 1
  fi

  # If path doesn't exist (and isn't a broken symlink), validate the
  # nearest existing ancestor instead. setup will mkdir -p beneath it.
  local check_path="$path"
  if [ ! -e "$path" ] && [ ! -L "$path" ]; then
    check_path=$(_nearest_existing_ancestor "$path")
  fi

  # Resolve. cd -P fails on broken symlinks and non-directories.
  local resolved
  if ! resolved=$(_resolve_path "$check_path"); then
    echo "Error: cannot resolve $path (broken symlink or non-directory at $check_path)" >&2
    return 1
  fi

  # Numeric uid comparison (do not trust $USER).
  local owner_uid my_uid
  owner_uid=$(_path_owner_uid "$resolved")
  my_uid=$(id -u)
  if [ -z "$owner_uid" ]; then
    echo "Error: $path resolves to $resolved but stat could not read ownership" >&2
    return 1
  fi
  if [ "$owner_uid" != "$my_uid" ]; then
    echo "Error: $path resolves to $resolved (owned by uid $owner_uid, expected $my_uid)" >&2
    return 1
  fi

  # World-writable refusal: an attacker with write access to a 0777 dir
  # could swap the resolved target between check and use.
  if _is_world_writable "$resolved"; then
    echo "Error: $path resolves to $resolved (world-writable; refusing for safety)" >&2
    return 1
  fi

  # Inside-$HOME check via slash-delimited case match. Naive prefix
  # ("$resolved" == "$HOME"*) would match /Users/kb2 against /Users/kb*.
  local resolved_home
  if ! resolved_home=$(_resolve_path "$HOME"); then
    echo "Error: cannot resolve \$HOME ($HOME)" >&2
    return 1
  fi
  case "$resolved/" in
    "$resolved_home"/*)
      ;;
    *)
      echo "Error: $path resolves to $resolved (outside resolved \$HOME $resolved_home)" >&2
      return 1
      ;;
  esac

  return 0
}

# _die_with_line <exit_code>
#
# ERR trap target for `set -euo pipefail` bins. Bash's default behavior on
# `set -e` is to exit silently — `_die_with_line` adds line-number + exit-
# code visibility so a `frobnosticate || true`-missing pipeline reports
# where it died.
#
# Usage in caller:
#   set -euo pipefail
#   . "$SCRIPT_DIR/lib/install-safety.sh"
#   trap '_die_with_line $?' ERR
#
# Prints to stderr; never exits on its own (lets bash's set -e do the
# actual exit so existing exit codes propagate correctly).
#
# Caution: the ERR trap fires on EVERY non-zero return that set -e would
# act on, including controlled returns from a dispatcher's case branches.
# Shield intentional non-zero returns with `cmd_foo "$@" || exit $?` (see
# bin/gstack-extend dispatcher for the pattern).
_die_with_line() {
  local exit_code="${1:-1}"
  echo "Error: ${BASH_SOURCE[1]:-${0##*/}}:${BASH_LINENO[0]:-?} exited with code $exit_code" >&2
  if [ "${#FUNCNAME[@]}" -gt 1 ]; then
    echo "  Stack: ${FUNCNAME[*]:1}" >&2
  fi
}

# is_safe_target_path <path>
#
# Per-skill-target check: refuses if $path is a symlink (any kind) OR
# exists as a non-directory (regular file, FIFO, char device, etc.).
# Used before mkdir -p $target / ln -snf / rm -f / rmdir.
#
# Different from is_safe_install_path: per-target paths are direct
# children of $SKILLS_DIR and should NOT be symlinks even to user-owned
# locations (the install loop creates fresh dirs).
is_safe_target_path() {
  local path="$1"
  if [ -z "$path" ]; then
    echo "Error: is_safe_target_path: empty path argument" >&2
    return 1
  fi
  if [ -L "$path" ]; then
    echo "Error: $path is a symlink — refusing to install over it." >&2
    echo "  Remove or rename it (e.g. mv \"$path\" \"$path.bak\") and rerun." >&2
    return 1
  fi
  if [ -e "$path" ] && [ ! -d "$path" ]; then
    echo "Error: $path exists but is not a directory (regular file, FIFO, etc.)." >&2
    echo "  Remove it (e.g. rm \"$path\") and rerun." >&2
    return 1
  fi
  return 0
}
