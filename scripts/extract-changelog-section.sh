#!/usr/bin/env bash
#
# extract-changelog-section.sh — print the CHANGELOG.md section for a version.
#
# Used by the backfill (scripts/backfill-releases.sh) and the auto-release CI
# workflow (.github/workflows/auto-tag.yml) so both share one source of truth
# for "given this version, what are the release notes?"
#
# Matching:
#   1. Exact: ## [X.Y.Z.W] - YYYY-MM-DD
#   2. Trim trailing .0: 0.18.4.0 falls back to 0.18.4 (CHANGELOG entries
#      predate the 4-digit format for some versions; tags are always 4-digit
#      via the auto-tag workflow's regex).
#
# Usage:
#   ./scripts/extract-changelog-section.sh <version>
#   ./scripts/extract-changelog-section.sh 0.18.12.1
#
# Exits 0 with the section body on stdout.
# Exits 1 if the version is not found in CHANGELOG.md.
# The body excludes the heading line itself and any trailing blank lines.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <version>" >&2
  exit 2
fi

VERSION="$1"
ROOT="$(git rev-parse --show-toplevel)"
CHANGELOG="$ROOT/CHANGELOG.md"

if [ ! -f "$CHANGELOG" ]; then
  echo "CHANGELOG.md not found at $CHANGELOG" >&2
  exit 2
fi

extract() {
  local v="$1"
  awk -v v="$v" '
    BEGIN { in_section = 0; matched = 0 }
    /^## \[/ {
      if (in_section) { exit }
      if ($0 ~ "^## \\[" v "\\]") {
        in_section = 1
        matched = 1
        next
      }
    }
    in_section { print }
    END { exit matched ? 0 : 1 }
  ' "$CHANGELOG"
}

if extract "$VERSION"; then
  exit 0
fi

# Fallback: trim a trailing .0 (e.g. 0.18.5.0 → 0.18.5)
TRIMMED="${VERSION%.0}"
if [ "$TRIMMED" != "$VERSION" ]; then
  if extract "$TRIMMED"; then
    exit 0
  fi
fi

echo "No CHANGELOG section found for version $VERSION" >&2
exit 1
