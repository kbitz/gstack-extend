# source-tag.sh — canonical source-tag parser and dedup helpers.
#
# Sourced by bin/roadmap-audit. See docs/source-tag-contract.md for the
# grammar and semantics this file implements.
#
# Functions exported:
#   parse_source_tag <string>    -- emits KEY=VALUE lines (source, severity, group, item, files)
#   normalize_title <string>     -- emits the dedup-normalized title to stdout
#   compute_dedup_hash <title>   -- emits the dedup hash (first 12 hex chars of sha1)
#   validate_tag_expression <s>  -- returns 0 if valid, 1 otherwise; emits error reason to stderr
#
# No side effects. Pure string transforms.

# Registered source skills. Anything not on this list will be flagged as
# UNKNOWN_SOURCE_TAG by the validator.
_SOURCE_TAG_REGISTRY="pair-review full-review review-apparatus test-plan investigate ship manual discovered"

# parse_source_tag <raw-string>
#
# Input forms accepted:
#   [pair-review]
#   [pair-review:group=2,item=5]
#   [full-review:critical]
#   [full-review:critical,files=a.ts|b.ts]
#   [manual]
#   [discovered:docs/plan.md]      (special — path as the single value)
#
# Output: KEY=VALUE lines to stdout. Always emits source= line; emits others
# only when present. Returns 0 on success, 1 on malformed input.
#
# Example:
#   $ parse_source_tag '[pair-review:group=2,item=5]'
#   source=pair-review
#   group=2
#   item=5
parse_source_tag() {
  local raw="$1"
  # Strip outer brackets, reject if missing.
  if ! echo "$raw" | grep -qE '^\[[^][]+\]$'; then
    return 1
  fi
  local body
  body=$(echo "$raw" | sed -E 's/^\[//; s/\]$//')

  # Split source from key=value tail on the FIRST colon.
  local source rest
  if echo "$body" | grep -q ':'; then
    source=$(echo "$body" | sed -E 's/:.*//')
    rest=$(echo "$body" | sed -E 's/^[^:]*://')
  else
    source="$body"
    rest=""
  fi

  # Validate source characters.
  if ! echo "$source" | grep -qE '^[a-z-]+$'; then
    return 1
  fi
  echo "source=$source"

  # Special case: discovered:<path> — rest is a single value, not key=value.
  if [ "$source" = "discovered" ] && [ -n "$rest" ]; then
    # Reject injection chars.
    if echo "$rest" | grep -qE '[][;]'; then
      return 1
    fi
    echo "path=$rest"
    return 0
  fi

  # Parse key=value[,key=value]*
  [ -z "$rest" ] && return 0

  # Special short-form for full-review: [full-review:critical] is shorthand
  # for [full-review:severity=critical]. Detect when rest has no '=' before
  # any ',' and is a recognized severity.
  if [ "$source" = "full-review" ] && echo "$rest" | grep -qvE '='; then
    case "$rest" in
      critical|necessary|nice-to-have|edge-case|important|minor)
        echo "severity=$rest"
        return 0
        ;;
    esac
  fi

  # Combined short-form: [full-review:critical,files=...]
  if [ "$source" = "full-review" ]; then
    local first
    first=$(echo "$rest" | cut -d, -f1)
    case "$first" in
      critical|necessary|nice-to-have|edge-case|important|minor)
        if echo "$first" | grep -qvE '='; then
          echo "severity=$first"
          rest=$(echo "$rest" | sed -E 's/^[^,]*,//')
        fi
        ;;
    esac
  fi

  # Parse remaining key=value pairs.
  local pair key value
  local IFS_BAK="$IFS"
  IFS=','
  for pair in $rest; do
    if ! echo "$pair" | grep -qE '^[a-z-]+=[^][,;]+$'; then
      IFS="$IFS_BAK"
      return 1
    fi
    key=$(echo "$pair" | sed -E 's/=.*//')
    value=$(echo "$pair" | sed -E 's/^[^=]*=//')
    echo "$key=$value"
  done
  IFS="$IFS_BAK"
  return 0
}

