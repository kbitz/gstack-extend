/**
 * state-sections.ts — validates the v2 state-section grammar.
 *
 * Enforces:
 *   - State sections (`## Shipped`, `## In Progress`, `## Current Plan`,
 *     `## Future`) appear in document order. All four are individually
 *     optional, but when present they must be in this order.
 *   - No state section appears more than once.
 *   - When at least one state section is present, the document is in v2
 *     mode and the parser stamps each Group/Track with its lifecycle
 *     state. When absent, the document is in v1 mode (transitional —
 *     emits a `MIGRATION_NEEDED: warn` finding).
 *
 * Output shape:
 *   STATUS: pass | fail | warn
 *   FINDINGS: per-finding (or "- (none)")
 *   GRAMMAR: v1 | v2
 *   SECTIONS_PRESENT: <comma-separated list>
 */

import type { AuditCtx, CheckResult } from '../types.ts';

const ORDER = ['Shipped', 'In Progress', 'Current Plan', 'Future'] as const;
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
      '- MIGRATION_NEEDED: ROADMAP.md uses v1 grammar (no state sections). Run /roadmap to regenerate into v2 (## Shipped / ## In Progress / ## Current Plan / ## Future). See docs/designs/roadmap-v2-state-model.md.',
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

  // v1 alone (no other findings) → warn (advisory).
  // Otherwise (duplicates / order errors) → fail.
  const onlyMigration = findings.length === 1 && grammar === 'v1';
  return {
    section: 'STATE_SECTIONS',
    status: onlyMigration ? 'warn' : 'fail',
    body: ['FINDINGS:', ...findings, '', ...tail],
  };
}
