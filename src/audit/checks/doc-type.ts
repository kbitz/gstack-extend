/**
 * doc-type.ts — DOC_TYPE_MISMATCH heuristic (Track 5A, post-T4 tightening).
 *
 * Scans every `.md` file in ctx.mdFiles for two strong-signal patterns
 * where the file's content disagrees with its location:
 *
 *   - design-looking doc OUTSIDE docs/designs/: a fenced code block with
 *     `mermaid` or `plantuml` language identifier.
 *   - inbox-looking doc OUTSIDE TODOS.md: checkbox density >= 0.50,
 *     defined as
 *       (count of lines matching `^\s*[-*]\s*\[[ x]\]`)
 *         / (count of non-blank, non-heading content lines).
 *     The 0.50 threshold (raised from the original 0.20 spec) cuts false
 *     positives on legitimate checklist docs (CONTRIBUTING.md, runbooks,
 *     release-checklist.md, QA plans). Codex T4 catch.
 *
 * Design-mismatch findings get a `Suggested: git mv -- 'src' 'dst'`
 * line (or `mkdir -p && git mv` when the parent is missing, or "review
 * and move" when the destination already exists). Inbox-mismatch findings
 * ALWAYS get the no-automated-suggestion text — moving a checkbox-heavy
 * file into TODOS.md is almost always a merge/import problem, not a
 * rename. Per Track 8A's CEO + eng review: inbox-mismatch is always-block
 * by policy, so the inbox path in `suggestionFor` short-circuits before
 * collision-suppression even runs.
 *
 * Skip rules (no finding emitted):
 *   - basename in ROOT_DOCS or DOCS_DIR_DOCS (doc-location.ts territory).
 *   - basename matches the docType-allowlist (CONTRIBUTING.md, RUNBOOK.md,
 *     CODE_OF_CONDUCT.md, *checklist*.md, README.md, CHANGELOG.md).
 *   - file has fewer than 5 content lines (avoids tripping on tiny stubs).
 *   - file IS in the canonical location (mermaid INSIDE docs/designs/, or
 *     checkbox-heavy IS the TODOS.md file).
 *
 * Output format per finding:
 *   - <relpath>: <kind> outside <expected location>
 *     Suggested: <git mv preview OR review-and-move note>
 *
 * Shell-safety: paths in `Suggested: git mv ...` lines are single-quoted
 * via shellQuote() so a malicious filename like `a;curl evil|sh.md` cannot
 * inject commands when the user copy-pastes the suggestion. Codex ship
 * review caught this as P0.
 *
 * `git mv` preview rules (design-mismatch only):
 *   - if expected destination's parent dir doesn't exist, prefix with
 *     `mkdir -p <parent> && `.
 *   - if the destination FILE already exists (collision), suppress the
 *     git mv and emit
 *     `Suggested: review and move (no automated suggestion — destination ambiguous)`.
 *
 * Inbox-mismatch is always-block — no automated suggestion ever, with
 * inbox-specific wording ("inbox content typically wants merge, not
 * rename") so users don't blindly run a rename on a file that should
 * have been merged.
 *
 * walkMdFiles inherits maxdepth 2 from existing audit walk scope; deeper
 * docs (docs/guides/foo.md) are not scanned. Documented in CHANGELOG.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { shellQuote } from '../lib/shell-quote.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

const ROOT_DOCS = new Set([
  'README.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'VERSION',
  'LICENSE',
  'LICENSE.md',
]);
const PROJECT_DOCS = new Set(['TODOS.md', 'ROADMAP.md', 'PROGRESS.md']);

// Filenames that look like checklists by design — release runbooks, OSS
// project boilerplate, etc. Excluded from the inbox-mismatch heuristic.
const DOCTYPE_ALLOWLIST = new Set([
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'RUNBOOK.md',
  'SECURITY.md',
  'SUPPORT.md',
  'GOVERNANCE.md',
]);

const CHECKLIST_FILENAME_PATTERN = /checklist/i;

const MIN_CONTENT_LINES = 5;
const CHECKBOX_DENSITY_THRESHOLD = 0.5;

const MERMAID_FENCE_RE = /^```\s*(mermaid|plantuml)\b/m;
const CHECKBOX_LINE_RE = /^\s*[-*]\s*\[[ xX]\]/;
const HEADING_LINE_RE = /^\s*#/;

type Finding = {
  rel: string;
  kind: 'design' | 'inbox';
  expectedDir: string;
};

function basenameOf(rel: string): string {
  return rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel;
}

function isInDocsDesigns(rel: string): boolean {
  return rel === 'docs/designs' || rel.startsWith('docs/designs/');
}

function isAllowlisted(basename: string): boolean {
  if (DOCTYPE_ALLOWLIST.has(basename)) return true;
  if (CHECKLIST_FILENAME_PATTERN.test(basename)) return true;
  return false;
}

function checkboxDensity(content: string): number {
  const lines = content.split('\n');
  let contentLines = 0;
  let checkboxLines = 0;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    if (HEADING_LINE_RE.test(line)) continue;
    contentLines += 1;
    if (CHECKBOX_LINE_RE.test(line)) checkboxLines += 1;
  }
  if (contentLines < MIN_CONTENT_LINES) return 0;
  return checkboxLines / contentLines;
}

function hasMermaidOrPlantumlFence(content: string): boolean {
  return MERMAID_FENCE_RE.test(content);
}

function suggestionFor(ctx: AuditCtx, finding: Finding): string {
  // Inbox-mismatch is always-block: checkbox-heavy files outside TODOS.md
  // typically want merge/import, not rename, so we never emit an
  // automated git-mv suggestion for them. Short-circuit before destination
  // resolution / collision detection.
  if (finding.kind === 'inbox') {
    return 'Suggested: review and move (no automated suggestion — inbox content typically wants merge, not rename)';
  }
  const basename = basenameOf(finding.rel);
  const dest = `docs/designs/${basename}`;
  const destAbs = join(ctx.repoRoot, dest);
  // Collision: refuse to suggest a destructive move.
  if (existsSync(destAbs)) {
    return 'Suggested: review and move (no automated suggestion — destination ambiguous)';
  }
  // Need to mkdir parent? Only relevant for nested destinations.
  const parent = dest.includes('/') ? dest.slice(0, dest.lastIndexOf('/')) : '';
  const qSrc = shellQuote(finding.rel);
  const qDest = shellQuote(dest);
  if (parent && !existsSync(join(ctx.repoRoot, parent))) {
    return `Suggested: mkdir -p ${shellQuote(parent)} && git mv -- ${qSrc} ${qDest}`;
  }
  return `Suggested: git mv -- ${qSrc} ${qDest}`;
}

export function runCheckDocType(ctx: AuditCtx): CheckResult {
  const findings: Finding[] = [];

  for (const f of ctx.mdFiles) {
    const basename = basenameOf(f.rel);
    if (ROOT_DOCS.has(basename)) continue;
    if (PROJECT_DOCS.has(basename)) continue;
    if (isAllowlisted(basename)) continue;

    const lines = f.content.split('\n');
    const contentLines = lines.filter((l) => l.trim().length > 0 && !HEADING_LINE_RE.test(l));
    if (contentLines.length < MIN_CONTENT_LINES) continue;

    // Design-mismatch: mermaid/plantuml fence outside docs/designs/.
    if (hasMermaidOrPlantumlFence(f.content) && !isInDocsDesigns(f.rel)) {
      findings.push({ rel: f.rel, kind: 'design', expectedDir: 'docs/designs/' });
      continue;
    }

    // Inbox-mismatch: checkbox-density >= threshold AND not TODOS.md
    // (already handled by skip-if-PROJECT_DOCS above).
    const density = checkboxDensity(f.content);
    if (density >= CHECKBOX_DENSITY_THRESHOLD) {
      findings.push({ rel: f.rel, kind: 'inbox', expectedDir: 'TODOS.md' });
    }
  }

  if (findings.length === 0) {
    return {
      section: 'DOC_TYPE_MISMATCH',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }

  const body: string[] = ['FINDINGS:'];
  for (const f of findings) {
    const kindLabel =
      f.kind === 'design'
        ? `looks like a design doc (mermaid/plantuml fence) but is outside ${f.expectedDir}`
        : `looks like a TODO inbox (checkbox density >= ${CHECKBOX_DENSITY_THRESHOLD}) but is outside ${f.expectedDir}`;
    body.push(`- ${f.rel}: ${kindLabel}`);
    body.push(`  ${suggestionFor(ctx, f)}`);
  }
  body.push('');

  return {
    section: 'DOC_TYPE_MISMATCH',
    status: 'warn',
    body,
  };
}
