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
import { planningLines } from '../lib/state.ts';
import { legacyTodoBulletKind, parseTodoIdBullet } from '../lib/work-item-id.ts';
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
  /** Validated `wi-` work-item ID from `- **ID:** <val>`, or null when absent/malformed. */
  workItemId?: string | null;
  /** Raw value from the first `- **ID:**` bullet, or null when absent. */
  workItemIdRaw?: string | null;
  /** Parse/duplication error for the entry's `- **ID:**` bullet(s). */
  workItemIdError?: 'malformed' | 'duplicate' | null;
};

export type ParsedTodos = {
  hasUnprocessedSection: boolean;
  entries: TodoEntry[];
  /** Valid work-item IDs observed under `## Completed` (for cross-doc uniqueness). */
  completedIds?: string[];
  completedEntries?: TodoEntry[];
};

export function parseTodos(content: string): ParserResult<ParsedTodos> {
  const errors: ParseError[] = [];
  const entries: TodoEntry[] = [];
  const completedIds: string[] = [];
  const completedEntries: TodoEntry[] = [];

  if (content === '') {
    return { value: { hasUnprocessedSection: false, entries, completedIds }, errors };
  }

  let section: 'unprocessed' | 'completed' | null = null;
  let hasUnprocessedSection = false;
  let currentHeading: TodoEntry | null = null;
  const lines = content.split('\n');
  for (const [index, line] of planningLines(lines)) {
    const lineno = index + 1;
    if (/^## Unprocessed\b/.test(line)) {
      hasUnprocessedSection = true;
      section = 'unprocessed';
      currentHeading = null;
      continue;
    }

    if (/^## Completed\b/.test(line)) {
      section = 'completed';
      currentHeading = null;
      continue;
    }

    if (section !== null && /^## /.test(line)) {
      section = null;
      currentHeading = null;
      continue;
    }

    if (section === null) continue;

    const legacyKind = legacyTodoBulletKind(line, currentHeading !== null);
    if (legacyKind !== null) {
      currentHeading = null;
      if (section === 'unprocessed') entries.push({ kind: legacyKind, line: lineno, raw: line });
      continue;
    }

    // Heading entry.
    if (/^### /.test(line)) {
      const tag = extractTagFromHeading(line);
      const title = extractTitleFromHeading(line);
      const headingBody = line.replace(/^### /, '');
      const unclosedTag = tag === '' && /^\[/.test(headingBody);
      const entry: TodoEntry = {
        kind: 'heading',
        line: lineno,
        raw: line,
        tag,
        title,
        unclosedTag,
        workItemId: null,
        workItemIdRaw: null,
        workItemIdError: null,
      };
      (section === 'unprocessed' ? entries : completedEntries).push(entry);
      currentHeading = entry;
      continue;
    }

    // Attribute bullet `- **ID:** <val>` belonging to current heading entry.
    const parsedId = parseTodoIdBullet(line);
    if (parsedId !== null) {
      if (section === 'completed' && parsedId.id !== null) completedIds.push(parsedId.id);
      if (currentHeading !== null) {
        if (currentHeading.workItemIdRaw !== null && currentHeading.workItemIdRaw !== undefined) {
          currentHeading.workItemIdError = 'duplicate';
        } else {
          currentHeading.workItemIdRaw = parsedId.raw;
          currentHeading.workItemId = parsedId.id;
          currentHeading.workItemIdError = parsedId.id === null ? 'malformed' : null;
        }
      }
    }
  }

  return { value: { hasUnprocessedSection, entries, completedIds, completedEntries }, errors };
}