# normalize_title <string>
#
# Apply the canonical normalization pipeline (see docs/source-tag-contract.md):
#   1. Lowercase
#   2. Strip punctuation except spaces
#   3. Collapse whitespace to a single space
#   4. Trim
#   5. Strip trailing metadata after sentinel phrases
normalize_title() {
  local raw="$1"
  local out="$raw"

  # Strip trailing metadata sentinels BEFORE lowercasing so we can match
  # both variants.
  # Sentinels (case-insensitive): "— Found on branch", " Found on branch",
  # "(20", "(v0.", "(v1.", "(v2.", " Source: ["
  out=$(echo "$out" | sed -E 's/[[:space:]]+—[[:space:]]+[Ff]ound on branch.*$//')
  out=$(echo "$out" | sed -E 's/[[:space:]]+[Ff]ound on branch.*$//')
  out=$(echo "$out" | sed -E 's/[[:space:]]+\(20[0-9][0-9]-.*$//')
  out=$(echo "$out" | sed -E 's/[[:space:]]+\(v[0-9]+\..*$//')
  out=$(echo "$out" | sed -E 's/[[:space:]]+[Ss]ource:[[:space:]]*\[.*$//')

  # Lowercase.
  out=$(echo "$out" | tr '[:upper:]' '[:lower:]')

  # Replace punctuation with space (preserves word boundaries), then collapse.
  out=$(echo "$out" | tr '[:punct:]' ' ' | tr -s '[:space:]')

  # Collapse whitespace and trim.
  out=$(echo "$out" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')

  echo "$out"
}

# compute_dedup_hash <title>
#
# Returns the first 12 hex characters of sha1(normalize_title(title)).
# Short hash is sufficient for a per-repo dedup table (no cross-repo clashes).
compute_dedup_hash() {
  local title="$1"
  local normalized
  normalized=$(normalize_title "$title")
  # Prefer shasum (ships on macOS + Linux). Fall back to sha1sum on Linux-only.
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$normalized" | shasum -a 1 | cut -c1-12
  elif command -v sha1sum >/dev/null 2>&1; then
    printf '%s' "$normalized" | sha1sum | cut -c1-12
  else
    # Dumb fallback: xxd of the first 6 bytes of the title. Not collision
    # resistant but avoids hard-crashing on exotic systems.
    printf '%s' "$normalized" | cut -c1-12 | od -An -tx1 | tr -d ' \n' | cut -c1-12
  fi
}

# validate_tag_expression <raw-string>
#
# Returns 0 if the expression conforms to the source-tag grammar, 1 otherwise.
# Emits a one-word reason to stderr on failure:
#   MALFORMED_TAG     — bracket/grammar violation
#   UNKNOWN_SOURCE    — source is not registered in _SOURCE_TAG_REGISTRY
#   INJECTION_ATTEMPT — value contains dangerous chars
validate_tag_expression() {
  local raw="$1"
  # Injection check (do this first — any bracket/semicolon/newline inside is bad).
  if echo "$raw" | grep -qE '(\[[^]]*\[|;|`|\$\()'; then
    echo "INJECTION_ATTEMPT" >&2
    return 1
  fi

  local parsed
  if ! parsed=$(parse_source_tag "$raw" 2>/dev/null); then
    echo "MALFORMED_TAG" >&2
    return 1
  fi

  local source
  source=$(echo "$parsed" | grep '^source=' | sed -E 's/^source=//')
  if ! echo " $_SOURCE_TAG_REGISTRY " | grep -q " $source "; then
    echo "UNKNOWN_SOURCE" >&2
    return 1
  fi
  return 0
}

# extract_tag_from_heading <heading-line>
#
# Given an H3 heading line like '### [pair-review:group=2] Title', emit the
# tag portion ('[pair-review:group=2]') to stdout. Emits empty string if no
# tag is present.
extract_tag_from_heading() {
  local line="$1"
  echo "$line" | sed -nE 's/^### (\[[^][]+\]).*/\1/p'
}

# extract_title_from_heading <heading-line>
#
# Given an H3 heading line, emit the Title portion (after the tag, trimmed).
extract_title_from_heading() {
  local line="$1"
  # Drop '### ' prefix.
  line=$(echo "$line" | sed -E 's/^### //')
  # If starts with tag, drop the tag.
  if echo "$line" | grep -qE '^\[[^][]+\][[:space:]]+'; then
    line=$(echo "$line" | sed -E 's/^\[[^][]+\][[:space:]]+//')
  fi
  echo "$line"
}
