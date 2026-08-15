/**
 * style-lint.ts — advisory warnings that don't affect correctness.
 *
 * Composes from:
 *   1. Parser-emitted warnings (from ctx.roadmap.value.styleLintWarnings):
 *      duplicate track IDs, malformed _touches:_, self-dep, unparseable
 *      _Depends on:_ annotation. Accumulate in document order during parse.
 *   2. Intra-group track dep cycles (ctx.roadmap.value.trackDepCycles).
 *   3. Unordered same-file collisions from the packer, after closing the
 *      track `_blocked-by` DAG, the packer bin DAG, and the written
 *      Group `_Depends on:` DAG. Warn only when order is undetermined.
 *   4. (removed) Redundant-previous-Group lint — unspecified is now
 *      none, so an explicit `_Depends on: Group N_` is always meaningful.
 *
 * Findings are emitted WITHOUT a `- ` bullet prefix — bash builds the
 * string verbatim and renders via `echo -e`, no ` -` adornment.
 */

import { tracksForPacker } from './packing.ts';
import { identCollisions, unorderedCollisions } from '../lib/pack.ts';
import type { AuditCtx, CheckResult } from '../types.ts';

export function runCheckStyleLint(ctx: AuditCtx): CheckResult {
  const warnings: string[] = [...ctx.roadmap.value.styleLintWarnings];
  const trackGroup = new Map(ctx.roadmap.value.tracks.map((t) => [t.id, t.groupNum]));
  const groupDeps = new Map<string, string[]>();
  for (const g of ctx.roadmap.value.groups) {
    groupDeps.set(g.num, g.deps.kind === 'list' ? g.deps.depNums : []);
  }
  const packedInput = tracksForPacker(ctx);
  for (const w of identCollisions(packedInput)) {
    warnings.push(w);
  }
  for (const w of unorderedCollisions(packedInput, { trackGroup, groupDeps })) {
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
