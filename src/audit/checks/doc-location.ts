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
 *   - `docs/` directory absent on a gstack-onboarded project (CLAUDE.md
 *     present at root or docs/) and no project doc lives at root either —
 *     the true greenfield-onboarding case. Gated on CLAUDE.md so this
 *     finding only fires on projects that intend to use gstack/extend
 *     tooling; bare repos that happen to run `roadmap-audit` once stay
 *     silent. Both-exist findings (ROADMAP.md present in both root AND
 *     docs/) are owned by `taxonomy.ts` — adding them here would emit
 *     a duplicate finding.
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

export function runCheckDocLocation(ctx: AuditCtx): CheckResult {
  const findings: string[] = [];
  const hasDocs = ctx.exists.docsDir;

  // Each finding emits a `Suggested:` line so the Layout Scaffolding flow
  // in skills/roadmap.md can execute the moves directly. When the
  // destination's parent dir doesn't exist (no docs/ yet, root → docs/
  // move), prefix with `mkdir -p` so the suggestion is one copy-paste.
  // shellQuote keeps the suggestion safe against malicious filenames —
  // doc-location's filenames are constrained to ROOT_DOCS/PROJECT_DOC_PAIRS
  // literals (TODOS.md, ROADMAP.md, etc.) so injection is structurally
  // impossible, but quoting is defense-in-depth and matches doc-type.ts.
  for (const pair of PROJECT_DOC_PAIRS) {
    const inRoot = ctx.exists[pair.rootKey];
    const inDocs = ctx.exists[pair.docsKey];
    if (inRoot && !inDocs) {
      const dst = `docs/${pair.name}`;
      const qSrc = shellQuote(pair.name);
      const qDst = shellQuote(dst);
      if (hasDocs) {
        findings.push(`- ${pair.name} is in root — should be in docs/`);
        findings.push(`  Suggested: git mv -- ${qSrc} ${qDst}`);
      } else {
        findings.push(
          `- ${pair.name} is in root — consider creating docs/ and moving it there`,
        );
        findings.push(`  Suggested: mkdir -p 'docs' && git mv -- ${qSrc} ${qDst}`);
      }
    }
  }

  for (const pair of ROOT_DOC_PAIRS) {
    const inRoot = ctx.exists[pair.rootKey];
    const inDocs = ctx.exists[pair.docsKey];
    if (inDocs && !inRoot) {
      const src = `docs/${pair.name}`;
      const qSrc = shellQuote(src);
      const qDst = shellQuote(pair.name);
      findings.push(
        `- ${pair.name} is in docs/ — should be in root (tools/platforms expect it there)`,
      );
      findings.push(`  Suggested: git mv -- ${qSrc} ${qDst}`);
    }
  }

  // Greenfield gstack-onboarded project: CLAUDE.md present (this is a
  // claude-code-managed project that wants gstack tooling) but `docs/`
  // doesn't exist yet and no project doc lives at root either. The
  // CLAUDE.md gate is load-bearing — without it, this finding fires on
  // every bare repo someone happens to point `roadmap-audit` at, dirtying
  // almost every snapshot fixture and producing layout pressure for
  // projects that never opted in.
  const hasClaude = ctx.exists.rootClaude || ctx.exists.docsClaude;
  const hasProjectDocAtRoot =
    ctx.exists.rootTodos || ctx.exists.rootRoadmap || ctx.exists.rootProgress;
  if (hasClaude && !ctx.exists.docsDir && !hasProjectDocAtRoot) {
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
