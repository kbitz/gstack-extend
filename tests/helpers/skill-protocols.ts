/**
 * skill-protocols.ts — helpers shared by tests/skill-protocols*.test.ts.
 *
 * Nothing here reads a named skill file: each suite names the skills it reads,
 * so diff-based selection and pregate's literal scan map a skill to the suites
 * that test it. Module-level fixtures stay in the suites that clean them up.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUARD_COMMENT, GUARD_LINE, extractFences } from './extend-root.ts';

const ROOT = join(import.meta.dir, '..', '..');

// ─── Track 16D: verified extend-root resolver ────────────────────────

export function resolverSkillText(skill: string): string {
  return readFileSync(join(ROOT, 'skills', `${skill}.md`), 'utf8');
}

// Track 22D. Headings inside fences are not section boundaries.
export function skillSection(text: string, heading: string): string {
  const lines = text.split('\n');
  let openChar = '';
  let openLen = 0;
  let start = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const marks = fence[1]!;
      const rest = fence[2] ?? '';
      if (openLen === 0) {
        openChar = marks[0]!;
        openLen = marks.length;
      } else if (marks[0] === openChar && marks.length >= openLen && rest.trim() === '') {
        openChar = '';
        openLen = 0;
      }
      continue;
    }
    if (openLen !== 0) continue;
    const headingMatch = /^(#{1,6}) /.exec(line);
    if (!headingMatch) continue;
    const level = headingMatch[1]!.length;
    if (start < 0) {
      if (line === heading) {
        start = i;
        startLevel = level;
      }
      continue;
    }
    if (level <= startLevel) return lines.slice(start, i).join('\n');
  }
  if (start < 0) throw new Error(`heading not found outside fences: ${heading}`);
  return lines.slice(start).join('\n');
}

// Clause locks compare flattened prose: emphasis markers and line wraps are
// stripped, so a harmless reflow passes and a reworded behavior fails.
export function flatProse(text: string): string {
  return text.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
}

export interface Clause {
  id: string;
  heading: string;
  text: string;
  /** Only the text before the section's first `### ` sub-heading counts. */
  lead?: boolean;
}

export function missingClauses(skill: string, clauses: Clause[]): string[] {
  const missing: string[] = [];
  for (const clause of clauses) {
    let body = skillSection(skill, clause.heading);
    if (clause.lead) body = body.split(/\n### /)[0]!;
    if (!flatProse(body).includes(flatProse(clause.text))) missing.push(clause.id);
  }
  return missing;
}

export function stateBashFences(text: string): Array<{ body: string }> {
  return extractFences(text).filter((fence) => {
    const body = fence.body;
    return body.includes('SESSION_DIR') || /\bsession_dir\b/.test(body) || /\bsession_archive_dir\b/.test(body);
  });
}

export function guardOrdered(body: string): boolean {
  const comment = body.indexOf(GUARD_COMMENT);
  if (comment < 0) return false;
  const guard = body.indexOf(GUARD_LINE, comment + GUARD_COMMENT.length);
  if (guard < 0) return false;
  const source = body.indexOf('source "$_EXTEND_ROOT/', guard + GUARD_LINE.length);
  return source > guard;
}

// Track 23D: the markers review-and-prep writes and pair-review's paused check
// reads. Each side's suite checks its own skill against this one list.
export const PAUSE_MARKERS = ['<!-- review-and-prep:paused:', '<!-- review-and-prep:receipt:', 'PAUSED', 'manual testing required'];
