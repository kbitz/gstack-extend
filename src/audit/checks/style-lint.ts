/**
 * style-lint.ts — advisory warnings that don't affect correctness.
 *
 * Composes from:
 *   1. Parser-emitted warnings (from ctx.roadmap.value.styleLintWarnings):
 *      duplicate track IDs, malformed _touches:_, self-dep, unparseable
 *      _Depends on:_ annotation. Accumulate in document order during parse.
 *   2. Intra-group track dep cycles (ctx.roadmap.value.trackDepCycles).
 *   3. (removed) Redundant-previous-Group lint — unspecified is now
 *      none, so an explicit `_Depends on: Group N_` is always meaningful.
 *
 * Findings are emitted WITHOUT a `- ` bullet prefix — bash builds the
 * string verbatim and renders via `echo -e`, no ` -` adornment.
 */

import { tracksForPacker } from './packing.ts';
import { unorderedCollisions } from '../lib/pack.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckStyleLint(ctx: AuditCtx): CheckResult {
  const warnings: string[] = [...ctx.roadmap.value.styleLintWarnings];
  for (const w of unorderedCollisions(tracksForPacker(ctx))) {
    warnings.push(w);
  }

  // 2. Intra-group track dep cycles.
  for (const cyc of ctx.roadmap.value.trackDepCycles) {
    if (cyc === '') continue;
    warnings.push(
      `Dep cycle in intra-Group track graph: ${cyc} — remove or invert one edge to break the cycle`,
    );
  }

  if (warnings.length === 0) {
    return {
      section: 'STYLE_LINT',
      status: 'pass',
      body: ['FINDINGS:', '- (none)'],
    };
  }
  // Trailing '' from bash echo -e of \n-terminated $_STYLE_LINT_WARNINGS.
  return {
    section: 'STYLE_LINT',
    status: 'warn',
    body: ['FINDINGS:', ...warnings, ''],
  };
}
