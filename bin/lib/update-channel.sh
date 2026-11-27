#!/usr/bin/env bash
# Private release-channel helpers. Source after semver.sh.

UPDATE_RELEASE_VERSION_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))?$'

update_channel() {
  if [ "$("$1/bin/config" get update_channel 2>/dev/null || true)" = main ]; then
    printf '%s\n' main
  else
    printf '%s\n' stable
  fi
}

_update_remote_tags() (
  # Job control gives Git and its transport helpers their own process group.
  # Cancel and reap the watchdog when Git exits early.
  local repo="$1" git_pid watchdog status=0
  shift
  set -m
  GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=false SSH_ASKPASS=false \
    GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes" \
    git -C "$repo" ls-remote --tags origin "$@" </dev/null &
  git_pid=$!
  (
    sleep 10
    kill -KILL -- "-$git_pid" 2>/dev/null || true
  ) >/dev/null 2>&1 &
  watchdog=$!
  wait "$git_pid" || status=$?
  kill -TERM -- "-$watchdog" 2>/dev/null || true
  wait "$watchdog" 2>/dev/null || true
  return "$status"
)

# Print version, tag and commit. Return 1 for a failed listing or 2 for no
# release tags. For annotated tags the peeled ref takes precedence regardless
# of the order ls-remote emits the two refs.
update_latest_release() {
  local refs sha ref tag version peeled best_version="" best_tag="" best_commit=""
  refs=$(_update_remote_tags "$1" 'refs/tags/v*') || return 1
  while read -r sha ref; do
    tag=${ref#refs/tags/}
    peeled=${tag%'^{}'}
    version=${peeled#v}
    [[ "$version" =~ $UPDATE_RELEASE_VERSION_RE ]] || continue
    if [ -z "$best_version" ] || version_gt "$version" "$best_version"; then
      best_version=$version
      best_tag=$peeled
      best_commit=$sha
    elif [ "$peeled" = "$best_tag" ] && [ "$tag" != "$peeled" ]; then
      best_commit=$sha
    fi
  done <<< "$refs"
  [ -n "$best_tag" ] || return 2
  printf '%s %s %s\n' "$best_version" "$best_tag" "$best_commit"
}

update_remote_tag_commit() {
  local ref="refs/tags/$2" refs sha name direct=""
  refs=$(_update_remote_tags "$1" "$ref" "$ref^{}") || return 1
  while read -r sha name; do
    case "$name" in
      "$ref^{}") printf '%s\n' "$sha"; return 0 ;;
      "$ref") direct=$sha ;;
    esac
  done <<< "$refs"
  [ -n "$direct" ] || return 2
  printf '%s\n' "$direct"
}
