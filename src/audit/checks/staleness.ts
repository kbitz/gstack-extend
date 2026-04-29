/**
 * staleness.ts — port of check_staleness (~L625-702).
 *
 * Greps ROADMAP.md for completed-item markers carrying a version annotation
 * (`~~text~~ DONE`, `~~text~~ ✓`, `~~text~~ ✅`, `~~text~~ Completed`,
 * `^### ~~`). For each match, extracts the parenthetical version and flags
 * it stale if either:
 *   1. A git tag matching `vX.Y.Z` or `X.Y.Z` exists for that version.
 *   2. The current VERSION (or pyproject.toml) is >= the matched version.
 *
 * Bash uses `git tag --list` and `version_gt` from lib/semver. Here the
 * tags come through `ctx.git.tags()` (gateway) and the comparator is
 * `versionGt` from lib/semver.
 */

import { versionGt } from '../lib/semver.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

const VERSION_RE = /\(v?[0-9]+\.[0-9]+(?:\.[0-9]+)*\)/;

export function runCheckStaleness(ctx: AuditCtx): CheckResult {
  if (ctx.paths.roadmap === null) {
    return {
      section: 'STALENESS',
      status: 'skip',
      body: ['FINDINGS:', '- No ROADMAP.md found'],
    };
  }

  const lines = ctx.files.roadmap.split('\n');
  const tagSet = new Set(ctx.git.tags());
  const current = ctx.version.current;

  const findings: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/~~.*DONE|~~.*✓|~~.*✅|~~.*Completed|^### ~~/.test(line)) continue;
    const verMatch = VERSION_RE.exec(line);
    if (!verMatch) continue;
    const ver = verMatch[0]!.replace(/^\(v?/, '').replace(/\)$/, '');
    if (ver === '') continue;

    let shipped = false;
    if (tagSet.has(ver) || tagSet.has(`v${ver}`)) shipped = true;
    if (!shipped && current !== '' && (current === ver || versionGt(current, ver))) {
      shipped = true;
    }

    if (shipped) {
      findings.push(
        `- line ${i + 1}: completed item still present (v${ver} shipped) — delete it`,
      );
    }
  }

  if (findings.length === 0) {
    return {
      section: 'STALENESS',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }
  return {
    section: 'STALENESS',
    status: 'fail',
    body: ['FINDINGS:', ...findings, ''],
  };
}
