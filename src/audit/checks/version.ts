/**
 * version.ts — port of check_version (~L703-812).
 *
 * Cross-checks the current version (VERSION file, falling back to
 * pyproject.toml [project] version) against:
 *   - latest git tag (must match)
 *   - PROGRESS.md latest entry (highest by semver across all table cells)
 *   - CHANGELOG.md latest entry (first `## [X.Y.Z]` heading)
 *
 * Also recommends a bump tier ("patch" if any non-doc file changed since the
 * latest tag — bash regex `\.(md|txt|yml|yaml|json)$` is the doc filter).
 *
 * Output format (preamble before STATUS, mirrors bash echo order):
 *   CURRENT, SOURCE, LATEST_TAG, [PROGRESS_LATEST], [CHANGELOG_LATEST],
 *   RECOMMEND, then STATUS + FINDINGS. Empty PROGRESS/CHANGELOG lines are
 *   suppressed (bash conditional emit).
 */

import type { AuditCtx, CheckResult } from '../types.ts';

const DOC_EXT_RE = /\.(?:md|txt|yml|yaml|json)$/;

export function runCheckVersion(ctx: AuditCtx): CheckResult {
  // Replicate the bash `_rc` ladder: empty VERSION → skip with custom hint;
  // no source at all → skip with the "no source" hint.
  if (ctx.exists.versionFile) {
    const trimmed = ctx.files.version.replace(/[\t\n\v\f\r ]/g, '');
    if (trimmed === '') {
      return {
        section: 'VERSION',
        status: 'skip',
        body: [
          'FINDINGS:',
          '- VERSION file exists but is empty (write a version like `echo 0.1.0 > VERSION`, or delete the file to fall back to pyproject.toml)',
        ],
      };
    }
  }

  if (ctx.version.source === 'unknown') {
    return {
      section: 'VERSION',
      status: 'skip',
      body: ['FINDINGS:', '- No VERSION file or pyproject.toml version found'],
    };
  }

  const findings: string[] = [];
  const preamble: string[] = [];
  preamble.push(`CURRENT: ${ctx.version.current}`);
  preamble.push(`SOURCE: ${ctx.version.source}`);

  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?$/.test(ctx.version.current)) {
    findings.push(
      `- version "${ctx.version.current}" (from ${ctx.version.source}) is not valid (expected X.Y.Z or X.Y.Z.W)`,
    );
  }

  if (ctx.version.latestTag !== null) {
    preamble.push(`LATEST_TAG: ${ctx.version.latestTag}`);
    const tagVer = ctx.version.latestTag.replace(/^v/, '');
    if (ctx.version.current !== tagVer) {
      findings.push(
        `- ${ctx.version.source} version (${ctx.version.current}) does not match latest tag (${ctx.version.latestTag})`,
      );
    }
  } else {
    preamble.push('LATEST_TAG: (none)');
    findings.push('- No git tags found — consider tagging releases (git tag vX.Y.Z)');
  }

  if (ctx.version.progressLatest !== null) {
    preamble.push(`PROGRESS_LATEST: ${ctx.version.progressLatest}`);
  }
  if (ctx.version.changelogLatest !== null) {
    preamble.push(`CHANGELOG_LATEST: ${ctx.version.changelogLatest}`);
  }

  let recommend = 'none';
  if (ctx.version.latestTag !== null) {
    const changed = ctx.git.diffNamesBetween(ctx.version.latestTag, 'HEAD');
    let codeChanged = 0;
    for (const f of changed) {
      if (f === '') continue;
      if (!DOC_EXT_RE.test(f)) codeChanged++;
    }
    if (codeChanged > 0) recommend = 'patch';
  }
  preamble.push(`RECOMMEND: ${recommend}`);

  if (findings.length === 0) {
    return {
      section: 'VERSION',
      preamble,
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }
  return {
    section: 'VERSION',
    preamble,
    status: 'fail',
    body: ['FINDINGS:', ...findings, ''],
  };
}
