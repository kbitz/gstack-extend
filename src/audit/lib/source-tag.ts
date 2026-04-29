/**
 * source-tag.ts — canonical source-tag parser and dedup helpers.
 *
 * TypeScript port of bin/lib/source-tag.sh. Pure string transforms; no I/O.
 * The bash version stays in place (sourced by bin/roadmap-audit, bin/roadmap-route,
 * skills/roadmap.md) until Track 2A retires it. This module is consumed by
 * tests/source-tag.test.ts and (after Track 2A) by src/audit/cli.ts.
 *
 * Parity contract with bash:
 *   - Behavior matches bash's LC_ALL=C semantics: ASCII-only character classes,
 *     no Unicode-broader matching for [:space:] / [:punct:] / [:upper:].
 *   - Hash input bytes match `printf '%s' "$normalized"` exactly via
 *     Buffer.from(normalized, 'utf8') (no trailing newline; UTF-8 encoding).
 *   - Reason codes (MALFORMED_TAG, UNKNOWN_SOURCE, INJECTION_ATTEMPT) match
 *     the security taxonomy in docs/source-tag-contract.md.
 *
 * Data flow:
 *   raw → parseSourceTag → Parsed | ParseError
 *   raw → routeSourceTag → { action, reason, source, severity? }
 *   raw → validateTagExpression → ok | { reason: ValidateReason }
 *   title → normalizeTitle → string → computeDedupHash → 12 hex chars
 *   "### [tag] Title" → extractTagFromHeading → "[tag]"
 *   "### [tag] Title" → extractTitleFromHeading → "Title"
 */

import { createHash } from 'node:crypto';

// ─── Types ─────────────────────────────────────────────────────────────

export type ParseReason = 'MALFORMED_TAG';
export type ValidateReason = 'MALFORMED_TAG' | 'UNKNOWN_SOURCE' | 'INJECTION_ATTEMPT';

export type Parsed = {
  source: string;
  severity?: string;
  path?: string;
  // Free-form key=value pairs (group, item, files, etc.).
  pairs: Record<string, string>;
};

export type Result<T, E> = { ok: true; value: T } | { ok: false; reason: E };

export type RouteAction = 'KEEP' | 'KILL' | 'PROMPT';

export type RouteOutcome = {
  action: RouteAction;
  reason: string;
  source: string;
  severity?: string;
};

// ─── Constants ────────────────────────────────────────────────────────

// Registered source skills. Anything not on this list will be flagged as
// UNKNOWN_SOURCE by validateTagExpression. Mirrors bash _SOURCE_TAG_REGISTRY.
const SOURCE_TAG_REGISTRY: ReadonlySet<string> = new Set([
  'pair-review',
  'full-review',
  'review',
  'review-apparatus',
  'test-plan',
  'investigate',
  'ship',
  'manual',
  'discovered',
]);

const SHORT_FORM_SEVERITIES: ReadonlySet<string> = new Set([
  'critical',
  'necessary',
  'nice-to-have',
  'edge-case',
  'important',
  'minor',
]);

// ─── Internal helpers (LC_ALL=C ASCII parity) ─────────────────────────

// Lowercase ASCII letters only. Matches `tr '[:upper:]' '[:lower:]'` under
// LC_ALL=C — non-ASCII bytes pass through unchanged.
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) | 0x20));
}

