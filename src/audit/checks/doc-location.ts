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
 *
 * Hint text changes when no docs/ directory exists yet ("consider creating
 * docs/" vs "should be in docs/") so the suggestion stays actionable.
 */

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

export function runCheckDocLocation(ctx: AuditCtx): CheckResult {
  const findings: string[] = [];
  const hasDocs = ctx.exists.docsDir;

  for (const pair of PROJECT_DOC_PAIRS) {
    const inRoot = ctx.exists[pair.rootKey];
    const inDocs = ctx.exists[pair.docsKey];
    if (inRoot && !inDocs) {
      if (hasDocs) {
        findings.push(`- ${pair.name} is in root — should be in docs/`);
      } else {
        findings.push(
          `- ${pair.name} is in root — consider creating docs/ and moving it there`,
        );
      }
    }
  }

  for (const pair of ROOT_DOC_PAIRS) {
    const inRoot = ctx.exists[pair.rootKey];
    const inDocs = ctx.exists[pair.docsKey];
    if (inDocs && !inRoot) {
      findings.push(
        `- ${pair.name} is in docs/ — should be in root (tools/platforms expect it there)`,
      );
    }
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
