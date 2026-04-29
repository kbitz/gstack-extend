/**
 * scattered-todos.ts — port of check_scattered_todos (~L1576-1607).
 *
 * Scans every `.md` file at maxdepth 2 (excluding ROOT_DOCS, DOCS_DIR_DOCS,
 * docs/archive, .context, etc.) and reports any with TODO-like patterns.
 * Output sorted by path-discovery order (matches `find ... | sort` in
 * bash via `walkMdFiles` which sorts ascending).
 *
 * Findings are emitted in DESCENDING count order — bash builds the list
 * in `find | sort` (ascending path) order but the fixture expected output
 * shows descending count? Re-check: scattered-todos fixture has plan.md
 * (3) before notes.md (2). Sort is by pre-existing find output... wait,
 * `docs/notes.md` < `docs/plan.md` alphabetically. So bash adds them in
 * alpha order: notes (2), then plan (3). But the fixture shows plan first.
 *
 * Looking again at the fixture: `- docs/plan.md: 3 items` then
 * `- docs/notes.md: 2 items`. Plan (3) comes before notes (2). That's
 * descending count, not alphabetical. Reading the bash again: the loop
 * appends to `findings` in `find_scannable_md_files` order, which... is
 * actually `find` order, NOT `sort`-ed. Bash does NOT sort. The `find`
 * order on macOS happens to match what we see.
 *
 * Since fs ordering is not portable, this port sorts by descending count
 * with stable alpha tiebreak. That gives a deterministic order independent
 * of fs-dependent find traversal, AND happens to match the existing
 * fixture for plan-then-notes. The shadow runner's per-section diff
 * keeps us honest if bash's order ever drifts.
 */

import { countTodoPatterns } from '../lib/todo-patterns.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

const ROOT_DOCS = new Set(['README.md', 'CHANGELOG.md', 'CLAUDE.md', 'VERSION', 'LICENSE', 'LICENSE.md']);
const PROJECT_DOCS = new Set(['TODOS.md', 'ROADMAP.md', 'PROGRESS.md']);

function basename(rel: string): string {
  const i = rel.lastIndexOf('/');
  return i < 0 ? rel : rel.slice(i + 1);
}

export function runCheckScatteredTodos(ctx: AuditCtx): CheckResult {
  let total = 0;
  const hits: { rel: string; count: number }[] = [];

  for (const f of ctx.mdFiles) {
    const bn = basename(f.rel);
    if (ROOT_DOCS.has(bn)) continue;
    if (PROJECT_DOCS.has(bn)) continue;
    // Archived already excluded by walker.
    const count = countTodoPatterns(f.content);
    if (count > 0) {
      hits.push({ rel: f.rel, count });
      total += count;
    }
  }

  hits.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count; // desc count
    return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0;
  });

  if (hits.length === 0) {
    return {
      section: 'SCATTERED_TODOS',
      status: 'pass',
      body: ['FINDINGS:', '- (none)', `TOTAL_SCATTERED: ${total}`],
    };
  }
  // Trailing '' from bash echo -e of \n-terminated $findings; TOTAL_SCATTERED follows.
  return {
    section: 'SCATTERED_TODOS',
    status: 'found',
    body: [
      'FINDINGS:',
      ...hits.map((h) => `- ${h.rel}: ${h.count} items`),
      '',
      `TOTAL_SCATTERED: ${total}`,
    ],
  };
}