// Replace ASCII punctuation with a single space. POSIX [:punct:] under LC_ALL=C
// is the printable ASCII punctuation set. Unicode punctuation passes through.
const ASCII_PUNCT_RE = /[!-/:-@\[-`{-~]/g;

// Squeeze runs of an identical ASCII whitespace character to a single instance.
// Matches bash `tr -s '[:space:]'` semantics under LC_ALL=C: `aaa` → `a`,
// but `\t \t` stays as `\t \t` (no run of the same char). Critical for byte-
// exact bash parity in compute_dedup_hash — replacing a lone `\t` with space
// would diverge from bash's behavior of preserving isolated control chars.
const ASCII_WS_SQUEEZE_RE = /([\t\n\v\f\r ])\1+/g;

// ─── parseSourceTag ───────────────────────────────────────────────────

/**
 * Parse a bracketed source tag into structured parts.
 *
 * Accepts:
 *   [pair-review]
 *   [pair-review:group=2,item=5]
 *   [full-review:critical]
 *   [full-review:critical,files=a.ts|b.ts]
 *   [discovered:docs/plan.md]      (path as the single value)
 *   [manual]
 *
 * Returns Result<Parsed, ParseReason>.
 */
export function parseSourceTag(raw: string): Result<Parsed, ParseReason> {
  // Strip outer brackets, reject if missing or contains nested brackets.
  // Bash regex: ^\[[^][]+\]$ — nested [ or ] inside the body is rejected.
  if (!/^\[[^\[\]]+\]$/.test(raw)) {
    return { ok: false, reason: 'MALFORMED_TAG' };
  }
  const body = raw.slice(1, -1);

  // Split source from key=value tail on the FIRST colon.
  let source: string;
  let rest: string;
  const colonIdx = body.indexOf(':');
  if (colonIdx >= 0) {
    source = body.slice(0, colonIdx);
    rest = body.slice(colonIdx + 1);
  } else {
    source = body;
    rest = '';
  }

  // Validate source characters: lowercase letters and hyphens only.
  if (!/^[a-z-]+$/.test(source)) {
    return { ok: false, reason: 'MALFORMED_TAG' };
  }

  const pairs: Record<string, string> = {};
  const out: Parsed = { source, pairs };

  // Special case: discovered:<path> — rest is a single value, not key=value.
  if (source === 'discovered' && rest !== '') {
    // Reject injection chars: [, ], ;
    if (/[\[\];]/.test(rest)) {
      return { ok: false, reason: 'MALFORMED_TAG' };
    }
    out.path = rest;
    return { ok: true, value: out };
  }

  if (rest === '') {
    return { ok: true, value: out };
  }

  // Short-form severity for full-review/review: [full-review:critical] is
  // shorthand for [full-review:severity=critical]. Only when rest has no '='.
  if ((source === 'full-review' || source === 'review') && !rest.includes('=')) {
    if (SHORT_FORM_SEVERITIES.has(rest)) {
      out.severity = rest;
      return { ok: true, value: out };
    }
  }

  // Combined short-form: [full-review:critical,files=...] — first segment is
  // a bare severity, the rest is key=value pairs.
  if (source === 'full-review' || source === 'review') {
    const firstComma = rest.indexOf(',');
    const first = firstComma >= 0 ? rest.slice(0, firstComma) : rest;
    if (!first.includes('=') && SHORT_FORM_SEVERITIES.has(first)) {
      out.severity = first;
      rest = firstComma >= 0 ? rest.slice(firstComma + 1) : '';
    }
  }

  if (rest === '') {
    return { ok: true, value: out };
  }

  // Parse remaining key=value[,key=value]*
  // Per-pair regex: ^[a-z-]+=[^][,;]+$ — value cannot contain ], [, comma,
  // or semicolon (catches injection vectors at parse time).
  for (const pair of rest.split(',')) {
    if (!/^[a-z-]+=[^\[\],;]+$/.test(pair)) {
      return { ok: false, reason: 'MALFORMED_TAG' };
    }
    const eq = pair.indexOf('=');
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (key === 'severity') {
      out.severity = value;
    } else {
      pairs[key] = value;
    }
  }

  return { ok: true, value: out };
}

// ─── normalizeTitle ───────────────────────────────────────────────────

/**
 * Apply the canonical normalization pipeline (see docs/source-tag-contract.md):
 *   1. Strip trailing metadata (em-dash 'Found on branch', plain 'Found on
 *      branch', '(20XX-...)', '(vX....)', 'Source: [...]')
 *   2. Lowercase (ASCII-only, matches bash LC_ALL=C tr semantics)
 *   3. Replace ASCII punctuation with space
 *   4. Collapse whitespace
 *   5. Trim
 */
export function normalizeTitle(raw: string): string {
  let out = raw;

  // Strip trailing metadata sentinels BEFORE lowercasing so we can match both
  // case variants ([Ff], [Ss]). Each regex uses the `m` flag so `$` matches
  // end-of-line — bash `sed` is line-based, so the strips fire per line, not
  // across the whole string. The whitespace class excludes \n for the same
  // reason: sentinels must not span line boundaries.
  out = out.replace(/[\t\v\f\r ]+—[\t\v\f\r ]+[Ff]ound on branch.*$/gm, '');
  out = out.replace(/[\t\v\f\r ]+[Ff]ound on branch.*$/gm, '');
  out = out.replace(/[\t\v\f\r ]+\(20[0-9][0-9]-.*$/gm, '');
  out = out.replace(/[\t\v\f\r ]+\(v[0-9]+\..*$/gm, '');
  out = out.replace(/[\t\v\f\r ]+[Ss]ource:[\t\v\f\r ]*\[.*$/gm, '');

  // Lowercase (ASCII-only — matches bash LC_ALL=C `tr '[:upper:]' '[:lower:]'`).
  out = asciiLower(out);

  // Replace ASCII punctuation with space, then squeeze runs of identical
  // whitespace chars (bash `tr '[:punct:]' ' ' | tr -s '[:space:]'` semantics).
  out = out.replace(ASCII_PUNCT_RE, ' ').replace(ASCII_WS_SQUEEZE_RE, '$1');

  // Per-line trim (bash `sed` is line-based — leading/trailing whitespace is
  // stripped from each newline-separated segment independently, not from the
  // string as a whole). The trim class excludes \n so multi-line structure
  // is preserved.
  out = out
    .split('\n')
    .map((line) => line.replace(/^[\t\v\f\r ]+|[\t\v\f\r ]+$/g, ''))
    .join('\n');

  // Strip trailing newlines: bash `$(...)` command-substitution semantics that
  // wraps every step's output. Without this, inputs ending in `\n` would hash
  // differently between bash (which sees N+1 newlines, trims to 0) and TS
  // (which would emit them).
  out = out.replace(/\n+$/, '');

  return out;
}

// ─── computeDedupHash ─────────────────────────────────────────────────

/**
 * Returns 12 hex characters derived from normalizeTitle(title).
 *
 * Bash equivalent (the canonical contract):
 *   printf '%s' "$normalized" | shasum -a 1 | cut -c1-12
 *
 * The bash version has 5 fallback tiers (sha1sum, md5sum, md5, cksum, hex)
 * collapsed to one path here — Node's crypto module is always available.
 * Buffer.from(normalized, 'utf8') matches `printf '%s'` byte-for-byte
 * (UTF-8 encoding, no trailing newline). Validated by
 * tests/fixtures/source-tag-hash-corpus.json.
 */
export function computeDedupHash(title: string): string {
  const normalized = normalizeTitle(title);
  return createHash('sha1')
    .update(Buffer.from(normalized, 'utf8'))
    .digest('hex')
    .slice(0, 12);
}

// ─── routeSourceTag ───────────────────────────────────────────────────

/**
 * Apply the source-default routing matrix from docs/source-tag-contract.md.
 * Single source of truth for KEEP / KILL / PROMPT decisions.
 *
 * Always returns a RouteOutcome (PROMPT is a valid action for unknown or
 * malformed input — never throws on user data).
 */
export function routeSourceTag(raw: string): RouteOutcome {
  if (raw === '' || raw === '[]') {
    return {
      action: 'KEEP',
      reason: 'missing source tag — defaults to manual (user-written)',
      source: 'manual',
    };
  }

  const parsed = parseSourceTag(raw);
  if (!parsed.ok) {
    return {
      action: 'PROMPT',
      reason: 'malformed source tag — surface for explicit user decision',
      source: 'unknown',
    };
  }

  const { source, severity } = parsed.value;

  switch (source) {
    case 'manual':
    case 'ship':
      return { action: 'KEEP', reason: 'user-written deliberate item', source };

    case 'pair-review':
    case 'test-plan':
    case 'investigate':
    case 'review-apparatus':
      return { action: 'KEEP', reason: 'observed bug or real tooling need', source };

    case 'full-review':
    case 'review':
      return routeReviewSeverity(source, severity);

    case 'discovered':
      return {
        action: 'PROMPT',
        reason: 'extracted from a scattered doc — confirm before incorporating',
        source,
      };

    default:
      return {
        action: 'PROMPT',
        reason: `unknown source tag '${source}' — surface for explicit decision`,
        source,
      };
  }
}

function routeReviewSeverity(
  source: 'full-review' | 'review',
  severity: string | undefined,
): RouteOutcome {
  switch (severity) {
    case 'critical':
    case 'necessary':
      return {
        action: 'KEEP',
        reason: `${source} ${severity} — ship-blocker or real defect`,
        source,
        severity,
      };
    case 'important':
      return {
        action: 'KEEP',
        reason: `legacy severity 'important' — treated as 'necessary'`,
        source,
        severity,
      };
    case 'nice-to-have':
    case 'minor':
      return {
        action: 'PROMPT',
        reason: `${source} ${severity} — keep or defer is a judgment call`,
        source,
        severity,
      };
    case 'edge-case':
      return {
        action: 'KILL',
        reason: `${source} edge-case — adversarial-review noise, default to drop`,
        source,
        severity,
      };
    default:
      // No severity — bash distinguishes review (default KEEP) from full-review
      // (default PROMPT) for legacy reasons. Preserve.
      if (source === 'review') {
        return {
          action: 'KEEP',
          reason:
            'review (no severity) — pre-landing adversarial finding, default keep like full-review:necessary',
          source,
        };
      }
      return {
        action: 'PROMPT',
        reason: 'full-review without severity (legacy) — surface for explicit decision',
        source,
      };
  }
}

// ─── validateTagExpression ────────────────────────────────────────────

/**
 * Validate that the expression conforms to the source-tag grammar AND that
 * the source is registered. Returns Result<void, ValidateReason>:
 *   - MALFORMED_TAG: bracket/grammar violation
 *   - UNKNOWN_SOURCE: source not in SOURCE_TAG_REGISTRY
 *   - INJECTION_ATTEMPT: dangerous chars (nested brackets, semicolons,
 *     backticks, command substitution)
 */
export function validateTagExpression(raw: string): Result<void, ValidateReason> {
  // Injection check (do this first — any nested-bracket / semicolon /
  // backtick / $(...) inside is rejected as INJECTION_ATTEMPT, distinct
  // from MALFORMED_TAG so security audits can see the intent).
  if (/\[[^\]]*\[|;|`|\$\(/.test(raw)) {
    return { ok: false, reason: 'INJECTION_ATTEMPT' };
  }

  const parsed = parseSourceTag(raw);
  if (!parsed.ok) {
    return { ok: false, reason: 'MALFORMED_TAG' };
  }

  if (!SOURCE_TAG_REGISTRY.has(parsed.value.source)) {
    return { ok: false, reason: 'UNKNOWN_SOURCE' };
  }

  return { ok: true, value: undefined };
}

// ─── extractTagFromHeading / extractTitleFromHeading ──────────────────

/**
 * Given an H3 heading line like '### [pair-review:group=2] Title', return
 * the tag portion ('[pair-review:group=2]'). Empty string if no tag.
 * H3-only by design (matches bash regex `^### `).
 */
export function extractTagFromHeading(line: string): string {
  const m = /^### (\[[^\[\]]+\]).*/.exec(line);
  return m ? (m[1] ?? '') : '';
}

/**
 * Given an H3 heading line, return the Title portion (after the tag, trimmed).
 * Untagged heading passes through. Non-H3 input has '### ' prefix-strip skipped.
 */
export function extractTitleFromHeading(line: string): string {
  let out = line;
  // Drop '### ' prefix.
  out = out.replace(/^### /, '');
  // If starts with tag, drop the tag and any whitespace after it.
  out = out.replace(/^\[[^\[\]]+\][\t\n\v\f\r ]+/, '');
  return out;
}
