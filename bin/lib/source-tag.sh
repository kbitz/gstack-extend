# source-tag.sh — canonical source-tag parser and dedup helpers.
#
# Sourced by bin/roadmap-audit. See docs/source-tag-contract.md for the
# grammar and semantics this file implements.
#
# Functions exported:
#   parse_source_tag <string>    -- emits KEY=VALUE lines (source, severity, group, item, files)
#   normalize_title <string>     -- emits the dedup-normalized title to stdout
#   compute_dedup_hash <title>   -- emits the dedup hash (first 12 hex chars of sha1)
#   route_source_tag <string>    -- emits action/reason/source/severity per the source-default matrix
#   validate_tag_expression <s>  -- returns 0 if valid, 1 otherwise; emits error reason to stderr
#
# No side effects. Pure string transforms.

# Registered source skills. Anything not on this list will be flagged as
# UNKNOWN_SOURCE_TAG by the validator.
_SOURCE_TAG_REGISTRY="pair-review full-review review review-apparatus test-plan investigate ship manual discovered plan-ceo-review plan-eng-review"

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

  # Special short-form for full-review/review: [full-review:critical] is
  # shorthand for [full-review:severity=critical]. Same shorthand applies to
  # [review:critical]. Detect when rest has no '=' before any ',' and is a
  # recognized severity.
  if { [ "$source" = "full-review" ] || [ "$source" = "review" ]; } && echo "$rest" | grep -qvE '='; then
    case "$rest" in
      critical|necessary|nice-to-have|edge-case|important|minor)
        echo "severity=$rest"
        return 0
        ;;
    esac
  fi

  # Combined short-form: [full-review:critical,files=...] or [review:critical,...]
  if [ "$source" = "full-review" ] || [ "$source" = "review" ]; then
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
# Returns 12 hex characters derived from normalize_title(title).
# Short hash is sufficient for a per-repo dedup table (no cross-repo clashes).
# Falls back through sha1 → md5 → cksum → padded-hex. All tiers produce
# exactly 12 hex chars, so downstream dedup logic never sees variable-length
# keys. Fallbacks emit a "WARN: dedup-fallback" line to stderr so the user
# can detect degraded collision resistance.
compute_dedup_hash() {
  local title="$1"
  local normalized
  normalized=$(normalize_title "$title")

  # Tier 1: shasum (ships on macOS + Linux via Perl).
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$normalized" | shasum -a 1 | cut -c1-12
    return
  fi
  # Tier 2: sha1sum (Linux coreutils).
  if command -v sha1sum >/dev/null 2>&1; then
    printf '%s' "$normalized" | sha1sum | cut -c1-12
    return
  fi
  # Tier 3: md5 / md5sum.
  if command -v md5sum >/dev/null 2>&1; then
    echo "WARN: compute_dedup_hash falling back to md5sum" >&2
    printf '%s' "$normalized" | md5sum | cut -c1-12
    return
  fi
  if command -v md5 >/dev/null 2>&1; then
    echo "WARN: compute_dedup_hash falling back to md5" >&2
    printf '%s' "$normalized" | md5 | cut -c1-12
    return
  fi
  # Tier 4: cksum (POSIX, ubiquitous). Produces a decimal CRC + size; zero-pad
  # to ensure 12 chars. Much weaker than sha1 but deterministic.
  if command -v cksum >/dev/null 2>&1; then
    echo "WARN: compute_dedup_hash falling back to cksum (reduced collision resistance)" >&2
    local cksum_out
    cksum_out=$(printf '%s' "$normalized" | cksum | awk '{printf "%010d%s", $1, $2}')
    printf '%s' "$cksum_out" | cut -c1-12
    return
  fi
  # Tier 5: last-resort hex-of-normalized-bytes, zero-padded to 12 chars.
  # Collides on long shared prefixes but ALWAYS produces 12 hex chars.
  echo "WARN: compute_dedup_hash falling back to hex-of-title (NOT collision-resistant)" >&2
  local hex
  hex=$(printf '%s' "${normalized}000000000000" | od -An -tx1 | tr -d ' \n')
  printf '%s' "$hex" | cut -c1-12
}

# route_source_tag <raw-tag>
#
# Apply the source-default routing matrix from docs/source-tag-contract.md.
# Single source of truth for KEEP / KILL / PROMPT decisions — bin/roadmap-route
# is a thin CLI wrapper around this function.
#
# Output (KEY=VALUE on stdout):
#   action=KEEP|KILL|PROMPT
#   reason=<one-line rationale>
#   source=<parsed source>
#   severity=<severity if present>
#
# Returns 0 always (PROMPT is a valid action for unknown/malformed input).
route_source_tag() {
  local raw="$1"
  if [ -z "$raw" ] || [ "$raw" = "[]" ]; then
    echo "action=KEEP"
    echo "reason=missing source tag — defaults to manual (user-written)"
    echo "source=manual"
    return 0
  fi

  local parsed
  if ! parsed=$(parse_source_tag "$raw" 2>/dev/null); then
    echo "action=PROMPT"
    echo "reason=malformed source tag — surface for explicit user decision"
    echo "source=unknown"
    return 0
  fi

  local source severity
  source=$(echo "$parsed" | grep -E '^source=' | head -1 | cut -d= -f2)
  severity=$(echo "$parsed" | grep -E '^severity=' | head -1 | cut -d= -f2 || true)

  case "$source" in
    manual|ship)
      echo "action=KEEP"
      echo "reason=user-written deliberate item"
      echo "source=$source"
      ;;
    pair-review|test-plan|investigate|review-apparatus)
      echo "action=KEEP"
      echo "reason=observed bug or real tooling need"
      echo "source=$source"
      ;;
    full-review|review)
      case "$severity" in
        critical|necessary)
          echo "action=KEEP"
          echo "reason=$source $severity — ship-blocker or real defect"
          ;;
        important)
          echo "action=KEEP"
          echo "reason=legacy severity 'important' — treated as 'necessary'"
          ;;
        nice-to-have|minor)
          echo "action=PROMPT"
          echo "reason=$source $severity — keep or defer is a judgment call"
          ;;
        edge-case)
          echo "action=KILL"
          echo "reason=$source edge-case — adversarial-review noise, default to drop"
          ;;
        *)
          if [ "$source" = "review" ]; then
            echo "action=KEEP"
            echo "reason=review (no severity) — pre-landing adversarial finding, default keep like full-review:necessary"
          else
            echo "action=PROMPT"
            echo "reason=full-review without severity (legacy) — surface for explicit decision"
          fi
          ;;
      esac
      echo "source=$source"
      [ -n "$severity" ] && echo "severity=$severity"
      ;;
    discovered)
      echo "action=PROMPT"
      echo "reason=extracted from a scattered doc — confirm before incorporating"
      echo "source=$source"
      ;;
    plan-ceo-review|plan-eng-review)
      # `defer=true` → KEEP (in-scope work cut by the review; /roadmap
      # regen places it). Without it → PROMPT (review surfaced out-of-scope
      # work; ask user).
      if echo "$parsed" | grep -qE '^defer=true$'; then
        echo "action=KEEP"
        echo "reason=$source — work cut from Track during plan review; /roadmap regen will place"
      else
        echo "action=PROMPT"
        echo "reason=$source — review-surfaced finding without defer=true flag; surface for explicit decision"
      fi
      echo "source=$source"
      ;;
    *)
      echo "action=PROMPT"
      echo "reason=unknown source tag '$source' — surface for explicit decision"
      echo "source=$source"
      ;;
  esac
  return 0
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
