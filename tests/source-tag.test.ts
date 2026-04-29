/**
 * tests/source-tag.test.ts — bun:test exercising src/audit/lib/source-tag.ts.
 *
 * Companion to scripts/test-source-tag.sh (which tests bin/lib/source-tag.sh).
 * Both must stay green; both run under /ship until Track 2A retires bash.
 *
 * Critical assertions:
 *   - Byte-exact dedup-hash parity vs bash on the curated corpus
 *     (tests/fixtures/source-tag-hash-corpus.json). Any divergence here
 *     silently breaks the dedup table at the Track 2A boundary.
 *   - Table-driven routing matrix covering all 24 (source, severity) tuples
 *     from docs/source-tag-contract.md.
 *   - Tight INJECTION_ATTEMPT vs MALFORMED_TAG classification for security
 *     taxonomy preservation.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSourceTag,
  normalizeTitle,
  computeDedupHash,
  routeSourceTag,
  validateTagExpression,
  extractTagFromHeading,
  extractTitleFromHeading,
} from '../src/audit/lib/source-tag.ts';

// ─── parseSourceTag ───────────────────────────────────────────────────

describe('parseSourceTag', () => {
  test('bare tag', () => {
    const r = parseSourceTag('[pair-review]');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.source).toBe('pair-review');
  });

  test('multi-key', () => {
    const r = parseSourceTag('[pair-review:group=2,item=5]');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.source).toBe('pair-review');
      expect(r.value.pairs.group).toBe('2');
      expect(r.value.pairs.item).toBe('5');
    }
  });

  test('full-review short-form severity (critical)', () => {
    const r = parseSourceTag('[full-review:critical]');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.source).toBe('full-review');
      expect(r.value.severity).toBe('critical');
    }
  });

  test('full-review severity + files (combined short-form)', () => {
    const r = parseSourceTag('[full-review:critical,files=a.ts|b.ts]');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.severity).toBe('critical');
      expect(r.value.pairs.files).toBe('a.ts|b.ts');
    }
  });

  test('discovered:path short-form', () => {
    const r = parseSourceTag('[discovered:docs/plan.md]');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.source).toBe('discovered');
      expect(r.value.path).toBe('docs/plan.md');
    }
  });

  test('manual', () => {
    const r = parseSourceTag('[manual]');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.source).toBe('manual');
  });

  test('group=pre-test (non-numeric value)', () => {
    const r = parseSourceTag('[pair-review:group=pre-test]');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pairs.group).toBe('pre-test');
  });

  test('missing brackets rejected', () => {
    const r = parseSourceTag('pair-review');
    expect(r.ok).toBe(false);
  });

  test('uppercase key rejected', () => {
    const r = parseSourceTag('[pair-review:Group=2]');
    expect(r.ok).toBe(false);
  });

  test('semicolon in value rejected', () => {
    const r = parseSourceTag('[pair-review:group=1;x]');
    expect(r.ok).toBe(false);
  });

  test('legacy severity preserved', () => {
    const r = parseSourceTag('[full-review:important]');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.severity).toBe('important');
  });

  // ─── New tests added per /plan-eng-review D3A + D3B ─────────────────

  test.each([
    'critical',
    'necessary',
    'nice-to-have',
    'edge-case',
    'important',
    'minor',
  ])('full-review short-form: %s', (sev) => {
    const r = parseSourceTag(`[full-review:${sev}]`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.severity).toBe(sev);
  });

  test.each([
    'critical',
    'necessary',
    'nice-to-have',
    'edge-case',
    'important',
    'minor',
  ])('review short-form: %s', (sev) => {
    const r = parseSourceTag(`[review:${sev}]`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.severity).toBe(sev);
  });

  test('combined short-form review:nice-to-have,files=...', () => {
    const r = parseSourceTag('[review:nice-to-have,files=src/foo.ts]');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.severity).toBe('nice-to-have');
      expect(r.value.pairs.files).toBe('src/foo.ts');
    }
  });

  test('nested brackets [a[b] rejected at parse', () => {
    // Bash regex `^\[[^][]+\]$` rejects nested brackets. Parse-level catch.
    const r = parseSourceTag('[a[b]');
    expect(r.ok).toBe(false);
  });

  // Note: backticks and $(...) are NOT rejected at the parse layer — the
  // bash regex `[^][,;]+` only excludes ], [, comma, semicolon. Injection
  // detection happens in validateTagExpression. See those tests below.
});

// ─── normalizeTitle ───────────────────────────────────────────────────

describe('normalizeTitle', () => {
  test('basic lowercase', () => {
    expect(normalizeTitle('Simple title')).toBe('simple title');
  });

  test('punctuation stripped', () => {
    expect(normalizeTitle('Title with Punctuation!!!')).toBe('title with punctuation');
  });

  test('hyphens become spaces', () => {
    expect(normalizeTitle('Hyphen-separated words')).toBe('hyphen separated words');
  });

  test('whitespace collapse', () => {
    expect(normalizeTitle('Multiple    spaces   collapse')).toBe('multiple spaces collapse');
  });

  test('trim', () => {
    expect(normalizeTitle('  Trimmed  ')).toBe('trimmed');
  });

  test("strip '— Found on branch' trailing", () => {
    expect(normalizeTitle('Bug X — Found on branch kbitz/foo')).toBe('bug x');
  });

  test('strip (20XX-...) trailing timestamp', () => {
    expect(normalizeTitle('Bug Y (2026-04-23)')).toBe('bug y');
  });

  test('strip (vX.X) trailing version', () => {
    expect(normalizeTitle('Feature Z (v0.9.21)')).toBe('feature z');
  });

  test('cross-writer dedup parity (3 variants normalize identically)', () => {
    const a = normalizeTitle('NSNull crash in reply composer');
    const b = normalizeTitle('NSNull! crash in reply-composer.');
    const c = normalizeTitle(
      'NSNull crash in reply composer — Found on branch kbitz/threading (2026-04-20)',
    );
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  // ─── New tests added per /plan-eng-review D2A ───────────────────────

  test("strip 'Source: [...]' trailing", () => {
    expect(normalizeTitle('Crash bug Source: [pair-review:group=2]')).toBe('crash bug');
  });

  test("strip plain 'Found on branch' (no em-dash)", () => {
    expect(normalizeTitle('Bug X Found on branch kbitz/foo')).toBe('bug x');
  });

  test('empty input → empty output', () => {
    expect(normalizeTitle('')).toBe('');
  });

  test('Unicode em-dash in title body passes through (LC_ALL=C parity)', () => {
    // Em-dash is not ASCII punct under LC_ALL=C, so it does NOT get replaced
    // with space. It stays in the normalized output.
    expect(normalizeTitle('Title—with—em—dashes')).toBe('title—with—em—dashes');
  });

  test('non-Latin scripts pass through (no Unicode lowercasing)', () => {
    // Bash LC_ALL=C tr [:upper:] [:lower:] does NOT lowercase Cyrillic. TS
    // asciiLower() matches.
    expect(normalizeTitle('Ошибка в парсере')).toBe('Ошибка в парсере');
  });
});

// ─── computeDedupHash ─────────────────────────────────────────────────

describe('computeDedupHash', () => {
  test('same bug different metadata → same hash', () => {
    const h1 = computeDedupHash('NSNull crash');
    const h2 = computeDedupHash('NSNull crash — Found on branch kbitz/x (2026-04-20)');
    expect(h1).toBe(h2);
  });

  test('distinct titles → distinct hashes', () => {
    expect(computeDedupHash('NSNull crash')).not.toBe(computeDedupHash('Different bug entirely'));
  });

  test('returns 12 hex chars', () => {
    expect(computeDedupHash('anything')).toMatch(/^[0-9a-f]{12}$/);
  });

  test('empty title → 12 hex chars', () => {
    expect(computeDedupHash('')).toMatch(/^[0-9a-f]{12}$/);
  });

  test('single-char title → 12 hex chars', () => {
    expect(computeDedupHash('a')).toMatch(/^[0-9a-f]{12}$/);
  });

  // ─── REGRESSION-CRITICAL: byte-exact bash parity (D2A + D-OV1 + D-OV2) ──

  describe('bash parity corpus', () => {
    type CorpusEntry = { input: string; expected_hash: string };
    type Corpus = { fixtures: CorpusEntry[] };
    const corpusPath = join(import.meta.dir, 'fixtures', 'source-tag-hash-corpus.json');
    const corpus: Corpus = JSON.parse(readFileSync(corpusPath, 'utf8'));

    test.each(corpus.fixtures)(
      'matches bash hash for: $input',
      ({ input, expected_hash }) => {
        expect(computeDedupHash(input)).toBe(expected_hash);
      },
    );
  });
});

// ─── routeSourceTag — table-driven (D3A) ──────────────────────────────

describe('routeSourceTag (full source/severity matrix)', () => {
  type Row = {
    raw: string;
    expectedAction: 'KEEP' | 'KILL' | 'PROMPT';
    expectedSource: string;
    expectedReasonContains: string;
    expectedSeverity?: string;
  };

  const rows: Row[] = [
    // KEEP: user-written deliberate items
    { raw: '[manual]', expectedAction: 'KEEP', expectedSource: 'manual', expectedReasonContains: 'user-written' },
    { raw: '[ship]', expectedAction: 'KEEP', expectedSource: 'ship', expectedReasonContains: 'user-written' },

    // KEEP: observed bug or real tooling need
    { raw: '[pair-review]', expectedAction: 'KEEP', expectedSource: 'pair-review', expectedReasonContains: 'observed bug' },
    { raw: '[pair-review:group=2,item=5]', expectedAction: 'KEEP', expectedSource: 'pair-review', expectedReasonContains: 'observed bug' },
    { raw: '[test-plan]', expectedAction: 'KEEP', expectedSource: 'test-plan', expectedReasonContains: 'observed bug' },
    { raw: '[investigate]', expectedAction: 'KEEP', expectedSource: 'investigate', expectedReasonContains: 'observed bug' },
    { raw: '[review-apparatus]', expectedAction: 'KEEP', expectedSource: 'review-apparatus', expectedReasonContains: 'observed bug' },

    // full-review × all severities
    { raw: '[full-review:critical]', expectedAction: 'KEEP', expectedSource: 'full-review', expectedSeverity: 'critical', expectedReasonContains: 'ship-blocker' },
    { raw: '[full-review:necessary]', expectedAction: 'KEEP', expectedSource: 'full-review', expectedSeverity: 'necessary', expectedReasonContains: 'ship-blocker' },
    { raw: '[full-review:important]', expectedAction: 'KEEP', expectedSource: 'full-review', expectedSeverity: 'important', expectedReasonContains: "legacy severity 'important'" },
    { raw: '[full-review:nice-to-have]', expectedAction: 'PROMPT', expectedSource: 'full-review', expectedSeverity: 'nice-to-have', expectedReasonContains: 'judgment call' },
    { raw: '[full-review:minor]', expectedAction: 'PROMPT', expectedSource: 'full-review', expectedSeverity: 'minor', expectedReasonContains: 'judgment call' },
    { raw: '[full-review:edge-case]', expectedAction: 'KILL', expectedSource: 'full-review', expectedSeverity: 'edge-case', expectedReasonContains: 'adversarial-review noise' },
    { raw: '[full-review]', expectedAction: 'PROMPT', expectedSource: 'full-review', expectedReasonContains: 'full-review without severity (legacy)' },

    // review × all severities (note: review with no severity → KEEP, distinct from full-review)
    { raw: '[review:critical]', expectedAction: 'KEEP', expectedSource: 'review', expectedSeverity: 'critical', expectedReasonContains: 'ship-blocker' },
    { raw: '[review:necessary]', expectedAction: 'KEEP', expectedSource: 'review', expectedSeverity: 'necessary', expectedReasonContains: 'ship-blocker' },
    { raw: '[review:important]', expectedAction: 'KEEP', expectedSource: 'review', expectedSeverity: 'important', expectedReasonContains: "legacy severity 'important'" },
    { raw: '[review:nice-to-have]', expectedAction: 'PROMPT', expectedSource: 'review', expectedSeverity: 'nice-to-have', expectedReasonContains: 'judgment call' },
    { raw: '[review:minor]', expectedAction: 'PROMPT', expectedSource: 'review', expectedSeverity: 'minor', expectedReasonContains: 'judgment call' },
    { raw: '[review:edge-case]', expectedAction: 'KILL', expectedSource: 'review', expectedSeverity: 'edge-case', expectedReasonContains: 'adversarial-review noise' },
    { raw: '[review]', expectedAction: 'KEEP', expectedSource: 'review', expectedReasonContains: 'pre-landing adversarial finding' },

    // discovered + edges
    { raw: '[discovered:docs/plan.md]', expectedAction: 'PROMPT', expectedSource: 'discovered', expectedReasonContains: 'extracted from a scattered doc' },
    { raw: '[madeup]', expectedAction: 'PROMPT', expectedSource: 'madeup', expectedReasonContains: "unknown source tag 'madeup'" },
    { raw: '', expectedAction: 'KEEP', expectedSource: 'manual', expectedReasonContains: 'missing source tag' },
    { raw: '[a[b]', expectedAction: 'PROMPT', expectedSource: 'unknown', expectedReasonContains: 'malformed source tag' },
  ];

  test.each(rows)(
    'route($raw) → $expectedAction',
    ({ raw, expectedAction, expectedSource, expectedReasonContains, expectedSeverity }) => {
      const out = routeSourceTag(raw);
      expect(out.action).toBe(expectedAction);
      expect(out.source).toBe(expectedSource);
      expect(out.reason).toContain(expectedReasonContains);
      if (expectedSeverity !== undefined) {
        expect(out.severity).toBe(expectedSeverity);
      }
    },
  );

  test('matrix covers all 24 canonical tuples (+1 metadata-bearing variant)', () => {
    // 24 canonical (source, severity) tuples per docs/source-tag-contract.md.
    // The +1 is the pair-review-with-metadata sanity check carried over from
    // the original bash test — it doesn't add a new branch but verifies that
    // metadata in the tag survives routing.
    expect(rows.length).toBe(25);
  });
});

// ─── validateTagExpression ────────────────────────────────────────────

describe('validateTagExpression', () => {
  test('valid tag passes', () => {
    expect(validateTagExpression('[pair-review:group=2]').ok).toBe(true);
  });

  test('bare review passes', () => {
    expect(validateTagExpression('[review]').ok).toBe(true);
  });

  test('review with severity passes', () => {
    expect(validateTagExpression('[review:critical]').ok).toBe(true);
  });

  test('semicolon → INJECTION_ATTEMPT', () => {
    const r = validateTagExpression('[pair-review:group=1;rm]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('INJECTION_ATTEMPT');
  });

  test('unknown source → UNKNOWN_SOURCE', () => {
    const r = validateTagExpression('[madeup]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('UNKNOWN_SOURCE');
  });

  test('uppercase source → MALFORMED_TAG', () => {
    const r = validateTagExpression('[PAIR-REVIEW]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('MALFORMED_TAG');
  });

  test('missing brackets → MALFORMED_TAG', () => {
    const r = validateTagExpression('not-a-tag');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('MALFORMED_TAG');
  });

  // ─── Tightened per D3B + D-OV3 ──────────────────────────────────────

  test('backtick injection → INJECTION_ATTEMPT (tight, not just rejected)', () => {
    const r = validateTagExpression('[pair-review:`x`]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('INJECTION_ATTEMPT');
  });

  test('nested brackets → INJECTION_ATTEMPT', () => {
    const r = validateTagExpression('[a[b]c]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('INJECTION_ATTEMPT');
  });

  test('command substitution → INJECTION_ATTEMPT', () => {
    const r = validateTagExpression('[pair-review:$(rm -rf)]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('INJECTION_ATTEMPT');
  });

  test('newline in tag → MALFORMED_TAG', () => {
    const r = validateTagExpression('[pair\n-review]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('MALFORMED_TAG');
  });
});

// ─── extractTagFromHeading / extractTitleFromHeading ──────────────────

describe('extractTagFromHeading', () => {
  test('H3 with tag returns tag', () => {
    expect(extractTagFromHeading('### [pair-review:group=2] My title')).toBe(
      '[pair-review:group=2]',
    );
  });

  test('H3 without tag returns empty', () => {
    expect(extractTagFromHeading('### No tag here')).toBe('');
  });

  test('H2 with tag does NOT match (H3-only contract)', () => {
    expect(extractTagFromHeading('## [pair-review] Title')).toBe('');
  });

  test('H4 with tag does NOT match', () => {
    expect(extractTagFromHeading('#### [pair-review] Title')).toBe('');
  });
});

describe('extractTitleFromHeading', () => {
  test('strips tag and returns title', () => {
    expect(extractTitleFromHeading('### [pair-review] Bug X')).toBe('Bug X');
  });

  test('untagged passthrough', () => {
    expect(extractTitleFromHeading('### Untagged title')).toBe('Untagged title');
  });

  test('### [tag] alone (no title) returns empty after tag strip', () => {
    // No trailing whitespace after [tag], so the tag-strip regex (which
    // requires whitespace after the tag) does NOT fire — line stays as
    // '[tag]'. This documents the bash contract.
    expect(extractTitleFromHeading('### [pair-review]')).toBe('[pair-review]');
  });
});
