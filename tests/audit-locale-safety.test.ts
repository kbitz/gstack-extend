/**
 * audit-locale-safety.test.ts — TODO-2 contract.
 *
 * The bash audit runs under LC_ALL=C; bytewise sort/grep/awk semantics
 * are the parity contract. Locale-leaky JS APIs (Intl, localeCompare,
 * sort() without comparator) silently produce different output on
 * different locales, breaking the snapshot oracle in subtle ways.
 *
 * This test fails if any forbidden API appears in src/audit/** without
 * an inline waiver comment. Add a `// LC_ALL=C: <reason>` on the same
 * line as the API to whitelist a specific use.
 *
 * Recognized waiver patterns (case-insensitive):
 *   // LC_ALL=C: ...   (preferred)
 *   /* LC_ALL=C: ... *\/  (block comment, same line)
 *
 * The lib/git.ts gateway forces LC_ALL=C on every spawn — that's its own
 * waiver mechanism and not subject to this lint.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

type Rule = {
  // Stable id so violations message can pinpoint which rule fired.
  id: string;
  // Pattern to grep for (substring match — kept simple on purpose).
  needle: RegExp;
  reason: string;
};

const RULES: Rule[] = [
  {
    id: 'localeCompare',
    needle: /\.localeCompare\b/,
    reason: 'String#localeCompare is locale-aware. Use bytewise compare via < or === on strings.',
  },
  {
    id: 'Intl',
    needle: /\bIntl\./,
    reason: 'The Intl namespace is locale-aware. Format manually or use a fixed format.',
  },
  {
    id: 'toLocale',
    needle: /\.toLocale(?:LowerCase|UpperCase|String|DateString|TimeString)\b/,
    reason: 'toLocale*() variants are locale-aware. Use toLowerCase/toUpperCase/toString.',
  },
  {
    id: 'sortNoComparator',
    // /\.sort\(\s*\)/ catches `.sort()` exactly. Sort with a comparator is fine.
    needle: /\.sort\(\s*\)/,
    reason: 'Array#sort() without a comparator uses locale-aware string compare. Pass an explicit (a,b) comparator.',
  },
];

const ROOT = join(import.meta.dir, '..');
const SRC_AUDIT = join(ROOT, 'src/audit');
// lib/git.ts already encodes LC_ALL=C in its spawn call; exempt from sort lint
// noise (it doesn't sort anyway, but list it for explicitness).
const EXEMPT_FILES: string[] = [];

function* walkTs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walkTs(full);
    } else if (entry.endsWith('.ts')) {
      yield full;
    }
  }
}

function hasWaiver(line: string): boolean {
  return /LC_ALL=C:/i.test(line);
}

// Strip comments naively but adequately for our audit code. Lines that are
// pure comments (block-comment continuations, jsdoc, line comments) become
// empty. Inline `// ...` tail comments on otherwise-code lines also drop.
// String contents are left intact — false positives there get silenced via
// the // LC_ALL=C: waiver pattern.
function stripComments(line: string): string {
  const trimmed = line.trimStart();
  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*')
  ) {
    return '';
  }
  // Drop inline tail comment (best-effort; ignores `//` inside strings).
  const idx = line.indexOf('//');
  return idx >= 0 ? line.slice(0, idx) : line;
}

describe('audit locale-safety contract (TODO-2)', () => {
  test('no locale-leaky APIs without explicit waiver', () => {
    const violations: string[] = [];
    for (const file of walkTs(SRC_AUDIT)) {
      const rel = relative(ROOT, file);
      if (EXEMPT_FILES.includes(rel)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        const code = stripComments(line);
        if (code === '') return;
        for (const rule of RULES) {
          if (rule.needle.test(code) && !hasWaiver(line)) {
            violations.push(
              `${rel}:${idx + 1} [${rule.id}] ${rule.reason}\n    ${line.trim()}`,
            );
          }
        }
      });
    }
    if (violations.length > 0) {
      const msg = [
        'TODO-2 locale-safety violation. Either rewrite the call to be',
        'byte-deterministic, or add an inline waiver comment on the same',
        'line: `// LC_ALL=C: <one-line reason this is safe>`.',
        '',
        ...violations,
      ].join('\n');
      throw new Error(msg);
    }
    expect(violations).toEqual([]);
  });
});
