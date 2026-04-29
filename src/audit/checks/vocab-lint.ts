/**
 * vocab-lint.ts — port of check_vocab_lint (bin/roadmap-audit ~L200-300).
 *
 * Two-pass scan over ROADMAP.md content:
 *   1. Banned-term grep (cluster, workstream, milestone, sprint).
 *   2. State-machine scan for "phase" (whitelisted in title line, in
 *      ## Future block, and inside ## Phase N: blocks).
 *
 * Strikethrough lines (containing `~~`) are skipped — they're completed
 * items, not active vocabulary drift.
 *
 * Findings are emitted in bash order: first all banned-term hits in the
 * order their term appears in the `BANNED` list (with line numbers in
 * file order per term), then all "phase" hits in file order. This is
 * how bash builds it via the outer for-term loop + inner grep -in.
 */

import type { AuditCtx, CheckResult } from '../types.ts';

const BANNED = ['cluster', 'workstream', 'milestone', 'sprint'] as const;

function caseInsensitiveBoundaryMatch(term: string, line: string): boolean {
  // Bash uses `grep -in '\b<term>\b'`. JS \b is locale-aware on Unicode but
  // on plain ASCII (term + line bytes) it matches bash's [:alnum:] boundary.
  const re = new RegExp(`\\b${term}\\b`, 'i');
  return re.test(line);
}

export function runCheckVocabLint(ctx: AuditCtx): CheckResult {
  if (ctx.paths.roadmap === null) {
    return {
      section: 'VOCAB_LINT',
      status: 'skip',
      body: ['FINDINGS:', '- No ROADMAP.md found'],
    };
  }

  const lines = ctx.files.roadmap.split('\n');
  const findings: string[] = [];

  // Pass 1: banned terms, outer loop term-major (matches bash for-term order).
  for (const term of BANNED) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (!caseInsensitiveBoundaryMatch(term, line)) continue;
      // Skip strikethrough — completed items don't count as active drift.
      if (line.includes('~~')) continue;
      findings.push(`- line ${i + 1}: banned term "${term}" found`);
    }
  }

  // Pass 2: "phase" with state-machine whitelist.
  type State = 'TOPLEVEL' | 'GROUP' | 'FUTURE' | 'PHASE';
  let state: State = 'TOPLEVEL';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // State transitions on ## headings.
    if (/^## /.test(line)) {
      if (/^## Phase [0-9]+:/.test(line)) {
        state = 'PHASE';
      } else if (/^## Group/i.test(line)) {
        state = 'GROUP';
      } else if (/^## Future($| \()/i.test(line)) {
        state = 'FUTURE';
      } else {
        state = 'TOPLEVEL';
      }
    }

    if (!/\bphase\b/i.test(line)) continue;
    if (line.includes('~~')) continue;
    // Whitelist 1: title line `^# .*Phase`.
    if (/^# .*[Pp]hase/.test(line)) continue;
    // Whitelists 2+3: inside FUTURE / PHASE block.
    if (state === 'FUTURE' || state === 'PHASE') continue;

    findings.push(`- line ${i + 1}: banned term "phase" found`);
  }

  if (findings.length === 0) {
    return {
      section: 'VOCAB_LINT',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }

  // VOCAB_LINT is advisory. Trailing '' mirrors bash `echo -e "$findings"` +
  // `echo ""` — the \n-terminated string + echo's own newline produces an
  // extra blank line between sections that the snapshot oracle expects.
  return {
    section: 'VOCAB_LINT',
    status: 'warn',
    body: ['FINDINGS:', ...findings, ''],
  };
}
