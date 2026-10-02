/**
 * doc-location.ts — port of check_doc_location (~L897-945).
 *
 * Opinionated layout check:
 *   ROOT_DOCS:     README.md, CHANGELOG.md, CLAUDE.md, VERSION, LICENSE, LICENSE.md
 *   DOCS_DIR_DOCS: TODOS.md, ROADMAP.md, PROGRESS.md
 *
 * Flags:
 *   - DOCS_DIR_DOCS in root only → should be in docs/
 *   - ROOT_DOCS in docs/ only    → should be in root (tools expect them there)
 *   - `docs/` directory absent only when the audited repo itself has a
 *     file at bin/roadmap-audit, docs/ is missing, and no project doc
 *     lives at root. CLAUDE.md, a globally installed audit binary, and
 *     registry membership are not signals — those repos stay silent.
 *     A root project doc still gets placement guidance and suppresses
 *     this missing-directory finding. Both-exist findings are owned by
 *     `taxonomy.ts`.
 *
 * Hint text changes when no docs/ directory exists yet ("consider creating
 * docs/" vs "should be in docs/") so the suggestion stays actionable.
 */

import { shellQuote } from '../lib/shell-quote.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

const ROOT_DOCS = ['README.md', 'CHANGELOG.md', 'CLAUDE.md', 'VERSION', 'LICENSE', 'LICENSE.md'] as const;
const DOCS_DIR_DOCS = ['TODOS.md', 'ROADMAP.md', 'PROGRESS.md'] as const;

type DocPair = { name: string; rootKey: keyof AuditCtx['exists']; docsKey: keyof AuditCtx['exists'] };

const ROOT_DOC_PAIRS: DocPair[] = [
  { name: 'README.md', rootKey: 'rootReadme', docsKey: 'docsReadme' },
  { name: 'CHANGELOG.md', rootKey: 'rootChangelog', docsKey: 'docsChangelog' },
  { name: 'CLAUDE.md', rootKey: 'rootClaude', docsKey: 'docsClaude' },
  { name: 'VERSION', rootKey: 'rootVersion', docsKey: 'docsVersion' },
  { name: 'LICENSE', rootKey: 'rootLicense', docsKey: 'docsLicense' },
  { name: 'LICENSE.md', rootKey: 'rootLicenseMd', docsKey: 'docsLicenseMd' },
];

const PROJECT_DOC_PAIRS: DocPair[] = [
  { name: 'TODOS.md', rootKey: 'rootTodos', docsKey: 'docsTodos' },
  { name: 'ROADMAP.md', rootKey: 'rootRoadmap', docsKey: 'docsRoadmap' },
  { name: 'PROGRESS.md', rootKey: 'rootProgress', docsKey: 'docsProgress' },
];

/** Move-only records shared by the audit renderer and layout callers. */
export type DocMoveRecord = {
  check: 'DOC_LOCATION' | 'DOC_TYPE_MISMATCH';
  source: string;
  destination: string | null;
  missingParent: string | null;
  heuristic: boolean;
  blocked: null | 'inbox' | 'collision';
};

export function docLocationMoves(ctx: { exists: Partial<AuditCtx['exists']> }): DocMoveRecord[] {
  const moves: DocMoveRecord[] = [];
  for (const pair of PROJECT_DOC_PAIRS) {
    if (ctx.exists[pair.rootKey] && !ctx.exists[pair.docsKey]) {
      moves.push({ check: 'DOC_LOCATION', source: pair.name, destination: `docs/${pair.name}`,
        missingParent: ctx.exists.docsDir ? null : 'docs', heuristic: false, blocked: null });
    }
  }
  for (const pair of ROOT_DOC_PAIRS) {
    if (ctx.exists[pair.docsKey] && !ctx.exists[pair.rootKey]) {
      moves.push({ check: 'DOC_LOCATION', source: `docs/${pair.name}`, destination: pair.name,
        missingParent: null, heuristic: false, blocked: null });
    }
  }
  return moves;
}

export function runCheckDocLocation(ctx: AuditCtx): CheckResult {
  const findings: string[] = [];
  for (const move of docLocationMoves(ctx)) {
    const qSrc = shellQuote(move.source);
    const qDst = shellQuote(move.destination!);
    if (move.source.startsWith('docs/')) {
      findings.push(`- ${move.destination} is in docs/ — should be in root (tools/platforms expect it there)`);
    } else if (move.missingParent) {
      findings.push(`- ${move.source} is in root — consider creating docs/ and moving it there`);
    } else {
      findings.push(`- ${move.source} is in root — should be in docs/`);
    }
    const mkdir = move.missingParent ? `mkdir -p ${shellQuote(move.missingParent)} && ` : '';
    findings.push(`  Suggested: ${mkdir}git mv -- ${qSrc} ${qDst}`);
  }

  // Repo-local opt-in only: bin/roadmap-audit under the audited repoRoot.
  // No PATH lookup, no extendDir, no registry. A root project doc already
  // produces placement guidance, so this finding stays off in that case.
  const hasProjectDocAtRoot =
    ctx.exists.rootTodos || ctx.exists.rootRoadmap || ctx.exists.rootProgress;
  if (ctx.exists.rootRoadmapAudit && !ctx.exists.docsDir && !hasProjectDocAtRoot) {
    findings.push(
      '- docs/ directory absent — project-level docs (ROADMAP.md/TODOS.md/PROGRESS.md) belong there. Run /roadmap to scaffold.',
    );
  }

  if (findings.length === 0) {
    return {
      section: 'DOC_LOCATION',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }
  return {
    section: 'DOC_LOCATION',
    status: 'fail',
    body: ['FINDINGS:', ...findings, ''],
  };
}

// Re-export the canonical doc lists so cli.ts (and DOC_INVENTORY in PR 3)
// can use the same source of truth without duplicating literals.
export const ROOT_DOC_NAMES = ROOT_DOCS;
export const PROJECT_DOC_NAMES = DOCS_DIR_DOCS;
