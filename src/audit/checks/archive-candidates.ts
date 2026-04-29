/**
 * archive-candidates.ts — port of check_archive_candidates (~L946-1007).
 *
 * Flags design docs in docs/designs/*.md that reference a version which has
 * already shipped (doc version <= current version). Those docs are
 * candidates for moving to docs/archive/.
 *
 * Skipped (STATUS=skip) when no version source exists at all. Returns
 * STATUS=pass with no findings when docs/designs/ doesn't exist (the
 * directory is optional).
 *
 * Version match regex: `v?[0-9]+\.[0-9]+\.[0-9]+` — the FIRST match in the
 * doc wins (bash `head -1`). 4-segment versions are intentionally not
 * matched here; the bash uses 3-segment regex.
 */

import { semverLte } from '../lib/semver.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

const VERSION_RE = /v?[0-9]+\.[0-9]+\.[0-9]+/;

export function runCheckArchiveCandidates(ctx: AuditCtx): CheckResult {
  if (ctx.version.source === 'unknown') {
    return {
      section: 'ARCHIVE_CANDIDATES',
      status: 'skip',
      body: [
        'FINDINGS:',
        '- No version source (VERSION file or pyproject.toml) — cannot detect archive candidates',
      ],
    };
  }

  if (!ctx.exists.designsDir) {
    return {
      section: 'ARCHIVE_CANDIDATES',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }

  const findings: string[] = [];
  const current = ctx.version.current;

  for (const doc of ctx.designs) {
    const m = VERSION_RE.exec(doc.content);
    if (m === null) continue;
    const docVer = m[0]!.replace(/^v/, '');
    if (semverLte(docVer, current)) {
      findings.push(
        `- docs/designs/${doc.basename} references v${docVer} (current: v${current}) — candidate for archiving to docs/archive/`,
      );
    }
  }

  if (findings.length === 0) {
    return {
      section: 'ARCHIVE_CANDIDATES',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }
  return {
    section: 'ARCHIVE_CANDIDATES',
    status: 'fail',
    body: ['FINDINGS:', ...findings, ''],
  };
}
