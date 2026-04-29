/**
 * doc-inventory.ts — port of check_doc_inventory (~L1513-1568).
 *
 * Lists every `.md` file at maxdepth 2 with its TODO-pattern count and
 * doc-type label. Informational output — feeds the skill prompt's Doc
 * Discovery step.
 *
 * Doc-type classification (mirrors bash):
 *   - root doc:    basename in ROOT_DOCS
 *   - project doc: basename in DOCS_DIR_DOCS
 *   - design doc:  path contains `/docs/designs/`
 *   - archived doc: path contains `/docs/archive/` (won't appear because
 *                    walkMdFiles excludes archive — kept for completeness)
 *   - unknown:     anything else
 *
 * Body shape:
 *   FILES:
 *   - relpath: N TODO patterns (label)
 *   ...
 *   <blank>
 *   TOTAL_FILES: K
 *
 * The blank line between FILES and TOTAL_FILES mirrors the bash `echo -e
 * "$files_output"` artifact (trailing \n in the string + echo's own
 * newline).
 */

import { countTodoPatterns } from '../lib/todo-patterns.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

const ROOT_DOCS = new Set(['README.md', 'CHANGELOG.md', 'CLAUDE.md', 'VERSION', 'LICENSE', 'LICENSE.md']);
const PROJECT_DOCS = new Set(['TODOS.md', 'ROADMAP.md', 'PROGRESS.md']);

function classify(rel: string, basename: string): string {
  if (ROOT_DOCS.has(basename)) return 'root doc';
  if (PROJECT_DOCS.has(basename)) return 'project doc';
  if (rel.includes('/docs/designs/') || rel.startsWith('docs/designs/')) return 'design doc';
  if (rel.includes('/docs/archive/') || rel.startsWith('docs/archive/')) return 'archived doc';
  return 'unknown';
}

export function runCheckDocInventory(ctx: AuditCtx): CheckResult {
  const body: string[] = ['FILES:'];
  const files = ctx.mdFiles;

  if (files.length === 0) {
    return {
      section: 'DOC_INVENTORY',
      status: 'info',
      body: [...body, '- (none)', 'TOTAL_FILES: 0'],
    };
  }

  for (const f of files) {
    const basename = f.rel.includes('/') ? f.rel.slice(f.rel.lastIndexOf('/') + 1) : f.rel;
    const count = countTodoPatterns(f.content);
    const label = classify(f.rel, basename);
    body.push(`- ${f.rel}: ${count} TODO patterns (${label})`);
  }
  body.push(''); // bash echo -e of \n-terminated string artifact
  body.push(`TOTAL_FILES: ${files.length}`);

  return { section: 'DOC_INVENTORY', status: 'info', body };
}
