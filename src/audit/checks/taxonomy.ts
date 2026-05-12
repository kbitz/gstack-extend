/**
 * taxonomy.ts — port of check_taxonomy (~L814-895).
 *
 * Verifies the canonical doc layout:
 *   - Required project docs exist (TODOS.md, ROADMAP.md, PROGRESS.md, VERSION).
 *   - No project doc is duplicated between root/ and docs/.
 *   - PROGRESS.md and CHANGELOG.md don't share too many identical lines (>3
 *     overlap is flagged as content duplication).
 *
 * VERSION presence is satisfied by either a VERSION file OR a pyproject.toml
 * with a `[project] version = "..."` line (handled in cli.ts when it builds
 * VersionInfo — here we just check the source).
 *
 * The overlap check skips table headers (`| Version`) and separators (`|--`)
 * to avoid false positives from shared markdown table boilerplate.
 */

import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckTaxonomy(ctx: AuditCtx): CheckResult {
  const findings: string[] = [];

  if (ctx.paths.todos === null) {
    findings.push('- TODOS.md: missing (inbox for unprocessed items)');
  }
  if (ctx.paths.roadmap === null) {
    findings.push('- ROADMAP.md: missing (run /roadmap to create from TODOS.md)');
  }
  if (ctx.paths.progress === null) {
    findings.push('- PROGRESS.md: missing');
  }
  // VERSION present iff VERSION file OR pyproject version line exists.
  if (!ctx.exists.versionFile && ctx.version.source !== 'pyproject.toml') {
    findings.push(
      '- VERSION: missing (no VERSION file and no pyproject.toml `version = "..."` field)',
    );
  }

  // Both-exist findings name the precedence reality: cli.ts:findDoc checks
  // root first then docs/, so the root copy is what every check actually
  // reads and the docs/ copy is silently ignored. Without naming that
  // explicitly, users who hit this case often reconcile in the wrong
  // direction (edit the invisible copy).
  if (ctx.exists.rootTodos && ctx.exists.docsTodos) {
    findings.push(
      '- TODOS.md exists in BOTH root and docs/ — root copy is used; docs/ copy is invisible to the audit. Reconcile manually.',
    );
  }
  if (ctx.exists.rootRoadmap && ctx.exists.docsRoadmap) {
    findings.push(
      '- ROADMAP.md exists in BOTH root and docs/ — root copy is used; docs/ copy is invisible to the audit. Reconcile manually.',
    );
  }
  if (ctx.exists.rootProgress && ctx.exists.docsProgress) {
    findings.push(
      '- PROGRESS.md exists in BOTH root and docs/ — root copy is used; docs/ copy is invisible to the audit. Reconcile manually.',
    );
  }

  // PROGRESS.md ↔ CHANGELOG.md exact-match overlap detection.
  if (ctx.paths.progress !== null && ctx.exists.changelogFile) {
    let overlap = 0;
    const changelogLines = new Set(ctx.files.changelog.split('\n'));
    for (const line of ctx.files.progress.split('\n')) {
      if (line === '') continue;
      if (!line.startsWith('|')) continue;
      // Skip headers/separators.
      if (/^\|[-]+/.test(line)) continue;
      if (/^\| Version/.test(line)) continue;
      if (changelogLines.has(line)) overlap++;
    }
    if (overlap > 3) {
      findings.push(
        `- PROGRESS.md and CHANGELOG.md share ${overlap} identical lines — possible content duplication`,
      );
    }
  }

  if (findings.length === 0) {
    return {
      section: 'TAXONOMY',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }
  return {
    section: 'TAXONOMY',
    status: 'fail',
    body: ['FINDINGS:', ...findings, ''],
  };
}
