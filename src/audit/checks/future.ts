/**
 * future.ts — `## Future` section format validation.
 *
 * The Future section is "items we might do but aren't committed to."
 * Plain bullets, no Phase/Group/Track structure, no `_touches:_`, no
 * sizing, no IDs. Promotion to Current Plan is the moment of commitment;
 * structure is added then.
 *
 * Output shape:
 *   STATUS: pass | fail | skip
 *   FINDINGS: per-finding (or "- (none)")
 *   FUTURE_BULLET_COUNT: N
 */

import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckFuture(ctx: AuditCtx): CheckResult {
  if (ctx.paths.roadmap === null) {
    return {
      section: 'FUTURE',
      status: 'skip',
      body: ['FINDINGS:', '- No ROADMAP.md found'],
    };
  }

  const bullets = ctx.roadmap.value.futureBullets;
  const malformed = ctx.roadmap.value.futureMalformed;

  const findings: string[] = [];
  for (const m of malformed) {
    if (/^#{2,5} /.test(m)) {
      findings.push(
        `- Future contains a heading: "${m}" — Future is plain bullets only (no Phase/Group/Track structure)`,
      );
    } else if (/^_/.test(m)) {
      findings.push(
        `- Future contains a metadata line: "${m}" — Future is plain bullets only (no _touches:_, no sizing)`,
      );
    } else {
      findings.push(`- Future contains non-bullet content: "${m}"`);
    }
  }

  const tail = [`FUTURE_BULLET_COUNT: ${bullets.length}`];

  if (findings.length === 0) {
    return {
      section: 'FUTURE',
      status: 'pass',
      body: ['FINDINGS:', '- (none)', ...tail],
    };
  }
  return {
    section: 'FUTURE',
    status: 'fail',
    body: ['FINDINGS:', ...findings, '', ...tail],
  };
}
