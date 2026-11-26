/**
 * todos.ts — parses TODOS.md into a structured shape consumed by
 * check_unprocessed, check_todo_format, and check_taxonomy.
 *
 * Walks planning text line-by-line, tracking section state.
 * Inside the `## Unprocessed` section, classifies each
 * candidate line as one of:
 *
 *   - heading       → `### [tag] Title` or `### Plain title`  (canonical)
 *   - compactBullet → `- **[tag] Title** — body`              (non-canonical, flagged)
 *   - legacyBullet  → `- [something] body`                    (legacy, flagged)
 *
 * Tag/title extraction reuses src/audit/lib/source-tag.ts so the parsing
 * is byte-identical to source-tag's contract.
 */

import { planningLines } from '../lib/markdown.ts';
import { extractTagFromHeading, extractTitleFromHeading } from '../lib/source-tag.ts';
import { isValidWorkItemId, legacyTodoBulletKind, parseTodoIdBullet } from '../lib/work-item-id.ts';
import type { ParseError, ParserResult } from '../types.ts';
import type { Tokens } from 'marked';

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
  for (const [lineno, line] of planningLines(content)) {
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

export type ParsedIntakeFile = {
  rel: string;
  basename: string;
  kind: 'file' | 'non-file';
  filenameId: string | null;
  headings: TodoEntry[];
  unexpectedHeadings: { line: number; raw: string }[];
  legacyBullets: TodoEntry[];
  compactBullets: TodoEntry[];
  workItemId: string | null;
  workItemIdRaw: string | null;
  workItemIdError: 'malformed' | 'duplicate' | null;
  idIsFirst: boolean;
  hasFrontmatter: boolean;
  headingIsFirst: boolean;
  unreadable?: true;
};

export function parseIntakeFile(
  rel: string, basename: string, kind: ParsedIntakeFile['kind'], content: string,
): ParsedIntakeFile {
  const isMarkdown = kind === 'file' && basename.endsWith('.md');
  const stem = basename.slice(0, -3);
  const record: ParsedIntakeFile = {
    rel, basename, kind,
    filenameId: isMarkdown && isValidWorkItemId(stem) ? stem : null,
    headings: [], unexpectedHeadings: [], legacyBullets: [], compactBullets: [],
    workItemId: null, workItemIdRaw: null, workItemIdError: null, idIsFirst: false, headingIsFirst: false,
    hasFrontmatter: isMarkdown && /^(?:\uFEFF)?---[ \t]*\r?\n(?:[^\n]*\n)*?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.test(content),
  };
  if (!isMarkdown) return record;

  const markdownHeadings = new Map<number, Tokens.Heading>();
  const rawLines = content.split('\n');
  const firstContentLine = rawLines.findIndex(line => line.trim() !== '') + 1;
  for (const [lineno, line] of planningLines(content, (lineNo, heading) => {
    markdownHeadings.set(lineNo, heading);
  })) {
    if (line.trim() === '') continue;
    const heading = markdownHeadings.get(lineno);
    const isRecordHeading = heading?.depth === 3 && line.startsWith('### ');
    if (heading && !isRecordHeading && (heading.depth <= 3 || record.headings.length === 0)) {
      record.unexpectedHeadings.push({ line: lineno, raw: line });
    }
    const legacyKind = legacyTodoBulletKind(line, record.headings.length > 0);
    if (legacyKind !== null) {
      const bullets = legacyKind === 'legacyBullet' ? record.legacyBullets : record.compactBullets;
      bullets.push({ kind: legacyKind, line: lineno, raw: line });
    }
    if (isRecordHeading) {
      if (lineno === firstContentLine) record.headingIsFirst = true;
      const tag = extractTagFromHeading(line);
      const afterTag = heading.text.slice(tag.length);
      const title = tag !== '' && !/^[ \t]/.test(afterTag) ? '' : extractTitleFromHeading('### ' + heading.text);
      record.headings.push({
        kind: 'heading', line: lineno, raw: line, tag, title,
        unclosedTag: tag === '' && line.startsWith('### ['),
      });
    }
    const id = parseTodoIdBullet(line);
    if (id !== null) {
      if (record.workItemIdRaw !== null) {
        record.workItemIdError = 'duplicate';
      } else {
        const opening = record.headings[0];
        record.idIsFirst = opening !== undefined && record.headings.length === 1 && opening.line < lineno
          && rawLines.slice(opening.line, lineno - 1).every(raw => raw.trim() === '');
        record.workItemIdRaw = id.raw;
        record.workItemId = id.id;
        record.workItemIdError = id.id === null ? 'malformed' : null;
      }
    }
  }
  return record;
}
