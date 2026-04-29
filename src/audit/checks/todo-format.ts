/**
 * todo-format.ts — port of check_todo_format (~L3456-3567).
 *
 * Walks the ## Unprocessed section of TODOS.md and validates every
 * candidate entry against the source-tag contract.
 *
 * Failure modes:
 *   - MALFORMED_HEADING: compact bullet (`- **[tag] Title**`) — flagged
 *     so the writer migrates to canonical heading form.
 *   - MALFORMED_HEADING: legacy bullet (`- [tag] ...`) — same migration ask.
 *   - MALFORMED_HEADING: heading starts with `[` but tag isn't closed.
 *   - MALFORMED_TAG: parse fails on the bracketed tag expression.
 *   - UNKNOWN_SOURCE: source not in registry.
 *   - INJECTION_ATTEMPT: dangerous chars (nested brackets, semicolons,
 *     backticks, command substitution).
 *
 * Output: HEADINGS / LEGACY_BULLETS / COMPACT_BULLETS as preamble (count
 * lines mirrored from check_unprocessed but computed independently —
 * preserves bash semantics where the two checks count their own way).
 */

import { extractTagFromHeading, extractTitleFromHeading, validateTagExpression } from '../lib/source-tag.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckTodoFormat(ctx: AuditCtx): CheckResult {
  if (ctx.paths.todos === null) {
    return {
      section: 'TODO_FORMAT',
      status: 'skip',
      body: ['FINDINGS:', '- No TODOS.md found'],
    };
  }

  let inSection = false;
  let inFence = false;
  let headingTotal = 0;
  let legacy = 0;
  let compact = 0;
  const failures: string[] = [];

  for (const line of ctx.files.todos.split('\n')) {
    if (/^[ \t]*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^## Unprocessed\b/.test(line)) {
      inSection = true;
      continue;
    }
    if (!inFence && inSection && /^## /.test(line)) {
      inSection = false;
      continue;
    }
    if (!inSection || inFence) continue;

    if (/^- \*\*\[/.test(line)) {
      compact++;
      const excerpt = line.slice(0, 80);
      failures.push(
        `- MALFORMED_HEADING: compact bold-form entry '${excerpt}' — rewrite as '### [tag] Title' per docs/source-tag-contract.md`,
      );
      continue;
    }
    if (/^- \[/.test(line)) {
      legacy++;
      const excerpt = line.slice(0, 80);
      failures.push(
        `- MALFORMED_HEADING: legacy bullet entry '${excerpt}' — rewrite as '### [tag] Title' per docs/source-tag-contract.md`,
      );
      continue;
    }
    if (/^### /.test(line)) {
      headingTotal++;
      const tag = extractTagFromHeading(line);
      const title = extractTitleFromHeading(line);
      if (tag === '') {
        const headingBody = line.replace(/^### /, '');
        if (/^\[/.test(headingBody)) {
          const excerpt = headingBody.slice(0, 80);
          failures.push(
            `- MALFORMED_HEADING: unclosed tag bracket in '${excerpt}' — heading starts with '[' but the tag is not properly closed (expected '### [source:key=val] Title')`,
          );
        }
        continue;
      }
      const r = validateTagExpression(tag);
      if (!r.ok) {
        failures.push(`- ${r.reason}: '${tag}' in entry '${title}'`);
      }
    }
  }

  const preamble = [
    `HEADINGS: ${headingTotal}`,
    `LEGACY_BULLETS: ${legacy}`,
    `COMPACT_BULLETS: ${compact}`,
  ];
  if (failures.length === 0) {
    return {
      section: 'TODO_FORMAT',
      preamble,
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }
  // Bash uses `echo -en "$failures"` (no trailing newline interpretation
  // beyond what's in the string — `-en` suppresses the auto-newline). So
  // no trailing '' here unlike the other warn/fail checks.
  return {
    section: 'TODO_FORMAT',
    preamble,
    status: 'fail',
    body: ['FINDINGS:', ...failures],
  };
}
