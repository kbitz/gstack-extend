/**
 * unprocessed.ts — port of check_unprocessed (~L1078-1169).
 *
 * Counts items in the ## Unprocessed section of TODOS.md, broken down
 * by canonical-form (heading-style `### [tag] Title`) vs legacy bullet
 * (`- [tag] ...`) vs compact bullet (`- **[tag] Title** ...`).
 *
 * Emits ITEMS / LEGACY_BULLETS / COMPACT_BULLETS as preamble (before STATUS),
 * then a STATUS that depends on the inbox shape:
 *   - found:  rich items present (or non-canonical present and need migration)
 *   - empty:  Unprocessed section exists but has no items
 *   - none:   no Unprocessed section
 *   - skip:   no TODOS.md
 */

import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckUnprocessed(ctx: AuditCtx): CheckResult {
  if (ctx.paths.todos === null) {
    // Bash emits STATUS first, then ITEMS: 0, then FINDINGS — no LEGACY/COMPACT lines.
    return {
      section: 'UNPROCESSED',
      status: 'skip',
      body: ['ITEMS: 0', 'FINDINGS:', '- No TODOS.md found'],
    };
  }

  const todos = ctx.todos.value;
  let items = 0;
  let legacy = 0;
  let compact = 0;
  for (const e of todos.entries) {
    if (e.kind === 'heading') items++;
    else if (e.kind === 'legacyBullet') legacy++;
    else if (e.kind === 'compactBullet') compact++;
  }

  const preamble = [`ITEMS: ${items}`, `LEGACY_BULLETS: ${legacy}`, `COMPACT_BULLETS: ${compact}`];
  const nonCanonical = legacy + compact;

  if (todos.hasUnprocessedSection && items > 0) {
    const body = ['FINDINGS:', `- ${items} unprocessed items awaiting triage`];
    if (legacy > 0) {
      body.push(`- ${legacy} legacy bullet-form entries (run /roadmap to migrate to rich format)`);
    }
    if (compact > 0) {
      body.push(
        `- ${compact} compact bold-form entries (\`- **[tag] Title**\`) — rewrite as \`### [tag] Title\` per docs/source-tag-contract.md`,
      );
    }
    return { section: 'UNPROCESSED', preamble, status: 'found', body };
  }

  if (todos.hasUnprocessedSection && nonCanonical > 0) {
    const body = ['FINDINGS:'];
    if (legacy > 0) {
      body.push(`- ${legacy} legacy bullet-form entries awaiting migration + triage`);
    }
    if (compact > 0) {
      body.push(
        `- ${compact} compact bold-form entries awaiting migration + triage (rewrite as \`### [tag] Title\`)`,
      );
    }
    return { section: 'UNPROCESSED', preamble, status: 'found', body };
  }

  if (todos.hasUnprocessedSection) {
    return {
      section: 'UNPROCESSED',
      preamble,
      status: 'empty',
      body: ['FINDINGS:', '- Unprocessed section exists but is empty'],
    };
  }

  return {
    section: 'UNPROCESSED',
    preamble,
    status: 'none',
    body: ['FINDINGS:', '- No Unprocessed section'],
  };
}
