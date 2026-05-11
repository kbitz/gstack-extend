/**
 * state-sections.ts — validates the state-section grammar.
 *
 * Enforces:
 *   - State sections (`## In Progress`, `## Current Plan`, `## Future`,
 *     `## Shipped`) appear in document order. All four are individually
 *     optional, but when present they must be in this order. Shipped
 *     lives at the tail so the active plan is what readers see first.
 *   - No state section appears more than once.
 *   - At least one state section is present. A document with none is in
 *     v1 grammar; the check fails with `MIGRATION_NEEDED` so the user
 *     runs /roadmap to regenerate.
 *
 * Output shape:
 *   STATUS: pass | fail
 *   FINDINGS: per-finding (or "- (none)")
 *   GRAMMAR: v1 | v2
 *   SECTIONS_PRESENT: <comma-separated list>
 */

import type { AuditCtx, CheckResult } from '../types.ts';

const ORDER = ['In Progress', 'Current Plan', 'Future', 'Shipped'] as const;
type StateSectionName = (typeof ORDER)[number];

export function runCheckStateSections(ctx: AuditCtx): CheckResult {
  if (ctx.paths.roadmap === null) {
    return {
      section: 'STATE_SECTIONS',
      status: 'skip',
      body: ['FINDINGS:', '- No ROADMAP.md found'],
    };
  }

  const lines = ctx.files.roadmap.split('\n');
  const seen: Array<{ name: StateSectionName; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const name of ORDER) {
      const re = new RegExp(`^## ${name}\\b`);
      if (re.test(line)) {
        seen.push({ name, line: i + 1 });
        break;
      }
    }
  }

  const findings: string[] = [];

  // Duplicate detection.
  const counts = new Map<StateSectionName, number>();
  for (const s of seen) counts.set(s.name, (counts.get(s.name) ?? 0) + 1);
  for (const [name, count] of counts) {
    if (count > 1) {
      findings.push(`- ## ${name} appears ${count} times — must appear at most once`);
    }
  }

  // Order check. Walk seen[]; each entry's index in ORDER must be >= prior's.
  let prevIdx = -1;
  for (const s of seen) {
    const idx = ORDER.indexOf(s.name);
    if (idx < prevIdx) {
      findings.push(
        `- ## ${s.name} appears out of order at line ${s.line} — expected order is ${ORDER.join(' → ')}`,
      );
    }
    prevIdx = Math.max(prevIdx, idx);
  }

  const grammar = ctx.roadmap.value.hasV2Grammar ? 'v2' : 'v1';
  if (grammar === 'v1') {
    findings.push(
      '- MIGRATION_NEEDED: ROADMAP.md has no state sections. Run /roadmap to regenerate into ## In Progress / ## Current Plan / ## Future / ## Shipped. See docs/designs/roadmap-v2-state-model.md.',
    );
  }

  const sectionsPresent = seen.map((s) => s.name).join(', ');
  const tail = [
    `GRAMMAR: ${grammar}`,
    `SECTIONS_PRESENT: ${sectionsPresent}`,
  ];

  if (findings.length === 0) {
    return {
      section: 'STATE_SECTIONS',
      status: 'pass',
      body: ['FINDINGS:', '- (none)', ...tail],
    };
  }

  return {
    section: 'STATE_SECTIONS',
    status: 'fail',
    body: ['FINDINGS:', ...findings, '', ...tail],
  };
}
