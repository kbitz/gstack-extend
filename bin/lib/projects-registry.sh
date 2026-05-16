#!/usr/bin/env bash
# gstack-extend projects registry — v1 JSON schema.
# Source this file; do not execute directly.
#
# File: ~/.gstack-extend/projects.json (override via GSTACK_EXTEND_STATE_DIR).
#
# v1 schema:
#   {
#     "projects": [
#       { "slug": "...", "name": "...", "path": "...", "remote_url": "..."|null,
#         "base_branch": "...", "version_scheme": "4-digit", "created_at": "..." }
#     ]
#   }
#
# Write strategy: read → jq transform → temp file in same dir → atomic mv.
# Concurrency: no file lock. Sibling Conductor workspaces racing on init =
# last-write-wins. Documented limitation; revisit when registry has 10+
# projects or a race is observed.
#
# All functions print errors to stderr and return non-zero on failure.

# registry_path
# Echoes the absolute path to projects.json.
registry_path() {
  local state_dir="${GSTACK_EXTEND_STATE_DIR:-$HOME/.gstack-extend}"
  printf '%s/projects.json' "$state_dir"
}

# registry_init
# Creates an empty {"projects": []} registry if the file doesn't exist.
# No-op if it already exists (does NOT validate existing content — see
# registry_validate). Returns 0 on success; non-zero if mkdir/write fails.
registry_init() {
  local path
  path=$(registry_path)
  local dir
  dir=$(dirname "$path")
  if ! mkdir -p "$dir" 2>/dev/null; then
    echo "registry_init: cannot create $dir" >&2
    return 1
  fi
  if [ ! -f "$path" ]; then
    printf '{"projects":[]}\n' > "$path"
  fi
}

# registry_validate
# Verifies the registry parses as JSON with the expected top-level shape.
# Returns 0 if valid; 1 + stderr message if missing or corrupt.
registry_validate() {
  local path
  path=$(registry_path)
  if [ ! -f "$path" ]; then
    echo "registry_validate: $path does not exist (run registry_init first)" >&2
    return 1
  fi
  if ! jq -e '.projects | type == "array"' "$path" >/dev/null 2>&1; then
    echo "registry_validate: $path is not valid JSON or missing .projects array" >&2
    echo "  Inspect manually: cat \"$path\"" >&2
    return 1
  fi
  return 0
}

# registry_has_slug <slug>
# Exit 0 if an entry with that slug exists, 1 otherwise.
# Refuses to operate on corrupt registry (returns 2).
registry_has_slug() {
  local slug="$1"
  if [ -z "$slug" ]; then
    echo "registry_has_slug: slug argument required" >&2
    return 2
  fi
  local path
  path=$(registry_path)
  if [ ! -f "$path" ]; then
    return 1
  fi
  if ! registry_validate; then
    return 2
  fi
  jq -e --arg s "$slug" '.projects | map(.slug) | index($s) != null' "$path" >/dev/null 2>&1
}

# registry_upsert <slug> <name> <path> <remote_url> <base_branch> <version_scheme> <created_at>
# Atomic upsert: removes any existing entry for <slug>, appends the new one.
# Idempotent: re-running with the same slug refreshes the entry.
# All seven args required; pass empty string for remote_url if none.
#
# Atomic write: jq emits to a sibling temp file (same dir = same filesystem
# = atomic mv); rename moves it into place.
registry_upsert() {
  local slug="$1" name="$2" proj_path="$3" remote_url="$4"
  local base_branch="$5" version_scheme="$6" created_at="$7"

  if [ -z "$slug" ] || [ -z "$name" ] || [ -z "$proj_path" ] \
       || [ -z "$base_branch" ] || [ -z "$version_scheme" ] || [ -z "$created_at" ]; then
    echo "registry_upsert: missing required argument (slug/name/path/base_branch/version_scheme/created_at)" >&2
    return 1
  fi

  registry_init || return 1
  registry_validate || return 1

  local path
  path=$(registry_path)
  # mktemp gives an unpredictable suffix + 0600 mode (vs ${path}.tmp.$$
  # which is guessable and inherits the user umask). Templating in the
  # final dir keeps mv atomic (same filesystem requirement).
  local tmp
  if ! tmp=$(mktemp "${path}.tmp.XXXXXX"); then
    echo "registry_upsert: mktemp failed in $(dirname "$path")" >&2
    return 1
  fi
  # Defense against SIGKILL/power loss between jq write and mv: trap-clean
  # the tmp file on any function exit. The successful mv path leaves nothing
  # to clean (file was moved); failure paths get swept.
  # shellcheck disable=SC2064
  trap "rm -f '$tmp' 2>/dev/null || true" RETURN

  # remote_url is a string OR null in the JSON. Translate empty string → null.
  local remote_arg=()
  if [ -z "$remote_url" ]; then
    remote_arg+=(--argjson remote 'null')
  else
    remote_arg+=(--arg remote "$remote_url")
  fi

  if ! jq \
    --arg slug "$slug" \
    --arg name "$name" \
    --arg ppath "$proj_path" \
    "${remote_arg[@]}" \
    --arg branch "$base_branch" \
    --arg scheme "$version_scheme" \
    --arg created "$created_at" \
    '.projects |= map(select(.slug != $slug)) + [{
       slug: $slug,
       name: $name,
       path: $ppath,
       remote_url: $remote,
       base_branch: $branch,
       version_scheme: $scheme,
       created_at: $created
     }]' \
    "$path" > "$tmp" 2>/dev/null; then
    echo "registry_upsert: jq transform failed for $path" >&2
    return 1
  fi

  if ! mv "$tmp" "$path"; then
    echo "registry_upsert: atomic mv failed ($tmp → $path)" >&2
    return 1
  fi
  # File mode: mktemp gave 0600; tighten only if user umask was unusually
  # permissive. Registry contains no secrets, so 0644 is acceptable here.
  chmod 0644 "$path" 2>/dev/null || true
  return 0
}

# registry_get <slug>
# Print the entry as a JSON object to stdout. Exit 1 if not found.
registry_get() {
  local slug="$1"
  if [ -z "$slug" ]; then
    echo "registry_get: slug argument required" >&2
    return 1
  fi
  registry_validate || return 1
  local path
  path=$(registry_path)
  local result
  result=$(jq -c --arg s "$slug" '.projects[] | select(.slug == $s)' "$path" 2>/dev/null)
  if [ -z "$result" ]; then
    return 1
  fi
  printf '%s\n' "$result"
}

# registry_list
# Print each project slug on its own line, sorted. Empty registry → no output.
registry_list() {
  registry_validate || return 1
  local path
  path=$(registry_path)
  jq -r '.projects[].slug' "$path" 2>/dev/null | sort
}
