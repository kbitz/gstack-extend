#!/usr/bin/env bash
# gstack-extend session-paths lib.
# Source this file; do not execute directly.
#
# Provides:
#   session_dir <skill> [<branch>]              : Active session dir for a skill.
#   session_archive_dir <skill> <ts> [<branch>] : Archived-session dir.
#   session_sanitize_branch <branch>            : Filesystem-safe branch slug.
#   _session_resolve_slug                       : Internal slug resolution (mirrors gstack-slug).
#
# Path shape mirrors gstack:
#   Project-scoped: ${GSTACK_STATE_ROOT:-$HOME/.gstack}/projects/<slug>/<skill>
#   Branch-scoped: <slug>/<skill>/branches/<branch>
#   Archived (no branch): <slug>/<skill>-archived-<ts>   [project-sibling, legacy shape]
#   Archived (branch):    <slug>/<skill>/archives/<branch>-<ts>
#
# Branch arg is optional. Skills that support multiple concurrent sessions
# (one per branch) pass it; skills that have a single project-level slot
# (full-review, roadmap-proposals) omit it.
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

# session_sanitize_branch <branch>
# Echoes a filesystem-safe slug for a git branch name. Converts '/' to '--'
# (the common readable convention for branch dirs) and strips any char outside
# [a-zA-Z0-9._-] so we never produce path traversal or shell-unsafe segments.
# Empty input → "unknown-branch" sentinel (never empty path component).
session_sanitize_branch() {
  local branch="$1"
  if [ -z "$branch" ]; then
    printf 'unknown-branch'
    return 0
  fi
  # / -> --, then strip everything not in the safe set.
  local s
  s=$(printf '%s' "$branch" | sed 's|/|--|g' | tr -cd 'a-zA-Z0-9._-')
  printf '%s' "${s:-unknown-branch}"
}

# session_dir <skill> [<branch>]
# Echoes the durable session directory for the given skill. With a branch
# argument, returns the branch-scoped subdir; without, returns the project-
# scoped dir (parent of all branch dirs and archives).
session_dir() {
  local skill="$1" branch="$2"
  if [ -z "$skill" ]; then
    echo "session_dir: skill argument required" >&2
    return 1
  fi
  local root="${GSTACK_STATE_ROOT:-$HOME/.gstack}"
  local slug
  slug=$(_session_resolve_slug)
  if [ -n "$branch" ]; then
    local bslug
    bslug=$(session_sanitize_branch "$branch")
    printf '%s/projects/%s/%s/branches/%s' "$root" "$slug" "$skill" "$bslug"
  else
    printf '%s/projects/%s/%s' "$root" "$slug" "$skill"
  fi
}

# session_archive_dir <skill> <ts> [<branch>]
# Echoes the archived-session directory. With a branch argument, archives go
# under <skill>/archives/<branch>-<ts> (keeps per-branch history grouped).
# Without, returns the legacy project-sibling path <skill>-archived-<ts>.
session_archive_dir() {
  local skill="$1" ts="$2" branch="$3"
  if [ -z "$skill" ] || [ -z "$ts" ]; then
    echo "session_archive_dir: skill and ts arguments required" >&2
    return 1
  fi
  local root="${GSTACK_STATE_ROOT:-$HOME/.gstack}"
  local slug
  slug=$(_session_resolve_slug)
  if [ -n "$branch" ]; then
    local bslug
    bslug=$(session_sanitize_branch "$branch")
    printf '%s/projects/%s/%s/archives/%s-%s' "$root" "$slug" "$skill" "$bslug" "$ts"
  else
    printf '%s/projects/%s/%s-archived-%s' "$root" "$slug" "$skill" "$ts"
  fi
}
