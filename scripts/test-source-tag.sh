#!/usr/bin/env bash
# Unit tests for bin/lib/source-tag.sh — parse_source_tag, normalize_title,
# compute_dedup_hash, validate_tag_expression, extract_tag_from_heading,
# extract_title_from_heading.

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"

# shellcheck source=../bin/lib/source-tag.sh
source "$REPO_ROOT/bin/lib/source-tag.sh"

PASSED=0
FAILED=0
TOTAL=0

pass() { PASSED=$((PASSED + 1)); TOTAL=$((TOTAL + 1)); echo "  ✓ $1"; }
fail() { FAILED=$((FAILED + 1)); TOTAL=$((TOTAL + 1)); echo "  ✗ $1"; [ -n "$2" ] && echo "    got: $2"; }

assert_equal() {
  local got="$1" want="$2" msg="$3"
  if [ "$got" = "$want" ]; then
    pass "$msg"
  else
    fail "$msg" "'$got' != '$want'"
  fi
}

# ─── parse_source_tag ──────────────────────────────────────────

echo "=== parse_source_tag ==="

OUT=$(parse_source_tag '[pair-review]')
if echo "$OUT" | grep -qxF 'source=pair-review'; then
  pass "parse: bare tag"
else
  fail "parse: bare tag" "$OUT"
fi

OUT=$(parse_source_tag '[pair-review:group=2,item=5]')
if echo "$OUT" | grep -qxF 'source=pair-review' && \
   echo "$OUT" | grep -qxF 'group=2' && \
   echo "$OUT" | grep -qxF 'item=5'; then
  pass "parse: multi-key"
else
  fail "parse: multi-key" "$OUT"
fi

OUT=$(parse_source_tag '[full-review:critical]')
if echo "$OUT" | grep -qxF 'source=full-review' && \
   echo "$OUT" | grep -qxF 'severity=critical'; then
  pass "parse: full-review short-form severity"
else
  fail "parse: full-review short-form severity" "$OUT"
fi

OUT=$(parse_source_tag '[full-review:critical,files=a.ts|b.ts]')
if echo "$OUT" | grep -qxF 'severity=critical' && \
   echo "$OUT" | grep -qxF 'files=a.ts|b.ts'; then
  pass "parse: full-review severity + files"
else
  fail "parse: full-review severity + files" "$OUT"
fi

OUT=$(parse_source_tag '[discovered:docs/plan.md]')
if echo "$OUT" | grep -qxF 'source=discovered' && \
   echo "$OUT" | grep -qxF 'path=docs/plan.md'; then
  pass "parse: discovered short-form path"
else
  fail "parse: discovered short-form path" "$OUT"
fi

OUT=$(parse_source_tag '[manual]')
if echo "$OUT" | grep -qxF 'source=manual'; then
  pass "parse: manual"
else
  fail "parse: manual" "$OUT"
fi

OUT=$(parse_source_tag '[pair-review:group=pre-test]')
if echo "$OUT" | grep -qxF 'group=pre-test'; then
  pass "parse: group=pre-test (non-numeric)"
else
  fail "parse: group=pre-test" "$OUT"
fi

# Malformed: no brackets.
if ! parse_source_tag 'pair-review' >/dev/null 2>&1; then
  pass "parse: missing brackets rejected"
else
  fail "parse: missing brackets not rejected"
fi

# Malformed: bad key character.
if ! parse_source_tag '[pair-review:Group=2]' >/dev/null 2>&1; then
  pass "parse: uppercase key rejected"
else
  fail "parse: uppercase key not rejected"
fi

# Malformed: value with semicolon.
if ! parse_source_tag '[pair-review:group=1;x]' >/dev/null 2>&1; then
  pass "parse: semicolon in value rejected"
else
  fail "parse: semicolon in value not rejected"
fi

# Legacy: [full-review:important] — legacy severity, still parsed.
OUT=$(parse_source_tag '[full-review:important]')
if echo "$OUT" | grep -qxF 'severity=important'; then
  pass "parse: legacy severity preserved"
else
  fail "parse: legacy severity" "$OUT"
fi

# ─── normalize_title ───────────────────────────────────────────

echo ""
echo "=== normalize_title ==="

assert_equal "$(normalize_title "Simple title")" "simple title" \
  "normalize: basic lowercase"

assert_equal "$(normalize_title "Title with Punctuation!!!")" "title with punctuation" \
  "normalize: punctuation stripped"

assert_equal "$(normalize_title "Hyphen-separated words")" "hyphen separated words" \
  "normalize: hyphens become spaces"

assert_equal "$(normalize_title "Multiple    spaces   collapse")" "multiple spaces collapse" \
  "normalize: whitespace collapse"

