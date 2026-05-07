#!/usr/bin/env bash
# gstack-extend session-paths lib.
# Source this file; do not execute directly.
#
# Provides:
#   session_dir <skill>               : Active session dir for a skill.
#   session_archive_dir <skill> <ts>  : Archived-session sibling dir.
#   _session_resolve_slug             : Internal slug resolution (mirrors gstack-slug).
#
# Path shape mirrors gstack: ${GSTACK_STATE_ROOT:-$HOME/.gstack}/projects/<slug>/<skill>.
# Archived sessions are siblings: <slug>/<skill>-archived-<ts>.
#
# Slug resolution order: gstack-slug binary > basename "$PWD" sanitized.
# Never errors — outside a git repo, slug becomes the cwd basename, matching
# how gstack's own /context-save behaves.

# _session_resolve_slug
# Echoes a non-empty slug. Mirrors ~/.claude/skills/gstack/bin/gstack-slug
# fallback semantics so cross-skill paths agree on the same project name.
_session_resolve_slug() {
  local slug=""
  if [ -x "$HOME/.claude/skills/gstack/bin/gstack-slug" ]; then
    # gstack-slug prints "SLUG=...\nBRANCH=..." — eval into a subshell so we
    # don't leak BRANCH into the caller's environment.
    slug=$(eval "$("$HOME/.claude/skills/gstack/bin/gstack-slug" 2>/dev/null)" 2>/dev/null && printf '%s' "${SLUG:-}")
  fi
  if [ -z "$slug" ]; then
    slug=$(basename "$PWD" | tr -cd 'a-zA-Z0-9._-')
  fi
  # Final guard: if PWD basename was entirely sanitized away (unlikely but
  # possible with exotic dir names), fall back to a sentinel rather than
  # returning empty (which would yield ~/.gstack/projects//pair-review).
  printf '%s' "${slug:-unknown-project}"
}

# session_dir <skill>
# Echoes the durable session directory for the given skill.
session_dir() {
  local skill="$1"
  if [ -z "$skill" ]; then
    echo "session_dir: skill argument required" >&2
    return 1
  fi
  local root="${GSTACK_STATE_ROOT:-$HOME/.gstack}"
  local slug
  slug=$(_session_resolve_slug)
  printf '%s/projects/%s/%s' "$root" "$slug" "$skill"
}

# session_archive_dir <skill> <ts>
# Echoes the archived-session sibling directory for the given skill at <ts>.
session_archive_dir() {
  local skill="$1" ts="$2"
  if [ -z "$skill" ] || [ -z "$ts" ]; then
    echo "session_archive_dir: skill and ts arguments required" >&2
    return 1
  fi
  local root="${GSTACK_STATE_ROOT:-$HOME/.gstack}"
  local slug
  slug=$(_session_resolve_slug)
  printf '%s/projects/%s/%s-archived-%s' "$root" "$slug" "$skill" "$ts"
}
