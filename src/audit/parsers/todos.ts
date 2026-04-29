/**
 * todos.ts — parses TODOS.md into a structured shape consumed by
 * check_unprocessed, check_todo_format, and check_taxonomy.
 *
 * Walks line-by-line tracking fence state (``` toggle) and section state.
 * Inside the `## Unprocessed` section (and outside fences), classifies each
 * candidate line as one of:
 *
 *   - heading       → `### [tag] Title` or `### Plain title`  (canonical)
 *   - compactBullet → `- **[tag] Title** — body`              (non-canonical, flagged)
 *   - legacyBullet  → `- [something] body`                    (legacy, flagged)
 *
 * Tag/title extraction reuses src/audit/lib/source-tag.ts so the parsing
 * is byte-identical to source-tag's contract.
 *
 * Fence handling: any line matching `^[ \t]*` ` ` ` toggles fence state.
 * The bash version uses a simple toggle (TODOS.md rarely nests). Same here.
 */

import { extractTagFromHeading, extractTitleFromHeading } from '../lib/source-tag.ts';
import type { ParseError, ParserResult } from '../types.ts';

export type TodoEntryKind = 'heading' | 'compactBullet' | 'legacyBullet';

export type TodoEntry = {
  kind: TodoEntryKind;
  line: number; // 1-indexed
  raw: string; // full line content
  /** For headings only: tag string like "[manual]" or "" if missing. */
  tag?: string;
  /** For headings only: title text after the tag. */
  title?: string;
  /** True for headings that started with `[` but the tag is unclosed. */
  unclosedTag?: boolean;
};

export type ParsedTodos = {
  hasUnprocessedSection: boolean;
  entries: TodoEntry[];
};

export function parseTodos(content: string): ParserResult<ParsedTodos> {
  const errors: ParseError[] = [];
  const entries: TodoEntry[] = [];

  if (content === '') {
    return { value: { hasUnprocessedSection: false, entries }, errors };
  }

  let inFence = false;
  let inSection = false;
  let hasUnprocessedSection = false;
  let lineno = 0;

  const lines = content.split('\n');
  for (const line of lines) {
    lineno++;

    // Fence toggle: matches `^[ \t]*\x60{3,}` and `^[ \t]*~{3,}` per bash.
    if (/^[ \t]*```/.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence && /^## Unprocessed\b/.test(line)) {
      hasUnprocessedSection = true;
      inSection = true;
      continue;
    }

    if (!inFence && inSection && /^## /.test(line)) {
      inSection = false;
      continue;
    }

    if (!inSection || inFence) continue;

    // Compact bold form: `- **[`. Check before legacy `- [` (compact also
    // matches `- \[` once the bold prefix is stripped).
    if (/^- \*\*\[/.test(line)) {
      entries.push({ kind: 'compactBullet', line: lineno, raw: line });
      continue;
    }

    // Legacy bullet form.
    if (/^- \[/.test(line)) {
      entries.push({ kind: 'legacyBullet', line: lineno, raw: line });
      continue;
    }

    // Heading entry.
    if (/^### /.test(line)) {
      const tag = extractTagFromHeading(line);
      const title = extractTitleFromHeading(line);
      const headingBody = line.replace(/^### /, '');
      const unclosedTag = tag === '' && /^\[/.test(headingBody);
      entries.push({
        kind: 'heading',
        line: lineno,
        raw: line,
        tag,
        title,
        unclosedTag,
      });
      continue;
    }
  }

  return { value: { hasUnprocessedSection, entries }, errors };
}