assert_equal "$(normalize_title "  Trimmed  ")" "trimmed" \
  "normalize: trim"

assert_equal "$(normalize_title "Bug X — Found on branch kbitz/foo")" "bug x" \
  "normalize: strip 'Found on branch' trailing metadata"

assert_equal "$(normalize_title "Bug Y (2026-04-23)")" "bug y" \
  "normalize: strip (2026-...) trailing timestamp"

assert_equal "$(normalize_title "Feature Z (v0.9.21)")" "feature z" \
  "normalize: strip (v0.X) trailing version"

# Cross-writer same-bug normalization: identical titles modulo punctuation
# and trailing metadata collapse to the same normalized form.
A=$(normalize_title "NSNull crash in reply composer")
B=$(normalize_title "NSNull! crash in reply-composer.")
C=$(normalize_title "NSNull crash in reply composer — Found on branch kbitz/threading (2026-04-20)")
if [ "$A" = "$B" ] && [ "$A" = "$C" ]; then
  pass "normalize: same bug across writers normalizes identically"
else
  fail "normalize: cross-writer dedup fails" "A='$A' B='$B' C='$C'"
fi

# ─── compute_dedup_hash ────────────────────────────────────────

echo ""
echo "=== compute_dedup_hash ==="

H1=$(compute_dedup_hash "NSNull crash")
H2=$(compute_dedup_hash "NSNull crash — Found on branch kbitz/x (2026-04-20)")
H3=$(compute_dedup_hash "Different bug entirely")

if [ "$H1" = "$H2" ]; then
  pass "hash: same bug different metadata same hash"
else
  fail "hash: same bug different hash" "$H1 != $H2"
fi

if [ "$H1" != "$H3" ]; then
  pass "hash: distinct titles distinct hashes"
else
  fail "hash: distinct titles collided" "$H1 == $H3"
fi

# Hash output is 12 hex chars.
if echo "$H1" | grep -qE '^[0-9a-f]{12}$'; then
  pass "hash: 12 hex chars"
else
  fail "hash: wrong format" "$H1"
fi

# ─── validate_tag_expression ───────────────────────────────────

echo ""
echo "=== validate_tag_expression ==="

if validate_tag_expression '[pair-review:group=2]' 2>/dev/null; then
  pass "validate: valid tag passes"
else
  fail "validate: valid tag rejected"
fi

REASON=$(validate_tag_expression '[pair-review:group=1;rm]' 2>&1 || true)
if [ "$REASON" = "INJECTION_ATTEMPT" ]; then
  pass "validate: semicolon → INJECTION_ATTEMPT"
else
  fail "validate: semicolon reason" "$REASON"
fi

REASON=$(validate_tag_expression '[madeup]' 2>&1 || true)
if [ "$REASON" = "UNKNOWN_SOURCE" ]; then
  pass "validate: unknown source → UNKNOWN_SOURCE"
else
  fail "validate: unknown source reason" "$REASON"
fi

REASON=$(validate_tag_expression '[PAIR-REVIEW]' 2>&1 || true)
if [ "$REASON" = "MALFORMED_TAG" ]; then
  pass "validate: uppercase source → MALFORMED_TAG"
else
  fail "validate: uppercase reason" "$REASON"
fi

REASON=$(validate_tag_expression 'not-a-tag' 2>&1 || true)
if [ "$REASON" = "MALFORMED_TAG" ]; then
  pass "validate: missing brackets → MALFORMED_TAG"
else
  fail "validate: missing brackets reason" "$REASON"
fi

# Backtick injection.
REASON=$(validate_tag_expression '[pair-review:`x`]' 2>&1 || true)
if [ "$REASON" = "INJECTION_ATTEMPT" ] || [ "$REASON" = "MALFORMED_TAG" ]; then
  pass "validate: backtick injection rejected"
else
  fail "validate: backtick not rejected" "$REASON"
fi

# ─── extract_tag_from_heading / extract_title_from_heading ─────

echo ""
echo "=== heading extractors ==="

assert_equal "$(extract_tag_from_heading '### [pair-review:group=2] My title')" "[pair-review:group=2]" \
  "extract_tag: with tag"

assert_equal "$(extract_tag_from_heading '### No tag here')" "" \
  "extract_tag: no tag returns empty"

assert_equal "$(extract_title_from_heading '### [pair-review] Bug X')" "Bug X" \
  "extract_title: strips tag"

assert_equal "$(extract_title_from_heading '### Untagged title')" "Untagged title" \
  "extract_title: untagged passthrough"

# ─── Summary ───────────────────────────────────────────────────

echo ""
echo "────────────────────────────"
echo "Results: $PASSED passed, $FAILED failed (of $TOTAL)"
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
